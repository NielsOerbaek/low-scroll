import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const session = request.cookies.get("ig_session");
  const isLoginPage = request.nextUrl.pathname === "/login";
  const isAuthApi = request.nextUrl.pathname === "/api/auth";

  const isExtensionApi = request.nextUrl.pathname === "/api/extension/cookies";

  if (isLoginPage || isAuthApi || isExtensionApi) {
    return NextResponse.next();
  }

  if (!session?.value || !/^[a-f0-9]{64}$/.test(session.value)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|icon-.*\\.png|apple-touch-icon\\.png).*)"],
};
