import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { getDigestRunHtml, getFirstActiveUserId } from "@/lib/db";

async function resolveUserId(): Promise<number | null> {
  const sessionUserId = await getCurrentUserId();
  if (sessionUserId) return sessionUserId;
  return getFirstActiveUserId();
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await resolveUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const runId = parseInt(id, 10);
  if (isNaN(runId)) return new NextResponse("Bad request", { status: 400 });

  const html = getDigestRunHtml(userId, runId);
  if (!html) return new NextResponse("Not found", { status: 404 });

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "script-src 'none'",
    },
  });
}
