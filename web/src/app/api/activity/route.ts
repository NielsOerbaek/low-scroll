import { NextResponse } from "next/server";
import { getRecentScrapeRuns, getRecentManualRuns, getScrapeRunLog, getManualRunLog } from "@/lib/db";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const logType = searchParams.get("logType"); // "scrape" | "manual"
  const logId = searchParams.get("logId");

  if (logType && logId) {
    const id = Number(logId);
    const log = logType === "scrape" ? getScrapeRunLog(id) : getManualRunLog(id);
    return NextResponse.json({ log });
  }

  const scrapeRuns = getRecentScrapeRuns(20).map((r) => ({
    ...r,
    kind: "scheduled" as const,
  }));

  const manualRuns = getRecentManualRuns(20).map((r) => ({
    id: r.id,
    kind: "manual" as const,
    started_at: r.started_at ?? r.created_at,
    finished_at: r.finished_at,
    status: r.status,
    new_posts_count: r.new_posts_count,
    new_stories_count: r.new_stories_count,
    error: r.error,
    since_date: r.since_date,
  }));

  // Merge and sort by start time descending
  const all = [...scrapeRuns, ...manualRuns].sort((a, b) => {
    const ta = a.started_at ?? "";
    const tb = b.started_at ?? "";
    return tb.localeCompare(ta);
  });

  return NextResponse.json({ runs: all });
}
