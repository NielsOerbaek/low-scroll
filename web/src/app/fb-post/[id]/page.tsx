import { getFbPost, getCommentsForPost } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { notFound } from "next/navigation";

export default async function FbPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const post = getFbPost(id);
  if (!post) notFound();

  const comments = getCommentsForPost(id);

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-4">
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">&larr; Back to feed</Link>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <span className="font-semibold">{post.author_name}</span>
        <Badge variant="secondary" className="bg-blue-100 text-blue-700">facebook</Badge>
        <span className="text-sm text-muted-foreground">
          {new Date(post.timestamp).toLocaleString()}
        </span>
      </div>

      {post.content && (
        <p className="text-sm whitespace-pre-wrap mb-4">{post.content}</p>
      )}

      {comments.length > 0 && (
        <div className="border-t pt-4 space-y-2">
          <h3 className="text-sm font-semibold">Comments</h3>
          {comments.map((c) => (
            <div key={c.id} className="text-sm">
              <span className="font-medium">{c.author_name}</span>{" "}
              <span className="text-muted-foreground">{c.content}</span>
            </div>
          ))}
        </div>
      )}

      {post.permalink && (
        <a
          href={post.permalink}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block mt-4 text-sm text-blue-600 hover:underline"
        >
          View on Facebook &rarr;
        </a>
      )}
    </div>
  );
}
