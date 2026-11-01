import type { AfroditaStore } from "./store.js";
import { localDateTime } from "./time.js";
import { seasonalPollForDate } from "./seasonal-campaigns.js";
import {
  PUBLICATION_CATEGORIES,
  type AfroditaState,
  type PublicationCategory,
} from "./types.js";

export interface ScheduledPublication {
  chatId: number;
  category: PublicationCategory;
  slotKey: string;
}

export function getDuePublications(
  chatId: number,
  state: AfroditaState,
  now: number,
): ScheduledPublication[] {
  if (!state.enabled || state.activityPaused || now < state.quietUntil) return [];
  const { date, time } = localDateTime(now, state.timeZone);
  return PUBLICATION_CATEGORIES.flatMap((category) => {
    const settings = state.publications[category];
    const publishedToday = settings.utcDay === date
      ? settings.publishedToday
      : 0;
    if (
      !settings.enabled ||
      !settings.scheduledEnabled ||
      !settings.scheduleTimes.includes(time) ||
      publishedToday >= settings.maxPerDay ||
      (settings.lastPublishedAt > 0 &&
        now - settings.lastPublishedAt < settings.minIntervalMs)
    ) return [];
    if (
      category === "seasonal_campaign" &&
      !seasonalPollForDate(date)
    ) return [];
    const slotKey = `${category}:${date}:${time}`;
    if (
      settings.lastScheduledKey === slotKey ||
      settings.history.some((entry) => entry.scheduledKey === slotKey)
    ) return [];
    return [{ chatId, category, slotKey }];
  });
}

export class PublicationScheduler {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private readonly startedAt: number;

  constructor(
    private readonly store: AfroditaStore,
    private readonly publish: (job: ScheduledPublication) => Promise<void>,
    private readonly logError: (message: string) => void = (message) =>
      console.error(message),
    private readonly now: () => number = Date.now,
  ) {
    this.startedAt = now();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.scheduleNext();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  async tick(now = this.now()): Promise<void> {
    const firstCompleteMinute =
      Math.floor(this.startedAt / 60_000) * 60_000 + 60_000;
    if (now < firstCompleteMinute) return;
    let groupIds: number[];
    try {
      groupIds = await this.store.listGroupIds();
    } catch (error) {
      this.logError(
        `[AFRODITA] No se pudieron enumerar grupos para el scheduler (${safeErrorType(error)}).`,
      );
      return;
    }
    for (const chatId of groupIds) {
      try {
        const state = await this.store.loadGroup(chatId);
        for (const job of getDuePublications(chatId, state, now)) {
          try {
            await this.publish(job);
          } catch (error) {
            this.logError(
              `[AFRODITA] Falló una publicación programada category=${job.category} groupId=${chatId} (${safeErrorType(error)}).`,
            );
          }
        }
      } catch (error) {
        this.logError(
          `[AFRODITA] No se pudo procesar el scheduler groupId=${chatId} (${safeErrorType(error)}).`,
        );
      }
    }
  }

  private scheduleNext(): void {
    if (!this.running) return;
    const now = this.now();
    const delay = 60_000 - (now % 60_000);
    this.timer = setTimeout(() => {
      void this.tick().finally(() => this.scheduleNext());
    }, delay);
  }
}

function safeErrorType(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  return /^[A-Za-z][A-Za-z0-9]{0,47}$/u.test(name) ? name : "unknown";
}
