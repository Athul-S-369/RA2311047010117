import type { AppLogger } from "@affordmed/logging-middleware";
import type { NormalizedDepot } from "./depotNormalization";
import { maximizeOperationalImpact } from "./knapsack";

/** Per-depot optimal schedule — matches evaluation output contract. */
export interface DepotScheduleOutput {
  /** Depot identifier from evaluation API (`ID`) */
  ID: string;
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

    results.push({
      ID: depot.depotKey,
      selectedTaskIds: solution.selectedTaskIds,
      totalDuration: solution.totalDurationHours,
      totalImpact: solution.totalImpact,
    });

    child.info("Depot schedule materialized", {
      ID: depot.depotKey,
      selectedCount: solution.selectedTaskIds.length,
      totalDuration: solution.totalDurationHours,
      totalImpact: solution.totalImpact,
    });
  }

  log.info("All depot schedules computed", { resultCount: results.length });
  return results;
}
