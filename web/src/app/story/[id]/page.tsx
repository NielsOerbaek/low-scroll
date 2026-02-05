import { getPost, getMediaForPost } from "@/lib/db";
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

      {media.map((m) => (
        <div key={m.id} className="mb-4">
          {m.media_type === "image" ? (
            <img src={`/api/media/${m.file_path}`} alt="" className="w-full rounded-lg" />
          ) : (
            <video src={`/api/media/${m.file_path}`} controls autoPlay muted className="w-full rounded-lg" />
          )}
        </div>
      ))}
    </div>
  );
}
