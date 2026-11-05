import type { AfroditaStore } from "./store.js";
import { localDateTime } from "./time.js";
import { seasonalPollForDate } from "./seasonal-campaigns.js";
import {
  MAX_SCHEDULED_POLL_LATE_MS,
  isWithinScheduledPollWindow,
  nextScheduledPollWindowTime,
  scheduledPollIntervalMs,
} from "./poll-schedule.js";
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
    if (!settings.enabled || !settings.scheduledEnabled) return [];
    if (category === "commercial_poll") {
      if (
        settings.nextScheduledAt === undefined ||
        now < settings.nextScheduledAt ||
        !isWithinScheduledPollWindow(time, settings.scheduleTimes)
      ) return [];
    } else if (!settings.scheduleTimes.includes(time)) {
      return [];
    }
    const lastPublishedAt = category === "commercial_poll" ||
        category === "seasonal_campaign"
      ? Math.max(settings.lastPublishedAt, state.lastPollAt)
      : settings.lastPublishedAt;
    if (
      publishedToday >= settings.maxPerDay ||
      (lastPublishedAt > 0 &&
        now - lastPublishedAt < settings.minIntervalMs)
    ) return [];
    if (
      category === "seasonal_campaign" &&
      !seasonalPollForDate(date)
    ) return [];
    const slotKey = category === "commercial_poll"
      ? `${category}:${Math.floor(settings.nextScheduledAt! / 60_000)}`
      : `${category}:${date}:${time}`;
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
  private ticking = false;
  private wasPaused = false;
  private readonly startedAt: number;

  constructor(
    private readonly store: AfroditaStore,
    private readonly publish: (job: ScheduledPublication) => Promise<void | boolean>,
    private readonly logError: (message: string) => void = (message) =>
      console.error(message),
    private readonly now: () => number = Date.now,
    private readonly canPublish: () => boolean = () => true,
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
    if (!this.canPublish()) {
      this.wasPaused = true;
      return;
    }
    if (this.ticking) return;
    this.ticking = true;
    try {
      if (this.wasPaused) {
        this.wasPaused = false;
        await this.rebasePollTimers(now);
        return;
      }
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
        if (!this.canPublish()) return;
        try {
          let state = await this.store.loadGroup(chatId);
          if (
            state.enabled &&
            state.publications.commercial_poll.enabled &&
            state.publications.commercial_poll.scheduledEnabled
          ) {
            state = await this.preparePollTimer(chatId, state, now);
          }
          let pollPublished = false;
          const dueJobs = getDuePublications(chatId, state, now).sort(
            (left, right) =>
              Number(right.category === "seasonal_campaign") -
              Number(left.category === "seasonal_campaign"),
          );
          for (const job of dueJobs) {
            if (
              pollPublished &&
              (job.category === "commercial_poll" ||
                job.category === "seasonal_campaign")
            ) continue;
            try {
              const published = await this.publish(job);
              if (
                published === true &&
                (job.category === "commercial_poll" ||
                  job.category === "seasonal_campaign")
              ) {
                pollPublished = true;
              }
              if (
                job.category === "commercial_poll" &&
                published !== true &&
                this.canPublish()
              ) {
                await this.advancePollTimer(chatId, now);
              }
            } catch (error) {
              if (job.category === "commercial_poll" && this.canPublish()) {
                await this.advancePollTimer(chatId, now);
              }
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
    } finally {
      this.ticking = false;
    }
  }

  private async preparePollTimer(
    chatId: number,
    state: AfroditaState,
    now: number,
  ): Promise<AfroditaState> {
    const settings = state.publications.commercial_poll;
    const stale = settings.nextScheduledAt !== undefined &&
      now - settings.nextScheduledAt > MAX_SCHEDULED_POLL_LATE_MS;
    if (settings.nextScheduledAt !== undefined && !stale) return state;
    const interval = Math.max(
      scheduledPollIntervalMs(),
      settings.minIntervalMs,
    );
    const lastPollAt = Math.max(
      settings.lastPublishedAt,
      state.lastPollAt,
    );
    const target = lastPollAt > 0 && lastPollAt + interval > now
      ? lastPollAt + interval
      : now + interval;
    const nextScheduledAt = nextScheduledPollWindowTime(
      target,
      state.timeZone,
      settings.scheduleTimes,
    );
    if (nextScheduledAt === undefined) return state;
    await this.store.updatePublicationSettings(
      chatId,
      "commercial_poll",
      (current) => {
        current.nextScheduledAt = nextScheduledAt;
      },
    );
    return this.store.loadGroup(chatId);
  }

  private async advancePollTimer(chatId: number, now: number): Promise<void> {
    const state = await this.store.loadGroup(chatId);
    const settings = state.publications.commercial_poll;
    const nextScheduledAt = nextScheduledPollWindowTime(
      now + Math.max(scheduledPollIntervalMs(), settings.minIntervalMs),
      state.timeZone,
      settings.scheduleTimes,
    );
    if (nextScheduledAt === undefined) return;
    await this.store.updatePublicationSettings(
      chatId,
      "commercial_poll",
      (current) => {
        current.nextScheduledAt = nextScheduledAt;
      },
    );
  }

  private async rebasePollTimers(now: number): Promise<void> {
    let groupIds: number[];
    try {
      groupIds = await this.store.listGroupIds();
    } catch (error) {
      this.logError(
        `[AFRODITA] No se pudieron recalcular encuestas al reanudar (${safeErrorType(error)}).`,
      );
      return;
    }
    for (const chatId of groupIds) {
      try {
        const state = await this.store.loadGroup(chatId);
        const settings = state.publications.commercial_poll;
        if (
          !state.enabled ||
          !settings.enabled ||
          !settings.scheduledEnabled ||
          settings.scheduleTimes.length === 0
        ) continue;
        const nextScheduledAt = nextScheduledPollWindowTime(
          now + Math.max(scheduledPollIntervalMs(), settings.minIntervalMs),
          state.timeZone,
          settings.scheduleTimes,
        );
        if (nextScheduledAt === undefined) continue;
        await this.store.updatePublicationSettings(
          chatId,
          "commercial_poll",
          (current) => {
            current.nextScheduledAt = nextScheduledAt;
          },
        );
      } catch (error) {
        this.logError(
          `[AFRODITA] No se pudo recalcular la encuesta groupId=${chatId} (${safeErrorType(error)}).`,
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
