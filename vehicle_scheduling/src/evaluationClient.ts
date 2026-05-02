import type { AppLogger } from "@affordmed/logging-middleware";

const DEFAULT_BASE = "http://20.207.122.201/evaluation-service";

const DEFAULT_RETRIES = 4;
const BASE_DELAY_MS = 400;

function resolveUrl(envUrl: string | undefined, defaultPath: string): string {
  if (envUrl && envUrl.length > 0) return envUrl;
  return `${DEFAULT_BASE}${defaultPath}`;
}

export interface FetchProtectedOptions {
  authorizationHeader: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Single GET with structured logging. Throws on non-retryable failure after body read.
 */
async function fetchOnce(
  log: AppLogger,
  label: string,
  url: string,
  authorizationHeader: string
): Promise<{ ok: boolean; status: number; text: string; elapsedMs: number }> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: authorizationHeader,
  };

  const started = Date.now();
  const timeoutMs = Number(process.env.EVALUATION_FETCH_TIMEOUT_MS ?? "60000");
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const elapsedMs = Date.now() - started;
    log.error(`${label} transport error`, {
      message: err instanceof Error ? err.message : String(err),
      elapsedMs,
    });
    throw err;
  }

  const text = await res.text();
  return {
    ok: res.ok,
    status: res.status,
    text,
    elapsedMs: Date.now() - started,
  };
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

/**
 * Protected GET with exponential backoff + jitter on transient errors (network / 429 / 5xx).
 */
async function fetchProtectedJsonWithRetry(
  log: AppLogger,
  label: string,
  url: string,
  authorizationHeader: string
): Promise<unknown> {
  const maxAttempts = Number(process.env.EVALUATION_FETCH_RETRIES ?? DEFAULT_RETRIES);
  const host = (() => {
    try {
      return new URL(url).host;
    } catch {
      return "invalid-url";
    }
  })();

  log.info(`Fetching ${label} (with retry policy)`, { urlHost: host, maxAttempts });

  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    log.info(`${label} attempt`, { attempt, maxAttempts, urlHost: host });
    try {
      const { ok, status, text, elapsedMs } = await fetchOnce(log, label, url, authorizationHeader);

      log.info(`${label} HTTP response`, {
        statusCode: status,
        elapsedMs,
        bodyLength: text.length,
        attempt,
      });

      if (ok) {
        try {
          return JSON.parse(text) as unknown;
        } catch {
          log.error(`${label} invalid JSON body`, { bodyPreview: text.slice(0, 300), attempt });
          throw new Error(`${label} API returned non-JSON body`);
        }
      }

      log.warn(`${label} non-success status`, {
        statusCode: status,
        bodyPreview: text.slice(0, 400),
        attempt,
      });

      if (attempt < maxAttempts && isRetryableStatus(status)) {
        const delay =
          BASE_DELAY_MS * 2 ** (attempt - 1) + Math.floor(Math.random() * 200);
        log.info(`${label} backing off before retry`, { delayMs: delay, nextAttempt: attempt + 1 });
        await sleep(delay);
        continue;
      }

      throw new Error(`${label} API error: HTTP ${status}`);
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      const nm = lastError.message.toLowerCase();
      const retryable =
        attempt < maxAttempts &&
        (nm.includes("fetch") ||
          nm.includes("network") ||
          nm.includes("econnreset") ||
          nm.includes("etimedout") ||
          nm.includes("abort") ||
          nm.includes("timeout"));

      if (retryable) {
        const delay = BASE_DELAY_MS * 2 ** (attempt - 1) + Math.floor(Math.random() * 200);
        log.warn(`${label} request failed; will retry`, {
          message: lastError.message,
          delayMs: delay,
          attempt,
        });
        await sleep(delay);
        continue;
      }
      throw lastError;
    }
  }

  throw lastError ?? new Error(`${label}: exhausted retries`);
}

/** GET /depots — protected */
export async function fetchDepotsPayload(
  log: AppLogger,
  options: FetchProtectedOptions & { url?: string }
): Promise<unknown> {
  const url = resolveUrl(options.url ?? process.env.DEPOTS_URL, "/depots");
  return fetchProtectedJsonWithRetry(log, "depots", url, options.authorizationHeader);
}

/** GET /vehicles — protected */
export async function fetchVehiclesPayload(
  log: AppLogger,
  options: FetchProtectedOptions & { url?: string }
): Promise<unknown> {
  const url = resolveUrl(options.url ?? process.env.VEHICLES_URL, "/vehicles");
  return fetchProtectedJsonWithRetry(log, "vehicles", url, options.authorizationHeader);
}

/** GET /notifications — protected */
export async function fetchNotificationsPayload(
  log: AppLogger,
  options: FetchProtectedOptions & { url?: string }
): Promise<unknown> {
  const url = resolveUrl(options.url ?? process.env.NOTIFICATIONS_URL, "/notifications");
  return fetchProtectedJsonWithRetry(log, "notifications", url, options.authorizationHeader);
}
