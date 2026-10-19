export interface AfroditaConfig {
  botToken: string;
  dataDirectory?: string;
  aiEndpoint?: string;
  aiApiKey?: string;
  aiModel?: string;
  supabaseUrl?: string;
  supabaseKey?: string;
}

export class AfroditaConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AfroditaConfigError";
  }
}

export function loadAfroditaConfig(
  env: NodeJS.ProcessEnv = process.env,
): AfroditaConfig {
  const botToken = env.AFRODITA_BOT_TOKEN?.trim();
  if (!botToken) {
    throw new AfroditaConfigError("Falta AFRODITA_BOT_TOKEN.");
  }
  if (!/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(botToken)) {
    throw new AfroditaConfigError("AFRODITA_BOT_TOKEN no tiene un formato válido de Telegram.");
  }

  const dataDirectory = env.AFRODITA_DATA_DIR?.trim();
  const aiEndpoint = env.AFRODITA_AI_CHAT_COMPLETIONS_URL?.trim();
  const aiApiKey = env.AFRODITA_AI_API_KEY?.trim();
  const aiModel = env.AFRODITA_AI_MODEL?.trim();
  const supabaseUrl = env.AFRODITA_SUPABASE_URL?.trim();
  const supabaseKey = env.AFRODITA_SUPABASE_KEY?.trim();
  if ([aiEndpoint, aiApiKey, aiModel].some(Boolean) && ![aiEndpoint, aiApiKey, aiModel].every(Boolean)) {
    throw new AfroditaConfigError(
      "La IA opcional requiere AFRODITA_AI_CHAT_COMPLETIONS_URL, AFRODITA_AI_API_KEY y AFRODITA_AI_MODEL.",
    );
  }
  if (aiEndpoint) {
    let parsed: URL;
    try {
      parsed = new URL(aiEndpoint);
    } catch {
      throw new AfroditaConfigError("AFRODITA_AI_CHAT_COMPLETIONS_URL debe ser una URL válida.");
    }
    const localHttp =
      parsed.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
    if ((parsed.protocol !== "https:" && !localHttp) || parsed.username || parsed.password) {
      throw new AfroditaConfigError("El endpoint de IA debe usar HTTPS (excepto localhost).");
    }
  }
  if (Boolean(supabaseUrl) !== Boolean(supabaseKey)) {
    throw new AfroditaConfigError(
      "La conexión Supabase requiere AFRODITA_SUPABASE_URL y AFRODITA_SUPABASE_KEY.",
    );
  }
  if (supabaseUrl) {
    let parsed: URL;
    try {
      parsed = new URL(supabaseUrl);
    } catch {
      throw new AfroditaConfigError("AFRODITA_SUPABASE_URL debe ser una URL válida.");
    }
    const localHttp =
      parsed.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
    if (
      (parsed.protocol !== "https:" && !localHttp) ||
      parsed.username ||
      parsed.password
    ) {
      throw new AfroditaConfigError(
        "AFRODITA_SUPABASE_URL debe usar HTTPS (excepto localhost).",
      );
    }
  }
  return {
    botToken,
    ...(dataDirectory ? { dataDirectory } : {}),
    ...(aiEndpoint ? { aiEndpoint } : {}),
    ...(aiApiKey ? { aiApiKey } : {}),
    ...(aiModel ? { aiModel } : {}),
    ...(supabaseUrl ? { supabaseUrl: supabaseUrl.replace(/\/+$/u, "") } : {}),
    ...(supabaseKey ? { supabaseKey } : {}),
  };
}
