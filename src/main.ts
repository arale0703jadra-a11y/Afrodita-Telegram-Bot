import "dotenv/config";
import { AfroditaConfigError, loadAfroditaConfig } from "./config.js";
import { createAfroditaApplication } from "./bot.js";
import { safeErrorSummary } from "./errors.js";
import { startAfroditaIntegration } from "./integration.js";

async function main(): Promise<void> {
  const config = loadAfroditaConfig();
  const application = createAfroditaApplication({ config });
  // Integración ZEUS ↔ AFRODITA vía Supabase: sincroniza estado/eventos y
  // aplica órdenes del panel de ZEUS. Sin variables Supabase queda inactiva
  // y AFRODITA conserva su operación autónoma.
  const integration = startAfroditaIntegration({
    store: application.store,
    config,
  });
  try {
    await application.start();
  } finally {
    integration.stop();
  }
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
