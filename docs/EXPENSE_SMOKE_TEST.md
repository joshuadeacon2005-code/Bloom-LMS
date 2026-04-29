# Expenses → NetSuite Sync — Smoke Test Runbook

Follow this **in order** the first time you turn the rebuilt expense module on
in production. The whole thing should take ~15 minutes if NetSuite is set up
correctly. If a step fails, stop and read the error — every failure mode below
has a clear cause.

## Pre-flight

Before you touch Railway, confirm the following with whoever runs NetSuite:

- [ ] **Subsidiary names match LMS region names exactly.** LMS regions are
      "Hong Kong", "Singapore", "Malaysia", "Indonesia", "China", "Australia",
      "New Zealand". If the NS subsidiaries are "Bloom & Grow Hong Kong
      Limited" etc., either rename one side or open a follow-up to add a
      `netsuite_subsidiary_name` override field on `regions`.
- [ ] **Each LMS user's email matches their NetSuite employee record email.**
      Spot-check 2-3 users.
- [ ] **The TBA token role has these permissions:**
      *Create + Read on Expense Report; Read on Employee, Subsidiary, Expense
      Category, Currency.*
- [ ] **No old/junk Expense Reports in NS** from the previous broken sync. If
      there are, delete them in NS now. There won't be new ones until you flip
      the kill switch off.

## Environment variables (Railway → server service)

You'll move through three states. Set these on the **server** service.

| Phase | `EXPENSE_SYNC_DISABLED` | `EXPENSE_DRY_RUN` | What happens |
|------|------|------|------|
| Phase 0: kill-switch on (current) | `true` | `false` (or unset) | Approvals work but never POST to NS. Use this if anything looks wrong. |
| Phase 1: dry run | `false` (or unset) | `true` | Approvals build the full NS payload, log it to server logs, then revert the report status to APPROVED so you can re-run. **No record is created in NS.** |
| Phase 2: live | `false` (or unset) | `false` (or unset) | Real sync. Approvals create records in NS. |

These additional vars must be set in **all** phases:

```
NS_ACCOUNT_ID=
NS_CONSUMER_KEY=
NS_CONSUMER_SECRET=
NS_TOKEN_ID=
NS_TOKEN_SECRET=
EXPENSE_HR_SLACK_CHANNEL=#expense-notifications   # optional, opt-in
```

## Phase 0 → Phase 1: dry-run smoke test

Goal: prove the LMS can resolve every NetSuite internal ID it needs, without
creating a real record.

### Step 1. Switch to dry-run mode

In Railway:
- Set `EXPENSE_SYNC_DISABLED=false` (or remove the variable).
- Set `EXPENSE_DRY_RUN=true`.
- Redeploy.

### Step 2. Verify the lookups work

Open the app, log in as any user, and load the expenses page. Open the
"Add Expense" sheet. Both dropdowns must populate:

- [ ] **Categories dropdown** lists NetSuite expense categories.
- [ ] **Currencies dropdown** lists NS currencies.

If either is empty, the SuiteQL queries are failing. Check Railway logs for
the line `NetSuite SuiteQL failed`. The response body is included — common
causes: TBA permissions missing, account ID format wrong, table column name
differs in your NS edition.

### Step 3. Walk a draft through the flow

As a regular employee user:
1. Add 2-3 expenses with different categories, dates, and amounts.
   Optionally attach a receipt to one.
2. Select all of them and click **Create Report**.
3. Open the report and click **Send for Approval**.

The submitter's manager (per the LMS user record) should receive a Slack DM
within a few seconds with Approve / Reject buttons. If the DM doesn't arrive,
check that the manager has a `slackUserId` set in the LMS.

### Step 4. Approve and check the dry-run payload

Click **Approve** in Slack (or in the Approvals tab). The report status will
flicker through SYNCING and **revert to APPROVED**. This is correct — dry-run
mode logs the payload but does not POST.

In Railway server logs, find a line:
```
[expense] DRY RUN — report #<id> payload that would be POSTed:
```

The next ~30 lines are the JSON payload. Verify each field:

- [ ] `entity.id` is the submitter's NS internal employee ID (cross-check in NS).
- [ ] `subsidiary.id` matches the right subsidiary for the user's region.
- [ ] `tranDate` is a valid `YYYY-MM-DD`.
- [ ] `expenseReportCurrency.id` is set.
- [ ] `expense.items[]` has the right number of line items.
- [ ] Each item has `category.id`, `currency.id`, `amount` (number, not string),
      and `expenseDate`.
- [ ] `externalId` is `lms-report-<id>` — this is the idempotency key.

If any field is missing or wrong: don't proceed. Common issues:

| Symptom | Cause | Fix |
|--|--|--|
| `No active NetSuite employee with email "x"` | Submitter's LMS email ≠ their NS employee email | Update one side |
| `No NetSuite subsidiary matching "Hong Kong"` | LMS region name doesn't match NS subsidiary name | Rename or add override field |
| `expense category "X" not found` | User typed/picked something not in NS | Pick again from the dropdown — categories are sourced from NS |
| `Currency "HKD" not found` | NS currency record's `symbol` field doesn't equal the LMS currency code | Fix in NS |

### Step 5. Re-test as needed

Because dry-run reverts to APPROVED, you can click **Retry Sync** (it'll be
APPROVED, not SYNC_FAILED, but you can also manually re-trigger by setting
status back). Or simply create another report.

## Phase 1 → Phase 2: real sync

Once the dry-run payload looks correct for a real report:

### Step 6. Flip to live

In Railway:
- Set `EXPENSE_DRY_RUN=false` (or remove it).
- **Keep** all NS_* variables.
- Redeploy.

### Step 7. Real test — small amount

Have a willing employee (or yourself) create a small report (one $1.00 line
item, "Smoke test" description). Send for approval, approve.

- [ ] Status moves PENDING_REVIEW → AWAITING_APPROVAL → APPROVED → SYNCING → **SYNCED** within ~10 seconds.
- [ ] The "View in NetSuite" link in the report detail opens the actual NS Expense Report record.
- [ ] If `EXPENSE_HR_SLACK_CHANNEL` is set, that channel gets a "synced" notification.
- [ ] In NetSuite, open the record and confirm: correct employee, correct subsidiary, all line items present with correct categories.

### Step 8. Real test — failure path

Manually break something in NS (e.g., temporarily revoke the integration's
"Create Expense Report" permission, or use a user whose email isn't in NS) and
approve a report. Confirm:

- [ ] Status ends at **SYNC_FAILED** after 3 attempts (with exponential backoff).
- [ ] The error message in the report detail names the cause.
- [ ] HR Slack channel gets a "sync FAILED" notification.
- [ ] **Retry Sync** button works once you fix the underlying cause.

### Step 9. Delete the smoke-test record

In NetSuite, delete the "Smoke test" Expense Report you created in step 7.
This clears the externalId so the report row in our DB doesn't keep pointing
at a deleted NS record. (If the user wants to re-sync, they'd need to do it
manually.)

## Rollback

If anything goes wrong in production:

1. Set `EXPENSE_SYNC_DISABLED=true` in Railway.
2. Redeploy.

This stops new sync attempts immediately. Reports that were mid-sync stay in
their current status. No data is lost. Unblock the rebuild with the dev team.

## What's not covered yet (open work)

- Auto-cleanup of stale `SYNCING` rows after a server restart.
- Per-region subsidiary name override (currently relies on exact name match).
- A way to bulk-import historical expenses from CSV.
- Edit-after-rejection of individual lines without reverting the whole report.
- Integration tests for the new API.
