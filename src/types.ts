export const AFRODITA_TOPICS = [
  "productos",
  "servicios",
  "belleza",
  "moda",
  "comida",
  "bienestar",
  "general",
] as const;

export type AfroditaTopic = (typeof AFRODITA_TOPICS)[number];

export interface AuthorizedProfile {
  userId: number;
  displayName: string;
  username?: string;
}

export interface PollTally {
  topics: AfroditaTopic[];
  votes: number[];
}

export interface AfroditaState {
  enabled: boolean;
  messageCount: number;
  messagesSincePoll: number;
  topicCounts: Record<AfroditaTopic, number>;
  replyTopicCounts: Record<AfroditaTopic, number>;
  activityByHour: number[];
  pollVotes: Record<AfroditaTopic, number>;
  pollTallies: Record<string, PollTally>;
  usefulReplies: number;
  explicitQuietRequests: number;
  quietUntil: number;
  lastActionAt: number;
  postsToday: number;
  utcDay: string;
  lastPollAt: number;
  lastProfileAt: number;
  authorizedProfiles: Record<string, AuthorizedProfile>;
}

export interface AfroditaLimits {
  maxPostsPerDay: number;
  minPostIntervalMs: number;
  participationProbability: number;
  pollIntervalMs: number;
  profileIntervalMs: number;
  quietPeriodMs: number;
}

export type AfroditaDecision =
  | { action: "reply" | "participate"; topic: AfroditaTopic }
  | { action: "poll"; topic: AfroditaTopic }
  | { action: "profile"; profile: AuthorizedProfile }
  | { action: "silence"; reason: "quiet_period" | "rate_limit" | "no_opportunity" };

export const DEFAULT_AFRODITA_LIMITS: AfroditaLimits = {
  maxPostsPerDay: 4,
  minPostIntervalMs: 15 * 60 * 1000,
  participationProbability: 0.03,
  pollIntervalMs: 24 * 60 * 60 * 1000,
  profileIntervalMs: 24 * 60 * 60 * 1000,
  quietPeriodMs: 12 * 60 * 60 * 1000,
};

export function initialAfroditaState(): AfroditaState {
  const topicCounts = Object.fromEntries(
    AFRODITA_TOPICS.map((topic) => [topic, 0]),
  ) as Record<AfroditaTopic, number>;
  return {
    enabled: false,
    messageCount: 0,
    messagesSincePoll: 0,
    topicCounts: { ...topicCounts },
    replyTopicCounts: { ...topicCounts },
    activityByHour: Array.from({ length: 24 }, () => 0),
    pollVotes: { ...topicCounts },
    pollTallies: {},
    usefulReplies: 0,
    explicitQuietRequests: 0,
    quietUntil: 0,
    lastActionAt: 0,
    postsToday: 0,
    utcDay: "",
    lastPollAt: 0,
    lastProfileAt: 0,
    authorizedProfiles: {},
  };
}
