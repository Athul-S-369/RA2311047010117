import type { AppLogger } from "@affordmed/logging-middleware";

const DEFAULT_URL = "http://20.207.122.201/evaluation-service/notifications";

export async function fetchNotificationsPayload(
  log: AppLogger,
  authorizationHeader: string
): Promise<unknown> {
  const url = process.env.NOTIFICATIONS_URL?.trim() || DEFAULT_URL;

  log.info("Fetching notifications from evaluation service", {
    urlHost: (() => {
      try {
        return new URL(url).host;
      } catch {
        return "invalid-url";
      }
    })(),
  });

  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json", Authorization: authorizationHeader },
    });
  } catch (err) {
    log.error("Notifications HTTP request failed", {
      message: err instanceof Error ? err.message : String(err),
      elapsedMs: Date.now() - started,
    });
    throw err;
  }

  const text = await res.text();
  log.info("Notifications HTTP response received", {
    statusCode: res.status,
    elapsedMs: Date.now() - started,
    bodyLength: text.length,
  });

  if (!res.ok) {
    log.error("Notifications request error", {
      statusCode: res.status,
      bodyPreview: text.slice(0, 400),
    });
    throw new Error(`Notifications API error: HTTP ${res.status}`);
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    log.error("Notifications body is not JSON", { bodyPreview: text.slice(0, 200) });
    throw new Error("Notifications API returned non-JSON");
  }
}
