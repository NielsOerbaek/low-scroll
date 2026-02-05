"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface Account {
  username: string;
  profile_pic_path: string | null;
}

export function AccountSidebar() {
  const [accounts, setAccounts] = useState<Account[]>([]);

  useEffect(() => {
    fetch("/api/accounts")
      .then((r) => r.json())
      .then((data) => setAccounts(data.accounts || []))
      .catch(() => {});
  }, []);

  return (
    <div>
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
        Accounts
      </h2>
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
      )}
    </div>
  );
}
