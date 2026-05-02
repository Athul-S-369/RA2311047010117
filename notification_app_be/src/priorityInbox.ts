import type { AppLogger } from "@affordmed/logging-middleware";

export interface NormalizedNotification {
  ID: string;
  Type: string;
  Message: string;
  Timestamp: string;
  timestampMs: number;
  typeRank: number;
  isRead?: boolean;
}

function pickString(o: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.length > 0) return v;
    if (typeof v === "number") return String(v);
  }
  return undefined;
}

function typeRank(typeRaw: string | undefined): number {
  const t = (typeRaw ?? "").trim().toLowerCase();
  if (t === "placement") return 3;
  if (t === "result") return 2;
  if (t === "event") return 1;
  return 0;
}

function parseTimestampMs(raw: string | undefined, log: AppLogger): number {
  if (!raw) return 0;
  const isoGuess = raw.includes("T") ? raw : raw.replace(" ", "T");
  const d = new Date(isoGuess);
  const ms = d.getTime();
  if (Number.isNaN(ms)) {
    log.warn("Could not parse notification timestamp", { raw });
    return 0;
  }
  return ms;
}

export function normalizeNotificationsPayload(raw: unknown, log: AppLogger): NormalizedNotification[] {
  let rows: unknown[] = [];
  if (Array.isArray(raw)) rows = raw;
  else if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (Array.isArray(o.notifications)) rows = o.notifications;
    else if (Array.isArray(o.Notifications)) rows = o.Notifications;
    else if (Array.isArray(o.data)) rows = o.data;
  }

  log.info("Parsing notifications array", { rowCount: rows.length });

  const out: NormalizedNotification[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;

    const id = pickString(r, ["ID", "id", "notificationId"]) ?? `row-${i}`;
    const type = pickString(r, ["Type", "type", "notificationType"]) ?? "";
    const message = pickString(r, ["Message", "message", "body"]) ?? "";
    const ts = pickString(r, ["Timestamp", "timestamp", "createdAt", "CreatedAt"]) ?? "";

    let isRead: boolean | undefined;
    const readVal = r.isRead ?? r.IsRead ?? r.read;
    if (typeof readVal === "boolean") isRead = readVal;
    else if (readVal === 0 || readVal === 1) isRead = readVal === 1;

    const timestampMs = parseTimestampMs(ts, log);
    const tr = typeRank(type);

    out.push({
      ID: id,
      Type: type,
      Message: message,
      Timestamp: ts,
      timestampMs,
      typeRank: tr,
      isRead,
    });
  }

  return out;
}

export function selectTopPriorityNotifications(
  items: NormalizedNotification[],
  limit: number,
  unreadOnly: boolean,
  log: AppLogger
): NormalizedNotification[] {
  log.info("Selecting priority inbox slice", {
    inputCount: items.length,
    limit,
    unreadOnly,
  });

  let pool = items;
  if (unreadOnly) {
    const hasReadFlag = items.some((n) => n.isRead !== undefined);
    if (hasReadFlag) {
      pool = items.filter((n) => n.isRead === false);
      log.info("Filtered to strictly unread notifications", { count: pool.length });
    } else {
      log.warn(
        "Unread-only priority inbox requested but API rows lack isRead; using full feed (cannot infer unread)"
      );
    }
  }

  const sorted = [...pool].sort((a, b) => {
    if (b.typeRank !== a.typeRank) return b.typeRank - a.typeRank;
    return b.timestampMs - a.timestampMs;
  });

  const top = sorted.slice(0, Math.max(0, limit));
  log.info("Priority selection complete", { returned: top.length });
  return top;
}

export function explainTopKStrategy(log: AppLogger): void {
  log.info("Top-k maintenance strategy", {
    approach:
      "Recompute selectTopPriorityNotifications over recent window, or min-heap size k for streaming O(n log k)",
  });
}
