"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";

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

interface Schedule {
  id: string;
  name: string;
  time: string;
  days: number[]; // 0=Sun, 1=Mon, ..., 6=Sat
  enabled: boolean;
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS = [1, 2, 3, 4, 5];
const WEEKEND = [0, 6];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

export function NewsletterDashboard() {
  const [emails, setEmails] = useState<NewsletterEmail[]>([]);
  const [recipients, setRecipients] = useState<string[]>([]);
  const [newRecipient, setNewRecipient] = useState("");
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/newsletter")
      .then((r) => r.json())
      .then((data) => {
        setEmails(data.emails || []);
        setRecipients(data.recipients || []);
        setSchedules(data.schedules || []);
        setSystemPrompt(data.systemPrompt || "");
        setLoading(false);
      });
  }, []);

  async function save(partial: Record<string, any>) {
    setSaving(true);
    setMessage("");
    await fetch("/api/newsletter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(partial),
    });
    setMessage("Saved.");
    setSaving(false);
    setTimeout(() => setMessage(""), 2000);
  }

  function addRecipient() {
    const email = newRecipient.trim();
    if (!email || recipients.includes(email)) return;
    const updated = [...recipients, email];
    setRecipients(updated);
    setNewRecipient("");
    save({ recipients: updated });
  }

  function removeRecipient(email: string) {
    const updated = recipients.filter((r) => r !== email);
    setRecipients(updated);
    save({ recipients: updated });
  }

  function addSchedule() {
    const id = `schedule_${Date.now()}`;
    const updated = [...schedules, { id, name: "", time: "08:00", days: ALL_DAYS, enabled: true }];
    setSchedules(updated);
    save({ schedules: updated });
  }

  function updateSchedule(index: number, partial: Partial<Schedule>) {
    const updated = schedules.map((s, i) => i === index ? { ...s, ...partial } : s);
    setSchedules(updated);
    save({ schedules: updated });
  }

  function removeSchedule(index: number) {
    const updated = schedules.filter((_, i) => i !== index);
    setSchedules(updated);
    save({ schedules: updated });
  }

  function toggleDay(index: number, day: number) {
    const schedule = schedules[index];
    const days = schedule.days.includes(day)
      ? schedule.days.filter((d) => d !== day)
      : [...schedule.days, day].sort();
    updateSchedule(index, { days });
  }

  function setPresetDays(index: number, preset: "weekdays" | "weekend" | "all") {
    const days = preset === "weekdays" ? WEEKDAYS : preset === "weekend" ? WEEKEND : ALL_DAYS;
    updateSchedule(index, { days });
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
      {/* ── Recipients ────────────────────────────────────────── */}
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Digest Recipients</h2>
          <p className="text-sm text-muted-foreground">
            Email addresses that receive the newsletter digest
          </p>
        </div>

        <Card>
          <CardContent className="pt-6 space-y-3">
            {recipients.map((email) => (
              <div key={email} className="flex items-center gap-2">
                <span className="text-sm flex-1 truncate">{email}</span>
                <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => removeRecipient(email)}>
                  Remove
                </Button>
              </div>
            ))}
            <div className="flex gap-2">
              <Input
                type="email"
                value={newRecipient}
                onChange={(e) => setNewRecipient(e.target.value)}
                placeholder="add@example.com"
                onKeyDown={(e) => e.key === "Enter" && addRecipient()}
              />
              <Button onClick={addRecipient} disabled={!newRecipient.trim()}>Add</Button>
            </div>
          </CardContent>
        </Card>
      </section>

      <Separator />

      {/* ── Schedules ─────────────────────────────────────────── */}
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Digest Schedules</h2>
          <p className="text-sm text-muted-foreground">
            When to send digest emails. Multiple schedules supported.
          </p>
        </div>

        <div className="space-y-3">
          {schedules.map((schedule, i) => (
            <Card key={schedule.id}>
              <CardContent className="pt-5 space-y-3">
                <div className="flex items-center gap-3">
                  <Input
                    value={schedule.name}
                    onChange={(e) => updateSchedule(i, { name: e.target.value })}
                    placeholder="e.g. Morning"
                    className="flex-1"
                  />
                  <Input
                    type="time"
                    value={schedule.time}
                    onChange={(e) => updateSchedule(i, { time: e.target.value })}
                    className="w-28"
                  />
                  <Switch
                    checked={schedule.enabled}
                    onCheckedChange={(enabled) => updateSchedule(i, { enabled })}
                  />
                  <Button variant="outline" size="sm" className="h-8 px-2 text-xs" onClick={() => removeSchedule(i)}>
                    Delete
                  </Button>
                </div>

                {/* Day picker */}
                <div className="space-y-2">
                  <div className="flex gap-1">
                    {DAY_LABELS.map((label, dayIndex) => (
                      <button
                        key={dayIndex}
                        onClick={() => toggleDay(i, dayIndex)}
                        className={`px-2 py-1 text-xs rounded border transition-colors ${
                          schedule.days.includes(dayIndex)
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background text-muted-foreground border-input hover:bg-muted"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setPresetDays(i, "weekdays")} className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2">Weekdays</button>
                    <button onClick={() => setPresetDays(i, "weekend")} className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2">Weekend</button>
                    <button onClick={() => setPresetDays(i, "all")} className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2">Every day</button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Button variant="outline" onClick={addSchedule}>Add Schedule</Button>
      </section>

      <Separator />

      {/* ── System Prompt ─────────────────────────────────────── */}
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Summarization Prompt</h2>
          <p className="text-sm text-muted-foreground">
            Instructions given to Claude for summarizing each newsletter
          </p>
        </div>

        <Card>
          <CardContent className="pt-6 space-y-3">
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="Summarize this newsletter email concisely in 2-4 bullet points. Focus on the key information, news, or takeaways. Use plain text, no markdown."
              rows={4}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
            <p className="text-xs text-muted-foreground">Leave empty for the default.</p>
            <Button onClick={() => save({ systemPrompt })} disabled={saving}>
              {saving ? "Saving..." : "Save Prompt"}
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
                        {email.from_address} &rarr; {email.to_address}
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
