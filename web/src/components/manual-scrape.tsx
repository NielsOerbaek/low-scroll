"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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
      return <Badge className="bg-ig-blue text-white">Running</Badge>;
    case "success":
      return <Badge className="bg-foreground/10 text-foreground">Done</Badge>;
    case "error":
      return <Badge variant="destructive">Error</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

function LogViewer({ runId, isActive }: { runId: number; isActive: boolean }) {
  const [log, setLog] = useState("");
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    async function fetchLog() {
      const res = await fetch(`/api/scrape/${runId}/logs`);
      const data = await res.json();
      setLog(data.log || "");
    }
    fetchLog();
    if (isActive) {
      interval = setInterval(fetchLog, 2000);
    }
    return () => clearInterval(interval);
  }, [runId, isActive]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [log]);

  if (!log) return null;

  return (
    <pre
      ref={logRef}
      className="mt-2 max-h-48 overflow-auto border bg-muted p-2 text-xs text-muted-foreground whitespace-pre-wrap"
    >
      {log}
    </pre>
  );
}

export function ManualScrape() {
  const [sinceDate, setSinceDate] = useState("");
  const [runs, setRuns] = useState<ManualRun[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [expandedRun, setExpandedRun] = useState<number | null>(null);

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
      setExpandedRun(data.id);
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
        {error && <p className="text-sm text-destructive">{error}</p>}

        {runs.length > 0 && (
          <div className="space-y-1 pt-2">
            <h3 className="text-sm font-medium text-muted-foreground mb-2">Recent Runs</h3>
            <div className="space-y-1">
              {runs.map((run) => (
                <div key={run.id}>
                  <button
                    onClick={() => setExpandedRun(expandedRun === run.id ? null : run.id)}
                    className="flex items-center justify-between w-full border px-3 py-2 text-sm text-left hover:bg-muted/50 transition-colors"
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
                        <span className="text-destructive max-w-48 truncate" title={run.error}>
                          {run.error}
                        </span>
                      )}
                      <span className="tabular-nums">
                        {new Date(run.created_at + "Z").toLocaleString()}
                      </span>
                      <span className="text-xs">{expandedRun === run.id ? "[-]" : "[+]"}</span>
                    </div>
                  </button>
                  {expandedRun === run.id && (
                    <LogViewer
                      runId={run.id}
                      isActive={run.status === "running" || run.status === "pending"}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
