import { NextRequest, NextResponse } from "next/server";
import { getFeed, getMediaForPost } from "@/lib/db";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20") || 20));
  const offset = Math.max(0, parseInt(searchParams.get("offset") || "0") || 0);
  const account = searchParams.get("account") || undefined;

  try {
    const posts = getFeed(limit, offset, account);
    const enriched = posts.map((post) => ({
      ...post,
      media: getMediaForPost(post.id),
    }));

    return NextResponse.json({ posts: enriched, hasMore: posts.length === limit });
  } catch {
    return NextResponse.json({ posts: [], hasMore: false });
  }
}
