import { NextRequest, NextResponse } from "next/server";
import {
  getFirstActiveUserId,
  getUndigestedEmails,
  getNewsletterSchedules,
  getUserConfig,
  getRecentDigestTexts,
  getLastDigestDate,
  getLastScheduleRun,
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

  // Check if a digest is due (same logic as scraper check_newsletter_digest)
  const now = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Europe/Copenhagen" })
  );
  const today = now.toISOString().slice(0, 10);
  const currentDow = now.getDay(); // 0=Sun, 1=Mon (JS convention, matches schedule days)
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const schedules = getNewsletterSchedules(userId);
  let dueScheduleName: string | null = null;

  if (schedules.length === 0) {
    // Fallback: use NEWSLETTER_DIGEST_TIME-like default (07:00)
    const lastDigest = getLastDigestDate(userId);
    if (lastDigest === today) {
      return NextResponse.json({ pending: false });
    }
    // Default to 7:00 AM
    const diff = Math.abs(currentMinutes - 7 * 60);
    if (diff > 7) {
      return NextResponse.json({ pending: false });
    }
    dueScheduleName = "default";
  } else {
    for (const schedule of schedules) {
      const [targetH, targetM] = schedule.time.split(":").map(Number);
      const diff = Math.abs(currentMinutes - (targetH * 60 + targetM));
      // Wider window (7 min) since Oneshot cron runs every 15 min
      if (diff > 7) continue;

      const scheduleDays = schedule.days ?? [0, 1, 2, 3, 4, 5, 6];
      if (!scheduleDays.includes(currentDow)) continue;

      const scheduleId = schedule.id || "default";
      const lastRun = getLastScheduleRun(userId, scheduleId);
      if (lastRun === today) continue;

      dueScheduleName = schedule.name || scheduleId;
      break;
    }

    if (!dueScheduleName) {
      return NextResponse.json({ pending: false });
    }
  }

  // A digest is due — return all needed data
  const emails = getUndigestedEmails(userId);
  if (emails.length === 0) {
    return NextResponse.json({ pending: false, reason: "no_undigested_emails" });
  }

  const systemPrompt = getUserConfig(userId, "newsletter_system_prompt") || "";
  const digestPrompt = getUserConfig(userId, "newsletter_digest_prompt") || "";
  const recentDigests = getRecentDigestTexts(userId, 5);

  return NextResponse.json({
    pending: true,
    user_id: userId,
    schedule_name: dueScheduleName,
    emails: emails.map((e) => ({
      id: e.id,
      from_address: e.from_address,
      from_name: e.from_name,
      subject: e.subject,
      body_text: e.body_text.slice(0, 8000),
      received_at: e.received_at,
    })),
    system_prompt: systemPrompt,
    digest_prompt: digestPrompt,
    recent_digests: recentDigests.map((d) => ({
      id: d.id,
      digest_date: d.digest_date,
      subject: d.subject,
      digest_url: `https://news.raakode.dk/api/newsletter/digest/${d.id}/html`,
      digest_html: (d.digest_html || "").slice(0, 8000),
    })),
  });
}
