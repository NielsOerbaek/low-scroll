"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface Account {
  username: string;
  profile_pic_path: string | null;
}

export function AccountSidebar({ active }: { active?: string } = {}) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    fetch("/api/accounts")
      .then((r) => r.json())
      .then((data) => setAccounts(data.accounts || []))
      .catch(() => {});
  }, []);

  async function handleSync() {
    setSyncing(true);
    try {
      await fetch("/api/accounts/sync", { method: "POST" });
    } catch {
      // ignore
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          Accounts
        </h2>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
          title="Sync follow list from Instagram"
        >
          {syncing ? "Syncing…" : "Sync"}
        </button>
      </div>
      {accounts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No accounts yet. Sync cookies and run a scrape to get started.
        </p>
      ) : (
        <nav className="space-y-1">
          {accounts.map((a) => (
            <Link
              key={a.username}
              href={`/account/${a.username}`}
              className={`flex items-center gap-2 px-2 py-1.5 text-sm rounded transition-colors ${
                active === a.username ? "bg-accent font-semibold" : "hover:bg-accent"
              }`}
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
      )}
    </div>
  );
}
