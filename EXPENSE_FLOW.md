# Expense Tool — Flow Overview

---

## How It Works

1. **Upload CSV** — User uploads an expense CSV. Each upload becomes one expense record with status `PENDING_REVIEW`.

2. **Send for Approval** — User clicks "Send for Approval". A Slack message with Approve / Reject buttons is posted to the approvals channel. Status moves to `AWAITING_APPROVAL`.

3. **Approve or Reject in Slack** — Manager clicks a button directly in Slack.
   - **Approve** → status becomes `APPROVED`, then immediately `SYNCING` as the system creates the expense report in NetSuite.
   - **Reject** → status becomes `REJECTED`. User can resubmit, which resets it to `PENDING_REVIEW`.

4. **NetSuite Sync** — After approval, all approved expenses are sent to NetSuite as a batch. On success → `SYNCED`. On failure after 3 attempts → `SYNC_FAILED`. User can retry from the UI.

---

## State Flow

```
PENDING_REVIEW
    │  Send for Approval
    ▼
AWAITING_APPROVAL
    │  Approve (Slack)       │  Reject (Slack)
    ▼                        ▼
APPROVED                 REJECTED
    │  (auto)                │  Resubmit
    ▼                        ▼
SYNCING              PENDING_REVIEW
    │  Success    │  Fail (3x)
    ▼             ▼
SYNCED       SYNC_FAILED
                  │  Retry
                  ▼
               SYNCING
```

---

## Key Rules

- Every state change is logged to `expense_audit_log` (who did it, when, from/to state).
- NetSuite sync retries up to 3 times before moving to `SYNC_FAILED`.
- Set `MOCK_EXTERNAL=true` in `.env` to skip all Slack and NetSuite calls during development.
- Employees are matched to NetSuite by **email address**.

---

## API Endpoints

| Method | Path | What it does |
|---|---|---|
| `POST` | `/api/upload` | Upload CSV, bulk insert expenses |
| `GET` | `/api/expenses` | List expenses (filter by `?status=`) |
| `GET` | `/api/expenses/:id` | Single expense + audit log |
| `POST` | `/api/expenses/:id/send-approval` | Send Slack approval message |
| `POST` | `/api/expenses/:id/retry-sync` | Retry a failed NS sync |
| `POST` | `/slack/interactions` | Slack button callback (approve/reject) |
