import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import {
  getFirstActiveUserId,
  getUserConfig,
  getPostsSince,
  getMediaForPost,
  getLastIgDigestDate,
  setLastIgDigestDate,
} from "@/lib/db";

function authCheck(request: NextRequest): boolean {
  const expected = process.env.ONESHOT_API_KEY || "";
  if (!expected) return false;
  const auth = request.headers.get("authorization") || "";
  return auth === `Bearer ${expected}`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface DigestPostMedia {
  type: "image" | "video";
  url: string;
  thumbnail: string | null;
}

interface DigestPost {
  source_name: string;
  type: string;
  content: string | null;
  timestamp: string;
  permalink: string | null;
  platform: string;
  media: DigestPostMedia[];
}

function typeLabel(type: string): string {
  switch (type) {
    case "story": return "Story";
    case "reel": return "Reel";
    case "fb_post": return "Opslag";
    default: return "Opslag";
  }
}

function buildFeedDigestHtml(digestContent: string, digestDate: string, posts: DigestPost[]): string {
  const daMonths: Record<number, string> = {
    1: "Januar", 2: "Februar", 3: "Marts", 4: "April", 5: "Maj", 6: "Juni",
    7: "Juli", 8: "August", 9: "September", 10: "Oktober", 11: "November", 12: "December",
  };
  const daWeekdays: Record<number, string> = {
    0: "Søndag", 1: "Mandag", 2: "Tirsdag", 3: "Onsdag",
    4: "Torsdag", 5: "Fredag", 6: "Lørdag",
  };
  const d = new Date(digestDate + "T12:00:00Z");
  const formattedDate = `${daWeekdays[d.getUTCDay()]} d. ${d.getUTCDate()}. ${daMonths[d.getUTCMonth() + 1]} ${d.getUTCFullYear()}`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;">

        <!-- Header -->
        <tr><td style="padding:20px 24px;border-bottom:1px solid #eee;" align="center">
          <img src="https://ig.raakode.dk/logo.png" alt="low-scroll" width="32" height="32" style="display:inline-block;border-radius:6px;vertical-align:middle;margin-right:8px;">
          <span style="font-size:24px;font-weight:bold;font-family:'Courier New',Courier,monospace;color:#262626;vertical-align:middle;">low-scroll</span>
          <div style="margin-top:12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;color:#8e8e8e;">${escapeHtml(formattedDate)}</div>
        </td></tr>

        <!-- Digest content -->
        <tr><td style="padding:20px 24px;">
          <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:16px;color:#262626;line-height:1.7;">
            ${digestContent}
          </div>
        </td></tr>

        <!-- Post list -->
        ${posts.length > 0 ? `<tr><td style="padding:16px 24px;border-top:1px solid #eee;">
          <p style="margin:0 0 12px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:13px;color:#8e8e8e;font-weight:600;">Alle opslag:</p>
          ${posts.map((p) => {
            const caption = (p.content || "").slice(0, 120).replace(/\n/g, " ");
            const label = `${escapeHtml(p.source_name)} — ${typeLabel(p.type)}`;
            const snippet = caption ? escapeHtml(caption) + ((p.content || "").length > 120 ? "…" : "") : "";
            const time = new Date(p.timestamp).toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Copenhagen" });
            const linkOpen = p.permalink ? `<a href="${escapeHtml(p.permalink)}" style="text-decoration:none;">` : "";
            const linkClose = p.permalink ? "</a>" : "";

            // First image (or video thumbnail) for this post
            const img = p.media.length > 0
              ? (() => {
                  const m = p.media[0];
                  const src = m.type === "video" && m.thumbnail ? m.thumbnail : m.url;
                  return `${linkOpen}<img src="${escapeHtml(src)}" alt="" width="552" style="display:block;width:100%;max-width:552px;height:auto;border-radius:8px;margin-bottom:8px;" />${linkClose}`;
                })()
              : "";

            return `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;"><tr><td>
              <p style="margin:0 0 4px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:13px;">
                <span style="color:#1A2C4E;font-weight:600;">${escapeHtml(p.source_name)}</span>
                <span style="color:#b0b0b0;font-size:12px;"> ${time} · ${typeLabel(p.type)}</span>
              </p>
              ${img}
              ${snippet ? `<p style="margin:0 0 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:13px;color:#8e8e8e;">${snippet}</p>` : ""}
            </td></tr></table>`;
          }).join("\n")}
        </td></tr>` : ""}

        <!-- Footer -->
        <tr><td style="padding:16px 24px;border-top:1px solid #eee;">
          <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:13px;color:#8e8e8e;">
            <a href="https://ig.raakode.dk" style="color:#8e8e8e;text-decoration:underline;">Se fuld feed</a>
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export async function POST(request: NextRequest) {
  if (!authCheck(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = getFirstActiveUserId();
  if (!userId) {
    return NextResponse.json({ error: "No active user" }, { status: 404 });
  }

  const body = await request.json();
  const { title, digest_html: digestContent } = body as {
    title: string;
    digest_html: string;
  };

  if (!title || !digestContent) {
    return NextResponse.json(
      { error: "Missing required fields: title, digest_html" },
      { status: 400 }
    );
  }

  try {
    const today = new Date().toISOString().slice(0, 10);
    const since = getLastIgDigestDate(userId) || new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const rawPosts = getPostsSince(userId, since);
    const posts: DigestPost[] = rawPosts.map((p) => {
      const media = p.platform === "instagram"
        ? getMediaForPost(userId, p.id).map((m) => ({
            type: m.media_type,
            url: `https://ig.raakode.dk/api/media/${m.file_path}`,
            thumbnail: m.thumbnail_path ? `https://ig.raakode.dk/api/media/${m.thumbnail_path}` : null,
          }))
        : [];
      return { ...p, content: p.content, media };
    });
    const html = buildFeedDigestHtml(digestContent, today, posts);

    // Send email via Resend
    const resendApiKey = process.env.RESEND_API_KEY;
    if (!resendApiKey) {
      throw new Error("RESEND_API_KEY not configured");
    }

    const recipient = getUserConfig(userId, "email_recipient");
    if (!recipient) {
      throw new Error("No email recipient configured");
    }
    const recipients = [recipient];

    const resend = new Resend(resendApiKey);
    await resend.emails.send({
      from: "low-scroll <digest@raakode.dk>",
      to: recipients,
      subject: title,
      html,
    });

    // Mark digest as sent
    setLastIgDigestDate(userId, today);

    return NextResponse.json({
      ok: true,
      post_count: posts.length,
      recipients,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
