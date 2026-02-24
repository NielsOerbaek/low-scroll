import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { isUserAdmin, getAllUsers, setUserActive } from "@/lib/db";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function forbidden() {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

export async function GET() {
  let userId: number;
  try { userId = await requireUserId(); } catch { return unauthorized(); }
  if (!isUserAdmin(userId)) return forbidden();
  return NextResponse.json({ users: getAllUsers() });
}

export async function PATCH(request: NextRequest) {
  let userId: number;
  try { userId = await requireUserId(); } catch { return unauthorized(); }
  if (!isUserAdmin(userId)) return forbidden();
  const { targetUserId, is_active } = await request.json();
  setUserActive(targetUserId, is_active);
  return NextResponse.json({ ok: true });
}
