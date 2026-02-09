import { getPost, getMediaForPost } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { MediaCarousel } from "@/components/media-carousel";
import Link from "next/link";
import { notFound } from "next/navigation";

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const post = getPost(id);
  if (!post) notFound();

  const media = getMediaForPost(id);

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-4">
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">&larr; Back to feed</Link>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <Link href={`/account/${post.username}`} className="font-semibold hover:underline">
          @{post.username}
        </Link>
        <Badge variant="secondary">{post.type}</Badge>
        <span className="text-sm text-muted-foreground">
          {new Date(post.timestamp).toLocaleString()}
        </span>
      </div>

      <div className="rounded-lg overflow-hidden">
        <MediaCarousel media={media} />
      </div>

      {post.caption && (
        <p className="mt-4 text-sm whitespace-pre-wrap">{post.caption}</p>
      )}

      {post.permalink && (
        <a
          href={post.permalink}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block mt-4 text-sm text-muted-foreground hover:text-foreground"
        >
          View on Instagram &rarr;
        </a>
      )}
    </div>
  );
}
