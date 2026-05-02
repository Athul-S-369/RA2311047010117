# Campus Notification Platform — Design (Evaluation)

This document covers **Stage 1** through **Stage 6** for the campus notifications track, and aligns with the REST + real-time choices used across stages.

---

# Stage 1

## Core actions

- List notifications for the signed-in student (paginated, filter by type/read).
- Mark one or many notifications as read.
- Register and update device endpoints for push (FCM/APNs token).
- Subscribe/unsubscribe to categories (Placements, Events, Results).
- **Real-time**: receive new notifications without polling (WebSocket or SSE).

## REST API (no login UI in this evaluation; assume pre-authorised callers)

Base URL: `https://api.campus.example/v1`  
All JSON bodies use `application/json`. Responses include `X-Request-Id` for tracing.

### Headers (typical)

| Header | Value |
|--------|--------|
| `Authorization` | `Bearer <student_session_jwt>` |
| `Accept` | `application/json` |

### Endpoints

#### `GET /students/me/notifications`

**Query:** `cursor`, `limit` (default 20, max 100), `type` (`Placement`|`Result`|`Event`), `read` (`true`|`false`).

**200 response**

```json
{
  "items": [
    {
      "id": "uuid",
      "type": "Placement",
      "message": "ACME hiring",
      "createdAt": "2026-04-22T17:51:30Z",
      "read": false
    }
  ],
  "nextCursor": "opaque-string-or-null"
}
```

#### `PATCH /students/me/notifications:markRead`

**Request**

```json
{ "ids": ["uuid1", "uuid2"] }
```

**200:** `{ "updated": 2 }`

#### `PUT /students/me/devices`

Register push token.

**Request**

```json
{ "platform": "web", "token": "fcm-or-apns-token", "appVersion": "1.4.0" }
```

**200:** `{ "deviceId": "uuid" }`

#### `GET /students/me/preferences`

**200:** `{ "channels": { "push": true, "email": true }, "mutedTypes": [] }`

#### `PATCH /students/me/preferences`

**Request:** partial update of channels / muted types.

#### `POST /v1/internal/notifications/push` (server → push vendor)

Dispatches an in-app / mobile push via FCM/APNs (or Web Push) using stored device tokens. Intended for trusted internal callers or job workers (not student-facing raw access).

**Headers:** `Authorization: Bearer <service_token>`, `Content-Type: application/json`, `X-Request-Id: <uuid>`

**Request JSON**

```json
{
  "studentIds": [1042, 2201],
  "title": "Placement",
  "body": "ACME campus hiring — apply by Friday",
  "data": { "deeplink": "/placements/42", "notificationId": "uuid" },
  "priority": "high"
}
```

**Response 202**

```json
{
  "accepted": 2,
  "jobId": "queue-job-uuid",
  "errors": []
}
```

The worker fan-out, retries, and vendor responses are tracked separately (see Stage 5).

---

## Real-time mechanism

- **WebSocket** channel `wss://api.campus.example/v1/ws?token=...` (or **SSE** `GET /students/me/notifications/stream` with `text/event-stream`).
- Server pushes envelope: `{ "event": "notification.created", "payload": { ...notification } }`.
- Client ACKs delivery with `notification.received` for at-least-once tracking if needed.

---

# Stage 2

## Persistent storage

**PostgreSQL** (relational): strong consistency for reads/writes, JSONB for flexible metadata, mature indexing, and clear modelling of students, devices, and notification rows.

## Schema (simplified)

```sql
CREATE TYPE notification_type AS ENUM ('Placement', 'Result', 'Event');

CREATE TABLE students (
  id BIGSERIAL PRIMARY KEY,
  external_id UUID NOT NULL UNIQUE,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  id BIGSERIAL PRIMARY KEY,
  student_id BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  notification_type notification_type NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_notifications_student_created
  ON notifications (student_id, created_at DESC);

CREATE INDEX idx_notifications_student_unread
  ON notifications (student_id)
  WHERE is_read = false;
```

## Growth problems

- Table and index bloat; vacuum tuning; partitioning by `created_at` (monthly).
- Hot partitions for “recent unread”; consider partial indexes and archiving cold data to object storage.

## Example queries

**Page unread for student**

```sql
SELECT id, notification_type, message, created_at
FROM notifications
WHERE student_id = $1 AND is_read = false
ORDER BY created_at DESC
LIMIT $2;
```

**Mark read**

```sql
UPDATE notifications
SET is_read = true
WHERE student_id = $1 AND id = ANY($2::bigint[]);
```

---

# Stage 3

## Accuracy of the slow query

```sql
SELECT * FROM notifications
WHERE studentID = 1042 AND isRead = false
ORDER BY createdAt DESC;
```

The query is **logically correct** for “all unread for student 1042, newest first” **if** column names match the schema (`student_id`, `is_read`, `created_at`). Using wrong names would error or return wrong data.

## Why it is slow at scale

- `SELECT *` widens I/O and cache pressure.
- Without a supporting **index** on `(student_id, is_read, created_at)`, the database scans millions of rows.
- Sorting a large matching set is expensive.

## What to change

- Add a **partial index** aligned to the filter and sort, e.g. `(student_id, created_at DESC) WHERE is_read = false`, or composite `(student_id, is_read, created_at DESC)`.
- Select only needed columns.
- **Likely cost**: index build is \(O(n \log n)\) once; steady-state read becomes index range scan + ordered retrieval — roughly **O(k + log n)** for k returned rows instead of **O(N)** table scan.

## “Index every column” — is it effective?

**No.** Extra indexes slow inserts/updates, increase storage, and confuse the planner. Indexes should match **actual predicates and sort orders**. Too many overlapping indexes can cause **worse** plans.

## Students with a Placement notification in the last 7 days

```sql
SELECT DISTINCT s.id, s.email
FROM students s
JOIN notifications n ON n.student_id = s.id
WHERE n.notification_type = 'Placement'
  AND n.created_at >= now() - interval '7 days';
```

(Adjust column names if the physical schema uses `notificationType` strings instead of enums.)

---

# Stage 4

## Problem

Fetching all notifications on every page load hammers the DB and hurts UX.

## Strategies (tradeoffs)

| Strategy | Idea | Pros | Cons |
|----------|------|------|------|
| **Short TTL cache** (Redis) | Cache last page per student | Huge read reduction | Staleness; invalidation complexity |
| **Materialized unread counts** | Maintain counters | Fast badges | Must update on read/write |
| **Pagination + keyset** | Cursor on `(created_at, id)` | Stable, scalable pages | Slightly harder API |
| **Edge / CDN** | Not for private feeds | — | Not applicable for personalised lists |
| **Read replicas** | Scale reads | More capacity | Replication lag |

**Recommended:** keyset pagination + partial index + small Redis cache for “first page unread” with TTL 30–60s and invalidation on write.

### Lazy loading

Load only the first viewport of notifications (e.g. 15 rows) and request the next page when the user scrolls. **Trade-off:** more round-trips vs smaller payloads and faster first paint; combine with keyset cursors to avoid duplicates when new rows arrive while scrolling.

### Push-based updates

Prefer **WebSocket/SSE** (Stage 1) so the client receives `notification.created` events and merges into local state instead of polling. **Trade-off:** connection lifecycle complexity vs large reduction in read QPS; always keep a polling fallback for flaky networks.

---

# Stage 5

## Queue, workers, and retries

- **Queue (Kafka / RabbitMQ / SQS):** decouples producers from delivery; absorbs spikes; enables horizontal scale-out of consumers.
- **Worker system:** dedicated pools for DB writes, email, and push with independent concurrency limits and circuit breakers.
- **Retry mechanism:** exponential backoff + dead-letter queues for poison messages; idempotency keys per `(broadcastId, studentId)` to prevent duplicate side effects.

## Shortcomings of sequential `notify_all`

- **No batching / concurrency control** — one slow email blocks the rest.
- **No retries or idempotency** — partial failure leaves inconsistent state.
- **Coupling DB + email + push** in one loop — one failure mode stalls everything.
- **No rate limiting** — provider throttling can fail the whole run.

## If `send_email` fails for 200 students midway

- Those 200 should be **retried with backoff**, not silently dropped.
- Already-processed students should not be double-emailed (idempotency key per broadcast).

## Should DB save and email happen together?

**Not in one synchronous transaction with the email vendor.** Persist an **outbox** row (or job) first in a DB transaction, then workers send email/push and mark job status. This gives **at-least-once** processing and clear recovery.

## Revised pseudocode

```text
function notify_all(student_ids, message, broadcast_id):
  enqueue job { broadcast_id, student_ids, message } to durable queue (Kafka/SQS/Rabbit)

worker handles job:
  batch = next_chunk(student_ids, size=500)
  for student_id in batch:
    insert into notification_outbox (broadcast_id, student_id, status='pending')
      on conflict do nothing  -- idempotent

  for row in outbox where status='pending' and broadcast_id=... limit 100:
    begin txn
      insert into notifications (student_id, type, message) values (...)
      update notification_outbox set status='db_written' where id=row.id
    commit
    enqueue email_job(row)
    enqueue push_job(row)

email_worker(row):
  try send_email(row)
  on success: mark outbox email_sent
  on transient failure: requeue with backoff
  on permanent failure: mark failed + alert
```

---

# Stage 6

## Priority inbox (top N)

**Rule:** sort primarily by **type weight** (Placement > Result > Event), secondarily by **recency** (newer `Timestamp` first). Take top **10** (configurable).

### Python implementation (heap / priority queue — required)

Reference: `notification_app_be/python/priority_inbox.py`

- Fetches `GET http://20.207.122.201/evaluation-service/notifications` with `EVALUATION_AUTH_HEADER` (no hard-coded notifications, no DB).
- Uses **`heapq.nlargest(10, …)`** which implements a binary heap internally — **\(O(n \log k)\)** for \(k=10\), suitable for large \(n\).
- Logging uses **`StructuredFileLogger`** in `custom_logger.py` — **no** `print` and **no** stdlib `logging` module (parallel to “no built-in loggers” in other languages).

Run:

```bash
cd notification_app_be/python
set EVALUATION_AUTH_HEADER=Bearer <token>
python priority_inbox.py > ../screenshots/priority_stdout_sample.json
```

### Node/TypeScript mirror (same evaluation API)

`notification_app_be` Express service: `GET /api/v1/notifications/priority-top` uses **`@affordmed/logging-middleware`** only (Winston-backed), retries in `evaluationHttp.ts`, and returns `{ "notifications": [ { "ID","Type","Message","Timestamp" } ] }`.

By default it ranks **unread** notifications only (Stage 6). If the evaluation API omits `isRead`, the service falls back to the full list and logs a warning. Add query **`includeRead=1`** to include read notifications in ranking.

## Maintaining top 10 as new items arrive

- **Streaming / unbounded feed:** maintain a **min-heap of size 10** storing the “worst” of the current best; on each new notification, compare with heap root; if better, pop root and push new item — **\(O(\log 10)\)** per arrival.
- **Micro-batching:** accumulate bursts then run `nlargest` on the batch for simpler code under bursty HR broadcasts.
- **Hybrid:** Redis sorted set (`ZADD` + periodic `ZREMRANGEBYRANK` to keep top k) for multi-consumer fan-in.

---

## Vehicle scheduler (same evaluation constraints)

The **vehicle_scheduling** service loads **only** live data from:

- `GET .../evaluation-service/depots` → `{ "depots": [ { "ID", "MechanicHours" }, ... ] }`
- `GET .../evaluation-service/vehicles` → `{ "vehicles": [ { "TaskID", "Duration", "Impact", ... } ] }`

It solves **0/1 knapsack DP** per depot: total **Duration** ≤ **MechanicHours**, maximise **Impact**. No database and no hard-coded tasks. **Logging middleware** is used for HTTP retries, merge, DP row progress, and final selection.

**HTTP 200 response shape** (`GET /api/v1/schedule/optimal`):

```json
{
  "depots": [
    {
      "ID": "1",
      "selectedTaskIds": ["…"],
      "totalDuration": 42,
      "totalImpact": 180
    }
  ]
}
```

See `vehicle_scheduling/sample_output/example_schedule_response.json` for a documented example.
