import { BookOpen, Calendar, CheckCircle, Clock, HelpCircle, LogIn, MessageSquare, XCircle } from 'lucide-react'

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ElementType
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 border-b pb-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <h2 className="text-lg font-semibold">{title}</h2>
      </div>
      <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </div>
  )
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
        {n}
      </span>
      <span className="pt-0.5">{children}</span>
    </div>
  )
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800">
      <span className="font-medium">Tip: </span>
      {children}
    </div>
  )
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
      {children}
    </code>
  )
}

// ─── Slack command table ──────────────────────────────────────────────────────

const SLACK_COMMANDS = [
  { cmd: '/leave apply', desc: 'Open a form to submit a new leave request' },
  { cmd: '/leave balance', desc: 'See how many days you have left for each leave type' },
  { cmd: '/leave upcoming', desc: "See your team's upcoming approved leave" },
  { cmd: '/leave status', desc: 'Check the status of your recent requests' },
  { cmd: '/leave cancel [id]', desc: 'Cancel a pending request (use the request ID shown in /leave status)' },
]

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function GuidePage() {
  return (
    <div className="mx-auto max-w-2xl space-y-10 px-4 py-8">
      {/* Header */}
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <BookOpen className="h-4 w-4" />
          <span>Staff User Manual</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Bloom & Grow Leave System</h1>
        <p className="text-muted-foreground text-sm">
          Everything you need to apply for leave, check your balances, and track your requests.
        </p>
      </div>

      {/* 1. Logging in */}
      <Section icon={LogIn} title="Logging In">
        <Step n={1}>Go to the Bloom LMS web address provided by your HR team.</Step>
        <Step n={2}>Enter your work email address and your password, then click <strong>Sign in</strong>.</Step>
        <Step n={3}>
          If it's your first time or you've forgotten your password, contact HR to have it reset.
        </Step>
        <Tip>You'll be taken straight to your Dashboard after signing in.</Tip>
      </Section>

      {/* 2. Checking your balances */}
      <Section icon={CheckCircle} title="Checking Your Leave Balances">
        <p>Your leave balances are visible in two places:</p>
        <ul className="space-y-2 list-disc list-inside">
          <li>
            <strong>Dashboard</strong> — summary cards at the top show your most-used leave types at a glance.
          </li>
          <li>
            <strong>My Leave page</strong> — click <strong>My Leave</strong> in the sidebar for a full breakdown of every leave type, including how many days you've used, how many are pending, and how many remain.
          </li>
        </ul>
        <Tip>Balances are for the current calendar year and reset on 1 January.</Tip>
      </Section>

      {/* 3. Submitting a leave request */}
      <Section icon={Calendar} title="Submitting a Leave Request">
        <Step n={1}>
          Click <strong>My Leave</strong> in the sidebar, then click the <strong>Apply for Leave</strong> button (top right).
        </Step>
        <Step n={2}>
          Choose a <strong>Leave Type</strong> from the dropdown (e.g. Annual Leave, Sick Leave, Birthday Leave).
        </Step>
        <Step n={3}>
          Select your <strong>Start Date</strong> and <strong>End Date</strong>. The system will calculate the number of working days automatically, skipping public holidays.
        </Step>
        <Step n={4}>
          Add a short <strong>reason</strong> (required for most leave types).
        </Step>
        <Step n={5}>
          If your leave type requires supporting documents (e.g. Sick Leave for extended absences), upload the file using the attachment field.
        </Step>
        <Step n={6}>
          Click <strong>Submit Request</strong>. You'll see a confirmation and your request will appear with a <em>Pending</em> status.
        </Step>
        <Tip>
          You'll receive a Slack DM and an in-app notification when your request is approved or rejected.
        </Tip>
      </Section>

      {/* 4. Tracking your requests */}
      <Section icon={Clock} title="Tracking Your Requests">
        <p>
          All your submitted requests appear in the <strong>My Leave</strong> page under the <em>Leave History</em> section. Each request shows:
        </p>
        <ul className="space-y-1.5 list-disc list-inside">
          <li><strong>Pending</strong> — waiting for your manager (or HR) to review</li>
          <li><strong>Approved</strong> — confirmed, your balance has been updated</li>
          <li><strong>Rejected</strong> — not approved; the rejection reason will be shown</li>
          <li><strong>Cancelled</strong> — you cancelled it before it was actioned</li>
        </ul>
        <Tip>
          Click any request row to see its full details, including any comments left by your manager.
        </Tip>
      </Section>

      {/* 5. Cancelling a request */}
      <Section icon={XCircle} title="Cancelling a Request">
        <Step n={1}>Go to <strong>My Leave</strong> and find the request you want to cancel.</Step>
        <Step n={2}>Click the request to open it, then click the <strong>Cancel Request</strong> button.</Step>
        <Step n={3}>Confirm the cancellation. The status will change to <em>Cancelled</em> and your balance will be restored if it was already approved.</Step>
        <p className="text-xs text-muted-foreground/80">
          You can only cancel requests that are still <em>Pending</em> or <em>Approved</em> and haven't started yet. For exceptions, contact HR directly.
        </p>
      </Section>

      {/* 6. Team calendar */}
      <Section icon={Calendar} title="Team Calendar">
        <p>
          Click <strong>Calendar</strong> in the sidebar to see a monthly view of all approved leave across your team. This helps you plan your own leave around busy periods.
        </p>
        <ul className="space-y-1.5 list-disc list-inside">
          <li>Each person's leave is shown as a coloured bar on the calendar.</li>
          <li>Public holidays for your region are highlighted.</li>
          <li>Use the region filter (top right) to narrow the view if your team spans multiple offices.</li>
        </ul>
      </Section>

      {/* 7. Slack commands */}
      <Section icon={MessageSquare} title="Slack Commands (CompLeaveBot)">
        <p>
          If your Slack account is linked, you can manage leave directly from Slack using the commands below. Type any of these in any Slack channel or DM.
        </p>
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-foreground">Command</th>
                <th className="px-3 py-2 text-left font-medium text-foreground">What it does</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {SLACK_COMMANDS.map(({ cmd, desc }) => (
                <tr key={cmd} className="hover:bg-muted/30">
                  <td className="px-3 py-2 font-mono text-primary whitespace-nowrap"><Code>{cmd}</Code></td>
                  <td className="px-3 py-2 text-muted-foreground">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Tip>
          Your Slack account needs to be linked by an admin before these commands work. Check with HR if you get an "account not found" message.
        </Tip>
      </Section>

      {/* 8. FAQ */}
      <Section icon={HelpCircle} title="Common Questions">
        <div className="space-y-4">
          {[
            {
              q: 'I submitted a request but my balance hasn\'t changed yet.',
              a: 'Your balance shows "pending" days separately. It will be deducted from your available total once approved.',
            },
            {
              q: 'I don\'t see a leave type I need (e.g. compassionate, study leave).',
              a: 'Some leave types are region-specific. Contact HR and they can submit or approve it on your behalf.',
            },
            {
              q: 'My request was rejected but I need to resubmit.',
              a: 'Click Apply for Leave again and submit a new request. You can reference any discussion with your manager in the reason field.',
            },
            {
              q: 'I can\'t log in.',
              a: 'Make sure you\'re using your work email. If you\'ve forgotten your password, contact HR to reset it.',
            },
            {
              q: 'Who approves my leave?',
              a: 'Your assigned manager. For certain leave types, HR may also be involved. You\'ll be notified at each step via Slack and in-app notifications.',
            },
          ].map(({ q, a }) => (
            <div key={q} className="space-y-1">
              <p className="font-medium text-foreground">{q}</p>
              <p>{a}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Footer */}
      <p className="text-center text-xs text-muted-foreground border-t pt-6">
        Need help? Contact your HR team or reach out via Slack.
      </p>
    </div>
  )
}
