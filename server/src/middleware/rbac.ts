import type { Request, Response, NextFunction } from 'express'
import { ForbiddenError, UnauthorizedError } from '../utils/errors'

type UserRole = 'employee' | 'manager' | 'hr_admin' | 'super_admin'

const ROLE_LEVELS: Record<UserRole, number> = {
  employee: 1,
  manager: 2,
  hr_admin: 3,
  super_admin: 4,
}

export function requireRole(minRole: UserRole) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new UnauthorizedError())

    const userLevel = ROLE_LEVELS[req.user.role as UserRole] ?? 0
    const requiredLevel = ROLE_LEVELS[minRole]

    if (userLevel < requiredLevel) {
      return next(new ForbiddenError())
    }

    next()
  }
}

export function requireSelf(paramName = 'id') {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new UnauthorizedError())

    const targetId = parseInt((req.params[paramName] as string) ?? '', 10)
    const isSelf = req.user.userId === targetId
    const isHrOrAbove = ROLE_LEVELS[req.user.role as UserRole] >= ROLE_LEVELS['hr_admin']

    if (!isSelf && !isHrOrAbove) {
      return next(new ForbiddenError())
    }

    next()
  }
}
