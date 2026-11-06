import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Api } from "grammy";
import {
  createProfilePromotionMessage,
  getEligiblePromotionProfiles,
  orderEligiblePromotionProfiles,
  publishCommunityReply,
  publishProfilePromotion,
  publishScheduledJob,
  publishPoll,
} from "../src/publishers.js";
import {
  finalizePublication,
  reservePublication,
} from "../src/publications.js";
import { AfroditaStore } from "../src/store.js";
import { DEFAULT_AFRODITA_LIMITS, type AfroditaState } from "../src/types.js";
import { canPublish } from "../src/decision.js";
import { PublicationScheduler } from "../src/scheduler.js";

async function preparePromotionStore(
  store: AfroditaStore,
  chatId: number,
): Promise<void> {
  await store.setEnabled(chatId, true);
  await store.authorizeProfile(chatId, {
    userId: 456,
    displayName: "Authorized name",
  });
  await store.authorizePromotion(chatId, 456);
}

class RotationFailureStore extends AfroditaStore {
  failRotationWrite = false;
  private updatesAfterFailureEnabled = 0;

  override async updateGroup<T>(
    chatId: number,
    update: (state: AfroditaState) => T | Promise<T>,
  ): Promise<{ state: AfroditaState; result: T }> {
    if (this.failRotationWrite && ++this.updatesAfterFailureEnabled === 3) {
      throw new Error("Synthetic rotation persistence failure");
    }
    return super.updateGroup(chatId, update);
  }
}

test("promotion rotation prefers never-promoted and oldest-promoted profiles", () => {
  const ordered = orderEligiblePromotionProfiles(
    [
      { userId: 20, displayName: "Recent" },
      { userId: 30, displayName: "New" },
      { userId: 10, displayName: "Oldest" },
    ],
    [10, 20],
  );

  assert.deepEqual(ordered.map((profile) => profile.userId), [30, 10, 20]);
});

test("profile promotion uses a Telegram ID text mention and UTF-16 offsets", () => {
  const message = createProfilePromotionMessage(
    { userId: 456, displayName: "Zoë 🌺", mention: true },
    0,
  );

  assert.ok(message);
  const entity = message.entities[0];
  assert.equal(entity.type, "text_mention");
  assert.equal(entity.user.id, 456);
  assert.equal(entity.user.first_name, "Zoë 🌺");
  assert.equal(
    message.text.slice(entity.offset, entity.offset + entity.length),
    "Zoë 🌺",
  );
  assert.equal(message.text.includes("@"), false);
  assert.equal(
    createProfilePromotionMessage({ userId: 0, displayName: "Invalid" }, 0),
    undefined,
  );
  assert.equal(
    createProfilePromotionMessage({ userId: 456, displayName: " \n " }, 0),
    undefined,
  );
});

test("profile presentations vary playfully without inventing personal or physical attributes", () => {
  const presentations = Array.from({ length: 12 }, (_, templateIndex) =>
    createProfilePromotionMessage(
      {
        userId: 456,
        displayName: "Perfil autorizado",
        mention: true,
        body: true,
      },
      templateIndex,
    ),
  );
  assert.ok(presentations.every(Boolean));
  assert.equal(new Set(presentations.map((item) => item?.text)).size, 12);
  for (const presentation of presentations) {
    assert.match(presentation!.text, /Perfil autorizado/u);
    assert.match(presentation!.text, /verificad|autorizad/u);
    assert.match(presentation!.text, /😏|🔥|💋|👀|😈|🌶️|✨|💜/u);
    assert.doesNotMatch(
      presentation!.text,
      /precio|disponible|contenido sexual|curvas|cuerpazo|nalgas|caderas|piernas|escote/u,
    );
    assert.equal(presentation!.entities[0]?.user.id, 456);
  }
});

test("profile presentation uses only current catalog and mention permissions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "afrodita-presentation-consent-"));
  const store = new AfroditaStore(directory);
  const sent: Array<{ text: string; hasEntities: boolean }> = [];
  const api = {
    async sendMessage(_chatId: number, text: string, options?: { entities?: unknown[] }) {
      sent.push({ text, hasEntities: Boolean(options?.entities?.length) });
    },
  } as unknown as Pick<Api, "sendMessage">;
  try {
    await store.setEnabled(-100127, true);
    await store.authorizeProfile(-100127, { userId: 456, displayName: "Perfil autorizado" });
    await store.setContentConsent(-100127, 456, 456, ["catalog"], true);
    await store.setContentConsent(-100127, 456, 456, ["body"], true);
    assert.equal(
      await publishProfilePromotion(
        api,
        store,
        -100127,
        { userId: 456, displayName: "Perfil autorizado" },
        { kind: "activity", userId: 456 },
        0,
      ),
      true,
    );
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.hasEntities, false);
    assert.doesNotMatch(sent[0]!.text, /@|curvas|cuerpazo|nalgas|caderas|piernas|escote/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("profile presentation rotation persists across reloads and does not repeat consecutively", async () => {
  const directory = await mkdtemp(join(tmpdir(), "afrodita-presentation-rotation-"));
  const chatId = -100126;
  const sent: string[] = [];
  const api = {
    async sendMessage(_chatId: number, text: string) {
      sent.push(text);
    },
  } as unknown as Pick<Api, "sendMessage">;
  try {
    let store = new AfroditaStore(directory);
    await store.setEnabled(chatId, true);
    await store.authorizeProfile(chatId, { userId: 457, displayName: "Perfil rotativo" });
    await store.setContentConsent(chatId, 457, 457, ["catalog"], true);

    for (let index = 0; index < 2; index += 1) {
      store = new AfroditaStore(directory);
      assert.equal(
        await publishProfilePromotion(
          api,
          store,
          chatId,
          { userId: 457, displayName: "Perfil rotativo" },
          { kind: "activity", userId: 457 },
          5,
        ),
        true,
      );
        if (index === 0) {
          await store.updatePublicationSettings(chatId, "verified_promotion", (settings) => {
            settings.lastPublishedAt = 0;
          });
        }
    }

    assert.equal(sent.length, 2);
    assert.notEqual(sent[0], sent[1]);
    const state = await store.loadGroup(chatId);
    assert.deepEqual(
      state.publications.verified_promotion.history
        .filter((entry) => entry.status === "published")
        .map((entry) => entry.templateId),
      ["profile-presentation-5", "profile-presentation-6"],
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("successful conversational publication updates the counters used by decision limits", async () => {
  const directory = await mkdtemp(join(tmpdir(), "afrodita-reply-limits-"));
  const store = new AfroditaStore(directory);
  try {
    await store.setEnabled(-100128, true);
    assert.equal(await publishCommunityReply(async () => undefined, store, -100128, 456), true);

    const state = await store.loadGroup(-100128);
    assert.equal(state.postsToday, 1);
    assert.ok(state.lastActionAt > 0);
    assert.equal(
      canPublish(state, "reply", state.lastActionAt + DEFAULT_AFRODITA_LIMITS.minPostIntervalMs - 1),
      false,
      "el intervalo de decisión se aplica con contadores que se actualizan tras publicar",
    );
    assert.ok(state.communityReplyUserCooldowns["456"] > Date.now());
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("commercial and seasonal polls cannot hold simultaneous publication reservations", async () => {
  const directory = await mkdtemp(join(tmpdir(), "afrodita-poll-reservations-"));
  const store = new AfroditaStore(directory);
  try {
    await store.setEnabled(-100127, true);
    const first = await reservePublication(
      store,
      -100127,
      "commercial_poll",
      { kind: "scheduled", slotKey: "commercial:first" },
    () => true,
    );
    assert.ok(first);
    const second = await reservePublication(
      store,
      -100127,
      "seasonal_campaign",
      { kind: "scheduled", slotKey: "seasonal:second" },
    () => true,
    );
    assert.equal(second, undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("global pause prevents replies, polls, mentions, scheduled posts, and campaigns", async () => {
  const directory = await mkdtemp(join(tmpdir(), "afrodita-global-pause-publishers-"));
  const store = new AfroditaStore(directory);
  let sendCalls = 0;
  const canPublishNow = () => false;
  const api = {
    async sendMessage() {
      sendCalls += 1;
      return {} as never;
    },
    async sendPoll() {
      sendCalls += 1;
      return {} as never;
    },
    async getChatMember() {
      sendCalls += 1;
      return {} as never;
    },
  } as unknown as Pick<Api, "sendMessage" | "sendPoll" | "getChatMember">;
  try {
    await store.setEnabled(-100127, true);
    assert.equal(
      await publishCommunityReply(
        async () => { sendCalls += 1; },
        store,
        -100127,
        456,
        undefined,
        canPublishNow,
      ),
      false,
    );
    assert.equal(
      await publishPoll(
        api,
        store,
        -100127,
        "commercial_poll",
        { question: "¿Qué prefieres?", options: ["A", "B"], topics: ["general"] },
        { kind: "activity" },
        canPublishNow,
      ),
      false,
    );
    assert.equal(
      await publishProfilePromotion(
        api,
        store,
        -100127,
        { userId: 456, displayName: "Perfil" },
        { kind: "activity", userId: 456 },
        0,
        canPublishNow,
      ),
      false,
    );
    for (const category of [
      "commercial_poll",
      "seasonal_campaign",
      "community_reply",
      "verified_promotion",
    ] as const) {
      await publishScheduledJob(
        api,
        store,
        -100127,
        category,
        `${category}:missed-slot`,
        {},
        async () => {
          throw new Error("Supabase must not be queried while paused");
        },
        canPublishNow,
      );
    }
    assert.equal(sendCalls, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("promotion requires the same group's local profile authorization and consent", async () => {
  const directory = await mkdtemp(join(tmpdir(), "afrodita-promotion-auth-"));
  const store = new AfroditaStore(directory);
  let sendCalls = 0;
  let sentMessage: {
    text: string;
    entities?: Array<{
      type: string;
      offset: number;
      length: number;
      user?: { id: number };
    }>;
  } | undefined;
  const api: Pick<Api, "sendMessage"> = {
    async sendMessage(_chatId, text, options) {
      sendCalls += 1;
      sentMessage = { text, entities: options?.entities };
      return {
        message_id: sendCalls,
        date: Math.floor(Date.now() / 1000),
        chat: { id: -100128, type: "supergroup", title: "Test group" },
        text: "sent",
      };
    },
  };

  try {
    await store.setEnabled(-100128, true);
    await store.authorizeProfile(-100128, {
      userId: 456,
      displayName: "Authorized name",
    });
    await store.authorizePromotion(-100128, 456);

    assert.equal(
      await publishProfilePromotion(
        api,
        store,
        -100128,
        { userId: 456, displayName: "Untrusted alternate name" },
        { kind: "activity", userId: 456 },
        0,
      ),
      true,
    );
    assert.equal(sendCalls, 1);
    assert.ok(sentMessage);
    const sentEntity = sentMessage.entities?.[0];
    assert.ok(sentEntity);
    assert.equal(sentEntity.type, "text_mention");
    assert.equal(sentEntity.user?.id, 456);
    assert.equal(
      sentMessage.text.slice(sentEntity.offset, sentEntity.offset + sentEntity.length),
      "Authorized name",
    );
    const state = await store.loadGroup(-100128);
    assert.equal(state.publications.verified_promotion.history[0]?.status, "published");
    assert.equal(state.publications.verified_promotion.publishedToday, 1);

    await store.removeProfile(-100128, 456);
    assert.equal(
      await publishProfilePromotion(
        api,
        store,
        -100128,
        { userId: 456, displayName: "Authorized name" },
        { kind: "activity", userId: 456 },
        1,
      ),
      false,
    );
    assert.equal(sendCalls, 1);
    assert.equal(
      await publishProfilePromotion(
        api,
        store,
        -100129,
        { userId: 456, displayName: "Authorized name" },
        { kind: "activity", userId: 456 },
        1,
      ),
      false,
    );
    assert.equal(sendCalls, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("failed promotion send remains failed and does not advance rotation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "afrodita-promotion-send-failed-"));
  const store = new AfroditaStore(directory);
  let sendCalls = 0;
  const api: Pick<Api, "sendMessage"> = {
    async sendMessage() {
      sendCalls += 1;
      throw Object.assign(new Error("Rejected by Telegram"), { error_code: 400 });
    },
  };

  try {
    await preparePromotionStore(store, -100133);
    const sent = await publishProfilePromotion(
      api,
      store,
      -100133,
      { userId: 456, displayName: "Authorized name" },
      { kind: "activity", userId: 456 },
      0,
    );
    const state = await store.loadGroup(-100133);

    assert.equal(sent, false);
    assert.equal(sendCalls, 1);
    assert.equal(state.publications.verified_promotion.history.length, 1);
    assert.equal(state.publications.verified_promotion.history[0]?.status, "failed");
    assert.equal(state.publications.verified_promotion.publishedToday, 0);
    assert.deepEqual(state.recentPromotedUserIds, []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("uncertain promotion send stays reserved in history as unknown and blocks immediate retry", async () => {
  const directory = await mkdtemp(join(tmpdir(), "afrodita-promotion-send-unknown-"));
  const store = new AfroditaStore(directory);
  let sendCalls = 0;
  const api: Pick<Api, "sendMessage"> = {
    async sendMessage() {
      sendCalls += 1;
      throw new Error("Synthetic network timeout");
    },
  };
  // El envío incierto reserva cuota en el día UTC real; las reaperturas de
  // reserva usan +5 h para superar el intervalo mínimo de 4 h. Sin un reloj
  // fijo, esa suma cruza la medianoche UTC por la noche y `utcDay` reinicia
  // `publishedToday`, haciendo la prueba dependiente de la hora de ejecución.
  const referenceNow = Date.UTC(2026, 9, 28, 12, 0);
  const realDateNow = Date.now;
  Date.now = () => referenceNow;

  try {
    await preparePromotionStore(store, -100134);
    const first = await publishProfilePromotion(
      api,
      store,
      -100134,
      { userId: 456, displayName: "Authorized name" },
      { kind: "activity", userId: 456 },
      0,
    );
    const sameSubjectRetry = await reservePublication(
      store,
      -100134,
      "verified_promotion",
      { kind: "activity", userId: 456 },
      () => true,
      Date.now() + 5 * 60 * 60 * 1000,
    );
    await store.authorizeProfile(-100134, {
      userId: 457,
      displayName: "Another authorized name",
    });
    await store.authorizePromotion(-100134, 457);
    const otherSubjectReservation = await reservePublication(
      store,
      -100134,
      "verified_promotion",
      { kind: "activity", userId: 457 },
      () => true,
      Date.now() + 5 * 60 * 60 * 1000,
    );
    const state = await store.loadGroup(-100134);

    assert.equal(first, false);
    assert.equal(sameSubjectRetry, undefined);
    assert.ok(otherSubjectReservation);
    assert.equal(sendCalls, 1);
    assert.equal(state.publications.verified_promotion.history.length, 2);
    assert.equal(state.publications.verified_promotion.history[0]?.status, "unknown");
    assert.equal(state.publications.verified_promotion.history[1]?.status, "reserved");
    assert.equal(state.publications.verified_promotion.publishedToday, 2);
    assert.deepEqual(state.recentPromotedUserIds, []);
  } finally {
    Date.now = realDateNow;
    await rm(directory, { recursive: true, force: true });
  }
});

test("sent promotion stays published when persisting rotation fails afterward", async () => {
  const directory = await mkdtemp(join(tmpdir(), "afrodita-promotion-rotation-failed-"));
  const store = new RotationFailureStore(directory);
  let sendCalls = 0;
  const api: Pick<Api, "sendMessage"> = {
    async sendMessage() {
      sendCalls += 1;
      return {
        message_id: sendCalls,
        date: Math.floor(Date.now() / 1000),
        chat: { id: -100135, type: "supergroup", title: "Test group" },
        text: "sent",
      };
    },
  };

  try {
    await preparePromotionStore(store, -100135);
    store.failRotationWrite = true;
    const sent = await publishProfilePromotion(
      api,
      store,
      -100135,
      { userId: 456, displayName: "Authorized name" },
      { kind: "activity", userId: 456 },
      0,
    );
    const state = await store.loadGroup(-100135);

    assert.equal(sent, true);
    assert.equal(sendCalls, 1);
    assert.equal(state.publications.verified_promotion.history[0]?.status, "published");
    assert.equal(state.publications.verified_promotion.publishedToday, 1);
    assert.deepEqual(state.recentPromotedUserIds, []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("eligible promotion profiles require current group catalog, local authorization, consent, and membership", async () => {
  const directory = await mkdtemp(join(tmpdir(), "afrodita-eligible-promotion-"));
  const store = new AfroditaStore(directory);
  const config = {
    supabaseUrl: "https://example.supabase.co",
    supabaseKey: "sb_publishable_test-key",
  };
  let fetchCalls = 0;
  const fetcher: typeof fetch = async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify([
      { group_id: -100130, user_id: 789, display_name: "Verified", username: "verified_user" },
      { group_id: -100131, user_id: 790, display_name: "Different group" },
    ]), { status: 200 });
  };
  const api: Pick<Api, "getChatMember"> = {
    async getChatMember(_chatId, userId) {
      return {
        status: userId === 789 ? "member" : "left",
        user: { id: userId, is_bot: false, first_name: "synthetic" },
      };
    },
  };

  try {
    await store.authorizeProfile(-100130, { userId: 789, displayName: "Authorized" });
    await store.authorizePromotion(-100130, 789);
    await store.authorizeProfile(-100130, { userId: 790, displayName: "Other group user" });
    await store.authorizePromotion(-100130, 790);

    const eligible = await getEligiblePromotionProfiles(
      store,
      api,
      -100130,
      config,
      fetcher,
    );
    assert.deepEqual(eligible, [{
      userId: 789,
      displayName: "Authorized",
      mention: true,
      body: false,
    }]);
    assert.equal(fetchCalls, 1);

    await store.removeProfile(-100130, 789);
    assert.deepEqual(
      await getEligiblePromotionProfiles(store, api, -100130, config, fetcher),
      [],
    );
    assert.equal(fetchCalls, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("eligible promotion lookup fails closed when the verified catalog is unavailable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "afrodita-promotion-catalog-error-"));
  const store = new AfroditaStore(directory);
  try {
    await store.authorizeProfile(-100132, { userId: 791, displayName: "Authorized" });
    await store.authorizePromotion(-100132, 791);
    await assert.rejects(
      getEligiblePromotionProfiles(
        store,
        { async getChatMember() { throw new Error("Should not query membership"); } },
        -100132,
        {
          supabaseUrl: "https://example.supabase.co",
          supabaseKey: "sb_publishable_test-key",
        },
        async () => {
          throw new Error("Synthetic catalog failure");
        },
      ),
      /AFRODITA_SUPABASE_NETWORK_ERROR/u,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("stale publication reservations become unknown without restoring their quota", async () => {
  const directory = await mkdtemp(join(tmpdir(), "afrodita-stale-reservation-"));
  const store = new AfroditaStore(directory);
  const now = Date.UTC(2026, 9, 28, 12, 0);

  try {
    await store.setEnabled(-100124, true);
    await store.updatePublicationSettings(
      -100124,
      "commercial_poll",
      (settings) => {
        settings.minIntervalMs = 60_000;
      },
    );
    const first = await reservePublication(
      store,
      -100124,
      "commercial_poll",
      { kind: "activity" },
      () => true,
      now,
    );
    assert.ok(first);

    assert.equal(
      await reservePublication(
        store,
        -100124,
        "commercial_poll",
        { kind: "activity" },
        () => true,
        now + 29 * 60_000,
      ),
      undefined,
    );
    const next = await reservePublication(
      store,
      -100124,
      "commercial_poll",
      { kind: "activity" },
      () => true,
      now + 31 * 60_000,
    );
    const state = await store.loadGroup(-100124);

    assert.ok(next);
    assert.equal(state.publications.commercial_poll.history[0]?.status, "unknown");
    assert.equal(state.publications.commercial_poll.publishedToday, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("definitive send failures release quota but wait the category interval before retry", async () => {
  const directory = await mkdtemp(join(tmpdir(), "afrodita-failed-retry-"));
  const store = new AfroditaStore(directory);
  const now = Date.UTC(2026, 9, 28, 12, 0);

  try {
    await store.setEnabled(-100127, true);
    await store.updatePublicationSettings(
      -100127,
      "commercial_poll",
      (settings) => {
        settings.minIntervalMs = 60_000;
      },
    );
    const reservation = await reservePublication(
      store,
      -100127,
      "commercial_poll",
      { kind: "activity" },
      () => true,
      now,
    );
    assert.ok(reservation);
    await finalizePublication(store, reservation, "failed", now);

    assert.equal(
      await reservePublication(
        store,
        -100127,
        "commercial_poll",
        { kind: "activity" },
        () => true,
        now + 59_999,
      ),
      undefined,
    );
    const next = await reservePublication(
      store,
      -100127,
      "commercial_poll",
      { kind: "activity" },
      () => true,
      now + 60_000,
    );
    const state = await store.loadGroup(-100127);

    assert.ok(next);
    assert.equal(state.publications.commercial_poll.publishedToday, 1);
    assert.equal(state.publications.commercial_poll.history[0]?.status, "failed");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("seasonal polls use their own category quota and history", async () => {
  const directory = await mkdtemp(join(tmpdir(), "afrodita-seasonal-poll-"));
  const store = new AfroditaStore(directory);
  const originalNow = Date.now;
  const seasonalDate = Date.UTC(2026, 9, 31, 18, 30);
  let sendCalls = 0;
  const api: Pick<Api, "sendPoll" | "sendMessage" | "getChatMember"> = {
    async sendPoll(_chatId, _question, _options, options) {
      sendCalls += 1;
      assert.equal(options?.open_period, 600);
      throw new Error("Ambiguous transport failure");
    },
    async sendMessage() {
      throw new Error("Unexpected scheduled message");
    },
    async getChatMember() {
      throw new Error("Unexpected membership lookup");
    },
  };

  try {
    await store.setEnabled(-100123, true);
    Date.now = () => seasonalDate;
    await publishScheduledJob(
      api,
      store,
      -100123,
      "seasonal_campaign",
      "seasonal_campaign:2026-10-31:18:00",
      {},
    );
    const state = await store.loadGroup(-100123);

    assert.equal(sendCalls, 1);
    assert.equal(state.publications.seasonal_campaign.history.length, 1);
    assert.equal(
      state.publications.seasonal_campaign.history[0]?.status,
      "unknown",
    );
    assert.equal(state.publications.seasonal_campaign.publishedToday, 1);
    assert.equal(state.publications.commercial_poll.history.length, 0);
  } finally {
    Date.now = originalNow;
    await rm(directory, { recursive: true, force: true });
  }
});

test("the eight-poll daily limit includes seasonal and commercial polls together", async () => {
  const directory = await mkdtemp(join(tmpdir(), "afrodita-total-poll-quota-"));
  const store = new AfroditaStore(directory);
  const chatId = -100129;
  const start = Date.UTC(2026, 9, 31, 0);
  try {
    await store.setEnabled(chatId, true);
    await store.updatePublicationSettings(chatId, "seasonal_campaign", (settings) => {
      settings.minIntervalMs = 1;
    });

    for (let index = 0; index < 7; index += 1) {
      const now = start + index * 91 * 60_000;
      const reservation = await reservePublication(
        store,
        chatId,
        "commercial_poll",
        { kind: "activity" },
        () => true,
        now,
      );
      assert.ok(reservation);
      await finalizePublication(store, reservation, "published", now);
    }

    const seasonalAt = start + 7 * 91 * 60_000;
    const seasonal = await reservePublication(
      store,
      chatId,
      "seasonal_campaign",
      { kind: "scheduled", slotKey: "seasonal:daily-limit" },
      () => true,
      seasonalAt,
    );
    assert.ok(seasonal);
    await finalizePublication(store, seasonal, "published", seasonalAt);

    assert.equal(
      await reservePublication(
        store,
        chatId,
        "commercial_poll",
        { kind: "activity" },
        () => true,
        seasonalAt + 91 * 60_000,
      ),
      undefined,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("el gate global gobierna a todos los publishers; los flags legacy ya no mantienen pausas", async () => {
  const directory = await mkdtemp(join(tmpdir(), "afrodita-global-resume-publishers-"));
  const store = new AfroditaStore(directory);
  let gateOpen = true;
  const canPublishNow = () => gateOpen;
  let pollSends = 0;
  let promotionSends = 0;
  const api = {
    async sendPoll() {
      pollSends += 1;
      return { poll: { id: `poll-${pollSends}` } } as never;
    },
    async sendMessage() {
      promotionSends += 1;
      return {} as never;
    },
    async getChatMember() {
      return {} as never;
    },
  } as unknown as Pick<Api, "sendMessage" | "sendPoll" | "getChatMember">;
  const profile = { userId: 456, displayName: "Authorized name" };

  try {
    await store.setEnabled(-100130, true);
    await store.authorizeProfile(-100130, profile);
    await store.authorizePromotion(-100130, 456);
    await store.updatePublicationSettings(-100130, "verified_promotion", (settings) => {
      settings.enabled = false;
    });

    // Pausada: ni encuestas ni promociones salen hacia el grupo.
    gateOpen = false;
    assert.equal(
      await publishPoll(
        api,
        store,
        -100130,
        "commercial_poll",
        { question: "¿Qué prefieres?", options: ["A", "B"], topics: ["general"] },
        { kind: "activity" },
        canPublishNow,
      ),
      false,
    );
    assert.equal(
      await publishProfilePromotion(
        api,
        store,
        -100130,
        profile,
        { kind: "activity", userId: 456 },
        0,
        canPublishNow,
      ),
      false,
    );
    assert.equal(pollSends, 0);
    assert.equal(promotionSends, 0);

    // Reanudada: la función habilitada vuelve a publicar.
    gateOpen = true;
    assert.equal(
      await publishPoll(
        api,
        store,
        -100130,
        "commercial_poll",
        { question: "¿Qué prefieres?", options: ["A", "B"], topics: ["general"] },
        { kind: "activity" },
        canPublishNow,
      ),
      true,
    );
    assert.equal(pollSends, 1);

    // El flag legacy `enabled = false` ya no mantiene la pausa: con el gate
    // global abierto, la promoción vuelve a publicar sin reactivar nada.
    assert.equal(
      await publishProfilePromotion(
        api,
        store,
        -100130,
        profile,
        { kind: "activity", userId: 456 },
        0,
        canPublishNow,
      ),
      true,
    );
    assert.equal(promotionSends, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
