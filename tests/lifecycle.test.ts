import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { installGracefulShutdown } from "../src/shutdown.js";

test("graceful shutdown registers one handler per signal and stops polling once", async () => {
  const signals = new EventEmitter();
  let stopCalls = 0;
  const bot = {
    async stop() {
      stopCalls += 1;
    },
  };
  const dispose = installGracefulShutdown(bot, signals);
  const duplicateDispose = installGracefulShutdown(bot, signals);

  assert.equal(dispose, duplicateDispose);
  assert.equal(signals.listenerCount("SIGINT"), 1);
  assert.equal(signals.listenerCount("SIGTERM"), 1);
  signals.emit("SIGINT");
  signals.emit("SIGTERM");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stopCalls, 1);

  dispose();
  assert.equal(signals.listenerCount("SIGINT"), 0);
  assert.equal(signals.listenerCount("SIGTERM"), 0);
});
