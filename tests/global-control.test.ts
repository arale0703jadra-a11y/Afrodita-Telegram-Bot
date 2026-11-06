import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import type { AfroditaStore as StoreType } from "../src/store.js";
import type { AfroditaActivityControl as ActivityControlType } from "../src/activity-control.js";
import type { PublicationTrigger } from "../src/publications.js";

const testDataDirectory = await mkdtemp(
  join(tmpdir(), "afrodita-global-control-"),
);
after(async () => {
  await rm(testDataDirectory, { recursive: true, force: true });
});

interface RecordedCall {
  url: string;
  method: string;
  body?: unknown;
}

const recorded: RecordedCall[] = [];
let pendingCommands: unknown[] = [];
let globalMode: "running" | "paused" | undefined;
let globalHeartbeat: string | undefined;

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const method = init?.method ?? "GET";
  let body: unknown;
  if (typeof init?.body === "string") {
    try {
      body = JSON.parse(init.body);
    } catch {
      body = undefined;
    }
  }
  recorded.push({ url, method, ...(body !== undefined ? { body } : {}) });

  if (url.includes("/rest/v1/afrodita_control_state")) {
    if (method === "GET") {
      return jsonResponse(
        globalMode
          ? [
              {
                id: "global",
                mode: globalMode,
                updated_at: new Date().toISOString(),
                updated_by: "test",
                heartbeat_at: globalHeartbeat ?? new Date().toISOString(),
              },
            ]
          : [],
      );
    }
    if (method === "POST") {
      const state = body as { mode?: "running" | "paused"; heartbeat_at?: string };
      globalMode = state.mode;
      globalHeartbeat = state.heartbeat_at;
      return jsonResponse({});
    }
    if (method === "PATCH") {
      globalHeartbeat = (body as { heartbeat_at?: string }).heartbeat_at;
      return jsonResponse({});
    }
  }
  if (url.includes("/rest/v1/afrodita_group_state")) {
    return jsonResponse({}, 201);
  }
  if (url.includes("/rest/v1/afrodita_commands") && method === "GET") {
    return jsonResponse(pendingCommands);
  }
  if (url.includes("/rest/v1/afrodita_commands") && method === "PATCH") {
    return jsonResponse({});
  }
  if (url.includes("/rest/v1/afrodita_events")) {
    return jsonResponse([], 201);
  }
  return jsonResponse([]);
}) as typeof fetch;

const { AfroditaStore } = await import("../src/store.js");
const { startAfroditaIntegration } = await import("../src/integration.js");
const { AfroditaActivityControl } = await import("../src/activity-control.js");
const { PublicationScheduler, getDuePublications } = await import(
  "../src/scheduler.js"
);
const { reservePublication, finalizePublication } = await import(
  "../src/publications.js"
);
const { sweepLegacyBlocks } = await import("../src/global-resume.js");
const { publishCommunityReply } = await import("../src/publishers.js");
const { PUBLICATION_CATEGORIES } = await import("../src/types.js");
const { handleAdminMenuCallback } = await import("../src/admin-menu.js");

const FIXED_NOW = Date.UTC(2026, 9, 28, 12, 0, 0);

function startIntegration(store: StoreType, control: ActivityControlType) {
  return startAfroditaIntegration({
    store,
    activityControl: control,
    config: {
      supabaseUrl: "https://example.supabase.co",
      supabaseKey: "sb_publishable_dummy",
    },
    fetcher: fakeFetch,
    intervalMs: 60_000,
  });
}

async function seedLegacyBlockedGroup(
  store: StoreType,
  chatId: number,
): Promise<void> {
  await store.setEnabled(chatId, false);
  await store.updateGroup(chatId, (state) => {
    state.activityPaused = true;
    for (const category of PUBLICATION_CATEGORIES) {
      const settings = state.publications[category];
      settings.enabled = false;
      settings.scheduledEnabled = false;
      settings.activityEnabled = false;
    }
    return true;
  });
}

async function configureDueCommercialPoll(
  store: StoreType,
  chatId: number,
): Promise<void> {
  await store.updateGroup(chatId, (state) => {
    state.timeZone = "UTC";
    // Dejar SOLO la ranura comercial vencida: el resto de categorías no
    // tiene horarios en el instante de prueba.
    for (const category of PUBLICATION_CATEGORIES) {
      if (category !== "commercial_poll") {
        state.publications[category].scheduleTimes = [];
      }
    }
    return true;
  });
  await store.updatePublicationSettings(
    chatId,
    "commercial_poll",
    (settings) => {
      settings.scheduleTimes = ["12:00"];
      settings.nextScheduledAt = FIXED_NOW;
      settings.lastPublishedAt = 0;
      settings.publishedToday = 0;
      settings.utcDay = "";
      settings.minIntervalMs = 60_000;
      settings.maxPerDay = 3;
    },
  );
}

test("1. con el control global en pausa ninguna función ejecuta actividades", async () => {
  const store = new AfroditaStore(testDataDirectory);
  const control = new AfroditaActivityControl("paused");
  const chatId = -100900001;
  await store.setEnabled(chatId, true);

  for (const category of PUBLICATION_CATEGORIES) {
    const reservation = await reservePublication(
      store,
      chatId,
      category,
      { kind: "activity" },
      () => control.isRunning(),
      FIXED_NOW,
    );
    assert.equal(
      reservation,
      undefined,
      `${category} no debe reservar con el control en pausa`,
    );
  }
  const state = await store.loadGroup(chatId);
  for (const category of PUBLICATION_CATEGORIES) {
    assert.equal(
      state.publications[category].history.length,
      0,
      `${category} no debe dejar historial en pausa`,
    );
  }

  await configureDueCommercialPoll(store, chatId);
  const due = getDuePublications(chatId, await store.loadGroup(chatId), FIXED_NOW);
  assert.equal(due.length, 1, "la ranura debe estar vencida para el caso de prueba");
  let published = 0;
  const scheduler = new PublicationScheduler(
    store,
    async () => {
      published += 1;
      return true;
    },
    () => undefined,
    () => FIXED_NOW - 120_000,
    () => control.isRunning(),
  );
  await scheduler.tick(FIXED_NOW);
  assert.equal(published, 0, "el worker no puede ignorar el estado global pausado");
  scheduler.stop();
});

test("2. al reanudar, todos los grupos registrados quedan habilitados", async () => {
  globalMode = "paused";
  globalHeartbeat = undefined;
  const store = new AfroditaStore(testDataDirectory);
  const control = new AfroditaActivityControl("paused");
  const groups = [-100900011, -100900012, -100900013];
  for (const chatId of groups) {
    await seedLegacyBlockedGroup(store, chatId);
  }
  await store.updatePublicationSettings(
    -100900011,
    "commercial_poll",
    (settings) => {
      settings.scheduleTimes = ["09:00", "18:00"];
      settings.publishedToday = 2;
    },
  );
  await store.updateGroup(-100900011, (state) => {
    state.publications.commercial_poll.history.push({
      id: "keep-history-1",
      at: FIXED_NOW,
      status: "published",
    });
    return true;
  });

  pendingCommands = [
    { id: 501, chat_id: 0, command: "resume", payload: { scope: "global" } },
  ];
  const handle = startIntegration(store, control);
  try {
    await handle.syncNow();

    assert.equal(globalMode, "running", "el ejecutor persiste running");
    assert.equal(control.isRunning(), true, "el ejecutor confirma running");
    for (const chatId of groups) {
      const state = await store.loadGroup(chatId);
      assert.equal(state.enabled, true, `grupo ${chatId} habilitado`);
      assert.equal(state.activityPaused, false, `grupo ${chatId} sin pausa`);
      for (const category of PUBLICATION_CATEGORIES) {
        const settings = state.publications[category];
        assert.equal(settings.enabled, true, `${chatId}/${category} enabled`);
        assert.equal(
          settings.scheduledEnabled,
          true,
          `${chatId}/${category} scheduledEnabled`,
        );
        assert.equal(
          settings.activityEnabled,
          true,
          `${chatId}/${category} activityEnabled`,
        );
      }
    }
    const kept = await store.loadGroup(-100900011);
    assert.deepEqual(
      kept.publications.commercial_poll.scheduleTimes,
      ["09:00", "18:00"],
      "los horarios funcionales se conservan",
    );
    assert.equal(kept.publications.commercial_poll.publishedToday, 2);
    assert.equal(kept.publications.commercial_poll.history.length, 1);
    const mark = recorded.find(
      (call) => call.method === "PATCH" && call.url.includes("afrodita_commands"),
    );
    assert.equal(
      (mark?.body as { status?: string } | undefined)?.status,
      "applied",
      "la orden solo se confirma tras aplicar el barrido",
    );
  } finally {
    handle.stop();
    pendingCommands = [];
  }
});

test("2b. arrancar con el control global aprobado en running limpia los bloqueos heredados", async () => {
  globalMode = "running";
  globalHeartbeat = undefined;
  const store = new AfroditaStore(testDataDirectory);
  const control = new AfroditaActivityControl("paused"); // arranque: sin reanudación automática
  const chatId = -100900014;
  await seedLegacyBlockedGroup(store, chatId);
  pendingCommands = [];
  const handle = startIntegration(store, control);
  try {
    assert.equal(control.isRunning(), false, "el proceso arranca pausado");
    await handle.syncNow();
    assert.equal(control.isRunning(), true, "adopta el estado global aprobado");
    const state = await store.loadGroup(chatId);
    assert.equal(state.enabled, true, "bloqueo heredado normalizado");
    assert.equal(state.activityPaused, false);
  } finally {
    handle.stop();
  }
});

test("3. los bloqueos individuales antiguos no impiden la ejecución", async () => {
  const store = new AfroditaStore(testDataDirectory);
  const chatId = -100900021;
  await seedLegacyBlockedGroup(store, chatId);
  const control = new AfroditaActivityControl("running");
  await configureDueCommercialPoll(store, chatId);

  const due = getDuePublications(chatId, await store.loadGroup(chatId), FIXED_NOW);
  assert.equal(due.length, 1, "la ranura vencida no debe quedar bloqueada por flags heredados");
  const reservation = await reservePublication(
    store,
    chatId,
    "commercial_poll",
    { kind: "scheduled", slotKey: "legacy:test" },
    () => control.isRunning(),
    FIXED_NOW,
  );
  assert.ok(reservation, "la reserva no debe quedar bloqueada por flags heredados");

  const sweep = await sweepLegacyBlocks(store);
  assert.ok(sweep.changed >= 1, "el barrido debe normalizar el grupo");
  const state = await store.loadGroup(chatId);
  assert.equal(state.enabled, true);
  assert.equal(state.activityPaused, false);
  for (const category of PUBLICATION_CATEGORIES) {
    assert.equal(state.publications[category].enabled, true);
  }
});

test("4. publicaciones, encuestas, menciones y promociones respetan el estado global", async () => {
  const store = new AfroditaStore(testDataDirectory);
  const control = new AfroditaActivityControl("running");
  const cases: Array<{
    category: (typeof PUBLICATION_CATEGORIES)[number];
    trigger: PublicationTrigger;
    slotKey: string;
  }> = [
    { category: "commercial_poll", trigger: { kind: "scheduled", slotKey: "poll:open" }, slotKey: "poll:close" },
    { category: "seasonal_campaign", trigger: { kind: "scheduled", slotKey: "seasonal:open" }, slotKey: "seasonal:close" },
    { category: "verified_promotion", trigger: { kind: "activity" }, slotKey: "unused" },
    { category: "community_reply", trigger: { kind: "activity", userId: 77 }, slotKey: "unused" },
  ];
  for (const { category, trigger, slotKey } of cases) {
    const chatId = -100900031 - cases.indexOf(cases.find((c) => c.category === category)!);
    await store.setEnabled(chatId, true);
    const open = await reservePublication(
      store,
      chatId,
      category,
      trigger,
      () => control.isRunning(),
      FIXED_NOW,
    );
    assert.ok(open, `${category} debe reservar con el control running`);
    await finalizePublication(store, open, "published", FIXED_NOW);

    control.setState("paused");
    const closedTrigger: PublicationTrigger =
      trigger.kind === "scheduled"
        ? { kind: "scheduled", slotKey }
        : {
            kind: "activity",
            ...(trigger.userId !== undefined ? { userId: trigger.userId } : {}),
          };
    const closed = await reservePublication(
      store,
      chatId,
      category,
      closedTrigger,
      () => control.isRunning(),
      FIXED_NOW + 60_000,
    );
    assert.equal(closed, undefined, `${category} debe bloquear con el control en pausa`);
    control.setState("running");
  }

  // Menciones (respuesta comunitaria) con el publisher también bloqueadas.
  control.setState("paused");
  let sent = 0;
  const replied = await publishCommunityReply(
    async () => {
      sent += 1;
    },
    store,
    -100900039,
    88,
    undefined,
    () => control.isRunning(),
  );
  assert.equal(replied, false, "la respuesta comunitaria respeta la pausa global");
  assert.equal(sent, 0, "no debe enviarse ningún mensaje en pausa");
});

test("5. al pausar globalmente todas las funciones se detienen", async () => {
  const directory = await mkdtemp(join(tmpdir(), "afrodita-t5-"));
  try {
    const store = new AfroditaStore(directory);
    const control = new AfroditaActivityControl("running");
    const chatId = -100900041;
    await store.setEnabled(chatId, true);
    await configureDueCommercialPoll(store, chatId);
    let published = 0;
    const scheduler = new PublicationScheduler(
      store,
      async () => {
        published += 1;
        return true;
      },
      () => undefined,
      () => FIXED_NOW - 120_000,
      () => control.isRunning(),
    );

    await scheduler.tick(FIXED_NOW);
    assert.equal(published, 1, "con el control activo el worker publica la ranura vencida");

    control.setState("paused");
    await scheduler.tick(FIXED_NOW);
    assert.equal(published, 1, "al pausar, el worker se detiene de inmediato");

    const reservation = await reservePublication(
      store,
      chatId,
      "commercial_poll",
      { kind: "activity" },
      () => control.isRunning(),
      FIXED_NOW + 120_000,
    );
    assert.equal(reservation, undefined, "ninguna reserva nueva durante la pausa");
    scheduler.stop();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("6. ningún worker puede ignorar el estado global", async () => {
  const store = new AfroditaStore(testDataDirectory);
  const control = new AfroditaActivityControl("paused");
  const chatId = -100900045;
  await store.setEnabled(chatId, true);

  // reservePublication exige el estado global como parámetro y lo obedece.
  const blocked = await reservePublication(
    store,
    chatId,
    "community_reply",
    { kind: "activity", userId: 42 },
    () => control.isRunning(),
    FIXED_NOW,
  );
  assert.equal(blocked, undefined);

  // El publisher de menciones con el gate cerrado no reserva ni envía.
  let sent = 0;
  const ok = await publishCommunityReply(
    async () => {
      sent += 1;
    },
    store,
    chatId,
    42,
    undefined,
    () => control.isRunning(),
  );
  assert.equal(ok, false);
  assert.equal(sent, 0);
  const state = await store.loadGroup(chatId);
  assert.equal(
    state.publications.community_reply.history.length,
    0,
    "sin reserva no hay rastro de actividad",
  );

  // El scheduler con canPublish global no publica aunque la ranura esté vencida.
  await configureDueCommercialPoll(store, chatId);
  let published = 0;
  const scheduler = new PublicationScheduler(
    store,
    async () => {
      published += 1;
      return true;
    },
    () => undefined,
    () => FIXED_NOW - 120_000,
    () => control.isRunning(),
  );
  const due = getDuePublications(chatId, await store.loadGroup(chatId), FIXED_NOW);
  assert.equal(due.length, 1, "precondición: ranura vencida");
  await scheduler.tick(FIXED_NOW);
  assert.equal(published, 0, "el scheduler obedece el gate global");
  scheduler.stop();
});

test("7. los cambios de estado son idempotentes", async () => {
  globalMode = "paused";
  globalHeartbeat = undefined;
  const store = new AfroditaStore(testDataDirectory);
  const control = new AfroditaActivityControl("paused");
  const chatId = -100900051;
  await seedLegacyBlockedGroup(store, chatId);
  await store.updatePublicationSettings(
    chatId,
    "commercial_poll",
    (settings) => {
      settings.publishedToday = 2;
      settings.scheduleTimes = ["10:00"];
    },
  );
  await store.updateGroup(chatId, (state) => {
    state.publications.commercial_poll.history.push({
      id: "h-keep",
      at: FIXED_NOW,
      status: "published",
    });
    return true;
  });

  const sweep1 = await sweepLegacyBlocks(store);
  const sweep2 = await sweepLegacyBlocks(store);
  assert.ok(sweep1.changed >= 1, "el primer barrido normaliza");
  assert.equal(sweep2.changed, 0, "el segundo barrido no cambia nada");

  pendingCommands = [
    { id: 601, chat_id: 0, command: "resume", payload: { scope: "global" } },
  ];
  const firstHandle = startIntegration(store, control);
  try {
    await firstHandle.syncNow();
  } finally {
    firstHandle.stop();
  }
  const afterFirst = JSON.stringify(await store.loadGroup(chatId));

  pendingCommands = [
    { id: 602, chat_id: 0, command: "resume", payload: { scope: "global" } },
  ];
  const secondHandle = startIntegration(store, control);
  try {
    await secondHandle.syncNow();
  } finally {
    secondHandle.stop();
    pendingCommands = [];
  }
  const afterSecond = JSON.stringify(await store.loadGroup(chatId));

  assert.equal(afterFirst, afterSecond, "reanudar dos veces produce el mismo estado");
  const state = await store.loadGroup(chatId);
  assert.equal(
    state.publications.commercial_poll.publishedToday,
    2,
    "los contadores diarios no se reinician",
  );
  assert.equal(
    state.publications.commercial_poll.history.length,
    1,
    "el historial no se duplica",
  );
  assert.equal(globalMode, "running");
  assert.equal(control.isRunning(), true);
});

test("9. no se producen ejecuciones duplicadas al reanudar", async () => {
  const directory = await mkdtemp(join(tmpdir(), "afrodita-t9-"));
  try {
    const store = new AfroditaStore(directory);
    const control = new AfroditaActivityControl("paused");
    const chatId = -100900061;
    await store.setEnabled(chatId, true);
    await configureDueCommercialPoll(store, chatId);
    let published = 0;
    const scheduler = new PublicationScheduler(
      store,
      async (job) => {
        published += 1;
        await store.updatePublicationSettings(job.chatId, job.category, (s) => {
          s.lastScheduledKey = job.slotKey;
          s.publishedToday += 1;
          s.lastPublishedAt = FIXED_NOW;
        });
        return true;
      },
      () => undefined,
      () => FIXED_NOW - 120_000,
      () => control.isRunning(),
    );

    control.setState("running");
    await scheduler.tick(FIXED_NOW);
    assert.equal(published, 1, "con running se publica la ranura vencida");
    await scheduler.tick(FIXED_NOW);
    assert.equal(published, 1, "la misma ranura no se publica dos veces");

    control.setState("paused");
    await scheduler.tick(FIXED_NOW);
    assert.equal(published, 1, "la pausa detiene el worker");

    control.setState("running");
    await scheduler.tick(FIXED_NOW);
    assert.equal(
      published,
      1,
      "reanudar no reejecuta ranuras ya publicadas (rebase a la próxima ventana)",
    );
    scheduler.stop();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("10. AFRODITA no ofrece botones individuales de pausa/reanudación", async () => {
  const store = new AfroditaStore(testDataDirectory);
  const chatId = -100900071;
  await seedLegacyBlockedGroup(store, chatId);

  // Un clic obsoleto del botón individual no cambia ningún estado.
  const before = JSON.stringify(await store.loadGroup(chatId));
  const answers: string[] = [];
  const callbackCtx = {
    callbackQuery: { data: "af:toggle:all" },
    chat: { id: chatId, type: "group" },
    answerCallbackQuery: async (options: { text?: string }) => {
      answers.push(options.text ?? "");
    },
  } as never;
  await handleAdminMenuCallback(callbackCtx, store);
  assert.equal(answers.length, 1);
  assert.ok(
    answers[0]?.includes("ZEUS"),
    "el clic debe redirigir al panel de ZEUS",
  );
  const after = JSON.stringify(await store.loadGroup(chatId));
  assert.equal(after, before, "el clic obsoleto no modifica ningún estado");
  const state = await store.loadGroup(chatId);
  assert.equal(state.enabled, false, "el flag heredado sigue intacto");

  // El comando /menu responde solo texto, sin teclado con toggles.
  const replies: Array<{ text: string; options?: unknown }> = [];
  const menuCtx = {
    chat: { id: chatId, type: "group" },
    reply: async (text: string, options?: unknown) => {
      replies.push({ text, ...(options !== undefined ? { options } : {}) });
      return { message_id: 1 };
    },
  } as never;
  const { showAdminMenu } = await import("../src/admin-menu.js");
  await showAdminMenu(menuCtx, store);
  assert.equal(replies.length, 1);
  assert.ok(replies[0]?.text.includes("ZEUS"));
  assert.equal(
    replies[0]?.options,
    undefined,
    "sin teclado: no existen botones individuales",
  );
});
