import assert from "node:assert/strict";
import test from "node:test";
import type { Context } from "grammy";
import { handleAdminMenuCallback } from "../src/admin-menu.js";
import type { AfroditaStore } from "../src/store.js";

test("admin menu answers a callback that has no string data", async () => {
  let answer = "";
  const context = {
    callbackQuery: { data: undefined },
    chat: { id: -100123, type: "group" },
    answerCallbackQuery: async (options: { text?: string }) => {
      answer = options.text ?? "";
    },
  } as unknown as Context;

  await handleAdminMenuCallback(context, {} as AfroditaStore);

  assert.equal(answer, "Este botón ya no es válido.");
});
