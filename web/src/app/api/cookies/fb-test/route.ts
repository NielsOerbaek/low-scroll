import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { getUserConfig, setUserConfig } from "@/lib/db";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function POST() {
  let userId: number;
  try { userId = await requireUserId(); } catch { return unauthorized(); }

  setUserConfig(userId, "fb_cookie_test", "pending");
  setUserConfig(userId, "fb_cookie_test_log", "Queued, waiting for scraper to pick up...");
  return NextResponse.json({ ok: true });
}

export async function GET() {
  let userId: number;
  try { userId = await requireUserId(); } catch { return unauthorized(); }

  const status = getUserConfig(userId, "fb_cookie_test");
  const log = getUserConfig(userId, "fb_cookie_test_log") || "";

  if (!status || status === "pending" || status === "running") {
    return NextResponse.json({ status: status || "idle", log });
  }

  const [result, ...rest] = status.split(":");
  const detail = rest.join(":");

  setUserConfig(userId, "fb_cookie_test", "idle");

  if (result === "valid") {
    return NextResponse.json({ status: "valid", userId: detail, log });
  }
  return NextResponse.json({ status: "error", error: detail, log });
}
