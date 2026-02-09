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

interface PostCardProps {
  post: {
    id: string;
    username: string;
    type: "post" | "reel" | "story";
    caption: string | null;
    timestamp: string;
    media: PostMedia[];
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
  return (
    <Card className="overflow-hidden !py-0 !gap-0">
      <div className="flex items-center gap-2 px-3 py-0.5">
        <Link href={`/account/${post.username}`} className="text-sm font-semibold hover:underline">
          @{post.username}
        </Link>
        <Badge variant="secondary" className="text-xs">{post.type}</Badge>
        <span className="text-xs text-muted-foreground ml-auto">
          {new Date(post.timestamp).toLocaleDateString()}
        </span>
      </div>
      <MediaCarousel media={post.media} />
      {post.caption && <Caption text={post.caption} />}
    </Card>
  );
}
