import { NextResponse } from "next/server";
import { getConfig, setConfig } from "@/lib/db";

// POST: request a cookie test (scraper picks it up)
export async function POST() {
  setConfig("cookie_test", "pending");
  return NextResponse.json({ ok: true });
}

// GET: poll for result
export async function GET() {
  const status = getConfig("cookie_test");
  if (!status || status === "pending" || status === "running") {
    return NextResponse.json({ status: status || "idle" });
  }

  // Result ready — parse "valid:username" or "error:message"
  const [result, ...rest] = status.split(":");
  const detail = rest.join(":");

  // Clear so next test starts fresh
  setConfig("cookie_test", "idle");

  if (result === "valid") {
    return NextResponse.json({ status: "valid", username: detail });
  }
  return NextResponse.json({ status: "error", error: detail });
}
