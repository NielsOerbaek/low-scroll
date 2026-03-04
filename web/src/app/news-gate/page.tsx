"use client";

import { useState } from "react";
import { Logo } from "@/components/logo";

export default function NewsGatePage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const res = await fetch("/api/news-auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    if (res.ok) {
      window.location.href = "/";
    } else {
      setError("Forkert adgangskode");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <form onSubmit={handleSubmit} className="w-full max-w-xs space-y-4">
        <div className="flex justify-center"><Logo /></div>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Adgangskode"
          autoFocus
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        />
        <button
          type="submit"
          disabled={loading || !password}
          className="inline-flex items-center justify-center w-full rounded-md bg-primary text-primary-foreground h-9 px-4 text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? "..." : "Log ind"}
        </button>
        {error && <p className="text-sm text-red-600 text-center">{error}</p>}
      </form>
    </div>
  );
}
