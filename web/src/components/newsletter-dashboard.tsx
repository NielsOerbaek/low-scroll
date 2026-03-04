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

interface Subscription {
  from_address: string;
  to_address: string;
  email_count: number;
  last_received: string;
  latest_email_id: number;
}

interface DigestRun {
  id: number;
  digest_date: string;
  email_count: number;
  started_at: string;
  finished_at: string | null;
  status: string;
  error: string | null;
}

const DEFAULT_SYSTEM_PROMPT = "Summarize this newsletter email thoroughly. Include all notable stories, data points, and takeaways. Use bullet points and cover both main stories and smaller items. Use plain text, no markdown.";
const DEFAULT_DIGEST_PROMPT = "Structure this newsletter digest by grouping related stories and themes together. For each theme or story, reference which newsletter(s) it appeared in (by name/sender). If a story appears in multiple newsletters, combine the coverage. Put the most important or widely-covered stories first. Include smaller standalone items at the end.";

const DAY_LABELS = ["Søn", "Man", "Tir", "Ons", "Tor", "Fre", "Lør"];
const WEEKDAYS = [1, 2, 3, 4, 5];
const WEEKEND = [0, 6];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

export function NewsletterDashboard() {
  const [emails, setEmails] = useState<NewsletterEmail[]>([]);
  const [recipients, setRecipients] = useState<string[]>([]);
  const [newRecipient, setNewRecipient] = useState("");
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [digestPrompt, setDigestPrompt] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [expandedEmailId, setExpandedEmailId] = useState<number | null>(null);
  const [emailBody, setEmailBody] = useState<string | null>(null);
  const [emailSummary, setEmailSummary] = useState<string | null>(null);
  const [loadingBody, setLoadingBody] = useState(false);
  const [digestRuns, setDigestRuns] = useState<DigestRun[]>([]);
  const [expandedDigestId, setExpandedDigestId] = useState<number | null>(null);
  const [digestHtml, setDigestHtml] = useState<string | null>(null);
  const [loadingDigest, setLoadingDigest] = useState(false);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);

  useEffect(() => {
    fetch("/api/newsletter")
      .then((r) => r.json())
      .then((data) => {
        setEmails(data.emails || []);
        setRecipients(data.recipients || []);
        setSchedules(data.schedules || []);
        setSystemPrompt(data.systemPrompt || DEFAULT_SYSTEM_PROMPT);
        setDigestPrompt(data.digestPrompt || DEFAULT_DIGEST_PROMPT);
        setLoading(false);
      });
    fetch("/api/newsletter?view=digests")
      .then((r) => r.json())
      .then((data) => setDigestRuns(data.runs || []));
    fetch("/api/newsletter?view=subscriptions")
      .then((r) => r.json())
      .then((data) => setSubscriptions(data.subscriptions || []));
  }, []);

  async function save(partial: Record<string, any>) {
    setSaving(true);
    setMessage("");
    await fetch("/api/newsletter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(partial),
    });
    setMessage("Gemt.");
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

  async function toggleEmailBody(id: number) {
    if (expandedEmailId === id) {
      setExpandedEmailId(null);
      setEmailBody(null);
      setEmailSummary(null);
      return;
    }
    setExpandedEmailId(id);
    setEmailBody(null);
    setEmailSummary(null);
    setLoadingBody(true);
    const res = await fetch(`/api/newsletter?view=email&id=${id}`);
    if (res.ok) {
      const data = await res.json();
      setEmailBody(data.body_html || data.body_text || null);
      setEmailSummary(data.summary || null);
    }
    setLoadingBody(false);
  }

  async function toggleDigestHtml(id: number) {
    if (expandedDigestId === id) {
      setExpandedDigestId(null);
      setDigestHtml(null);
      return;
    }
    setExpandedDigestId(id);
    setDigestHtml(null);
    setLoadingDigest(true);
    const res = await fetch(`/api/newsletter?view=digest&id=${id}`);
    if (res.ok) {
      const data = await res.json();
      setDigestHtml(data.html || null);
    }
    setLoadingDigest(false);
  }

  function statusBadge(email: NewsletterEmail) {
    if (email.is_confirmation) {
      return email.confirmation_clicked
        ? <Badge variant="secondary" className="text-xs">Bekræftelse klikket</Badge>
        : <Badge className="bg-yellow-100 text-yellow-800 text-xs">Afventer bekræftelse</Badge>;
    }
    if (email.digest_date) {
      return <Badge className="bg-green-100 text-green-800 text-xs">I oversigt {email.digest_date}</Badge>;
    }
    if (email.processed) {
      return <Badge className="bg-blue-100 text-blue-800 text-xs">Venter på næste oversigt</Badge>;
    }
    return <Badge variant="secondary" className="text-xs">Ny</Badge>;
  }

  function formatDate(dateStr: string) {
    const d = new Date(dateStr + "Z");
    return d.toLocaleDateString("da-DK", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }

  function timeAgo(dateStr: string) {
    const now = Date.now();
    const then = new Date(dateStr + "Z").getTime();
    const diffMs = now - then;
    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 60) return `${minutes} min siden`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} time${hours !== 1 ? "r" : ""} siden`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days} dag${days !== 1 ? "e" : ""} siden`;
    const months = Math.floor(days / 30);
    return `${months} måned${months !== 1 ? "er" : ""} siden`;
  }

  if (loading) return <p>Indlæser...</p>;

  const textareaClass = "flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

  return (
    <div className="max-w-[1600px] mx-auto space-y-8">
      {/* ── Explainer ─────────────────────────────────────────── */}
      <div className="space-y-4 max-w-4xl mx-auto text-center">
        {(() => {
          const rows = 5;
          const rowH = 26;
          const gap = 4;
          const totalH = rows * rowH + (rows - 1) * gap;
          const midY = totalH / 2;
          const positions = (n: number) => {
            const h = n * rowH + (n - 1) * gap;
            const offset = (totalH - h) / 2;
            return Array.from({ length: n }, (_, i) => offset + i * (rowH + gap) + rowH / 2);
          };
          const Connector = ({ left, right }: { left: number; right: number }) => (
            <svg width="36" height={totalH} className="shrink-0" style={{ display: "block" }}>
              {positions(left).map((y1, i) =>
                positions(right).map((y2, j) => (
                  <line key={`${i}-${j}`} x1={0} y1={y1} x2={30} y2={y2}
                        stroke="currentColor" strokeWidth={1} opacity={0.3} />
                ))
              )}
              {positions(right).map((y, i) => (
                <polygon key={i} points={`${30},${y - 3} ${36},${y} ${30},${y + 3}`}
                         fill="currentColor" opacity={0.4} />
              ))}
            </svg>
          );
          const Col = ({ n, labels, className }: { n: number; labels: string[]; className?: string }) => (
            <div className="flex flex-col items-center shrink-0" style={{ gap, height: totalH, justifyContent: "center" }}>
              {labels.map((label, i) => (
                <span key={i} className={`px-2 rounded border text-xs whitespace-nowrap ${className || "bg-background"}`}
                      style={{ height: rowH, lineHeight: `${rowH}px` }}>{label}</span>
              ))}
            </div>
          );
          return (
            <div className="flex items-center justify-center gap-0 text-muted-foreground font-mono overflow-x-auto">
              <Col n={5} labels={Array(5).fill("Nyhedsbrev")} />
              <Connector left={5} right={1} />
              <Col n={1} labels={["Indbakke"]} className="bg-background font-semibold text-foreground border-2" />
              <Connector left={1} right={5} />
              <Col n={5} labels={Array(5).fill("Opsummering")} className="border-blue-200 bg-blue-50 text-blue-700" />
              <Connector left={5} right={1} />
              <Col n={1} labels={["Oversigt"]} className="border-2 border-blue-300 bg-blue-50 text-blue-700 font-semibold" />
              <Connector left={1} right={3} />
              <Col n={3} labels={Array(3).fill("Modtager")} />
            </div>
          );
        })()}
        <p className="text-sm text-muted-foreground max-w-2xl mx-auto">
          Tilmeld dig nyhedsbreve med en vilkårlig adresse på <code className="px-1 py-0.5 bg-muted rounded text-xs">@news.raakode.dk</code>.
          Hvert nyhedsbrev opsummeres enkeltvis med <strong>opsummeringsprompten</strong>, derefter samles alle opsummeringer
          til en tematisk oversigt med <strong>oversigt-prompten</strong> og sendes til dine modtagere efter tidsplanen.
        </p>
      </div>

      {/* ── Row 1: Settings (2 columns) ───────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left: Recipients + Schedules */}
        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">Modtagere</h2>
            <Card>
              <CardContent className="pt-4 space-y-2">
                {recipients.map((email) => (
                  <div key={email} className="flex items-center gap-2">
                    <span className="text-sm flex-1 truncate">{email}</span>
                    <Button variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={() => removeRecipient(email)}>
                      Fjern
                    </Button>
                  </div>
                ))}
                <div className="flex gap-2">
                  <Input
                    type="email"
                    value={newRecipient}
                    onChange={(e) => setNewRecipient(e.target.value)}
                    placeholder="tilføj@eksempel.dk"
                    className="h-8 text-sm"
                    onKeyDown={(e) => e.key === "Enter" && addRecipient()}
                  />
                  <Button size="sm" className="h-8" onClick={addRecipient} disabled={!newRecipient.trim()}>Tilføj</Button>
                </div>
              </CardContent>
            </Card>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold">Tidsplaner</h2>
            <div className="space-y-2">
              {schedules.map((schedule, i) => (
                <Card key={schedule.id}>
                  <CardContent className="pt-4 pb-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <Input
                        value={schedule.name}
                        onChange={(e) => updateSchedule(i, { name: e.target.value })}
                        placeholder="f.eks. Morgen"
                        className="flex-1 h-8 text-sm"
                      />
                      <Input
                        type="time"
                        value={schedule.time}
                        onChange={(e) => updateSchedule(i, { time: e.target.value })}
                        className="w-24 h-8 text-sm"
                      />
                      <Switch
                        checked={schedule.enabled}
                        onCheckedChange={(enabled) => updateSchedule(i, { enabled })}
                      />
                      <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => removeSchedule(i)}>
                        Slet
                      </Button>
                    </div>
                    <div className="flex gap-1 flex-wrap">
                      {DAY_LABELS.map((label, dayIndex) => (
                        <button
                          key={dayIndex}
                          onClick={() => toggleDay(i, dayIndex)}
                          className={`px-1.5 py-0.5 text-xs rounded border transition-colors ${
                            schedule.days.includes(dayIndex)
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-background text-muted-foreground border-input hover:bg-muted"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
            <Button variant="outline" size="sm" onClick={addSchedule}>Tilføj tidsplan</Button>
          </section>
        </div>

        {/* Right: Prompts */}
        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">Opsummeringsprompt</h2>
            <Card>
              <CardContent className="pt-4 space-y-2">
                <textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder="Summarize this newsletter email thoroughly..."
                  rows={4}
                  className={textareaClass}
                  style={{ fieldSizing: "content" } as React.CSSProperties}
                />
                <Button size="sm" className="h-7 text-xs" onClick={() => save({ systemPrompt })} disabled={saving}>
                  {saving ? "Gemmer..." : "Gem"}
                </Button>
              </CardContent>
            </Card>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold">Oversigt-prompt</h2>
            <Card>
              <CardContent className="pt-4 space-y-2">
                <textarea
                  value={digestPrompt}
                  onChange={(e) => setDigestPrompt(e.target.value)}
                  placeholder="Structure this newsletter digest by grouping related stories..."
                  rows={4}
                  className={textareaClass}
                  style={{ fieldSizing: "content" } as React.CSSProperties}
                />
                <Button size="sm" className="h-7 text-xs" onClick={() => save({ digestPrompt })} disabled={saving}>
                  {saving ? "Gemmer..." : "Gem"}
                </Button>
                {message && <p className="text-xs text-green-600">{message}</p>}
              </CardContent>
            </Card>
          </section>
        </div>
      </div>

      {/* ── Subscriptions ────────────────────────────────────── */}
      {subscriptions.length > 0 && (
        <>
          <Separator />
          <div className="space-y-3">
            <div>
              <h2 className="text-lg font-semibold">Abonnementer</h2>
              <p className="text-sm text-muted-foreground">
                {subscriptions.length} nyhedsbreve du modtager. Klik på en for at se seneste e-mail (find afmeldingslink der).
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {subscriptions.map((sub) => (
                <Card key={sub.from_address} className="cursor-pointer hover:border-primary/50 transition-colors"
                      onClick={() => toggleEmailBody(sub.latest_email_id)}>
                  <CardContent className="py-3 px-4">
                    <p className="text-sm font-medium truncate">{sub.from_address}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-muted-foreground">
                        {sub.email_count} e-mail{sub.email_count !== 1 ? "s" : ""}
                      </span>
                      <span className="text-xs text-muted-foreground">&middot;</span>
                      <span className="text-xs text-muted-foreground">
                        Senest: {timeAgo(sub.last_received)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 truncate">
                      til: {sub.to_address}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </>
      )}

      <Separator />

      {/* ── Row 2: Inbox + Digests (2 columns) ────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
        {/* Inbox */}
        <div className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold">Indbakke</h2>
            <p className="text-sm text-muted-foreground">
              {emails.length} modtagne nyhedsbreve
            </p>
          </div>

          {emails.length === 0 ? (
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground text-center py-4">
                  Ingen nyhedsbreve endnu.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {emails.map((email) => (
                <Card key={email.id}>
                  <CardContent className="py-3 px-4">
                    <div
                      className="cursor-pointer"
                      onClick={() => toggleEmailBody(email.id)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{email.subject}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {email.from_address}
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs shrink-0"
                          onClick={(e) => { e.stopPropagation(); deleteEmail(email.id); }}
                        >
                          Slet
                        </Button>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        {statusBadge(email)}
                        <span className="text-xs text-muted-foreground">
                          {formatDate(email.received_at)}
                        </span>
                      </div>
                    </div>
                    {expandedEmailId === email.id && (
                      <div className="mt-3 border-t pt-3 space-y-3">
                        {loadingBody ? (
                          <p className="text-sm text-muted-foreground">Indlæser...</p>
                        ) : (
                          <>
                            {emailSummary && (
                              <div className="rounded border bg-blue-50 p-3">
                                <p className="text-xs font-semibold text-blue-700 mb-1">AI-opsummering</p>
                                <p className="text-sm whitespace-pre-wrap">{emailSummary}</p>
                              </div>
                            )}
                            {emailBody ? (
                              <details>
                                <summary className="text-xs text-muted-foreground cursor-pointer">Vis original e-mail</summary>
                                <iframe
                                  srcDoc={emailBody}
                                  className="w-full border rounded bg-white mt-2"
                                  style={{ minHeight: 300 }}
                                  sandbox="allow-same-origin"
                                  title={email.subject}
                                  onLoad={(e) => {
                                    const frame = e.target as HTMLIFrameElement;
                                    const doc = frame.contentDocument;
                                    if (doc) {
                                      doc.querySelectorAll("img").forEach((img) => {
                                        img.onerror = () => { img.style.display = "none"; };
                                      });
                                      frame.style.height = doc.documentElement.scrollHeight + "px";
                                    }
                                  }}
                                />
                              </details>
                            ) : !emailSummary ? (
                              <p className="text-sm text-muted-foreground">Intet indhold tilgængeligt.</p>
                            ) : null}
                          </>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Sent Digests */}
        <div className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold">Sendte oversigter</h2>
            <p className="text-sm text-muted-foreground">
              Tidligere genererede oversigter
            </p>
          </div>

          {digestRuns.length === 0 ? (
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground text-center py-4">
                  Ingen oversigter sendt endnu.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {digestRuns.map((run) => (
                <Card key={run.id}>
                  <CardContent className="py-3 px-4">
                    <div
                      className="cursor-pointer"
                      onClick={() => toggleDigestHtml(run.id)}
                    >
                      <p className="text-sm font-medium">
                        Oversigt {run.digest_date}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge
                          className={
                            run.status === "success"
                              ? "bg-green-100 text-green-800 text-xs"
                              : run.status === "error"
                              ? "bg-red-100 text-red-800 text-xs"
                              : "text-xs"
                          }
                          variant="secondary"
                        >
                          {run.status === "success" ? "Sendt" : run.status === "error" ? "Fejl" : run.status}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {run.email_count} e-mail{run.email_count !== 1 ? "s" : ""}
                        </span>
                        {run.finished_at && (
                          <span className="text-xs text-muted-foreground">
                            {formatDate(run.finished_at)}
                          </span>
                        )}
                      </div>
                    </div>
                    {run.error && (
                      <p className="text-xs text-red-600 mt-1">{run.error}</p>
                    )}
                    {expandedDigestId === run.id && (
                      <div className="mt-3 border-t pt-3">
                        {loadingDigest ? (
                          <p className="text-sm text-muted-foreground">Indlæser...</p>
                        ) : digestHtml ? (
                          <iframe
                            srcDoc={digestHtml}
                            className="w-full border rounded bg-white"
                            style={{ minHeight: 400 }}
                            sandbox="allow-same-origin"
                            title={`Oversigt ${run.digest_date}`}
                            onLoad={(e) => {
                              const frame = e.target as HTMLIFrameElement;
                              const doc = frame.contentDocument;
                              if (doc) {
                                doc.querySelectorAll("img").forEach((img) => {
                                  img.onerror = () => { img.style.display = "none"; };
                                });
                                frame.style.height = doc.documentElement.scrollHeight + "px";
                              }
                            }}
                          />
                        ) : (
                          <p className="text-sm text-muted-foreground">Ingen HTML gemt for denne oversigt.</p>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
