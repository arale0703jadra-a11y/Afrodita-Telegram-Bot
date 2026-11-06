import type { EventEmitter } from "node:events";
import { Bot } from "grammy";
import type { Context } from "grammy";
import { observeMessage } from "./analytics.js";
import { AfroditaActivityControl } from "./activity-control.js";
import type { AfroditaConfig } from "./config.js";
import { decideAction } from "./decision.js";
import { safeErrorSummary, safeErrorType } from "./errors.js";
import { generateReply } from "./generator.js";
import { GroupConversationContext } from "./conversation-context.js";
import {
  handleAdminMenuCallback,
  showAdminMenu,
} from "./admin-menu.js";
import {
  isCommercialInquiry,
  catalogReply,
  entertainmentPollContent,
  verifiedModelsPollContent,
  saltedRandomValue,
} from "./messages.js";
import { checkGroupAdministrator } from "./permissions.js";
import {
  getEligiblePromotionProfiles,
  resolvePromotionProfiles,
  publishCommunityReply,
  publishPoll,
  publishProfilePromotion,
  publishScheduledJob,
} from "./publishers.js";
import { PublicationScheduler } from "./scheduler.js";
import { AfroditaStore } from "./store.js";
import { installGracefulShutdown } from "./shutdown.js";
import type {
  AfroditaDecision,
  AfroditaTopic,
  AuthorizedProfile,
  ContentPermission,
} from "./types.js";
import { CONTENT_PERMISSIONS } from "./types.js";
import { isVerifiedCatalogUser } from "./verified-users.js";
import { sanitizeIncomingText } from "./utils/sanitizer.js";

const QUIET_FEEDBACK =
  /\b(?:no me menciones|no me etiquetes|deja de (?:escribir|mencionar)|para de (?:escribir|mencionar)|menos mensajes|demasiados mensajes|muchos mensajes|guarda silencio)\b/iu;

function isGroup(ctx: Context): ctx is Context & { chat: Context["chat"] & { id: number; type: "group" | "supergroup" } } {
  return ctx.chat?.type === "group" || ctx.chat?.type === "supergroup";
}

async function requireGroupAdministrator(ctx: Context, chatId: number): Promise<boolean> {
  if (!ctx.from) return false;
  const result = await checkGroupAdministrator(ctx.api, chatId, ctx.from.id);
  if (result.status === "administrator") return true;
  if (result.status === "not_administrator") {
    await ctx.reply("Solo una persona administradora del grupo puede usar este comando.");
  } else {
    console.warn(
      `[AFRODITA] No se pudieron comprobar los permisos de administración (${errorName(result.error)}).`,
    );
    await ctx.reply("No pude comprobar tus permisos con Telegram. Inténtalo de nuevo más tarde.");
  }
  return false;
}

function isActiveMember(member: Awaited<ReturnType<Context["api"]["getChatMember"]>>): boolean {
  return member.status !== "left" &&
    member.status !== "kicked" &&
    (member.status !== "restricted" || member.is_member);
}

function directedMessage(ctx: Context, botUsername: string, botId: number): boolean {
  const message = ctx.message;
  if (!message) return false;
  if (message.reply_to_message?.from?.id === botId) return true;
  const text = sanitizeIncomingText(message.text ?? message.caption ?? "");
  return new RegExp(`@${botUsername.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "iu").test(text);
}

function removeBotMention(text: string, botUsername: string): string {
  return sanitizeIncomingText(text).replace(
    new RegExp(`@${botUsername.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "giu"),
    "",
  ).trim().slice(0, 600);
}

async function mayUseConversation(
  ctx: Context,
  supabaseConfig: { supabaseUrl?: string; supabaseKey?: string },
  fetcher: typeof fetch,
): Promise<boolean> {
  if (!isGroup(ctx) || !ctx.from || ctx.from.is_bot) return false;
  let member: Awaited<ReturnType<Context["api"]["getChatMember"]>>;
  try {
    member = await ctx.api.getChatMember(ctx.chat.id, ctx.from.id);
  } catch (error) {
    console.warn(
      `[AFRODITA] No se pudo comprobar el rol conversacional (${errorName(error)}); se omite la respuesta.`,
    );
    return false;
  }
  if (
    member.status === "administrator" ||
    member.status === "creator" ||
    !(
      member.status === "member" ||
      (member.status === "restricted" && member.is_member)
    )
  ) return false;

  try {
    return !await isVerifiedCatalogUser(
      ctx.chat.id,
      ctx.from.id,
      supabaseConfig,
      fetcher,
    );
  } catch (error) {
    console.warn(
      `[AFRODITA] No se pudo comprobar la verificación para conversar (${errorName(error)}); se omite la respuesta.`,
    );
    return false;
  }
}

async function approveProfile(
  ctx: Context,
  store: AfroditaStore,
  supabaseConfig: { supabaseUrl?: string; supabaseKey?: string },
  fetcher: typeof fetch,
): Promise<void> {
  if (!isGroup(ctx) || !ctx.message || !ctx.from) return;
  if (!(await requireGroupAdministrator(ctx, ctx.chat.id))) return;
  const target = ctx.message.reply_to_message?.from;
  if (!target || target.is_bot) {
    await ctx.reply("Responde al mensaje de una creadora verificada para autorizar su perfil.");
    return;
  }
  let isVerified: boolean;
  try {
    isVerified = await isVerifiedCatalogUser(
      ctx.chat.id,
      target.id,
      supabaseConfig,
      fetcher,
    );
  } catch (error) {
    console.warn(
      `[AFRODITA] No se pudo confirmar la verificación en Supabase (${errorName(error)}); no se autorizó el perfil.`,
    );
    await ctx.reply("No pude confirmar la verificación actual; no autoricé el perfil.");
    return;
  }
  if (!isVerified) {
    await ctx.reply("Ese usuario no figura como verificado en la configuración de ZEUS.");
    return;
  }
  let member;
  try {
    member = await ctx.api.getChatMember(ctx.chat.id, target.id);
  } catch (error) {
    console.warn(
      `[AFRODITA] No se pudo confirmar la membresía del perfil (${errorName(error)}).`,
    );
    await ctx.reply("No pude confirmar la membresía actual; no autoricé el perfil.");
    return;
  }
  if (!isActiveMember(member)) {
    await ctx.reply("La persona ya no es miembro activo del grupo; no autoricé el perfil.");
    return;
  }
  const profile: AuthorizedProfile = {
    userId: target.id,
    displayName: [target.first_name, target.last_name].filter(Boolean).join(" ").slice(0, 80),
    ...(target.username ? { username: target.username } : {}),
  };
  try {
    await store.authorizeProfile(ctx.chat.id, profile);
  } catch (error) {
    if (error instanceof Error && error.message === "AFRODITA_PROFILE_LIMIT_REACHED") {
      await ctx.reply("El grupo ya tiene 20 perfiles autorizados. Retira uno antes de añadir otro.");
      return;
    }
    console.error(`[AFRODITA] No se pudo guardar la autorización de perfil (${errorName(error)}).`);
    await ctx.reply("No pude guardar la autorización del perfil. Inténtalo de nuevo más tarde.");
    return;
  }
  await ctx.reply("✅ Perfil verificado y autorizado para presentaciones ocasionales.");
}

async function revokeProfile(ctx: Context, store: AfroditaStore): Promise<void> {
  if (!isGroup(ctx) || !ctx.message || !ctx.from) return;
  if (!(await requireGroupAdministrator(ctx, ctx.chat.id))) return;
  const target = ctx.message.reply_to_message?.from;
  if (!target) {
    await ctx.reply("Responde al mensaje de la persona cuyo perfil quieres retirar.");
    return;
  }
  try {
    await store.removeProfile(ctx.chat.id, target.id);
  } catch (error) {
    console.error(`[AFRODITA] No se pudo retirar el perfil autorizado (${errorName(error)}).`);
    await ctx.reply("No pude guardar el cambio del perfil. Inténtalo de nuevo más tarde.");
    return;
  }
  await ctx.reply("Listo, ya no presentaré ese perfil.");
}

const CONSENT_LABELS: Record<ContentPermission, string> = {
  catalog: "catálogo",
  mention: "menciones",
  body: "comentarios físicos",
  photos: "fotografías",
  videos: "vídeos",
  polls: "encuestas personalizadas",
};

const CONSENT_ARGUMENTS: Record<string, ContentPermission> = {
  catalogo: "catalog",
  catálogo: "catalog",
  catalog: "catalog",
  mencionar: "mention",
  menciones: "mention",
  mention: "mention",
  cuerpo: "body",
  fisico: "body",
  físico: "body",
  fotos: "photos",
  foto: "photos",
  fotografias: "photos",
  fotografías: "photos",
  videos: "videos",
  video: "videos",
  vídeos: "videos",
  vídeo: "videos",
  encuestas: "polls",
  polls: "polls",
};

async function setContentConsent(
  ctx: Context,
  store: AfroditaStore,
  supabaseConfig: { supabaseUrl?: string; supabaseKey?: string },
  command: string,
  fetcher: typeof fetch,
  legacyCompat = false,
): Promise<boolean> {
  if (!isGroup(ctx) || !ctx.from || ctx.from.is_bot) {
    await ctx.reply("Este consentimiento solo puede gestionarse desde el grupo.");
    return false;
  }
  const parsed = command.trim().split(/\s+/u).filter(Boolean);
  if (parsed.length === 0) {
    const state = await store.loadGroup(ctx.chat.id);
    const consent = state.contentConsents[String(ctx.from.id)];
    await ctx.reply(
      `Tus permisos en este grupo:\n${CONTENT_PERMISSIONS.map((permission) =>
        `• ${CONSENT_LABELS[permission]}: ${consent?.[permission].granted ? "concedido" : "no concedido"}`,
      ).join("\n")}\n\n` +
        "Gestiona únicamente tus permisos con /afrodita_consentimiento otorgar <permisos> o retirar <permisos>.",
    );
    return true;
  }
  const action = parsed.shift()?.toLocaleLowerCase("es");
  if ((action !== "otorgar" && action !== "retirar") || parsed.length === 0) {
    await ctx.reply(
      "Uso: /afrodita_consentimiento [otorgar|retirar] catalogo,mencionar,cuerpo,fotos,videos,encuestas",
    );
    return false;
  }
  const tokens = parsed.join(" ").split(",").map((item) => item.trim().toLocaleLowerCase("es"));
  const permissions: ContentPermission[] = [];
  for (const token of tokens) {
    const permission = CONSENT_ARGUMENTS[token];
    if (!permission) {
      await ctx.reply(`Permiso desconocido: ${token || "(vacío)"}. No se cambió ningún permiso.`);
      return false;
    }
    if (!permissions.includes(permission)) permissions.push(permission);
  }
  let verified: boolean;
  try {
    verified = await isVerifiedCatalogUser(ctx.chat.id, ctx.from.id, supabaseConfig, fetcher);
  } catch (error) {
    console.warn(`[AFRODITA] No se pudo comprobar la verificación para consentimiento (${errorName(error)}).`);
    await ctx.reply("No pude comprobar tu verificación actual; no se cambió ningún permiso.");
    return false;
  }
  if (!verified) {
    await ctx.reply("Solo una persona verificada puede gestionar sus propios permisos.");
    return false;
  }
  try {
    const member = await ctx.api.getChatMember(ctx.chat.id, ctx.from.id);
    if (!isActiveMember(member)) {
      await ctx.reply("Debes pertenecer actualmente a este grupo para gestionar tus permisos.");
      return false;
    }
  } catch (error) {
    console.warn(`[AFRODITA] No se pudo comprobar la membresía para consentimiento (${errorName(error)}).`);
    await ctx.reply("No pude comprobar tu membresía actual; no se cambió ningún permiso.");
    return false;
  }
  const granted = action === "otorgar";
  try {
    await store.setContentConsent(
      ctx.chat.id,
      ctx.from.id,
      ctx.from.id,
      permissions,
      granted,
    );
    if (legacyCompat) {
      if (granted) await store.authorizePromotion(ctx.chat.id, ctx.from.id);
      else await store.revokePromotion(ctx.chat.id, ctx.from.id);
    }
  } catch (error) {
    console.error(`[AFRODITA] No se pudo guardar el consentimiento (${errorName(error)}).`);
    await ctx.reply("No pude guardar el cambio. Inténtalo de nuevo más tarde.");
    return false;
  }
  await ctx.reply(
    `Permisos ${granted ? "otorgados" : "retirados"}: ${permissions.map((permission) => CONSENT_LABELS[permission]).join(", ")}.`,
  );
  return true;
}

async function setAdultConfirmation(
  ctx: Context,
  store: AfroditaStore,
  command: string,
): Promise<void> {
  if (!isGroup(ctx) || !ctx.from) {
    await ctx.reply("Este ajuste solo está disponible dentro de un grupo.");
    return;
  }
  const action = command.trim().toLocaleLowerCase("es");
  if (action !== "confirmar" && action !== "retirar") {
    await ctx.reply("Uso: /afrodita_adulto confirmar o /afrodita_adulto retirar");
    return;
  }
  if (!(await requireGroupAdministrator(ctx, ctx.chat.id))) return;
  const confirmed = action === "confirmar";
  try {
    await store.setAdultConfirmation(ctx.chat.id, confirmed);
  } catch (error) {
    console.error(`[AFRODITA] No se pudo guardar la confirmación adulta (${errorName(error)}).`);
    await ctx.reply("No pude guardar el cambio. Inténtalo de nuevo más tarde.");
    return;
  }
  await ctx.reply(confirmed
    ? "Confirmación administrativa registrada. Este grupo declara estar destinado exclusivamente a personas adultas (18+). Esto no verifica la edad individual de sus integrantes."
    : "Confirmación retirada. El contenido adulto queda desactivado inmediatamente. Esto no verifica la edad individual de sus integrantes.");
}




async function publishDecision(
  ctx: Context,
  botUsername: string,
  store: AfroditaStore,
  decision: AfroditaDecision,
  aiConfig: {
    endpoint?: string;
    apiKey?: string;
    model?: string;
    supabaseUrl?: string;
    supabaseKey?: string;
  },
  fetcher: typeof fetch,
  conversationContext: GroupConversationContext,
  activityControl: AfroditaActivityControl,
): Promise<void> {
  if (!activityControl.isRunning() || !isGroup(ctx) || !ctx.message) return;
  const groupState = await store.loadGroup(ctx.chat.id);
  const adultAllowed = groupState.adultConfirmedAt !== undefined;

  if (decision.action === "reply" || decision.action === "participate") {
    if (!activityControl.isRunning()) return;
    if (!await mayUseConversation(ctx, aiConfig, fetcher)) return;
    const source = decision.action === "reply"
      ? removeBotMention(ctx.message.text ?? ctx.message.caption ?? "", botUsername)
      : sanitizeIncomingText(ctx.message.text ?? ctx.message.caption ?? "").slice(0, 600);
    const history = conversationContext.recent(ctx.chat.id);
    const generated = await generateReply(source, decision.topic, {
      endpoint: aiConfig.endpoint,
      apiKey: aiConfig.apiKey,
      model: aiConfig.model,
      allowAdultContent: adultAllowed,
    }, Math.random(), fetcher, history);
    if (generated.silent || !generated.text) return;
    const latestState = await store.loadGroup(ctx.chat.id);
    const replyText = adultAllowed && !latestState.adultConfirmedAt
      ? catalogReply(decision.topic)
      : generated.text;
    const sent = await publishCommunityReply(() => ctx.reply(replyText, {
      reply_to_message_id: decision.action === "reply"
        ? ctx.message!.message_id
        : undefined,
    }), store, ctx.chat.id, ctx.from?.id,
    async () =>
      activityControl.isRunning() &&
      await mayUseConversation(ctx, aiConfig, fetcher),
    () => activityControl.isRunning(),
    );
    if (sent) {
      conversationContext.append(ctx.chat.id, "user", source);
      conversationContext.append(ctx.chat.id, "assistant", replyText);
    }
    return;
  }

  if (decision.action === "poll") {
    const dateSalt = new Date().toISOString().slice(0, 10);
    let content = entertainmentPollContent(decision.topic, Math.random(), dateSalt, adultAllowed);
    try {
      // Encuesta personalizada: solo perfiles YA en la lista de verificadas
      // (lista = autorizacion; catalogo de ZEUS si esta disponible).
      const eligible = await resolvePromotionProfiles(
        store,
        ctx.api,
        ctx.chat.id,
        aiConfig,
        fetcher,
        "polls",
      );
      if (eligible.length > 0) {
        const varied = saltedRandomValue(Math.random(), dateSalt);
        if (varied < 0.5) {
          const groupState = await store.loadGroup(ctx.chat.id);
          content = verifiedModelsPollContent(
            decision.topic,
            eligible.map((candidate) => {
              const stored = groupState.authorizedProfiles[String(candidate.userId)];
              return {
                groupId: ctx.chat.id,
                userId: candidate.userId,
                displayName: candidate.displayName,
                ...(candidate.mention && stored?.username ? { username: stored.username } : {}),
                media: [],
              };
            }),
            varied,
          );
        }
      }
    } catch {
      // Sin perfiles elegibles se conserva la encuesta general del grupo.
    }
    await publishPoll(
      ctx.api,
      store,
      ctx.chat.id,
      "commercial_poll",
      content,
      { kind: "activity" },
      () => activityControl.isRunning(),
    );
    return;
  }

  if (decision.action === "profile") {
    let profiles;
    try {
      profiles = await resolvePromotionProfiles(store, ctx.api, ctx.chat.id, aiConfig, fetcher);
    } catch (error) {
      console.warn(
        `[AFRODITA] No se pudieron revalidar perfiles promocionables (${errorName(error)}).`,
      );
      return;
    }
    const profile = profiles.find(
      (candidate) => candidate.userId === decision.profile.userId,
    ) ?? profiles[0];
    if (!profile) return;
    await publishProfilePromotion(
      ctx.api,
      store,
      ctx.chat.id,
      profile,
      { kind: "activity", userId: profile.userId },
      (await store.loadGroup(ctx.chat.id)).publications.verified_promotion.history.length,
      () => activityControl.isRunning(),
    );
  }
}


const GLOBAL_CONTROL_NOTICE =
  "🌸 El control de AFRODITA es global y vive en el panel privado de ZEUS " +
  "(/menu → 🌸 AFRODITA). Ya no existe pausa ni reanudación por grupo: el " +
  "interruptor único activa o detiene AFRODITA en todos los grupos.";

async function showGlobalControlNotice(ctx: Context): Promise<void> {
  await ctx.reply(GLOBAL_CONTROL_NOTICE);
}
export interface AfroditaApplicationDependencies {
  config: AfroditaConfig;
  bot?: Bot;
  createBot?: (token: string) => Bot;
  store?: AfroditaStore;
  scheduler?: Pick<PublicationScheduler, "start" | "stop"> | null;
  fetcher?: typeof fetch;
  shutdownSignals?: EventEmitter;
  activityControl?: AfroditaActivityControl;
}

export interface AfroditaApplication {
  bot: Bot;
  store: AfroditaStore;
  scheduler: Pick<PublicationScheduler, "start" | "stop"> | undefined;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createAfroditaApplication(
  dependencies: AfroditaApplicationDependencies,
): AfroditaApplication {
  const { config } = dependencies;
  const bot = dependencies.bot ??
    (dependencies.createBot ?? ((token) => new Bot(token)))(config.botToken);
  const store = dependencies.store ?? new AfroditaStore(config.dataDirectory);
  const fetcher = dependencies.fetcher ?? fetch;
  const activityControl = dependencies.activityControl ??
    new AfroditaActivityControl("running");
  const conversationContext = new GroupConversationContext();
  const scheduler = dependencies.scheduler === null
    ? undefined
    : dependencies.scheduler ?? new PublicationScheduler(
      store,
      (job) => publishScheduledJob(
        bot.api,
        store,
        job.chatId,
        job.category,
        job.slotKey,
        {
          supabaseUrl: config.supabaseUrl,
          supabaseKey: config.supabaseKey,
        },
        fetcher,
        () => activityControl.isRunning(),
      ),
      undefined,
      Date.now,
      () => activityControl.isRunning(),
    );

  bot.catch((error) => {
    console.error(
      `[AFRODITA] Falló el procesamiento de una actualización (${safeErrorSummary(error.error)}).`,
    );
  });

  bot.command("start", async (ctx) => {
    await ctx.reply(
      "¡Hola! Soy Afrodita 💫 En grupos respondo cuando me hablan y, de vez en cuando, propongo una encuesta para descubrir productos y servicios locales. " +
        "El grupo puede pedirme una pausa diciendo «no me menciones» en un mensaje dirigido a mí.",
    );
  });
  bot.command("afrodita", async (ctx) => {
    await ctx.reply(
      "Soy Afrodita 💫 Una persona administradora debe activarme con /afrodita_activar. " +
        "Luego respondo si me mencionas, contestas uno de mis mensajes o preguntas directamente por catálogos, fotos, servicios o llamadas. " +
        "Puede autorizar un perfil verificado respondiendo a su mensaje con /afrodita_perfil, " +
        "cada persona verificada puede gestionar sus permisos con /afrodita_consentimiento, " +
        "y la administración debe confirmar el uso de contenido adulto con /afrodita_adulto confirmar. " +
        "y una persona administradora puede retirar un perfil con /afrodita_ocultar. " +
          "La administración está en el panel privado de ZEUS (/menu → 🌸 AFRODITA). Mis métricas son agregadas y no guardo el texto de la charla.",
      );
    });
    bot.command("menu", async (ctx) => showAdminMenu(ctx, store));
    bot.command("afrodita_activar", async (ctx) => showGlobalControlNotice(ctx));
    bot.command("afrodita_pausar", async (ctx) => showGlobalControlNotice(ctx));
    bot.command("afrodita_consentimiento", async (ctx) =>
      setContentConsent(ctx, store, {
        supabaseUrl: config.supabaseUrl,
        supabaseKey: config.supabaseKey,
      }, String(ctx.match ?? ""), fetcher),
    );
    bot.command("afrodita_adulto", async (ctx) =>
      setAdultConfirmation(ctx, store, String(ctx.match ?? "")),
    );
    bot.command("afrodita_autorizar_promocion", async (ctx) =>
        setContentConsent(ctx, store, {
          supabaseUrl: config.supabaseUrl,
          supabaseKey: config.supabaseKey,
        }, "otorgar catalogo,mencionar,encuestas", fetcher, true),
      );
    bot.command("afrodita_retirar_promocion", async (ctx) =>
        setContentConsent(ctx, store, {
          supabaseUrl: config.supabaseUrl,
          supabaseKey: config.supabaseKey,
        }, "retirar catalogo,mencionar,encuestas", fetcher, true),
      );
  bot.command("afrodita_perfil", async (ctx) =>
    approveProfile(ctx, store, {
      supabaseUrl: config.supabaseUrl,
      supabaseKey: config.supabaseKey,
    }, fetcher),
  );
  bot.command("afrodita_ocultar", async (ctx) => revokeProfile(ctx, store));
  bot.command("afrodita_verificadas", async (ctx) => {
    if (!isGroup(ctx)) {
      await ctx.reply("La lista de verificadas se consulta dentro del grupo.");
      return;
    }
    if (!(await requireGroupAdministrator(ctx, ctx.chat.id))) return;
    const state = await store.loadGroup(ctx.chat.id);
    const entries = Object.values(state.authorizedProfiles);
    if (entries.length === 0) {
      await ctx.reply("No hay verificadas en la lista de este grupo.");
      return;
    }
    const lines = await Promise.all(
      entries.map(async (profile) => {
        const mayMention =
          state.contentConsents[String(profile.userId)]?.mention.granted === true;
        const handle = mayMention && profile.username
          ? `@${profile.username}`
          : "(sin mención autorizada)";
        let membership = "membresía: desconocida";
        try {
          const member = await ctx.api.getChatMember(ctx.chat.id, profile.userId);
          const active = member.status !== "left" &&
            member.status !== "kicked" &&
            (member.status !== "restricted" || member.is_member);
          membership = active ? "en el grupo" : "fuera del grupo";
        } catch {
          // Sin datos de Telegram se conserva «desconocida».
        }
        return `• ${handle} — ${profile.displayName} — ${membership}`;
      }),
    );
    await ctx.reply(
      `Lista de verificadas (${entries.length}):\n${lines.join("\n")}\n\n` +
        "La lista es la única autorización de AFRODITA; su gestión corresponde solo a la administración.",
    );
  });

  bot.on("poll", async (ctx) => {
    const poll = ctx.poll;
    await store.recordPollUpdate(
      poll.id,
      poll.options.map((option) => ({ voter_count: option.voter_count })),
    );
  });
  bot.callbackQuery(/^af:/u, async (ctx) =>
    handleAdminMenuCallback(ctx, store),
  );

  bot.on("message", async (ctx) => {
    if (
      !activityControl.isRunning() ||
      !isGroup(ctx) ||
      !ctx.message ||
      !ctx.from ||
      ctx.from.is_bot
    ) return;
    const now = Date.now();
    const rawText = ctx.message.text ?? ctx.message.caption ?? "";
    if (/^\s*\/[A-Za-z0-9_]+(?:@[A-Za-z0-9_]+)?(?:\s|$)/u.test(rawText)) return;
    const username = bot.botInfo.username;
    const directed = directedMessage(ctx, username, bot.botInfo.id);
    const text = sanitizeIncomingText(
      rawText,
    );
    const commercialInquiry = isCommercialInquiry(text);
    const observation = {
      text: text.slice(0, 2_000),
      hourUtc: new Date(now).getUTCHours(),
      repliedToBot: ctx.message.reply_to_message?.from?.id === bot.botInfo.id,
      explicitQuietRequest: directed && QUIET_FEEDBACK.test(text),
    };
    const updated = await store.updateGroup(ctx.chat.id, (state) => {
      // El flag legacy `enabled` ya no bloquea la observación: la única pausa
      // es el control global (comprobado al inicio de este manejador).
      observeMessage(state, observation, now);
      return true;
    });
    if (!updated.result) return;
    if (observation.explicitQuietRequest) return;

    const decision = decideAction(updated.state, {
      directedToBot: directed,
      commercialInquiry,
      randomValue: Math.random(),
      now,
    });
    if (decision.action === "silence") return;
    await publishDecision(ctx, username, store, decision, {
      endpoint: config.aiEndpoint,
      apiKey: config.aiApiKey,
      model: config.aiModel,
      supabaseUrl: config.supabaseUrl,
      supabaseKey: config.supabaseKey,
    }, fetcher, conversationContext, activityControl);
  });

  const removeShutdownHandlers = { current: (): void => undefined };
  const stop = async (): Promise<void> => {
    try {
      scheduler?.stop();
      await bot.stop();
    } finally {
      removeShutdownHandlers.current();
      removeShutdownHandlers.current = () => undefined;
    }
  };
  const start = async (): Promise<void> => {
    removeShutdownHandlers.current = installGracefulShutdown(
      { stop },
      dependencies.shutdownSignals,
    );
    try {
      scheduler?.start();
      await bot.start({
        allowed_updates: ["message", "poll", "callback_query"],
        onStart: (info) => {
          console.log(`[AFRODITA] Iniciada como @${info.username}; IA externa ${config.aiEndpoint ? "habilitada" : "desactivada"}.`);
          if (!config.supabaseUrl || !config.supabaseKey) {
            console.warn(
              "[AFRODITA] Supabase no está configurado; las recomendaciones dinámicas de verificadas están desactivadas.",
            );
          }
        },
      });
    } finally {
      scheduler?.stop();
      removeShutdownHandlers.current();
      removeShutdownHandlers.current = () => undefined;
    }
  };

  return { bot, store, scheduler, start, stop };
}

function errorName(error: unknown): string {
  return safeErrorType(error);
}
