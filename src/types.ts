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

export const ACTIVITY_KINDS = ["preferencia", "curiosidad", "pregunta"] as const;

export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const ACTIVITY_SEGMENTS = [
  "conversacion",
  "participacion",
  "novedades",
  "rotativo",
] as const;

export type ActivitySegment = (typeof ACTIVITY_SEGMENTS)[number];

export const SEGMENT_ROTATION = [
  "conversacion",
  "participacion",
  "novedades",
] as const;

export interface CalendarSlot {
  hour: number;
  segment: ActivitySegment;
}

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  text: string;
  buttons: string[];
}

export interface KeyboardButton {
  label: string;
  url?: string;
  callback?: string;
}

export interface SellerCatalog {
  sellerId: number;
  displayName: string;
  username?: string;
  catalogUrl: string;
}

export interface GroupLimitOverrides {
  maxPostsPerDay?: number;
  minPostIntervalMs?: number;
}

export interface AfroditaState {
  enabled: boolean;
  activityPaused: boolean;
  messageCount: number;
  messagesSincePoll: number;
  topicCounts: Record<AfroditaTopic, number>;
  replyTopicCounts: Record<AfroditaTopic, number>;
  activityByHour: number[];
  pollVotes: Record<AfroditaTopic, number>;
  pollTallies: Record<string, PollTally>;
  pollCount: number;
  lastPollTopic: AfroditaTopic | "";
  usefulReplies: number;
  explicitQuietRequests: number;
  quietUntil: number;
  lastActionAt: number;
  postsToday: number;
  utcDay: string;
  lastPollAt: number;
  lastProfileAt: number;
  lastActivityAt: number;
  lastNewsAt: number;
  lastNewsSellerId: string;
  lastScheduledKey: string;
  recentActivityIds: string[];
  recentReplyKeys: string[];
  calendarSlots: CalendarSlot[];
  limitOverrides: GroupLimitOverrides;
  metricsEnabled: boolean;
  callbackClicks: number;
  buttonVotes: Record<string, number>;
  commercialRequests: Record<string, number>;
  sellers: Record<string, SellerCatalog>;
  authorizedProfiles: Record<string, AuthorizedProfile>;
}

export interface AfroditaLimits {
  maxPostsPerDay: number;
  minPostIntervalMs: number;
  participationProbability: number;
  pollIntervalMs: number;
  profileIntervalMs: number;
  newsIntervalMs: number;
  quietPeriodMs: number;
}

export type AfroditaDecision =
  | { action: "reply" | "participate"; topic: AfroditaTopic }
  | { action: "poll"; topic: AfroditaTopic }
  | { action: "profile"; profile: AuthorizedProfile }
  | { action: "activity"; item: ActivityItem; slotKey: string; segment: ActivitySegment }
  | { action: "news"; seller: SellerCatalog; slotKey: string }
  | { action: "silence"; reason: "quiet_period" | "rate_limit" | "no_opportunity" };

export const DEFAULT_AFRODITA_LIMITS: AfroditaLimits = {
  maxPostsPerDay: 4,
  minPostIntervalMs: 15 * 60 * 1000,
  participationProbability: 0.03,
  pollIntervalMs: 24 * 60 * 60 * 1000,
  profileIntervalMs: 24 * 60 * 60 * 1000,
  newsIntervalMs: 24 * 60 * 60 * 1000,
  quietPeriodMs: 12 * 60 * 60 * 1000,
};

export const DEFAULT_CALENDAR_SLOTS: CalendarSlot[] = [
  { hour: 18, segment: "rotativo" },
];

export const MAX_CALENDAR_SLOTS = 8;
export const MAX_SELLERS_PER_GROUP = 10;
export const MAX_RECENT_ACTIVITY_IDS = 40;
export const MAX_RECENT_REPLY_KEYS = 20;
export const MAX_BUTTON_VOTE_KEYS = 120;
export const MAX_LIMIT_DAYS_MIN = 1;
export const MAX_LIMIT_DAYS_MAX = 12;
export const MAX_LIMIT_INTERVAL_MIN_MINUTES = 5;
export const MAX_LIMIT_INTERVAL_MAX_MINUTES = 1440;

export const ACTIVITY_ITEM_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,27}$/;
export const BUTTON_VOTE_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{2,27}\|[0-9]$/;

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
