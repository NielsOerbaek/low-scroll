import { NextRequest, NextResponse } from "next/server";
import { insertManualRun, getRecentManualRuns } from "@/lib/db";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const sinceDate = body.sinceDate;

  if (!sinceDate || !/^\d{4}-\d{2}-\d{2}$/.test(sinceDate)) {
    return NextResponse.json(
      { error: "sinceDate is required (YYYY-MM-DD)" },
      { status: 400 }
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  if (sinceDate > today) {
    return NextResponse.json(
      { error: "sinceDate cannot be in the future" },
      { status: 400 }
    );
  }

  const id = insertManualRun(sinceDate);
  return NextResponse.json({ id });
}

export async function GET() {
  const runs = getRecentManualRuns(20);
  return NextResponse.json({ runs });
}
