import "dotenv/config";
import { AfroditaConfigError, loadAfroditaConfig } from "./config.js";
import { createAfroditaApplication } from "./bot.js";
import { safeErrorSummary } from "./errors.js";

async function main(): Promise<void> {
  const application = createAfroditaApplication({
    config: loadAfroditaConfig(),
  });
  await application.start();
}

void main().catch((error: unknown) => {
  console.error(
    `[AFRODITA] No se pudo iniciar: ${
      error instanceof AfroditaConfigError
        ? error.message
        : `(${safeErrorSummary(error)})`
    }.`,
  );
  process.exitCode = 1;
});
