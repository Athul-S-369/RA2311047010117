import type { Express } from "express";
import type { AppLogger, RequestWithLogger } from "@affordmed/logging-middleware";
import { fetchDepotsPayload, fetchVehiclesPayload } from "./evaluationClient";
import { mergeDepotsAndVehicles } from "./depotNormalization";
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
    res.json({ status: "ok", service: "vehicle-scheduling" });
  });

  /**
   * Computes optimal maintenance selection using GET /depots and GET /vehicles (protected; no DB, no hard-coded tasks).
   */
  app.get("/api/v1/schedule/optimal", async (req, res) => {
    const log = (req as RequestWithLogger).log;

    try {
      const auth = requireAuthHeader(log);
      const [rawDepots, rawVehicles] = await Promise.all([
        fetchDepotsPayload(log, { authorizationHeader: auth }),
        fetchVehiclesPayload(log, { authorizationHeader: auth }),
      ]);

      log.info("Evaluation APIs loaded in parallel", {
        hasDepotsPayload: rawDepots !== null && rawDepots !== undefined,
        hasVehiclesPayload: rawVehicles !== null && rawVehicles !== undefined,
      });

      const depots = mergeDepotsAndVehicles(rawDepots, rawVehicles, log);

      if (depots.length === 0) {
        log.warn("No depots available after merging depots + vehicles APIs");
        return res.status(502).json({
          error: "No depots could be built from evaluation API responses",
          hint: "Check depots/vehicles JSON shape and EVALUATION_AUTH_HEADER",
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
          depot.knapsackCapacity,
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
