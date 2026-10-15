import { preferredTopic } from "./analytics.js";
import { DEFAULT_AFRODITA_LIMITS } from "./types.js";
import type {
  AfroditaDecision,
  AfroditaLimits,
  AfroditaState,
} from "./types.js";

export interface DecisionContext {
  directedToBot: boolean;
  randomValue: number;
  now: number;
  limits?: Partial<AfroditaLimits>;
}

export function canPublish(
  state: AfroditaState,
  action: AfroditaDecision["action"],
  now: number,
  limits: Partial<AfroditaLimits> = {},
): boolean {
  const effective = { ...DEFAULT_AFRODITA_LIMITS, ...limits };
  if (!state.enabled) return false;
  const currentDay = new Date(now).toISOString().slice(0, 10);
  const postsToday = state.utcDay === currentDay ? state.postsToday : 0;
  if (postsToday >= effective.maxPostsPerDay) return false;
  if (now - state.lastActionAt < effective.minPostIntervalMs) return false;
  if (now < state.quietUntil) return false;
  if (action === "poll" && now - state.lastPollAt < effective.pollIntervalMs) return false;
  if (action === "profile" && now - state.lastProfileAt < effective.profileIntervalMs) return false;
  return true;
}

export function decideAction(
  state: AfroditaState,
  context: DecisionContext,
): AfroditaDecision {
  const limits = { ...DEFAULT_AFRODITA_LIMITS, ...context.limits };
  if (!state.enabled) return { action: "silence", reason: "no_opportunity" };
  if (context.now < state.quietUntil) {
    return { action: "silence", reason: "quiet_period" };
  }

  if (context.directedToBot) {
    if (!canPublish(state, "reply", context.now, limits)) {
      return { action: "silence", reason: "rate_limit" };
    }
    return { action: "reply", topic: preferredTopic(state) };
  }

  if (
    state.messagesSincePoll >= 40 &&
    canPublish(state, "poll", context.now, limits)
  ) {
    return { action: "poll", topic: preferredTopic(state) };
  }
  if (
    Object.keys(state.authorizedProfiles).length > 0 &&
    canPublish(state, "profile", context.now, limits) &&
    context.randomValue < 0.01
  ) {
    const profiles = Object.values(state.authorizedProfiles);
    const profileIndex = Math.min(
      profiles.length - 1,
      Math.floor(context.randomValue * profiles.length / 0.01),
    );
    const profile = profiles[Math.max(0, profileIndex)];
    if (profile) return { action: "profile", profile };
  }
  if (
    context.randomValue < limits.participationProbability &&
    canPublish(state, "participate", context.now, limits)
  ) {
    return { action: "participate", topic: preferredTopic(state) };
  }
  return { action: "silence", reason: "no_opportunity" };
}

export function recordPublishedAction(
  state: AfroditaState,
  action: AfroditaDecision["action"],
  now: number,
): void {
  if (action === "silence") return;
  const day = new Date(now).toISOString().slice(0, 10);
  if (state.utcDay !== day) {
    state.utcDay = day;
    state.postsToday = 0;
  }
  state.postsToday += 1;
  state.lastActionAt = now;
  if (action === "poll") {
    state.lastPollAt = now;
    state.messagesSincePoll = 0;
  } else if (action === "profile") {
    state.lastProfileAt = now;
  }
}
