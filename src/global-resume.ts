import type { AfroditaStore } from "./store.js";
import { PUBLICATION_CATEGORIES } from "./types.js";

/**
 * Control único y global de AFRODITA.
 *
 * Al reanudar globalmente, todos los grupos registrados quedan habilitados y
 * los bloqueos individuales heredados (enabled, activityPaused y los toggles
 * por categoría) se normalizan a activos. Estos campos son inertos para la
 * ejecución: la única pausa válida es el estado global (`running`/`paused`).
 *
 * El barrido NO toca datos funcionales ni históricos: conserva horarios,
 * cuotas, intervalos, historial, contadores diarios y silencios internos,
 * por lo que es idempotente y no puede provocar ejecuciones duplicadas.
 */
export interface LegacySweepResult {
  /** Grupos registrados encontrados. */
  groups: number;
  /** Grupos cuyo estado heredado fue normalizado. */
  changed: number;
  /** Grupos que no pudieron leerse/actualizarse (se omiten sin detener el resto). */
  failed: number;
}

export async function sweepLegacyBlocks(
  store: AfroditaStore,
): Promise<LegacySweepResult> {
  let groupIds: number[];
  try {
    groupIds = await store.listGroupIds();
  } catch (error) {
    throw new Error(
      `AFRODITA_LEGACY_SWEEP_ENUM_FAILED:${error instanceof Error ? error.name : "unknown"}`,
    );
  }
  const result: LegacySweepResult = {
    groups: groupIds.length,
    changed: 0,
    failed: 0,
  };
  for (const chatId of groupIds) {
    try {
      const updated = await store.updateGroup(chatId, (state) => {
        let dirty = false;
        if (!state.enabled) {
          state.enabled = true;
          dirty = true;
        }
        if (state.activityPaused) {
          state.activityPaused = false;
          dirty = true;
        }
        for (const category of PUBLICATION_CATEGORIES) {
          const settings = state.publications[category];
          if (!settings.enabled) {
            settings.enabled = true;
            dirty = true;
          }
          if (!settings.scheduledEnabled) {
            settings.scheduledEnabled = true;
            dirty = true;
          }
          if (!settings.activityEnabled) {
            settings.activityEnabled = true;
            dirty = true;
          }
        }
        return dirty;
      });
      if (updated.result) result.changed += 1;
    } catch {
      result.failed += 1;
    }
  }
  return result;
}
