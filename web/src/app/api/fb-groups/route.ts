import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { getFbGroups, addFbGroup, deleteFbGroup, setUserConfig } from "@/lib/db";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function GET() {
  let userId: number;
  try { userId = await requireUserId(); } catch { return unauthorized(); }

  try {
    const groups = getFbGroups(userId);
    return NextResponse.json({ groups });
  } catch {
    return NextResponse.json({ groups: [] });
  }
}

export async function POST(request: NextRequest) {
  let userId: number;
  try { userId = await requireUserId(); } catch { return unauthorized(); }

  const body = await request.json();
  const { groupId, name, url } = body;

  if (!groupId || !url) {
    return NextResponse.json({ error: "groupId and url are required" }, { status: 400 });
  }

  try {
    const groups = getFbGroups(userId);
    if (groups.length >= 3) {
      return NextResponse.json({ error: "Maximum 3 groups allowed" }, { status: 400 });
    }
    addFbGroup(userId, groupId, name || `Group ${groupId}`, url);
    setUserConfig(userId, "fb_group_resolve", "pending");
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  let userId: number;
  try { userId = await requireUserId(); } catch { return unauthorized(); }

  const { searchParams } = new URL(request.url);
  const groupId = searchParams.get("groupId");

  if (!groupId) {
    return NextResponse.json({ error: "groupId is required" }, { status: 400 });
  }

  try {
    deleteFbGroup(userId, groupId);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
