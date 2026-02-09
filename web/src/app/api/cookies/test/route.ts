import { NextResponse } from "next/server";
import { getConfig, setConfig } from "@/lib/db";

// POST: request a cookie test (scraper picks it up)
export async function POST() {
  setConfig("cookie_test", "pending");
  setConfig("cookie_test_log", "Queued, waiting for scraper to pick up...");
  return NextResponse.json({ ok: true });
}

// GET: poll for result + log
export async function GET() {
  const status = getConfig("cookie_test");
  const log = getConfig("cookie_test_log") || "";

  if (!status || status === "pending" || status === "running") {
    return NextResponse.json({ status: status || "idle", log });
  }

  // Result ready — parse "valid:username" or "error:message"
  const [result, ...rest] = status.split(":");
  const detail = rest.join(":");

  // Clear status so next test starts fresh (keep log for display)
  setConfig("cookie_test", "idle");

  if (result === "valid") {
    return NextResponse.json({ status: "valid", username: detail, log });
  }
  return NextResponse.json({ status: "error", error: detail, log });
}
