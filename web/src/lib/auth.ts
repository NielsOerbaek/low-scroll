import { cookies } from "next/headers";
import { createHash, randomBytes } from "crypto";

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "changeme";
const SESSION_SECRET = process.env.ENCRYPTION_KEY || randomBytes(32).toString("hex");

function hashToken(token: string): string {
  return createHash("sha256").update(token + SESSION_SECRET).digest("hex");
}

export function createSession(): string {
  const token = randomBytes(32).toString("hex");
  return token;
}

export function validatePassword(password: string): boolean {
  return password === ADMIN_PASSWORD;
}

export async function isAuthenticated(): Promise<boolean> {
  const cookieStore = await cookies();
  const session = cookieStore.get("ig_session");
  if (!session?.value) return false;
  return /^[a-f0-9]{64}$/.test(session.value);
}

export async function getSessionCookie() {
  const cookieStore = await cookies();
  return cookieStore.get("ig_session");
}
