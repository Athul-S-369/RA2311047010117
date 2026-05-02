import type { DepotScheduleOutput } from "./scheduleService";

export type EvaluationDepotScheduleJson = {
  ID: string | number;
  selectedTaskIds: string[];
  totalDuration: number;
  totalImpact: number;
};

function normalizeDurationForEvaluation(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const rounded = Math.round(n);
  if (Math.abs(n - rounded) < 1e-6) return rounded;
  return Math.round(n * 1_000_000) / 1_000_000;
}

export function toEvaluationDepotScheduleJson(d: DepotScheduleOutput): EvaluationDepotScheduleJson {
  return {
    ID: d.ID,
    selectedTaskIds: [...d.selectedTaskIds],
    totalDuration: normalizeDurationForEvaluation(d.totalDuration),
    totalImpact: Math.round(Number.isFinite(d.totalImpact) ? d.totalImpact : 0),
  };
}

export function stringifyScheduleEvaluationResponse(
  depots: EvaluationDepotScheduleJson[]
): string {
  const body = {
    depots: depots.map((d) => ({
      ID: d.ID,
      selectedTaskIds: d.selectedTaskIds,
      totalDuration: d.totalDuration,
      totalImpact: d.totalImpact,
    })),
  };
  return JSON.stringify(body);
}
