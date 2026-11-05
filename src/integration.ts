import type { AfroditaConfig } from "./config.js";
import { safeErrorSummary, safeErrorType } from "./errors.js";
import {
  AfroditaActivityControl,
  type GlobalActivityState,
} from "./activity-control.js";
import type { AfroditaStore } from "./store.js";
import {
  PUBLICATION_CATEGORIES,
  type AfroditaState,
  type PublicationCategory,
} from "./types.js";

/**
 * Integración AFRODITA ↔ ZEUS mediante Supabase/PostgreSQL.
 *
 * - Publica una instantánea del estado por grupo en `afrodita_group_state`.
 * - Registra eventos de publicación y encuesta en `afrodita_events`.
 * - Aplica órdenes de ZEUS leídas de `afrodita_commands`
 *   (pausar, reanudar, ajustes de categoría).
 *
 * Sin AFRODITA_SUPABASE_URL/AFRODITA_SUPABASE_KEY el módulo se desactiva y
 * AFRODITA sigue operando de forma autónoma (estado local en disco).
 * Todos los fallos de red se registran de forma segura y nunca detienen el bot.
 */

const DEFAULT_INTERVAL_MS = 60_000;
const MAX_JITTER_MS = 15_000;
const COMMAND_PAGE_LIMIT = 25;
const EVENT_BATCH_LIMIT = 25;
const ERROR_LOG_THROTTLE_MS = 10 * 60_000;

const TOGGLEABLE_FIELDS = [
  "enabled",
  "scheduledEnabled",
  "activityEnabled",
] as const;
type ToggleableField = (typeof TOGGLEABLE_FIELDS)[number];

export interface AfroditaIntegrationOptions {
  store: AfroditaStore;
  config: Pick<AfroditaConfig, "supabaseUrl" | "supabaseKey">;
  activityControl?: AfroditaActivityControl;
  fetcher?: typeof fetch;
  intervalMs?: number;
  now?: () => number;
}

export interface AfroditaIntegrationHandle {
  readonly enabled: boolean;
  syncNow(): Promise<void>;
  stop(): void;
}

interface PendingCommand {
  id: number;
  chat_id: number;
  command: string;
  payload: Record<string, unknown>;
}

interface GroupFingerprint {
  historyIds: Set<string>;
  pollCount: number;
}

interface NewEvent {
  chatId: number;
  kind: "publication" | "poll";
  payload: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fingerprintOf(state: AfroditaState): GroupFingerprint {
  const historyIds = new Set<string>();
  for (const settings of Object.values(state.publications)) {
    for (const entry of settings.history) historyIds.add(entry.id);
  }
  return { historyIds, pollCount: state.pollCount };
}

function deriveNewEvents(
  chatId: number,
  previous: GroupFingerprint | undefined,
  state: AfroditaState,
): NewEvent[] {
  if (!previous) return [];
  const events: NewEvent[] = [];
  for (const [category, settings] of Object.entries(state.publications)) {
    for (const entry of settings.history) {
      if (previous.historyIds.has(entry.id)) continue;
      events.push({
        chatId,
        kind: "publication",
        payload: {
          category,
          entryId: entry.id,
          at: entry.at,
          status: entry.status,
          ...(entry.subjectId !== undefined ? { subjectId: entry.subjectId } : {}),
        },
      });
    }
  }
  if (state.pollCount > previous.pollCount) {
    events.push({
      chatId,
      kind: "poll",
      payload: {
        pollCount: state.pollCount,
        lastPollTopic: state.lastPollTopic,
        lastPollAt: state.lastPollAt,
        votes: state.pollVotes,
      },
    });
  }
  return events.slice(-EVENT_BATCH_LIMIT);
}

function validCategory(value: unknown): value is PublicationCategory {
  return (
    typeof value === "string" &&
    (PUBLICATION_CATEGORIES as readonly string[]).includes(value)
  );
}

function validToggleField(value: unknown): value is ToggleableField {
  return (
    typeof value === "string" &&
    (TOGGLEABLE_FIELDS as readonly string[]).includes(value)
  );
}

/**
 * Aplica una orden de ZEUS al estado local. Lanza error si la orden no es
 * válida; el llamador la marca como `failed` sin reintentos.
 */
async function applyCommand(
  store: AfroditaStore,
  activityControl: AfroditaActivityControl,
  writeGlobalState: (state: GlobalActivityState) => Promise<void>,
  chatId: number,
  command: PendingCommand,
): Promise<void> {
  const payload = command.payload;
  if (
    (command.command === "pause" || command.command === "resume") &&
    payload.scope === "global"
  ) {
    const state = command.command === "pause" ? "paused" : "running";
    await writeGlobalState(state);
    activityControl.setState(state);
    return;
  }
  if (command.command === "pause") {
    await store.setEnabled(chatId, false);
    return;
  }
  if (command.command === "resume") {
    await store.setEnabled(chatId, true);
    return;
  }
  if (command.command === "set_category") {
    const category = payload.category;
    const field = payload.field;
    const value = payload.value;
    if (!validCategory(category) || !validToggleField(field) || typeof value !== "boolean") {
      throw new Error("AFRODITA_COMMAND_PAYLOAD_INVALID");
    }
    await store.updatePublicationSettings(chatId, category, (settings) => {
      settings[field] = value;
    });
    return;
  }
  throw new Error("AFRODITA_COMMAND_UNKNOWN");
}

export function startAfroditaIntegration(
  options: AfroditaIntegrationOptions,
): AfroditaIntegrationHandle {
  const {
    store,
    activityControl = new AfroditaActivityControl("paused"),
    config,
    fetcher = fetch,
    intervalMs = DEFAULT_INTERVAL_MS,
    now = Date.now,
  } = options;
  const url = config.supabaseUrl?.replace(/\/+$/u, "");
  const key = config.supabaseKey;

  if (!url || !key) {
    activityControl.setState("paused");
    console.warn(
      "[AFRODITA] Integración Supabase desactivada: faltan " +
        "AFRODITA_SUPABASE_URL/AFRODITA_SUPABASE_KEY. La actividad automática " +
        "queda pausada hasta disponer del control persistente.",
    );
    return {
      enabled: false,
      syncNow: async () => undefined,
      stop: () => undefined,
    };
  }

  const headers: Record<string, string> = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
  const fingerprints = new Map<number, GroupFingerprint>();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let lastErrorLogAt = 0;

  const logError = (message: string): void => {
    const timestamp = now();
    if (timestamp - lastErrorLogAt < ERROR_LOG_THROTTLE_MS) return;
    lastErrorLogAt = timestamp;
    console.error(message);
  };

  async function rest(
    method: string,
    path: string,
    body?: unknown,
    prefer = "return=minimal",
  ): Promise<Response> {
    const init: RequestInit = { method, headers: { ...headers } };
    if (body !== undefined) {
      init.headers = { ...headers, Prefer: prefer };
      init.body = JSON.stringify(body);
    }
    return fetcher(`${url}/rest/v1/${path}`, init);
  }

  async function pushState(chatId: number, state: AfroditaState): Promise<void> {
    const response = await rest(
      "POST",
      "afrodita_group_state?on_conflict=chat_id",
      { chat_id: chatId, state, updated_by: "afrodita" },
    );
    if (!response.ok) {
      throw new Error(`AFRODITA_STATE_PUSH_HTTP_${response.status}`);
    }
  }

  async function pushEvents(events: NewEvent[]): Promise<void> {
    if (events.length === 0) return;
    const response = await rest(
      "POST",
      "afrodita_events",
      events.map((event) => ({
        chat_id: event.chatId,
        kind: event.kind,
        payload: event.payload,
      })),
    );
    if (!response.ok) {
      throw new Error(`AFRODITA_EVENTS_PUSH_HTTP_${response.status}`);
    }
  }

  async function fetchPendingCommands(): Promise<PendingCommand[]> {
    const response = await rest(
      "GET",
      `afrodita_commands?status=eq.pending&order=id.asc&limit=${COMMAND_PAGE_LIMIT}`,
    );
    if (!response.ok) {
      throw new Error(`AFRODITA_COMMANDS_READ_HTTP_${response.status}`);
    }
    const rows: unknown = await response.json();
    if (!Array.isArray(rows)) return [];
    return rows.flatMap((row) => {
      if (!isRecord(row)) return [];
      const id = row.id;
      const chatId = row.chat_id;
      const command = row.command;
      if (
        typeof id !== "number" ||
        typeof chatId !== "number" ||
        typeof command !== "string"
      ) {
        return [];
      }
      return [
        {
          id,
          chat_id: chatId,
          command,
          payload: isRecord(row.payload) ? row.payload : {},
        },
      ];
    });
  }

  async function readGlobalControl(): Promise<GlobalActivityState | undefined> {
    const response = await rest(
      "GET",
      "afrodita_control_state?id=eq.global&select=id,mode",
    );
    if (!response.ok) {
      throw new Error(`AFRODITA_CONTROL_READ_HTTP_${response.status}`);
    }
    const rows: unknown = await response.json();
    if (!Array.isArray(rows) || rows.length === 0) return undefined;
    const row = rows[0];
    if (
      !isRecord(row) ||
      row.id !== "global" ||
      (row.mode !== "running" && row.mode !== "paused")
    ) {
      throw new Error("AFRODITA_CONTROL_STATE_INVALID");
    }
    return row.mode;
  }

  async function writeGlobalState(state: GlobalActivityState): Promise<void> {
    const response = await rest(
      "POST",
      "afrodita_control_state?on_conflict=id",
      {
        id: "global",
        mode: state,
        updated_at: new Date(now()).toISOString(),
        updated_by: "afrodita",
        heartbeat_at: new Date(now()).toISOString(),
      },
      "resolution=merge-duplicates,return=minimal",
    );
    if (!response.ok) {
      throw new Error(`AFRODITA_CONTROL_WRITE_HTTP_${response.status}`);
    }
  }

  async function touchGlobalHeartbeat(): Promise<void> {
    const response = await rest(
      "PATCH",
      "afrodita_control_state?id=eq.global",
      { heartbeat_at: new Date(now()).toISOString() },
    );
    if (!response.ok) {
      throw new Error(`AFRODITA_HEARTBEAT_HTTP_${response.status}`);
    }
  }

  async function markCommand(
    command: PendingCommand,
    status: "applied" | "failed",
    error?: unknown,
  ): Promise<void> {
    const body: Record<string, unknown> = {
      status,
    };
    if (status === "applied") {
      body.applied_at = new Date(now()).toISOString();
    } else {
      const code = error instanceof Error ? error.message : "";
      body.last_error = /^[A-Z][A-Z0-9_]{0,120}$/u.test(code)
        ? code
        : error
          ? safeErrorType(error)
          : "unknown";
    }
    const response = await rest(
      "PATCH",
      `afrodita_commands?id=eq.${command.id}`,
      body,
    );
    if (!response.ok) {
      throw new Error(`AFRODITA_COMMAND_MARK_HTTP_${response.status}`);
    }
  }

  async function syncGroup(chatId: number, events: NewEvent[]): Promise<void> {
    const state = await store.loadGroup(chatId);
    const previous = fingerprints.get(chatId);
    events.push(...deriveNewEvents(chatId, previous, state));
    await pushState(chatId, state);
    fingerprints.set(chatId, fingerprintOf(state));
  }

  async function runOnce(): Promise<void> {
    let commands: PendingCommand[] = [];
    let commandFetchOk = true;
    try {
      commands = await fetchPendingCommands();
    } catch (error) {
      commandFetchOk = false;
      activityControl.setState("paused");
      logError(
        `[AFRODITA] No se pudieron consultar órdenes de ZEUS (${safeErrorSummary(error)}).`,
      );
    }
    const globalCommands = commands.filter(
      (command) =>
        (command.command === "pause" || command.command === "resume") &&
        command.payload.scope === "global",
    );
    if (globalCommands.length > 0) {
      activityControl.setState("paused");
    } else if (commandFetchOk) {
      try {
        const globalState = await readGlobalControl();
        activityControl.setState(globalState ?? "paused");
        if (globalState === undefined) {
          try {
            await writeGlobalState("paused");
          } catch (error) {
            logError(
              `[AFRODITA] No se pudo inicializar el control global (${safeErrorSummary(error)}).`,
            );
          }
        }
      } catch (error) {
        activityControl.setState("paused");
        logError(
          `[AFRODITA] No se pudo leer el control global (${safeErrorSummary(error)}).`,
        );
      }
    }

    const events: NewEvent[] = [];
    let groupIds: number[] = [];
    try {
      groupIds = await store.listGroupIds();
    } catch (error) {
      logError(
        `[AFRODITA] No se pudieron enumerar grupos para sincronizar (${safeErrorSummary(error)}).`,
      );
    }
    for (const chatId of groupIds) {
      try {
        await syncGroup(chatId, events);
      } catch (error) {
        logError(
          `[AFRODITA] No se pudo sincronizar el estado groupId=${chatId} ` +
            `(${safeErrorSummary(error)}).`,
        );
      }
    }
    try {
      await pushEvents(events);
    } catch (error) {
      logError(
        `[AFRODITA] No se pudieron sincronizar eventos (${safeErrorSummary(error)}).`,
      );
    }

    for (const command of commands) {
      try {
        await applyCommand(
          store,
          activityControl,
          writeGlobalState,
          command.chat_id,
          command,
        );
      } catch (error) {
        logError(
          `[AFRODITA] No se pudo aplicar la orden de ZEUS id=${command.id} ` +
            `command=${command.command} (${safeErrorSummary(error)}).`,
        );
        try {
          await markCommand(command, "failed", error);
        } catch (markError) {
          logError(
            `[AFRODITA] No se pudo marcar la orden id=${command.id} ` +
              `(${safeErrorSummary(markError)}).`,
          );
        }
        continue;
      }
      try {
        await markCommand(command, "applied");
        console.info(
          `[AFRODITA] Orden de ZEUS aplicada id=${command.id} ` +
            `command=${command.command} groupId=${command.chat_id}.`,
        );
      } catch (error) {
        logError(
          `[AFRODITA] No se pudo confirmar la orden aplicada id=${command.id} ` +
            `(${safeErrorSummary(error)}); se reintentará de forma idempotente.`,
        );
      }
    }
    try {
      await touchGlobalHeartbeat();
    } catch (error) {
      logError(
        `[AFRODITA] No se pudo actualizar el heartbeat global (${safeErrorSummary(error)}).`,
      );
    }
  }

  async function syncNow(): Promise<void> {
    if (stopped || running) return;
    running = true;
    try {
      await runOnce();
    } catch (error) {
      activityControl.setState("paused");
      logError(
        `[AFRODITA] Falló la sincronización con Supabase (${safeErrorSummary(error)}).`,
      );
    } finally {
      running = false;
    }
  }

  function scheduleNext(): void {
    if (stopped) return;
    const delay = intervalMs + Math.floor(Math.random() * MAX_JITTER_MS);
    timer = setTimeout(() => {
      void syncNow().finally(scheduleNext);
    }, delay);
    timer.unref?.();
  }

  // Primera sincronización tras arrancar (con margen para que el bot esté listo).
  const initial = setTimeout(() => {
    void syncNow();
  }, 5_000);
  initial.unref?.();
  scheduleNext();

  console.info(
    "[AFRODITA] Integración Supabase habilitada: estado, eventos y órdenes " +
      "de ZEUS se sincronizan periódicamente.",
  );

  return {
    enabled: true,
    syncNow,
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
      clearTimeout(initial);
    },
  };
}
