import type { AppLogger } from "@affordmed/logging-middleware";
import type { MaintenanceTask } from "./knapsack";

/** Smallest time unit: minutes for integer knapsack (MechanicHours & Duration treated as hours × 60) */
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

/** Depot id from vehicle row (links vehicle to depot). */
function pickVehicleDepotRef(vr: Record<string, unknown>): string | undefined {
  const n = pickNumber(vr, [
    "DepotID",
    "DepotId",
    "depotId",
    "depot_id",
    "Depot",
    "depot",
    "depotID",
  ]);
  if (n !== undefined) return String(n);
  const s = pickString(vr, ["DepotID", "DepotId", "depotId", "depot_id", "Depot", "depot"]);
  return s;
}

function parseVehicleRow(
  vr: Record<string, unknown>,
  index: number,
  log: AppLogger
): { depotRef: string | undefined; task: MaintenanceTask } | null {
  const id =
    pickString(vr, [
      "TaskID",
      "taskId",
      "vehicleId",
      "id",
      "uuid",
      "registrationNumber",
    ]) ?? `vehicle-${index}`;

  const score = pickNumber(vr, [
    "Impact",
    "impact",
    "operationalImpactScore",
    "importanceScore",
    "score",
    "priorityScore",
    "impactScore",
  ]);

  const hours = pickNumber(vr, [
    "Duration",
    "duration",
    "estimatedServiceDuration",
    "estimatedServiceDurationHours",
    "serviceDurationHours",
    "durationHours",
    "hours",
    "estimatedHours",
    "timeRequiredHours",
  ]);

  if (score === undefined || hours === undefined) {
    log.warn("Skipping vehicle row — missing Impact or Duration", { id, score, hours });
    return null;
  }

  if (hours <= 0 || score < 0) {
    log.warn("Skipping vehicle row — invalid duration or impact", { id, hours, score });
    return null;
  }

  const weightUnits = Math.max(1, Math.round(hours * MINUTES_PER_HOUR));
  const depotRef = pickVehicleDepotRef(vr);

  return {
    depotRef,
    task: {
      id,
      durationHours: hours,
      score: Math.round(score),
      weightUnits,
    },
  };
}

function extractDepotsArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (Array.isArray(o.depots)) return o.depots;
    if (Array.isArray(o.Depots)) return o.Depots;
    if (Array.isArray(o.data)) return o.data;
    if (Array.isArray(o.results)) return o.results;
  }
  return [];
}

function extractVehiclesArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (Array.isArray(o.vehicles)) return o.vehicles;
    if (Array.isArray(o.Vehicles)) return o.Vehicles;
    if (Array.isArray(o.data)) return o.data;
  }
  return [];
}

export interface DepotBudgetRow {
  depotKey: string;
  label: string;
  mechanicBudgetMinutes: number;
}

/** Parse GET /depots payload: { depots: [{ ID, MechanicHours }, ...] } */
export function normalizeDepotBudgets(raw: unknown, log: AppLogger): DepotBudgetRow[] {
  const list = extractDepotsArray(raw);
  log.info("Normalizing depot budgets", { depotRowCount: list.length });

  const out: DepotBudgetRow[] = [];

  for (let idx = 0; idx < list.length; idx++) {
    const item = list[idx];
    if (!item || typeof item !== "object") continue;
    const d = item as Record<string, unknown>;

    const idNum = pickNumber(d, ["ID", "id", "depotId", "DepotID", "DepotId"]);
    const idStr = pickString(d, ["ID", "id", "depotId", "DepotID", "depotCode", "code", "uuid"]);
    const depotKey = idStr ?? (idNum !== undefined ? String(idNum) : `depot-${idx}`);

    const label =
      pickString(d, ["name", "depotName", "title", "label", "Name"]) ?? `Depot ${depotKey}`;

    const mechanicHours = pickNumber(d, [
      "MechanicHours",
      "mechanicHours",
      "mechanicHourBudget",
      "dailyMechanicHours",
      "budgetHours",
      "availableHours",
      "hoursAvailable",
      "totalMechanicHours",
    ]);

    if (mechanicHours === undefined || mechanicHours <= 0) {
      log.warn("Skipping depot — missing or zero MechanicHours", { depotKey, keys: Object.keys(d) });
      continue;
    }

    const mechanicBudgetMinutes = Math.max(0, Math.round(mechanicHours * MINUTES_PER_HOUR));

    log.info("Normalized depot budget", {
      depotKey,
      label,
      mechanicHours,
      mechanicBudgetMinutes,
    });

    out.push({ depotKey, label, mechanicBudgetMinutes });
  }

  return out;
}

/** Parse GET /vehicles payload rows into tasks + optional depot link. */
export function normalizeVehicleTasks(raw: unknown, log: AppLogger): { depotRef?: string; task: MaintenanceTask }[] {
  const list = extractVehiclesArray(raw);
  log.info("Normalizing vehicle tasks", { vehicleRowCount: list.length });

  const out: { depotRef?: string; task: MaintenanceTask }[] = [];
  for (let j = 0; j < list.length; j++) {
    const v = list[j];
    if (!v || typeof v !== "object") continue;
    const parsed = parseVehicleRow(v as Record<string, unknown>, j, log);
    if (!parsed) continue;
    out.push({ depotRef: parsed.depotRef, task: parsed.task });
  }

  return out;
}

function depotKeyMatches(ref: string | undefined, depotKey: string): boolean {
  if (ref === undefined || ref === "") return false;
  if (ref === depotKey) return true;
  const nRef = Number(ref);
  const nKey = Number(depotKey);
  if (!Number.isNaN(nRef) && !Number.isNaN(nKey) && nRef === nKey) return true;
  return String(nRef) === depotKey || ref === String(nKey);
}

/**
 * Join depot budgets (depots API) with vehicle tasks (vehicles API). No DB, no hard-coded tasks.
 */
export function mergeDepotsAndVehicles(
  depotsRaw: unknown,
  vehiclesRaw: unknown,
  log: AppLogger
): NormalizedDepot[] {
  const budgets = normalizeDepotBudgets(depotsRaw, log);
  const vehicleRows = normalizeVehicleTasks(vehiclesRaw, log);

  if (budgets.length === 0) {
    log.error("No depots after parsing depots API");
    return [];
  }

  const linked = vehicleRows.filter((r) => r.depotRef !== undefined && r.depotRef !== "");
  const unlinked = vehicleRows.filter((r) => r.depotRef === undefined || r.depotRef === "");
  const useDepotFilter = linked.length > 0;

  if (useDepotFilter && unlinked.length > 0) {
    log.warn(
      "Some vehicles omit DepotID; they are ignored unless a single depot receives them as fallback",
      { unlinkedCount: unlinked.length }
    );
  }

  const out: NormalizedDepot[] = [];

  for (const b of budgets) {
    let tasks: MaintenanceTask[];

    if (useDepotFilter) {
      tasks = linked.filter((r) => depotKeyMatches(r.depotRef, b.depotKey)).map((r) => r.task);
      if (tasks.length === 0 && budgets.length === 1 && unlinked.length > 0) {
        tasks = unlinked.map((r) => r.task);
        log.info("Sole depot: assigned vehicles without DepotID to that depot", { count: tasks.length });
      }
    } else if (budgets.length === 1) {
      tasks = vehicleRows.map((r) => r.task);
      log.info("Single depot: assigned all vehicles from vehicles API", { count: tasks.length });
    } else {
      tasks = vehicleRows.map((r) => r.task);
      log.warn(
        "Multiple depots but no DepotID on vehicles — each depot runs knapsack on the full vehicle list",
        { depotCount: budgets.length, vehicleCount: tasks.length }
      );
    }

    log.info("Merged depot with vehicles from evaluation APIs", {
      depotKey: b.depotKey,
      taskCount: tasks.length,
    });

    out.push({
      depotKey: b.depotKey,
      label: b.label,
      mechanicBudgetMinutes: b.mechanicBudgetMinutes,
      tasks,
    });
  }

  return out;
}
