"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface Account {
  username: string;
  profile_pic_path: string | null;
}

export function AccountStrip() {
  const [accounts, setAccounts] = useState<Account[]>([]);

  useEffect(() => {
    fetch("/api/accounts")
      .then((r) => r.json())
      .then((data) => setAccounts(data.accounts || []))
      .catch(() => {});
  }, []);

  if (accounts.length === 0) return null;

  return (
    <div className="md:hidden flex gap-3 overflow-x-auto py-2 px-1 -mx-1 no-scrollbar">
      {accounts.map((a) => (
        <Link
          key={a.username}
          href={`/account/${a.username}`}
          className="flex flex-col items-center gap-1 shrink-0"
        >
          {a.profile_pic_path ? (
            <img
              src={`/api/media/${a.profile_pic_path}`}
              alt={a.username}
              className="w-14 h-14 rounded-full object-cover ring-2 ring-border"
            />
          ) : (
            <span className="w-14 h-14 rounded-full bg-muted ring-2 ring-border" />
          )}
          <span className="text-[10px] text-muted-foreground truncate w-14 text-center">
            {a.username}
          </span>
        </Link>
      ))}
    </div>
  );
}
