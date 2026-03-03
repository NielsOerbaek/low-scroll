import { NextRequest, NextResponse } from "next/server";
import { insertNewsletterEmail, getFirstActiveUserId } from "@/lib/db";

export async function POST(request: NextRequest) {
  const apiKey = request.nextUrl.searchParams.get("api_key") || "";
  const expected = process.env.NEWSLETTER_API_KEY || "";

  if (!expected || apiKey !== expected) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }

  const body = await request.json();
  const { from, to, subject, body_text, body_html, message_id } = body;

  if (!from || !to) {
    return NextResponse.json(
      { error: "Missing required fields: from, to" },
      { status: 400 }
    );
  }

  // Single-user system: route all emails to the first active user
  const userId = getFirstActiveUserId();
  if (!userId) {
    return NextResponse.json(
      { error: "No active user found" },
      { status: 404 }
    );
  }

  const emailId = insertNewsletterEmail(
    userId,
    message_id || "",
    from,
    to,
    subject || "(no subject)",
    body_text || "",
    body_html || ""
  );

  return NextResponse.json({ ok: true, email_id: emailId });
}
