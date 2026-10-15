export interface AfroditaConfig {
  botToken: string;
  dataDirectory?: string;
  aiEndpoint?: string;
  aiApiKey?: string;
  aiModel?: string;
}

export function loadAfroditaConfig(
  env: NodeJS.ProcessEnv = process.env,
): AfroditaConfig {
  const botToken = env.AFRODITA_BOT_TOKEN?.trim();
  if (!botToken) {
    throw new Error("Falta AFRODITA_BOT_TOKEN.");
  }
  if (!/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(botToken)) {
    throw new Error("AFRODITA_BOT_TOKEN no tiene un formato válido de Telegram.");
  }

  const dataDirectory = env.AFRODITA_DATA_DIR?.trim();
  const aiEndpoint = env.AFRODITA_AI_CHAT_COMPLETIONS_URL?.trim();
  const aiApiKey = env.AFRODITA_AI_API_KEY?.trim();
  const aiModel = env.AFRODITA_AI_MODEL?.trim();
  if ([aiEndpoint, aiApiKey, aiModel].some(Boolean) && ![aiEndpoint, aiApiKey, aiModel].every(Boolean)) {
    throw new Error(
      "La IA opcional requiere AFRODITA_AI_CHAT_COMPLETIONS_URL, AFRODITA_AI_API_KEY y AFRODITA_AI_MODEL.",
    );
  }
  if (aiEndpoint) {
    let parsed: URL;
    try {
      parsed = new URL(aiEndpoint);
    } catch {
      throw new Error("AFRODITA_AI_CHAT_COMPLETIONS_URL debe ser una URL válida.");
    }
    const localHttp =
      parsed.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
    if ((parsed.protocol !== "https:" && !localHttp) || parsed.username || parsed.password) {
      throw new Error("El endpoint de IA debe usar HTTPS (excepto localhost).");
    }
  }
  return {
    botToken,
    ...(dataDirectory ? { dataDirectory } : {}),
    ...(aiEndpoint ? { aiEndpoint } : {}),
    ...(aiApiKey ? { aiApiKey } : {}),
    ...(aiModel ? { aiModel } : {}),
  };
}
