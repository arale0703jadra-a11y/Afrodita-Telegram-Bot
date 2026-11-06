import type { Context } from "grammy";
import type { AfroditaStore } from "./store.js";

const ZEUS_PANEL_NOTICE =
  "🌸 La administración de AFRODITA ahora vive en el panel privado de ZEUS. " +
  "Habla con ZEUS en privado y usa /menu → 🌸 AFRODITA para ver el resumen, " +
  "publicaciones, encuestas, menciones, grupos, programación, historial y " +
  "configuración de este grupo.";

const ZEUS_PANEL_CALLBACK_NOTICE =
  "🌸 El panel de AFRODITA se movió al panel privado de ZEUS (/menu → 🌸 AFRODITA).";

export async function showAdminMenu(
  ctx: Context,
  store: AfroditaStore,
): Promise<void> {
  await ctx.reply(ZEUS_PANEL_NOTICE);
}

export async function handleAdminMenuCallback(
  ctx: Context,
  store: AfroditaStore,
): Promise<void> {
  const query = ctx.callbackQuery;
  if (!query || !ctx.chat ||
    (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup")) {
    await ctx.answerCallbackQuery({ text: "Este panel solo funciona en el grupo." });
    return;
  }
  if (!("data" in query) || typeof query.data !== "string") {
    await ctx.answerCallbackQuery({ text: "Este botón ya no es válido." });
    return;
  }
  // Toda operación de administración fue centralizada en ZEUS: este panel ya
  // no aplica cambios; solo informa dónde vive ahora la administración.
  await ctx.answerCallbackQuery({
    text: ZEUS_PANEL_CALLBACK_NOTICE,
    show_alert: true,
  });
}
