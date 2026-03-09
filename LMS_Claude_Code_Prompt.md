# Bloom & Grow Leave Management System — Claude Code Development Prompt

Copy and paste this entire prompt into Claude Code to begin development.

---

## PROMPT START — COPY EVERYTHING BELOW THIS LINE

---

You are building a **Leave Management System (LMS)** for **Bloom & Grow Group**, a premium baby and parenting brand distributor operating across Hong Kong, Singapore, Malaysia, Indonesia, China, Australia, and New Zealand. This system replaces their current Calamari subscription and will also absorb the existing CompLeaveBot (currently handling overtime compensation on Replit) into a unified leave and absence management platform.

Read the CLAUDE.md file in this project root for the full technical specification including tech stack, database schema, API design, folder structure, and milestone breakdown. Treat CLAUDE.md as the source of truth for architecture decisions.

---

## BRANDING

This is an internal tool for Bloom & Grow staff. Pull branding from **bloomandgrowgroup.com**. The brand identity uses:

- **Primary colour**: Warm coral/orange (#EE6331 or similar — sample from their site)
- **Secondary colour**: Deep navy/dark charcoal for text and contrast
- **Accent**: Soft warm tones, clean whites, and light greys for backgrounds
- **Logo**: The Bloom & Grow logo should be placed in the sidebar. Download or reference from `https://bloomandgrowgroup.com/wp-content/uploads/2025/07/BloomGrow_Logo_2025-1110x740.png`
- **Typography**: Clean, modern sans-serif. Use the font from shadcn/ui defaults (Geist) or a similar clean typeface
- **Aesthetic**: Professional, warm, approachable — not cold corporate. This is a company that works with baby and family brands, so the UI should feel friendly and human while still being clean and functional
- **Status colours**: Use standard conventions — green for approved, amber/yellow for pending, red for rejected, grey for cancelled
- **Region colour coding**: Assign a distinct but harmonious colour to each of the 7 regions for easy visual identification on calendars and reports

Apply this branding to the shadcn/ui theme via CSS variables so it's consistent across all components.

---

## DEVELOPMENT ORDER

Build this project in strict sequential order. Complete each phase fully before moving to the next. After each phase, confirm what was built and ask if I want to review before continuing.

### Phase 1: Project Scaffold & Configuration
1. Initialise the monorepo structure with `/client` and `/server` directories
2. Set up the React + TypeScript + Vite frontend in `/client`
3. Set up the Node.js + Express + TypeScript backend in `/server`
4. Install and configure Tailwind CSS v4
5. Install and configure shadcn/ui with Bloom & Grow brand theme (colours, typography, border radius)
6. Set up the shared types directory at `/shared`
7. Create `.env.example` with all required environment variables
8. Create `.gitignore` (node_modules, .env, dist, drizzle meta)
9. Set up ESLint and Prettier for consistent code formatting
10. Create a basic dev script that runs both client and server concurrently

### Phase 2: Database & Authentication
1. Set up Drizzle ORM with Neon PostgreSQL connection using the neon-serverless driver
2. Create the complete database schema in `server/src/db/schema.ts`:
   - Use identity columns (2025 PostgreSQL standard, not serial)
   - Create reusable timestamp patterns (createdAt, updatedAt, deletedAt)
   - Define all tables: regions, departments, users, leave_types, leave_policies, leave_balances, leave_requests, approval_workflows, public_holidays, notifications, audit_log
   - Use PostgreSQL enums for status fields
   - Add proper indexes on frequently queried columns
   - Define Drizzle relations between all tables
3. Generate Zod schemas from Drizzle tables using drizzle-zod for shared validation
4. Create seed data: all 7 regions with timezones, common leave types per region, public holidays for 2026
5. Set up JWT authentication (login, register, refresh token rotation)
6. Implement role-based access control middleware (Employee, Manager, HR Admin, Super Admin)
7. Create the user management API (CRUD)

### Phase 3: Core Leave Management
1. Leave request API — create, read, update, cancel with full validation:
   - Balance checks before submission
   - Overlap detection (no duplicate dates)
   - Weekend and public holiday exclusion from day count
   - Attachment upload support via Cloudinary for medical certificates
2. Multi-level approval workflow engine:
   - Configurable approval chains (direct manager → HR → auto-approve based on policy)
   - Approve/reject with comments
   - Delegation support (when a manager is on leave)
   - Auto-escalation after configurable SLA period
3. Leave balance tracking:
   - Real-time balance calculations
   - Accrual rules (monthly/annual)
   - Carry-over policies with limits
   - Pro-rata calculations for new starters
   - Year-end rollover logic
   - Adjustment entries (manual corrections by HR)
4. Leave policy engine:
   - Region-specific leave types and entitlements
   - Configurable rules per leave type per region
   - Probation period handling

### Phase 4: Frontend — Dashboard & Leave Pages
1. Create the app layout:
   - Collapsible sidebar with Bloom & Grow logo, navigation sections, user avatar
   - Top header bar with notifications bell, search (Cmd+K), user menu
   - Responsive — works on desktop and tablet
2. Dashboard page:
   - Summary cards: remaining leave balance by type, pending requests, upcoming leave
   - Quick action buttons: "Request Leave", "View Calendar"
   - Recent activity feed
   - Team absence snapshot (next 7 days)
3. My Leave page:
   - Leave balances displayed as progress bars by type
   - Leave request form (modal/sheet) with date range picker, leave type selector, reason field, file upload
   - Leave history table with filters (status, date range, type) using TanStack Table
   - Cancel pending requests
4. Approvals page (Manager/HR view):
   - Pending requests list with employee details, dates, leave type, balance impact
   - Bulk approve/reject
   - Approval history tab
5. Team Calendar page:
   - Month and week views
   - Colour-coded by leave type and region
   - Filter by department, region, team
   - Public holidays highlighted
   - Conflict indicators when multiple team members are off

### Phase 5: Slack Bot Integration (CompLeaveBot)
1. Set up Slack Bolt SDK with Socket Mode for development
2. Register slash commands:
   - `/leave apply` — opens a modal with leave type, dates, reason
   - `/leave balance` — shows current balances in a formatted message
   - `/leave upcoming` — shows upcoming team absences
   - `/leave cancel [id]` — cancel a pending request
   - `/leave status` — check status of recent requests
3. Interactive components:
   - Approval buttons (Approve ✅ / Reject ❌) sent to managers via DM
   - Modal forms for leave requests with date pickers and dropdowns
   - Confirmation dialogs before submission
4. Notification system:
   - In-app notification centre (bell icon → dropdown with unread count)
   - Slack DM notifications: new request → manager, approval/rejection → employee
   - Daily pending approval reminders (9am in each region's timezone)
   - Weekly team absence digest (Monday 9am to team channels)
   - Rich formatted messages with Block Kit (employee photo, leave details, action buttons, calendar link)
5. Migrate existing overtime compensation logic from the Replit CompLeaveBot into this system

### Phase 6: Reports, Calendar Sync & Polish
1. HR Reporting dashboard:
   - Leave utilisation by department and region (bar charts)
   - Trend analysis — leave patterns over months (line charts)
   - Top leave types breakdown (pie/donut chart)
   - Headcount vs absence rates
   - Use Recharts for all data visualisation
2. Export functionality:
   - Payroll CSV export (configurable date range, region filter)
   - PDF report generation for management summaries
3. Google Calendar sync:
   - Approved leave automatically creates calendar events
   - Team shared calendar for department-level visibility
   - Cancelled leave removes calendar events
4. Data migration:
   - Import tool for Calamari data (CSV upload → parse → validate → insert)
   - Map existing leave balances, history, and employee records
5. Final polish:
   - Loading skeletons for all data views
   - Empty states with helpful illustrations/messages
   - Error boundaries with user-friendly fallbacks
   - Toast notifications for all actions (success/error)
   - Keyboard shortcuts (Cmd+K search, Escape to close modals)
   - Mobile-responsive refinements
   - Performance audit (lazy loading, code splitting)

---

## CODE QUALITY STANDARDS

Follow these standards throughout all development:

- **TypeScript strict mode** enabled in both client and server tsconfig
- **All API inputs validated with Zod** — never trust client data
- **Drizzle-zod** for generating validation schemas from database schema — single source of truth
- **Consistent error handling**: Express error middleware with typed error responses, React error boundaries
- **API responses** follow a consistent shape: `{ success: boolean, data?: T, error?: string }`
- **Environment variables** validated at startup with Zod — fail fast if misconfigured
- **No `any` types** — use `unknown` and narrow with type guards if needed
- **Meaningful commit messages** — prefix with phase (e.g., "Phase 1: scaffold project structure")
- **Comments only where logic is non-obvious** — the code should be self-documenting through clear naming
- **Separation of concerns**: routes handle HTTP, services handle business logic, db layer handles queries

---

## UI/UX STANDARDS

- Use **shadcn/ui components** for all UI elements — do not build custom components when shadcn has one
- All interactive elements must have **loading states** (skeleton or spinner)
- All data views must have **empty states** with helpful messaging
- All destructive actions require **confirmation dialogs**
- Forms show **inline validation errors** immediately, not just on submit
- Tables support **sorting, filtering, and pagination** via TanStack Table
- Use **optimistic updates** with TanStack Query for approve/reject actions
- Animations should be **subtle and purposeful** — no gratuitous motion
- **Accessibility**: all interactive elements keyboard-navigable, proper ARIA labels, focus management on modals
- Sidebar should **remember collapsed/expanded state** across page navigations

---

## FILE NAMING CONVENTIONS

- React components: `PascalCase.tsx` (e.g., `LeaveRequestForm.tsx`)
- Hooks: `camelCase.ts` with `use` prefix (e.g., `useLeaveBalance.ts`)
- Utilities: `camelCase.ts` (e.g., `calculateWorkingDays.ts`)
- API routes: `camelCase.ts` (e.g., `leaveRequests.ts`)
- Database schema: `schema.ts` (single file with all tables)
- Types: `camelCase.ts` (e.g., `leaveTypes.ts`)
- Test files: `*.test.ts` alongside the file they test

---

## IMPORTANT NOTES

- This is the first project off Replit for JD CoreDev, being built with Claude Code + VS Code + Git + Railway
- The existing CompLeaveBot on Replit handles overtime compensation — that logic needs to be migrated into this project
- The client is Bloom & Grow Group, a premium brand distributor across APAC — the tool should feel polished and professional
- 7 regions: Hong Kong (HK), Singapore (SG), Malaysia (MY), Indonesia (ID), China (CN), Australia (AU), New Zealand (NZ) — each with distinct leave policies, public holidays, and timezones
- 4 user roles: Employee, Manager, HR Admin, Super Admin — with escalating permissions
- This system must handle regional date formats, timezone-aware scheduling for Slack notifications, and multi-currency awareness for payroll exports

Begin with Phase 1. After completing each phase, pause and confirm what was built so I can review before we proceed to the next phase.
