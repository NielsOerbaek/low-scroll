import { NextResponse } from "next/server";
import { getConfig, setConfig } from "@/lib/db";

export async function POST() {
  const current = getConfig("trigger_scrape");
  if (current === "pending" || current === "running") {
    return NextResponse.json(
      { error: "A scrape is already queued or running" },
      { status: 409 }
    );
  }

  setConfig("trigger_scrape", "pending");
  return NextResponse.json({ ok: true });
}

export async function GET() {
  const status = getConfig("trigger_scrape");
  return NextResponse.json({ status: status ?? "idle" });
}
