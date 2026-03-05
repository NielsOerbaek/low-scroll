"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";

interface NewsletterEmail {
  id: number;
  from_address: string;
  from_name: string;
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
  from_name: string;
  to_address: string;
  email_count: number;
  last_received: string;
  latest_email_id: number;
  latest_subject: string | null;
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

const DEFAULT_SYSTEM_PROMPT = "You summarize newsletter emails. Cover all notable stories, data points, and takeaways. Use bullet points for multiple stories. Include both main stories and smaller items. Include the most relevant external links (URLs) from the original email — especially links to articles, reports, or sources mentioned. If the email contains noteworthy images (charts, diagrams, photos), include their URLs using <img> tags. Use plain text with minimal HTML (<a>, <img>). Be thorough but concise.";
const DEFAULT_DIGEST_PROMPT = `You are writing a daily briefing newsletter. Your output should read like a polished, well-structured newsletter — not a list of summaries.

Structure:
1. Start with a short bullet-point overview listing each story covered. For each bullet, mention which newsletter(s) covered it in parentheses.
2. After the bullet list, state how many newsletters this digest covers.
3. Then write the full briefing organized by theme. Group related stories, combine overlapping coverage from different sources, and reference which newsletter(s) reported each story. Put the most important stories first.
4. The tone should be informative and concise — like a morning briefing for a busy reader.
5. If a story relates to something covered in a previous digest, briefly note the connection (e.g. 'following up on...', 'as previously reported...').
6. Include the most relevant external links from the source newsletters — link to original articles, reports, or sources so the reader can dig deeper.
7. If the summaries include noteworthy images (charts, photos, diagrams), embed them with <img> tags.

Skimmability is key:
- Use <strong> to highlight the most important point in each paragraph so a reader scanning quickly gets the gist.
- Use bullet points and numbered lists liberally to break up dense text.
- Use short paragraphs. Prefer 2-3 sentences per paragraph.
- Use clear <h3> subheadings to separate themes.

Output format:
Wrap the email subject line in <title>...</title> tags.
Then write the digest as simple HTML suitable for embedding in an email. Use only basic tags: <h3>, <p>, <ul>, <li>, <strong>, <em>, <br>, <a>, <img>. Use inline styles sparingly (only font-size and color). Do NOT include <html>, <head>, <body>, or <style> tags.`;

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mon–Sun
const DAY_LABELS: Record<number, string> = { 1: "Man", 2: "Tir", 3: "Ons", 4: "Tor", 5: "Fre", 6: "Lør", 0: "Søn" };
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
  const [saving, setSaving] = useState<string | false>(false);
  const [message, setMessage] = useState<string | false>(false);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{ type: "email" | "digest"; id: number } | null>(null);
  const [emailSummary, setEmailSummary] = useState<string | null>(null);
  const [loadingBody, setLoadingBody] = useState(false);
  const [digestRuns, setDigestRuns] = useState<DigestRun[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [inboxFilter, setInboxFilter] = useState<"newsletters" | "confirmations" | "all">("newsletters");
  const [tab, setTab] = useState<"inbox" | "subscriptions" | "settings">("inbox");

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

  async function save(partial: Record<string, any>, section?: string) {
    if (section) setSaving(section);
    await fetch("/api/newsletter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(partial),
    });
    if (section) {
      setMessage(section);
      setSaving(false);
      setTimeout(() => setMessage(false), 2000);
    }
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

  async function deleteDigest(id: number) {
    await fetch(`/api/newsletter?digest_id=${id}`, { method: "DELETE" });
    setDigestRuns((prev) => prev.filter((r) => r.id !== id));
    if (modal?.type === "digest" && modal.id === id) {
      setModal(null);
    }
  }

  function openEmailModal(id: number) {
    setModal({ type: "email", id });
    setEmailSummary(null);
    setLoadingBody(true);
    fetch(`/api/newsletter?view=email&id=${id}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data) setEmailSummary(data.summary || null);
      })
      .finally(() => setLoadingBody(false));
  }

  function openDigestModal(id: number) {
    setModal({ type: "digest", id });
    setEmailSummary(null);
  }

  function closeModal() {
    setModal(null);
    setEmailSummary(null);
  }

  const modalEmail = modal?.type === "email" ? emails.find((e) => e.id === modal.id) || null : null;
  const modalDigest = modal?.type === "digest" ? digestRuns.find((r) => r.id === modal.id) || null : null;

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

  const filteredEmails = emails.filter((e) => {
    if (inboxFilter === "newsletters") return !e.is_confirmation;
    if (inboxFilter === "confirmations") return e.is_confirmation;
    return true;
  });

  const isBouncyAddress = (addr: string) =>
    /^bounce[+@]|^(no-?reply|mailer-daemon|postmaster)@/i.test(addr);

  const realSubscriptions = subscriptions.filter((s) => !isBouncyAddress(s.from_address));

  function senderDisplayName(fromName: string | undefined | null, fromAddress: string, fallback?: string | null): string {
    // Prefer the MIME display name (e.g. "Joseph at 404media") when available
    if (fromName && fromName.trim()) return fromName.trim();
    // Fallback: derive from domain
    const domain = fromAddress.split("@").pop() || "";
    const genericESPs = ["ghost.io", "substack.com", "mcsv.net", "mcdlv.net", "mailchimp.com"];
    if (genericESPs.some((esp) => domain === esp || domain.endsWith("." + esp))) {
      return fallback || domain;
    }
    const clean = domain.replace(/^(ghost|notify|bounces?|mg-?\w*|m|em\d*\.mail|mail\d*\.suw\d*)\./i, "");
    const name = clean.split(".")[0];
    return name.charAt(0).toUpperCase() + name.slice(1);
  }

  if (loading) return <p>Indlæser...</p>;

  const textareaClass = "flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

  return (
    <div className="max-w-[1600px] mx-auto space-y-8">
      {/* ── Explainer ─────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row items-center gap-6 max-w-5xl mx-auto">
        {/* Network diagram — hidden on mobile */}
        <div className="hidden md:block overflow-hidden shrink-0">{(() => {
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
            <div className="flex items-center justify-center gap-0 text-muted-foreground font-mono">
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
        })()}</div>
        <p className="text-sm text-muted-foreground md:text-left text-center">
          Tilmeld dig nyhedsbreve med <code
            className="px-1 py-0.5 bg-muted rounded text-xs cursor-pointer hover:bg-muted/80 transition-colors"
            title="Klik for at kopiere"
            onClick={() => { navigator.clipboard.writeText("henrik@news.raakode.dk"); }}
          >henrik@news.raakode.dk</code>.
          Hvert nyhedsbrev opsummeres enkeltvis med <strong>opsummeringsprompten</strong>, derefter samles alle opsummeringer
          til en tematisk oversigt med <strong>oversigtsprompten</strong> og sendes til dine modtagere efter tidsplanen.
        </p>
      </div>

      {/* ── Tabs ──────────────────────────────────────────────── */}
      <div className="flex gap-1 border-b">
        {([
          { key: "inbox", label: "Ind- og udbakke" },
          { key: "subscriptions", label: "Abonnementer" },
          { key: "settings", label: "Indstillinger" },
        ] as const).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              tab === key
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Tab: Ind- og udbakke ──────────────────────────────── */}
      {tab === "inbox" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
          {/* Inbox */}
          <div className="space-y-3">
            <div>
              <h2 className="text-lg font-semibold">Indbakke</h2>
              <div className="flex items-center gap-2 mt-1">
                {(["newsletters", "confirmations", "all"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setInboxFilter(f)}
                    className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                      inboxFilter === f
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-muted-foreground border-input hover:bg-muted"
                    }`}
                  >
                    {f === "newsletters" ? "Nyhedsbreve" : f === "confirmations" ? "Bekræftelser" : "Alle"}
                  </button>
                ))}
                <span className="text-xs text-muted-foreground ml-1">
                  {filteredEmails.length} af {emails.length}
                </span>
              </div>
            </div>

            {filteredEmails.length === 0 ? (
              <Card>
                <CardContent className="pt-6">
                  <p className="text-sm text-muted-foreground text-center py-4">
                    {inboxFilter === "all" ? "Ingen e-mails endnu." : inboxFilter === "confirmations" ? "Ingen bekræftelser." : "Ingen nyhedsbreve endnu."}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {filteredEmails.map((email) => (
                  <Card key={email.id}>
                    <CardContent className="py-3 px-4">
                      <div
                        className="cursor-pointer"
                        onClick={() => openEmailModal(email.id)}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">{email.subject}</p>
                            <p className="text-xs text-muted-foreground truncate">
                              {senderDisplayName(email.from_name, email.from_address, email.subject)}
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
                        onClick={() => openDigestModal(run.id)}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium">
                            Oversigt {run.digest_date}
                          </p>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-xs shrink-0"
                            onClick={(e) => { e.stopPropagation(); deleteDigest(run.id); }}
                          >
                            Slet
                          </Button>
                        </div>
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
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Tab: Abonnementer ─────────────────────────────────── */}
      {tab === "subscriptions" && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {realSubscriptions.length} nyhedsbreve du modtager. Klik på en for at se seneste e-mail (find afmeldingslink der).
          </p>
          <p className="text-xs text-muted-foreground/70">
            Nye abonnementer vises først her, når du har modtaget det første rigtige nyhedsbrev (ikke bekræftelsesmailen).
          </p>
          {realSubscriptions.length === 0 ? (
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground text-center py-4">
                  Ingen abonnementer endnu.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {realSubscriptions.map((sub) => (
                <Card key={sub.from_address} className="cursor-pointer hover:border-primary/50 transition-colors"
                      onClick={() => openEmailModal(sub.latest_email_id)}>
                  <CardContent className="py-3 px-4">
                    <p className="text-sm font-medium truncate">{senderDisplayName(sub.from_name, sub.from_address, sub.latest_subject)}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-muted-foreground">
                        {sub.email_count} e-mail{sub.email_count !== 1 ? "s" : ""}
                      </span>
                      <span className="text-xs text-muted-foreground">&middot;</span>
                      <span className="text-xs text-muted-foreground">
                        Senest: {timeAgo(sub.last_received)}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Indstillinger ────────────────────────────────── */}
      {tab === "settings" && (
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
                        {DAY_ORDER.map((day) => (
                          <button
                            key={day}
                            onClick={() => toggleDay(i, day)}
                            className={`px-1.5 py-0.5 text-xs rounded border transition-colors ${
                              schedule.days.includes(day)
                                ? "bg-primary text-primary-foreground border-primary"
                                : "bg-background text-muted-foreground border-input hover:bg-muted"
                            }`}
                          >
                            {DAY_LABELS[day]}
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
                  <Button size="sm" className="h-7 text-xs" onClick={() => save({ systemPrompt }, "system")} disabled={saving === "system"}>
                    {saving === "system" ? "Gemmer..." : "Gem"}
                  </Button>
                  {message === "system" && <span className="text-xs text-green-600">Gemt.</span>}
                </CardContent>
              </Card>
            </section>

            <section className="space-y-2">
              <h2 className="text-sm font-semibold">Oversigtsprompt</h2>
              <Card>
                <CardContent className="pt-4 space-y-2">
                  <textarea
                    value={digestPrompt}
                    onChange={(e) => setDigestPrompt(e.target.value)}
                    placeholder="Structure this newsletter digest by grouping related stories..."
                    rows={10}
                    className={textareaClass}
                    style={{ fieldSizing: "content" } as React.CSSProperties}
                  />
                  <Button size="sm" className="h-7 text-xs" onClick={() => save({ digestPrompt }, "digest")} disabled={saving === "digest"}>
                    {saving === "digest" ? "Gemmer..." : "Gem"}
                  </Button>
                  {message === "digest" && <span className="text-xs text-green-600">Gemt.</span>}
                </CardContent>
              </Card>
            </section>
          </div>
        </div>
      )}

      {/* ── Content modal (email or digest) ─────────────────── */}
      {modal && (() => {
        const isEmail = modal.type === "email";
        const iframeSrc = isEmail
          ? `/api/newsletter/email/${modal.id}/html`
          : `/api/newsletter/digest/${modal.id}/html`;
        const title = isEmail
          ? modalEmail?.subject || "E-mail"
          : `Oversigt ${modalDigest?.digest_date || ""}`;
        const subtitle = isEmail && modalEmail
          ? `${senderDisplayName(modalEmail.from_name, modalEmail.from_address, modalEmail.subject)} \u00b7 ${formatDate(modalEmail.received_at)}`
          : modalDigest
          ? `${modalDigest.email_count} e-mail${modalDigest.email_count !== 1 ? "s" : ""}${modalDigest.finished_at ? ` \u00b7 ${formatDate(modalDigest.finished_at)}` : ""}`
          : "";
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={closeModal}>
            <div className="bg-background rounded-lg shadow-lg w-[95vw] max-w-3xl h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-start justify-between gap-3 p-4 border-b">
                <div className="min-w-0">
                  <p className="font-medium truncate">{title}</p>
                  <p className="text-sm text-muted-foreground truncate">{subtitle}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <a href={iframeSrc} target="_blank" rel="noopener noreferrer"
                     className="text-xs text-blue-600 hover:underline whitespace-nowrap">
                    Nyt faneblad
                  </a>
                  <button onClick={closeModal} className="text-muted-foreground hover:text-foreground text-xl leading-none px-1">&times;</button>
                </div>
              </div>
              {isEmail && loadingBody ? (
                <div className="p-4 text-sm text-muted-foreground">Indlæser...</div>
              ) : isEmail && emailSummary ? (
                <details className="border-b">
                  <summary className="px-4 py-2 text-xs text-blue-700 font-semibold cursor-pointer bg-blue-50/50 hover:bg-blue-50">
                    AI-opsummering
                  </summary>
                  <div className="px-4 py-3 bg-blue-50/30">
                    <p className="text-sm whitespace-pre-wrap">{emailSummary}</p>
                  </div>
                </details>
              ) : null}
              <div className="flex-1 min-h-0">
                <iframe src={iframeSrc} className="w-full h-full border-0"
                        sandbox="allow-same-origin" title={title} />
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
