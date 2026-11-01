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

export async function showAdminMenu(
  ctx: Context,
  store: AfroditaStore,
): Promise<void> {
  if (!ctx.chat || (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup")) {
    await ctx.reply("Abre /menu dentro del grupo que quieres administrar.");
    return;
  }
  if (!ctx.from) return;
  const check = await checkGroupAdministrator(ctx.api, ctx.chat.id, ctx.from.id);
  if (check.status !== "administrator") {
    await ctx.reply(check.status === "unavailable"
      ? "No pude verificar tus permisos con Telegram."
      : "Solo una persona administradora del grupo puede abrir este panel.");
    return;
  }
  let state: AfroditaState;
  try {
    state = await store.loadGroup(ctx.chat.id);
  } catch (error) {
    console.error(
      `[AFRODITA] No se pudo leer el estado del panel groupId=${ctx.chat.id} (${safeErrorType(error)}).`,
    );
    await ctx.reply("No pude cargar el estado de AFRODITA. Inténtalo de nuevo más tarde.");
    return;
  }
  await ctx.reply(renderStatus(state), { reply_markup: mainKeyboard(state) });
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
  const check = ctx.from
    ? await checkGroupAdministrator(ctx.api, ctx.chat.id, ctx.from.id)
    : { status: "not_administrator" as const };
  if (check.status !== "administrator") {
    await ctx.answerCallbackQuery({
      text: check.status === "unavailable"
        ? "No pude verificar tus permisos."
        : "Solo administradores pueden cambiar estos ajustes.",
      show_alert: true,
    });
    return;
  }

  const data = query.data;
  if (data === "af:main") {
    try {
      const state = await store.loadGroup(ctx.chat.id);
      await ctx.editMessageText(renderStatus(state), {
        reply_markup: mainKeyboard(state),
      });
      await ctx.answerCallbackQuery({ text: "Panel actualizado." });
    } catch (error) {
      console.error(
        `[AFRODITA] No se pudo actualizar el panel groupId=${ctx.chat.id} (${safeErrorType(error)}).`,
      );
      await ctx.answerCallbackQuery({
        text: "No pude actualizar el panel. Inténtalo de nuevo.",
        show_alert: true,
      });
    }
    return;
  }

  try {
    if (data === "af:toggle:all") {
      const state = await store.loadGroup(ctx.chat.id);
      await store.setEnabled(ctx.chat.id, !state.enabled);
    } else if (data === "af:timezone") {
      const state = await store.loadGroup(ctx.chat.id);
      const index = TIME_ZONES.indexOf(state.timeZone);
      await store.setTimeZone(
        ctx.chat.id,
        TIME_ZONES[(index + 1) % TIME_ZONES.length]!,
      );
    } else {
      const parts = data.split(":");
      if (parts[0] !== "af" || parts.length < 3) {
        await ctx.answerCallbackQuery({ text: "Este botón ya no es válido." });
        return;
      }
      const category = parts[2] as PublicationCategory;
      if (!PUBLICATION_CATEGORIES.includes(category)) {
        await ctx.answerCallbackQuery({ text: "Este botón ya no es válido." });
        return;
      }
      const action = parts[1];
      if (action === "view") {
        try {
          const state = await store.loadGroup(ctx.chat.id);
          await ctx.editMessageText(renderCategory(state, category), {
            reply_markup: categoryKeyboard(state, category),
          });
          await ctx.answerCallbackQuery();
        } catch (error) {
          console.error(
            `[AFRODITA] No se pudo cargar una categoría del panel groupId=${ctx.chat.id} (${safeErrorType(error)}).`,
          );
          await ctx.answerCallbackQuery({
            text: "No pude cargar esa categoría. Inténtalo de nuevo.",
            show_alert: true,
          });
        }
        return;
      } else if (action === "toggle" && parts[3] === "enabled") {
        await store.updatePublicationSettings(ctx.chat.id, category, (settings) => {
          settings.enabled = !settings.enabled;
        });
      } else if (action === "toggle" && parts[3] === "scheduled") {
        await store.updatePublicationSettings(ctx.chat.id, category, (settings) => {
          settings.scheduledEnabled = !settings.scheduledEnabled;
        });
      } else if (action === "toggle" && parts[3] === "activity") {
        await store.updatePublicationSettings(ctx.chat.id, category, (settings) => {
          settings.activityEnabled = !settings.activityEnabled;
        });
      } else if (action === "quota" && category === "commercial_poll") {
        await store.updatePublicationSettings(ctx.chat.id, category, (settings) => {
          settings.maxPerDay = settings.maxPerDay === 2 ? 3 : 2;
        });
      } else if (action === "quota" && category === "verified_promotion") {
        await store.updatePublicationSettings(ctx.chat.id, category, (settings) => {
          settings.maxPerDay = settings.maxPerDay >= 3
            ? 1
            : settings.maxPerDay + 1;
        });
      } else if (action === "interval") {
        const intervals = [2, 4, 6, 8].map((hours) => hours * 60 * 60 * 1000);
        await store.updatePublicationSettings(ctx.chat.id, category, (settings) => {
          const index = intervals.indexOf(settings.minIntervalMs);
          settings.minIntervalMs = intervals[(index + 1) % intervals.length]!;
        });
      } else if (action === "schedule") {
        await store.updatePublicationSettings(ctx.chat.id, category, (settings) => {
          settings.scheduleTimes = rotateTime(settings.scheduleTimes, category);
        });
      } else {
        await ctx.answerCallbackQuery({ text: "Este botón ya no es válido." });
        return;
      }
    }

  } catch (error) {
    console.error(
      `[AFRODITA] No se pudo guardar un ajuste del panel groupId=${ctx.chat.id} (${safeErrorType(error)}).`,
    );
    await ctx.answerCallbackQuery({
      text: "No pude guardar el ajuste. Inténtalo de nuevo.",
      show_alert: true,
    });
    return;
  }

  try {
    const state = await store.loadGroup(ctx.chat.id);
    await ctx.editMessageText(renderStatus(state), {
      reply_markup: mainKeyboard(state),
    });
    await ctx.answerCallbackQuery({ text: "Ajuste guardado." });
  } catch (error) {
    console.error(
      `[AFRODITA] Se guardó el ajuste pero no se pudo refrescar el panel groupId=${ctx.chat.id} (${safeErrorType(error)}).`,
    );
    await ctx.answerCallbackQuery({
      text: "El ajuste se guardó, pero no pude actualizar el panel. Pulsa refrescar.",
      show_alert: true,
    });
  }
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
