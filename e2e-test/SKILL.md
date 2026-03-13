---
name: e2e-test
description: "Full end-to-end API test runner for the Bloom & Grow Leave Management System. Use this skill whenever the user asks to test the application, run E2E tests, verify endpoints, check if the API is working, run integration tests, or validate the LMS functionality. Triggers on any mention of 'test', 'e2e', 'end to end', 'integration test', 'API test', 'smoke test', 'verify endpoints', or 'check if everything works' in the context of the Bloom LMS project."
---

# Bloom LMS — Full End-to-End API Test Runner

This skill runs a comprehensive test suite against a live Bloom LMS server instance, covering every API endpoint and key business workflows.

## What it tests

The test script exercises **all major application modules**:

1. **Health** — Server health check
2. **Auth** — Login, register, token refresh, logout, change password, get profile
3. **Leave Types** — Fetch available leave types for a region
4. **Leave Requests** — Create, list, get by ID, cancel requests
5. **Approvals** — List pending (as manager), approve a request, reject a request, view history
6. **Balances** — Get own balances, get another user's balances (HR), manual adjustment, year-end rollover
7. **Overtime** — Submit overtime entry, list history, check balance, approve, reject, cancel
8. **Users** — List users (HR), create user, get by ID, update user, delete user (soft), get managers
9. **Admin** — Regions, departments, leave types CRUD, policies CRUD, holidays CRUD
10. **Reports** — Utilisation, department summary, payroll CSV export
11. **Notifications** — List, mark as read, mark all as read
12. **Calendar** — Team absence calendar, public holidays
13. **Workflow tests** — Full leave-request-to-approval flow, leave-request-to-rejection flow, overtime-to-approval flow

## How to use

### Prerequisites
- The Bloom LMS server must be running and accessible (e.g. `http://localhost:3001`)
- The database must be seeded with test data (the standard seed scripts provide this)
- Node.js must be available in the environment

### Running the tests

```bash
node <path-to-skill>/scripts/run-e2e.mjs <BASE_URL>
```

If no URL is provided, it defaults to `http://localhost:3001`.

The script will:
1. Authenticate as different user roles (super_admin, hr_admin, manager, employee)
2. Run every test in sequence, logging pass/fail for each
3. Print a summary at the end with total passed, failed, and skipped
4. Exit with code 0 if all tests pass, 1 if any fail

### Test accounts used

The script relies on seeded users. It logs in as:

| Role | Email | Password |
|------|-------|----------|
| Super Admin | josh@bloomandgrowgroup.com | C00k1eD0g |
| HR Admin | elaine@bloomandgrowgroup.com | Password123! |
| Manager | amy@bloomandgrowgroup.com | Password123! |
| Employee | eva.chan@bloomandgrowgroup.com | Password123! |

If your seed data uses different passwords, update the `TEST_ACCOUNTS` object at the top of `scripts/run-e2e.mjs`.

### Reading the output

Each test prints a line like:
```
[PASS] Auth > Login as super_admin
[FAIL] Leave > Create leave request — 400: Insufficient balance
[SKIP] Admin > Delete holiday — no holiday ID from previous step
```

At the end you get a summary:
```
========================================
  RESULTS: 47 passed, 2 failed, 1 skipped (50 total)
========================================
```

### Customising

The script is a single `.mjs` file with no dependencies beyond Node's built-in `fetch`. You can:
- Add new test cases by appending to the `tests` array
- Change test data (dates, leave types, etc.) by editing the constants at the top
- Run a subset by setting the `E2E_FILTER` environment variable (e.g. `E2E_FILTER=overtime node scripts/run-e2e.mjs`)

## Troubleshooting

- **401 on all requests**: Check that the test accounts exist and passwords match. Re-run the seed scripts if needed.
- **Connection refused**: Make sure the server is running on the expected port.
- **Foreign key errors on leave requests**: The leave type IDs or region IDs in the test may not match your DB. The script auto-discovers these from the API, but if the DB is empty you'll need to seed first.
