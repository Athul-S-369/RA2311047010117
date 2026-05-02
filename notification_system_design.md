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

---

# Stage 5

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

**Rule:** sort primarily by **type weight** (Placement > Result > Event), secondarily by **recency** (newer `Timestamp` first). Take top **N** (default 10).

**Implementation:** see `notification_app_be` — `GET /api/v1/notifications/priority-top` loads data from the **protected** evaluation `GET /notifications` API (no local DB, no hard-coded notifications). All logging uses the **logging middleware** (`req.log` / Winston), not `console.log`.

## Maintaining top 10 as new items arrive

- **Small streams:** re-run the sort on a bounded in-memory window (e.g. last 10 000 ids) — \(O(n \log n)\).
- **Large / streaming:** keep a **min-heap of size k** ordered by the same comparator; each insert is \(O(\log k)\); evict root when better item arrives.
- **Hybrid:** Redis sorted set keyed by composite score + periodic trim to k.

---

## Vehicle scheduler (same evaluation constraints)

The **vehicle_scheduling** service (separate folder) loads **only** live data from:

- `GET .../evaluation-service/depots` → `{ "depots": [ { "ID", "MechanicHours" }, ... ] }`
- `GET .../evaluation-service/vehicles` → `{ "vehicles": [ { "TaskID", "Duration", "Impact", ... } ] }`

It solves **0/1 knapsack** per depot: total **Duration** ≤ **MechanicHours**, maximise **Impact**. No database and no hard-coded tasks. Logging middleware is mandatory throughout.
