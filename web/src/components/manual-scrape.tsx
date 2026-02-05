"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface ManualRun {
  id: number;
  since_date: string;
  status: string;
  new_posts_count: number;
  new_stories_count: number;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

function statusBadge(status: string) {
  switch (status) {
    case "pending":
      return <Badge variant="secondary">Pending</Badge>;
    case "running":
      return <Badge className="bg-blue-100 text-blue-800">Running</Badge>;
    case "success":
      return <Badge className="bg-green-100 text-green-800">Success</Badge>;
    case "error":
      return <Badge variant="destructive">Error</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

export function ManualScrape() {
  const [sinceDate, setSinceDate] = useState("");
  const [runs, setRuns] = useState<ManualRun[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const fetchRuns = useCallback(async () => {
    const res = await fetch("/api/scrape");
    const data = await res.json();
    setRuns(data.runs || []);
  }, []);

  useEffect(() => {
    fetchRuns();
    const interval = setInterval(fetchRuns, 5000);
    return () => clearInterval(interval);
  }, [fetchRuns]);

  async function triggerScrape() {
    setSubmitting(true);
    setError("");
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
    }
    setSubmitting(false);
    fetchRuns();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Manual Scrape</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-end gap-3">
          <div className="space-y-1 flex-1">
            <Label htmlFor="since-date">Collect posts since</Label>
            <Input
              id="since-date"
              type="date"
              value={sinceDate}
              onChange={(e) => setSinceDate(e.target.value)}
              max={new Date().toISOString().slice(0, 10)}
            />
          </div>
          <Button onClick={triggerScrape} disabled={submitting || !sinceDate}>
            {submitting ? "Queuing..." : "Start Scrape"}
          </Button>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}

        {runs.length > 0 && (
          <div className="space-y-2 pt-2">
            <h3 className="text-sm font-medium text-muted-foreground">Recent Runs</h3>
            <div className="space-y-2">
              {runs.map((run) => (
                <div
                  key={run.id}
                  className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                >
                  <div className="flex items-center gap-3">
                    {statusBadge(run.status)}
                    <span>Since {run.since_date}</span>
                  </div>
                  <div className="flex items-center gap-3 text-muted-foreground">
                    {run.status === "success" && (
                      <span>
                        {run.new_posts_count} posts, {run.new_stories_count} stories
                      </span>
                    )}
                    {run.error && (
                      <span className="text-red-600 max-w-48 truncate" title={run.error}>
                        {run.error}
                      </span>
                    )}
                    <span>
                      {new Date(run.created_at + "Z").toLocaleString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
