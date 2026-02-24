import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { getUserConfig, setUserConfig } from "@/lib/db";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function POST(request: NextRequest) {
  let userId: number;
  try { userId = await requireUserId(); } catch { return unauthorized(); }

  const { searchParams } = new URL(request.url);
  const platform = searchParams.get("platform");

  if (platform === "ig") {
    const current = getUserConfig(userId, "trigger_ig_scrape");
    if (current === "pending" || current === "running") {
      return NextResponse.json({ error: "An IG scrape is already queued or running" }, { status: 409 });
    }
    setUserConfig(userId, "trigger_ig_scrape", "pending");
    return NextResponse.json({ ok: true });
  }

  if (platform === "fb") {
    const current = getUserConfig(userId, "trigger_fb_scrape");
    if (current === "pending" || current === "running") {
      return NextResponse.json({ error: "A FB scrape is already queued or running" }, { status: 409 });
    }
    setUserConfig(userId, "trigger_fb_scrape", "pending");
    return NextResponse.json({ ok: true });
  }

  // Default: trigger full scrape (both platforms)
  const current = getUserConfig(userId, "trigger_scrape");
  if (current === "pending" || current === "running") {
    return NextResponse.json({ error: "A scrape is already queued or running" }, { status: 409 });
  }
  setUserConfig(userId, "trigger_scrape", "pending");
  return NextResponse.json({ ok: true });
}

export async function GET() {
  let userId: number;
  try { userId = await requireUserId(); } catch { return unauthorized(); }

  const status = getUserConfig(userId, "trigger_scrape");
  const igStatus = getUserConfig(userId, "trigger_ig_scrape");
  const fbStatus = getUserConfig(userId, "trigger_fb_scrape");
  return NextResponse.json({
    status: status ?? "idle",
    igStatus: igStatus ?? "idle",
    fbStatus: fbStatus ?? "idle",
  });
}
