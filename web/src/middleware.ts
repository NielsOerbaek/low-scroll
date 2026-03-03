import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const host = request.headers.get("host") || "";
  const isNewsDomain = host.startsWith("news.");

  // news.raakode.dk is public — no auth required
  if (isNewsDomain) {
    if (request.nextUrl.pathname === "/" || request.nextUrl.pathname === "/login") {
      return NextResponse.rewrite(new URL("/newsletters", request.url));
    }
    return NextResponse.next();
  }

  const session = request.cookies.get("ig_session");
  const isPublicPage = request.nextUrl.pathname === "/login"
    || request.nextUrl.pathname === "/signup"
    || request.nextUrl.pathname === "/";
  const isPublicApi = request.nextUrl.pathname === "/api/auth"
    || request.nextUrl.pathname === "/api/auth/logout"
    || request.nextUrl.pathname.startsWith("/api/extension/")
    || request.nextUrl.pathname.startsWith("/api/webhooks/");

  if (isPublicPage || isPublicApi) {
    return NextResponse.next();
  }

  if (!session?.value || !/^[a-f0-9]{64}$/.test(session.value)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|icon-.*\\.png|apple-touch-icon\\.png|manifest\\.json|sw\\.js).*)"],
};
