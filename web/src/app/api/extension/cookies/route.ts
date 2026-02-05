import { NextRequest, NextResponse } from "next/server";
import { validatePassword } from "@/lib/auth";
import { setConfig } from "@/lib/db";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { password, cookies } = body;

  if (!password || !validatePassword(password)) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  if (!cookies?.sessionid) {
    return NextResponse.json({ error: "Missing sessionid cookie" }, { status: 400 });
  }

  const encryptionKey = process.env.ENCRYPTION_KEY || "";
  if (!encryptionKey) {
    return NextResponse.json({ error: "Encryption key not configured" }, { status: 500 });
  }

  const { Fernet } = await import("@/lib/fernet");
  const fernet = new Fernet(encryptionKey);
  const encrypted = fernet.encrypt(JSON.stringify(cookies));
  setConfig("ig_cookies", encrypted);
  setConfig("ig_cookies_stale", "false");

  const res = NextResponse.json({ ok: true });
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return res;
}

export async function OPTIONS() {
  const res = new NextResponse(null, { status: 204 });
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return res;
}
