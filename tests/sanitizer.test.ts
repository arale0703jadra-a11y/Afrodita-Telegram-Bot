import assert from "node:assert/strict";
import test from "node:test";
import { classifyTopic } from "../src/analytics.js";
import { isCommercialInquiry } from "../src/messages.js";
import { sanitizeIncomingText } from "../src/utils/sanitizer.js";

test("AFRODITA sanitizer removes controls and markup while preserving visible text", () => {
  const sanitized = sanitizeIncomingText(
    "ca\u0000tálogo <b>precio</b> **fotos** <script>alert(1)</script>",
  );
  assert.match(sanitized, /catálogo/u);
  assert.match(sanitized, /precio/u);
  assert.match(sanitized, /fotos/u);
  assert.match(sanitized, /alert\(1\)/u);
  assert.doesNotMatch(sanitized, /<\s*\/?\s*(?:b|script)\b/iu);
});

test("AFRODITA filters classify sanitized text rather than markup", () => {
  assert.equal(isCommercialInquiry("<b>catálogo</b> fotos"), true);
  assert.equal(classifyTopic("<b>producto</b> local"), "productos");
});
