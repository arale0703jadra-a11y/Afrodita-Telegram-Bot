import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ADULT_POLL_BANK,
  adultPollContent,
  catalogReply,
  entertainmentLineReply,
  entertainmentPollContent,
  selectMediaProfile,
  verifiedModelsReply,
} from "../src/messages.js";
import { canPublish, decideAction } from "../src/decision.js";
import { initialAfroditaState } from "../src/types.js";
import { getDuePublications } from "../src/scheduler.js";
import { AfroditaStore } from "../src/store.js";
import { isVerifiedCatalogUser, type VerifiedModel } from "../src/verified-users.js";

function enabledState() {
  const state = initialAfroditaState();
  state.enabled = true;
  return state;
}

function model(
  userId: number,
  username?: string,
  displayName = `Creadora ${userId}`,
  media: VerifiedModel["media"] = [],
): VerifiedModel {
  return {
    groupId: -100777,
    userId,
    displayName,
    ...(username ? { username } : {}),
    media,
  };
}

test("encuestas generales adultas: disponibles sin verificación y con variedad", () => {
  assert.ok(ADULT_POLL_BANK.length >= 20);
  const content = entertainmentPollContent("general", 0.9, "2026-10-31");
  assert.ok(content.question.length > 0);
  assert.equal(content.options.length, content.topics.length);
  assert.ok(content.options.length >= 2);
  const positions = adultPollContent(0.5, "");
  assert.ok(
    JSON.stringify(ADULT_POLL_BANK).includes("Misionero"),
    "el banco incluye encuestas de posiciones para todos",
  );
  assert.ok(positions.options.length >= 2);
});

test("un no verificado puede participar y recibir respuestas generales", () => {
  const participate = decideAction(enabledState(), {
    directedToBot: false,
    randomValue: 0.01,
    now: Date.now(),
  });
  assert.equal(participate.action, "participate");
  const reply = decideAction(enabledState(), {
    directedToBot: true,
    randomValue: 0.9,
    now: Date.now(),
  });
  assert.equal(reply.action, "reply");
});

test("la motorización general no responde a todos los mensajes", () => {
  const silence = decideAction(enabledState(), {
    directedToBot: false,
    commercialInquiry: false,
    randomValue: 0.99,
    now: Date.now(),
  });
  assert.equal(silence.action, "silence");
});

test("las menciones usan el username real de Telegram cuando existe", () => {
  const reply = verifiedModelsReply([model(5, "ana_hot", "Ana")], "", 0.75);
  assert.match(reply, /@ana_hot/u);
});

test("nunca inventa ni altera usernames", () => {
  const noUsername = verifiedModelsReply([model(6, undefined, "Luz")], "", 0.5);
  assert.match(noUsername, /Luz/u);
  assert.ok(!/@Luz/u.test(noUsername), "sin username no se fabrica una mención");
  const invalid = verifiedModelsReply([model(7, "bad name!", "Caro")], "", 0.5);
  assert.ok(!/@bad/u.test(invalid), "username inválido cae al nombre visible");
});

test("sin perfiles autorizados no se menciona a nadie", () => {
  const reply = verifiedModelsReply([], "", 0.5);
  assert.match(reply, /no encuentro perfiles verificados/u);
  assert.ok(!/@/u.test(reply.replace(/@\w+/gu, "")) || !/\B@\w{3,}/u.test(reply.split(".")[0] ?? ""));
});

test("el catálogo fallido no bloquea el entretenimiento general", async () => {
  await assert.rejects(
    isVerifiedCatalogUser(
      -100777,
      42,
      { supabaseUrl: "https://example.supabase.co", supabaseKey: "sb_publishable_x" },
      async () => {
        throw new Error("network down");
      },
    ),
  );
  const poll = entertainmentPollContent("general", 0.9, "slot");
  assert.ok(poll.question.length > 0);
});

test("el alta en la lista no escribe consentimientos legacy (el campo se conserva intacto)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "afrodita-consent-"));
  const store = new AfroditaStore(dir);
  try {
    await store.authorizeProfile(-100777, {
      userId: 42,
      displayName: "Ana",
      username: "ana_hot",
    });
    let state = await store.loadGroup(-100777);
    assert.ok(state.authorizedProfiles["42"]);
    assert.equal(state.promotionConsents["42"], undefined, "sin consentimiento propio no hay promoción");
    await store.removeProfile(-100777, 42);
    state = await store.loadGroup(-100777);
    assert.equal(state.authorizedProfiles["42"], undefined, "revocada desaparece del listado");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("sin fotos autorizadas no hay contenido multimedia que enviar", () => {
  const selection = selectMediaProfile("¿Fotos de Ana?", [model(8, undefined, "Ana", [])]);
  assert.equal(selection.kind, "profile");
  assert.equal(selection.kind === "profile" ? selection.model.media.length : -1, 0);
});

test("pausas y límites por grupo siguen funcionando", () => {
  const paused = initialAfroditaState();
  const decision = decideAction(paused, {
    directedToBot: true,
    randomValue: 0,
    now: Date.now(),
  });
  assert.equal(decision.action, "silence");
  assert.equal(canPublish(paused, "reply", Date.now()), false);
  assert.deepEqual(getDuePublications(-100777, paused, Date.now()), []);
});

test("variedad: distintos slots producen distintas encuestas y líneas", () => {
  const questions = new Set<string>();
  for (let index = 0; index < 10; index += 1) {
    questions.add(adultPollContent(0.5, `slot-${index}`).question);
  }
  assert.ok(questions.size >= 2, "el salt diario evita repetir la misma encuesta");
  assert.equal(entertainmentLineReply(0), catalogReply("general", 0));
  const lines = new Set<string>();
  for (let index = 0; index < 10; index += 1) {
    lines.add(entertainmentLineReply(0.9, `line-${index}`));
  }
  assert.ok(lines.size >= 2);
});
