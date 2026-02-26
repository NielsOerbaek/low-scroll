import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { getUserConfig, setUserConfig } from "@/lib/db";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function GET() {
  let userId: number;
  try { userId = await requireUserId(); } catch { return unauthorized(); }

  try {
    const hasCookies = getUserConfig(userId, "ig_cookies") !== null;
    const cookieStatus = getUserConfig(userId, "ig_cookies_stale");
    const cronSchedule = getUserConfig(userId, "cron_schedule") || "0 8 * * *";
    const emailRecipient = getUserConfig(userId, "email_recipient") || "";
    const hasFbCookies = getUserConfig(userId, "fb_cookies") !== null;
    const fbCookiesStale = getUserConfig(userId, "fb_cookies_stale") === "true";
    const apiKey = getUserConfig(userId, "api_key") || "";
    const fbEnabled = getUserConfig(userId, "fb_enabled") === "true";

    return NextResponse.json({
      hasCookies,
      cookiesStale: cookieStatus === "true",
      cronSchedule,
      emailRecipient,
      hasFbCookies,
      fbCookiesStale,
      apiKey,
      fbEnabled,
    });
  } catch {
    return NextResponse.json({
      hasCookies: false,
      cookiesStale: false,
      cronSchedule: "0 8 * * *",
      emailRecipient: "",
      hasFbCookies: false,
      fbCookiesStale: false,
      apiKey: "",
      fbEnabled: false,
    });
  }
}

export async function POST(request: NextRequest) {
  let userId: number;
  try { userId = await requireUserId(); } catch { return unauthorized(); }

  const body = await request.json();

  if (body.cookies) {
    const encryptionKey = process.env.ENCRYPTION_KEY || "";
    if (!encryptionKey) {
      return NextResponse.json({ error: "Encryption key not configured" }, { status: 500 });
    }

    const { Fernet } = await import("@/lib/fernet");
    const fernet = new Fernet(encryptionKey);
    const encrypted = fernet.encrypt(JSON.stringify(body.cookies));
    setUserConfig(userId, "ig_cookies", encrypted);
    setUserConfig(userId, "ig_cookies_stale", "false");
  }

  if (body.cronSchedule) {
    setUserConfig(userId, "cron_schedule", body.cronSchedule);
  }

  if (body.emailRecipient !== undefined) {
    setUserConfig(userId, "email_recipient", body.emailRecipient);
  }

  if (body.fbEnabled !== undefined) {
    setUserConfig(userId, "fb_enabled", body.fbEnabled ? "true" : "false");
  }

  return NextResponse.json({ ok: true });
}
