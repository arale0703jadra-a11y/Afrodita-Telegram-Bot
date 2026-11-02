import { InlineKeyboard, type Context } from "grammy";
import { checkGroupAdministrator } from "./permissions.js";
import type { AfroditaStore } from "./store.js";
import {
  PUBLICATION_CATEGORIES,
  type AfroditaState,
  type PublicationCategory,
} from "./types.js";

const CATEGORY_LABELS: Record<PublicationCategory, string> = {
  verified_promotion: "Promociones",
  commercial_poll: "Encuestas",
  seasonal_campaign: "Campañas",
  community_reply: "Respuestas",
};

const TIME_ZONES = [
  "UTC",
  "America/Mexico_City",
  "America/Bogota",
  "America/Argentina/Buenos_Aires",
];

/**
 * Aviso de reubicación: la administración de AFRODITA se centralizó en el
 * panel privado de ZEUS (sección 🌸 AFRODITA). El panel grupal quedó retirado.
 */
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


function mainKeyboard(state: AfroditaState): InlineKeyboard {
  const keyboard = new InlineKeyboard()
    .text(state.enabled ? "Pausar todo" : "Reanudar bot", "af:toggle:all")
    .row();
  for (const category of PUBLICATION_CATEGORIES) {
    keyboard.text(CATEGORY_LABELS[category], `af:view:${category}`).row();
  }
  keyboard.text(`Zona: ${state.timeZone}`, "af:timezone");
  for (const category of PUBLICATION_CATEGORIES) {
    keyboard.row()
      .text(
        `${CATEGORY_LABELS[category]} ${state.publications[category].enabled ? "✓" : "⏸"}`,
        `af:toggle:${category}:enabled`,
      )
      .text("Horario", `af:schedule:${category}`)
      .text("Actividad", `af:toggle:${category}:activity`);
  }
  keyboard.row()
    .text(`Encuestas: máx. ${state.publications.commercial_poll.maxPerDay}/día`,
      "af:quota:commercial_poll")
    .text("Refrescar", "af:main");
  return keyboard;
}

function renderStatus(state: AfroditaState): string {
  const lines = [
    `AFRODITA: ${state.enabled ? "activa" : "pausada"}`,
    `Contenido adulto: ${state.adultConfirmedAt ? "confirmado por administración" : "desactivado"}`,
    `Zona horaria: ${state.timeZone}`,
    "",
  ];
  for (const category of PUBLICATION_CATEGORIES) {
    const settings = state.publications[category];
    lines.push(
      `${CATEGORY_LABELS[category]}: ${settings.enabled ? "activa" : "pausada"} · ` +
      `hoy ${settings.publishedToday}/${settings.maxPerDay} · ` +
      `horarios ${settings.scheduleTimes.join(", ") || "sin programación"} · ` +
      `programado ${settings.scheduledEnabled ? "sí" : "no"} · ` +
      `actividad ${settings.activityEnabled ? "sí" : "no"}`,
    );
  }
  lines.push(
    "",
    `Perfiles en la lista de verificadas: ${Object.keys(state.authorizedProfiles).length} · Consentimientos legacy: ${Object.keys(state.promotionConsents).length}`,
    "Usa /afrodita_adulto confirmar o /afrodita_adulto retirar para cambiar la autorización adulta.",
    "Los rechazos definitivos liberan la cuota y respetan el intervalo mínimo antes de reintentar; los resultados ambiguos conservan la cuota.",
  );
  return lines.join("\n");
}

function renderCategory(state: AfroditaState, category: PublicationCategory): string {
  const settings = state.publications[category];
  return [
    CATEGORY_LABELS[category],
    `Estado: ${settings.enabled ? "activa" : "pausada"}`,
    `Programación: ${settings.scheduledEnabled ? "activa" : "pausada"}`,
    `Actividad: ${settings.activityEnabled ? "activa" : "pausada"}`,
    `Cuota hoy: ${settings.publishedToday}/${settings.maxPerDay}`,
    `Intervalo mínimo: ${Math.round(settings.minIntervalMs / 60_000)} min`,
    `Horarios (${state.timeZone}): ${settings.scheduleTimes.join(", ") || "sin programación"}`,
    `Última publicación: ${settings.lastPublishedAt ? new Date(settings.lastPublishedAt).toISOString() : "ninguna"}`,
  ].join("\n");
}

function categoryKeyboard(
  state: AfroditaState,
  category: PublicationCategory,
): InlineKeyboard {
  const settings = state.publications[category];
  const keyboard = new InlineKeyboard()
    .text(settings.enabled ? "Pausar categoría" : "Activar categoría",
      `af:toggle:${category}:enabled`)
    .row()
    .text(settings.scheduledEnabled ? "Pausar horario" : "Activar horario",
      `af:toggle:${category}:scheduled`)
    .text(settings.activityEnabled ? "Pausar actividad" : "Activar actividad",
      `af:toggle:${category}:activity`)
    .row()
    .text("Cambiar horarios", `af:schedule:${category}`);
  if (category === "commercial_poll") {
    keyboard.row().text(`Cambiar máximo (${settings.maxPerDay}/día)`,
      "af:quota:commercial_poll");
  } else if (category === "verified_promotion") {
    keyboard.row().text(`Cambiar máximo (${settings.maxPerDay}/día)`,
      "af:quota:verified_promotion");
  }
  keyboard.row()
    .text(`Cambiar intervalo (${Math.round(settings.minIntervalMs / 3_600_000)} h)`,
      `af:interval:${category}`)
    .text("Volver", "af:main");
  return keyboard;
}

function rotateTime(
  current: string[],
  category: PublicationCategory,
): string[] {
  const presets: Record<PublicationCategory, string[][]> = {
    verified_promotion: [
      ["12:00", "20:00"],
      ["10:00", "16:00", "21:00"],
      ["09:00", "15:00", "20:00"],
    ],
    commercial_poll: [
      ["11:00", "16:00", "21:00"],
      ["10:00", "15:00", "20:00"],
      ["12:00", "18:00"],
    ],
    seasonal_campaign: [["18:00"], ["12:00"], ["20:00"]],
    community_reply: [[], ["12:00"], ["20:00"]],
  };
  const variants = presets[category];
  const index = variants.findIndex((times) =>
    times.length === current.length &&
    times.every((time, position) => time === current[position])
  );
  return [...variants[(index + 1 + variants.length) % variants.length]!];
}

function safeErrorType(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  return /^[A-Za-z][A-Za-z0-9]{0,47}$/.test(name) ? name : "unknown";
}
