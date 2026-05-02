import type { AppLogger } from "@affordmed/logging-middleware";

const DEFAULT_BASE = "http://20.207.122.201/evaluation-service";

function resolveUrl(envUrl: string | undefined, defaultPath: string): string {
  if (envUrl && envUrl.length > 0) return envUrl;
  return `${DEFAULT_BASE}${defaultPath}`;
}

export interface FetchProtectedOptions {
  authorizationHeader: string;
}

async function fetchProtectedJson(
  log: AppLogger,
  label: string,
  url: string,
  authorizationHeader: string
): Promise<unknown> {
  log.info(`Fetching ${label}`, {
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
    Authorization: authorizationHeader,
  };

  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(url, { method: "GET", headers });
  } catch (err) {
    log.error(`${label} HTTP request failed`, {
      message: err instanceof Error ? err.message : String(err),
      elapsedMs: Date.now() - started,
    });
    throw err;
  }

  const elapsedMs = Date.now() - started;
  const text = await res.text();

  log.info(`${label} HTTP response received`, {
    statusCode: res.status,
    elapsedMs,
    bodyLength: text.length,
  });

  if (!res.ok) {
    log.error(`${label} request returned error status`, {
      statusCode: res.status,
      bodyPreview: text.slice(0, 500),
    });
    throw new Error(`${label} API error: HTTP ${res.status}`);
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    log.error(`${label} response is not valid JSON`, { bodyPreview: text.slice(0, 300) });
    throw new Error(`${label} API returned non-JSON body`);
  }
}

/** GET /depots — protected */
export async function fetchDepotsPayload(
  log: AppLogger,
  options: FetchProtectedOptions & { url?: string }
): Promise<unknown> {
  const url = resolveUrl(options.url ?? process.env.DEPOTS_URL, "/depots");
  return fetchProtectedJson(log, "depots", url, options.authorizationHeader);
}

/** GET /vehicles — protected */
export async function fetchVehiclesPayload(
  log: AppLogger,
  options: FetchProtectedOptions & { url?: string }
): Promise<unknown> {
  const url = resolveUrl(options.url ?? process.env.VEHICLES_URL, "/vehicles");
  return fetchProtectedJson(log, "vehicles", url, options.authorizationHeader);
}

/** GET /notifications — protected (campus notifications evaluation API) */
export async function fetchNotificationsPayload(
  log: AppLogger,
  options: FetchProtectedOptions & { url?: string }
): Promise<unknown> {
  const url = resolveUrl(options.url ?? process.env.NOTIFICATIONS_URL, "/notifications");
  return fetchProtectedJson(log, "notifications", url, options.authorizationHeader);
}
