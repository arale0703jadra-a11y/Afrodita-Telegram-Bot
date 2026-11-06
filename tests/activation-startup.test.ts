import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Bot, type PollingOptions } from "grammy";
import { createAfroditaApplication } from "../src/bot.js";
import { AfroditaActivityControl } from "../src/activity-control.js";
import { loadAfroditaConfig } from "../src/config.js";
import { AfroditaStore } from "../src/store.js";

type Update = Parameters<Bot["handleUpdate"]>[0];

const TEST_TOKEN = "12345:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const TEST_BOT_INFO = {
  id: 12345,
  is_bot: true,
  first_name: "AFRODITA test double",
  username: "afrodita_test_double",
  can_join_groups: false,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
  can_manage_bots: false,
  supports_join_request_queries: false,
} as const;

interface SentMessage {
  chatId: number;
  text: string;
}

class ControlledBot extends Bot {
  readonly sent: SentMessage[] = [];
  memberStatus = "administrator";
  startCalls = 0;
  private nextMessageId = 100;

  constructor() {
    super(TEST_TOKEN, { botInfo: TEST_BOT_INFO });
    this.api.config.use(async (_previous, method, payload): Promise<any> => {
      if (method === "getChatMember") {
        const args = payload as { user_id: number };
        return {
          ok: true,
          result: {
            status: this.memberStatus,
            is_member: true,
            user: { id: args.user_id, is_bot: false, first_name: "tester" },
          },
        };
      }
      if (method === "sendMessage") {
        const args = payload as { chat_id: number; text: string };
        this.sent.push({ chatId: args.chat_id, text: args.text });
        return {
          ok: true,
          result: {
            message_id: this.nextMessageId++,
            date: Math.floor(Date.now() / 1000),
            chat: { id: args.chat_id, type: "supergroup", title: "Grupo" },
            text: args.text,
          },
        };
      }
      throw new Error(`TELEGRAM_CALL_BLOCKED:${method}`);
    });
  }

  override async start(options?: PollingOptions): Promise<void> {
    this.startCalls += 1;
    await options?.onStart?.(this.botInfo);
  }

  override async stop(): Promise<void> {}
}

function activationCommand(
  updateId: number,
  chatId: number,
  commandText = "/afrodita_activar",
): Update {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 1793000000,
      chat: { id: chatId, type: "supergroup", title: "Grupo de prueba" },
      from: { id: 9001, is_bot: false, first_name: "Admin", username: "admin_persona" },
      text: commandText,
      entities: [
        { type: "bot_command", offset: 0, length: commandText.length },
      ],
    },
  };
}

function directedMessage(updateId: number, chatId: number): Update {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 1793000000,
      chat: { id: chatId, type: "supergroup", title: "Grupo de prueba" },
      from: { id: 4242, is_bot: false, first_name: "Miembro" },
      reply_to_message: {
        message_id: 9,
        date: 1793000000,
        chat: { id: chatId, type: "supergroup", title: "Grupo de prueba" },
        from: {
          id: TEST_BOT_INFO.id,
          is_bot: true,
          first_name: TEST_BOT_INFO.first_name,
          username: TEST_BOT_INFO.username,
        },
        reply_to_message: undefined,
      },
      text: "hola",
    },
  };
}

async function withDirectory(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "afrodita-activation-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("el arranque sin Supabase configurado avisa pero no bloquea el inicio", async () => {
  await withDirectory(async (directory) => {
    const config = loadAfroditaConfig({ AFRODITA_BOT_TOKEN: TEST_TOKEN });
    assert.equal(config.supabaseUrl, undefined);
    assert.equal(config.supabaseKey, undefined);

    const bot = new ControlledBot();
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]): void => {
      warnings.push(args.map(String).join(" "));
    };
    try {
      const app = createAfroditaApplication({
        config,
        bot,
        store: new AfroditaStore(directory),
        scheduler: null,
        shutdownSignals: new EventEmitter(),
      });
      await app.start();
      assert.equal(bot.startCalls, 1);
      assert.ok(
        warnings.some((warning) => warning.includes("Supabase no está configurado")),
        "debe avisar que el catálogo de verificadas queda desactivado",
      );
      await app.stop();
    } finally {
      console.warn = originalWarn;
    }
  });
});

test("la activación persiste tras un reinicio sin perder datos existentes", async () => {
  await withDirectory(async (directory) => {
    const store = new AfroditaStore(directory);
    await store.setEnabled(-100111, true);
    await store.authorizeProfile(-100111, { userId: 7, displayName: "Perfil" });

    const restarted = new AfroditaStore(directory);
    const state = await restarted.loadGroup(-100111);
    assert.equal(state.enabled, true);
    assert.equal(state.authorizedProfiles["7"]?.displayName, "Perfil");
    assert.equal((await restarted.loadGroup(-100222)).enabled, false);
  });
});

test("/afrodita_activar redirige al control global y no activa el grupo por separado", async () => {
  await withDirectory(async (directory) => {
    const bot = new ControlledBot();
    bot.memberStatus = "administrator";
    const store = new AfroditaStore(directory);
    createAfroditaApplication({
      config: loadAfroditaConfig({ AFRODITA_BOT_TOKEN: TEST_TOKEN }),
      bot,
      store,
      scheduler: null,
      shutdownSignals: new EventEmitter(),
    });

    await bot.handleUpdate(activationCommand(1, -100333));

    assert.equal(
      (await store.loadGroup(-100333)).enabled,
      false,
      "el comando ya no activa grupos individualmente",
    );
    assert.ok(bot.sent.some((message) =>
      message.chatId === -100333 && /panel privado de ZEUS/u.test(message.text)
    ));
  });
});

test("/afrodita_pausar ya no pausa el grupo: redirige al control global sin tocar el estado", async () => {
  await withDirectory(async (directory) => {
    const bot = new ControlledBot();
    bot.memberStatus = "member";
    const store = new AfroditaStore(directory);
    await store.setEnabled(-100444, true);
    createAfroditaApplication({
      config: loadAfroditaConfig({ AFRODITA_BOT_TOKEN: TEST_TOKEN }),
      bot,
      store,
      scheduler: null,
      shutdownSignals: new EventEmitter(),
    });

    await bot.handleUpdate(activationCommand(2, -100444, "/afrodita_pausar"));

    assert.equal(
      (await store.loadGroup(-100444)).enabled,
      true,
      "la orden por grupo ya no pausa nada",
    );
    assert.ok(bot.sent.some((message) =>
      /panel privado de ZEUS/u.test(message.text)
    ));
  });
});

test("los mensajes se procesan cuando el grupo está activado", async () => {
  await withDirectory(async (directory) => {
    const bot = new ControlledBot();
    const store = new AfroditaStore(directory);
    await store.setEnabled(-100555, true);
    createAfroditaApplication({
      config: loadAfroditaConfig({ AFRODITA_BOT_TOKEN: TEST_TOKEN }),
      bot,
      store,
      scheduler: null,
      shutdownSignals: new EventEmitter(),
    });

    const realRandom = Math.random;
    Math.random = (): number => 0;
    try {
      await bot.handleUpdate(directedMessage(3, -100555));
    } finally {
      Math.random = realRandom;
    }

    assert.equal((await store.loadGroup(-100555)).messageCount, 1);
  });
});

test("el flag legacy desactivado ya no bloquea los mensajes con el control global activo", async () => {
  await withDirectory(async (directory) => {
    const bot = new ControlledBot();
    const store = new AfroditaStore(directory);
    createAfroditaApplication({
      config: loadAfroditaConfig({ AFRODITA_BOT_TOKEN: TEST_TOKEN }),
      bot,
      store,
      scheduler: null,
      shutdownSignals: new EventEmitter(),
    });

    await bot.handleUpdate(directedMessage(4, -100666));

    assert.equal(
      (await store.loadGroup(-100666)).messageCount,
      1,
      "la observación ya no depende del flag heredado",
    );
  });
});

test("con el control global en pausa no se observa ni se responde nada", async () => {
  await withDirectory(async (directory) => {
    const bot = new ControlledBot();
    const store = new AfroditaStore(directory);
    createAfroditaApplication({
      config: loadAfroditaConfig({ AFRODITA_BOT_TOKEN: TEST_TOKEN }),
      bot,
      store,
      scheduler: null,
      shutdownSignals: new EventEmitter(),
      activityControl: new AfroditaActivityControl("paused"),
    });

    await bot.handleUpdate(directedMessage(5, -100777));

    assert.equal((await store.loadGroup(-100777)).messageCount, 0);
    assert.deepEqual(bot.sent, []);
  });
});

