import "dotenv/config";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Bot } from "grammy";
import type { Context } from "grammy";
import { observeMessage } from "./analytics.js";
import { AfroditaConfigError, loadAfroditaConfig } from "./config.js";
import { decideAction, recordPublishedAction, canPublish } from "./decision.js";
import { safeErrorSummary, safeErrorType } from "./errors.js";
import { generateReply } from "./generator.js";
import {
  isCommercialInquiry,
  isExplicitMediaRequest,
  findRequestedVerifiedModel,
  pollContent,
  verifiedModelsPollContent,
  verifiedModelsReply,
} from "./messages.js";
import { checkGroupAdministrator } from "./permissions.js";
import { AfroditaStore } from "./store.js";
import { installGracefulShutdown } from "./shutdown.js";
import type { AfroditaDecision, AfroditaTopic, AuthorizedProfile } from "./types.js";
import { getActiveVerifiedModels } from "./verified-users.js";
import { readZeusVerification } from "./zeus-verification.js";

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
  const text = message.text ?? message.caption ?? "";
  return new RegExp(`@${botUsername.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "iu").test(text);
}

function removeBotMention(text: string, botUsername: string): string {
  return text.replace(
    new RegExp(`@${botUsername.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "giu"),
    "",
  ).trim().slice(0, 600);
}

const zeusStorageDirectory = process.env.AFRODITA_ZEUS_STORAGE_DIR?.trim() ||
  resolve(dirname(fileURLToPath(import.meta.url)), "../../ZEUS/data/storage");
let warnedUnavailableZeusStorage = false;

async function isVerifiedInZeusStore(
  chatId: number,
  userId: number,
): ReturnType<typeof readZeusVerification> {
  const result = await readZeusVerification(zeusStorageDirectory, chatId, userId);
  if (result.status === "unavailable" && !warnedUnavailableZeusStorage) {
    console.warn(
      `[AFRODITA] El almacén local de ZEUS no está disponible (${result.reason}); los perfiles fallarán de forma segura.`,
    );
    warnedUnavailableZeusStorage = true;
  }
  return result;
}

async function approveProfile(ctx: Context, store: AfroditaStore): Promise<void> {
  if (!isGroup(ctx) || !ctx.message || !ctx.from) return;
  if (!(await requireGroupAdministrator(ctx, ctx.chat.id))) return;
  const target = ctx.message.reply_to_message?.from;
  if (!target || target.is_bot) {
    await ctx.reply("Responde al mensaje de una creadora verificada para autorizar su perfil.");
    return;
  }
  const verification = await isVerifiedInZeusStore(ctx.chat.id, target.id);
  if (verification.status === "unavailable") {
    await ctx.reply("No pude consultar el registro local de ZEUS; no autoricé el perfil.");
    return;
  }
  if (verification.status !== "verified") {
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

async function reserveAction(
  store: AfroditaStore,
  chatId: number,
  decision: AfroditaDecision,
): Promise<boolean> {
  const now = Date.now();
  const updated = await store.updateGroup(chatId, (state) => {
    if (!canPublish(state, decision.action, now)) return false;
    recordPublishedAction(state, decision.action, now);
    return true;
  });
  return updated.result;
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
          models = await getActiveVerifiedModels(ctx.chat.id, {
            supabaseUrl: aiConfig.supabaseUrl,
            supabaseKey: aiConfig.supabaseKey,
          });
        }
        if (models?.length) {
          const responseText = verifiedModelsReply(models);
          if (!(await reserveAction(store, ctx.chat.id, decision))) return;
          if (isExplicitMediaRequest(source)) {
            const requestedModel = findRequestedVerifiedModel(source, models);
            const mediaModel = requestedModel
              ? requestedModel
              : models.find((model) => model.media.length > 0);
            const media = mediaModel?.media[0];
            if (media) {
              const caption =
                `✨ ${mediaModel.displayName} · perfil verificado activo en este grupo.`;
              try {
                const options = {
                  caption,
                  reply_to_message_id: ctx.message.message_id,
                };
                if (media.type === "video") {
                  await ctx.replyWithVideo(media.fileId, options);
                } else if (media.type === "document") {
                  await ctx.replyWithDocument(media.fileId, options);
                } else {
                  await ctx.replyWithPhoto(media.fileId, options);
                }
                return;
              } catch (error) {
                console.warn(
                  `[AFRODITA] No se pudo enviar el multimedia asociado a una verificada (${errorName(error)}); se responderá con texto.`,
                );
                await ctx.reply(
                  `${responseText} No pude mostrar el archivo multimedia en este momento.`,
                  { reply_to_message_id: ctx.message.message_id },
                );
                return;
              }
            }
            await ctx.reply(
              `${responseText} No hay archivos multimedia autorizados asociados disponibles ahora.`,
              { reply_to_message_id: ctx.message.message_id },
            );
            return;
          }
          await ctx.reply(responseText, {
            reply_to_message_id: ctx.message.message_id,
          });
          return;
        }
      } catch (error) {
        console.error(
          `[AFRODITA] No se pudieron consultar modelos verificadas groupId=${ctx.chat.id} (${errorName(error)}).`,
        );
      }
      if (!(await reserveAction(store, ctx.chat.id, decision))) return;
      await ctx.reply(
        models
          ? verifiedModelsReply(models)
          : "Ahora mismo no puedo confirmar qué perfiles o catálogos están activos. Inténtalo de nuevo más tarde. 💫",
        { reply_to_message_id: ctx.message.message_id },
      );
      return;
    }
    const generated = await generateReply(source, decision.topic, {
      endpoint: aiConfig.endpoint,
      apiKey: aiConfig.apiKey,
      model: aiConfig.model,
    });
    if (generated.silent || !generated.text) return;
    if (!(await reserveAction(store, ctx.chat.id, decision))) return;
    await ctx.reply(generated.text, {
      reply_to_message_id: decision.action === "reply" ? ctx.message.message_id : undefined,
    });
    return;
  }

  if (decision.action === "poll") {
    if (!(await reserveAction(store, ctx.chat.id, decision))) return;
    let content = pollContent(decision.topic);
    if (aiConfig.supabaseUrl && aiConfig.supabaseKey) {
      try {
        const models = await getActiveVerifiedModels(ctx.chat.id, {
          supabaseUrl: aiConfig.supabaseUrl,
          supabaseKey: aiConfig.supabaseKey,
        });
        if (models.length > 0) {
          content = verifiedModelsPollContent(decision.topic, models);
        }
      } catch (error) {
        console.error(
          `[AFRODITA] No se pudieron consultar modelos para la encuesta groupId=${ctx.chat.id} (${errorName(error)}).`,
        );
      }
    }
    const sent = await ctx.api.sendPoll(ctx.chat.id, content.question, content.options, {
      is_anonymous: true,
      open_period: 3_600,
    });
    await store.registerPoll(ctx.chat.id, sent.poll.id, content.topics);
    return;
  }

  if (decision.action === "profile") {
    const verification = await isVerifiedInZeusStore(ctx.chat.id, decision.profile.userId);
    if (verification.status === "not_verified") {
      await store.removeProfile(ctx.chat.id, decision.profile.userId);
      return;
    }
    if (verification.status === "unavailable") return;
    let member;
    try {
      member = await ctx.api.getChatMember(ctx.chat.id, decision.profile.userId);
    } catch (error) {
      console.warn(
        `[AFRODITA] No se pudo revalidar la membresía del perfil (${errorName(error)}).`,
      );
      return;
    }
    if (!isActiveMember(member)) {
      await store.removeProfile(ctx.chat.id, decision.profile.userId);
      return;
    }
    if (!(await reserveAction(store, ctx.chat.id, decision))) return;
    const currentUser = member.user;
    const currentName = [currentUser.first_name, currentUser.last_name].filter(Boolean).join(" ");
    const identity = currentUser.username ? `@${currentUser.username}` : currentName;
    await ctx.reply(
      `✨ Creadora verificada y autorizada del grupo: ${identity || decision.profile.displayName}`,
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
    ? "Afrodita está activa 💫 Usaré límites conservadores y puedes pausarme con /afrodita_pausar."
    : "Afrodita quedó en pausa; no analizaré mensajes nuevos de este grupo.");
}

async function main(): Promise<void> {
  const config = loadAfroditaConfig();
  const bot = new Bot(config.botToken);
  const store = new AfroditaStore(config.dataDirectory);

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
        "o retirarlo con /afrodita_ocultar. Mis métricas son agregadas y no guardo el texto de la charla.",
    );
  });
  bot.command("afrodita_activar", async (ctx) => setGroupEnabled(ctx, store, true));
  bot.command("afrodita_pausar", async (ctx) => setGroupEnabled(ctx, store, false));
  bot.command("afrodita_perfil", async (ctx) => approveProfile(ctx, store));
  bot.command("afrodita_ocultar", async (ctx) => revokeProfile(ctx, store));

  bot.on("poll", async (ctx) => {
    const poll = ctx.poll;
    await store.recordPollUpdate(
      poll.id,
      poll.options.map((option) => ({ voter_count: option.voter_count })),
    );
  });

  bot.on("message", async (ctx) => {
    if (!isGroup(ctx) || !ctx.message || !ctx.from || ctx.from.is_bot) return;
    const now = Date.now();
    const username = bot.botInfo.username;
    const directed = directedMessage(ctx, username, bot.botInfo.id);
    const text = ctx.message.text ?? ctx.message.caption ?? "";
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
    });
  });

  const removeShutdownHandlers = installGracefulShutdown(bot);
  try {
    await bot.start({
      allowed_updates: ["message", "poll"],
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
    removeShutdownHandlers();
  }
}

function errorName(error: unknown): string {
  return safeErrorType(error);
}

void main().catch((error: unknown) => {
  console.error(
    `[AFRODITA] No se pudo iniciar: ${
      error instanceof AfroditaConfigError
        ? error.message
        : `(${safeErrorSummary(error)})`
    }.`,
  );
  process.exitCode = 1;
});
