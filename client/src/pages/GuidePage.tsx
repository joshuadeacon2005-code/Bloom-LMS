import { useState, useEffect, useRef } from 'react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Search, BookOpen, CheckCircle, AlertCircle, Users, Shield } from 'lucide-react'
import { cn } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

type Role = 'employee' | 'manager' | 'hr_admin'

interface Section {
  id: string
  title: string
  roles: Role[]
}

// ─── Table of Contents ────────────────────────────────────────────────────────

const SECTIONS: Section[] = [
  { id: 'getting-started', title: '1. Getting Started', roles: ['employee', 'manager', 'hr_admin'] },
  { id: 'balances', title: '2. Your Leave Balances', roles: ['employee', 'manager', 'hr_admin'] },
  { id: 'requesting-leave', title: '3. Requesting Leave — By Type', roles: ['employee', 'manager', 'hr_admin'] },
  { id: 'comp-leave', title: '4. Compensation Leave — Earning & Using', roles: ['employee', 'manager', 'hr_admin'] },
  { id: 'approval-flows', title: '5. Approval Flows', roles: ['employee', 'manager', 'hr_admin'] },
  { id: 'slack-commands', title: '6. Slack Commands', roles: ['employee', 'manager', 'hr_admin'] },
  { id: 'for-managers', title: '7. For Managers', roles: ['manager', 'hr_admin'] },
  { id: 'for-hr', title: '8. For HR Admins', roles: ['hr_admin'] },
  { id: 'faq', title: '9. FAQ & Troubleshooting', roles: ['employee', 'manager', 'hr_admin'] },
]

// ─── Flow Diagram ─────────────────────────────────────────────────────────────

function FlowStep({ label, sub }: { label: string; sub?: string }) {
  return (
    <div className="flex flex-col items-center">
      <div className="rounded-lg border-2 border-primary/30 bg-primary/5 px-4 py-2 text-sm font-medium text-center min-w-[120px]">
        {label}
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

function FlowArrow({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center mx-1">
      <div className="text-primary text-lg">→</div>
      {label && <div className="text-xs text-muted-foreground -mt-1">{label}</div>}
    </div>
  )
}

function ApprovalFlowDiagram({ flow }: { flow: 'standard' | 'auto_approve' | 'hr_required' | 'multi_level' }) {
  if (flow === 'standard') {
    return (
      <div className="space-y-3">
        <div className="flex items-center flex-wrap gap-1">
          <FlowStep label="Employee" sub="Submits" />
          <FlowArrow label="notifies" />
          <FlowStep label="Manager" sub="Reviews" />
          <FlowArrow label="approves" />
          <FlowStep label="✅ Approved" />
        </div>
        <div className="flex items-center flex-wrap gap-1">
          <FlowStep label="Employee" sub="Submits" />
          <FlowArrow />
          <FlowStep label="Manager" sub="Reviews" />
          <FlowArrow label="rejects" />
          <FlowStep label="❌ Rejected" />
        </div>
        <p className="text-xs text-muted-foreground">
          No response after 48h → reminder sent. After 72h → escalated to HR admin.
        </p>
      </div>
    )
  }
  if (flow === 'auto_approve') {
    return (
      <div className="space-y-3">
        <div className="flex items-center flex-wrap gap-1">
          <FlowStep label="Employee" sub="Submits" />
          <FlowArrow label="instant" />
          <FlowStep label="✅ Auto-Approved" />
          <FlowArrow label="FYI only" />
          <FlowStep label="Manager" sub="Notified" />
        </div>
        <p className="text-xs text-muted-foreground">
          No approval buttons shown to manager. This is informational only.
        </p>
      </div>
    )
  }
  if (flow === 'hr_required') {
    return (
      <div className="space-y-3">
        <div className="flex items-center flex-wrap gap-1">
          <FlowStep label="Employee" sub="Step 0" />
          <FlowArrow />
          <FlowStep label="Manager" sub="Step 1" />
          <FlowArrow label="approves" />
          <FlowStep label="HR Admin" sub="Step 2" />
          <FlowArrow label="approves" />
          <FlowStep label="✅ Approved" />
        </div>
        <div className="flex items-center flex-wrap gap-1">
          <FlowStep label="Employee" sub="Step 0" />
          <FlowArrow />
          <FlowStep label="Manager" sub="Step 1" />
          <FlowArrow label="rejects" />
          <FlowStep label="❌ Rejected" />
          <span className="text-xs text-muted-foreground ml-2">(HR not involved)</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Status shows "Pending (Manager)" at step 1, "Pending (HR)" at step 2.
        </p>
      </div>
    )
  }
  // multi_level
  return (
    <div className="space-y-3">
      <div className="flex items-center flex-wrap gap-1">
        <FlowStep label="Employee" sub="Submits" />
        <FlowArrow />
        <FlowStep label="Manager" sub="Step 1" />
        <FlowArrow label="approves" />
        <FlowStep label="HR Admin" sub="Step 2" />
        <FlowArrow label="approves" />
        <FlowStep label="✅ Approved" />
      </div>
      <p className="text-xs text-muted-foreground">
        Steps are configurable per department. Default: manager → HR admin. Any step rejection ends the process.
      </p>
    </div>
  )
}

// ─── Command Reference ────────────────────────────────────────────────────────

const SLACK_COMMANDS = [
  { command: '/bloom-leave request', desc: 'Open the leave request form', who: 'All' },
  { command: '/bloom-leave balance', desc: 'View your current leave balances', who: 'All' },
  { command: '/comp-leave', desc: 'Submit a compensation leave request (earn comp/TIL)', who: 'All' },
  { command: '/bloom-leave status', desc: 'See recent requests and their current status', who: 'All' },
  { command: '/bloom-leave cancel [id]', desc: 'Cancel a pending request', who: 'All' },
  { command: '/bloom-leave team', desc: 'See who is in/out on your team today', who: 'All' },
  { command: '/bloom-leave approve', desc: 'View and action pending approvals', who: 'Managers' },
  { command: '/bloom-leave holidays', desc: 'View upcoming public holidays for your region', who: 'All' },
  { command: '/bloom-leave help', desc: 'Show all available commands', who: 'All' },
]

// ─── Leave Types Reference ─────────────────────────────────────────────────────

const LEAVE_TYPES = [
  {
    name: 'Annual Leave',
    code: 'AL',
    color: '#4CAF50',
    flow: 'standard' as const,
    notice: '3 days',
    attachment: 'Not required',
    maxDays: null,
    desc: 'Paid annual leave entitlement. Available from your first day (subject to regional probation rules).',
    slackCmd: '/bloom-leave request → select Annual Leave',
  },
  {
    name: 'Sick Leave',
    code: 'SL',
    color: '#F44336',
    flow: 'standard' as const,
    notice: 'None',
    attachment: 'Medical certificate required for 2+ consecutive days',
    maxDays: null,
    desc: 'For illness or injury. Submit as early as possible, ideally before your shift starts.',
    slackCmd: '/bloom-leave request → select Sick Leave',
  },
  {
    name: 'Compensatory Leave',
    code: 'COMP_LEAVE',
    color: '#FF9800',
    flow: 'standard' as const,
    notice: 'None',
    attachment: 'Not required',
    maxDays: null,
    desc: 'Use comp leave earned from overtime/weekend/public holiday work. Non-AU/NZ only. See Section 4 for how to earn it.',
    slackCmd: '/bloom-leave request → select Compensatory Leave',
    auNote: 'AU/NZ employees use Time In Lieu (TIL) instead.',
  },
  {
    name: 'Time In Lieu (TIL)',
    code: 'TIL',
    color: '#FF9800',
    flow: 'standard' as const,
    notice: 'None',
    attachment: 'Not required',
    maxDays: null,
    desc: 'AU/NZ only. Time In Lieu earned from overtime or weekend/public holiday work. See Section 4 for how to earn TIL.',
    slackCmd: '/bloom-leave request → select Time In Lieu',
    auOnly: true,
  },
  {
    name: 'Work From Home',
    code: 'WFH',
    color: '#2196F3',
    flow: 'auto_approve' as const,
    notice: 'None',
    attachment: 'Not required',
    maxDays: null,
    desc: 'Log a work-from-home day. Auto-approved instantly — no manager action required. Manager receives an FYI notification only. No balance is deducted.',
    slackCmd: '/bloom-leave request → select Work From Home',
  },
  {
    name: 'Maternity Leave',
    code: 'ML',
    color: '#E91E63',
    flow: 'hr_required' as const,
    notice: 'As early as possible',
    attachment: 'Required (e.g. doctor letter, birth certificate)',
    maxDays: null,
    desc: 'Paid leave for the primary caregiver after birth or adoption. Entitlement varies by region (60–365 days). Requires both manager AND HR approval.',
    slackCmd: '/bloom-leave request → select Maternity Leave',
  },
  {
    name: 'Paternity Leave',
    code: 'PL',
    color: '#9C27B0',
    flow: 'hr_required' as const,
    notice: 'As early as possible',
    attachment: 'Supporting document recommended',
    maxDays: null,
    desc: 'Paid leave for the secondary caregiver after birth or adoption. Entitlement varies by region (2–14 days). Requires both manager AND HR approval.',
    slackCmd: '/bloom-leave request → select Paternity Leave',
  },
  {
    name: 'Compassionate Leave',
    code: 'CL',
    color: '#795548',
    flow: 'standard' as const,
    notice: 'None (emergency)',
    attachment: 'Not required (but may be requested)',
    maxDays: 5,
    desc: 'For bereavement or serious illness of an immediate family member. Maximum 5 consecutive days. Contact HR if you need more time.',
    slackCmd: '/bloom-leave request → select Compassionate Leave',
  },
  {
    name: 'Unpaid Leave',
    code: 'UL',
    color: '#607D8B',
    flow: 'multi_level' as const,
    notice: 'As much notice as possible',
    attachment: 'Not required',
    maxDays: null,
    desc: 'Leave without pay. Requires approval from your manager AND HR admin. Plan ahead — this goes through multi-level approval.',
    slackCmd: '/bloom-leave request → select Unpaid Leave',
  },
]

// ─── Main Component ────────────────────────────────────────────────────────────

export function GuidePage() {
  const [search, setSearch] = useState('')
  const [activeRole, setActiveRole] = useState<Role | 'all'>('all')
  const [activeSection, setActiveSection] = useState('')
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({})

  // Scrollspy
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id)
          }
        }
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0 }
    )

    Object.values(sectionRefs.current).forEach((el) => {
      if (el) observer.observe(el)
    })

    return () => observer.disconnect()
  }, [])

  const filteredSections = SECTIONS.filter((s) => {
    if (activeRole !== 'all' && !s.roles.includes(activeRole)) return false
    if (search) {
      return s.title.toLowerCase().includes(search.toLowerCase())
    }
    return true
  })

  const scrollTo = (id: string) => {
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const flowBadge = (flow: string) => {
    const map: Record<string, { label: string; className: string }> = {
      standard: { label: 'Standard', className: 'bg-blue-100 text-blue-800' },
      auto_approve: { label: 'Auto-Approve', className: 'bg-green-100 text-green-800' },
      hr_required: { label: 'HR Required', className: 'bg-orange-100 text-orange-800' },
      multi_level: { label: 'Multi-Level', className: 'bg-purple-100 text-purple-800' },
    }
    const cfg = map[flow] ?? { label: flow, className: 'bg-gray-100 text-gray-600' }
    return <Badge className={cn('text-xs font-medium border-0', cfg.className)}>{cfg.label}</Badge>
  }

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar ToC */}
      <aside className="hidden lg:flex w-64 flex-col shrink-0 sticky top-0 h-screen border-r overflow-y-auto p-4 gap-2">
        <div className="flex items-center gap-2 mb-2">
          <BookOpen className="h-4 w-4 text-primary" />
          <span className="font-semibold text-sm">User Guide</span>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-7 h-8 text-xs"
          />
        </div>

        {/* Role filter */}
        <div className="flex flex-wrap gap-1 my-1">
          {(['all', 'employee', 'manager', 'hr_admin'] as const).map((r) => (
            <button
              key={r}
              onClick={() => setActiveRole(r)}
              className={cn(
                'text-xs px-2 py-0.5 rounded-full border transition-colors',
                activeRole === r
                  ? 'bg-primary text-white border-primary'
                  : 'border-border text-muted-foreground hover:border-primary hover:text-primary'
              )}
            >
              {r === 'all' ? 'All' : r === 'hr_admin' ? 'HR Admin' : r.charAt(0).toUpperCase() + r.slice(1)}
            </button>
          ))}
        </div>

        {/* Nav links */}
        <nav className="space-y-0.5 mt-1">
          {filteredSections.map((s) => (
            <button
              key={s.id}
              onClick={() => scrollTo(s.id)}
              className={cn(
                'w-full text-left text-xs px-2 py-1.5 rounded-md transition-colors',
                activeSection === s.id
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              )}
            >
              {s.title}
            </button>
          ))}
        </nav>
      </aside>

      {/* Main content */}
      <main className="flex-1 max-w-3xl mx-auto p-6 space-y-12">
        {/* Header */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <BookOpen className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold">Bloom & Grow LMS — User Guide</h1>
          </div>
          <p className="text-muted-foreground text-sm">
            Complete guide to the Leave Management System — web dashboard and Slack integration.
          </p>
          {/* Mobile role filter */}
          <div className="flex flex-wrap gap-1 lg:hidden">
            {(['all', 'employee', 'manager', 'hr_admin'] as const).map((r) => (
              <button
                key={r}
                onClick={() => setActiveRole(r)}
                className={cn(
                  'text-xs px-2 py-0.5 rounded-full border transition-colors',
                  activeRole === r
                    ? 'bg-primary text-white border-primary'
                    : 'border-border text-muted-foreground'
                )}
              >
                {r === 'all' ? 'All' : r === 'hr_admin' ? 'HR Admin' : r.charAt(0).toUpperCase() + r.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* ── Section 1: Getting Started ───────────────────────────────────────── */}
        <section
          id="getting-started"
          ref={(el) => { sectionRefs.current['getting-started'] = el }}
          className="space-y-4"
        >
          <h2 className="text-xl font-semibold border-b pb-2">1. Getting Started</h2>

          <div className="space-y-3">
            <h3 className="font-medium">Logging In</h3>
            <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
              <li>Go to the LMS web app URL (provided by your HR admin)</li>
              <li>Enter your work email and password</li>
              <li>Click <strong>Sign In</strong></li>
              <li>If you forget your password, contact HR admin to reset it</li>
            </ol>
          </div>

          <div className="space-y-3">
            <h3 className="font-medium">Linking Your Slack Account</h3>
            <p className="text-sm text-muted-foreground">
              Your Slack account is linked to your LMS profile automatically by HR admin using your work email. Once linked, you can use all <code>/bloom-leave</code> and <code>/comp-leave</code> Slack commands, and receive DM notifications for approvals.
            </p>
            <p className="text-sm text-muted-foreground">
              If Slack commands aren't working, contact your HR admin — they can sync your Slack connection from the Admin panel.
            </p>
          </div>

          <div className="space-y-3">
            <h3 className="font-medium">Web vs Slack — What Can You Do?</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="rounded-lg border p-3 space-y-2">
                <p className="text-sm font-medium">🌐 Web Dashboard</p>
                <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
                  <li>Full leave history with filters</li>
                  <li>Team calendar view</li>
                  <li>Balance breakdown by type</li>
                  <li>Compensation request history</li>
                  <li>Manager approval queue</li>
                  <li>HR reports & exports</li>
                  <li>Admin settings</li>
                </ul>
              </div>
              <div className="rounded-lg border p-3 space-y-2">
                <p className="text-sm font-medium">💬 Slack (CompLeaveBot)</p>
                <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
                  <li>Submit leave requests</li>
                  <li>Check your balances</li>
                  <li>Submit comp/TIL requests</li>
                  <li>Approve/reject (managers)</li>
                  <li>See who's out today</li>
                  <li>View holidays</li>
                  <li>Cancel pending requests</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="font-medium">Understanding Your Role</h3>
            <div className="space-y-2 text-sm">
              {[
                { role: 'Employee', icon: <Users className="h-4 w-4" />, desc: 'Submit and manage your own leave and comp requests. View team calendar.' },
                { role: 'Manager', icon: <CheckCircle className="h-4 w-4" />, desc: 'Everything employees can do, plus approve/reject team leave and comp requests.' },
                { role: 'HR Admin', icon: <Shield className="h-4 w-4" />, desc: 'Full system access: user management, policy configuration, reports, payroll export. Also the final approver for Maternity/Paternity leave.' },
                { role: 'Super Admin', icon: <Shield className="h-4 w-4" />, desc: 'All HR Admin capabilities plus leave type creation and system-wide settings.' },
              ].map((r) => (
                <div key={r.role} className="flex gap-2 items-start rounded-md border p-2">
                  <span className="text-primary mt-0.5">{r.icon}</span>
                  <div>
                    <p className="font-medium">{r.role}</p>
                    <p className="text-muted-foreground text-xs">{r.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Section 2: Balances ──────────────────────────────────────────────── */}
        <section
          id="balances"
          ref={(el) => { sectionRefs.current['balances'] = el }}
          className="space-y-4"
        >
          <h2 className="text-xl font-semibold border-b pb-2">2. Your Leave Balances</h2>

          <p className="text-sm text-muted-foreground">
            View your balances on the <strong>Dashboard</strong> (summary cards) or <strong>My Leave</strong> page (detailed breakdown). In Slack, use <code>/leave balance</code>.
          </p>

          <div className="rounded-lg border p-4 space-y-2">
            <p className="text-sm font-medium">Balance Components</p>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div><span className="text-muted-foreground">Entitled:</span> Your annual allocation for this leave type</div>
              <div><span className="text-muted-foreground">Carried over:</span> Unused days carried from last year (subject to regional limits)</div>
              <div><span className="text-muted-foreground">Adjustments:</span> Days added by your manager or HR (e.g. comp leave credits)</div>
              <div><span className="text-muted-foreground">Used:</span> Approved leave already taken</div>
              <div><span className="text-muted-foreground">Pending:</span> Submitted but not yet approved</div>
              <div><span className="text-muted-foreground">Available:</span> Entitled + Carried + Adjustments − Used − Pending</div>
            </div>
          </div>

          <div className="rounded-lg border p-4 space-y-2">
            <p className="text-sm font-medium">Compensatory Leave / TIL — How It Works Differently</p>
            <p className="text-sm text-muted-foreground">
              Unlike annual or sick leave (which start with a set entitlement), comp leave starts at <strong>0 days</strong>. Your balance grows as your comp/TIL requests are approved. The balance shown is:
            </p>
            <p className="text-sm font-mono bg-muted rounded px-2 py-1">
              Available = Adjustments (credits earned) − Used (comp leave taken)
            </p>
            <p className="text-sm text-muted-foreground">
              <strong>AU/NZ employees:</strong> Your TIL is earned in hours and converted to days (÷ 8) when credited. Your balance shows in days.
            </p>
          </div>

          <p className="text-sm text-muted-foreground">
            Balances reset on 1 January each year. Carry-over rules vary by region and leave type — check with HR or the Leave Policy section in the Admin panel.
          </p>
        </section>

        {/* ── Section 3: Requesting Leave ──────────────────────────────────────── */}
        <section
          id="requesting-leave"
          ref={(el) => { sectionRefs.current['requesting-leave'] = el }}
          className="space-y-4"
        >
          <h2 className="text-xl font-semibold border-b pb-2">3. Requesting Leave — By Type</h2>

          <p className="text-sm text-muted-foreground">
            All leave requests follow the same web flow: <strong>My Leave → Request Leave</strong>. The approval path depends on the leave type.
          </p>

          <Accordion type="multiple" className="space-y-2">
            {LEAVE_TYPES.map((lt) => (
              <AccordionItem key={lt.code} value={lt.code} className="border rounded-lg px-4">
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-3 w-3 rounded-full shrink-0"
                      style={{ backgroundColor: lt.color }}
                    />
                    <span className="font-medium">{lt.name}</span>
                    {flowBadge(lt.flow)}
                    {lt.auOnly && <Badge variant="outline" className="text-xs">AU/NZ Only</Badge>}
                  </div>
                </AccordionTrigger>
                <AccordionContent className="space-y-3 text-sm pb-4">
                  <p className="text-muted-foreground">{lt.desc}</p>

                  {lt.auNote && (
                    <div className="rounded bg-blue-50 border border-blue-200 p-2 text-xs text-blue-800">
                      {lt.auNote}
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div>
                      <p className="text-xs text-muted-foreground">Approval Flow</p>
                      <div className="mt-1">{flowBadge(lt.flow)}</div>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Notice Required</p>
                      <p className="font-medium">{lt.notice}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Attachment</p>
                      <p className="font-medium">{lt.attachment}</p>
                    </div>
                    {lt.maxDays && (
                      <div>
                        <p className="text-xs text-muted-foreground">Max Consecutive Days</p>
                        <p className="font-medium">{lt.maxDays} days</p>
                      </div>
                    )}
                  </div>

                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">How to request via web</p>
                    <ol className="list-decimal list-inside space-y-0.5 text-muted-foreground text-xs">
                      <li>Go to <strong>My Leave</strong> and click <strong>Request Leave</strong></li>
                      <li>Select <strong>{lt.name}</strong> as the leave type</li>
                      <li>Pick your start and end dates</li>
                      {lt.attachment !== 'Not required' && <li>Upload the required document</li>}
                      <li>Add an optional reason, then click <strong>Submit</strong></li>
                    </ol>
                  </div>

                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">How to request via Slack</p>
                    <p className="text-xs font-mono bg-muted px-2 py-1 rounded">{lt.slackCmd}</p>
                  </div>

                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Check status</p>
                    <p className="text-xs text-muted-foreground">Web: My Leave tab → request row shows status badge. Slack: <code>/leave status</code></p>
                  </div>

                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Cancel a request</p>
                    <p className="text-xs text-muted-foreground">Web: My Leave → click Cancel on a pending request. Slack: <code>/leave cancel [id]</code>. You can only cancel while status is Pending or Pending (HR).</p>
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </section>

        {/* ── Section 4: Comp Leave ────────────────────────────────────────────── */}
        <section
          id="comp-leave"
          ref={(el) => { sectionRefs.current['comp-leave'] = el }}
          className="space-y-4"
        >
          <h2 className="text-xl font-semibold border-b pb-2">4. Compensation Leave — Earning & Using</h2>

          <div className="rounded-lg border-2 border-orange-200 bg-orange-50 p-4 space-y-2">
            <p className="font-medium text-orange-900">Two separate actions — earning vs using</p>
            <p className="text-sm text-orange-800">
              Submitting a <strong>comp request</strong> (this section) earns you days. Using those days is a separate <strong>leave request</strong> via "Compensatory Leave" or "Time In Lieu" from the regular form.
            </p>
          </div>

          <div className="space-y-3">
            <h3 className="font-medium">Earning Comp Leave / TIL</h3>

            <div className="space-y-1">
              <p className="text-sm font-medium">What qualifies?</p>
              <ul className="text-sm text-muted-foreground list-disc list-inside space-y-0.5">
                <li>Working on a <strong>weekend</strong> (Saturday or Sunday)</li>
                <li>Working on a <strong>public holiday</strong> for your region</li>
                <li>Working overtime beyond standard hours on a weekday</li>
              </ul>
            </div>

            <div className="space-y-1">
              <p className="text-sm font-medium">How to submit via web</p>
              <ol className="text-sm text-muted-foreground list-decimal list-inside space-y-0.5">
                <li>Go to <strong>My Leave</strong> → click <strong>Request Comp Leave</strong></li>
                <li>Enter the date you worked (must be in the past)</li>
                <li>Enter hours worked — days are auto-calculated (8h = 1 day, 4h = 0.5 day)</li>
                <li>Adjust the days to credit if needed</li>
                <li>Add a reason (e.g. "Worked Saturday for product launch")</li>
                <li>Optionally attach evidence (email, screenshot, roster)</li>
                <li>Submit — your manager is notified via Slack DM and web notification</li>
              </ol>
            </div>

            <div className="space-y-1">
              <p className="text-sm font-medium">How to submit via Slack</p>
              <p className="text-sm font-mono bg-muted px-2 py-1 rounded">/comp-leave</p>
              <p className="text-sm text-muted-foreground">This opens a modal in Slack where you enter the worked date(s), times, reason, and quantity.</p>
              <p className="text-sm text-muted-foreground">
                <strong>AU/NZ:</strong> Enter hours worked (1–20 hrs). Compensation type is locked to Time In Lieu.<br />
                <strong>Other regions:</strong> Enter days requested (0.5–5 days). Choose Cash or Leave.
              </p>
            </div>

            <div className="space-y-1">
              <p className="text-sm font-medium">What evidence should I attach?</p>
              <p className="text-sm text-muted-foreground">A screenshot of your calendar, an email from your manager asking you to work, or a project brief. Not mandatory but strongly recommended.</p>
            </div>

            <div className="space-y-1">
              <p className="text-sm font-medium">Manager review — Adjust & Approve</p>
              <p className="text-sm text-muted-foreground">Your manager receives an approval request with Approve / Adjust & Approve / Reject options. If they choose Adjust & Approve, they can change the credited days (e.g. if you worked 6h they may approve 0.5 days instead of 1).</p>
              <p className="text-sm text-muted-foreground">On approval, the days are immediately credited to your Compensatory Leave (or TIL) balance.</p>
            </div>

            <div className="space-y-1">
              <p className="text-sm font-medium">Check your comp history</p>
              <p className="text-sm text-muted-foreground">Web: My Leave → Overtime/Comp tab. Slack: <code>/comp-leave</code> history view shows all requests and your current balance.</p>
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="font-medium">Using Comp Leave / TIL</h3>
            <p className="text-sm text-muted-foreground">
              When you want to take time off using your comp balance, just submit a regular leave request and select <strong>Compensatory Leave</strong> (or <strong>Time In Lieu</strong> for AU/NZ). This follows the Standard approval flow — your manager approves or rejects it like any other leave.
            </p>
            <p className="text-sm text-muted-foreground">
              Your available balance for comp leave = total credits earned − days already used.
            </p>
          </div>
        </section>

        {/* ── Section 5: Approval Flows ────────────────────────────────────────── */}
        <section
          id="approval-flows"
          ref={(el) => { sectionRefs.current['approval-flows'] = el }}
          className="space-y-4"
        >
          <h2 className="text-xl font-semibold border-b pb-2">5. Approval Flows</h2>

          <p className="text-sm text-muted-foreground">
            Different leave types follow different approval paths. The flow is determined by the leave type configuration (set by HR admin).
          </p>

          {([
            { flow: 'standard', title: 'Standard Flow', types: 'Annual Leave, Sick Leave, Comp Leave, Compassionate Leave, Marriage Leave' },
            { flow: 'auto_approve', title: 'Auto-Approve Flow', types: 'Work From Home' },
            { flow: 'hr_required', title: 'HR Required Flow', types: 'Maternity Leave, Paternity Leave' },
            { flow: 'multi_level', title: 'Multi-Level Flow', types: 'Unpaid Leave' },
          ] as const).map(({ flow, title, types }) => (
            <div key={flow} className="rounded-lg border p-4 space-y-3">
              <div className="flex items-center gap-2">
                <span className="font-medium">{title}</span>
                {flowBadge(flow)}
              </div>
              <p className="text-xs text-muted-foreground">Used for: {types}</p>
              <div className="overflow-x-auto">
                <ApprovalFlowDiagram flow={flow} />
              </div>
            </div>
          ))}
        </section>

        {/* ── Section 6: Slack Commands ────────────────────────────────────────── */}
        <section
          id="slack-commands"
          ref={(el) => { sectionRefs.current['slack-commands'] = el }}
          className="space-y-4"
        >
          <h2 className="text-xl font-semibold border-b pb-2">6. Slack Commands — Complete Reference</h2>

          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Command</th>
                  <th className="text-left px-3 py-2 font-medium">What it does</th>
                  <th className="text-left px-3 py-2 font-medium">Who</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {SLACK_COMMANDS.map((cmd) => (
                  <tr key={cmd.command} className="hover:bg-muted/30">
                    <td className="px-3 py-2 font-mono text-xs">{cmd.command}</td>
                    <td className="px-3 py-2 text-muted-foreground text-xs">{cmd.desc}</td>
                    <td className="px-3 py-2">
                      <Badge variant="outline" className="text-xs">{cmd.who}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-4">
            {SLACK_COMMANDS.map((cmd) => (
              <div key={cmd.command} className="rounded-lg border p-4 space-y-2">
                <p className="font-mono text-sm font-medium">{cmd.command}</p>
                <p className="text-sm text-muted-foreground">{cmd.desc}</p>
                <div className="text-xs text-muted-foreground bg-muted rounded p-2 font-mono whitespace-pre-wrap">
                  {cmd.command === '/bloom-leave balance' && `📊 Your Leave Balances (2026)
────────────────────────────
Annual Leave:    12.0 / 14.0 days remaining
Sick Leave:       8.0 / 10.0 days remaining
Comp Leave:       2.0 days available (earned)
WFH:             No limit`}
                  {cmd.command === '/bloom-leave request' && 'Opens an interactive modal in Slack to select leave type, dates, and submit your request.'}
                  {cmd.command === '/comp-leave' && 'Opens a modal to log worked time (date, start/end time, reason). AU/NZ: Time In Lieu only. Others: Cash or Leave.'}
                  {cmd.command === '/bloom-leave status' && `Your recent leave requests:
──────────────────────────────
📋 #1042 | Annual Leave | Mar 15-17 | ✅ Approved
📋 #1038 | Sick Leave   | Mar 10    | ✅ Approved
📋 #1055 | Annual Leave | Apr 1-3   | ⏳ Pending (Manager)`}
                  {cmd.command === '/bloom-leave approve' && `📥 Pending Approvals (2)
────────────────────────
Jane Smith | Annual Leave | Mar 15-17 (3 days)
[✅ Approve] [❌ Reject]`}
                  {cmd.command === '/bloom-leave cancel [id]' && 'Example: /leave cancel 1042\nCancels request #1042 if it is still pending. You cannot cancel an already-approved request via Slack.'}
                  {cmd.command === '/bloom-leave team' && `👥 Team — Today (11 Mar)
────────────────────────
🏖️ Jane Smith — Annual Leave
🏠 Tom Lee  — WFH
✅ Kim Park — In office`}
                  {cmd.command === '/bloom-leave holidays' && `📅 Upcoming Holidays (AU)
────────────────────────
18 Apr 2026 — Good Friday
21 Apr 2026 — Easter Monday
25 Apr 2026 — ANZAC Day`}
                  {cmd.command === '/bloom-leave help' && 'Lists all available /leave and /comp-leave commands with descriptions. Also links to this user guide.'}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Section 7: For Managers ──────────────────────────────────────────── */}
        {(activeRole === 'all' || activeRole === 'manager' || activeRole === 'hr_admin') && (
          <section
            id="for-managers"
            ref={(el) => { sectionRefs.current['for-managers'] = el }}
            className="space-y-4"
          >
            <h2 className="text-xl font-semibold border-b pb-2">7. For Managers — Approvals & Team Management</h2>

            <div className="space-y-3">
              <h3 className="font-medium">Reviewing Leave Requests</h3>
              <p className="text-sm text-muted-foreground">
                When an employee submits a leave request, you receive a Slack DM with Approve / Reject buttons AND a web notification. You can act from either place.
              </p>
              <p className="text-sm text-muted-foreground">
                Web: Go to <strong>Approvals</strong> → <strong>Leave Requests</strong> tab. Click Approve (green) or Reject (requires a reason).
              </p>
              <p className="text-sm text-muted-foreground">
                Slack: Click <strong>Approve</strong> or <strong>Reject</strong> directly in the DM. After clicking, the buttons are replaced with a confirmation to prevent accidental double-clicks.
              </p>
            </div>

            <div className="space-y-3">
              <h3 className="font-medium">Reviewing Comp Leave Requests</h3>
              <p className="text-sm text-muted-foreground">
                Comp leave approval requests look different — they show the worked date, hours, and requested days. You have three options:
              </p>
              <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
                <li><strong>Approve</strong> — credits the requested days immediately</li>
                <li><strong>Adjust & Approve</strong> — enter a different number of days to credit (e.g. if they claimed 1 day but worked 6h, you might approve 0.75 days)</li>
                <li><strong>Reject</strong> — no days credited, employee is notified</li>
              </ul>
              <p className="text-sm text-muted-foreground">Web: Approvals → <strong>Compensation Requests</strong> tab.</p>
            </div>

            <div className="space-y-3">
              <h3 className="font-medium">Info-Only Notifications (WFH)</h3>
              <p className="text-sm text-muted-foreground">
                When an employee submits a WFH request, it is <strong>auto-approved instantly</strong>. You receive a Slack DM that says "FYI" — there are no Approve/Reject buttons. No action is needed from you.
              </p>
            </div>

            <div className="space-y-3">
              <h3 className="font-medium">Escalation Timeline</h3>
              <p className="text-sm text-muted-foreground">
                If you don't respond to a pending request: after <strong>48 hours</strong> you get a reminder. After <strong>72 hours</strong> the request is escalated to HR admin, who can approve on your behalf.
              </p>
            </div>

            <div className="space-y-3">
              <h3 className="font-medium">Viewing Team Calendar & Capacity</h3>
              <p className="text-sm text-muted-foreground">
                Go to <strong>Team Calendar</strong> to see all approved leave and WFH for your team. You can filter by region, department, or specific date range.
              </p>
            </div>

            <div className="space-y-3">
              <h3 className="font-medium">When You're On Leave Yourself</h3>
              <p className="text-sm text-muted-foreground">
                If your team submits requests while you're on approved leave, the system will route them to your manager or a configured backup. Contact HR admin to set up a backup approver for planned absences.
              </p>
            </div>
          </section>
        )}

        {/* ── Section 8: For HR ────────────────────────────────────────────────── */}
        {(activeRole === 'all' || activeRole === 'hr_admin') && (
          <section
            id="for-hr"
            ref={(el) => { sectionRefs.current['for-hr'] = el }}
            className="space-y-4"
          >
            <h2 className="text-xl font-semibold border-b pb-2">8. For HR Admins — System Administration</h2>

            <div className="space-y-3">
              <h3 className="font-medium">Managing Employees</h3>
              <p className="text-sm text-muted-foreground">Admin → Users tab. You can add new users, edit roles/manager/region/department, deactivate archived staff, and sync Slack IDs by email.</p>
            </div>

            <div className="space-y-3">
              <h3 className="font-medium">Configuring Leave Types</h3>
              <p className="text-sm text-muted-foreground">Admin → Leave Types tab. Super Admin only can create or edit leave types. Each type has:</p>
              <ul className="text-sm text-muted-foreground list-disc list-inside space-y-0.5">
                <li><strong>Approval Flow</strong> — Standard / Auto-Approve / HR Required / Multi-Level</li>
                <li><strong>Min Notice Days</strong> — Minimum notice required (e.g. Annual Leave = 3 days)</li>
                <li><strong>Max Consecutive Days</strong> — e.g. Compassionate Leave = 5 days max</li>
                <li><strong>Requires Attachment</strong> — triggers document upload requirement</li>
              </ul>
            </div>

            <div className="space-y-3">
              <h3 className="font-medium">Managing Leave Policies (per region)</h3>
              <p className="text-sm text-muted-foreground">Admin → Policies tab. Set entitlement days, carry-over limits, and probation period per leave type per region.</p>
            </div>

            <div className="space-y-3">
              <h3 className="font-medium">Managing Public Holidays</h3>
              <p className="text-sm text-muted-foreground">Admin → Holidays tab. Add, view, and delete public holidays per region. Holidays are used to calculate working days in leave requests.</p>
            </div>

            <div className="space-y-3">
              <h3 className="font-medium">HR Approval for Maternity/Paternity Leave</h3>
              <p className="text-sm text-muted-foreground">
                Maternity and Paternity leave require your sign-off at step 2. After the employee's manager approves step 1, you'll receive a notification and the request appears in your Approvals queue with status "Pending (HR)".
              </p>
            </div>

            <div className="space-y-3">
              <h3 className="font-medium">Running Reports</h3>
              <p className="text-sm text-muted-foreground">Reports → Leave Summary, Comp Leave Report, Absence Trends. Export payroll-ready CSV from the Reports page.</p>
            </div>

            <div className="space-y-3">
              <h3 className="font-medium">Linking Slack to Employee Accounts</h3>
              <p className="text-sm text-muted-foreground">Admin → Slack tab → click <strong>Sync Slack IDs</strong>. This matches LMS users to Slack workspace members by email address and updates Slack user IDs automatically.</p>
            </div>
          </section>
        )}

        {/* ── Section 9: FAQ ───────────────────────────────────────────────────── */}
        <section
          id="faq"
          ref={(el) => { sectionRefs.current['faq'] = el }}
          className="space-y-4"
        >
          <h2 className="text-xl font-semibold border-b pb-2">9. FAQ & Troubleshooting</h2>

          <Accordion type="multiple" className="space-y-2">
            {[
              {
                q: "I can't see my leave balance",
                a: "Check that your Slack account is linked (Admin can do this via the Slack sync). Also confirm you are assigned to a region — without a region, the system can't calculate your entitlement. Contact your HR admin if this persists.",
              },
              {
                q: "My request has been pending for several days",
                a: "After 48 hours, your manager receives an automatic reminder. After 72 hours, the request escalates to HR admin who can approve on their behalf. You can also message your manager directly or contact HR.",
              },
              {
                q: "I worked overtime on a weekday — can I claim comp leave?",
                a: "Yes, if you worked beyond your standard hours. Submit a comp request via My Leave → Request Comp Leave or /comp-leave in Slack. Enter the date, hours, and reason. Your manager will review.",
              },
              {
                q: "How do I change my approver / manager?",
                a: "Contact your HR admin — they can update your manager in the Admin → Users section.",
              },
              {
                q: "I submitted the wrong dates",
                a: "If the request is still pending, cancel it (My Leave → Cancel, or /leave cancel [id]) and resubmit. If it's already approved, contact your manager and HR admin to arrange a manual correction.",
              },
              {
                q: "I got auto-approved for WFH but my manager says they didn't see it",
                a: "WFH is auto-approved and sends a Slack DM to your manager as an FYI (no buttons needed). Ask your manager to check their Slack DMs for a message from CompLeaveBot. If they never received it, contact HR admin to check the Slack connection.",
              },
              {
                q: "My comp leave request was adjusted — why?",
                a: "Your manager used the 'Adjust & Approve' option. This means they approved a different number of days than you requested (e.g. you claimed 1 day for 6 hours work, they approved 0.75 days). You'll be notified of the approved amount.",
              },
              {
                q: "I'm AU/NZ — why can I only select Time In Lieu?",
                a: "Under Australian and New Zealand employment law, overtime compensation for AU/NZ employees must be Time In Lieu (TIL), tracked in hours. Other regions can choose Cash or Leave. TIL hours are converted to days when credited to your balance.",
              },
              {
                q: "Why does my Maternity/Paternity leave say 'Pending (HR)'?",
                a: "Maternity and Paternity leave require two-step approval: your manager first, then HR. Your request is at step 2 — HR admin has been notified and will review.",
              },
              {
                q: "Common error: 'Insufficient balance'",
                a: "You don't have enough leave days for the requested period. Check your balance in My Leave or via /leave balance. If you believe your balance is wrong, contact HR admin.",
              },
              {
                q: "Common error: 'Minimum notice required'",
                a: "Some leave types (e.g. Annual Leave) require advance notice. Annual Leave needs at least 3 days notice — try selecting dates further in the future.",
              },
              {
                q: "Common error: 'Overlapping request'",
                a: "You already have a pending or approved request covering some of those dates. Cancel or modify the existing request first.",
              },
            ].map(({ q, a }) => (
              <AccordionItem key={q} value={q} className="border rounded-lg px-4">
                <AccordionTrigger className="hover:no-underline text-left">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 text-orange-500 shrink-0 mt-0.5" />
                    <span className="font-medium text-sm">{q}</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <p className="text-sm text-muted-foreground pl-6">{a}</p>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </section>

        {/* Footer */}
        <footer className="border-t pt-6 text-xs text-muted-foreground space-y-1">
          <p>Last updated: March 2026</p>
          <p>Built by <a href="https://jdcoredev.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">JD CoreDev</a> for Bloom & Grow Group.</p>
          <p>For enquiries: <a href="https://jdcoredev.com/contact" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">jdcoredev.com/contact</a></p>
        </footer>
      </main>
    </div>
  )
}
