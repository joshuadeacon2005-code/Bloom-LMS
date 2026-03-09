import { defineConfig } from 'drizzle-kit'
import { config } from 'dotenv'

config({ path: '../.env' })

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required')
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: '../drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  verbose: true,
  strict: true,
})
