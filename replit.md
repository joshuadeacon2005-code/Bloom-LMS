# Bloom & Grow Leave Management System (LMS)

## Overview
Custom Leave Management System for Bloom & Grow Group, replacing their Calamari subscription. Web dashboard with Slack integration via CompLeaveBot.

## Tech Stack
- **Frontend**: React 19 + TypeScript + Vite + Tailwind CSS v4 + shadcn/ui
- **Backend**: Node.js + Express + TypeScript
- **Database**: Replit PostgreSQL with Drizzle ORM
- **State Management**: TanStack Query (server state), Zustand (client state)
- **Forms**: React Hook Form + Zod validation

## Project Structure
```
bloom-lms/
├── client/          # React frontend (Vite, port 5000 in dev)
├── server/          # Express backend (port 3001)
├── shared/          # Shared types and Zod schemas
└── drizzle/         # Migration files
```

## Development
- `npm run dev` — runs both client (Vite on port 5000) and server (Express on port 3001) concurrently
- Vite proxies `/api` requests to the Express server
- Database schema changes: edit `server/src/db/schema.ts` then run `cd server && npx drizzle-kit push`
- Seed data: `cd server && npx tsx src/db/seed.ts`

## Database
- Uses Replit's built-in PostgreSQL (via `pg` + `drizzle-orm/node-postgres`)
- Schema defined in `server/src/db/schema.ts` with identity columns
- Seeded with: 7 regions (HK, SG, MY, ID, CN, AU, NZ), departments, leave types, leave policies, 2026 public holidays
- Default admin account is seeded on first run (see seed.ts for details)
- 95 employees from Calamari export are seeded via `server/src/db/seed-employees.ts` (runs on server startup, skips if ≥90 employees already exist)
- Default password for imported employees: `Welcome2026!`
- 876 leave balance records (2026 entitlements) seeded via `server/src/db/seed-entitlements.ts` — includes 15 additional leave types from Calamari
- 529 historical leave requests + 458 approval workflows seeded via `server/src/db/seed-requests.ts` — imported from Calamari requests export

## Environment Variables
- `DATABASE_URL` — managed by Replit
- `JWT_SECRET` / `JWT_REFRESH_SECRET` — auto-generated, stored as env vars
- `NODE_ENV` — development
- `PORT` — 3001 (Express server)
- `CLIENT_URL` — Replit dev domain
- Slack, Google, Cloudinary credentials — optional, for feature-specific functionality

## Build & Deployment
- Server build uses `esbuild` (via `server/build.mjs`) to bundle TypeScript into a single `dist/index.js` file
- This avoids Node.js ESM extension resolution issues that occur with plain `tsc` output
- Production deployment: `node server/dist/index.js` (autoscale target)
- Build command: `npm run build` (builds client then server)

## Entitlement & Tiers System
- Each region has a **default entitlement** per leave type (via `leave_policies.entitlement_days`)
- **Custom tiers** allow specific staff to receive more or fewer days than the regional default
- Tiers are managed inside the Policy dialog (Admin > Policies > click Edit on any policy)
- The Entitlements tab shows the "Region Default" alongside each user's entitled days
- Color-coded comparison: green = more than default, orange = less than default

## Region Restriction System
- Leave types have a `regionRestriction` field (comma-separated region codes like "HK,SG,CN-GZ")
- If `regionRestriction` is NULL, the leave type is available to all regions
- The Policies and Leave Types admin endpoints filter using both the legacy `regionId` field and the `regionRestriction` codes
- When creating a new leave type, the Legacy Region defaults to "Select region" (none selected) and all region restriction checkboxes default to unchecked
- Available region codes: HK, SG, MY, ID, CN-GZ, CN-SH, AU, NZ, UK

## Admin User Credentials
- Super admin: josh@bloomandgrowgroup.com / C00k1eD0g
- Default employee password: Welcome2026!

## Leave Type Features
- Each leave type has a `unit` field (days/hours) — editable in the leave type form
- Minimum booking unit options: 1 day, half day, 2 hours, 1 hour
- Unit column visible in the Leave Types admin table

## Public Holidays
- Holidays can be created with a date range (start date + optional end date)
- One entry is created per day in the range, with duplicate detection (skips existing)
- China (CN) holidays are auto-created for both CN-GZ and CN-SH regions

## Leave Request Attachments
- File upload (JPG, PNG, PDF, max 5MB) available on leave request form via Cloudinary
- Upload route: POST /api/leave/upload
- Attachment links shown in MyLeave history and admin employee history views

## NetSuite Integration
- Expense reports sync to NetSuite via REST API after approval
- Uses Token-Based Authentication (TBA) with OAuth1 HMAC-SHA256 signing
- Secrets: NS_ACCOUNT_ID, NS_TOKEN_ID, NS_TOKEN_SECRET, NS_CONSUMER_KEY, NS_CONSUMER_SECRET
- Endpoint: POST https://{account}.suitetalk.api.netsuite.com/services/rest/record/v1/expenseReport
- Auto-retries up to 3 attempts with exponential backoff on failure
- MOCK_EXTERNAL env var can be set to 'true' in development to skip real API calls

## Key Decisions
- Switched from Neon serverless driver to standard `pg` pool for Replit's built-in PostgreSQL
- Vite dev server runs on port 5000 (required for Replit webview)
- CORS configured to accept Replit preview domains (*.replit.dev, *.repl.co)
- Server build uses esbuild instead of tsc to avoid ESM module resolution issues in production
