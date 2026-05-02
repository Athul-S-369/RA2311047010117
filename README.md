# AffordMed Evaluation — Backend Submission

Production-oriented implementation for the **Vehicle Maintenance Scheduler** (Part 1) and **Campus Notifications** design + **Stage 6 priority inbox** (Part 2). All runtime telemetry uses the custom **`logging_middleware`** (Winston → structured files under `logs/`). **No `console.log`** in application services.

---

## 1. Project Overview

| Area | Location | Role |
|------|----------|------|
| **Logging middleware** | `logging_middleware/` | Shared Winston logger + Express `requestLogger` (`req.log`, request IDs). |
| **Vehicle scheduler** | `vehicle_scheduling/` | Fetches live **depots** + **vehicles** from the evaluation host, runs **0/1 knapsack** per depot, returns optimal schedules. |
| **Notifications (API + Stage 6)** | `notification_app_be/` | Express service: priority inbox from live **notifications** API; Python reference in `notification_app_be/python/`. |
| **Design document** | `notification_system_design.md` | Stages **1–6** (REST, DB, query tuning, performance, reliability, priority inbox). |

---

## 2. Problem Breakdown

### Part 1 — Vehicle maintenance

- Each depot has **MechanicHours** (capacity).
- Each vehicle task has **Duration** (hours) and **Impact** (score).
- Choose a subset per depot: **Σ Duration ≤ MechanicHours**, **maximise Σ Impact** → **0/1 knapsack**.

### Part 2 — Notifications

- **Stages 1–5:** Architecture, schema, query optimisation, caching, queue-based notify-all (documented in markdown).
- **Stage 6:** Top **N** notifications (default 10) by **type weight** then **recency**, fetched from the protected notifications API (no DB, no hard-coded rows).

---

## 3. Approach

### Knapsack (Part 1)

- Classic **dynamic programming** table `dp[i][w]` = max impact using first `i` items with capacity `w`.
- **Weights vs capacity:** If depot + all task durations are **whole hours**, knapsack uses **integer hours** (small **W**, fast at large **n**). Otherwise **minute** units.
- **Duplicate `TaskID`:** Two rows with the same `TaskID` are distinct knapsack items; **totals** are summed from **backtracked row indices** (not `find(id)`), so `totalDuration` / `totalWeight` stay correct.

### Heap / priority queue (Stage 6)

- **Python:** `heapq.nlargest(k, …)` → **O(n log k)**.
- **TypeScript:** sort by `(typeRank, timestampMs)` then slice — **O(n log n)**; acceptable for evaluation loads; Python path demonstrates heap semantics explicitly.

---

## 4. Complexity Analysis

| Component | Complexity | Notes |
|-----------|------------|--------|
| **Knapsack DP** | **O(n · W)** time, **O(n · W)** space | **W** = mechanic budget in knapsack units (hours or minutes). Bounded by real depot budgets (e.g. &lt; a few hundred hours), so **W** stays tractable; very large grids log a warning. |
| **Priority inbox (Python)** | **O(n log k)** | `k = 10` fixed; scales to large **n**. |
| **HTTP fetch** | Retries with backoff | Bounded by `EVALUATION_FETCH_TIMEOUT_MS` (default **60s**) × attempt cap. |

---

## 5. Logging Strategy

- **Middleware:** Every HTTP request gets `req.log` (child logger + `x-request-id`).
- **Files:** `logs/<service>-combined.log`, `logs/<service>-error.log` (per service working directory).
- **Console/stderr:** **Disabled** in `vehicle_scheduling` and `notification_app_be` (`enableCliSink: false`) so reviewers only inspect **log files** (evaluation compliance).

### Sample log snippets (illustrative — from Winston JSON file sink)

**API retry / backoff**

```json
{"level":"info","message":"depots attempt","service":"vehicle-scheduling","attempt":2,"maxAttempts":4}
{"level":"info","message":"depots backing off before retry","service":"vehicle-scheduling","delayMs":1000,"nextAttempt":3}
```

**DP progress**

```json
{"level":"info","message":"Knapsack DP row completed","service":"vehicle-scheduling","itemIndex":500,"totalItems":2000,"bestValueAtFullCapacity":842}
```

**Final selection**

```json
{"level":"info","message":"Knapsack final selection","service":"vehicle-scheduling","selectedCount":12,"totalImpact":240,"totalWeightUnits":58,"totalDurationHours":58,"remainingCapacityUnits":2}
```

---

## 6. How to Run

### Prerequisites

- Node.js **18+** (global `fetch`, `AbortSignal.timeout`).
- Python **3.10+** (optional, for `notification_app_be/python/priority_inbox.py`).

### Environment

Set the evaluation token (from Pre-Test):

```powershell
$env:EVALUATION_AUTH_HEADER="Bearer <your-token>"
```

Optional:

- `EVALUATION_FETCH_RETRIES` (default `4`)
- `EVALUATION_FETCH_TIMEOUT_MS` (default `60000`)
- `DEPOTS_URL`, `VEHICLES_URL`, `NOTIFICATIONS_URL` if endpoints differ

### Vehicle scheduler (port 3000)

```powershell
cd vehicle_scheduling
npm install
npm run build
npm start
```

- Health: `GET http://localhost:3000/health`
- Schedule: `GET http://localhost:3000/api/v1/schedule/optimal`

### Notifications service (port 3001)

```powershell
cd notification_app_be
npm install
npm run build
npm start
```

- Health: `GET http://localhost:3001/health`
- Priority inbox: `GET http://localhost:3001/api/v1/notifications/priority-top?limit=10`

### Unit tests (vehicle knapsack)

```powershell
cd vehicle_scheduling
npm install
npm test
```

### Python Stage 6 (stdout JSON)

```powershell
cd notification_app_be/python
$env:EVALUATION_AUTH_HEADER="Bearer <your-token>"
python priority_inbox.py
```

---

## 7. Folder Structure

```
AFFORMEDS/
├── README.md                          ← This file
├── .gitignore
├── logging_middleware/                ← Shared Winston + Express request logger
├── vehicle_scheduling/
│   ├── src/                           ← API client, merge, knapsack, routes, tests
│   ├── sample_output/                 ← Example JSON response
│   ├── screenshots/                   ← Your vehicle run screenshots
│   └── logs/                          ← Generated at runtime (gitignored)
├── notification_app_be/
│   ├── src/
│   ├── python/                        ← Stage 6 heap reference implementation
│   └── screenshots/
├── notification_system_design.md      ← Stages 1–6
└── screenshots/                       ← Evaluation screenshot checklist (see README inside)
```

---

## 8. Constraints Compliance Checklist

| Constraint | Status |
|------------|--------|
| Custom logging middleware only (no `console.log` in app code) | **Yes** — grep clean; services use `req.log` / root Winston to **files only**. |
| No built-in “printf debugging” | **Yes** |
| No user registration/login on these services | **Yes** |
| No hard-coded evaluation payloads | **Yes** — only HTTP from given URLs |
| No database for evaluation API data | **Yes** |
| Upstream APIs use `Authorization` header | **Yes** — `EVALUATION_AUTH_HEADER` |
| Retries + bounded timeout on evaluation HTTP | **Yes** — 429/500/502/503/504 + transport/abort |
| Knapsack correctness | **Yes** — `npm test` vs brute force on small instances |

---

## 9. Sample Output (API JSON)

### Vehicle — `GET /api/v1/schedule/optimal` (200)

See also `vehicle_scheduling/sample_output/example_schedule_response.json`.

```json
{
  "depots": [
    {
      "ID": 1,
      "selectedTaskIds": ["264e638f-1c7a-4d67-9f9c-53f3d1766d37"],
      "totalDuration": 42,
      "totalImpact": 180
    }
  ]
}
```

### Notifications — `GET /api/v1/notifications/priority-top` (200)

```json
{
  "notifications": [
    {
      "ID": "d146095a-0d86-4a34-9e69-3900a14576bc",
      "Type": "Result",
      "Message": "mid-sem",
      "Timestamp": "2026-04-22 17:51:30"
    }
  ]
}
```

---

## 10. Assumptions & Edge Cases

| Topic | Behaviour |
|-------|-----------|
| **Missing `Duration` / `Impact`** | Row skipped; logged at **warn**. |
| **Negative duration or impact** | Row skipped. |
| **Duplicate `TaskID`** | Treated as **separate** knapsack items; totals use **selected indices** (correct sums). Response may list the same `TaskID` string twice if both rows are chosen. |
| **Vehicles without `DepotID`**, multiple depots | Documented merge rules in code comments + logs (may assign full list per depot or sole-depot fallback). |
| **Unread-only priority (Stage 6)** | Default: unread if `isRead` exists on any row; else full feed + warning. `?includeRead=1` to include read. |

---

## Git remote

Primary submission repo: configure `origin` to your evaluation GitHub URL (e.g. `RA2311047010117-trial`).
