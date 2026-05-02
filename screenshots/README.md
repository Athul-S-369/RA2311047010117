# Evaluation screenshots checklist

Capture these for the **vehicle** and **notification** tracks. Store vehicle-related images under `vehicle_maintence_scheduler/screenshots/` and notification-related under `notification_app_be/screenshots/` (or copy all here for a single zip).

## 1. Successful API response

- **Vehicle:** Browser or REST client showing **HTTP 200** body for  
  `GET http://localhost:3000/api/v1/schedule/optimal`  
  with JSON: `{ "depots": [ { "ID", "selectedTaskIds", "totalDuration", "totalImpact" } ] }`.
- **Notifications:** **HTTP 200** for  
  `GET http://localhost:3001/api/v1/notifications/priority-top`  
  with `{ "notifications": [ … ] }` (PascalCase fields).

## 2. Logs showing retries

- Open `vehicle_maintence_scheduler/logs/vehicle-maintence-scheduler-combined.log` (or notification service equivalent).
- Include lines showing **`attempt`**, **`backing off before retry`**, or **`non-success status`** followed by a later successful **`HTTP response`** (after using a valid token, or redact secrets).

## 3. Logs showing DP progress

- From the same log file, capture **`Knapsack DP row completed`** lines (item index / best value at capacity).

## 4. Priority inbox output

- Screenshot of JSON response **or** terminal output from `notification_app_be/python/priority_inbox.py` printing the top-10 `notifications` array.

---

**Tip:** Redact bearer tokens in screenshots. Use a valid `EVALUATION_AUTH_HEADER` only on your machine.
