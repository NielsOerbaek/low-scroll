import { NextRequest, NextResponse } from "next/server";
import { getUnifiedFeed, getMediaForPost, getCommentsForPost } from "@/lib/db";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20") || 20));
  const offset = Math.max(0, parseInt(searchParams.get("offset") || "0") || 0);
  const account = searchParams.get("account") || undefined;
  const type = searchParams.get("type") || undefined;
  const platform = searchParams.get("platform") || undefined;
  const groupId = searchParams.get("groupId") || undefined;

  try {
    const posts = getUnifiedFeed(limit, offset, account, type, platform, groupId);
    const enriched = posts.map((post) => {
      if (post.platform === "instagram") {
        return { ...post, media: getMediaForPost(post.id) };
      }
      // FB posts: attach comments
      return { ...post, comments: getCommentsForPost(post.id) };
    });

    return NextResponse.json({ posts: enriched, hasMore: posts.length === limit });
  } catch {
    return NextResponse.json({ posts: [], hasMore: false });
  }
}
