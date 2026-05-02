import type { AppLogger } from "@affordmed/logging-middleware";
import type { MaintenanceTask } from "./knapsack";

/** Smallest time unit: minutes (hours * 60 rounded) for integer knapsack */
export const MINUTES_PER_HOUR = 60;

export interface NormalizedDepot {
  depotKey: string;
  label: string;
  mechanicBudgetMinutes: number;
  tasks: MaintenanceTask[];
}

function pickNumber(obj: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && !Number.isNaN(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  }
  return undefined;
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.length > 0) return v;
    if (typeof v === "number") return String(v);
  }
  return undefined;
}

/**
 * Flattens heterogeneous depot payloads from the evaluation API into a consistent shape.
 */
export function normalizeDepotPayload(raw: unknown, log: AppLogger): NormalizedDepot[] {
  log.info("Normalizing depot payload", { payloadType: typeof raw });

  let list: unknown[] = [];
  if (Array.isArray(raw)) {
    list = raw;
  } else if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (Array.isArray(o.depots)) list = o.depots;
    else if (Array.isArray(o.data)) list = o.data;
    else if (Array.isArray(o.results)) list = o.results;
    else {
      log.warn("Unknown depot payload shape — treating root as single depot", {
        keys: Object.keys(o),
      });
      list = [raw];
    }
  } else {
    log.error("Depot payload is not object or array");
    return [];
  }

  const out: NormalizedDepot[] = [];

  for (let idx = 0; idx < list.length; idx++) {
    const item = list[idx];
    if (!item || typeof item !== "object") {
      log.warn("Skipping non-object depot entry", { idx });
      continue;
    }
    const d = item as Record<string, unknown>;

    const depotKey =
      pickString(d, ["depotId", "id", "depotCode", "code", "uuid"]) ?? `depot-${idx}`;
    const label = pickString(d, ["name", "depotName", "title", "label"]) ?? depotKey;

    const budgetHours = pickNumber(d, [
      "mechanicHourBudget",
      "dailyMechanicHours",
      "mechanicHours",
      "budgetHours",
      "availableHours",
      "hoursAvailable",
      "totalMechanicHours",
    ]);

    const vehiclesRaw = d.vehicles ?? d.tasks ?? d.maintenanceTasks ?? d.requests;
    if (!Array.isArray(vehiclesRaw)) {
      log.warn("Depot has no vehicles/tasks array", { depotKey, keys: Object.keys(d) });
      continue;
    }

    const tasks: MaintenanceTask[] = [];
    for (let j = 0; j < vehiclesRaw.length; j++) {
      const v = vehiclesRaw[j];
      if (!v || typeof v !== "object") continue;
      const vr = v as Record<string, unknown>;

      const id =
        pickString(vr, ["vehicleId", "id", "taskId", "uuid", "registrationNumber"]) ??
        `${depotKey}-task-${j}`;

      const score = pickNumber(vr, [
        "operationalImpactScore",
        "importanceScore",
        "score",
        "priorityScore",
        "impactScore",
      ]);

      const hours = pickNumber(vr, [
        "estimatedServiceDuration",
        "estimatedServiceDurationHours",
        "serviceDurationHours",
        "durationHours",
        "hours",
        "estimatedHours",
        "timeRequiredHours",
      ]);

      if (score === undefined || hours === undefined) {
        log.warn("Skipping task — missing score or duration", { depotKey, id, score, hours });
        continue;
      }

      if (hours <= 0 || score < 0) {
        log.warn("Skipping task — invalid hours or score", { depotKey, id, hours, score });
        continue;
      }

      const weightUnits = Math.max(1, Math.round(hours * MINUTES_PER_HOUR));
      tasks.push({ id, score: Math.round(score), weightUnits });
    }

    const mechanicBudgetMinutes =
      budgetHours !== undefined
        ? Math.max(0, Math.round(budgetHours * MINUTES_PER_HOUR))
        : 0;

    if (mechanicBudgetMinutes <= 0) {
      log.warn("Depot has zero or unknown mechanic budget — skipping", {
        depotKey,
        budgetHours,
      });
      continue;
    }

    log.info("Normalized depot", {
      depotKey,
      label,
      taskCount: tasks.length,
      mechanicBudgetMinutes,
    });

    out.push({
      depotKey,
      label,
      mechanicBudgetMinutes,
      tasks,
    });
  }

  return out;
}
