import { NextRequest, NextResponse } from "next/server";
import { getManualRunLog } from "@/lib/db";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const runId = parseInt(id, 10);
  if (isNaN(runId)) {
    return NextResponse.json({ error: "Invalid run ID" }, { status: 400 });
  }
  const log = getManualRunLog(runId);
  return NextResponse.json({ log });
}
