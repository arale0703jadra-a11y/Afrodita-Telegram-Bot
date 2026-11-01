import type { EventEmitter } from "node:events";
import { Bot } from "grammy";
import type { Context } from "grammy";
import { observeMessage } from "./analytics.js";
import type { AfroditaConfig } from "./config.js";
import { decideAction } from "./decision.js";
import { safeErrorSummary, safeErrorType } from "./errors.js";
import { generateReply } from "./generator.js";
import {
  handleAdminMenuCallback,
  showAdminMenu,
} from "./admin-menu.js";
import {
  isCommercialInquiry,
  isExplicitMediaRequest,
  entertainmentPollContent,
  selectMediaProfile,
  verifiedModelsPollContent,
  verifiedModelsReply,
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
import type { AfroditaDecision, AfroditaTopic, AuthorizedProfile } from "./types.js";
import { getActiveVerifiedModels, isVerifiedCatalogUser } from "./verified-users.js";
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

async function setPromotionConsent(
  ctx: Context,
  store: AfroditaStore,
  supabaseConfig: { supabaseUrl?: string; supabaseKey?: string },
  enabled: boolean,
  fetcher: typeof fetch,
): Promise<boolean> {
  if (!isGroup(ctx) || !ctx.from || ctx.from.is_bot) {
    await ctx.reply("Este consentimiento solo puede gestionarse desde el grupo.");
    return false;
  }
  // Modelo definitivo: la lista de verificadas ES la autorizacion. Estos
  // comandos ya no mutan estado: informan y no pueden cambiar la verificacion.
  void store;
  void supabaseConfig;
  void fetcher;
  await ctx.reply(
    enabled
      ? "Ya estás en la lista de verificadas de este grupo: tu participación en promociones está autorizada automáticamente. Solo la administración gestiona la lista."
      : "Las verificadas no pueden retirarse de la lista por sí mismas; únicamente la administración puede modificarla. Tu verificación sigue intacta.",
  );
  return true;
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
): Promise<void> {
  if (!isGroup(ctx) || !ctx.message) return;

  if (decision.action === "reply" || decision.action === "participate") {
    const source = decision.action === "reply"
      ? removeBotMention(ctx.message.text ?? ctx.message.caption ?? "", botUsername)
      : "";
    if (
      decision.action === "reply" &&
      isCommercialInquiry(source)
    ) {
      let models: Awaited<ReturnType<typeof getActiveVerifiedModels>> | undefined;
      try {
        if (aiConfig.supabaseUrl && aiConfig.supabaseKey) {
          const catalog = await getActiveVerifiedModels(ctx.chat.id, {
            supabaseUrl: aiConfig.supabaseUrl,
            supabaseKey: aiConfig.supabaseKey,
          }, fetcher);
          const state = await store.loadGroup(ctx.chat.id);
          models = catalog.filter(
            (model) => state.authorizedProfiles[String(model.userId)] !== undefined,
          );
        }
        if (models?.length) {
          const responseText = verifiedModelsReply(models, source);
          if (isExplicitMediaRequest(source)) {
            const selection = selectMediaProfile(source, models);
            if (selection.kind === "unresolved") {
              await publishCommunityReply(
                () => ctx.reply(
                  "No pude identificar un perfil para esa solicitud. Puedes pedir contenido sin indicar un perfil específico.",
                  { reply_to_message_id: ctx.message!.message_id },
                ),
                store,
                ctx.chat.id,
                ctx.from?.id,
              );
              return;
            }
            const mediaModel = selection.kind === "profile" &&
                selection.model.media.length > 0
              ? selection.model
              : undefined;
            const media = mediaModel?.media[0];
            if (media) {
              const caption =
                `✨ ${mediaModel.displayName} · perfil verificado activo en este grupo.`;
              try {
                const options = {
                  caption,
                  reply_to_message_id: ctx.message.message_id,
                };
                const sent = await publishCommunityReply(async () => {
                  if (media.type === "video") {
                    await ctx.replyWithVideo(media.fileId, options);
                  } else if (media.type === "document") {
                    await ctx.replyWithDocument(media.fileId, options);
                  } else {
                    await ctx.replyWithPhoto(media.fileId, options);
                  }
                }, store, ctx.chat.id, ctx.from?.id);
                if (!sent) return;
                return;
              } catch (error) {
                console.warn(
                  `[AFRODITA] No se confirmó el envío multimedia; no se reintentará para evitar duplicados (${errorName(error)}).`,
                );
                return;
              }
            }
            const unavailableText = selection.kind === "profile" &&
                selection.source === "requested"
              ? "No hay archivos multimedia autorizados asociados a ese perfil ahora."
              : `${responseText} No hay archivos multimedia autorizados asociados disponibles ahora.`;
            await publishCommunityReply(
              () => ctx.reply(
                unavailableText,
                { reply_to_message_id: ctx.message!.message_id },
              ),
              store,
              ctx.chat.id,
              ctx.from?.id,
            );
            return;
          }
          await publishCommunityReply(
            () => ctx.reply(responseText, {
              reply_to_message_id: ctx.message!.message_id,
            }),
            store,
            ctx.chat.id,
            ctx.from?.id,
          );
          return;
        }
      } catch (error) {
        console.error(
          `[AFRODITA] No se pudieron consultar modelos verificadas groupId=${ctx.chat.id} (${errorName(error)}).`,
        );
      }
      await publishCommunityReply(
        () => ctx.reply(
          models
            ? verifiedModelsReply(models)
            : "Ahora mismo no puedo confirmar qué perfiles o catálogos están activos. Inténtalo de nuevo más tarde. 💫",
          { reply_to_message_id: ctx.message!.message_id },
        ),
        store,
        ctx.chat.id,
        ctx.from?.id,
      );
      return;
    }
    const generated = await generateReply(source, decision.topic, {
      endpoint: aiConfig.endpoint,
      apiKey: aiConfig.apiKey,
      model: aiConfig.model,
    }, Math.random(), fetcher);
    if (generated.silent || !generated.text) return;
    await publishCommunityReply(() => ctx.reply(generated.text!, {
      reply_to_message_id: decision.action === "reply"
        ? ctx.message!.message_id
        : undefined,
    }), store, ctx.chat.id, ctx.from?.id);
    return;
  }

  if (decision.action === "poll") {
    const dateSalt = new Date().toISOString().slice(0, 10);
    let content = entertainmentPollContent(decision.topic, Math.random(), dateSalt);
    try {
      // Encuesta personalizada: solo perfiles YA en la lista de verificadas
      // (lista = autorizacion; catalogo de ZEUS si esta disponible).
      const eligible = await resolvePromotionProfiles(
        store,
        ctx.api,
        ctx.chat.id,
        aiConfig,
        fetcher,
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
                ...(stored?.username ? { username: stored.username } : {}),
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
    );
  }
}


async function setGroupEnabled(ctx: Context, store: AfroditaStore, enabled: boolean): Promise<void> {
  if (!isGroup(ctx) || !ctx.from) {
    await ctx.reply("Este ajuste solo está disponible en un grupo.");
    return;
  }
  if (!(await requireGroupAdministrator(ctx, ctx.chat.id))) return;
  try {
    await store.setEnabled(ctx.chat.id, enabled);
  } catch (error) {
    console.error(`[AFRODITA] No se pudo guardar el ajuste del grupo (${errorName(error)}).`);
    await ctx.reply("No pude guardar el ajuste del grupo. Inténtalo de nuevo más tarde.");
    return;
  }
  await ctx.reply(enabled
    ? "Afrodita está activa 💫 Usaré límites conservadores y puedes pausarme con /afrodita_pausar. Este grupo debe ser solo para personas adultas (18+)."
    : "Afrodita quedó en pausa; no analizaré mensajes nuevos de este grupo.");
}
export interface AfroditaApplicationDependencies {
  config: AfroditaConfig;
  bot?: Bot;
  createBot?: (token: string) => Bot;
  store?: AfroditaStore;
  scheduler?: Pick<PublicationScheduler, "start" | "stop"> | null;
  fetcher?: typeof fetch;
  shutdownSignals?: EventEmitter;
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
      ),
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
          "la propia persona puede autorizar o retirar su consentimiento promocional con /afrodita_autorizar_promocion y /afrodita_retirar_promocion, " +
          "y una persona administradora puede retirar un perfil con /afrodita_ocultar. " +
          "Usa /menu en el grupo para abrir el panel administrativo. Mis métricas son agregadas y no guardo el texto de la charla.",
      );
    });
    bot.command("menu", async (ctx) => showAdminMenu(ctx, store));
    bot.command("afrodita_activar", async (ctx) => setGroupEnabled(ctx, store, true));
    bot.command("afrodita_pausar", async (ctx) => setGroupEnabled(ctx, store, false));
    bot.command("afrodita_autorizar_promocion", async (ctx) =>
      setPromotionConsent(ctx, store, {
        supabaseUrl: config.supabaseUrl,
        supabaseKey: config.supabaseKey,
      }, true, fetcher),
    );
    bot.command("afrodita_retirar_promocion", async (ctx) =>
      setPromotionConsent(ctx, store, {
        supabaseUrl: config.supabaseUrl,
        supabaseKey: config.supabaseKey,
      }, false, fetcher),
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
        const handle = profile.username ? `@${profile.username}` : "(sin username)";
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
    if (!isGroup(ctx) || !ctx.message || !ctx.from || ctx.from.is_bot) return;
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
      if (!state.enabled) return false;
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
    }, fetcher);
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
