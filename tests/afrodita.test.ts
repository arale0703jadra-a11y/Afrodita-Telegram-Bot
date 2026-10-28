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
import {
  catalogReply,
  findRequestedVerifiedModel,
  isCommercialInquiry,
  isExplicitMediaRequest,
  isSafeGeneratedReply,
  pollContent,
  verifiedModelsPollContent,
  verifiedModelsReply,
} from "../src/messages.js";
import { generateReply } from "../src/generator.js";
import { loadAfroditaConfig } from "../src/config.js";
import {
  clearVerifiedModelsCache,
  getActiveVerifiedModels,
  isVerifiedCatalogUser,
  invalidateVerifiedModelsCache,
  type VerifiedModel,
} from "../src/verified-users.js";

const now = Date.UTC(2026, 9, 14, 15, 0);
const testBotToken = `12345678:${"x".repeat(35)}`;
const publicSupabaseTestKey = "sb_publishable_test-key";

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
  assert.deepEqual(
    decideAction(state, {
      directedToBot: false,
      commercialInquiry: true,
      randomValue: 0.9,
      now,
    }),
    { action: "reply", topic: "comida" },
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
  assert.notEqual(
    pollContent("general", 0).question,
    pollContent("general", 0.99).question,
  );
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

test("commercial request recognition is topic-focused and requires explicit media wording for images", () => {
  assert.equal(isCommercialInquiry("¿Tienen catálogo de servicios?"), true);
  assert.equal(isCommercialInquiry("¿Hay llamadas disponibles?"), true);
  assert.equal(isCommercialInquiry("¿Cuánto cuesta el pack?"), true);
  assert.equal(isCommercialInquiry("¿Qué fotos hay?"), true);
  assert.equal(isCommercialInquiry("¿Está sola ahora?"), true);
  assert.equal(isCommercialInquiry("sola"), false);
  assert.equal(isCommercialInquiry("Hola, ¿cómo estás?"), false);
  assert.equal(isExplicitMediaRequest("¿Me enseñas fotos?"), true);
  assert.equal(isExplicitMediaRequest("¿Tienen llamadas?"), false);
  const models: VerifiedModel[] = [
    { groupId: -100, userId: 1, displayName: "Ana María", media: [] },
    { groupId: -100, userId: 2, displayName: "Luz", username: "luz_model", media: [] },
  ];
  assert.equal(findRequestedVerifiedModel("¿Tienes fotos de Ana Maria?", models)?.userId, 1);
  assert.equal(findRequestedVerifiedModel("¿Fotos de @luz_model?", models)?.userId, 2);
});

test("adult interest terms trigger contextual inquiries without classifying buyers as sellers", () => {
  for (const text of [
    "Me gustan las tetas",
    "Quiero saber de sexting",
    "¿Hay videollamadas?",
    "¿Qué perfiles de escort están verificados?",
  ]) {
    assert.equal(isCommercialInquiry(text), true, text);
  }
  assert.equal(isCommercialInquiry("Hola, me gustan las películas"), false);
});

test("verified model polls use active model names and fit Telegram poll bounds", () => {
  const models: VerifiedModel[] = [
    {
      groupId: -100,
      userId: 1,
      displayName: "Ana",
      media: [],
    },
    {
      groupId: -100,
      userId: 2,
      displayName: "Luz",
      media: [],
    },
  ];
  const poll = verifiedModelsPollContent("servicios", models, 0.5);
  assert.match(poll.question, /creadora|perfil|catálogo/i);
  assert.deepEqual(poll.options, [
    "Descubrir el perfil de Ana",
    "Descubrir el perfil de Luz",
    "Otra recomendación",
  ]);
  assert.equal(poll.options.length, poll.topics.length);
  assert.ok(poll.options.length >= 2 && poll.options.length <= 10);
  assert.match(verifiedModelsReply(models), /Ana, Luz/);
});

test("verified model sales replies are contextual, varied, and do not assert private availability", () => {
  const models: VerifiedModel[] = [
    { groupId: -100, userId: 1, displayName: "Ana", media: [] },
    { groupId: -100, userId: 2, displayName: "Luz", media: [] },
  ];

  const callReply = verifiedModelsReply(models, "¿Tienen videollamada?", 0);
  const catalogReply = verifiedModelsReply(models, "¿Precio del catálogo?", 0);
  const photosReply = verifiedModelsReply(models, "¿Hay fotos?", 0);
  const availabilityReply = verifiedModelsReply(models, "¿Está sola ahora?", 0);

  assert.match(callReply, /videollamada/i);
  assert.match(catalogReply, /catálogo/i);
  assert.match(photosReply, /fotos/i);
  assert.match(availabilityReply, /no la disponibilidad personal/i);
  assert.match(callReply, /Ana, Luz/);
  assert.match(catalogReply, /sin compromiso/i);
  assert.notEqual(
    verifiedModelsReply(models, "¿Tienen videollamada?", 0),
    verifiedModelsReply(models, "¿Tienen videollamada?", 0.99),
  );
});

test("verified catalog RPC returns only allowlisted-group identities and caches safely", async () => {
  clearVerifiedModelsCache();
  let calls = 0;
  let requestUrl: URL | undefined;
  let authorization = "";
  let requestMethod = "";
  let requestBody = "";
  const fetcher: typeof fetch = async (input, init) => {
    calls += 1;
    requestUrl = new URL(input instanceof Request ? input.url : String(input));
    authorization = new Headers(init?.headers).get("authorization") ?? "";
    requestMethod = init?.method ?? "GET";
    requestBody = String(init?.body ?? "");
    return new Response(JSON.stringify([
      {
        group_id: -100,
        user_id: 123,
        username: "ana",
        display_name: "Ana",
      },
      {
        group_id: -200,
        user_id: 456,
        display_name: "Otro grupo",
      },
      {
        group_id: -200,
        user_id: 789,
        display_name: "Fila de otro grupo/contrato inválido",
      },
    ]), { status: 200 });
  };
  const config = {
    supabaseUrl: "https://example.supabase.co",
    supabaseKey: publicSupabaseTestKey,
  };

  const cacheTime = Date.now();
  const first = await getActiveVerifiedModels(-100, config, fetcher, cacheTime);
  first[0]!.media.push({ fileId: "mutated", type: "photo" });
  const second = await getActiveVerifiedModels(-100, config, fetcher, cacheTime + 1);

  assert.equal(calls, 1);
  assert.equal(authorization, `Bearer ${publicSupabaseTestKey}`);
  assert.equal(requestUrl?.pathname, "/rest/v1/rpc/get_afrodita_verified_catalog");
  assert.equal(requestMethod, "POST");
  assert.deepEqual(JSON.parse(requestBody), { p_group_id: -100 });
  assert.equal(second.length, 1);
  assert.equal(second[0]?.displayName, "Ana");
  assert.deepEqual(second[0]?.media, []);
  clearVerifiedModelsCache();
});

test("catalog cache expires after 30 seconds and can be invalidated for one group", async () => {
  clearVerifiedModelsCache();
  let calls = 0;
  let includeUser = true;
  const fetcher: typeof fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify(includeUser
      ? [{ group_id: -100, user_id: 123, display_name: "Ana" }]
      : []), { status: 200 });
  };
  const config = {
    supabaseUrl: "https://example.supabase.co",
    supabaseKey: publicSupabaseTestKey,
  };

  assert.equal((await getActiveVerifiedModels(-100, config, fetcher, 1_000)).length, 1);
  includeUser = false;
  assert.equal((await getActiveVerifiedModels(-100, config, fetcher, 30_999)).length, 1);
  assert.equal(calls, 1);
  assert.equal((await getActiveVerifiedModels(-100, config, fetcher, 31_001)).length, 0);
  assert.equal(calls, 2);

  includeUser = true;
  invalidateVerifiedModelsCache(-100, config.supabaseUrl);
  assert.equal((await getActiveVerifiedModels(-100, config, fetcher, 31_002)).length, 1);
  includeUser = false;
  invalidateVerifiedModelsCache(-100, config.supabaseUrl);
  assert.equal((await getActiveVerifiedModels(-100, config, fetcher, 31_003)).length, 0);
  assert.equal(calls, 4);
  clearVerifiedModelsCache();
});

test("catalog reader does not make a request when public Supabase credentials are absent", async () => {
  clearVerifiedModelsCache();
  let calls = 0;
  await assert.rejects(
    getActiveVerifiedModels(
      -100,
      {},
      async () => {
        calls += 1;
        return new Response("[]", { status: 200 });
      },
    ),
    /AFRODITA_SUPABASE_NOT_CONFIGURED/,
  );
  assert.equal(calls, 0);
});

test("profile verification bypasses cache and follows the server's persisted active state", async () => {
  clearVerifiedModelsCache();
  const config = {
    supabaseUrl: "https://example.supabase.co",
    supabaseKey: publicSupabaseTestKey,
  };
  let active = true;
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify(active
      ? [{
          group_id: -100,
          user_id: 123,
          display_name: "Ana",
          valid_until: "2020-01-01T00:00:00.000Z",
        }]
      : []), { status: 200 });
  };

  assert.equal(await isVerifiedCatalogUser(-100, 123, config, fetcher), true);
  active = false;
  assert.equal(await isVerifiedCatalogUser(-100, 123, config, fetcher), false);
  assert.equal(calls, 2);
  clearVerifiedModelsCache();
});

test("catalog reader surfaces authorization failures without returning cached success", async () => {
  clearVerifiedModelsCache();
  const config = {
    supabaseUrl: "https://example.supabase.co",
    supabaseKey: publicSupabaseTestKey,
  };
  for (const status of [401, 403]) {
    await assert.rejects(
      getActiveVerifiedModels(
        -100,
        config,
        async () => new Response("{}", { status }),
      ),
      new RegExp(`AFRODITA_SUPABASE_HTTP_${status}`),
    );
  }
});

test("catalog reader reports timeout and rejects a malformed RPC response", async () => {
  clearVerifiedModelsCache();
  const config = {
    supabaseUrl: "https://example.supabase.co",
    supabaseKey: publicSupabaseTestKey,
  };
  await assert.rejects(
    getActiveVerifiedModels(
      -100,
      config,
      (_input, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }),
      Date.now(),
      { timeoutMs: 5 },
    ),
    /AFRODITA_SUPABASE_TIMEOUT/,
  );
  await assert.rejects(
    getActiveVerifiedModels(
      -100,
      config,
      async () => new Response(JSON.stringify({ rows: [] }), { status: 200 }),
    ),
    /AFRODITA_SUPABASE_RESPONSE_INVALID/,
  );
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
    () => loadAfroditaConfig({
      AFRODITA_BOT_TOKEN: testBotToken,
      AFRODITA_SUPABASE_URL: "https://example.supabase.co",
    }),
    /requiere AFRODITA_SUPABASE_URL y AFRODITA_SUPABASE_KEY/,
  );
  assert.throws(
    () => loadAfroditaConfig({
      AFRODITA_BOT_TOKEN: testBotToken,
      AFRODITA_SUPABASE_URL: "http://remote.example",
      AFRODITA_SUPABASE_KEY: publicSupabaseTestKey,
    }),
    /debe usar HTTPS/,
  );
  assert.equal(
    loadAfroditaConfig({
      AFRODITA_BOT_TOKEN: testBotToken,
      AFRODITA_SUPABASE_URL: "https://example.supabase.co/",
      AFRODITA_SUPABASE_KEY: publicSupabaseTestKey,
    }).supabaseUrl,
    "https://example.supabase.co",
  );
  assert.throws(
    () => loadAfroditaConfig({
      AFRODITA_BOT_TOKEN: testBotToken,
      AFRODITA_SUPABASE_URL: "https://example.supabase.co",
      AFRODITA_SUPABASE_KEY: "service_role_test_key",
    }),
    /publishable o JWT anon/,
  );
  const anonJwt = [
    "header",
    Buffer.from(JSON.stringify({ role: "anon" })).toString("base64url"),
    "signature",
  ].join(".");
  assert.equal(
    loadAfroditaConfig({
      AFRODITA_BOT_TOKEN: testBotToken,
      AFRODITA_SUPABASE_URL: "https://example.supabase.co",
      AFRODITA_SUPABASE_KEY: anonJwt,
    }).supabaseKey,
    anonJwt,
  );
  assert.throws(
    () => loadAfroditaConfig({ AFRODITA_BOT_TOKEN: "malformed" }),
    /formato válido/,
  );
});
