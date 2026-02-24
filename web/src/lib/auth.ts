import argon2 from "argon2";
import { randomBytes } from "crypto";
import { cookies } from "next/headers";

// Import DB read helper — getDb() returns a read-only connection
import Database from "better-sqlite3";

const DATABASE_PATH = process.env.DATABASE_PATH || "/data/db/ig.db";

function getDb(): Database.Database {
  const db = new Database(DATABASE_PATH, { readonly: true });
  db.pragma("journal_mode = WAL");
  return db;
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2.verify(hash, password);
}

export function createSessionToken(): string {
  return randomBytes(32).toString("hex");
}

export async function getCurrentUserId(): Promise<number | null> {
  const cookieStore = await cookies();
  const session = cookieStore.get("ig_session");
  if (!session?.value || !/^[a-f0-9]{64}$/.test(session.value)) return null;

  const db = getDb();
  const row = db.prepare(
    "SELECT user_id FROM sessions WHERE token = ? AND expires_at > datetime('now')"
  ).get(session.value) as { user_id: number } | undefined;

  return row?.user_id ?? null;
}

export async function requireUserId(): Promise<number> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Unauthorized");
  return userId;
}

// ── Deprecated — kept temporarily for extension routes (Task 5 will remove) ──

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "changeme";

/** @deprecated Use verifyPassword() with user-specific hashes instead */
export function validatePassword(password: string): boolean {
  return password === ADMIN_PASSWORD;
}
