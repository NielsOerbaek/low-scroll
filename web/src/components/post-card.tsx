"use client";

import Link from "next/link";
import { useState, useRef, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MediaCarousel } from "@/components/media-carousel";

interface PostMedia {
  id: number;
  post_id: string;
  media_type: "image" | "video";
  file_path: string;
  thumbnail_path: string | null;
  order: number;
}

interface FbComment {
  id: number;
  author_name: string;
  content: string;
}

interface PostCardProps {
  post: {
    id: string;
    username?: string;
    type: string;
    caption?: string | null;
    timestamp: string;
    media?: PostMedia[];
    // Unified feed fields
    source_name?: string;
    content?: string | null;
    platform?: "instagram" | "facebook";
    permalink?: string;
    comment_count?: number | null;
    comments?: FbComment[];
    author_name?: string;
  };
}

function Caption({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el) {
      setClamped(el.scrollHeight > el.clientHeight);
    }
  }, [text]);

  return (
    <CardContent className="px-3 py-0.5">
      <p
        ref={ref}
        className={`text-sm text-muted-foreground ${expanded ? "" : "line-clamp-3"}`}
      >
        {text}
      </p>
      {clamped && !expanded && (
        <button
          onClick={() => setExpanded(true)}
          className="text-sm text-foreground/60 hover:text-foreground/80 mt-0.5"
        >
          more
        </button>
      )}
    </CardContent>
  );
}

export function PostCard({ post }: PostCardProps) {
  const isFb = post.platform === "facebook";

  if (isFb) {
    return (
      <Card className="overflow-hidden !py-0 !gap-0">
        <div className="flex items-center gap-2 px-3 py-0.5">
          <span className="text-sm font-semibold">{post.source_name}</span>
          <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-700">fb</Badge>
          {post.source_name !== post.author_name && post.author_name && (
            <span className="text-xs text-muted-foreground">{post.author_name}</span>
          )}
          <span className="text-xs text-muted-foreground ml-auto">
            {new Date(post.timestamp).toLocaleDateString()}
          </span>
        </div>
        {post.content && <Caption text={post.content} />}
        {post.comments && post.comments.length > 0 && (
          <CardContent className="px-3 py-1 border-t">
            {post.comments.map((c, i) => (
              <p key={i} className="text-xs text-muted-foreground py-0.5">
                <span className="font-medium text-foreground">{c.author_name}</span>{" "}
                {c.content}
              </p>
            ))}
          </CardContent>
        )}
        <CardContent className="px-3 py-1 border-t">
          <div className="flex items-center gap-2">
            {post.comment_count != null && post.comment_count > 0 && (
              <span className="text-xs text-muted-foreground">
                {post.comment_count} comment{post.comment_count !== 1 ? "s" : ""}
              </span>
            )}
            {post.permalink && (
              <a
                href={post.permalink}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-600 hover:underline ml-auto"
              >
                View on Facebook &rarr;
              </a>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Original IG rendering
  const username = post.username || post.source_name || "";
  return (
    <Card className="overflow-hidden !py-0 !gap-0">
      <div className="flex items-center gap-2 px-3 py-0.5">
        <Link href={`/account/${username}`} className="text-sm font-semibold hover:underline">
          @{username}
        </Link>
        <Badge variant="secondary" className="text-xs">{post.type}</Badge>
        <span className="text-xs text-muted-foreground ml-auto">
          {new Date(post.timestamp).toLocaleDateString()}
        </span>
      </div>
      {post.media && <MediaCarousel media={post.media} />}
      {(post.caption || post.content) && <Caption text={(post.caption || post.content)!} />}
    </Card>
  );
}
