import type { Express } from "express";
import type { AppLogger, RequestWithLogger } from "@affordmed/logging-middleware";
import { fetchDepotsPayload } from "./depotsClient";
import { normalizeDepotPayload } from "./depotNormalization";
import { maximizeOperationalImpact } from "./knapsack";

function requireAuthHeader(log: AppLogger): string {
  const auth =
    process.env.EVALUATION_AUTH_HEADER ??
    process.env.AUTHORIZATION ??
    process.env.EVALUATION_SERVICE_AUTH;

  if (!auth || auth.trim().length === 0) {
    log.error("Missing evaluation API authorization — set EVALUATION_AUTH_HEADER in environment");
    throw new Error("EVALUATION_AUTH_HEADER is not configured");
  }
  return auth.trim();
}

export function registerRoutes(app: Express, rootLogger: AppLogger): void {
  app.get("/health", (_req, res) => {
    rootLogger.info("Health check invoked");
    res.json({ status: "ok", service: "vehicle-maintence-scheduler" });
  });

  /**
   * Computes optimal maintenance selection per depot using data from the evaluation depots API.
   */
  app.get("/api/v1/schedule/optimal", async (req, res) => {
    const log = (req as RequestWithLogger).log;

    try {
      const auth = requireAuthHeader(log);
      const raw = await fetchDepotsPayload(log, { authorizationHeader: auth });
      const depots = normalizeDepotPayload(raw, log);

      if (depots.length === 0) {
        log.warn("No depots available after normalization");
        return res.status(502).json({
          error: "No depots could be normalized from API response",
          hint: "Check API payload shape and EVALUATION_AUTH_HEADER",
        });
      }

      const depotFilter = typeof req.query.depotId === "string" ? req.query.depotId : undefined;
      const filtered = depotFilter
        ? depots.filter((d) => d.depotKey === depotFilter)
        : depots;

      if (depotFilter && filtered.length === 0) {
        log.warn("depotId query did not match any depot", { depotFilter });
        return res.status(404).json({ error: "Depot not found", depotId: depotFilter });
      }

      type VehicleRow = { TaskID: string; Duration: number; Impact: number };
      const vehicles: VehicleRow[] = [];

      for (const depot of filtered) {
        const solution = maximizeOperationalImpact(
          depot.tasks,
          depot.mechanicBudgetMinutes,
          log.child({ depotKey: depot.depotKey })
        );

        for (const taskId of solution.selectedTaskIds) {
          const t = depot.tasks.find((x) => x.id === taskId);
          if (!t) continue;
          vehicles.push({
            TaskID: t.id,
            Duration: t.durationHours,
            Impact: t.score,
          });
        }
      }

      log.info("Schedule computation completed — response vehicles built", {
        depotCount: filtered.length,
        selectedVehicleCount: vehicles.length,
      });

      res.status(200).json({ vehicles });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log.error("Failed to compute optimal schedule", { message });
      res.status(500).json({ error: message });
    }
  });
}
