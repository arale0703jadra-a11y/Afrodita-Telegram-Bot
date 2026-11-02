import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Bot } from "grammy";
import { createAfroditaApplication } from "../src/bot.js";
import { loadAfroditaConfig } from "../src/config.js";
import { AfroditaStore } from "../src/store.js";

const TOKEN = "12345:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const CHAT_ID = -100998877;
const BOT_INFO = {
  id: 12345,
  is_bot: true,
  first_name: "AFRODITA test",
  username: "afrodita_test",
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
  can_manage_bots: false,
  supports_join_request_queries: false,
} as const;
type Update = Parameters<Bot["handleUpdate"]>[0];

class CommandBot extends Bot {
  memberStatus = "member";
  readonly replies: string[] = [];
  private nextMessageId = 100;

  constructor() {
    super(TOKEN, { botInfo: BOT_INFO });
    this.api.config.use(async (_previous, method, payload): Promise<any> => {
      if (method === "getChatMember") {
        const args = payload as { user_id: number };
        return {
          ok: true,
          result: {
            status: this.memberStatus,
            is_member: this.memberStatus !== "left" && this.memberStatus !== "kicked",
            user: { id: args.user_id, is_bot: false, first_name: "Tester" },
          },
        };
      }
      if (method === "sendMessage") {
        const args = payload as { chat_id: number; text: string };
        this.replies.push(args.text);
        return {
          ok: true,
          result: {
            message_id: this.nextMessageId++,
            date: Math.floor(Date.now() / 1000),
            chat: { id: args.chat_id, type: "supergroup", title: "Test" },
            text: args.text,
          },
        };
      }
      throw new Error(`TELEGRAM_CALL_BLOCKED:${method}`);
    });
  }
}

function commandUpdate(updateId: number, userId: number, text: string): Update {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 1_793_000_000,
      chat: { id: CHAT_ID, type: "supergroup", title: "Test" },
      from: { id: userId, is_bot: false, first_name: "Tester" },
      text,
      entities: [{ type: "bot_command", offset: 0, length: text.split(/\s/u)[0]!.length }],
    },
  };
}

async function withStore(run: (store: AfroditaStore) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "afrodita-consent-commands-"));
  try {
    await run(new AfroditaStore(directory));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function createApplication(
  bot: CommandBot,
  store: AfroditaStore,
  verifiedUserId?: number,
) {
  const config = loadAfroditaConfig({
    AFRODITA_BOT_TOKEN: TOKEN,
    AFRODITA_SUPABASE_URL: "https://example.supabase.co",
    AFRODITA_SUPABASE_KEY: "sb_publishable_test123",
  });
  return createAfroditaApplication({
    config,
    bot,
    store,
    scheduler: null,
    shutdownSignals: new EventEmitter(),
    fetcher: async () => new Response(JSON.stringify(
      verifiedUserId
        ? [{ group_id: CHAT_ID, user_id: verifiedUserId, display_name: "Test", username: "test_user" }]
        : [],
    ), { status: 200 }),
  });
}

test("una persona verificada solo otorga los permisos que enumera y puede revocarlos individualmente", async () => {
  await withStore(async (store) => {
    const bot = new CommandBot();
    createApplication(bot, store, 7001);
    await bot.handleUpdate(commandUpdate(
      1,
      7001,
      "/afrodita_consentimiento otorgar mencionar,cuerpo,fotos",
    ));

    let consent = (await store.loadGroup(CHAT_ID)).contentConsents["7001"]!;
    assert.equal(consent.mention.granted, true);
    assert.equal(consent.body.granted, true);
    assert.equal(consent.photos.granted, true);
    assert.equal(consent.catalog.granted, false);
    assert.equal(consent.videos.granted, false);
    assert.equal(consent.polls.granted, false);
    assert.ok(consent.body.grantedByUserId === 7001);
    assert.ok((await store.loadGroup(CHAT_ID)).contentConsentAudit.length === 3);

    await bot.handleUpdate(commandUpdate(
      2,
      7001,
      "/afrodita_consentimiento retirar cuerpo",
    ));
    consent = (await store.loadGroup(CHAT_ID)).contentConsents["7001"]!;
    assert.equal(consent.body.granted, false);
    assert.equal(consent.body.revokedByUserId, 7001);
    assert.equal(consent.mention.granted, true);
    assert.equal(consent.photos.granted, true);
    assert.ok(consent.body.grantedAt);
    assert.ok(consent.body.revokedAt);
  });
});

test("el consentimiento se deniega si la persona no está verificada o no pertenece al grupo", async () => {
  await withStore(async (store) => {
    const bot = new CommandBot();
    createApplication(bot, store);
    await bot.handleUpdate(commandUpdate(
      3,
      7002,
      "/afrodita_consentimiento otorgar catalogo",
    ));
    assert.equal((await store.loadGroup(CHAT_ID)).contentConsents["7002"], undefined);

    const memberBot = new CommandBot();
    memberBot.memberStatus = "left";
    createApplication(memberBot, store, 7003);
    await memberBot.handleUpdate(commandUpdate(
      4,
      7003,
      "/afrodita_consentimiento otorgar catalogo",
    ));
    assert.equal((await store.loadGroup(CHAT_ID)).contentConsents["7003"], undefined);

    await assert.rejects(
      store.setContentConsent(CHAT_ID, 7004, 9004, ["catalog"], true),
      /AFRODITA_CONTENT_CONSENT_INVALID/u,
      "el almacén rechaza un actor distinto de la persona titular",
    );
  });
});

test("solo una persona administradora actual puede confirmar o retirar el estado adulto", async () => {
  await withStore(async (store) => {
    const bot = new CommandBot();
    createApplication(bot, store);
    await bot.handleUpdate(commandUpdate(5, 8001, "/afrodita_adulto confirmar"));
    assert.equal((await store.loadGroup(CHAT_ID)).adultConfirmedAt, undefined);

    bot.memberStatus = "administrator";
    await bot.handleUpdate(commandUpdate(6, 8001, "/afrodita_adulto confirmar"));
    assert.ok((await store.loadGroup(CHAT_ID)).adultConfirmedAt);
    assert.match(bot.replies.at(-1) ?? "", /no verifica la edad individual/u);

    bot.memberStatus = "member";
    await bot.handleUpdate(commandUpdate(7, 8001, "/afrodita_adulto retirar"));
    assert.ok((await store.loadGroup(CHAT_ID)).adultConfirmedAt);

    bot.memberStatus = "administrator";
    await bot.handleUpdate(commandUpdate(8, 8001, "/afrodita_adulto retirar"));
    assert.equal((await store.loadGroup(CHAT_ID)).adultConfirmedAt, undefined);
  });
});
