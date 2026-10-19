import assert from "node:assert/strict";
import test from "node:test";
import { safeErrorSummary } from "../src/errors.js";

test("Telegram 429 logs the retry delay without logging the description or payload", () => {
  const error = {
    error_code: 429,
    description: "contains sensitive data",
    parameters: { retry_after: 17 },
    payload: { chat_id: 123, text: "private message" },
  };
  const summary = safeErrorSummary(error);
  assert.equal(summary, "Telegram API HTTP 429; retry_after=17s");
  assert.doesNotMatch(summary, /sensitive|private|123/);
});

test("Telegram and network errors have bounded safe summaries", () => {
  assert.equal(safeErrorSummary({ error_code: 403, description: "secret" }), "Telegram API HTTP 403");
  assert.equal(safeErrorSummary(new TypeError("private endpoint")), "TypeError");
  assert.equal(safeErrorSummary({ description: "arbitrary secret" }), "unknown");
  const unusual = new Error("private");
  unusual.name = "token-value-in-name";
  assert.equal(safeErrorSummary(unusual), "unknown");
});
