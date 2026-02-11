import { NextRequest, NextResponse } from "next/server";
import { getConfig, setConfig } from "@/lib/db";

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const platform = searchParams.get("platform");

  if (platform === "ig") {
    const current = getConfig("trigger_ig_scrape");
    if (current === "pending" || current === "running") {
      return NextResponse.json({ error: "An IG scrape is already queued or running" }, { status: 409 });
    }
    setConfig("trigger_ig_scrape", "pending");
    return NextResponse.json({ ok: true });
  }

  if (platform === "fb") {
    const current = getConfig("trigger_fb_scrape");
    if (current === "pending" || current === "running") {
      return NextResponse.json({ error: "A FB scrape is already queued or running" }, { status: 409 });
    }
    setConfig("trigger_fb_scrape", "pending");
    return NextResponse.json({ ok: true });
  }

  // Default: trigger full scrape (both platforms)
  const current = getConfig("trigger_scrape");
  if (current === "pending" || current === "running") {
    return NextResponse.json({ error: "A scrape is already queued or running" }, { status: 409 });
  }
  setConfig("trigger_scrape", "pending");
  return NextResponse.json({ ok: true });
}

export async function GET() {
  const status = getConfig("trigger_scrape");
  const igStatus = getConfig("trigger_ig_scrape");
  const fbStatus = getConfig("trigger_fb_scrape");
  return NextResponse.json({
    status: status ?? "idle",
    igStatus: igStatus ?? "idle",
    fbStatus: fbStatus ?? "idle",
  });
}
