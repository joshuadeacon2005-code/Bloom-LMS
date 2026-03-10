import pg from 'pg'
import { hashPassword } from '../utils/password'

export async function seedAdminUser(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) {
    console.error('[seed-admin] DATABASE_URL not set, skipping')
    return
  }

  const client = new pg.Client({ connectionString: dbUrl })
  await client.connect()

  try {
    const existing = await client.query(
      "SELECT id FROM users WHERE email = 'josh@bloomandgrowgroup.com'"
    )

    if (existing.rows.length > 0) {
      console.log('[seed-admin] Admin user already exists, skipping')
      return
    }

    let regionId: number

    const regionResult = await client.query(
      "SELECT id FROM regions WHERE code = 'HK' LIMIT 1"
    )

    if (regionResult.rows.length > 0) {
      regionId = regionResult.rows[0].id
    } else {
      const anyRegion = await client.query('SELECT id FROM regions LIMIT 1')
      if (anyRegion.rows.length > 0) {
        regionId = anyRegion.rows[0].id
      } else {
        const insertRegion = await client.query(
          "INSERT INTO regions (name, code, timezone, currency) VALUES ('Hong Kong', 'HK', 'Asia/Hong_Kong', 'HKD') RETURNING id"
        )
        regionId = insertRegion.rows[0].id
        console.log('[seed-admin] Created HK region with id:', regionId)
      }
    }

    const passwordHash = await hashPassword('C00k1eD0g')

    await client.query(
      `INSERT INTO users (email, password_hash, name, role, region_id, is_active)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (email) DO NOTHING`,
      ['josh@bloomandgrowgroup.com', passwordHash, 'Joshua Deacon', 'super_admin', regionId, true]
    )

    console.log('[seed-admin] Admin user created: josh@bloomandgrowgroup.com')
  } catch (err) {
    console.error('[seed-admin] Error:', err)
  } finally {
    await client.end()
  }
}
