"use client";

import { useState } from "react";
import Link from "next/link";

export function MobileNav({ admin }: { admin: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="md:hidden">
      <button
        onClick={() => setOpen(!open)}
        className="p-2 text-muted-foreground hover:text-foreground"
        aria-label="Toggle menu"
      >
        {open ? (
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="4" y1="4" x2="16" y2="16" />
            <line x1="16" y1="4" x2="4" y2="16" />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="3" y1="5" x2="17" y2="5" />
            <line x1="3" y1="10" x2="17" y2="10" />
            <line x1="3" y1="15" x2="17" y2="15" />
          </svg>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full w-48 border bg-background shadow-lg z-50">
          <Link href="/newsletters" className="block px-4 py-3 text-sm hover:bg-muted" onClick={() => setOpen(false)}>
            Newsletters
          </Link>
          <Link href="/settings" className="block px-4 py-3 text-sm hover:bg-muted" onClick={() => setOpen(false)}>
            Settings
          </Link>
          {admin && (
            <Link href="/admin" className="block px-4 py-3 text-sm hover:bg-muted" onClick={() => setOpen(false)}>
              Admin
            </Link>
          )}
          <a href="/api/auth/logout" className="block px-4 py-3 text-sm hover:bg-muted border-t">
            Logout
          </a>
        </div>
      )}
    </div>
  );
}
