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

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_MODELS_PER_GROUP = 500;
const MAX_MEDIA_PER_MODEL = 5;
const cache = new Map<string, { expiresAt: number; models: VerifiedModel[] }>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readMedia(row: Record<string, unknown>): VerifiedMedia[] {
  const values: VerifiedMedia[] = [];
  const keys: Array<[string, VerifiedMedia["type"]]> = [
    ["photo_file_id", "photo"],
    ["profile_photo_file_id", "photo"],
    ["photo_file_ids", "photo"],
    ["video_file_id", "video"],
    ["video_file_ids", "video"],
    ["document_file_id", "document"],
    ["document_file_ids", "document"],
    ["media_file_id", "photo"],
    ["telegram_file_id", "photo"],
    ["file_id", "photo"],
    ["media_file_ids", "photo"],
  ];
  for (const [key, type] of keys) {
    const value = row[key];
    const candidates = Array.isArray(value) ? value : [value];
    for (const candidate of candidates) {
      if (typeof candidate === "string") values.push({ fileId: candidate, type });
    }
  }
  const media = row.media;
  if (Array.isArray(media)) {
    for (const item of media) {
      if (!isRecord(item)) continue;
      const type = item.type;
      if (
        (type === "photo" || type === "video" || type === "document") &&
        typeof item.file_id === "string"
      ) {
        values.push({ fileId: item.file_id, type });
      }
    }
  } else if (isRecord(media)) {
    const type = media.type;
    if (
      (type === "photo" || type === "video" || type === "document") &&
      typeof media.file_id === "string"
    ) {
      values.push({ fileId: media.file_id, type });
    }
  }
  const seen = new Set<string>();
  return values.filter(({ fileId, type }) => {
    if (
      fileId.length === 0 ||
      fileId.length > 2048 ||
      /[\r\n\0]/u.test(fileId)
    ) {
      return false;
    }
    const key = `${type}:${fileId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, MAX_MEDIA_PER_MODEL);
}

function parseModel(value: unknown, groupId: number): VerifiedModel | undefined {
  if (!isRecord(value)) return undefined;
  if (
    value.group_id !== groupId ||
    value.verified !== true ||
    value.revoked_at !== null ||
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
    media: readMedia(value),
  };
}

export function clearVerifiedModelsCache(): void {
  cache.clear();
}

export async function getActiveVerifiedModels(
  groupId: number,
  config: Pick<AfroditaConfig, "supabaseUrl" | "supabaseKey">,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<VerifiedModel[]> {
  if (!Number.isSafeInteger(groupId) || groupId === 0) {
    throw new Error("AFRODITA_SUPABASE_GROUP_ID_INVALID");
  }
  if (!config.supabaseUrl || !config.supabaseKey) {
    return [];
  }
  const cacheKey = `${config.supabaseUrl}:${groupId}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.models.map((model) => ({
      ...model,
      media: model.media.map((item) => ({ ...item })),
    }));
  }

  const endpoint = new URL("/rest/v1/verified_users", config.supabaseUrl);
  endpoint.searchParams.set("select", "*");
  endpoint.searchParams.set("group_id", `eq.${groupId}`);
  endpoint.searchParams.set("verified", "eq.true");
  endpoint.searchParams.set("revoked_at", "is.null");
  endpoint.searchParams.set("order", "display_name.asc");
  endpoint.searchParams.set("limit", String(MAX_MODELS_PER_GROUP));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetcher(endpoint, {
      method: "GET",
      headers: {
        apikey: config.supabaseKey,
        authorization: `Bearer ${config.supabaseKey}`,
        accept: "application/json",
      },
      signal: controller.signal,
    });
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
