import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const expected = process.env.NEWS_PASSWORD || "";
  if (!expected) {
    return new Response(null, { status: 403 });
  }

  const auth = request.headers.get("authorization") || "";
  if (auth.startsWith("Basic ")) {
    const decoded = Buffer.from(auth.slice(6), "base64").toString();
    const password = decoded.split(":").slice(1).join(":");
    if (password === expected) {
      return new Response(null, { status: 200 });
    }
  }

  return new Response(null, {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Oneshot"' },
  });
}
