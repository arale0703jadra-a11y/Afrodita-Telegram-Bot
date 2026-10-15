import { randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
  constants,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { initialAfroditaState } from "./types.js";
import type {
  AfroditaState,
  AfroditaTopic,
  AuthorizedProfile,
} from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

function normalizeState(value: unknown): AfroditaState {
  const initial = initialAfroditaState();
  if (!isRecord(value)) {
    throw new Error("AFRODITA_STORAGE_CORRUPT");
  }
  const rawTopics = isRecord(value.topicCounts) ? value.topicCounts : {};
  const rawReplies = isRecord(value.replyTopicCounts) ? value.replyTopicCounts : {};
  const rawVotes = isRecord(value.pollVotes) ? value.pollVotes : {};
  const rawTallies = isRecord(value.pollTallies) ? value.pollTallies : {};
  const rawProfiles = isRecord(value.authorizedProfiles) ? value.authorizedProfiles : {};
  const topics = Object.keys(initial.topicCounts) as AfroditaTopic[];
  const topicCounts = { ...initial.topicCounts };
  const replyTopicCounts = { ...initial.replyTopicCounts };
  const pollVotes = { ...initial.pollVotes };
  for (const topic of topics) {
    topicCounts[topic] = finiteCount(rawTopics[topic]);
    replyTopicCounts[topic] = finiteCount(rawReplies[topic]);
    pollVotes[topic] = finiteCount(rawVotes[topic]);
  }

  const rawActivityByHour = value.activityByHour;
  const activityByHour = Array.isArray(rawActivityByHour)
    ? Array.from({ length: 24 }, (_, index) => finiteCount(rawActivityByHour[index]))
    : initial.activityByHour;
  const pollTallies: AfroditaState["pollTallies"] = {};
  for (const [pollId, rawTally] of Object.entries(rawTallies).slice(-30)) {
    if (!isRecord(rawTally) || !Array.isArray(rawTally.topics) || !Array.isArray(rawTally.votes)) continue;
    const pollTopics = rawTally.topics.filter(
      (topic): topic is AfroditaTopic =>
        typeof topic === "string" && topics.includes(topic as AfroditaTopic),
    );
    if (pollTopics.length === 0) continue;
    const rawVotes = rawTally.votes;
    pollTallies[pollId] = {
      topics: pollTopics,
      votes: pollTopics.map((_, index) => finiteCount(rawVotes[index])),
    };
  }

  const authorizedProfiles: Record<string, AuthorizedProfile> = {};
  for (const [key, rawProfile] of Object.entries(rawProfiles)) {
    if (
      !isRecord(rawProfile) ||
      typeof rawProfile.userId !== "number" ||
      !Number.isSafeInteger(rawProfile.userId) ||
      typeof rawProfile.displayName !== "string"
    ) continue;
    authorizedProfiles[key] = {
      userId: rawProfile.userId,
      displayName: rawProfile.displayName.slice(0, 80),
      ...(typeof rawProfile.username === "string"
        ? { username: rawProfile.username.slice(0, 32) }
        : {}),
    };
  }

  return {
    ...initial,
    enabled: value.enabled === true,
    messageCount: finiteCount(value.messageCount),
    messagesSincePoll: finiteCount(value.messagesSincePoll),
    topicCounts,
    replyTopicCounts,
    activityByHour,
    pollVotes,
    pollTallies,
    usefulReplies: finiteCount(value.usefulReplies),
    explicitQuietRequests: finiteCount(value.explicitQuietRequests),
    quietUntil: finiteCount(value.quietUntil),
    lastActionAt: finiteCount(value.lastActionAt),
    postsToday: finiteCount(value.postsToday),
    utcDay: typeof value.utcDay === "string" ? value.utcDay.slice(0, 10) : "",
    lastPollAt: finiteCount(value.lastPollAt),
    lastProfileAt: finiteCount(value.lastProfileAt),
    authorizedProfiles,
  };
}

export class AfroditaStore {
  private readonly locks = new Map<number, Promise<void>>();
  private readonly corruptGroups = new Set<number>();

  constructor(private readonly directory = resolve(process.cwd(), "data", "afrodita")) {}

  async updateGroup<T>(
    chatId: number,
    update: (state: AfroditaState) => T | Promise<T>,
  ): Promise<{ state: AfroditaState; result: T }> {
    const previous = this.locks.get(chatId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolveLock) => {
      release = resolveLock;
    });
    const queued = previous.then(() => current);
    this.locks.set(chatId, queued);
    await previous;
    try {
      const state = await this.loadGroup(chatId);
      const result = await update(state);
      await this.saveGroup(chatId, state);
      return { state: structuredClone(state), result };
    } finally {
      release();
      if (this.locks.get(chatId) === queued) this.locks.delete(chatId);
    }
  }

  async loadGroup(chatId: number): Promise<AfroditaState> {
    const file = this.filePath(chatId);
    let contents: string;
    try {
      contents = await readFile(file, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return initialAfroditaState();
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(contents) as unknown;
      if (!isRecord(parsed)) throw new Error("AFRODITA_STORAGE_CORRUPT");
      const normalized = normalizeState(parsed);
      this.corruptGroups.delete(chatId);
      return normalized;
    } catch (error) {
      if (this.corruptGroups.has(chatId)) {
        throw new Error("AFRODITA_STORAGE_CORRUPT", { cause: error });
      }
      this.corruptGroups.add(chatId);
      const backup = `${file}.corrupt-${Date.now()}-${randomUUID()}.bak`;
      try {
        await copyFile(file, backup, constants.COPYFILE_EXCL);
      } catch (backupError) {
        console.error(
          `[AFRODITA] No se pudo conservar el archivo dañado del grupo ${chatId} (${errorName(backupError)}).`,
        );
        throw new Error("AFRODITA_STORAGE_CORRUPT_BACKUP_FAILED", { cause: backupError });
      }
      console.error(
        `[AFRODITA] Archivo de estado dañado del grupo ${chatId}; original conservado como copia de recuperación.`,
      );
      throw new Error("AFRODITA_STORAGE_CORRUPT", { cause: error });
    }
  }

  async recordPollUpdate(
    pollId: string,
    options: Array<{ voter_count: number }>,
  ): Promise<boolean> {
    let found = false;
    let entries: string[];
    try {
      entries = await readdir(this.directory);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return false;
      throw error;
    }
    for (const filename of entries) {
      const match = /^(-?\d+)\.json$/.exec(filename);
      if (!match) continue;
      const chatId = Number(match[1]);
      const current = await this.loadGroup(chatId);
      if (!current.pollTallies[pollId]) continue;
      const updated = await this.updateGroup(chatId, (state) => {
        const previous = state.pollTallies[pollId];
        if (!previous) return false;
        const nextVotes = previous.topics.map((_, index) =>
          finiteCount(options[index]?.voter_count),
        );
        previous.topics.forEach((topic, index) => {
          const oldVoteCount = previous.votes[index] ?? 0;
          const newVoteCount = nextVotes[index] ?? 0;
          state.pollVotes[topic] = Math.max(
            0,
            state.pollVotes[topic] + newVoteCount - oldVoteCount,
          );
        });
        previous.votes = nextVotes;
        found = true;
        return true;
      });
      if (updated.result) return true;
    }
    return found;
  }

  async setEnabled(chatId: number, enabled: boolean): Promise<void> {
    await this.updateGroup(chatId, (state) => {
      state.enabled = enabled;
    });
  }

  async registerPoll(
    chatId: number,
    pollId: string,
    topics: AfroditaTopic[],
  ): Promise<void> {
    await this.updateGroup(chatId, (state) => {
      state.pollTallies[pollId] = { topics: [...topics], votes: topics.map(() => 0) };
      const oldPolls = Object.keys(state.pollTallies);
      for (const oldPollId of oldPolls.slice(0, Math.max(0, oldPolls.length - 30))) {
        delete state.pollTallies[oldPollId];
      }
    });
  }

  async authorizeProfile(chatId: number, profile: AuthorizedProfile): Promise<void> {
    const displayName = profile.displayName
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .trim()
      .slice(0, 80);
    if (!Number.isSafeInteger(profile.userId) || profile.userId <= 0 || !displayName) {
      throw new Error("AFRODITA_PROFILE_INVALID");
    }
    const username = profile.username?.replace(/^@/, "").trim();
    if (username && !/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(username)) {
      throw new Error("AFRODITA_PROFILE_INVALID");
    }
    const safeProfile: AuthorizedProfile = {
      userId: profile.userId,
      displayName,
      ...(username ? { username } : {}),
    };
    const updated = await this.updateGroup(chatId, (state) => {
      const key = String(safeProfile.userId);
      if (!state.authorizedProfiles[key] && Object.keys(state.authorizedProfiles).length >= 20) {
        return false;
      }
      state.authorizedProfiles[key] = safeProfile;
      return true;
    });
    if (!updated.result) throw new Error("AFRODITA_PROFILE_LIMIT_REACHED");
  }

  async removeProfile(chatId: number, userId: number): Promise<void> {
    await this.updateGroup(chatId, (state) => {
      delete state.authorizedProfiles[String(userId)];
    });
  }

  private async saveGroup(chatId: number, state: AfroditaState): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const file = this.filePath(chatId);
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(state), {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      await rename(temporary, file);
    } catch (error) {
      try {
        await unlink(temporary);
      } catch (cleanupError) {
        if (!(isNodeError(cleanupError) && cleanupError.code === "ENOENT")) {
          console.error("[AFRODITA] No se pudo limpiar una escritura temporal.");
        }
      }
      throw error;
    }
  }

  private filePath(chatId: number): string {
    if (!Number.isSafeInteger(chatId) || chatId === 0) {
      throw new RangeError("AFRODITA_CHAT_ID_INVALID");
    }
    return resolve(this.directory, `${chatId}.json`);
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "unknown";
}
