import type { Express } from "express";
import type { AppLogger, RequestWithLogger } from "@affordmed/logging-middleware";
import { fetchNotificationsPayload } from "./notificationsClient";
import {
  stringifyNotificationsEvaluationResponse,
  toEvaluationNotificationJson,
} from "./evaluationResponse";
import {
  normalizeNotificationsPayload,
  selectTopPriorityNotifications,
  explainTopKStrategy,
} from "./priorityInbox";

function requireAuth(log: AppLogger): string {
  const auth =
    process.env.EVALUATION_AUTH_HEADER ??
    process.env.AUTHORIZATION ??
    process.env.EVALUATION_SERVICE_AUTH;
  if (!auth?.trim()) {
    log.error("Missing EVALUATION_AUTH_HEADER for protected notifications API");
    throw new Error("EVALUATION_AUTH_HEADER is not configured");
  }
  return auth.trim();
}

export function registerNotificationRoutes(app: Express, rootLogger: AppLogger): void {
  app.get("/health", (_req, res) => {
    rootLogger.info("Notification service health check");
    res.json({ status: "ok", service: "notification-app-be" });
  });

  app.get("/api/v1/notifications/priority-top", async (req, res) => {
    const log = (req as RequestWithLogger).log;

    try {
      const auth = requireAuth(log);
      const raw = await fetchNotificationsPayload(log, auth);
      const all = normalizeNotificationsPayload(raw, log);

      const limitRaw = req.query.limit ?? req.query.n;
      const limit = Math.min(100, Math.max(1, Number(limitRaw ?? 10) || 10));

      explainTopKStrategy(log);
      const top = selectTopPriorityNotifications(all, limit, true, log);

      log.info("priority-top response ready", { count: top.length, limit, unreadOnly: true });

      const notifications = top.map((n) =>
        toEvaluationNotificationJson({
          ID: n.ID,
          Type: n.Type,
          Message: n.Message,
          Timestamp: n.Timestamp,
        })
      );

      res
        .status(200)
        .type("application/json")
        .send(stringifyNotificationsEvaluationResponse(notifications));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log.error("priority-top failed", { message });
      res.status(500).json({ error: message });
    }
  });
}
