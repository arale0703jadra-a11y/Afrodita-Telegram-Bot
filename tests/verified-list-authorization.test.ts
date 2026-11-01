import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Api } from "grammy";
import {
  orderEligiblePromotionProfiles,
  publishProfilePromotion,
  resolvePromotionProfiles,
} from "../src/publishers.js";
import { AfroditaStore } from "../src/store.js";
import {
  boldProfilePromotion,
  entertainmentPollContent,
  verifiedModelsPollContent,
} from "../src/messages.js";
import type { PublicationTrigger } from "../src/publications.js";

function memberApi(status = "member"): Pick<Api, "getChatMember"> {
  return {
    async getChatMember() {
      return { status } as never;
    },
  } as unknown as Pick<Api, "getChatMember">;
}

test("estar en la lista basta: publica sin ningún consentimiento ni confirmación", async () => {
  const dir = await mkdtemp(join(tmpdir(), "afrodita-list-1-"));
  const store = new AfroditaStore(dir);
  const sent: string[] = [];
  const api = {
    async sendMessage(_chatId: number, text: string) {
      sent.push(text);
    },
  } as unknown as Pick<Api, "sendMessage">;
  try {
    await store.setEnabled(-100301, true);
    await store.authorizeProfile(-100301, {
      userId: 601,
      displayName: "Nadia",
      username: "nadia_oficial",
    });
    const eligible = await resolvePromotionProfiles(store, memberApi(), -100301, {});
    assert.deepEqual(eligible, [{ userId: 601, displayName: "Nadia" }]);
    const trigger: PublicationTrigger = { kind: "activity", userId: 601 };
    const ok = await publishProfilePromotion(
      api,
      store,
      -100301,
      { userId: 601, displayName: "Nadia" },
      trigger,
      1,
    );
    assert.equal(ok, true, "sin consentimiento adicional: la lista es la autorización");
    assert.equal(sent.length, 1);
    assert.match(sent[0] ?? "", /(nadia_oficial|curvas|cuerpazo)/u);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("retirar la usuaria de la lista (admin) la elimina de futuras publicaciones", async () => {
  const dir = await mkdtemp(join(tmpdir(), "afrodita-list-2-"));
  const store = new AfroditaStore(dir);
  const api = {
    async sendMessage() {
      // no enviado
    },
  } as unknown as Pick<Api, "sendMessage">;
  try {
    await store.setEnabled(-100302, true);
    await store.authorizeProfile(-100302, { userId: 602, displayName: "Vera" });
    const trigger: PublicationTrigger = { kind: "activity", userId: 602 };
    assert.equal(
      await publishProfilePromotion(api, store, -100302, { userId: 602, displayName: "Vera" }, trigger, 0),
      true,
    );
    await store.removeProfile(-100302, 602);
    assert.deepEqual(await resolvePromotionProfiles(store, memberApi(), -100302, {}), []);
    assert.equal(
      await publishProfilePromotion(api, store, -100302, { userId: 602, displayName: "Vera" }, trigger, 1),
      false,
      "retirada por administración → sin nuevas publicaciones",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("usernames reales en promociones y encuestas personalizadas", () => {
  const bold = boldProfilePromotion(
    { displayName: "Luna", username: "luna_oficial" },
    0.2,
    "s1",
  );
  assert.match(bold, /@luna_oficial/u);
  const poll = verifiedModelsPollContent("general", [
    { groupId: -100303, userId: 603, displayName: "Luna", username: "luna_oficial", media: [] },
  ], 0.5);
  assert.ok(
    poll.options.some((option) => option.includes("@luna_oficial")),
    "la encuesta personalizada usa el username real",
  );
});

test("aislamiento por grupo: una lista no se reutiliza en otro grupo", async () => {
  const dir = await mkdtemp(join(tmpdir(), "afrodita-list-4-"));
  const store = new AfroditaStore(dir);
  try {
    await store.authorizeProfile(-100304, { userId: 604, displayName: "Ana" });
    assert.deepEqual(await resolvePromotionProfiles(store, memberApi(), -100304, {}), [
      { userId: 604, displayName: "Ana" },
    ]);
    assert.deepEqual(await resolvePromotionProfiles(store, memberApi(), -100305, {}), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("las usuarias que salen del grupo dejan de ser elegibles", async () => {
  const dir = await mkdtemp(join(tmpdir(), "afrodita-list-5-"));
  const store = new AfroditaStore(dir);
  try {
    await store.authorizeProfile(-100306, { userId: 606, displayName: "Sara" });
    assert.equal(
      (await resolvePromotionProfiles(store, memberApi("left"), -100306, {})).length,
      0,
      "sin membresía activa no se promociona",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("encuestas generales disponibles siempre y rotación intacta", () => {
  const general = entertainmentPollContent("general", 0.9, "slot");
  assert.ok(general.question.length > 0);
  const newcomer = orderEligiblePromotionProfiles(
    [
      { userId: 1, displayName: "A" },
      { userId: 2, displayName: "B" },
    ],
    [2],
  );
  assert.deepEqual(
    newcomer.map((profile) => profile.userId),
    [1, 2],
    "la rotación prioriza a quien no fue promocionada recientemente",
  );
});

test("las autorizaciones locales sobreviven a la recarga del almacenamiento", async () => {
  const dir = await mkdtemp(join(tmpdir(), "afrodita-list-7-"));
  try {
    const first = new AfroditaStore(dir);
    await first.authorizeProfile(-100307, {
      userId: 607,
      displayName: "Kiara",
      username: "kiara_real",
    });
    const reloaded = new AfroditaStore(dir);
    const state = await reloaded.loadGroup(-100307);
    assert.equal(state.authorizedProfiles["607"]?.username, "kiara_real");
    const eligible = await resolvePromotionProfiles(reloaded, memberApi(), -100307, {});
    assert.deepEqual(eligible, [{ userId: 607, displayName: "Kiara" }]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
