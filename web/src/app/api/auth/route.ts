import { NextRequest, NextResponse } from "next/server";
import { hashPassword, verifyPassword, createSessionToken } from "@/lib/auth";
import { getUserByEmail, createUser, insertSession } from "@/lib/db";

export async function POST(request: NextRequest) {
  const { email, password, action } = await request.json();

  if (action === "signup") {
    if (!email || !password) {
      return NextResponse.json({ error: "Email and password required" }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }
    const existing = getUserByEmail(email);
    if (existing) {
      return NextResponse.json({ error: "Email already registered" }, { status: 409 });
    }
    const hash = await hashPassword(password);
    const userId = createUser(email, hash);

    // Generate API key for extension
    const { randomBytes } = await import("crypto");
    const apiKey = randomBytes(16).toString("hex");
    const { setUserConfig } = await import("@/lib/db");
    setUserConfig(userId, "api_key", apiKey);

    const token = createSessionToken();
    const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    insertSession(token, userId, expires);

    const response = NextResponse.json({ ok: true });
    response.cookies.set("ig_session", token, {
      httpOnly: true, secure: true, sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30, path: "/",
    });
    return response;
  }

  // Default: login
  if (!email || !password) {
    return NextResponse.json({ error: "Email and password required" }, { status: 401 });
  }
  const user = getUserByEmail(email);
  if (!user || !user.is_active) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }
  const valid = await verifyPassword(user.password_hash, password);
  if (!valid) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const token = createSessionToken();
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  insertSession(token, user.id, expires);

  const response = NextResponse.json({ ok: true });
  response.cookies.set("ig_session", token, {
    httpOnly: true, secure: true, sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30, path: "/",
  });
  return response;
}
