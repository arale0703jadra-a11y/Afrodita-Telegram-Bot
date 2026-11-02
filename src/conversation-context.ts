import { sanitizeIncomingText } from "./utils/sanitizer.js";

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

interface GroupTurns {
  updatedAt: number;
  turns: ConversationTurn[];
}

const MAX_GROUPS = 500;
const MAX_TURNS_PER_GROUP = 6;
const MAX_TURN_LENGTH = 600;
const CONTEXT_TTL_MS = 30 * 60 * 1000;

export class GroupConversationContext {
  private readonly groups = new Map<number, GroupTurns>();

  recent(chatId: number, now = Date.now()): ConversationTurn[] {
    const group = this.groups.get(chatId);
    if (!group || now - group.updatedAt >= CONTEXT_TTL_MS) {
      this.groups.delete(chatId);
      return [];
    }
    group.updatedAt = now;
    this.groups.delete(chatId);
    this.groups.set(chatId, group);
    return group.turns.map((turn) => ({ ...turn }));
  }

  append(
    chatId: number,
    role: ConversationTurn["role"],
    content: string,
    now = Date.now(),
  ): void {
    const normalized = sanitizeIncomingText(content).slice(0, MAX_TURN_LENGTH);
    if (!normalized) return;
    const turns = this.recent(chatId, now);
    turns.push({ role, content: normalized });
    this.groups.set(chatId, {
      updatedAt: now,
      turns: turns.slice(-MAX_TURNS_PER_GROUP),
    });
    while (this.groups.size > MAX_GROUPS) {
      const oldest = this.groups.keys().next().value;
      if (oldest === undefined) break;
      this.groups.delete(oldest);
    }
  }
}
