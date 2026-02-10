"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface ActivityRun {
  id: number;
  kind: "scheduled" | "manual";
  started_at: string | null;
  finished_at: string | null;
  status: string | null;
  new_posts_count: number;
  new_stories_count: number;
  error: string | null;
  since_date?: string;
}

function statusBadge(status: string | null) {
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
      return <Badge variant="secondary">{status ?? "..."}</Badge>;
  }
}

function kindLabel(kind: "scheduled" | "manual") {
  return kind === "scheduled" ? (
    <span className="text-xs text-muted-foreground font-medium px-1.5 py-0.5 border rounded">
      cron
    </span>
  ) : (
    <span className="text-xs text-muted-foreground font-medium px-1.5 py-0.5 border rounded">
      manual
    </span>
  );
}

function countWarnings(log: string): number {
  if (!log) return 0;
  return (log.match(/\[WARNING\]|\[ERROR\]/g) || []).length;
}

function LogViewer({
  runId,
  kind,
  isActive,
}: {
  runId: number;
  kind: "scheduled" | "manual";
  isActive: boolean;
}) {
  const [log, setLog] = useState("");
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    async function fetchLog() {
      const res = await fetch(
        `/api/activity?logType=${kind === "scheduled" ? "scrape" : "manual"}&logId=${runId}`
      );
      const data = await res.json();
      setLog(data.log || "");
    }
    fetchLog();
    if (isActive) {
      interval = setInterval(fetchLog, 2000);
    }
    return () => clearInterval(interval);
  }, [runId, kind, isActive]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [log]);

  if (!log) return null;

  const warnings = countWarnings(log);

  return (
    <div>
      {warnings > 0 && (
        <div className="px-3 py-1.5 text-xs text-amber-700 bg-amber-50 border-x border-b">
          {warnings} warning{warnings !== 1 ? "s" : ""} / error{warnings !== 1 ? "s" : ""} in log
        </div>
      )}
      <pre
        ref={logRef}
        className="max-h-64 overflow-auto border-x border-b bg-muted p-2 text-xs text-muted-foreground whitespace-pre-wrap"
      >
        {log}
      </pre>
    </div>
  );
}

export function ActivityLog() {
  const [runs, setRuns] = useState<ActivityRun[]>([]);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);

  const fetchRuns = useCallback(async () => {
    const res = await fetch("/api/activity");
    const data = await res.json();
    setRuns(data.runs || []);
  }, []);

  useEffect(() => {
    fetchRuns();
    const interval = setInterval(fetchRuns, 10000);
    return () => clearInterval(interval);
  }, [fetchRuns]);

  const runKey = (r: ActivityRun) => `${r.kind}-${r.id}`;

  // Summary stats
  const lastRun = runs.find((r) => r.status === "success" || r.status === "error");
  const lastSuccess = runs.find((r) => r.status === "success");
  const hasRunning = runs.some((r) => r.status === "running");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Activity Log
          {hasRunning && (
            <Badge className="bg-ig-blue text-white">Running</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary strip */}
        {lastSuccess && (
          <div className="flex gap-4 text-sm text-muted-foreground">
            <span>
              Last success:{" "}
              <span className="text-foreground tabular-nums">
                {new Date((lastSuccess.finished_at ?? lastSuccess.started_at ?? "") + "Z").toLocaleString()}
              </span>
            </span>
            <span>
              {lastSuccess.new_posts_count} post{lastSuccess.new_posts_count !== 1 ? "s" : ""},{" "}
              {lastSuccess.new_stories_count} stor{lastSuccess.new_stories_count !== 1 ? "ies" : "y"}
            </span>
          </div>
        )}

        {runs.length === 0 && (
          <p className="text-sm text-muted-foreground">No scrape runs yet.</p>
        )}

        {runs.length > 0 && (
          <div className="space-y-1">
            {runs.map((run) => {
              const key = runKey(run);
              const isExpanded = expandedRun === key;
              const isActive = run.status === "running" || run.status === "pending";
              const total = run.new_posts_count + run.new_stories_count;

              return (
                <div key={key}>
                  <button
                    onClick={() => setExpandedRun(isExpanded ? null : key)}
                    className="flex items-center justify-between w-full border px-3 py-2 text-sm text-left hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      {statusBadge(run.status)}
                      {kindLabel(run.kind)}
                      {run.kind === "manual" && run.since_date && (
                        <span className="text-muted-foreground">
                          since {run.since_date}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-muted-foreground">
                      {run.status === "success" && (
                        <span>
                          {total === 0
                            ? "no new content"
                            : `${run.new_posts_count} post${run.new_posts_count !== 1 ? "s" : ""}, ${run.new_stories_count} stor${run.new_stories_count !== 1 ? "ies" : "y"}`}
                        </span>
                      )}
                      {run.error && (
                        <span
                          className="text-destructive max-w-48 truncate"
                          title={run.error}
                        >
                          {run.error}
                        </span>
                      )}
                      <span className="tabular-nums">
                        {run.started_at
                          ? new Date(run.started_at + "Z").toLocaleString()
                          : "—"}
                      </span>
                      <span className="text-xs">
                        {isExpanded ? "[-]" : "[+]"}
                      </span>
                    </div>
                  </button>
                  {isExpanded && (
                    <LogViewer
                      runId={run.id}
                      kind={run.kind}
                      isActive={isActive}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
