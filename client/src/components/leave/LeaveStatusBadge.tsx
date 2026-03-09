import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

type Status = 'pending' | 'approved' | 'rejected' | 'cancelled'

const STATUS_CONFIG: Record<Status, { label: string; className: string }> = {
  pending: {
    label: 'Pending',
    className: 'bg-yellow-100 text-yellow-800 border-yellow-200 hover:bg-yellow-100',
  },
  approved: {
    label: 'Approved',
    className: 'bg-green-100 text-green-800 border-green-200 hover:bg-green-100',
  },
  rejected: {
    label: 'Not Approved',
    className: 'bg-red-100 text-red-800 border-red-200 hover:bg-red-100',
  },
  cancelled: {
    label: 'Cancelled',
    className: 'bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-100',
  },
}

interface LeaveStatusBadgeProps {
  status: Status
  className?: string
}

export function LeaveStatusBadge({ status, className }: LeaveStatusBadgeProps) {
  const config = STATUS_CONFIG[status]
  return (
    <Badge
      variant="outline"
      className={cn('font-medium', config.className, className)}
    >
      {config.label}
    </Badge>
  )
}
