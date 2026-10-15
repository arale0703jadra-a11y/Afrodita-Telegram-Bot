import assert from "node:assert/strict";
import test from "node:test";
import { checkGroupAdministrator } from "../src/permissions.js";

test("creator and administrator are authorized while a normal member is not", async () => {
  for (const status of ["creator", "administrator"]) {
    assert.deepEqual(
      await checkGroupAdministrator(
        { getChatMember: async () => ({ status }) },
        -100,
        123,
      ),
      { status: "administrator" },
    );
  }
  assert.deepEqual(
    await checkGroupAdministrator(
      { getChatMember: async () => ({ status: "member" }) },
      -100,
      123,
    ),
    { status: "not_administrator" },
  );
});

test("administrator checks distinguish invalid identity and Telegram lookup errors", async () => {
  let calls = 0;
  const api = {
    async getChatMember() {
      calls += 1;
      throw new Error("lookup failed");
    },
  };
  assert.deepEqual(await checkGroupAdministrator(api, 0, 123), {
    status: "not_administrator",
  });
  assert.equal(calls, 0);

  const result = await checkGroupAdministrator(api, -100, 123);
  assert.equal(result.status, "unavailable");
  if (result.status === "unavailable") {
    assert.match(String(result.error), /lookup failed/);
  }
});
