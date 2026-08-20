"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";

interface Account {
  username: string;
  profile_pic_path: string | null;
  following: number;
}

export function AccountSidebar({ active }: { active?: string } = {}) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [syncing, setSyncing] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch("/api/accounts")
      .then((r) => r.json())
      .then((data) => setAccounts(data.accounts || []))
      .catch(() => {});

    // Check if a sync is already in progress on mount
    fetch("/api/accounts/sync")
      .then((r) => r.json())
      .then((data) => {
        if (data.status === "pending" || data.status === "running") {
          setSyncing(true);
          startPolling();
        }
      })
      .catch(() => {});

    return () => stopPolling();
  }, []);

  function startPolling() {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch("/api/accounts/sync");
        const data = await r.json();
        if (data.status !== "pending" && data.status !== "running") {
          setSyncing(false);
          stopPolling();
          // Refresh account list once done
          const r2 = await fetch("/api/accounts");
          const d2 = await r2.json();
          setAccounts(d2.accounts || []);
        }
      } catch {
        stopPolling();
        setSyncing(false);
      }
    }, 2000);
  }

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  async function handleSync() {
    setSyncing(true);
    try {
      await fetch("/api/accounts/sync", { method: "POST" });
      startPolling();
    } catch {
      setSyncing(false);
    }
  }

  const following = accounts.filter((a) => a.following !== 0);
  const unfollowed = accounts.filter((a) => a.following === 0);

  function AccountLink({ a }: { a: Account }) {
    return (
      <Link
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
    );
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
          className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors flex items-center gap-1"
          title="Sync follow list from Instagram"
        >
          {syncing && (
            <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
          )}
          {syncing ? "Syncing…" : "Sync"}
        </button>
      </div>
      {accounts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No accounts yet. Sync cookies and run a scrape to get started.
        </p>
      ) : (
        <nav className="space-y-1">
          {following.map((a) => (
            <AccountLink key={a.username} a={a} />
          ))}
          {unfollowed.length > 0 && (
            <div className="opacity-40 mt-2 pt-2 border-t border-border">
              {unfollowed.map((a) => (
                <AccountLink key={a.username} a={a} />
              ))}
            </div>
          )}
        </nav>
      )}
    </div>
  );
}
