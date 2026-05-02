# Notification System — Design

## Goals

- Deliver timely alerts (maintenance due, failures, reminders) to operators and integrations.
- Support multiple channels (in-app, email, SMS/push later) behind a single internal API.
- Remain reliable under retries, partial outages, and duplicate suppression.

## High-Level Architecture

1. **API layer** — REST (or GraphQL) endpoints to register devices/users, preferences, and to trigger notifications from domain services (e.g. maintenance scheduler).
2. **Notification service** — Validates payloads, resolves recipients and templates, enqueues work.
3. **Queue** — Durable queue (e.g. Redis, RabbitMQ, SQS) between API/workers and channel adapters.
4. **Workers** — Consume jobs, apply rate limits, call channel providers, record outcomes.
5. **Persistence** — Store notification records, delivery status, idempotency keys, and user preferences.

## Core Concepts

| Concept | Purpose |
|--------|---------|
| **Template** | Channel-specific body/subject with placeholders. |
| **Event type** | Stable code (e.g. `MAINTENANCE_DUE`) mapping to templates and default channels. |
| **Preference** | Per-user opt-in/out and quiet hours. |
| **Idempotency** | Client-supplied key to avoid duplicate sends on retry. |

## Data Flow

1. Domain service publishes intent: “notify user X about event Y with payload Z.”
2. Service resolves template + channels from preferences and event type.
3. Job enqueued with correlation ID for tracing.
4. Worker sends via adapter; result persisted (success, transient failure, permanent failure).
5. Dead-letter or retry policy for failures; optional webhook callback to originating service.

## Non-Functional Requirements

- **At-least-once** delivery acceptable; **exactly-once** UX via idempotency and deduplication windows.
- **Observability**: structured logs, metrics (queued, sent, failed, latency), tracing IDs across services.
- **Security**: authenticate internal callers; never log secrets or full PII in plain text.

## Open Items

- Final channel list and vendor choices.
- Retention policy for notification history and compliance (e.g. GDPR).
