"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { PostCard } from "./post-card";
import { Button } from "@/components/ui/button";

interface FeedProps {
  account?: string;
}

const BASE_TABS = [
  { key: "all", label: "All" },
  { key: "post", label: "Posts" },
  { key: "story", label: "Stories" },
] as const;

const FB_TAB = { key: "fb_post", label: "Facebook" } as const;

export function Feed({ account }: FeedProps) {
  const [posts, setPosts] = useState<any[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<string>("all");
  const [fbEnabled, setFbEnabled] = useState(false);
  const offsetRef = useRef(0);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => setFbEnabled(data.fbEnabled))
      .catch(() => {});
  }, []);

  const tabs = fbEnabled ? [...BASE_TABS, FB_TAB] : BASE_TABS;

  const loadPosts = useCallback(async (reset = false) => {
    setLoading(true);
    if (reset) offsetRef.current = 0;
    const params = new URLSearchParams({
      limit: "20",
      offset: String(offsetRef.current),
    });
    if (account) params.set("account", account);
    if (tab !== "all") params.set("type", tab);

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
  }, [account, tab]);

  useEffect(() => {
    loadPosts(true);
  }, [loadPosts]);

  return (
    <div>
      <div className="flex gap-1 border-b mb-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === t.key
                ? "border-b-2 border-foreground text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="space-y-2">
        {posts.map((post) => (
          <PostCard key={post.id} post={post} />
        ))}
      </div>
      {posts.length === 0 && !loading && (
        <p className="text-center text-muted-foreground py-12">No posts yet.</p>
      )}
      {hasMore && posts.length > 0 && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => loadPosts()} disabled={loading}>
            {loading ? "Loading..." : "Load more"}
          </Button>
        </div>
      )}
    </div>
  );
}
