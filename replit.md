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

## Key Decisions
- Switched from Neon serverless driver to standard `pg` pool for Replit's built-in PostgreSQL
- Vite dev server runs on port 5000 (required for Replit webview)
- CORS configured to accept Replit preview domains (*.replit.dev, *.repl.co)
- Server build uses esbuild instead of tsc to avoid ESM module resolution issues in production
