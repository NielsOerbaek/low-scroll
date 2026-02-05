import { Feed } from "@/components/feed";
import Link from "next/link";

export default async function AccountPage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;

  return (
    <div>
      <div className="mb-4">
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">&larr; Back to feed</Link>
      </div>
      <h1 className="text-2xl font-bold mb-6">@{username}</h1>
      <Feed account={username} />
    </div>
  );
}
