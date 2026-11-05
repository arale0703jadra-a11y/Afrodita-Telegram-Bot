import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Api } from "grammy";
import {
  publishProfilePromotion,
  resolvePromotionProfiles,
} from "../src/publishers.js";
import { AfroditaStore } from "../src/store.js";
import {
  boldProfilePromotion,
  entertainmentPollContent,
  saltedRandomValue,
} from "../src/messages.js";
import type { PublicationTrigger } from "../src/publications.js";

function memberApi(status = "member"): Pick<Api, "getChatMember"> {
  return {
    async getChatMember() {
      return { status } as never;
    },
  } as unknown as Pick<Api, "getChatMember">;
}

const CONFIG = {
  supabaseUrl: "https://example.supabase.co",
  supabaseKey: "sb_publishable_tests",
};

function catalogFetcher(groupId: number, userIds: number[]): typeof fetch {
  return async () => new Response(JSON.stringify(userIds.map((userId) => ({
    group_id: groupId,
    user_id: userId,
    display_name: `User ${userId}`,
  }))), { status: 200 });
}

test("sin Supabase, la selección personalizada falla de forma cerrada", async () => {
  const dir = await mkdtemp(join(tmpdir(), "afrodita-auto-1-"));
  const store = new AfroditaStore(dir);
  try {
    await store.authorizeProfile(-100200, { userId: 501, displayName: "Luna", username: "luna_real" });
    await store.authorizePromotion(-100200, 501);
    await assert.rejects(
      resolvePromotionProfiles(store, memberApi(), -100200, {}),
      /AFRODITA_SUPABASE_NOT_CONFIGURED/u,
      "la autorización local no sustituye la verificación actual",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("catálogo caído bloquea solo la promoción personalizada, no el entretenimiento", async () => {
  const dir = await mkdtemp(join(tmpdir(), "afrodita-auto-2-"));
  const store = new AfroditaStore(dir);
  try {
    await store.authorizeProfile(-100201, { userId: 502, displayName: "Sofi" });
    await store.authorizePromotion(-100201, 502);
    await assert.rejects(
      resolvePromotionProfiles(
        store,
        memberApi(),
        -100201,
        CONFIG,
        async () => {
        throw new Error("catalog down");
        },
      ),
      /AFRODITA_SUPABASE_NETWORK_ERROR/u,
    );
    assert.ok(entertainmentPollContent("general", 0.9, "safe-slot").question);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("se requieren lista local, permiso granular, verificación vigente y membresía", async () => {
  const dir = await mkdtemp(join(tmpdir(), "afrodita-auto-3-"));
  const store = new AfroditaStore(dir);
  try {
    await store.authorizeProfile(-100202, { userId: 503, displayName: "Vera" });
    await store.authorizePromotion(-100202, 503);
    const fetcher = catalogFetcher(-100202, [503]);
    assert.deepEqual(
      await resolvePromotionProfiles(store, memberApi(), -100202, CONFIG, fetcher),
      [{ userId: 503, displayName: "Vera", mention: true, body: false }],
    );
    await store.revokePromotion(-100202, 503);
    assert.deepEqual(
      await resolvePromotionProfiles(store, memberApi(), -100202, CONFIG, fetcher),
      [],
      "retirar el permiso legado revoca catálogo, menciones y encuestas sin tocar el perfil",
    );
    assert.deepEqual(
      await resolvePromotionProfiles(store, memberApi("left"), -100202, CONFIG, fetcher),
      [],
      "sin membresía activa no se promociona",
    );
    await store.removeProfile(-100202, 503);
    const afterRevoke = await store.loadGroup(-100202);
    assert.equal(afterRevoke.authorizedProfiles["503"], undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("la presentación juguetona usa usernames reales sin atribuir rasgos físicos", () => {
  const withUsername = boldProfilePromotion(
    { displayName: "Ana", username: "ana_hot" },
    0.3,
    "salt-a",
  );
  assert.match(withUsername, /@ana_hot/u);
  assert.match(withUsername, /privacidad|respeto|decidi[oó] compartir/u);
  assert.doesNotMatch(withUsername, /curvas|cuerpazo|nalgas|caderas|piernas|escote/u);
  const noUsername = boldProfilePromotion({ displayName: "Luz María" }, 0.4, "b");
  assert.match(noUsername, /Luz María/u);
  assert.ok(!/@Luz/u.test(noUsername));
  const invalid = boldProfilePromotion({ displayName: "Caro", username: "bad name!" }, 0.5, "c");
  assert.ok(!/@bad/u.test(invalid));
  const variants = new Set(
    [0, 1, 2, 3, 4, 5].map((index) =>
      boldProfilePromotion({ displayName: "Ana", username: "ana_hot" }, 0.5, `v${index}`),
    ),
  );
  assert.ok(variants.size >= 2, "el salt alterna expresiones");
});

test("publishProfilePromotion mantiene el tono juguetón sin convertir el permiso body en comentarios físicos", async () => {
  const makeStore = async () => {
    const dir = await mkdtemp(join(tmpdir(), "afrodita-auto-5-"));
    const store = new AfroditaStore(dir);
    await store.authorizeProfile(-100205, { userId: 505, displayName: "Ari", username: "ari_sexy" });
    await store.authorizePromotion(-100205, 505);
    await store.setContentConsent(-100205, 505, 505, ["body"], true);
    await store.setAdultConfirmation(-100205, true);
    await store.setEnabled(-100205, true);
    return { dir, store };
  };
  const sent: Array<{ text: string; hasEntities: boolean }> = [];
  const api = {
    async sendMessage(_chatId: number, text: string, options?: { entities?: unknown[] }) {
      sent.push({ text, hasEntities: Boolean(options?.entities?.length) });
    },
  } as unknown as Pick<Api, "sendMessage">;
  const profile = { userId: 505, displayName: "Ari" };
  const first = await makeStore();
  try {
    const triggerA: PublicationTrigger = { kind: "activity", userId: 505 };
    const soft = await publishProfilePromotion(api, first.store, -100205, profile, triggerA, 0);
    assert.equal(soft, true);
    assert.equal(sent[0]?.hasEntities, true, "índice par: plantilla suave con mención");
  } finally {
    await rm(first.dir, { recursive: true, force: true });
  }
  const second = await makeStore();
  try {
    const triggerB: PublicationTrigger = { kind: "activity", userId: 505 };
    const bold = await publishProfilePromotion(api, second.store, -100205, profile, triggerB, 1);
    assert.equal(bold, true);
    assert.equal(sent[1]?.hasEntities, true, "la mención depende del permiso mention");
    assert.match(sent[1]?.text ?? "", /😏|🔥|💋|👀/u);
    assert.doesNotMatch(sent[1]?.text ?? "", /curvas|cuerpazo|nalgas|caderas|piernas|escote|@ari_sexy/u);
  } finally {
    await rm(second.dir, { recursive: true, force: true });
  }
  const third = await makeStore();
  try {
    await third.store.removeProfile(-100205, 505);
    const triggerC: PublicationTrigger = { kind: "activity", userId: 505 };
    const blocked = await publishProfilePromotion(api, third.store, -100205, profile, triggerC, 2);
    assert.equal(blocked, false, "revocado → se omite la publicación");
    assert.equal(sent.length, 2, "sin envío tras la revocación");
  } finally {
    await rm(third.dir, { recursive: true, force: true });
  }
});

test("saltedRandomValue varía por salt; la encuesta general sigue siempre disponible", () => {
  assert.equal(saltedRandomValue(0.5, "slot-a"), saltedRandomValue(0.5, "slot-a"));
  const salts = new Set(
    ["a", "b", "c", "d", "e", "f", "g", "h"].map((salt) =>
      saltedRandomValue(0.5, `slot-${salt}`),
    ),
  );
  assert.ok(salts.size >= 2, "el salt desplaza el valor variado");
  for (const value of [0, 0.25, 0.5, 0.99]) {
    const mixed = saltedRandomValue(value, "x");
    assert.ok(mixed >= 0 && mixed < 1, String(mixed));
  }
  const general = entertainmentPollContent("general", 0.9, "slot-x");
  assert.ok(general.question.length > 0, "encuesta general disponible sin catálogo");
});
