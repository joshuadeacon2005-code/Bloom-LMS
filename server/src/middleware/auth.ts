import type { Request, Response, NextFunction } from 'express'
import { verifyAccessToken, type TokenPayload } from '../utils/jwt'
import { UnauthorizedError } from '../utils/errors'

// Extend Express Request with authenticated user
declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload
    }
  }
}

export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return next(new UnauthorizedError())
  }

  const token = authHeader.slice(7)
  try {
    req.user = verifyAccessToken(token)
    next()
  } catch {
    next(new UnauthorizedError('Invalid or expired token'))
  }
}
