"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function ManualScrape() {
  const [sinceDate, setSinceDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [triggering, setTriggering] = useState(false);
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

  async function triggerScrapeNow() {
    setTriggering(true);
    setError("");
    setMessage("");
    const res = await fetch("/api/scrape/trigger", { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Failed to trigger scrape");
    } else {
      setMessage("Scrape triggered — check activity log below.");
    }
    setTriggering(false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Scrape</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button onClick={triggerScrapeNow} disabled={triggering}>
          {triggering ? "Triggering..." : "Scrape Now"}
        </Button>

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
