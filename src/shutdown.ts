import { EventEmitter } from "node:events";
import { safeErrorType } from "./errors.js";

interface StoppableBot {
  stop(): Promise<void>;
}

const installed = new WeakMap<object, () => void>();

export function installGracefulShutdown(
  bot: StoppableBot,
  signals: EventEmitter = process,
): () => void {
  const existing = installed.get(bot);
  if (existing) return existing;

  let stopping: Promise<void> | undefined;
  const shutdown = (): void => {
    stopping ??= Promise.resolve().then(() => bot.stop()).catch((error: unknown) => {
      process.exitCode = 1;
      console.error(
        `[AFRODITA] Falló el cierre del polling (${safeErrorType(error)}).`,
      );
    });
  };
  const dispose = (): void => {
    signals.removeListener("SIGINT", shutdown);
    signals.removeListener("SIGTERM", shutdown);
    installed.delete(bot);
  };

  signals.once("SIGINT", shutdown);
  signals.once("SIGTERM", shutdown);
  installed.set(bot, dispose);
  return dispose;
}
