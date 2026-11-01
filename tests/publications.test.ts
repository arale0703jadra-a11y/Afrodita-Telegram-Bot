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
  publishProfilePromotion,
  publishScheduledJob,
} from "../src/publishers.js";
import {
  finalizePublication,
  reservePublication,
} from "../src/publications.js";
import { AfroditaStore } from "../src/store.js";
import type { AfroditaState } from "../src/types.js";

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
    { userId: 456, displayName: "Zoë 🌺" },
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
    assert.deepEqual(eligible, [{ userId: 789, displayName: "Authorized" }]);
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
      now,
    );
    assert.ok(first);

    assert.equal(
      await reservePublication(
        store,
        -100124,
        "commercial_poll",
        { kind: "activity" },
        now + 29 * 60_000,
      ),
      undefined,
    );
    const next = await reservePublication(
      store,
      -100124,
      "commercial_poll",
      { kind: "activity" },
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
        now + 59_999,
      ),
      undefined,
    );
    const next = await reservePublication(
      store,
      -100127,
      "commercial_poll",
      { kind: "activity" },
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
