import type { AppLogger } from "@affordmed/logging-middleware";

export interface MaintenanceTask {
  id: string;
  /** Duration in discrete units (e.g. minutes) used as knapsack weight */
  weightUnits: number;
  /** Operational impact / importance score */
  score: number;
}

export interface KnapsackResult {
  selectedTaskIds: string[];
  totalScore: number;
  totalWeightUnits: number;
}

/**
 * 0/1 knapsack: maximize sum of scores with sum of weights <= capacity.
 * Time O(n * capacity), space O(n * capacity). Suitable when capacity is bounded (e.g. daily mechanic minutes).
 */
export function maximizeOperationalImpact(
  tasks: MaintenanceTask[],
  capacityUnits: number,
  log: AppLogger
): KnapsackResult {
  log.info("Starting knapsack optimization", {
    taskCount: tasks.length,
    capacityUnits,
  });

  if (tasks.length === 0 || capacityUnits <= 0) {
    log.info("Knapsack skipped — empty tasks or zero capacity", {
      taskCount: tasks.length,
      capacityUnits,
    });
    return { selectedTaskIds: [], totalScore: 0, totalWeightUnits: 0 };
  }

  const n = tasks.length;
  const W = capacityUnits;

  const cellCount = (n + 1) * (W + 1);
  log.debug("Knapsack DP grid allocation", { rows: n + 1, cols: W + 1, cellCount });

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(W + 1).fill(0));
  const take: boolean[][] = Array.from({ length: n + 1 }, () => new Array(W + 1).fill(false));

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
  }

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

  const totalScore = dp[n][W];
  const totalWeightUnits = selectedTaskIds.reduce((sum, id) => {
    const t = tasks.find((x) => x.id === id);
    return sum + (t?.weightUnits ?? 0);
  }, 0);

  log.info("Knapsack optimization finished", {
    selectedCount: selectedTaskIds.length,
    totalScore,
    totalWeightUnits,
    remainingCapacityUnits: W - totalWeightUnits,
  });

  return {
    selectedTaskIds,
    totalScore,
    totalWeightUnits,
  };
}
