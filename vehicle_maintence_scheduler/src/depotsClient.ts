import type { AppLogger } from "@affordmed/logging-middleware";

const DEFAULT_DEPOTS_URL = "http://20.207.122.201/evaluation-service/depots";

export interface FetchDepotsOptions {
  url?: string;
  authorizationHeader: string;
}

/**
 * GET depots from the evaluation service (protected route — Authorization header required).
 */
export async function fetchDepotsPayload(
  log: AppLogger,
  options: FetchDepotsOptions
): Promise<unknown> {
  const url = options.url ?? process.env.DEPOTS_URL ?? DEFAULT_DEPOTS_URL;

  log.info("Fetching depots from evaluation service", {
    urlHost: (() => {
      try {
        return new URL(url).host;
      } catch {
        return "invalid-url";
      }
    })(),
  });

  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: options.authorizationHeader,
  };

  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(url, { method: "GET", headers });
  } catch (err) {
    log.error("Depots HTTP request failed", {
      message: err instanceof Error ? err.message : String(err),
      elapsedMs: Date.now() - started,
    });
    throw err;
  }

  const elapsedMs = Date.now() - started;
  const text = await res.text();

  log.info("Depots HTTP response received", {
    statusCode: res.status,
    elapsedMs,
    bodyLength: text.length,
  });

  if (!res.ok) {
    log.error("Depots request returned error status", {
      statusCode: res.status,
      bodyPreview: text.slice(0, 500),
    });
    throw new Error(`Depots API error: HTTP ${res.status}`);
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    log.error("Depots response is not valid JSON", { bodyPreview: text.slice(0, 300) });
    throw new Error("Depots API returned non-JSON body");
  }
}
