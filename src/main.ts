import "dotenv/config";
import { AfroditaConfigError, loadAfroditaConfig } from "./config.js";
import { createAfroditaApplication } from "./bot.js";
import { safeErrorSummary } from "./errors.js";
import { AfroditaActivityControl } from "./activity-control.js";
import { startAfroditaIntegration } from "./integration.js";

async function main(): Promise<void> {
  const config = loadAfroditaConfig();
  const activityControl = new AfroditaActivityControl("paused");
  const application = createAfroditaApplication({ config, activityControl });
  // Integración ZEUS ↔ AFRODITA vía Supabase: sincroniza estado/eventos y
  // aplica órdenes del panel de ZEUS. El control de actividad inicia pausado
  // y solo se habilita tras leer el estado persistente compartido.
  const integration = startAfroditaIntegration({
    store: application.store,
    config,
    activityControl,
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
