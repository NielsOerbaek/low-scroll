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
    <div className="flex gap-6">
      {accounts.length > 0 && (
        <aside className="w-1/4 shrink-0 hidden md:block">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Accounts
          </h2>
          <nav className="space-y-1">
            {accounts.map((a) => (
              <Link
                key={a.username}
                href={`/account/${a.username}`}
                className="flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-accent transition-colors"
              >
                {a.profile_pic_path ? (
                  <img
                    src={`/api/media/${a.profile_pic_path}`}
                    alt={a.username}
                    className="w-6 h-6 rounded-full object-cover"
                  />
                ) : (
                  <span className="w-6 h-6 rounded-full bg-muted" />
                )}
                <span className="truncate">@{a.username}</span>
              </Link>
            ))}
          </nav>
        </aside>
      )}
      <div className="flex-1 min-w-0">
        <Feed />
      </div>
    </div>
  );
}
