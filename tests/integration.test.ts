import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const testDataDirectory = await mkdtemp(join(tmpdir(), "afrodita-integration-"));
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
let failStatePush = false;

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

  if (url.includes("/rest/v1/afrodita_group_state")) {
    if (failStatePush) {
      return new Response("boom", { status: 500 });
    }
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

const GROUP_ID = -100777001;

test("sin variables Supabase la integración queda desactivada", async () => {
  const store = new AfroditaStore(testDataDirectory);
  const handle = startAfroditaIntegration({
    store,
    config: {},
    fetcher: fakeFetch,
    intervalMs: 60_000,
  });
  assert.equal(handle.enabled, false);
  recorded.length = 0;
  await handle.syncNow();
  assert.equal(recorded.length, 0, "no debe tocar la red sin configuración");
  handle.stop();
});

test("sync publica el estado del grupo y aplica órdenes de ZEUS", async () => {
  const store = new AfroditaStore(testDataDirectory);
  await store.setEnabled(GROUP_ID, true);

  pendingCommands = [
    { id: 11, chat_id: GROUP_ID, command: "pause", payload: {} },
  ];
  recorded.length = 0;
  const handle = startAfroditaIntegration({
    store,
    config: {
      supabaseUrl: "https://example.supabase.co",
      supabaseKey: "sb_publishable_dummy",
    },
    fetcher: fakeFetch,
    intervalMs: 60_000,
  });
  try {
    await handle.syncNow();

    const statePush = recorded.find(
      (call) =>
        call.method === "POST" && call.url.includes("afrodita_group_state"),
    );
    assert.ok(statePush, "debe publicarse el estado del grupo");
    assert.equal(
      (statePush?.body as { chat_id?: number } | undefined)?.chat_id,
      GROUP_ID,
    );

    const stateAfterPause = await store.loadGroup(GROUP_ID);
    assert.equal(stateAfterPause.enabled, false, "la orden pause se aplica");

    const mark = recorded.find(
      (call) =>
        call.method === "PATCH" && call.url.includes("afrodita_commands"),
    );
    assert.ok(mark, "la orden debe marcarse como aplicada");
    assert.equal(
      (mark?.body as { status?: string } | undefined)?.status,
      "applied",
    );
  } finally {
    handle.stop();
  }
});

test("las publicaciones nuevas generan eventos para el historial", async () => {
  const store = new AfroditaStore(testDataDirectory);
  pendingCommands = [];
  recorded.length = 0;
  const handle = startAfroditaIntegration({
    store,
    config: {
      supabaseUrl: "https://example.supabase.co",
      supabaseKey: "sb_publishable_dummy",
    },
    fetcher: fakeFetch,
    intervalMs: 60_000,
  });
  try {
    // Primera sync: solo línea base, sin eventos.
    await handle.syncNow();
    let eventsPush = recorded.find(
      (call) => call.method === "POST" && call.url.includes("afrodita_events"),
    );
    assert.equal(eventsPush, undefined, "la primera sync no emite eventos");

    // Nueva publicación en el historial del grupo.
    await store.updatePublicationSettings(
      GROUP_ID,
      "commercial_poll",
      (settings) => {
        settings.history.push({
          id: "pub-1",
          at: Date.now(),
          status: "published",
        });
      },
    );
    recorded.length = 0;
    await handle.syncNow();
    eventsPush = recorded.find(
      (call) => call.method === "POST" && call.url.includes("afrodita_events"),
    );
    assert.ok(eventsPush, "la publicación nueva debe emitir eventos");
    const events = eventsPush?.body as Array<{
      kind: string;
      payload: Record<string, unknown>;
    }>;
    const publication = events.find((event) => event.kind === "publication");
    assert.ok(publication, "debe existir el evento publication");
    assert.equal(publication?.payload.category, "commercial_poll");
    assert.equal(publication?.payload.entryId, "pub-1");
  } finally {
    handle.stop();
  }
});

test("una orden inválida se marca como failed sin romper la sync", async () => {
  const store = new AfroditaStore(testDataDirectory);
  pendingCommands = [
    {
      id: 12,
      chat_id: GROUP_ID,
      command: "set_category",
      payload: { category: "no_existe", field: "enabled", value: true },
    },
  ];
  recorded.length = 0;
  const handle = startAfroditaIntegration({
    store,
    config: {
      supabaseUrl: "https://example.supabase.co",
      supabaseKey: "sb_publishable_dummy",
    },
    fetcher: fakeFetch,
    intervalMs: 60_000,
  });
  try {
    await handle.syncNow();
    const mark = recorded.find(
      (call) =>
        call.method === "PATCH" && call.url.includes("afrodita_commands"),
    );
    assert.ok(mark, "la orden inválida debe marcarse");
    assert.equal(
      (mark?.body as { status?: string } | undefined)?.status,
      "failed",
    );
  } finally {
    handle.stop();
    pendingCommands = [];
  }
});

test("set_category activa y pausa categorías desde órdenes de ZEUS", async () => {
  const store = new AfroditaStore(testDataDirectory);
  pendingCommands = [
    {
      id: 13,
      chat_id: GROUP_ID,
      command: "set_category",
      payload: { category: "verified_promotion", field: "enabled", value: false },
    },
  ];
  recorded.length = 0;
  const handle = startAfroditaIntegration({
    store,
    config: {
      supabaseUrl: "https://example.supabase.co",
      supabaseKey: "sb_publishable_dummy",
    },
    fetcher: fakeFetch,
    intervalMs: 60_000,
  });
  try {
    await handle.syncNow();
    const state = await store.loadGroup(GROUP_ID);
    assert.equal(state.publications.verified_promotion.enabled, false);
    const mark = recorded.find(
      (call) =>
        call.method === "PATCH" && call.url.includes("afrodita_commands"),
    );
    assert.equal(
      (mark?.body as { status?: string } | undefined)?.status,
      "applied",
    );
  } finally {
    handle.stop();
    pendingCommands = [];
  }
});

test("un fallo de red en la publicación no detiene la sincronización", async () => {
  const store = new AfroditaStore(testDataDirectory);
  pendingCommands = [];
  failStatePush = true;
  recorded.length = 0;
  const handle = startAfroditaIntegration({
    store,
    config: {
      supabaseUrl: "https://example.supabase.co",
      supabaseKey: "sb_publishable_dummy",
    },
    fetcher: fakeFetch,
    intervalMs: 60_000,
  });
  try {
    await assert.doesNotReject(() => handle.syncNow());
  } finally {
    failStatePush = false;
    handle.stop();
  }
});
