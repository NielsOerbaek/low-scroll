import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

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

export function PostCard({ post }: PostCardProps) {
  const firstMedia = post.media[0];
  const displayPath = firstMedia?.thumbnail_path || firstMedia?.file_path;
  const detailUrl = post.type === "story" ? `/story/${post.id}` : `/post/${post.id}`;

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3">
        <Link href={`/account/${post.username}`} className="text-sm font-semibold hover:underline">
          @{post.username}
        </Link>
        <Badge variant="secondary" className="text-xs">{post.type}</Badge>
        {post.media.length > 1 && (
          <Badge variant="outline" className="text-xs">{post.media.length} items</Badge>
        )}
        <span className="text-xs text-muted-foreground ml-auto">
          {new Date(post.timestamp).toLocaleDateString()}
        </span>
      </div>
      <Link href={detailUrl}>
        {displayPath && firstMedia.media_type === "image" && (
          <img
            src={`/api/media/${displayPath}`}
            alt={post.caption || ""}
            className="max-w-full"
          />
        )}
        {displayPath && firstMedia.media_type === "video" && (
          <video
            src={`/api/media/${firstMedia.file_path}`}
            className="max-w-full"
            muted
            playsInline
          />
        )}
      </Link>
      {post.caption && (
        <CardContent className="px-4 py-3">
          <p className="text-sm text-muted-foreground line-clamp-4">{post.caption}</p>
        </CardContent>
      )}
    </Card>
  );
}
