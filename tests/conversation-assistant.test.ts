import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Bot } from "grammy";
import { createAfroditaApplication } from "../src/bot.js";
import { AfroditaActivityControl } from "../src/activity-control.js";
import { loadAfroditaConfig } from "../src/config.js";
import { GroupConversationContext } from "../src/conversation-context.js";
import { generateReply } from "../src/generator.js";
import { AfroditaStore } from "../src/store.js";
import { ADULT_POLL_BANK, adultPollContent, pollContent } from "../src/messages.js";

const TOKEN = "12345:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const CHAT_ID = -100887766;
const USER_ID = 554433;
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

class ConversationBot extends Bot {
  readonly sent: string[] = [];
  memberStatus = "member";
  memberLookupError = false;

  constructor() {
    super(TOKEN, { botInfo: BOT_INFO });
    this.api.config.use(async (_previous, method, payload): Promise<any> => {
      if (method === "getChatMember") {
        if (this.memberLookupError) throw new Error("TELEGRAM_LOOKUP_FAILED");
        const args = payload as { user_id: number };
        return {
          ok: true,
          result: {
            status: this.memberStatus,
            is_member: this.memberStatus !== "left" && this.memberStatus !== "kicked",
            user: { id: args.user_id, is_bot: false, first_name: "Member" },
          },
        };
      }
      if (method === "sendMessage") {
        this.sent.push((payload as { text: string }).text);
        return {
          ok: true,
          result: {
            message_id: 100,
            date: Math.floor(Date.now() / 1000),
            chat: { id: CHAT_ID, type: "supergroup", title: "Test" },
            text: (payload as { text: string }).text,
          },
        };
      }
      throw new Error(`UNEXPECTED_TELEGRAM_METHOD:${method}`);
    });
  }
}

function textUpdate(updateId: number, text: string): Update {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 1_793_000_000,
      chat: { id: CHAT_ID, type: "supergroup", title: "Test" },
      from: { id: USER_ID, is_bot: false, first_name: "Member" },
      text,
    },
  };
}

async function withStore(run: (store: AfroditaStore) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "afrodita-conversation-"));
  try {
    await run(new AfroditaStore(directory));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("commercial inquiries use the configured LLM and never consult or publish the verified catalog", async () => {
  await withStore(async (store) => {
    const bot = new ConversationBot();
    const config = loadAfroditaConfig({
      AFRODITA_BOT_TOKEN: TOKEN,
      AFRODITA_AI_CHAT_COMPLETIONS_URL: "https://llm.example/v1/chat/completions",
      AFRODITA_AI_API_KEY: "test-key",
      AFRODITA_AI_MODEL: "test-model",
      AFRODITA_SUPABASE_URL: "https://example.supabase.co",
      AFRODITA_SUPABASE_KEY: "sb_publishable_test123",
    });
    let requestBody: Record<string, unknown> | undefined;
    let verificationCalls = 0;
    const fetcher: typeof fetch = async (input, init) => {
      if (String(input).includes("/rest/v1/rpc/get_afrodita_verified_catalog")) {
        verificationCalls += 1;
        return new Response("[]", { status: 200 });
      }
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        choices: [{ message: { content: "No puedo confirmar eso, pero podemos conversar sobre lo que te interesa 😊." } }],
      }), { status: 200 });
    };
    await store.setEnabled(CHAT_ID, true);
    createAfroditaApplication({
      config,
      bot,
      store,
      scheduler: null,
      fetcher,
      shutdownSignals: new EventEmitter(),
    });

    test("global pause blocks conversational replies before any AI or Telegram request", async () => {
      await withStore(async (store) => {
        const bot = new ConversationBot();
        const activityControl = new AfroditaActivityControl("paused");
        const config = loadAfroditaConfig({
          AFRODITA_BOT_TOKEN: TOKEN,
          AFRODITA_AI_CHAT_COMPLETIONS_URL: "https://llm.example/v1/chat/completions",
          AFRODITA_AI_API_KEY: "test-key",
          AFRODITA_AI_MODEL: "test-model",
        });
        let fetchCalls = 0;
        await store.setEnabled(CHAT_ID, true);
        createAfroditaApplication({
          config,
          bot,
          store,
          scheduler: null,
          activityControl,
          fetcher: async () => {
            fetchCalls += 1;
            throw new Error("AI_MUST_NOT_BE_CALLED");
          },
          shutdownSignals: new EventEmitter(),
        });

        await bot.handleUpdate(textUpdate(77, "@afrodita_test hola"));

        assert.equal(fetchCalls, 0);
        assert.equal(bot.sent.length, 0);
        assert.equal((await store.loadGroup(CHAT_ID)).messageCount, 0);
      });
    });

    await bot.handleUpdate(textUpdate(1, "¿Tienen videollamadas?"));

    assert.equal(bot.sent.length, 1);
    assert.equal(verificationCalls, 2, "verifica al autor antes de la IA y antes del envío");
    assert.match(bot.sent[0]!, /podemos conversar/u);
    const messages = requestBody?.messages as Array<{ role: string; content: string }>;
    assert.match(messages[1]!.content, /¿Tienen videollamadas\?/u);
    assert.match(messages[0]!.content, /No anuncies ni ofrezcas catálogos/u);
    assert.doesNotMatch(bot.sent[0]!, /@|perfil verificado|catálogo disponible/iu);
  });
});

test("LLM fallback for commercial inquiries does not offer a verified catalog", async () => {
  const result = await generateReply(
    "¿Tienen catálogo?",
    "general",
    {},
    0,
  );
  assert.equal(result.generatedByAi, false);
  assert.match(result.text ?? "", /no tengo información fiable/iu);
  assert.doesNotMatch(result.text ?? "", /perfil verificado|catálogo disponible|@/iu);
});

test("occasional participation passes the triggering group message to the LLM", async () => {
  await withStore(async (store) => {
    const bot = new ConversationBot();
    const config = loadAfroditaConfig({
      AFRODITA_BOT_TOKEN: TOKEN,
      AFRODITA_AI_CHAT_COMPLETIONS_URL: "https://llm.example/v1/chat/completions",
      AFRODITA_AI_API_KEY: "test-key",
      AFRODITA_AI_MODEL: "test-model",
      AFRODITA_SUPABASE_URL: "https://example.supabase.co",
      AFRODITA_SUPABASE_KEY: "sb_publishable_test123",
    });
    let requestBody: Record<string, unknown> | undefined;
    const fetcher: typeof fetch = async (input, init) => {
      if (String(input).includes("/rest/v1/rpc/get_afrodita_verified_catalog")) {
        return new Response("[]", { status: 200 });
      }
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        choices: [{ message: { content: "¡Qué buena recomendación! ¿Cuál les gusta más?" } }],
      }), { status: 200 });
    };
    await store.setEnabled(CHAT_ID, true);
    createAfroditaApplication({
      config,
      bot,
      store,
      scheduler: null,
      fetcher,
      shutdownSignals: new EventEmitter(),
    });

    const originalRandom = Math.random;
    Math.random = () => 0.01;
    try {
      await bot.handleUpdate(textUpdate(2, "Hoy estamos hablando de café local"));
    } finally {
      Math.random = originalRandom;
    }

    const messages = requestBody?.messages as Array<{ role: string; content: string }>;
    assert.match(messages[1]!.content, /Hoy estamos hablando de café local/u);
    assert.equal(bot.sent.length, 1);
    assert.match(bot.sent[0]!, /buena recomendación/u);
  });
});

test("administrators and group owners are excluded before the LLM is called", async () => {
  for (const memberStatus of ["administrator", "creator"]) {
    await withStore(async (store) => {
      const bot = new ConversationBot();
      bot.memberStatus = memberStatus;
      const config = loadAfroditaConfig({
        AFRODITA_BOT_TOKEN: TOKEN,
        AFRODITA_AI_CHAT_COMPLETIONS_URL: "https://llm.example/v1/chat/completions",
        AFRODITA_AI_API_KEY: "test-key",
        AFRODITA_AI_MODEL: "test-model",
        AFRODITA_SUPABASE_URL: "https://example.supabase.co",
        AFRODITA_SUPABASE_KEY: "sb_publishable_test123",
      });
      let fetchCalls = 0;
      await store.setEnabled(CHAT_ID, true);
      createAfroditaApplication({
        config,
        bot,
        store,
        scheduler: null,
        fetcher: async () => {
          fetchCalls += 1;
          return new Response("[]", { status: 200 });
        },
        shutdownSignals: new EventEmitter(),
      });

      await bot.handleUpdate(textUpdate(3, "@afrodita_test ¿Qué opinan de esta idea?"));

      assert.equal(fetchCalls, 0);
      assert.deepEqual(bot.sent, []);
    });
  }
});

test("verified users and unverifiable identities receive no conversational response", async () => {
  await withStore(async (store) => {
    const bot = new ConversationBot();
    const config = loadAfroditaConfig({
      AFRODITA_BOT_TOKEN: TOKEN,
      AFRODITA_AI_CHAT_COMPLETIONS_URL: "https://llm.example/v1/chat/completions",
      AFRODITA_AI_API_KEY: "test-key",
      AFRODITA_AI_MODEL: "test-model",
      AFRODITA_SUPABASE_URL: "https://example.supabase.co",
      AFRODITA_SUPABASE_KEY: "sb_publishable_test123",
    });
    let aiCalls = 0;
    await store.setEnabled(CHAT_ID, true);
    createAfroditaApplication({
      config,
      bot,
      store,
      scheduler: null,
      fetcher: async (input) => {
        if (String(input).includes("/rest/v1/rpc/get_afrodita_verified_catalog")) {
          return new Response(JSON.stringify([
            { group_id: CHAT_ID, user_id: USER_ID, display_name: "Verified" },
          ]), { status: 200 });
        }
        aiCalls += 1;
        return new Response(JSON.stringify({
          choices: [{ message: { content: "Respuesta que no debe enviarse." } }],
        }), { status: 200 });
      },
      shutdownSignals: new EventEmitter(),
    });

    await bot.handleUpdate(textUpdate(4, "@afrodita_test Hola"));
    assert.equal(aiCalls, 0);
    assert.deepEqual(bot.sent, []);

    const unknownBot = new ConversationBot();
    unknownBot.memberLookupError = true;
    createAfroditaApplication({
      config,
      bot: unknownBot,
      store,
      scheduler: null,
      fetcher: async () => {
        aiCalls += 1;
        return new Response("[]", { status: 200 });
      },
      shutdownSignals: new EventEmitter(),
    });
    await unknownBot.handleUpdate(textUpdate(5, "@afrodita_test Hola"));
    assert.equal(aiCalls, 0);
    assert.deepEqual(unknownBot.sent, []);
  });
});

test("the author role is revalidated after generation and can veto the send", async () => {
  await withStore(async (store) => {
    const bot = new ConversationBot();
    const config = loadAfroditaConfig({
      AFRODITA_BOT_TOKEN: TOKEN,
      AFRODITA_AI_CHAT_COMPLETIONS_URL: "https://llm.example/v1/chat/completions",
      AFRODITA_AI_API_KEY: "test-key",
      AFRODITA_AI_MODEL: "test-model",
      AFRODITA_SUPABASE_URL: "https://example.supabase.co",
      AFRODITA_SUPABASE_KEY: "sb_publishable_test123",
    });
    await store.setEnabled(CHAT_ID, true);
    createAfroditaApplication({
      config,
      bot,
      store,
      scheduler: null,
      fetcher: async (input, init) => {
        if (String(input).includes("/rest/v1/rpc/get_afrodita_verified_catalog")) {
          return new Response("[]", { status: 200 });
        }
        bot.memberStatus = "administrator";
        return new Response(JSON.stringify({
          choices: [{ message: { content: "Una respuesta amable." } }],
        }), { status: 200 });
      },
      shutdownSignals: new EventEmitter(),
    });

    await bot.handleUpdate(textUpdate(6, "@afrodita_test Hola"));

    assert.deepEqual(bot.sent, []);
    const state = await store.loadGroup(CHAT_ID);
    assert.equal(state.communityRepliesThisHour, 0, "la reserva se revierte si falla la revalidación");
    assert.equal(state.postsToday, 0);
  });

  test("conversation history is bounded, expires, and remains isolated by group", () => {
    const context = new GroupConversationContext();
    for (let index = 0; index < 8; index += 1) {
      context.append(CHAT_ID, "user", `mensaje-${index}`, 1_000 + index);
    }
    context.append(CHAT_ID - 1, "assistant", "otro grupo", 1_008);

    assert.equal(context.recent(CHAT_ID, 1_009).length, 6);
    assert.equal(context.recent(CHAT_ID, 1_009)[0]?.content, "mensaje-2");
    assert.deepEqual(context.recent(CHAT_ID - 1, 1_009), [
      { role: "assistant", content: "otro grupo" },
    ]);
    assert.deepEqual(context.recent(CHAT_ID, 2_000_000), []);
  });

  test("community and adult polls have varied, coherent Telegram-safe content", () => {
    const questions = new Set<string>();
    for (let index = 0; index < 8; index += 1) {
      const poll = pollContent("general", index / 8);
      questions.add(poll.question);
      assert.ok(poll.options.length >= 2 && poll.options.length <= 10);
      assert.equal(poll.options.length, poll.topics.length);
      assert.ok(poll.question.length <= 300);
      assert.ok(poll.options.every((option) => option.length <= 100));
    }
    assert.equal(questions.size, 8);
    for (const poll of ADULT_POLL_BANK) {
      assert.ok(poll.options.length >= 2 && poll.options.length <= 10);
      assert.ok(poll.question.length <= 300);
      assert.ok(poll.options.every((option) => option.length <= 100));
    }
    assert.equal(adultPollContent(0.7).adult, true);
  });

  test("the LLM receives only the bounded group conversation history", async () => {
    const context = new GroupConversationContext();
    context.append(CHAT_ID, "user", "Me gusta probar cafeterías nuevas.");
    context.append(CHAT_ID, "assistant", "¿Tienes alguna favorita? ☕");
    let submitted: Array<{ role: string; content: string }> = [];
    await generateReply(
      "La de la esquina tiene buen pan",
      "comida",
      {
        endpoint: "https://llm.example/v1/chat/completions",
        apiKey: "test-key",
        model: "test-model",
      },
      0.4,
      async (_input, init) => {
        const payload = JSON.parse(String(init?.body)) as {
          messages: Array<{ role: string; content: string }>;
        };
        submitted = payload.messages;
        return new Response(JSON.stringify({
          choices: [{ message: { content: "¡Suena delicioso!" } }],
        }), { status: 200 });
      },
      context.recent(CHAT_ID),
    );
    assert.deepEqual(submitted.slice(1, 3).map((turn) => turn.content), [
      "Me gusta probar cafeterías nuevas.",
      "¿Tienes alguna favorita? ☕",
    ]);
    assert.match(submitted.at(-1)?.content ?? "", /La de la esquina tiene buen pan/u);
  });
});
