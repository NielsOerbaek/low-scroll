import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { getNewsletterEmailBody, getFirstActiveUserId } from "@/lib/db";

async function resolveUserId(): Promise<number | null> {
  const sessionUserId = await getCurrentUserId();
  if (sessionUserId) return sessionUserId;
  return getFirstActiveUserId();
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "Z");
  return d.toLocaleDateString("da-DK", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await resolveUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const emailId = parseInt(id, 10);
  if (isNaN(emailId)) return new NextResponse("Bad request", { status: 400 });

  const body = getNewsletterEmailBody(userId, emailId);
  if (!body || !body.body_html) {
    return new NextResponse("Not found", { status: 404 });
  }

  const subject = escapeHtml(body.subject || "(no subject)");
  const from = escapeHtml(body.from_address || "");
  const date = body.received_at ? formatDate(body.received_at) : "";

  const header = `<div style="font-family:'Courier New',Courier,monospace;background:#1A2C4E;color:#fff;padding:12px 20px;font-size:13px;line-height:1.5;">
  <div style="font-weight:700;font-size:15px;">${subject}</div>
  <div style="opacity:0.7;font-size:11px;margin-top:2px;">${from}${date ? ` &middot; ${date}` : ""}</div>
</div>`;

  // Inject header after <body> tag, or prepend if no <body>
  let html = body.body_html;
  const bodyMatch = html.match(/<body[^>]*>/i);
  if (bodyMatch) {
    const idx = bodyMatch.index! + bodyMatch[0].length;
    html = html.slice(0, idx) + header + html.slice(idx);
  } else {
    html = header + html;
  }

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "script-src 'none'",
    },
  });
}
