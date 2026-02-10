import { NextResponse } from "next/server";
import { getConfig, setConfig } from "@/lib/db";

export async function POST() {
  setConfig("fb_cookie_test", "pending");
  setConfig("fb_cookie_test_log", "Queued, waiting for scraper to pick up...");
  return NextResponse.json({ ok: true });
}

export async function GET() {
  const status = getConfig("fb_cookie_test");
  const log = getConfig("fb_cookie_test_log") || "";

  if (!status || status === "pending" || status === "running") {
    return NextResponse.json({ status: status || "idle", log });
  }

  const [result, ...rest] = status.split(":");
  const detail = rest.join(":");

  setConfig("fb_cookie_test", "idle");

  if (result === "valid") {
    return NextResponse.json({ status: "valid", userId: detail, log });
  }
  return NextResponse.json({ status: "error", error: detail, log });
}
