import { NextRequest, NextResponse } from "next/server";
import { getConfig, setConfig } from "@/lib/db";

export async function GET() {
  try {
    const cookieStatus = getConfig("ig_cookies_stale");
    const hasCookies = getConfig("ig_cookies") !== null;
    const cronSchedule = getConfig("cron_schedule") || "0 8 * * *";
    const emailRecipient = getConfig("email_recipient") || process.env.EMAIL_RECIPIENT || "";

    return NextResponse.json({
      hasCookies,
      cookiesStale: cookieStatus === "true",
      cronSchedule,
      emailRecipient,
    });
  } catch {
    return NextResponse.json({
      hasCookies: false,
      cookiesStale: false,
      cronSchedule: "0 8 * * *",
      emailRecipient: process.env.EMAIL_RECIPIENT || "",
    });
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json();

  if (body.cookies) {
    const encryptionKey = process.env.ENCRYPTION_KEY || "";
    if (!encryptionKey) {
      return NextResponse.json({ error: "Encryption key not configured" }, { status: 500 });
    }

    const { Fernet } = await import("@/lib/fernet");
    const fernet = new Fernet(encryptionKey);
    const encrypted = fernet.encrypt(JSON.stringify(body.cookies));
    setConfig("ig_cookies", encrypted);
    setConfig("ig_cookies_stale", "false");
  }

  if (body.cronSchedule) {
    setConfig("cron_schedule", body.cronSchedule);
  }

  if (body.emailRecipient !== undefined) {
    setConfig("email_recipient", body.emailRecipient);
  }

  return NextResponse.json({ ok: true });
}
