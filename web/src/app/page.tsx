import { Feed } from "@/components/feed";
import { getAccounts } from "@/lib/db";
import Link from "next/link";

export default function HomePage() {
  let accounts: any[] = [];
  try {
    accounts = getAccounts();
  } catch {
    // DB may not exist yet
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Feed</h1>
        {accounts.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {accounts.map((a) => (
              <Link
                key={a.username}
                href={`/account/${a.username}`}
                className="text-sm px-3 py-1 rounded-full border hover:bg-accent"
              >
                @{a.username}
              </Link>
            ))}
          </div>
        )}
      </div>
      <Feed />
    </div>
  );
}
