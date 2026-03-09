import type { Request, Response, NextFunction } from 'express'
import type { ZodSchema } from 'zod'
import { AppError } from '../utils/errors'

export function validate(schema: ZodSchema, target: 'body' | 'query' | 'params' = 'body') {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[target])
    if (!result.success) {
      const message = result.error.issues[0]?.message ?? 'Validation failed'
      return next(new AppError(400, message, 'VALIDATION_ERROR'))
    }
    // Replace with parsed/coerced values
    req[target] = result.data as typeof req.body
    next()
  }
}
