import { NextRequest, NextResponse } from "next/server";
import { getFbGroups, addFbGroup, deleteFbGroup, setConfig } from "@/lib/db";

export async function GET() {
  try {
    const groups = getFbGroups();
    return NextResponse.json({ groups });
  } catch {
    return NextResponse.json({ groups: [] });
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { groupId, name, url } = body;

  if (!groupId || !url) {
    return NextResponse.json({ error: "groupId and url are required" }, { status: 400 });
  }

  try {
    const groups = getFbGroups();
    if (groups.length >= 3) {
      return NextResponse.json({ error: "Maximum 3 groups allowed" }, { status: 400 });
    }
    addFbGroup(groupId, name || `Group ${groupId}`, url);
    setConfig("fb_group_resolve", "pending");
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const groupId = searchParams.get("groupId");

  if (!groupId) {
    return NextResponse.json({ error: "groupId is required" }, { status: 400 });
  }

  try {
    deleteFbGroup(groupId);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
