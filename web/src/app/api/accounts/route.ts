import { NextResponse } from "next/server";
import { getAccounts } from "@/lib/db";

export async function GET() {
  try {
    const accounts = getAccounts();
    return NextResponse.json({ accounts });
  } catch {
    return NextResponse.json({ accounts: [] });
  }
}
