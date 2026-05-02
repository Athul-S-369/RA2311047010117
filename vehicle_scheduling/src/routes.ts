import type { Express } from "express";
import type { AppLogger, RequestWithLogger } from "@affordmed/logging-middleware";
import { fetchDepotsPayload, fetchVehiclesPayload } from "./evaluationClient";
import { mergeDepotsAndVehicles } from "./depotNormalization";
import { buildOptimalSchedules } from "./scheduleService";

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
   * Optimal subset per depot: total Duration ≤ MechanicHours, total Impact maximized (0/1 knapsack).
   * Data sources: GET /depots and GET /vehicles only (no DB, no hard-coded payloads).
   */
  app.get("/api/v1/schedule/optimal", async (req, res) => {
    const log = (req as RequestWithLogger).log;

    try {
      const auth = requireAuthHeader(log);
      log.info("Loading evaluation depots and vehicles in parallel");

      const [rawDepots, rawVehicles] = await Promise.all([
        fetchDepotsPayload(log, { authorizationHeader: auth }),
        fetchVehiclesPayload(log, { authorizationHeader: auth }),
      ]);

      log.info("Evaluation payloads received", {
        hasDepots: rawDepots != null,
        hasVehicles: rawVehicles != null,
      });

      const depots = mergeDepotsAndVehicles(rawDepots, rawVehicles, log);

      if (depots.length === 0) {
        log.warn("No depots after merge");
        return res.status(502).json({
          error: "No depots could be built from evaluation API responses",
          hint: "Check JSON shapes and EVALUATION_AUTH_HEADER",
        });
      }

      const depotFilter = typeof req.query.depotId === "string" ? req.query.depotId : undefined;
      const filtered = depotFilter ? depots.filter((d) => d.depotKey === depotFilter) : depots;

      if (depotFilter && filtered.length === 0) {
        log.warn("depotId filter matched nothing", { depotFilter });
        return res.status(404).json({ error: "Depot not found", depotId: depotFilter });
      }

      const depotsOut = buildOptimalSchedules(filtered, log);

      log.info("HTTP 200 schedule response ready", {
        depotResults: depotsOut.length,
        totalSelectedTasks: depotsOut.reduce((s, d) => s + d.selectedTaskIds.length, 0),
      });

      res.status(200).json({ depots: depotsOut });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log.error("Schedule endpoint failed", { message });
      res.status(500).json({ error: message });
    }
  });
}
