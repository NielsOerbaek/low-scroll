"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function ManualScrape() {
  const [sinceDate, setSinceDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [triggeringIg, setTriggeringIg] = useState(false);
  const [triggeringFb, setTriggeringFb] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function triggerBackfill() {
    setSubmitting(true);
    setError("");
    setMessage("");
    const res = await fetch("/api/scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sinceDate }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Failed to queue scrape");
    } else {
      setSinceDate("");
      setMessage("Backfill queued — check activity log below.");
    }
    setSubmitting(false);
  }

  async function triggerPlatformScrape(platform: "ig" | "fb") {
    const setter = platform === "ig" ? setTriggeringIg : setTriggeringFb;
    setter(true);
    setError("");
    setMessage("");
    const res = await fetch(`/api/scrape/trigger?platform=${platform}`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || `Failed to trigger ${platform.toUpperCase()} scrape`);
    } else {
      setMessage(`${platform.toUpperCase()} scrape triggered — check activity log below.`);
    }
    setter(false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Scrape</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Button onClick={() => triggerPlatformScrape("ig")} disabled={triggeringIg}>
            {triggeringIg ? "Triggering..." : "Scrape Instagram"}
          </Button>
          <Button variant="outline" onClick={() => triggerPlatformScrape("fb")} disabled={triggeringFb}>
            {triggeringFb ? "Triggering..." : "Scrape Facebook"}
          </Button>
        </div>

        <div className="border-t pt-4">
          <div className="flex items-end gap-3">
            <div className="space-y-1 flex-1">
              <Label htmlFor="since-date">Backfill posts since</Label>
              <Input
                id="since-date"
                type="date"
                value={sinceDate}
                onChange={(e) => setSinceDate(e.target.value)}
                max={new Date().toISOString().slice(0, 10)}
              />
            </div>
            <Button
              variant="outline"
              onClick={triggerBackfill}
              disabled={submitting || !sinceDate}
            >
              {submitting ? "Queuing..." : "Start Backfill"}
            </Button>
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {message && <p className="text-sm text-muted-foreground">{message}</p>}
      </CardContent>
    </Card>
  );
}
