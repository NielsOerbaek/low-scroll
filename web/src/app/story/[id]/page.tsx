import { getPost, getMediaForPost } from "@/lib/db";
import { MediaCarousel } from "@/components/media-carousel";
import Link from "next/link";
import { notFound } from "next/navigation";

export default async function StoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const story = getPost(id);
  if (!story) notFound();

  const media = getMediaForPost(id);

  return (
    <div className="max-w-lg mx-auto">
      <div className="mb-4">
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">&larr; Back to feed</Link>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <Link href={`/account/${story.username}`} className="font-semibold hover:underline">
          @{story.username}
        </Link>
        <span className="text-sm text-muted-foreground">
          {new Date(story.timestamp).toLocaleString()}
        </span>
      </div>

      <div className="rounded-lg overflow-hidden">
        <MediaCarousel media={media} />
      </div>
    </div>
  );
}
