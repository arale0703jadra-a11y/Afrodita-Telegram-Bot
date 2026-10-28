import type { AfroditaConfig } from "./config.js";

export interface VerifiedModel {
  groupId: number;
  userId: number;
  displayName: string;
  username?: string;
  media: VerifiedMedia[];
}

export interface VerifiedMedia {
  fileId: string;
  type: "photo" | "video" | "document";
}

const CACHE_TTL_MS = 30 * 1000;
const MAX_MODELS_PER_GROUP = 500;
const cache = new Map<string, { expiresAt: number; models: VerifiedModel[] }>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseModel(value: unknown, groupId: number): VerifiedModel | undefined {
  if (!isRecord(value)) return undefined;
  if (
    value.group_id !== groupId ||
    typeof value.user_id !== "number" ||
    !Number.isSafeInteger(value.user_id) ||
    value.user_id <= 0
  ) {
    return undefined;
  }
  const displayName = typeof value.display_name === "string"
    ? value.display_name.replace(/[\r\n\0]/gu, " ").trim().slice(0, 80)
    : "";
  const username = typeof value.username === "string"
    ? value.username.replace(/^@/u, "").slice(0, 32)
    : undefined;
  return {
    groupId,
    userId: value.user_id,
    displayName: displayName || (username ? `@${username}` : `Miembro ${value.user_id}`),
    ...(username ? { username } : {}),
    media: [],
  };
}

export function clearVerifiedModelsCache(): void {
  cache.clear();
}

export function invalidateVerifiedModelsCache(
  groupId: number,
  supabaseUrl?: string,
): void {
  const suffix = `:${groupId}`;
  for (const key of cache.keys()) {
    if (key.endsWith(suffix) && (!supabaseUrl || key === `${supabaseUrl}${suffix}`)) {
      cache.delete(key);
    }
  }
}

export async function isVerifiedCatalogUser(
  groupId: number,
  userId: number,
  config: Pick<AfroditaConfig, "supabaseUrl" | "supabaseKey">,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  if (!config.supabaseUrl || !config.supabaseKey) {
    throw new Error("AFRODITA_SUPABASE_NOT_CONFIGURED");
  }
  const models = await getActiveVerifiedModels(
    groupId,
    config,
    fetcher,
    Date.now(),
    { forceRefresh: true },
  );
  return models.some((model) => model.userId === userId);
}

export async function getActiveVerifiedModels(
  groupId: number,
  config: Pick<AfroditaConfig, "supabaseUrl" | "supabaseKey">,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
  options: { timeoutMs?: number; forceRefresh?: boolean } = {},
): Promise<VerifiedModel[]> {
  if (!Number.isSafeInteger(groupId) || groupId === 0) {
    throw new Error("AFRODITA_SUPABASE_GROUP_ID_INVALID");
  }
  if (!config.supabaseUrl || !config.supabaseKey) {
    throw new Error("AFRODITA_SUPABASE_NOT_CONFIGURED");
  }
  const cacheKey = `${config.supabaseUrl}:${groupId}`;
  const cached = cache.get(cacheKey);
  if (!options.forceRefresh && cached && cached.expiresAt > now) {
    return cached.models.map((model) => ({
      ...model,
      media: model.media.map((item) => ({ ...item })),
    }));
  }

  const endpoint = new URL(
    "/rest/v1/rpc/get_afrodita_verified_catalog",
    config.supabaseUrl,
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 8_000);
  try {
    let response: Response;
    try {
      response = await fetcher(endpoint, {
        method: "POST",
        headers: {
          apikey: config.supabaseKey,
          authorization: `Bearer ${config.supabaseKey}`,
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({ p_group_id: groupId }),
        signal: controller.signal,
      });
    } catch {
      if (controller.signal.aborted) {
        throw new Error("AFRODITA_SUPABASE_TIMEOUT");
      }
      throw new Error("AFRODITA_SUPABASE_NETWORK_ERROR");
    }
    if (!response.ok) {
      throw new Error(`AFRODITA_SUPABASE_HTTP_${response.status}`);
    }
    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) {
      throw new Error("AFRODITA_SUPABASE_RESPONSE_INVALID");
    }
    const models = payload
      .map((row) => parseModel(row, groupId))
      .filter((model): model is VerifiedModel => Boolean(model))
      .slice(0, MAX_MODELS_PER_GROUP);
    cache.set(cacheKey, {
      expiresAt: now + CACHE_TTL_MS,
      models,
    });
    return models.map((model) => ({
      ...model,
      media: model.media.map((item) => ({ ...item })),
    }));
  } finally {
    clearTimeout(timeout);
  }
}
