#!/usr/bin/env python3

from __future__ import annotations

import heapq
import json
import os
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Iterable

from custom_logger import StructuredFileLogger

DEFAULT_URL = "http://20.207.122.201/evaluation-service/notifications"
TOP_K = 10
MAX_RETRIES = 4
BASE_DELAY_S = 0.4


def type_weight(type_raw: str) -> int:
    t = (type_raw or "").strip().lower()
    if t == "placement":
        return 3
    if t == "result":
        return 2
    if t == "event":
        return 1
    return 0


def type_for_evaluation_output(type_raw: str) -> str:
    t = (type_raw or "").strip().lower()
    if t == "placement":
        return "Placement"
    if t == "result":
        return "Result"
    if t == "event":
        return "Event"
    return type_raw or ""


def parse_ts(raw: str) -> float:
    if not raw:
        return 0.0
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%SZ"):
        try:
            return datetime.strptime(raw.replace("Z", ""), fmt.replace("Z", "")).timestamp()
        except ValueError:
            continue
    return 0.0


@dataclass(frozen=True)
class Notification:
    id: str
    type: str
    message: str
    timestamp: str
    ts: float
    weight: int

    @staticmethod
    def from_row(row: dict[str, Any], log: StructuredFileLogger) -> Notification | None:
        nid = str(row.get("ID") or row.get("id") or "")
        typ = str(row.get("Type") or row.get("type") or "")
        msg = str(row.get("Message") or row.get("message") or "")
        ts_raw = str(row.get("Timestamp") or row.get("timestamp") or "")
        if not nid:
            log.warn("Skipping row without ID", row_keys=list(row.keys()))
            return None
        ts = parse_ts(ts_raw)
        w = type_weight(typ)
        return Notification(id=nid, type=typ, message=msg, timestamp=ts_raw, ts=ts, weight=w)


def extract_rows(payload: Any, log: StructuredFileLogger) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [x for x in payload if isinstance(x, dict)]
    if isinstance(payload, dict):
        for key in ("notifications", "Notifications", "data"):
            v = payload.get(key)
            if isinstance(v, list):
                log.info("Extracted notification rows", key=key, count=len(v))
                return [x for x in v if isinstance(x, dict)]
    log.error("Unknown notifications payload shape")
    return []


def fetch_notifications(url: str, auth: str, log: StructuredFileLogger) -> Any:
    req = urllib.request.Request(
        url,
        headers={"Accept": "application/json", "Authorization": auth},
        method="GET",
    )
    last_err: Exception | None = None
    for attempt in range(1, MAX_RETRIES + 1):
        log.info("HTTP GET notifications", attempt=attempt, url=url)
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                body = resp.read().decode("utf-8")
                log.info("HTTP response", status=resp.status, bytes=len(body), attempt=attempt)
                return json.loads(body)
        except urllib.error.HTTPError as e:
            last_err = e
            code = e.code
            log.warn("HTTP error", code=code, attempt=attempt)
            if attempt < MAX_RETRIES and code in (429, 502, 503, 504):
                time.sleep(BASE_DELAY_S * (2 ** (attempt - 1)))
                continue
            raise
        except (urllib.error.URLError, OSError, json.JSONDecodeError) as e:
            last_err = e
            log.warn("Request failed", message=str(e), attempt=attempt)
            if attempt < MAX_RETRIES:
                time.sleep(BASE_DELAY_S * (2 ** (attempt - 1)))
                continue
            raise
    if last_err:
        raise last_err
    raise RuntimeError("unreachable")


def priority_key(n: Notification) -> tuple[int, float]:
    return (n.weight, n.ts)


def top_k_heap(notifications: Iterable[Notification], k: int, log: StructuredFileLogger) -> list[Notification]:
    items = list(notifications)
    log.info("Computing top-k via heapq.nlargest", n=len(items), k=k)
    return heapq.nlargest(k, items, key=priority_key)


def main() -> int:
    log = StructuredFileLogger("notification-stage6-python", log_dir=os.environ.get("LOG_DIR", "logs"))
    auth = (os.environ.get("EVALUATION_AUTH_HEADER") or "").strip()
    if not auth:
        log.error("EVALUATION_AUTH_HEADER is required")
        return 1
    url = os.environ.get("NOTIFICATIONS_URL", DEFAULT_URL).strip()

    try:
        raw = fetch_notifications(url, auth, log)
    except Exception as e:
        log.error("Failed to fetch notifications", error=str(e))
        return 2

    rows = extract_rows(raw, log)
    parsed: list[Notification] = []
    for r in rows:
        n = Notification.from_row(r, log)
        if n:
            parsed.append(n)

    log.info("Parsed notifications", count=len(parsed))
    top = top_k_heap(parsed, TOP_K, log)
    top.sort(key=lambda x: (-x.weight, -x.ts))

    out = {
        "notifications": [
            {
                "ID": n.id,
                "Type": type_for_evaluation_output(n.type),
                "Message": n.message,
                "Timestamp": n.timestamp,
            }
            for n in top
        ]
    }
    json.dump(out, sys.stdout, indent=2)
    sys.stdout.write("\n")
    log.info("Wrote top notifications to stdout", count=len(top))
    log.info("Completed priority inbox", returned=len(top))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
