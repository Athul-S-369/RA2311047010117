import type { AppLogger } from "@affordmed/logging-middleware";

/** One maintenance task: knapsack weight in capacity units; score = operational impact (Impact). */
export interface MaintenanceTask {
  id: string;
  durationHours: number;
  weightUnits: number;
  score: number;
}

export interface KnapsackResult {
  selectedTaskIds: string[];
  /** Sum of Impact scores for selected tasks */
  totalImpact: number;
  /** Sum of weight units (same basis as DP capacity) */
  totalWeightUnits: number;
  /** Sum of Duration (hours) for selected tasks — reportable total duration */
  totalDurationHours: number;
}

/**
 * Classic 0/1 knapsack dynamic programming: maximize sum of values with total weight ≤ capacity.
 * Time Θ(n × W), space Θ(n × W) for this implementation (supports reconstruction).
 * When W is modest (e.g. mechanic-hours as integers), this scales to large n in practice.
 */
export function maximizeOperationalImpact(
  tasks: MaintenanceTask[],
  capacityUnits: number,
  log: AppLogger
): KnapsackResult {
  log.info("Knapsack DP starting", {
    taskCount: tasks.length,
    capacityUnits,
    algorithm: "0/1-knapsack-dp",
  });

  if (tasks.length === 0 || capacityUnits <= 0) {
    log.info("Knapsack skipped — empty tasks or zero capacity", {
      taskCount: tasks.length,
      capacityUnits,
    });
    return {
      selectedTaskIds: [],
      totalImpact: 0,
      totalWeightUnits: 0,
      totalDurationHours: 0,
    };
  }

  const n = tasks.length;
  const W = capacityUnits;

  const cellEstimate = (n + 1) * (W + 1);
  if (cellEstimate > 80_000_000) {
    log.warn("Knapsack DP grid is very large", { cellEstimate, taskCount: n, capacityUnits: W });
  }

  log.info("Knapsack DP table dimensions", { rows: n + 1, cols: W + 1, cellEstimate });

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(W + 1).fill(0));
  const take: boolean[][] = Array.from({ length: n + 1 }, () => new Array(W + 1).fill(false));

  const logEveryRows = Math.max(1, Math.floor(n / 10));

  for (let i = 1; i <= n; i++) {
    const t = tasks[i - 1];
    const wt = t.weightUnits;
    const val = t.score;
    for (let w = 0; w <= W; w++) {
      const skip = dp[i - 1][w];
      if (wt <= w) {
        const incl = dp[i - 1][w - wt] + val;
        if (incl > skip) {
          dp[i][w] = incl;
          take[i][w] = true;
        } else {
          dp[i][w] = skip;
        }
      } else {
        dp[i][w] = skip;
      }
    }
    if (i % logEveryRows === 0 || i === n) {
      log.info("Knapsack DP row completed", {
        itemIndex: i,
        totalItems: n,
        bestValueAtFullCapacity: dp[i][W],
      });
    }
  }

  log.info("Knapsack DP fill complete; beginning backtrack for selected task IDs", {
    optimalImpact: dp[n][W],
  });

  const selectedTaskIds: string[] = [];
  let w = W;
  for (let i = n; i >= 1; i--) {
    if (take[i][w]) {
      const t = tasks[i - 1];
      selectedTaskIds.push(t.id);
      w -= t.weightUnits;
    }
  }
  selectedTaskIds.reverse();

  let totalDurationHours = 0;
  for (const id of selectedTaskIds) {
    const t = tasks.find((x) => x.id === id);
    if (t) totalDurationHours += t.durationHours;
  }

  const totalImpact = dp[n][W];
  const totalWeightUnits = selectedTaskIds.reduce((sum, id) => {
    const t = tasks.find((x) => x.id === id);
    return sum + (t?.weightUnits ?? 0);
  }, 0);

  log.info("Knapsack final selection", {
    selectedCount: selectedTaskIds.length,
    totalImpact,
    totalWeightUnits,
    totalDurationHours,
    remainingCapacityUnits: W - totalWeightUnits,
    selectedTaskIdsPreview: selectedTaskIds.slice(0, 50),
    selectedTaskIdsTruncated: selectedTaskIds.length > 50,
  });

  return {
    selectedTaskIds,
    totalImpact,
    totalWeightUnits,
    totalDurationHours,
  };
}
