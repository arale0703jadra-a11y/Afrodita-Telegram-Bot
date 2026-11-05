import assert from "node:assert/strict";
import test from "node:test";
import { getDuePublications } from "../src/scheduler.js";
import { PublicationScheduler } from "../src/scheduler.js";
import { initialAfroditaState } from "../src/types.js";
import {
  MAX_SCHEDULED_POLL_INTERVAL_MS,
  MIN_SCHEDULED_POLL_INTERVAL_MS,
  isWithinScheduledPollWindow,
  scheduledPollIntervalMs,
} from "../src/poll-schedule.js";

test("scheduler emits seasonal polls only on their configured campaign slot", () => {
  const state = initialAfroditaState();
  state.enabled = true;
  const due = getDuePublications(
    -100125,
    state,
    Date.UTC(2026, 9, 31, 18, 0),
  );

  assert.deepEqual(due, [{
    chatId: -100125,
    category: "seasonal_campaign",
    slotKey: "seasonal_campaign:2026-10-31:18:00",
  }]);

  state.publications.seasonal_campaign.lastScheduledKey =
    "seasonal_campaign:2026-10-31:18:00";
  assert.deepEqual(
    getDuePublications(-100125, state, Date.UTC(2026, 9, 31, 18, 0)),
    [],
  );
});

test("paused groups and groups in a quiet period have no scheduled posts", () => {
  const state = initialAfroditaState();
  const scheduledAt = Date.UTC(2026, 9, 31, 18, 0);
  state.enabled = true;
  state.quietUntil = scheduledAt + 1;
  assert.deepEqual(getDuePublications(-100126, state, scheduledAt), []);

  state.quietUntil = 0;
  state.enabled = false;
  assert.deepEqual(getDuePublications(-100126, state, scheduledAt), []);
});

test("global pause skips scheduler ticks without enumerating or queueing overdue work", async () => {
  let listCalls = 0;
  let publishCalls = 0;
  const store = {
    async listGroupIds() {
      listCalls += 1;
      return [-100127];
    },
  } as never;
  const scheduler = new PublicationScheduler(
    store,
    async () => { publishCalls += 1; },
    undefined,
    () => Date.UTC(2026, 9, 31, 18, 0),
    () => false,
  );
  // Con la compuerta cerrada el tick no debe enumerar grupos ni buscar
  // publicaciones pendientes; sin la pausa global sí lo haría.
  await scheduler.tick(Date.UTC(2026, 9, 31, 18, 1));
  assert.equal(listCalls, 0);
  assert.equal(publishCalls, 0);
});

test("scheduled poll intervals are randomized inclusively from 90 to 120 minutes", () => {
  assert.equal(scheduledPollIntervalMs(0), MIN_SCHEDULED_POLL_INTERVAL_MS);
  assert.equal(scheduledPollIntervalMs(0.5), 105 * 60_000);
  assert.equal(scheduledPollIntervalMs(1), MAX_SCHEDULED_POLL_INTERVAL_MS);
});

test("configured poll schedule times define an inclusive active window", () => {
  assert.equal(isWithinScheduledPollWindow("10:00", ["10:00", "15:00", "20:00"]), true);
  assert.equal(isWithinScheduledPollWindow("20:00", ["10:00", "15:00", "20:00"]), true);
  assert.equal(isWithinScheduledPollWindow("09:59", ["10:00", "15:00", "20:00"]), false);
  assert.equal(isWithinScheduledPollWindow("20:01", ["10:00", "15:00", "20:00"]), false);
  assert.equal(isWithinScheduledPollWindow("12:00", []), false);
});

test("commercial poll uses its persisted dynamic due time and configured daily cap", () => {
  const state = initialAfroditaState();
  state.enabled = true;
  const now = Date.UTC(2026, 9, 31, 16, 0);
  const settings = state.publications.commercial_poll;
  settings.scheduleTimes = ["10:00", "20:00"];
  settings.nextScheduledAt = now;
  settings.minIntervalMs = MIN_SCHEDULED_POLL_INTERVAL_MS;
  settings.maxPerDay = 8;

  assert.deepEqual(
    getDuePublications(-100128, state, now)
      .filter((job) => job.category === "commercial_poll").length,
    1,
  );
  settings.publishedToday = 8;
  settings.utcDay = "2026-10-31";
  assert.equal(
    getDuePublications(-100128, state, now)
      .some((job) => job.category === "commercial_poll"),
    false,
  );
});

test("scheduler persists a randomized next poll, prevents concurrent ticks, and rebases after pause", async () => {
  const state = initialAfroditaState();
  state.enabled = true;
  state.publications.commercial_poll.scheduleTimes = ["00:00", "23:59"];
  state.publications.commercial_poll.maxPerDay = 4;
  state.publications.commercial_poll.minIntervalMs = 3 * 60 * 60_000;
  state.publications.commercial_poll.activityEnabled = false;
  state.publications.verified_promotion.enabled = false;
  state.publications.commercial_poll.nextScheduledAt = Date.UTC(2026, 9, 31, 12, 0);
  let publishCalls = 0;
  let gateOpen = false;
  const store = {
    async listGroupIds() {
      return [-100127];
    },
    async loadGroup() {
      return structuredClone(state);
    },
    async updatePublicationSettings(_chatId: number, _category: string, update: (settings: typeof state.publications.commercial_poll) => void) {
      update(state.publications.commercial_poll);
    },
  } as never;
  const now = Date.UTC(2026, 9, 31, 12, 0);
  const scheduler = new PublicationScheduler(
    store,
    async () => {
      publishCalls += 1;
      return true;
    },
    undefined,
    () => now,
    () => gateOpen,
  );

  await scheduler.tick(now);
  assert.equal(publishCalls, 0);

  // El despertar del gate abierto recalcula la próxima hora, no recupera lo perdido.
  gateOpen = true;
  await scheduler.tick(now + 60_000);
  assert.equal(publishCalls, 0);
  assert.ok(state.publications.commercial_poll.nextScheduledAt! > now);
  assert.ok(
    state.publications.commercial_poll.nextScheduledAt! - now >=
      3 * 60 * 60_000,
  );
  assert.equal(state.publications.commercial_poll.maxPerDay, 4);
  assert.equal(state.publications.commercial_poll.activityEnabled, false);
  assert.equal(state.publications.verified_promotion.enabled, false);

  const dueAt = state.publications.commercial_poll.nextScheduledAt!;
  await scheduler.tick(dueAt);
  assert.equal(publishCalls, 1);

  const concurrentScheduler = new PublicationScheduler(
    store,
    async () => {
      publishCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return true;
    },
    undefined,
    () => dueAt,
    () => true,
  );
  state.publications.commercial_poll.nextScheduledAt = dueAt + 60_000;
  const initialCalls = publishCalls;
  await Promise.all([
    concurrentScheduler.tick(dueAt + 60_000),
    concurrentScheduler.tick(dueAt + 60_000),
  ]);
  assert.equal(publishCalls, initialCalls + 1);
});
