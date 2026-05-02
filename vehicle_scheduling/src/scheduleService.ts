import type { AppLogger } from "@affordmed/logging-middleware";
import type { NormalizedDepot } from "./depotNormalization";
import { maximizeOperationalImpact } from "./knapsack";

/** Serialize depot ID like evaluation API (`"ID": 1` numeric when possible). */
export function formatDepotIdForResponse(depotKey: string): string | number {
  if (/^\d+$/.test(depotKey)) {
    return parseInt(depotKey, 10);
  }
  return depotKey;
}

/** Per-depot optimal schedule — matches evaluation output contract. */
export interface DepotScheduleOutput {
  /** Depot identifier from evaluation API (`ID`) */
  ID: string | number;
  selectedTaskIds: string[];
  /** Sum of `Duration` (hours) for selected vehicles */
  totalDuration: number;
  /** Sum of `Impact` for selected vehicles */
  totalImpact: number;
}

/**
 * Runs 0/1 knapsack per depot: maximize total Impact with total Duration ≤ MechanicHours
 * (encoded via merged knapsack weight units vs capacity — see depotNormalization).
 */
export function buildOptimalSchedules(
  depots: NormalizedDepot[],
  log: AppLogger
): DepotScheduleOutput[] {
  log.info("Building optimal schedules for all depots", { depotCount: depots.length });

  const results: DepotScheduleOutput[] = [];

  for (const depot of depots) {
    const child = log.child({ depotKey: depot.depotKey });
    child.info("Scheduling depot", {
      taskCount: depot.tasks.length,
      knapsackCapacity: depot.knapsackCapacity,
    });

    const solution = maximizeOperationalImpact(depot.tasks, depot.knapsackCapacity, child);

    const depotId = formatDepotIdForResponse(depot.depotKey);
    results.push({
      ID: depotId,
      selectedTaskIds: solution.selectedTaskIds,
      totalDuration: solution.totalDurationHours,
      totalImpact: solution.totalImpact,
    });

    child.info("Depot schedule materialized", {
      ID: depotId,
      selectedCount: solution.selectedTaskIds.length,
      totalDuration: solution.totalDurationHours,
      totalImpact: solution.totalImpact,
    });
  }

  log.info("All depot schedules computed", { resultCount: results.length });
  return results;
}
