import jwt from 'jsonwebtoken'

export interface TokenPayload {
  userId: number
  email: string
  role: string
  regionId: number
}

export function signAccessToken(payload: TokenPayload): string {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET not configured')
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '24h' })
}

export function signRefreshToken(userId: number): string {
  if (!process.env.JWT_REFRESH_SECRET) throw new Error('JWT_REFRESH_SECRET not configured')
  return jwt.sign({ userId }, process.env.JWT_REFRESH_SECRET, { expiresIn: '30d' })
}

export function verifyAccessToken(token: string): TokenPayload {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET not configured')
  return jwt.verify(token, process.env.JWT_SECRET) as TokenPayload
}

export function verifyRefreshToken(token: string): { userId: number } {
  if (!process.env.JWT_REFRESH_SECRET) throw new Error('JWT_REFRESH_SECRET not configured')
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET) as { userId: number }
}

export function getRefreshTokenExpiry(): Date {
  const expiry = new Date()
  expiry.setDate(expiry.getDate() + 30)
  return expiry
}
