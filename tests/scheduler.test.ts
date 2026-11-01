import assert from "node:assert/strict";
import test from "node:test";
import { getDuePublications } from "../src/scheduler.js";
import { initialAfroditaState } from "../src/types.js";

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
