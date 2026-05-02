import type { AppLogger } from "@affordmed/logging-middleware";
import { fetchJsonGetWithRetry } from "./evaluationHttp";

const DEFAULT_URL = "http://20.207.122.201/evaluation-service/notifications";

export async function fetchNotificationsPayload(
  log: AppLogger,
  authorizationHeader: string
): Promise<unknown> {
  const url = process.env.NOTIFICATIONS_URL?.trim() || DEFAULT_URL;

  log.info("Resolving notifications evaluation URL", {
    urlHost: (() => {
      try {
        return new URL(url).host;
      } catch {
        return "invalid-url";
      }
    })(),
  });

  return fetchJsonGetWithRetry(log, "notifications", url, authorizationHeader);
}
