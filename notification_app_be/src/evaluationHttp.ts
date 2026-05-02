import type { AppLogger } from "@affordmed/logging-middleware";

const DEFAULT_RETRIES = 4;
const BASE_DELAY_MS = 400;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

export async function fetchJsonGetWithRetry(
  log: AppLogger,
  label: string,
  url: string,
  authorizationHeader: string
): Promise<unknown> {
  const maxAttempts = Number(process.env.EVALUATION_FETCH_RETRIES ?? DEFAULT_RETRIES);
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    log.info(`${label} fetch attempt`, { attempt, maxAttempts });
    try {
      const auth = authorizationHeader.trim();
      if (!auth) {
        throw new Error("Authorization header value is empty");
      }
      const headers = new Headers();
      headers.set("Accept", "application/json");
      headers.set("Authorization", auth);

      const started = Date.now();
      const timeoutMs = Number(process.env.EVALUATION_FETCH_TIMEOUT_MS ?? "60000");
      const res = await fetch(url, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text();
      const elapsedMs = Date.now() - started;

      log.info(`${label} HTTP response`, {
        statusCode: res.status,
        elapsedMs,
        bodyLength: text.length,
        attempt,
      });

      if (res.ok) {
        try {
          return JSON.parse(text) as unknown;
        } catch {
          log.error(`${label} invalid JSON`, { bodyPreview: text.slice(0, 200), attempt });
          throw new Error(`${label} returned non-JSON`);
        }
      }

      log.warn(`${label} non-success`, { statusCode: res.status, attempt });

      if (attempt < maxAttempts && isRetryableStatus(res.status)) {
        const delay = BASE_DELAY_MS * 2 ** (attempt - 1) + Math.floor(Math.random() * 200);
        log.info(`${label} backoff`, { delayMs: delay });
        await sleep(delay);
        continue;
      }

      throw new Error(`${label} API error: HTTP ${res.status}`);
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      const nm = lastError.message.toLowerCase();
      const retryable =
        attempt < maxAttempts &&
        (nm.includes("econnreset") ||
          nm.includes("etimedout") ||
          nm.includes("fetch") ||
          nm.includes("abort") ||
          nm.includes("timeout"));

      if (retryable) {
        const delay = BASE_DELAY_MS * 2 ** (attempt - 1) + Math.floor(Math.random() * 200);
        log.warn(`${label} transport failure; retry`, { message: lastError.message, delayMs: delay });
        await sleep(delay);
        continue;
      }
      throw lastError;
    }
  }

  throw lastError ?? new Error(`${label}: retries exhausted`);
}
