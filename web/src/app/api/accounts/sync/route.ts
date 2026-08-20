import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { getUserConfig, setUserConfig } from "@/lib/db";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function POST() {
  let userId: number;
  try { userId = await requireUserId(); } catch { return unauthorized(); }

  const current = getUserConfig(userId, "trigger_sync_following");
  if (current === "pending" || current === "running") {
    return NextResponse.json({ error: "A sync is already queued or running" }, { status: 409 });
  }
  setUserConfig(userId, "trigger_sync_following", "pending");
  return NextResponse.json({ ok: true });
}

export async function GET() {
  let userId: number;
  try { userId = await requireUserId(); } catch { return unauthorized(); }

  const status = getUserConfig(userId, "trigger_sync_following");
  return NextResponse.json({ status: status ?? "idle" });
}
