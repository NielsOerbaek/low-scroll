import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { deleteSession } from "@/lib/db";

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const session = cookieStore.get("ig_session");
  if (session?.value) {
    deleteSession(session.value);
  }
  const response = NextResponse.redirect(new URL("/login", request.url));
  response.cookies.delete("ig_session");
  return response;
}
