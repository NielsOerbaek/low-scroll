import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { getAccounts } from "@/lib/db";

export async function GET() {
  let userId: number;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const accounts = getAccounts(userId);
    return NextResponse.json({ accounts });
  } catch {
    return NextResponse.json({ accounts: [] });
  }
}
