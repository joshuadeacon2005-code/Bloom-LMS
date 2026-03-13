# Bloom & Grow Leave Management System (LMS)

## Project Overview
Custom Leave Management System for Bloom & Grow Group, replacing their Calamari subscription ($2,000/year). Built by JD CoreDev. Web dashboard with deep Slack integration via the existing CompLeaveBot.

## Tech Stack

### Frontend
- **React 19** + **TypeScript** + **Vite** (fast dev server, HMR)
- **Tailwind CSS v4** for utility-first styling
- **shadcn/ui** for component library (built on Radix UI — accessible, customisable, no lock-in)
- **Lucide React** for icons (ships with shadcn/ui)
- **TanStack Query** (React Query) for server state management
- **Zustand** for lightweight global state (auth, UI state)
- **React Hook Form** + **Zod** for type-safe form validation
- **date-fns** for date manipulation (leave calculations, calendars)
- **React Router v7** for routing

### Backend
- **Node.js** + **Express** + **TypeScript**
- **Drizzle ORM** with **Neon PostgreSQL** (serverless Postgres)
- **Slack Bolt SDK** (@slack/bolt) for CompLeaveBot integration
- **Google Calendar API** for calendar sync
- **Cloudinary** for file storage (medical certificates, attachments)
- **node-cron** for scheduled jobs (reminders, digests, accrual calculations)
- **Zod** for API request validation (shared schemas with frontend via drizzle-zod)

### Infrastructure
- **Railway** for hosting (auto-deploy from GitHub)
- **Neon** for PostgreSQL database
- **GitHub** for version control

---

## Project Structure

```
bloom-lms/
├── client/                    # React frontend
│   ├── src/
│   │   ├── components/        # Reusable UI components
│   │   │   ├── ui/            # shadcn/ui components
│   │   │   ├── layout/        # Sidebar, Header, PageWrapper
│   │   │   ├── leave/         # Leave-specific components
│   │   │   ├── calendar/      # Calendar views
│   │   │   └── shared/        # Common components
│   │   ├── pages/             # Route pages
│   │   ├── hooks/             # Custom React hooks
│   │   ├── lib/               # Utilities, API client, constants
│   │   ├── stores/            # Zustand stores
│   │   ├── types/             # Shared TypeScript types
│   │   └── styles/            # Global styles, Tailwind config
│   ├── index.html
│   ├── vite.config.ts
│   └── tailwind.config.ts
├── server/                    # Express backend
│   ├── src/
│   │   ├── db/
│   │   │   ├── schema.ts      # Drizzle schema definitions
│   │   │   ├── index.ts       # DB connection
│   │   │   └── seed.ts        # Seed data (regions, leave types, holidays)
│   │   ├── routes/            # Express route handlers
│   │   ├── middleware/         # Auth, validation, error handling
│   │   ├── services/          # Business logic layer
│   │   ├── slack/             # Slack bot handlers (commands, actions, events)
│   │   ├── jobs/              # Cron jobs (reminders, digests, accruals)
│   │   └── utils/             # Helpers, constants
│   ├── drizzle.config.ts
│   └── tsconfig.json
├── shared/                    # Shared types and validation schemas
│   ├── types.ts
│   └── schemas.ts             # Zod schemas used by both client and server
├── drizzle/                   # Migration files (auto-generated)
├── .env.example
├── package.json
└── README.md
```

---

## Database Schema (Drizzle ORM + Neon PostgreSQL)

### Key Best Practices for Drizzle with Neon
- Use **identity columns** (not serial) — this is the 2025 PostgreSQL standard
- Use `drizzle-zod` to generate Zod schemas from your Drizzle tables for shared validation
- Use the **neon-serverless** driver for connection
- Use `drizzle-kit push` for rapid development, `drizzle-kit generate` + `migrate` for production
- Define reusable column patterns (timestamps, soft delete)

### Core Tables
```
regions           - id, name, code (HK, SG, MY, ID, CN, AU, NZ), timezone, currency
users             - id, email, name, slackUserId, role, regionId, managerId, departmentId, isActive
departments       - id, name, regionId
leave_types       - id, name, code, description, isPaid, requiresAttachment, maxDaysPerYear, regionId
leave_policies    - id, leaveTypeId, regionId, entitlementDays, carryOverMax, accrualRate, probationMonths
leave_balances    - id, userId, leaveTypeId, year, entitled, used, pending, carried, adjustments
leave_requests    - id, userId, leaveTypeId, startDate, endDate, totalDays, reason, status, attachmentUrl
approval_workflows- id, leaveRequestId, approverId, level, status, comments, actionDate
public_holidays   - id, name, date, regionId, isRecurring
notifications     - id, userId, type, title, message, isRead, metadata, createdAt
audit_log         - id, action, entityType, entityId, userId, changes, createdAt
```

### Schema Design Tips
- Status fields use PostgreSQL enums: `pending`, `approved`, `rejected`, `cancelled`
- All tables include `createdAt` and `updatedAt` timestamps
- Soft delete via `deletedAt` on user-facing tables
- Foreign keys with proper cascading
- Indexes on: userId, regionId, status, date ranges

---

## Core Features (by Milestone)

### Milestone 1 (Week 1-2): Foundation
- Database schema + migrations with Drizzle
- Express API skeleton with TypeScript
- JWT authentication (login, register, refresh tokens)
- Role-based access control (Employee, Manager, HR Admin, Super Admin)
- User management CRUD
- Region and department setup
- Seed data for all 7 regions, leave types, and public holidays

### Milestone 2 (Week 2-3): Leave Management Core
- Leave request creation with validation (balance checks, overlap detection, blackout dates)
- Multi-level approval workflow engine
- Leave balance tracking with accrual calculations
- Team absence calendar view (month/week views)
- Leave policy engine (region-specific rules)
- Dashboard with summary cards and quick actions

### Milestone 3 (Week 4-5): Slack + Calendar Integration
- CompLeaveBot setup with Slack Bolt SDK
- Slash commands: `/leave apply`, `/leave balance`, `/leave upcoming`
- Interactive approval buttons in Slack DMs
- Notification system (in-app + Slack DM)
- Daily/weekly digest messages to team channels
- Pending approval reminders
- Google Calendar sync (approved leave → calendar events)

### Milestone 4 (Week 5-6): Reporting + Polish
- HR reporting dashboard (utilisation, trends, department summaries)
- Payroll CSV export
- Data migration tool for Calamari import
- Comprehensive testing
- User documentation
- Production deployment + training

---

## UI/UX Design Guidelines

### Design Direction
- **Clean, professional SaaS dashboard** aesthetic — think modern HR tools
- Bloom & Grow brand colours as accents on a clean light theme
- Sidebar navigation with collapsible sections
- Responsive design — works on desktop and tablet

### shadcn/ui Components to Use
- **DataTable** (TanStack Table) for leave requests, employee lists, reports
- **Calendar** for team absence views
- **Dialog/Sheet** for leave request forms and detail views
- **Command** (Cmd+K) for quick navigation
- **Tabs** for dashboard sections
- **Badge** for status indicators (Pending = yellow, Approved = green, Rejected = red)
- **Card** for dashboard summary widgets
- **Toast** for action confirmations
- **Form** components with React Hook Form integration

### Key Pages
1. **Dashboard** — summary cards (balance, pending requests, upcoming leave), quick actions
2. **My Leave** — personal leave history, balances by type, request form
3. **Team Calendar** — visual calendar of team absences
4. **Approvals** — pending requests for managers, bulk actions
5. **Reports** — HR analytics, charts, export functionality
6. **Admin** — user management, policy configuration, holiday management
7. **Settings** — profile, notification preferences

---

## Slack Bot (CompLeaveBot) Architecture

### Setup
- Use **Socket Mode** for development (no public URL needed)
- Switch to **HTTP mode** for production on Railway
- Store tokens in environment variables: `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_APP_TOKEN`

### Slash Commands
```
/leave apply       → Opens a modal to submit a leave request
/leave balance     → Shows current leave balances
/leave upcoming    → Shows upcoming approved leave for your team
/leave cancel [id] → Cancel a pending leave request
/leave status      → Check status of your recent requests
```

### Interactive Actions
- Approval buttons (Approve/Reject) in manager DMs
- Modal forms for leave requests with date pickers
- Dropdown menus for leave type selection

### Notifications (via DM)
- New leave request submitted → notify manager
- Request approved/rejected → notify employee
- Pending approval reminders (daily at 9am)
- Weekly team absence digest (Monday morning)

---

## API Design

### RESTful Endpoints
```
Auth:
  POST   /api/auth/login
  POST   /api/auth/register
  POST   /api/auth/refresh

Leave Requests:
  GET    /api/leave/requests          (with filters: status, dateRange, userId)
  POST   /api/leave/requests
  GET    /api/leave/requests/:id
  PATCH  /api/leave/requests/:id
  DELETE /api/leave/requests/:id

Approvals:
  GET    /api/approvals/pending
  POST   /api/approvals/:requestId/approve
  POST   /api/approvals/:requestId/reject

Balances:
  GET    /api/leave/balances           (current user)
  GET    /api/leave/balances/:userId   (HR/Admin)

Calendar:
  GET    /api/calendar/team            (team absence view)
  GET    /api/calendar/holidays/:regionId

Reports:
  GET    /api/reports/utilisation
  GET    /api/reports/department-summary
  GET    /api/reports/export/payroll

Users:
  GET    /api/users
  POST   /api/users
  PATCH  /api/users/:id
  GET    /api/users/me

Admin:
  GET    /api/admin/regions
  GET    /api/admin/leave-types
  CRUD   /api/admin/policies
  CRUD   /api/admin/holidays
```

---

## Environment Variables (.env)

```env
# Database
DATABASE_URL=postgresql://user:pass@host.neon.tech/bloom_lms?sslmode=require

# Auth
JWT_SECRET=your-secret-key
JWT_REFRESH_SECRET=your-refresh-secret

# Slack
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
SLACK_APP_TOKEN=xapp-...

# Google Calendar
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=...

# Cloudinary
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...

# App
NODE_ENV=development
PORT=3001
CLIENT_URL=http://localhost:5173
```

---

## Development Workflow

1. **Start frontend**: `cd client && npm run dev` (Vite on port 5173)
2. **Start backend**: `cd server && npm run dev` (Express on port 3001 with tsx watch)
3. **Database changes**: Edit `server/src/db/schema.ts` → run `npx drizzle-kit push`
4. **View database**: `npx drizzle-kit studio`
5. **Git workflow**: Feature branches → PR → merge to main → auto-deploy to Railway

---


## Quality Checklist
- [ ] TypeScript strict mode enabled across all packages
- [ ] All API inputs validated with Zod
- [ ] Error boundaries on frontend
- [ ] Loading and empty states for all data views
- [ ] Responsive layout tested on desktop and tablet
- [ ] Accessibility: keyboard navigation, ARIA labels, focus management
- [ ] API rate limiting and security headers
- [ ] Environment variables properly configured
- [ ] Database migrations tracked and versioned
