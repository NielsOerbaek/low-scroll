import { NextRequest, NextResponse } from "next/server";
import {
  getFirstActiveUserId,
  getPostsSince,
  getLastIgDigestDate,
  getMediaForPost,
} from "@/lib/db";

function authCheck(request: NextRequest): boolean {
  const expected = process.env.ONESHOT_API_KEY || "";
  if (!expected) return false;
  const auth = request.headers.get("authorization") || "";
  return auth === `Bearer ${expected}`;
}

export async function GET(request: NextRequest) {
  if (!authCheck(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = getFirstActiveUserId();
  if (!userId) {
    return NextResponse.json({ error: "No active user" }, { status: 404 });
  }

  // Check time window (default 20:00 Copenhagen)
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

  // Get posts since last digest (or last 24h)
  const since = lastDigest || new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const posts = getPostsSince(userId, since);

  if (posts.length === 0) {
    return NextResponse.json({ pending: false, reason: "no_new_posts" });
  }

  return NextResponse.json({
    pending: true,
    user_id: userId,
    schedule_name: "default",
    since_date: since,
    posts: posts.map((p) => {
      const media = p.platform === "instagram"
        ? getMediaForPost(userId, p.id).map((m) => ({
            type: m.media_type,
            url: `https://ig.raakode.dk/api/media/${m.file_path}`,
            thumbnail: m.thumbnail_path ? `https://ig.raakode.dk/api/media/${m.thumbnail_path}` : null,
          }))
        : [];
      return {
        id: p.id,
        source_name: p.source_name,
        type: p.type,
        content: (p.content || "").slice(0, 4000),
        timestamp: p.timestamp,
        permalink: p.permalink,
        platform: p.platform,
        media,
      };
    }),
  });
}
