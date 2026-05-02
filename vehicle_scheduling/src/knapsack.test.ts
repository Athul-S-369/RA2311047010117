import { describe, it, expect } from "vitest";
import type { AppLogger } from "@affordmed/logging-middleware";
import { maximizeOperationalImpact, type MaintenanceTask } from "./knapsack";

const noop = (): void => undefined;
const mockLog = {
  info: noop,
  warn: noop,
  debug: noop,
  error: noop,
  child: () => mockLog,
} as unknown as AppLogger;

function bruteBest(
  tasks: MaintenanceTask[],
  capacity: number
): { impact: number; weight: number; duration: number } {
  const n = tasks.length;
  let bestImpact = -1;
  let bestWeight = 0;
  let bestDuration = 0;
  for (let mask = 0; mask < 1 << n; mask++) {
    let w = 0;
    let v = 0;
    let d = 0;
    for (let i = 0; i < n; i++) {
      if ((mask >> i) & 1) {
        w += tasks[i].weightUnits;
        v += tasks[i].score;
        d += tasks[i].durationHours;
      }
    }
    if (w <= capacity && v > bestImpact) {
      bestImpact = v;
      bestWeight = w;
      bestDuration = d;
    }
  }
  if (bestImpact < 0) return { impact: 0, weight: 0, duration: 0 };
  return { impact: bestImpact, weight: bestWeight, duration: bestDuration };
}

describe("maximizeOperationalImpact", () => {
  it("matches brute force on small random instances", () => {
    for (let seed = 0; seed < 30; seed++) {
      let x = seed * 9973 + 42;
      const rnd = () => {
        x = (x * 1103515245 + 12345) & 0x7fffffff;
        return x / 0x7fffffff;
      };
      const n = 3 + Math.floor(rnd() * 6);
      const W = 5 + Math.floor(rnd() * 15);
      const tasks: MaintenanceTask[] = [];
      for (let i = 0; i < n; i++) {
        const wt = 1 + Math.floor(rnd() * 5);
        const sc = Math.floor(rnd() * 20);
        tasks.push({
          id: `t-${seed}-${i}`,
          durationHours: wt,
          weightUnits: wt,
          score: sc,
        });
      }
      const dp = maximizeOperationalImpact(tasks, W, mockLog);
      const br = bruteBest(tasks, W);
      expect(dp.totalImpact).toBe(br.impact);
      expect(dp.totalWeightUnits).toBe(br.weight);
      expect(dp.totalDurationHours).toBe(br.duration);
    }
  });

  it("returns empty selection for zero capacity", () => {
    const tasks: MaintenanceTask[] = [
      { id: "a", durationHours: 2, weightUnits: 2, score: 5 },
    ];
    const r = maximizeOperationalImpact(tasks, 0, mockLog);
    expect(r.selectedTaskIds).toEqual([]);
    expect(r.totalImpact).toBe(0);
    expect(r.totalWeightUnits).toBe(0);
    expect(r.totalDurationHours).toBe(0);
  });

  it("returns empty when every task exceeds capacity", () => {
    const tasks: MaintenanceTask[] = [
      { id: "a", durationHours: 10, weightUnits: 10, score: 100 },
      { id: "b", durationHours: 8, weightUnits: 8, score: 50 },
    ];
    const r = maximizeOperationalImpact(tasks, 3, mockLog);
    expect(r.selectedTaskIds).toEqual([]);
    expect(r.totalImpact).toBe(0);
  });

  it("sums duration/weight from selected rows when TaskID duplicates differ", () => {
    const tasks: MaintenanceTask[] = [
      { id: "dup", durationHours: 1, weightUnits: 1, score: 5 },
      { id: "dup", durationHours: 5, weightUnits: 5, score: 100 },
    ];
    const r = maximizeOperationalImpact(tasks, 5, mockLog);
    expect(r.totalImpact).toBe(100);
    expect(r.totalDurationHours).toBe(5);
    expect(r.totalWeightUnits).toBe(5);
    expect(r.selectedTaskIds).toEqual(["dup"]);
  });
});
