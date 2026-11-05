import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Api } from "grammy";
import { scheduledPollContent } from "../src/messages.js";
import { publishScheduledJob } from "../src/publishers.js";
import { AfroditaStore } from "../src/store.js";
import { initialAfroditaState } from "../src/types.js";
import {
  MAX_SCHEDULED_POLL_INTERVAL_MS,
  MIN_SCHEDULED_POLL_INTERVAL_MS,
} from "../src/poll-schedule.js";

const GROUP_ID = -10092001;

async function withStore(
  run: (store: AfroditaStore, directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "afrodita-scheduled-polls-"));
  try {
    await run(new AfroditaStore(directory), directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("the first ten confirmed-group scheduled polls follow a 70/30 intimacy/market mix", () => {
  const themes: Array<"intimacy" | "market"> = [];
  const recentIds: string[] = [];
  for (let index = 0; index < 10; index += 1) {
    const poll = scheduledPollContent(
      "general",
      true,
      0.13,
      `slot-${index}`,
      recentIds.slice(-5),
      themes.slice(-10),
    );
    assert.ok(poll.adult);
    assert.ok(poll.pollTheme);
    themes.push(poll.pollTheme);
    recentIds.push(poll.templateId);
  }
  assert.equal(themes.filter((theme) => theme === "intimacy").length, 7);
  assert.equal(themes.filter((theme) => theme === "market").length, 3);
});

test("scheduled poll templates vary and avoid the ten most recent question IDs", () => {
  const recentIds: string[] = [];
  const questions = new Set<string>();
  const ids = new Set<string>();
  const themes: Array<"intimacy" | "market"> = [];
  for (let index = 0; index < 12; index += 1) {
    const poll = scheduledPollContent(
      "general",
      true,
      0.4,
      `variety-${index}`,
      recentIds.slice(-5),
      themes.slice(-10),
    );
    assert.equal(recentIds.slice(-10).includes(poll.templateId), false);
    assert.equal(questions.has(poll.question), false);
    questions.add(poll.question);
    ids.add(poll.templateId);
    recentIds.push(poll.templateId);
    if (poll.pollTheme) themes.push(poll.pollTheme);
  }
  assert.equal(ids.size, 12);
});

test("the expanded adult bank covers attraction, intimacy, and adult content without graphic descriptions", () => {
  const recentIds: string[] = [];
  const recentThemes: Array<"intimacy" | "market"> = [];
  const questions: string[] = [];
  const allOptions: string[] = [];
  for (let index = 0; index < 100; index += 1) {
    const poll = scheduledPollContent(
      "general",
      true,
      (index % 97) / 97,
      `expanded-bank-${index}`,
      recentIds.slice(-10),
      recentThemes.slice(-10),
    );
    assert.ok(poll.adult);
    assert.equal(recentIds.slice(-10).includes(poll.templateId), false);
    recentIds.push(poll.templateId);
    if (poll.pollTheme) recentThemes.push(poll.pollTheme);
    questions.push(poll.question);
    allOptions.push(...poll.options);
  }
  const bank = `${questions.join("\n")}\n${allOptions.join("\n")}`.toLocaleLowerCase("es");
  assert.match(bank, /atracci[oó]n f[ií]sic|rasgo f[ií]sico|escote|trasero/u);
  assert.match(bank, /fotograf[ií]a|videos er[oó]ticos|contenido adulto exclusivo/u);
  assert.match(bank, /fantas[ií]a consensuada|momento [ií]ntimo consensuado|l[ií]mites/u);
  assert.match(bank, /creadora adulta|contenido personalizado|suscripci[oó]n/u);
  assert.doesNotMatch(
    bank,
    /penetraci[oó]n|genitales|orgasmo|descripci[oó]n de actos sexuales expl[ií]citos/u,
  );
});

test("scheduled polls stay within Telegram question and option limits with no sales links", () => {
  for (let index = 0; index < 80; index += 1) {
    for (const allowAdultContent of [false, true]) {
      const poll = scheduledPollContent(
        "general",
        allowAdultContent,
        (index % 10) / 10,
        `limits-${index}`,
      );
      assert.ok(poll.question.length >= 1 && poll.question.length <= 300);
      assert.ok(poll.options.length >= 2 && poll.options.length <= 12);
      assert.ok(poll.options.every((option) => option.length > 0 && option.length <= 100));
      assert.equal(new Set(poll.options).size, poll.options.length);
      assert.doesNotMatch(`${poll.question}\n${poll.options.join("\n")}`, /https?:\/\/|t\.me\//iu);
      assert.equal("subjectUserIds" in poll, false);
      if (allowAdultContent) assert.equal(poll.adult, true);
      else assert.equal(poll.adult, undefined);
    }
  }
});

test("only adult-confirmed groups get adult scheduled polls; other groups get community polls", async () => {
  await withStore(async (store) => {
    await store.setEnabled(GROUP_ID, true);
    await store.updatePublicationSettings(GROUP_ID, "commercial_poll", (settings) => {
      settings.scheduleTimes = ["00:00", "23:59"];
      settings.minIntervalMs = MIN_SCHEDULED_POLL_INTERVAL_MS;
    });
    const sent: Array<{ question: string; options: string[] }> = [];
    let membershipLookups = 0;
    const api = {
      async sendPoll(_chatId: number, question: string, options: string[]) {
        sent.push({ question, options });
        return { poll: { id: `scheduled-${sent.length}` } };
      },
      async getChatMember() {
        membershipLookups += 1;
        throw new Error("scheduled surveys must not inspect verified users");
      },
    } as unknown as Pick<Api, "sendPoll" | "sendMessage" | "getChatMember">;

    assert.equal(
      await publishScheduledJob(
        api,
        store,
        GROUP_ID,
        "commercial_poll",
        "commercial_poll:test-general",
        {},
      ),
      true,
    );
    const unconfirmed = await store.loadGroup(GROUP_ID);
    assert.equal(unconfirmed.adultConfirmedAt, undefined);
    assert.equal(unconfirmed.publications.commercial_poll.history[0]?.pollTheme, undefined);
    const firstDelay = unconfirmed.publications.commercial_poll.nextScheduledAt! -
      unconfirmed.lastPollAt;
    assert.ok(
      firstDelay >= MIN_SCHEDULED_POLL_INTERVAL_MS &&
        firstDelay <= MAX_SCHEDULED_POLL_INTERVAL_MS,
    );

    await store.setAdultConfirmation(GROUP_ID, true);
    await store.updateGroup(GROUP_ID, (state) => {
      state.lastPollAt = Date.now() - 3 * 60 * 60_000;
      state.publications.commercial_poll.lastPublishedAt =
        Date.now() - 3 * 60 * 60_000;
    });
    assert.equal(
      await publishScheduledJob(
        api,
        store,
        GROUP_ID,
        "commercial_poll",
        "commercial_poll:test-adult",
        {},
      ),
      true,
    );
    const confirmed = await store.loadGroup(GROUP_ID);
    assert.ok(confirmed.adultConfirmedAt);
    assert.ok(
      confirmed.publications.commercial_poll.history.some((entry) =>
        entry.pollTheme === "intimacy" || entry.pollTheme === "market",
      ),
    );
    assert.equal(sent.length, 2);
    assert.equal(membershipLookups, 0);
  });
});

test("poll schedule and theme history survive reload without changing per-group settings", async () => {
  await withStore(async (store, directory) => {
    await store.setEnabled(GROUP_ID, true);
    await store.updatePublicationSettings(GROUP_ID, "commercial_poll", (settings) => {
      settings.enabled = false;
      settings.maxPerDay = 4;
      settings.minIntervalMs = 3 * 60 * 60_000;
      settings.scheduleTimes = ["09:00", "17:00"];
      settings.nextScheduledAt = Date.now() + 100 * 60_000;
      settings.history.push({
        id: "poll-theme-1",
        at: Date.now(),
        status: "published",
        templateId: "market-security",
        pollTheme: "market",
      });
    });

    const restartedStore = new AfroditaStore(directory);
    const persisted = await restartedStore.loadGroup(GROUP_ID);
    const settings = persisted.publications.commercial_poll;
    assert.equal(settings.enabled, false);
    assert.equal(settings.maxPerDay, 4);
    assert.equal(settings.minIntervalMs, 3 * 60 * 60_000);
    assert.deepEqual(settings.scheduleTimes, ["09:00", "17:00"]);
    assert.ok(settings.nextScheduledAt);
    assert.equal(settings.history[0]?.templateId, "market-security");
    assert.equal(settings.history[0]?.pollTheme, "market");
    assert.ok(
      settings.nextScheduledAt! > Date.now() &&
        settings.nextScheduledAt! - Date.now() < MAX_SCHEDULED_POLL_INTERVAL_MS +
          MIN_SCHEDULED_POLL_INTERVAL_MS,
    );
  });
});

test("new groups default to eight scheduled polls a day without rewriting existing limits", () => {
  const fresh = initialAfroditaState().publications.commercial_poll;
  assert.equal(fresh.maxPerDay, 8);
  assert.equal(fresh.minIntervalMs, MIN_SCHEDULED_POLL_INTERVAL_MS);
});
