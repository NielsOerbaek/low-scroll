"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { PostCard } from "./post-card";
import { Button } from "@/components/ui/button";

interface FeedProps {
  account?: string;
}

export function Feed({ account }: FeedProps) {
  const [posts, setPosts] = useState<any[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const offsetRef = useRef(0);

  const loadPosts = useCallback(async (reset = false) => {
    setLoading(true);
    if (reset) offsetRef.current = 0;
    const params = new URLSearchParams({
      limit: "20",
      offset: String(offsetRef.current),
    });
    if (account) params.set("account", account);

    const res = await fetch(`/api/feed?${params}`);
    const data = await res.json();

    if (reset) {
      setPosts(data.posts);
    } else {
      setPosts((prev) => [...prev, ...data.posts]);
    }
    offsetRef.current += data.posts.length;
    setHasMore(data.hasMore);
    setLoading(false);
  }, [account]);

  useEffect(() => {
    loadPosts(true);
  }, [loadPosts]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {posts.map((post) => (
          <PostCard key={post.id} post={post} />
        ))}
      </div>
      {posts.length === 0 && !loading && (
        <p className="text-center text-muted-foreground py-12">No posts yet.</p>
      )}
      {hasMore && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => loadPosts()} disabled={loading}>
            {loading ? "Loading..." : "Load more"}
          </Button>
        </div>
      )}
    </div>
  );
}
