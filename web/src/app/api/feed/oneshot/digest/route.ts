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
  id: string;
  source_name: string;
  type: string;
  content: string | null;
  timestamp: string;
  permalink: string | null;
  platform: string;
  comment_count: number | null;
  media: DigestPostMedia[];
}

function typeLabel(type: string): string {
  switch (type) {
    case "story": return "story";
    case "reel": return "reel";
    case "fb_post": return "facebook";
    default: return "post";
  }
}

function typeBadgeStyle(type: string): string {
  switch (type) {
    case "story": return "background:#fce4ec;color:#DD2A7B;";
    case "reel": return "background:#ede7f6;color:#7c4dff;";
    case "fb_post": return "background:#e7f3ff;color:#1877f2;";
    default: return "background:#efefef;color:#666;";
  }
}

function buildProceduralDigestHtml(digestDate: string, posts: DigestPost[]): { html: string; subject: string } {
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

  // Group posts by source
  const igPosts: DigestPost[] = [];
  const fbPosts: DigestPost[] = [];
  for (const p of posts) {
    if (p.platform === "facebook") {
      fbPosts.push(p);
    } else {
      igPosts.push(p);
    }
  }

  // Group IG posts by username
  const igGrouped = new Map<string, DigestPost[]>();
  let postCount = 0;
  let storyCount = 0;
  for (const p of igPosts) {
    if (!igGrouped.has(p.source_name)) igGrouped.set(p.source_name, []);
    igGrouped.get(p.source_name)!.push(p);
    if (p.type === "story") storyCount++;
    else postCount++;
  }

  // Group FB posts by source
  const fbGrouped = new Map<string, DigestPost[]>();
  for (const p of fbPosts) {
    if (!fbGrouped.has(p.source_name)) fbGrouped.set(p.source_name, []);
    fbGrouped.get(p.source_name)!.push(p);
  }

  const accountCount = igGrouped.size + fbGrouped.size;

  // Summary line
  const parts: string[] = [];
  if (postCount > 0) parts.push(`${postCount} opslag`);
  if (storyCount > 0) parts.push(`${storyCount} stor${storyCount !== 1 ? "ies" : "y"}`);
  if (fbPosts.length > 0) parts.push(`${fbPosts.length} Facebook-opslag`);
  const summaryText = `${parts.join(", ")} fra ${accountCount} kont${accountCount !== 1 ? "i" : "o"}`;

  // Subject line
  const subject = `low-scroll digest: ${posts.length} nye opslag`;

  // Build post cards
  function renderPostCard(p: DigestPost): string {
    const caption = (p.content || "").slice(0, 200).replace(/\n/g, " ");
    const snippet = caption ? escapeHtml(caption) + ((p.content || "").length > 200 ? "…" : "") : "";
    const time = new Date(p.timestamp).toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Copenhagen" });
    const linkOpen = p.permalink ? `<a href="${escapeHtml(p.permalink)}" style="text-decoration:none;">` : "";
    const linkClose = p.permalink ? "</a>" : "";

    // Thumbnail
    let img = "";
    if (p.media.length > 0) {
      const m = p.media[0];
      const src = m.type === "video" && m.thumbnail ? m.thumbnail : m.url;
      img = `${linkOpen}<img src="${escapeHtml(src)}" alt="" width="520" style="display:block;width:100%;max-width:520px;height:auto;border-radius:8px 8px 0 0;margin:0;" />${linkClose}`;
    }

    return `<table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #dbdbdb;border-radius:8px;margin-bottom:12px;">
      ${img ? `<tr><td style="padding:0;">${img}</td></tr>` : ""}
      <tr><td style="padding:12px 14px;">
        <span style="display:inline-block;font-family:'Courier New',Courier,monospace;font-size:11px;padding:2px 8px;border-radius:4px;${typeBadgeStyle(p.type)}font-weight:bold;">${typeLabel(p.type)}</span>
        ${p.platform === "facebook" && p.comment_count ? `<span style="font-family:'Courier New',Courier,monospace;font-size:11px;color:#8e8e8e;margin-left:6px;">${p.comment_count} kommentar${p.comment_count !== 1 ? "er" : ""}</span>` : ""}
        ${snippet ? `<p style="margin:8px 0 6px;font-family:'Courier New',Courier,monospace;font-size:13px;color:#262626;line-height:1.4;">${snippet}</p>` : ""}
        <p style="margin:6px 0 0;font-family:'Courier New',Courier,monospace;font-size:11px;color:#8e8e8e;">
          ${time}
          ${p.permalink ? `&nbsp;&middot;&nbsp; <a href="${escapeHtml(p.permalink)}" style="color:#0095f6;text-decoration:none;">Se opslag &rarr;</a>` : ""}
        </p>
      </td></tr>
    </table>`;
  }

  // Build IG sections
  let igSections = "";
  for (const [username, userPosts] of [...igGrouped.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    igSections += `<tr><td style="padding:4px 24px 12px;">
      <p style="margin:0 0 10px;font-family:'Courier New',Courier,monospace;font-size:14px;font-weight:bold;color:#262626;">@${escapeHtml(username)}</p>
      ${userPosts.map(renderPostCard).join("\n")}
    </td></tr>`;
  }

  // Build FB sections
  let fbSections = "";
  if (fbGrouped.size > 0) {
    fbSections += `<tr><td style="padding:4px 24px 0;">
      <table width="100%" cellpadding="0" cellspacing="0" style="height:3px;margin-bottom:12px;">
        <tr><td style="background:#1877f2;height:3px;font-size:0;">&nbsp;</td></tr>
      </table>
    </td></tr>`;

    for (const [groupName, groupPosts] of [...fbGrouped.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      fbSections += `<tr><td style="padding:4px 24px 12px;">
        <p style="margin:0 0 10px;font-family:'Courier New',Courier,monospace;font-size:14px;font-weight:bold;color:#1877f2;">${escapeHtml(groupName)}</p>
        ${groupPosts.map(renderPostCard).join("\n")}
      </td></tr>`;
    }
  }

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:'Courier New',Courier,monospace;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;">

        <!-- Gradient bar -->
        <tr><td style="height:3px;background:linear-gradient(to right,#FEDA77,#DD2A7B,#515BD4);font-size:0;">&nbsp;</td></tr>

        <!-- Header -->
        <tr><td style="padding:20px 24px;border-bottom:1px solid #eee;" align="center">
          <img src="https://ig.raakode.dk/logo.png" alt="low-scroll" width="32" height="32" style="display:inline-block;border-radius:6px;vertical-align:middle;margin-right:8px;">
          <span style="font-size:24px;font-weight:bold;font-family:'Courier New',Courier,monospace;color:#262626;vertical-align:middle;">low-scroll</span>
          <div style="margin-top:12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;color:#8e8e8e;">${escapeHtml(formattedDate)}</div>
        </td></tr>

        <!-- Summary -->
        <tr><td style="padding:20px 24px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#fafafa;border:1px solid #eee;border-radius:8px;">
            <tr><td style="padding:16px 20px;">
              <p style="margin:0 0 12px;font-family:'Courier New',Courier,monospace;font-size:14px;color:#262626;">
                ${escapeHtml(summaryText)}
              </p>
              <a href="https://ig.raakode.dk" style="display:inline-block;padding:8px 20px;background:#DD2A7B;color:#ffffff;text-decoration:none;border-radius:6px;font-family:'Courier New',Courier,monospace;font-size:13px;font-weight:bold;">Se fuld feed</a>
            </td></tr>
          </table>
        </td></tr>

        <!-- Posts by account -->
        ${igSections}

        <!-- Facebook posts -->
        ${fbSections}

        <!-- Footer -->
        <tr><td style="padding:16px 24px;border-top:1px solid #eee;">
          <p style="margin:0;font-family:'Courier New',Courier,monospace;font-size:11px;color:#8e8e8e;">
            <a href="https://ig.raakode.dk/settings" style="color:#8e8e8e;text-decoration:underline;">Administrer indstillinger</a>
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { html, subject };
}

export async function POST(request: NextRequest) {
  if (!authCheck(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = getFirstActiveUserId();
  if (!userId) {
    return NextResponse.json({ error: "No active user" }, { status: 404 });
  }

  // Check time window (06:00 Copenhagen)
  const now = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Europe/Copenhagen" })
  );
  const today = now.toISOString().slice(0, 10);
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const targetMinutes = 6 * 60; // 06:00

  const { searchParams } = new URL(request.url);
  const force = searchParams.get("force") === "true";

  // Already sent today?
  const lastDigest = getLastIgDigestDate(userId);
  if (!force && lastDigest === today) {
    return NextResponse.json({ pending: false });
  }

  // Within 7-minute window of target time?
  if (!force && Math.abs(currentMinutes - targetMinutes) > 7) {
    return NextResponse.json({ pending: false });
  }

  // Get posts since last digest
  const since = lastDigest || new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const rawPosts = getPostsSince(userId, since);

  if (rawPosts.length === 0) {
    return NextResponse.json({ pending: false, reason: "no_new_posts" });
  }

  // Build post list with media
  const posts: DigestPost[] = rawPosts.map((p) => {
    const media = p.platform === "instagram"
      ? getMediaForPost(userId, p.id).map((m) => ({
          type: m.media_type,
          url: `https://ig.raakode.dk/api/media/${m.file_path}`,
          thumbnail: m.thumbnail_path ? `https://ig.raakode.dk/api/media/${m.thumbnail_path}` : null,
        }))
      : [];
    return { ...p, media };
  });

  // Build HTML procedurally
  const { html, subject } = buildProceduralDigestHtml(today, posts);

  // Send email via Resend
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    return NextResponse.json({ error: "RESEND_API_KEY not configured" }, { status: 500 });
  }

  const recipient = getUserConfig(userId, "email_recipient");
  if (!recipient) {
    return NextResponse.json({ error: "No email recipient configured" }, { status: 500 });
  }

  try {
    const resend = new Resend(resendApiKey);
    await resend.emails.send({
      from: "low-scroll <digest@raakode.dk>",
      to: [recipient],
      subject,
      html,
    });

    setLastIgDigestDate(userId, today);

    return NextResponse.json({
      ok: true,
      post_count: posts.length,
      subject,
      recipients: [recipient],
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
