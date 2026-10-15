import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readZeusVerification } from "../src/zeus-verification.js";

test("ZEUS verification lookup distinguishes verified, unverified, and unavailable data", async () => {
  const directory = await mkdtemp(join(tmpdir(), "afrodita-zeus-store-"));
  try {
    await writeFile(
      join(directory, "-100.json"),
      JSON.stringify({ promotion: { verifiedUsers: { "123": true } } }),
      "utf8",
    );
    await writeFile(join(directory, "-200.json"), "{invalid", "utf8");

    assert.deepEqual(await readZeusVerification(directory, -100, 123), {
      status: "verified",
    });
    assert.deepEqual(await readZeusVerification(directory, -100, 456), {
      status: "not_verified",
    });
    assert.deepEqual(await readZeusVerification(directory, -300, 123), {
      status: "unavailable",
      reason: "missing",
    });
    assert.deepEqual(await readZeusVerification(directory, -200, 123), {
      status: "unavailable",
      reason: "invalid",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
