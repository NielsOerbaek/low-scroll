"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

interface NewsletterEmail {
  id: number;
  from_address: string;
  to_address: string;
  subject: string;
  received_at: string;
  processed: number;
  is_confirmation: number;
  confirmation_clicked: number;
  digest_date: string | null;
}

export function NewsletterDashboard() {
  const [emails, setEmails] = useState<NewsletterEmail[]>([]);
  const [digestEmail, setDigestEmail] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/newsletter")
      .then((r) => r.json())
      .then((data) => {
        setEmails(data.emails || []);
        setDigestEmail(data.digestEmail || "");
        setSystemPrompt(data.systemPrompt || "");
        setLoading(false);
      });
  }, []);

  async function saveSettings() {
    setSaving(true);
    setMessage("");
    await fetch("/api/newsletter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ digestEmail, systemPrompt }),
    });
    setMessage("Settings saved.");
    setSaving(false);
  }

  async function deleteEmail(id: number) {
    await fetch(`/api/newsletter?id=${id}`, { method: "DELETE" });
    setEmails((prev) => prev.filter((e) => e.id !== id));
  }

  function statusBadge(email: NewsletterEmail) {
    if (email.is_confirmation) {
      return email.confirmation_clicked
        ? <Badge variant="secondary" className="text-xs">Confirmed</Badge>
        : <Badge className="bg-yellow-100 text-yellow-800 text-xs">Awaiting confirm</Badge>;
    }
    if (email.digest_date) {
      return <Badge className="bg-green-100 text-green-800 text-xs">Digested {email.digest_date}</Badge>;
    }
    if (email.processed) {
      return <Badge className="bg-blue-100 text-blue-800 text-xs">Processed</Badge>;
    }
    return <Badge variant="secondary" className="text-xs">Pending</Badge>;
  }

  function formatDate(dateStr: string) {
    const d = new Date(dateStr + "Z");
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }

  if (loading) return <p>Loading...</p>;

  return (
    <div className="space-y-8">
      {/* ── Settings ──────────────────────────────────────────── */}
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Digest Settings</h2>
          <p className="text-sm text-muted-foreground">
            Configure the newsletter digest email and summarization style
          </p>
        </div>

        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="space-y-1">
              <Label htmlFor="digest-email">Digest recipient email</Label>
              <Input
                id="digest-email"
                type="email"
                value={digestEmail}
                onChange={(e) => setDigestEmail(e.target.value)}
                placeholder="you@example.com"
              />
              <p className="text-xs text-muted-foreground">
                Where the daily newsletter digest is sent. Falls back to your main email recipient if empty.
              </p>
            </div>

            <div className="space-y-1">
              <Label htmlFor="system-prompt">System prompt for summarization</Label>
              <textarea
                id="system-prompt"
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="Summarize this newsletter email concisely in 2-4 bullet points. Focus on the key information, news, or takeaways. Use plain text, no markdown."
                rows={4}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
              <p className="text-xs text-muted-foreground">
                Instructions given to Claude for summarizing each newsletter. Leave empty for the default.
              </p>
            </div>

            <Button onClick={saveSettings} disabled={saving}>
              {saving ? "Saving..." : "Save Settings"}
            </Button>
            {message && <p className="text-sm text-green-600">{message}</p>}
          </CardContent>
        </Card>
      </section>

      <Separator />

      {/* ── Email List ────────────────────────────────────────── */}
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Recent Emails</h2>
          <p className="text-sm text-muted-foreground">
            Last {emails.length} newsletter emails received
          </p>
        </div>

        {emails.length === 0 ? (
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground text-center py-4">
                No newsletter emails yet. Subscribe to newsletters using an address like <code className="px-1 py-0.5 bg-muted rounded text-xs">anything@news.raakode.dk</code>
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {emails.map((email) => (
              <Card key={email.id}>
                <CardContent className="py-3 px-4">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{email.subject}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {email.from_address} → {email.to_address}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {statusBadge(email)}
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatDate(email.received_at)}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => deleteEmail(email.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
