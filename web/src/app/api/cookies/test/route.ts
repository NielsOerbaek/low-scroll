import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { getUserConfig, setUserConfig } from "@/lib/db";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

// POST: request a cookie test (scraper picks it up)
export async function POST() {
  let userId: number;
  try { userId = await requireUserId(); } catch { return unauthorized(); }

  setUserConfig(userId, "cookie_test", "pending");
  setUserConfig(userId, "cookie_test_log", "Queued, waiting for scraper to pick up...");
  return NextResponse.json({ ok: true });
}

// GET: poll for result + log
export async function GET() {
  let userId: number;
  try { userId = await requireUserId(); } catch { return unauthorized(); }

  const status = getUserConfig(userId, "cookie_test");
  const log = getUserConfig(userId, "cookie_test_log") || "";

  if (!status || status === "pending" || status === "running") {
    return NextResponse.json({ status: status || "idle", log });
  }

  // Result ready — parse "valid:username" or "error:message"
  const [result, ...rest] = status.split(":");
  const detail = rest.join(":");

  // Clear status so next test starts fresh (keep log for display)
  setUserConfig(userId, "cookie_test", "idle");

  if (result === "valid") {
    return NextResponse.json({ status: "valid", username: detail, log });
  }
  return NextResponse.json({ status: "error", error: detail, log });
}
