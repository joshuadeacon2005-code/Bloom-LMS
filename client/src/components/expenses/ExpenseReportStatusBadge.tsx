import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { ExpenseReportStatus } from '@/hooks/useExpenses'

const STATUS: Record<ExpenseReportStatus, { label: string; className: string }> = {
  PENDING_REVIEW: {
    label: 'Draft',
    className: 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-100',
  },
  AWAITING_APPROVAL: {
    label: 'Awaiting Approval',
    className: 'bg-yellow-100 text-yellow-800 border-yellow-200 hover:bg-yellow-100',
  },
  APPROVED: {
    label: 'Approved',
    className: 'bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-100',
  },
  REJECTED: {
    label: 'Rejected',
    className: 'bg-red-100 text-red-800 border-red-200 hover:bg-red-100',
  },
  SYNCING: {
    label: 'Syncing to NetSuite',
    className: 'bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-100',
  },
  SYNCED: {
    label: 'Synced',
    className: 'bg-green-100 text-green-800 border-green-200 hover:bg-green-100',
  },
  SYNC_FAILED: {
    label: 'Sync Failed',
    className: 'bg-red-100 text-red-800 border-red-200 hover:bg-red-100',
  },
}

export function ExpenseReportStatusBadge({
  status,
  className,
}: {
  status: ExpenseReportStatus
  className?: string
}) {
  const config = STATUS[status] ?? { label: status, className: 'bg-gray-100 text-gray-600 border-gray-200' }
  return (
    <Badge variant="outline" className={cn('font-medium', config.className, className)}>
      {config.label}
    </Badge>
  )
}
