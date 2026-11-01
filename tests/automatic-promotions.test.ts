import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Api } from "grammy";
import {
  getEligiblePromotionProfiles,
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

test("sin Supabase, la selección usa la autorización local ya concedida", async () => {
  const dir = await mkdtemp(join(tmpdir(), "afrodita-auto-1-"));
  const store = new AfroditaStore(dir);
  try {
    await store.authorizeProfile(-100200, { userId: 501, displayName: "Luna", username: "luna_real" });
    await store.authorizePromotion(-100200, 501);
    const eligible = await resolvePromotionProfiles(store, memberApi(), -100200, {});
    assert.deepEqual(eligible, [{ userId: 501, displayName: "Luna" }]);
    await assert.rejects(
      getEligiblePromotionProfiles(store, memberApi(), -100200, {}),
      /AFRODITA_SUPABASE_NOT_CONFIGURED/u,
      "getEligible conserva su contrato fail-closed original",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("catálogo caído no bloquea: resolve recurre a la autorización local", async () => {
  const dir = await mkdtemp(join(tmpdir(), "afrodita-auto-2-"));
  const store = new AfroditaStore(dir);
  try {
    await store.authorizeProfile(-100201, { userId: 502, displayName: "Sofi" });
    await store.authorizePromotion(-100201, 502);
    const eligible = await resolvePromotionProfiles(
      store,
      memberApi(),
      -100201,
      { supabaseUrl: "https://example.supabase.co", supabaseKey: "sb_publishable_x" },
      async () => {
        throw new Error("catalog down");
      },
    );
    assert.deepEqual(eligible, [{ userId: 502, displayName: "Sofi" }]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("la lista y la membresía determinan elegibilidad; el consentimiento legacy no es requisito", async () => {
  const dir = await mkdtemp(join(tmpdir(), "afrodita-auto-3-"));
  const store = new AfroditaStore(dir);
  try {
    await store.authorizeProfile(-100202, { userId: 503, displayName: "Vera" });
    await store.authorizePromotion(-100202, 503);
    await store.revokePromotion(-100202, 503);
    assert.deepEqual(
      await resolvePromotionProfiles(store, memberApi(), -100202, {}),
      [{ userId: 503, displayName: "Vera" }],
      "la lista es la autorización: retirar el consentimiento legacy no baja a la verificada",
    );
    assert.deepEqual(
      await resolvePromotionProfiles(store, memberApi("left"), -100202, {}),
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

test("la promoción atrevida usa usernames reales y nunca inventa", () => {
  const withUsername = boldProfilePromotion(
    { displayName: "Ana", username: "ana_hot" },
    0.3,
    "salt-a",
  );
  assert.match(withUsername, /@ana_hot/u);
  assert.match(withUsername, /(curvas|cuerpazo|nalgas|caderas|piernas)/u);
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

test("publishProfilePromotion alterna suave y atrevido con autorización vigente", async () => {
  const makeStore = async () => {
    const dir = await mkdtemp(join(tmpdir(), "afrodita-auto-5-"));
    const store = new AfroditaStore(dir);
    await store.authorizeProfile(-100205, { userId: 505, displayName: "Ari", username: "ari_sexy" });
    await store.authorizePromotion(-100205, 505);
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
    assert.equal(sent[1]?.hasEntities, false, "índice impar: texto atrevido sin entities");
    assert.match(sent[1]?.text ?? "", /(curvas|cuerpazo|nalgas|@ari_sexy)/u);
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
