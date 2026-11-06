import { randomUUID } from "node:crypto";
import { recordPublishedAction } from "./decision.js";
import type { AfroditaStore } from "./store.js";
import type { PublicationCategory } from "./types.js";
import { localDateTime } from "./time.js";

const MAX_ACTIVE_RESERVATION_MS = 30 * 60 * 1000;

export type PublicationTrigger =
  | {
      kind: "activity";
      userId?: number;
      templateId?: string;
      pollTheme?: "intimacy" | "market";
    }
  | {
      kind: "scheduled";
      slotKey: string;
      userId?: number;
      templateId?: string;
      pollTheme?: "intimacy" | "market";
    };

export interface PublicationReservation {
  id: string;
  category: PublicationCategory;
  chatId: number;
  userId?: number;
}

export type PublicationOutcome = "published" | "failed" | "unknown";

export function classifyPublicationFailure(error: unknown): PublicationOutcome {
  if (
    typeof error === "object" &&
    error !== null &&
    "error_code" in error &&
    typeof error.error_code === "number" &&
    Number.isInteger(error.error_code) &&
    error.error_code >= 400 &&
    error.error_code < 500
  ) {
    return "failed";
  }
  return "unknown";
}

export async function reservePublication(
  store: AfroditaStore,
  chatId: number,
  category: PublicationCategory,
  trigger: PublicationTrigger,
  canPublish: () => boolean,
  now = Date.now(),
): Promise<PublicationReservation | undefined> {
  // Control único global: sin `canPublish` (estado global running) no se
  // reserva ninguna actividad. Los flags legacy por grupo/categoría ya no
  // participan en esta decisión.
  if (!canPublish()) return undefined;
  const id = randomUUID();
  const updated = await store.updateGroup(chatId, (state) => {
    // quietUntil es una lógica interna con caducidad automática (no es un
    // control de pausa manual) y se conserva.
    if (now < state.quietUntil) {
      return false;
    }
    const settings = state.publications[category];
    if (
      category === "commercial_poll" ||
      category === "seasonal_campaign"
    ) {
      const activePollReservation = (
        ["commercial_poll", "seasonal_campaign"] as const
      ).some((pollCategory) =>
        state.publications[pollCategory].history.some((entry) =>
          entry.status === "reserved" &&
          now - entry.at < MAX_ACTIVE_RESERVATION_MS,
        ),
      );
      if (activePollReservation) return false;
    }
    const local = localDateTime(now, state.timeZone);
    for (const entry of settings.history) {
      if (
        entry.status === "reserved" &&
        now - entry.at >= MAX_ACTIVE_RESERVATION_MS
      ) {
        entry.status = "unknown";
        delete entry.previousPublishedAt;
      }
    }
    if (settings.history.some((entry) =>
      entry.status === "reserved" &&
      entry.id !== id &&
      now - entry.at < MAX_ACTIVE_RESERVATION_MS
    )) return false;
    if (
      trigger.userId !== undefined &&
      settings.history.some((entry) =>
        entry.status === "unknown" &&
        entry.subjectId === trigger.userId
      )
    ) return false;
    if (settings.history.some((entry) =>
      entry.status === "failed" &&
      now - entry.at < settings.minIntervalMs
    )) return false;
    if (settings.utcDay !== local.date) {
      settings.utcDay = local.date;
      settings.publishedToday = 0;
    }
    if (settings.publishedToday >= settings.maxPerDay) return false;
    if (
      category === "commercial_poll" ||
      category === "seasonal_campaign"
    ) {
      const pollsToday = (
        ["commercial_poll", "seasonal_campaign"] as const
      ).reduce((total, pollCategory) => {
        const pollSettings = state.publications[pollCategory];
        return total +
          (pollSettings.utcDay === local.date ? pollSettings.publishedToday : 0);
      }, 0);
      if (pollsToday >= state.publications.commercial_poll.maxPerDay) {
        return false;
      }
    }
    const lastCategoryPollAt = Math.max(
      settings.lastPublishedAt,
      category === "commercial_poll" ? state.lastPollAt : 0,
    );
    if (
      lastCategoryPollAt > 0 &&
      now - lastCategoryPollAt < settings.minIntervalMs
    ) return false;

    let scheduledKey: string | undefined;
    if (trigger.kind === "scheduled") {
      scheduledKey = trigger.slotKey;
      if (
        settings.lastScheduledKey === scheduledKey ||
        settings.history.some((entry) => entry.scheduledKey === scheduledKey)
      ) return false;
      settings.lastScheduledKey = scheduledKey;
    }

    if (category === "community_reply") {
      const hourKey = local.hourKey;
      if (state.communityReplyUtcHour !== hourKey) {
        state.communityReplyUtcHour = hourKey;
        state.communityRepliesThisHour = 0;
      }
      if (state.communityRepliesThisHour >= 3) return false;
      if (
        trigger.kind === "activity" &&
        trigger.userId !== undefined &&
        (state.communityReplyUserCooldowns[String(trigger.userId)] ?? 0) > now
      ) return false;
      state.communityRepliesThisHour += 1;
    }
    if (
      category === "verified_promotion" &&
      trigger.userId !== undefined &&
      !state.authorizedProfiles[String(trigger.userId)]
    ) return false;

    settings.publishedToday += 1;
    settings.history.push({
      id,
      at: now,
      status: "reserved",
      ...(scheduledKey ? { scheduledKey } : {}),
      ...(trigger.kind === "activity" && trigger.userId !== undefined
        ? { subjectId: trigger.userId }
        : {}),
      ...(trigger.kind === "scheduled" && trigger.userId !== undefined
        ? { subjectId: trigger.userId }
        : {}),
      ...(trigger.templateId ? { templateId: trigger.templateId } : {}),
      ...(trigger.pollTheme ? { pollTheme: trigger.pollTheme } : {}),
      previousPublishedAt: settings.lastPublishedAt,
    });
    settings.history = settings.history.slice(-60);
    settings.lastPublishedAt = now;
    return true;
  });
  return updated.result ? { id, category, chatId,
    ...(trigger.userId !== undefined
      ? { userId: trigger.userId }
      : {}),
  } : undefined;
}

export async function finalizePublication(
  store: AfroditaStore,
  reservation: PublicationReservation,
  outcome: PublicationOutcome,
  now = Date.now(),
): Promise<void> {
  await store.updateGroup(reservation.chatId, (state) => {
    const settings = state.publications[reservation.category];
    const entry = settings.history.find((item) =>
      item.id === reservation.id && item.status === "reserved"
    );
    if (!entry) return;
    entry.status = outcome;
    if (outcome === "failed") {
      settings.publishedToday = Math.max(0, settings.publishedToday - 1);
      settings.lastPublishedAt = entry.previousPublishedAt ?? 0;
      delete entry.previousPublishedAt;
      if (reservation.category === "community_reply") {
        state.communityRepliesThisHour = Math.max(
          0,
          state.communityRepliesThisHour - 1,
        );
      }
      return;
    }
    if (outcome === "published") {
      settings.lastPublishedAt = now;
      delete entry.previousPublishedAt;
      if (
        reservation.category === "commercial_poll" ||
        reservation.category === "seasonal_campaign"
      ) {
        state.lastPollAt = now;
        state.messagesSincePoll = 0;
      }
      if (reservation.category === "verified_promotion") {
        state.lastProfileAt = now;
        state.messagesSincePromotion = 0;
      }
      if (reservation.category === "community_reply") {
        state.communityReplyLastAt = now;
        if (reservation.userId !== undefined) {
          recordPublishedAction(state, "reply", now);
          state.communityReplyUserCooldowns[String(reservation.userId)] =
            now + 2 * 60 * 60 * 1000;
        }
      }
    } else if (outcome === "unknown") {
      delete entry.previousPublishedAt;
    }
  });
}

export async function recordPromotedProfile(
  store: AfroditaStore,
  chatId: number,
  userId: number,
): Promise<void> {
  await store.updateGroup(chatId, (state) => {
    state.recentPromotedUserIds = [
      ...state.recentPromotedUserIds.filter((id) => id !== userId),
      userId,
    ].slice(-40);
  });
}
