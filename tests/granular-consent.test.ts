import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Api } from "grammy";
import { adultPollContent, entertainmentLineReply, entertainmentPollContent, isAdultGeneratedReply } from "../src/messages.js";
import { publishPoll } from "../src/publishers.js";
import { AfroditaStore } from "../src/store.js";
import { initialAfroditaState } from "../src/types.js";
import type { ContentPermission } from "../src/types.js";

async function withStore(run: (store: AfroditaStore, directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "afrodita-granular-consent-"));
  try {
    await run(new AfroditaStore(directory), directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("la migración legacy conserva catálogo, mención y encuestas, pero nunca amplía cuerpo o multimedia", async () => {
  await withStore(async (_store, directory) => {
    const chatId = -100771;
    const state = initialAfroditaState();
    state.promotionConsents["771"] = 1_700_000_000_000;
    const { contentConsents: _discarded, contentConsentAudit: _audit, adultConfirmedAt: _adult, ...legacy } = state;
    await writeFile(join(directory, `${chatId}.json`), JSON.stringify(legacy), "utf8");

    const migrated = await new AfroditaStore(directory).loadGroup(chatId);
    const consent = migrated.contentConsents["771"]!;
    assert.equal(consent.catalog.granted, true);
    assert.equal(consent.mention.granted, true);
    assert.equal(consent.polls.granted, true);
    assert.equal(consent.body.granted, false);
    assert.equal(consent.photos.granted, false);
    assert.equal(consent.videos.granted, false);
    assert.equal(consent.body.grantedAt, undefined);
  });
});

test("otorgar y retirar permisos afecta solo al permiso elegido y sobrevive a recargar", async () => {
  await withStore(async (store, directory) => {
    const chatId = -100772;
    const permissions: ContentPermission[] = ["mention", "body", "photos"];
    await store.setContentConsent(chatId, 772, 772, permissions, true, 1_700_000_000_001);
    await store.setContentConsent(chatId, 772, 772, ["body"], false, 1_700_000_000_002);

    const reloaded = await new AfroditaStore(directory).loadGroup(chatId);
    const consent = reloaded.contentConsents["772"]!;
    assert.equal(consent.mention.granted, true);
    assert.equal(consent.photos.granted, true);
    assert.equal(consent.videos.granted, false);
    assert.equal(consent.body.granted, false);
    assert.equal(consent.body.grantedAt, 1_700_000_000_001);
    assert.equal(consent.body.revokedAt, 1_700_000_000_002);
    assert.equal(consent.body.revokedByUserId, 772);
    assert.deepEqual(
      reloaded.contentConsentAudit.map((entry) => [entry.permission, entry.action, entry.userId]),
      [
        ["mention", "granted", 772],
        ["body", "granted", 772],
        ["photos", "granted", 772],
        ["body", "revoked", 772],
      ],
    );
    await assert.rejects(
      store.setContentConsent(chatId, 772, 773, ["catalog"], true),
      /AFRODITA_CONTENT_CONSENT_INVALID/u,
    );
  });
});

test("el estado adulto persiste y el publicador bloquea encuestas adultas sin confirmación", async () => {
  await withStore(async (store, directory) => {
    const chatId = -100773;
    await store.setEnabled(chatId, true);
    const adultPoll = adultPollContent(0.5, "test-slot");
    let sendCount = 0;
    const api = {
      async sendPoll() {
        sendCount += 1;
        return { poll: { id: "adult-poll" } };
      },
    } as unknown as Pick<Api, "sendPoll">;

    assert.equal(
      await publishPoll(api, store, chatId, "commercial_poll", adultPoll, { kind: "activity" }),
      false,
    );
    assert.equal(sendCount, 0);
    assert.equal(
      await publishPoll(
        api,
        store,
        chatId,
        "commercial_poll",
        entertainmentPollContent("general", 0.9, "safe-slot"),
        { kind: "activity" },
      ),
      true,
      "las encuestas comunitarias siguen funcionando sin confirmación",
    );

    const confirmedChatId = -100774;
    await store.setEnabled(confirmedChatId, true);
    await store.setAdultConfirmation(confirmedChatId, true, 1_700_000_000_003);
    const reloaded = await new AfroditaStore(directory).loadGroup(confirmedChatId);
    assert.equal(reloaded.adultConfirmedAt, 1_700_000_000_003);
    assert.equal(
      await publishPoll(
        api,
        new AfroditaStore(directory),
        confirmedChatId,
        "commercial_poll",
        adultPoll,
        { kind: "activity" },
      ),
      true,
    );
    assert.equal(sendCount, 2);

    await store.setAdultConfirmation(confirmedChatId, false, 1_700_000_000_004);
    assert.equal((await store.loadGroup(confirmedChatId)).adultConfirmedAt, undefined);
    assert.equal(isAdultGeneratedReply(entertainmentLineReply(0.9, "", true)), true);
    assert.equal(isAdultGeneratedReply(entertainmentLineReply(0.9)), false);
  });
});
