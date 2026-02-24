import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { getManualRunLog } from "@/lib/db";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let userId: number;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const runId = parseInt(id, 10);
  if (isNaN(runId)) {
    return NextResponse.json({ error: "Invalid run ID" }, { status: 400 });
  }
  const log = getManualRunLog(userId, runId);
  return NextResponse.json({ log });
}
