import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import {
  getFirstActiveUserId,
  getUndigestedEmails,
  insertDigestRun,
  finishDigestRun,
  saveDigestHtml,
  markEmailsDigested,
  saveEmailSummary,
  getNewsletterRecipients,
  getNewsletterSchedules,
  setLastScheduleRun,
} from "@/lib/db";

function authCheck(request: NextRequest): boolean {
  const expected = process.env.ONESHOT_API_KEY || "";
  if (!expected) return false;
  const auth = request.headers.get("authorization") || "";
  return auth === `Bearer ${expected}`;
}

function cleanSender(fromAddress: string, fallback: string = ""): string {
  const domain = fromAddress.includes("@")
    ? fromAddress.split("@").pop()!
    : fromAddress;
  const generic = new Set([
    "ghost.io", "substack.com", "mcsv.net", "mcdlv.net", "mailchimp.com",
  ]);
  if ([...generic].some((g) => domain === g || domain.endsWith("." + g))) {
    return fallback || domain;
  }
  const clean = domain.replace(
    /^(ghost|notify|bounces?|mg-?\w*|m|em\d*\.mail|mail\d*\.suw\d*)\./i,
    ""
  );
  const name = clean.split(".")[0];
  return name ? name[0].toUpperCase() + name.slice(1) : domain;
}

function buildDigestHtml(
  digestContent: string,
  digestDate: string,
  emails: { id: number; subject: string; from_address: string; from_name: string }[]
): string {
  // Danish date formatting
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

  // Build original newsletter links
  let emailLinks = "";
  if (emails.length > 0) {
    emailLinks = emails
      .map((e) => {
        const senderDisplay =
          (e.from_name || "").trim() ||
          cleanSender(e.from_address, e.subject);
        return `<p style="margin:0 0 4px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:13px;">
            <a href="https://news.raakode.dk/api/newsletter/email/${e.id}/html" style="color:#1A2C4E;text-decoration:underline;">${escapeHtml(e.subject)}</a>
            <span style="color:#8e8e8e;"> — ${escapeHtml(senderDisplay)}</span>
          </p>`;
      })
      .join("\n");
    emailLinks = `<tr><td style="padding:16px 24px;border-top:1px solid #eee;">
          <p style="margin:0 0 8px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:13px;color:#8e8e8e;font-weight:600;">Læs originale nyhedsbreve:</p>
          ${emailLinks}
        </td></tr>`;
  }

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
          <table cellpadding="0" cellspacing="0"><tr><td align="center" style="line-height:1;">
            <span style="font-size:32px;font-weight:900;font-family:'Arial Black',Arial,sans-serif;letter-spacing:-0.5px;color:#E8401C;">Føhns</span><span style="font-size:32px;font-weight:900;font-family:'Arial Black',Arial,sans-serif;letter-spacing:-0.5px;color:#1A2C4E;">Stiftstidende</span>
            <br>
            <span style="font-size:11px;font-weight:600;color:#1A2C4E;letter-spacing:0.5px;font-family:Arial,sans-serif;">news.raakode.dk</span>
          </td></tr></table>
          <div style="margin-top:12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;color:#8e8e8e;">${escapeHtml(formattedDate)}</div>
        </td></tr>

        <!-- Digest content -->
        <tr><td style="padding:20px 24px;">
          <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:16px;color:#262626;line-height:1.7;">
            ${digestContent}
          </div>
        </td></tr>

        <!-- Original newsletters -->
        ${emailLinks}

        <!-- Footer -->
        <tr><td style="padding:16px 24px;border-top:1px solid #eee;">
          <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:13px;color:#8e8e8e;">
            <a href="https://news.raakode.dk" style="color:#8e8e8e;text-decoration:underline;">Administrer indstillinger</a>
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
  const {
    title,
    digest_html: digestContent,
    summaries,
    schedule_name: scheduleName,
  } = body as {
    title: string;
    digest_html: string;
    summaries?: { email_id: number; summary: string }[];
    schedule_name?: string;
  };

  if (!title || !digestContent) {
    return NextResponse.json(
      { error: "Missing required fields: title, digest_html" },
      { status: 400 }
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const runId = insertDigestRun(userId, today);

  try {
    // Get current undigested emails for template rendering
    const emails = getUndigestedEmails(userId);

    // Save per-email summaries if provided
    if (summaries && Array.isArray(summaries)) {
      for (const s of summaries) {
        saveEmailSummary(s.email_id, s.summary);
      }
    }

    // Build final HTML email
    const html = buildDigestHtml(digestContent, today, emails);
    saveDigestHtml(runId, html);

    // Send email via Resend
    const resendApiKey = process.env.RESEND_API_KEY;
    if (!resendApiKey) {
      throw new Error("RESEND_API_KEY not configured");
    }

    const recipients = getNewsletterRecipients(userId);
    if (recipients.length === 0) {
      throw new Error("No email recipients configured");
    }

    const resend = new Resend(resendApiKey);
    await resend.emails.send({
      from: "FøhnsStiftstidende <newsletters@raakode.dk>",
      to: recipients,
      subject: title,
      html,
    });

    // Mark emails as digested
    const emailIds = emails.map((e) => e.id);
    markEmailsDigested(emailIds, today);

    // Record schedule run
    if (scheduleName) {
      const schedules = getNewsletterSchedules(userId);
      const schedule = schedules.find(
        (s) => s.name === scheduleName || s.id === scheduleName
      );
      if (schedule) {
        setLastScheduleRun(userId, schedule.id || "default", today);
      }
    }

    finishDigestRun(runId, "success", emailIds.length, null, title, scheduleName || null);

    return NextResponse.json({
      ok: true,
      run_id: runId,
      emails_digested: emailIds.length,
      recipients,
    });
  } catch (error: any) {
    finishDigestRun(runId, "error", 0, error.message);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
