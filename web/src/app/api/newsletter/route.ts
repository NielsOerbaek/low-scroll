import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { getNewsletterEmails, deleteNewsletterEmail, getUserConfig, setUserConfig } from "@/lib/db";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function GET() {
  let userId: number;
  try { userId = await requireUserId(); } catch { return unauthorized(); }

  const emails = getNewsletterEmails(userId, 100);
  const digestEmail = getUserConfig(userId, "newsletter_digest_email") || "";
  const systemPrompt = getUserConfig(userId, "newsletter_system_prompt") || "";

  return NextResponse.json({ emails, digestEmail, systemPrompt });
}

export async function POST(request: NextRequest) {
  let userId: number;
  try { userId = await requireUserId(); } catch { return unauthorized(); }

  const body = await request.json();

  if (body.digestEmail !== undefined) {
    setUserConfig(userId, "newsletter_digest_email", body.digestEmail);
  }

  if (body.systemPrompt !== undefined) {
    setUserConfig(userId, "newsletter_system_prompt", body.systemPrompt);
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  let userId: number;
  try { userId = await requireUserId(); } catch { return unauthorized(); }

  const emailId = request.nextUrl.searchParams.get("id");
  if (!emailId) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  deleteNewsletterEmail(userId, parseInt(emailId, 10));
  return NextResponse.json({ ok: true });
}
