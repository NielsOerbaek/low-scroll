import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { getNewsletterEmails, deleteNewsletterEmail, getUserConfig, setUserConfig, getFirstActiveUserId } from "@/lib/db";

async function resolveUserId(): Promise<number | null> {
  const sessionUserId = await getCurrentUserId();
  if (sessionUserId) return sessionUserId;
  return getFirstActiveUserId();
}

export async function GET() {
  const userId = await resolveUserId();
  if (!userId) return NextResponse.json({ error: "No user" }, { status: 404 });

  const emails = getNewsletterEmails(userId, 100);
  const recipientsJson = getUserConfig(userId, "newsletter_recipients") || "[]";
  const schedulesJson = getUserConfig(userId, "newsletter_schedules") || "[]";
  const systemPrompt = getUserConfig(userId, "newsletter_system_prompt") || "";

  let recipients: string[] = [];
  let schedules: any[] = [];
  try { recipients = JSON.parse(recipientsJson); } catch {}
  try { schedules = JSON.parse(schedulesJson); } catch {}

  // Migration: if old single-email key exists and recipients is empty, include it
  if (recipients.length === 0) {
    const oldEmail = getUserConfig(userId, "newsletter_digest_email") || "";
    if (oldEmail) recipients = [oldEmail];
  }

  return NextResponse.json({ emails, recipients, schedules, systemPrompt });
}

export async function POST(request: NextRequest) {
  const userId = await resolveUserId();
  if (!userId) return NextResponse.json({ error: "No user" }, { status: 404 });

  const body = await request.json();

  if (body.recipients !== undefined) {
    setUserConfig(userId, "newsletter_recipients", JSON.stringify(body.recipients));
  }

  if (body.schedules !== undefined) {
    setUserConfig(userId, "newsletter_schedules", JSON.stringify(body.schedules));
  }

  if (body.systemPrompt !== undefined) {
    setUserConfig(userId, "newsletter_system_prompt", body.systemPrompt);
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const userId = await resolveUserId();
  if (!userId) return NextResponse.json({ error: "No user" }, { status: 404 });

  const emailId = request.nextUrl.searchParams.get("id");
  if (!emailId) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  deleteNewsletterEmail(userId, parseInt(emailId, 10));
  return NextResponse.json({ ok: true });
}
