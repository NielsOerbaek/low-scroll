import { NextRequest, NextResponse } from "next/server";
import { insertNewsletterEmail, getFirstActiveUserId } from "@/lib/db";

// Extract subject from HTML body when the header is missing
function extractSubjectFromHtml(html: string): string {
  if (!html) return "";
  // <title> tag
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : "";
  if (!title) return "";
  // Strip HTML for date search
  const text = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // If title looks like a short brand name, try appending a date (e.g. "TLDR AI 2026-05-12")
  const dateMatch = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (title.length <= 30 && dateMatch) return `${title} ${dateMatch[1]}`;
  return title;
}

// Decode MIME encoded-word subjects like =?utf-8?Q?Hello?= or =?utf-8?B?SGVsbG8=?=
function decodeMimeSubject(subject: string): string {
  if (!subject.includes("=?")) return subject;
  return subject.replace(
    /=\?([^?]+)\?([BQbq])\?([^?]*)\?=/g,
    (_, charset, encoding, encoded) => {
      try {
        const bytes =
          encoding.toUpperCase() === "B"
            ? Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))
            : Uint8Array.from(
                encoded.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_m: string, h: string) =>
                  String.fromCharCode(parseInt(h, 16))
                ),
                (c: string) => c.charCodeAt(0)
              );
        return new TextDecoder(charset).decode(bytes);
      } catch {
        return encoded;
      }
    }
  );
}

export async function POST(request: NextRequest) {
  const apiKey = request.nextUrl.searchParams.get("api_key") || "";
  const expected = process.env.NEWSLETTER_API_KEY || "";

  if (!expected || apiKey !== expected) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }

  const body = await request.json();
  const { from, from_name, to, subject, body_text, body_html, message_id } = body;

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

  const decoded = decodeMimeSubject(subject || "");
  const hasSubject = decoded && decoded !== "(no subject)";
  const cleanSubject = hasSubject ? decoded : (extractSubjectFromHtml(body_html || "") || decoded || "(no subject)");

  const emailId = insertNewsletterEmail(
    userId,
    message_id || "",
    from,
    to,
    cleanSubject,
    body_text || "",
    body_html || "",
    from_name || ""
  );

  return NextResponse.json({ ok: true, email_id: emailId });
}
