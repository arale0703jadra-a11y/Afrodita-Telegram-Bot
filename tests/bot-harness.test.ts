import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Bot, type PollingOptions } from "grammy";
import { createAfroditaApplication } from "../src/bot.js";
import type { AfroditaConfig } from "../src/config.js";
import { AfroditaStore } from "../src/store.js";
import { PublicationScheduler } from "../src/scheduler.js";

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
const TEST_CONFIG: AfroditaConfig = { botToken: TEST_TOKEN };

class MockTelegramBot extends Bot {
  startCalls = 0;
  stopCalls = 0;
  startError: Error | undefined;
  readonly apiAttempts: string[] = [];

  constructor() {
    super(TEST_TOKEN, { botInfo: TEST_BOT_INFO });
    this.api.config.use(async (_previous, method) => {
      this.apiAttempts.push(method);
      throw new Error(`TELEGRAM_NETWORK_BLOCKED:${method}`);
    });
  }

  override async start(options?: PollingOptions): Promise<void> {
    this.startCalls += 1;
    if (this.startError) throw this.startError;
    await options?.onStart?.(this.botInfo);
  }

  override async stop(): Promise<void> {
    this.stopCalls += 1;
  }
}

async function withTemporaryDirectory(
  run: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "afrodita-startup-harness-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("isolated application startup uses the injected bot, temporary store, and no scheduler", async () => {
  await withTemporaryDirectory(async (directory) => {
    const signals = new EventEmitter();
    const fetchAttempts: Array<string | URL | Request> = [];
    const nativeFetch = globalThis.fetch;
    let directFetchAttempts = 0;
    globalThis.fetch = async () => {
      directFetchAttempts += 1;
      throw new Error("GLOBAL_FETCH_BLOCKED");
    };
    const bot = new MockTelegramBot();
    let factoryCalls = 0;
    const fetcher: typeof fetch = async (input) => {
      fetchAttempts.push(input);
      throw new Error("EXTERNAL_FETCH_BLOCKED");
    };
    const store = new AfroditaStore(directory);
    try {
      const app = createAfroditaApplication({
        config: TEST_CONFIG,
        createBot(token) {
          factoryCalls += 1;
          assert.equal(token, TEST_TOKEN);
          return bot;
        },
        store,
        scheduler: null,
        fetcher,
        shutdownSignals: signals,
      });

      assert.equal(factoryCalls, 1);
      assert.equal(app.bot, bot);
      assert.equal(app.store, store);
      assert.equal(app.scheduler, undefined);
      assert.equal(bot.startCalls, 0);
      assert.equal(signals.listenerCount("SIGINT"), 0);

      await app.start();

      assert.equal(bot.startCalls, 1);
      assert.equal(bot.stopCalls, 0);
      assert.deepEqual(bot.apiAttempts, []);
      assert.deepEqual(fetchAttempts, []);
      assert.equal(directFetchAttempts, 0);
      assert.equal(signals.listenerCount("SIGINT"), 0);
      assert.equal(signals.listenerCount("SIGTERM"), 0);
      assert.deepEqual(await store.listGroupIds(), []);

      await app.stop();
      assert.equal(bot.stopCalls, 1);
      assert.deepEqual(await store.listGroupIds(), []);
    } finally {
      globalThis.fetch = nativeFetch;
    }
  });
});

test("Telegram API requests are rejected by the mock transport before network access", async () => {
  const bot = new MockTelegramBot();

  await assert.rejects(bot.api.getMe(), /TELEGRAM_NETWORK_BLOCKED:getMe/u);
  assert.deepEqual(bot.apiAttempts, ["getMe"]);
});

test("production application construction retains the scheduler unless explicitly disabled", async () => {
  await withTemporaryDirectory(async (directory) => {
    const bot = new MockTelegramBot();
    const app = createAfroditaApplication({
      config: TEST_CONFIG,
      bot,
      store: new AfroditaStore(directory),
      shutdownSignals: new EventEmitter(),
    });

    assert.ok(app.scheduler instanceof PublicationScheduler);
    await app.start();
    assert.equal(bot.startCalls, 1);
    assert.deepEqual(bot.apiAttempts, []);
    await app.stop();
  });
});

test("simulated scheduler initialization failure stops the scheduler and never starts polling", async () => {
  await withTemporaryDirectory(async (directory) => {
    const bot = new MockTelegramBot();
    const signals = new EventEmitter();
    let stopCalls = 0;
    const app = createAfroditaApplication({
      config: TEST_CONFIG,
      bot,
      store: new AfroditaStore(directory),
      scheduler: {
        start() {
          throw new Error("SCHEDULER_START_FAILED");
        },
        stop() {
          stopCalls += 1;
        },
      },
      shutdownSignals: signals,
    });

    await assert.rejects(app.start(), /SCHEDULER_START_FAILED/u);
    assert.equal(stopCalls, 1);
    assert.equal(bot.startCalls, 0);
    assert.deepEqual(bot.apiAttempts, []);
    assert.equal(signals.listenerCount("SIGINT"), 0);
    assert.equal(signals.listenerCount("SIGTERM"), 0);
  });
});

test("bot construction failure is surfaced without starting polling or scheduling", async () => {
  const signals = new EventEmitter();
  let fetchCalls = 0;

  assert.throws(
    () => createAfroditaApplication({
      config: TEST_CONFIG,
      createBot() {
        throw new Error("BOT_CONSTRUCTION_FAILED");
      },
      scheduler: null,
      fetcher: async () => {
        fetchCalls += 1;
        throw new Error("EXTERNAL_FETCH_BLOCKED");
      },
      shutdownSignals: signals,
    }),
    /BOT_CONSTRUCTION_FAILED/u,
  );
  assert.equal(fetchCalls, 0);
  assert.equal(signals.listenerCount("SIGINT"), 0);
  assert.equal(signals.listenerCount("SIGTERM"), 0);
});

test("simulated polling startup failure releases scheduler and shutdown handlers", async () => {
  await withTemporaryDirectory(async (directory) => {
    const bot = new MockTelegramBot();
    bot.startError = new Error("POLLING_START_FAILED");
    const signals = new EventEmitter();
    let schedulerStops = 0;
    const app = createAfroditaApplication({
      config: TEST_CONFIG,
      bot,
      store: new AfroditaStore(directory),
      scheduler: {
        start() {},
        stop() {
          schedulerStops += 1;
        },
      },
      shutdownSignals: signals,
    });

    await assert.rejects(app.start(), /POLLING_START_FAILED/u);
    assert.equal(schedulerStops, 1);
    assert.equal(bot.startCalls, 1);
    assert.equal(signals.listenerCount("SIGINT"), 0);
    assert.equal(signals.listenerCount("SIGTERM"), 0);
  });
});

test("persistence failures stay within the temporary path and are reported to the caller", async () => {
  await withTemporaryDirectory(async (directory) => {
    const blockedStorePath = join(directory, "not-a-directory");
    await writeFile(blockedStorePath, "preserve this file", "utf8");
    const store = new AfroditaStore(blockedStorePath);

    await assert.rejects(store.setEnabled(-100123, true));
    assert.equal(await readFile(blockedStorePath, "utf8"), "preserve this file");
  });
});
