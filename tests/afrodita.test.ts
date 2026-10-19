import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyTopic, observeMessage, preferredTopic } from "../src/analytics.js";
import {
  canPublish,
  decideAction,
  recordPublishedAction,
} from "../src/decision.js";
import {
  DEFAULT_AFRODITA_LIMITS,
  initialAfroditaState,
} from "../src/types.js";
import { AfroditaStore } from "../src/store.js";
import { catalogReply, isSafeGeneratedReply, pollContent } from "../src/messages.js";
import { generateReply } from "../src/generator.js";
import { loadAfroditaConfig } from "../src/config.js";

const now = Date.UTC(2026, 9, 14, 15, 0);
const testBotToken = `12345678:${"x".repeat(35)}`;

test("analytics stores aggregate topics, UTC activity, and replies only", () => {
  const state = initialAfroditaState();
  observeMessage(
    state,
    {
      text: "¿Qué producto recomiendan?",
      hourUtc: 15,
      repliedToBot: true,
      explicitQuietRequest: false,
    },
    now,
  );

  assert.equal(state.messageCount, 1);
  assert.equal(state.topicCounts.productos, 1);
  assert.equal(state.replyTopicCounts.productos, 1);
  assert.equal(state.activityByHour[15], 1);
  assert.equal(state.usefulReplies, 1);
  assert.equal("text" in state, false);
  assert.equal(Object.keys(state).some((key) => /user|messageText/i.test(key)), false);
});

test("poll updates store anonymous aggregate option counts and reconcile changed votes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "afrodita-tests-"));
  try {
    const store = new AfroditaStore(directory);
    await store.registerPoll(123, "poll1", ["comida", "productos"]);

    assert.equal(
      await store.recordPollUpdate("poll1", [{ voter_count: 0 }, { voter_count: 1 }]),
      true,
    );
    assert.equal(
      await store.recordPollUpdate("poll1", [{ voter_count: 0 }, { voter_count: 1 }]),
      true,
    );
    assert.equal((await store.loadGroup(123)).pollVotes.productos, 1);
    assert.equal(
      await store.recordPollUpdate("poll1", [{ voter_count: 1 }, { voter_count: 0 }]),
      true,
    );
    const state = await store.loadGroup(123);
    assert.equal(state.pollVotes.comida, 1);
    assert.equal(state.pollVotes.productos, 0);
    assert.equal(Object.keys(state).some((key) => /voter|userId/i.test(key)), false);
    assert.equal("poll1" in state.pollTallies, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("group state remains isolated by chat ID", async () => {
  const directory = await mkdtemp(join(tmpdir(), "afrodita-isolation-"));
  try {
    const store = new AfroditaStore(directory);
    await Promise.all([
      store.setEnabled(-100, true),
      store.setEnabled(-200, false),
      store.authorizeProfile(-100, { userId: 123, displayName: "Perfil" }),
    ]);
    const [first, second] = await Promise.all([
      store.loadGroup(-100),
      store.loadGroup(-200),
    ]);
    assert.equal(first.enabled, true);
    assert.equal(first.authorizedProfiles["123"]?.displayName, "Perfil");
    assert.equal(second.enabled, false);
    assert.deepEqual(second.authorizedProfiles, {});
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("concurrent observations are serialized without persisting message text", async () => {
  const directory = await mkdtemp(join(tmpdir(), "afrodita-tests-"));
  try {
    const store = new AfroditaStore(directory);
    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        store.updateGroup(123, (state) => {
          observeMessage(
            state,
            {
              text: `producto privado ${index}`,
              hourUtc: 8,
              repliedToBot: false,
              explicitQuietRequest: false,
            },
            now,
          );
        }),
      ),
    );
    const state = await store.loadGroup(123);
    assert.equal(state.messageCount, 20);
    assert.equal(state.topicCounts.productos, 20);
    assert.equal(state.activityByHour[8], 20);
    assert.doesNotMatch(JSON.stringify(state), /producto privado/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("group activation and authorized profiles persist independently with a strict cap", async () => {
  const directory = await mkdtemp(join(tmpdir(), "afrodita-tests-"));
  try {
    const store = new AfroditaStore(directory);
    await store.setEnabled(456, true);
    for (let userId = 1; userId <= 20; userId += 1) {
      await store.authorizeProfile(456, {
        userId,
        displayName: `Perfil ${userId}`,
      });
    }
    await assert.rejects(
      store.authorizeProfile(456, { userId: 21, displayName: "Otro perfil" }),
      /AFRODITA_PROFILE_LIMIT_REACHED/,
    );
    const state = await store.loadGroup(456);
    assert.equal(state.enabled, true);
    assert.equal(Object.keys(state.authorizedProfiles).length, 20);
    await store.removeProfile(456, 1);
    const updated = await store.loadGroup(456);
    assert.equal(Object.keys(updated.authorizedProfiles).length, 19);
    assert.equal(updated.authorizedProfiles["1"], undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("damaged AFRODITA state is preserved as a backup and blocks fallback writes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "afrodita-corrupt-"));
  const damagedContents = '{"enabled":';
  try {
    const file = join(directory, "-100.json");
    await writeFile(file, damagedContents, "utf8");
    const store = new AfroditaStore(directory);
    await assert.rejects(
      store.updateGroup(-100, (state) => {
        state.enabled = true;
      }),
      /AFRODITA_STORAGE_CORRUPT/,
    );
    await assert.rejects(store.loadGroup(-100), /AFRODITA_STORAGE_CORRUPT/);

    const files = await readdir(directory);
    assert.equal(await readFile(file, "utf8"), damagedContents);
    const backupName = files.find((name) => name.startsWith("-100.json.corrupt-"));
    assert.equal(files.filter((name) => name.startsWith("-100.json.corrupt-")).length, 1);
    assert.ok(backupName);
    assert.equal(await readFile(join(directory, backupName), "utf8"), damagedContents);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("store rejects invalid chat IDs and profile identities before persistence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "afrodita-input-"));
  try {
    const store = new AfroditaStore(directory);
    await assert.rejects(store.setEnabled(Number.NaN, true), /AFRODITA_CHAT_ID_INVALID/);
    await assert.rejects(
      store.authorizeProfile(123, { userId: 0, displayName: "Perfil" }),
      /AFRODITA_PROFILE_INVALID/,
    );
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("only explicit feedback pauses the bot and the pause is temporary", () => {
  const state = initialAfroditaState();
  state.enabled = true;
  observeMessage(
    state,
    {
      text: "No me menciones tanto",
      hourUtc: 4,
      repliedToBot: true,
      explicitQuietRequest: true,
    },
    now,
  );

  assert.equal(state.explicitQuietRequests, 1);
  assert.equal(state.quietUntil, now + DEFAULT_AFRODITA_LIMITS.quietPeriodMs);
  assert.deepEqual(
    decideAction(state, { directedToBot: true, randomValue: 0, now }),
    { action: "silence", reason: "quiet_period" },
  );
  assert.equal(
    decideAction(state, {
      directedToBot: true,
      randomValue: 0,
      now: state.quietUntil + 1,
    }).action,
    "reply",
  );
});

test("directed messages get priority while unsolicited participation stays rare", () => {
  const state = initialAfroditaState();
  state.enabled = true;
  state.topicCounts.comida = 3;

  assert.deepEqual(
    decideAction(state, { directedToBot: true, randomValue: 0.5, now }),
    { action: "reply", topic: "comida" },
  );
  assert.equal(
    decideAction(state, { directedToBot: false, randomValue: 0.5, now }).action,
    "silence",
  );
  assert.equal(
    decideAction(state, { directedToBot: false, randomValue: 0.01, now }).action,
    "participate",
  );
});

test("polls and profiles require engagement and an authorized profile", () => {
  const state = initialAfroditaState();
  state.enabled = true;
  state.messagesSincePoll = 40;
  assert.deepEqual(
    decideAction(state, { directedToBot: false, randomValue: 0.5, now }),
    { action: "poll", topic: "general" },
  );

  recordPublishedAction(state, "poll", now);
  state.authorizedProfiles["12"] = { userId: 12, displayName: "Creadora" };
  const profile = decideAction(state, {
    directedToBot: false,
    randomValue: 0.005,
    now: now + DEFAULT_AFRODITA_LIMITS.minPostIntervalMs,
  });
  assert.deepEqual(profile, { action: "profile", profile: state.authorizedProfiles["12"] });
});

test("daily cap and minimum interval suppress further posts", () => {
  const state = initialAfroditaState();
  state.enabled = true;
  for (let index = 0; index < DEFAULT_AFRODITA_LIMITS.maxPostsPerDay; index += 1) {
    assert.equal(canPublish(state, "reply", now + index * 20 * 60 * 1000), true);
    recordPublishedAction(state, "reply", now + index * 20 * 60 * 1000);
  }
  assert.equal(
    canPublish(state, "reply", now + 2 * 24 * 60 * 60 * 1000),
    true,
  );
  assert.equal(
    canPublish(
      state,
      "reply",
      now + DEFAULT_AFRODITA_LIMITS.minPostIntervalMs - 1,
    ),
    false,
  );
});

test("new groups remain inactive until an administrator enables AFRODITA", () => {
  const state = initialAfroditaState();
  assert.equal(state.enabled, false);
  assert.deepEqual(
    decideAction(state, { directedToBot: true, randomValue: 0, now }),
    { action: "silence", reason: "no_opportunity" },
  );
  state.enabled = true;
  assert.equal(
    decideAction(state, { directedToBot: true, randomValue: 0, now }).action,
    "reply",
  );
});

test("topic classifier does not retain input or infer personal attributes", () => {
  assert.equal(classifyTopic("¿Qué productos locales tienen buen precio?"), "productos");
  assert.equal(classifyTopic("Quiero reservar una asesoría"), "servicios");
  assert.equal(classifyTopic("Conversación cualquiera"), "general");
  assert.equal(preferredTopic(initialAfroditaState()), "general");
});

test("catalog replies vary and generated content rejects links, mentions, and sensitive claims", () => {
  assert.notEqual(catalogReply("general", 0), catalogReply("general", 0.99));
  assert.deepEqual(pollContent("general").topics, [
    "productos",
    "servicios",
    "belleza",
    "moda",
  ]);
  assert.equal(isSafeGeneratedReply("¡Qué buena pregunta! 😄"), true);
  assert.equal(isSafeGeneratedReply("Escríbeme a https://example.com"), false);
  assert.equal(isSafeGeneratedReply("Hola @usuario"), false);
  assert.equal(isSafeGeneratedReply("Sé que estás deprimida"), false);
  assert.equal(isSafeGeneratedReply("a".repeat(351)), false);
});

test("AI generation is opt-in, only receives the directed message, and safely falls back", async () => {
  let requestedBody = "";
  let calls = 0;
  const fetcher = async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls += 1;
    requestedBody = String(init?.body ?? "");
    return new Response(JSON.stringify({
      choices: [{ message: { content: "¡Qué buena pregunta! 😄" } }],
    }), { status: 200 });
  };

  const fallback = await generateReply("mensaje privado", "general", {}, 0, fetcher);
  assert.equal(calls, 0);
  assert.equal(fallback.generatedByAi, false);

  const ai = await generateReply(
    "mensaje privado",
    "general",
    {
      endpoint: "https://ai.example/v1/chat/completions",
      apiKey: "test-key",
      model: "test-model",
    },
    0,
    fetcher,
  );
  assert.equal(ai.generatedByAi, true);
  assert.equal(ai.text, "¡Qué buena pregunta! 😄");
  const body = JSON.parse(requestedBody) as {
    messages: Array<{ content: string }>;
  };
  assert.match(body.messages[1].content, /mensaje privado/);
  assert.equal(body.messages.length, 2);

  const unsafe = await generateReply(
    "hola",
    "general",
    {
      endpoint: "https://ai.example/v1/chat/completions",
      apiKey: "test-key",
      model: "test-model",
    },
    0,
    async () => new Response(JSON.stringify({
      choices: [{ message: { content: "Visita https://unsafe.example" } }],
    }), { status: 200 }),
  );
  assert.equal(unsafe.generatedByAi, false);
  assert.equal(unsafe.text, catalogReply("general", 0));
});

test("AI refusal returns silence instead of a canned response", async () => {
  const result = await generateReply(
    "no quiero hablar",
    "general",
    {
      endpoint: "https://ai.example/v1/chat/completions",
      apiKey: "test-key",
      model: "test-model",
    },
    0,
    async () => new Response(JSON.stringify({
      choices: [{ message: { content: "[SILENCIO]" } }],
    }), { status: 200 }),
  );
  assert.deepEqual(result, { generatedByAi: true, silent: true });
});

test("AI transport errors use the local catalog without logging error details", async () => {
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (message?: unknown) => warnings.push(String(message));
  try {
    const result = await generateReply(
      "hola",
      "general",
      {
        endpoint: "https://ai.example/v1/chat/completions",
        apiKey: "test-key",
        model: "test-model",
      },
      0,
      async () => {
        throw new Error("sensitive-detail");
      },
    );
    assert.equal(result.text, catalogReply("general", 0));
    assert.equal(result.generatedByAi, false);
    assert.ok(warnings.some((warning) => warning.includes("Error")));
    assert.equal(warnings.some((warning) => warning.includes("sensitive-detail")), false);
  } finally {
    console.warn = originalWarn;
  }
});

test("configuration rejects incomplete AI credentials and unsafe public endpoints", () => {
  assert.throws(
    () => loadAfroditaConfig({}),
    (error: unknown) =>
      error instanceof Error &&
      error.message === "Falta AFRODITA_BOT_TOKEN." &&
      error.name === "AfroditaConfigError" &&
      !error.message.includes(testBotToken),
  );
  assert.throws(
    () => loadAfroditaConfig({ AFRODITA_BOT_TOKEN: testBotToken, AFRODITA_AI_API_KEY: "key" }),
    /requiere AFRODITA_AI_CHAT_COMPLETIONS_URL/,
  );
  assert.throws(
    () => loadAfroditaConfig({
      AFRODITA_BOT_TOKEN: testBotToken,
      AFRODITA_AI_CHAT_COMPLETIONS_URL: "http://remote.example/chat",
      AFRODITA_AI_API_KEY: "key",
      AFRODITA_AI_MODEL: "model",
    }),
    /debe usar HTTPS/,
  );
  assert.equal(loadAfroditaConfig({ AFRODITA_BOT_TOKEN: testBotToken }).aiEndpoint, undefined);
  assert.throws(
    () => loadAfroditaConfig({ AFRODITA_BOT_TOKEN: "malformed" }),
    /formato válido/,
  );
});
