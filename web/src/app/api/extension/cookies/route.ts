import { NextRequest, NextResponse } from "next/server";
import { getUserIdByApiKey, setUserConfig } from "@/lib/db";

export async function POST(request: NextRequest) {
  const { api_key, cookies } = await request.json();
  const userId = getUserIdByApiKey(api_key);
  if (!userId) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
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
  setUserConfig(userId, "ig_cookies", fernet.encrypt(JSON.stringify(cookies)));
  setUserConfig(userId, "ig_cookies_stale", "false");

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
