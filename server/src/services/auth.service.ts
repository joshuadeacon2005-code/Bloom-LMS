import crypto from 'crypto'
import { eq, and } from 'drizzle-orm'
import { db } from '../db/index'
import { users, refreshTokens, regions } from '../db/schema'
import { hashPassword, verifyPassword } from '../utils/password'
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  getRefreshTokenExpiry,
} from '../utils/jwt'
import { AppError, UnauthorizedError, ConflictError } from '../utils/errors'

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function buildTokens(user: { id: number; email: string; role: string; regionId: number; gender?: string | null }) {
  const accessToken = signAccessToken({
    userId: user.id,
    email: user.email,
    role: user.role,
    regionId: user.regionId,
    gender: user.gender ?? null,
  })
  const refreshToken = signRefreshToken(user.id)
  return { accessToken, refreshToken }
}

async function storeRefreshToken(userId: number, token: string) {
  await db.insert(refreshTokens).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt: getRefreshTokenExpiry(),
  })
}

export async function changePassword(userId: number, currentPassword: string, newPassword: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  if (!user) throw new UnauthorizedError()

  const valid = await verifyPassword(currentPassword, user.passwordHash)
  if (!valid) throw new AppError(400, 'Current password is incorrect')

  const newHash = await hashPassword(newPassword)
  await db.update(users).set({ passwordHash: newHash }).where(eq(users.id, userId))
}

export async function login(email: string, password: string) {
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      passwordHash: users.passwordHash,
      slackUserId: users.slackUserId,
      role: users.role,
      regionId: users.regionId,
      departmentId: users.departmentId,
      managerId: users.managerId,
      isActive: users.isActive,
      avatarUrl: users.avatarUrl,
      gender: users.gender,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
      regionCode: regions.code,
    })
    .from(users)
    .leftJoin(regions, eq(users.regionId, regions.id))
    .where(and(eq(users.email, email.toLowerCase()), eq(users.isActive, true)))
    .limit(1)

  if (!row) {
    throw new UnauthorizedError('Invalid email or password')
  }

  const valid = await verifyPassword(password, row.passwordHash)
  if (!valid) {
    throw new UnauthorizedError('Invalid email or password')
  }

  const { accessToken, refreshToken } = buildTokens(row)
  await storeRefreshToken(row.id, refreshToken)

  const { passwordHash: _, ...safeUser } = row
  return { user: safeUser, accessToken, refreshToken }
}

export async function register(data: {
  email: string
  password: string
  name: string
  regionId: number
  departmentId?: number
  managerId?: number
}) {
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, data.email.toLowerCase()))
    .limit(1)

  if (existing) {
    throw new ConflictError('An account with this email already exists')
  }

  const passwordHash = await hashPassword(data.password)
  const [user] = await db
    .insert(users)
    .values({
      email: data.email.toLowerCase(),
      passwordHash,
      name: data.name,
      regionId: data.regionId,
      departmentId: data.departmentId,
      managerId: data.managerId,
      role: 'employee',
    })
    .returning()

  if (!user) throw new AppError(500, 'Failed to create user')

  const { accessToken, refreshToken } = buildTokens(user)
  await storeRefreshToken(user.id, refreshToken)

  const { passwordHash: _, ...safeUser } = user
  return { user: safeUser, accessToken, refreshToken }
}

export async function refresh(token: string) {
  let payload: { userId: number }
  try {
    payload = verifyRefreshToken(token)
  } catch {
    throw new UnauthorizedError('Invalid or expired refresh token')
  }

  const tokenHash = hashToken(token)
  const [storedToken] = await db
    .select()
    .from(refreshTokens)
    .where(
      and(
        eq(refreshTokens.tokenHash, tokenHash),
        eq(refreshTokens.userId, payload.userId),
        eq(refreshTokens.isRevoked, false)
      )
    )
    .limit(1)

  if (!storedToken || storedToken.expiresAt < new Date()) {
    throw new UnauthorizedError('Refresh token has expired or been revoked')
  }

  // Rotate: revoke old token
  await db
    .update(refreshTokens)
    .set({ isRevoked: true })
    .where(eq(refreshTokens.id, storedToken.id))

  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, payload.userId), eq(users.isActive, true)))
    .limit(1)

  if (!user) throw new UnauthorizedError('User not found or inactive')

  const { accessToken, refreshToken: newRefreshToken } = buildTokens(user)
  await storeRefreshToken(user.id, newRefreshToken)

  return { accessToken, refreshToken: newRefreshToken }
}

export async function logout(token: string) {
  try {
    const payload = verifyRefreshToken(token)
    const tokenHash = hashToken(token)
    await db
      .update(refreshTokens)
      .set({ isRevoked: true })
      .where(
        and(eq(refreshTokens.tokenHash, tokenHash), eq(refreshTokens.userId, payload.userId))
      )
  } catch {
    // Silent — if token is invalid, it's already effectively logged out
  }
}

export async function getMe(userId: number) {
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      slackUserId: users.slackUserId,
      role: users.role,
      regionId: users.regionId,
      departmentId: users.departmentId,
      managerId: users.managerId,
      isActive: users.isActive,
      avatarUrl: users.avatarUrl,
      gender: users.gender,
      createdAt: users.createdAt,
      regionCode: regions.code,
    })
    .from(users)
    .leftJoin(regions, eq(users.regionId, regions.id))
    .where(eq(users.id, userId))
    .limit(1)

  if (!user) throw new UnauthorizedError('User not found')
  return user
}
