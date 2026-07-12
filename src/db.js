// Thin wrapper around Neon's serverless Postgres driver.
// DATABASE_URL comes from your Neon project's connection string
// (Neon dashboard -> Connection Details -> "Pooled connection").
import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
}

export const sql = neon(process.env.DATABASE_URL);
