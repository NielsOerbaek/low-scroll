"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function SettingsForm() {
  const [settings, setSettings] = useState<any>(null);
  const [sessionid, setSessionid] = useState("");
  const [csrftoken, setCsrftoken] = useState("");
  const [dsUserId, setDsUserId] = useState("");
  const [cronSchedule, setCronSchedule] = useState("");
  const [emailRecipient, setEmailRecipient] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState("");
  const [testLog, setTestLog] = useState("");

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        setSettings(data);
        setCronSchedule(data.cronSchedule);
        setEmailRecipient(data.emailRecipient);
      });
  }, []);

  async function saveCookies() {
    setSaving(true);
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cookies: { sessionid, csrftoken, ds_user_id: dsUserId },
      }),
    });
    setMessage("Cookies saved.");
    setSaving(false);
    setSessionid("");
    setCsrftoken("");
    setDsUserId("");
    // Refresh status
    const data = await fetch("/api/settings").then((r) => r.json());
    setSettings(data);
  }

  async function saveConfig() {
    setSaving(true);
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cronSchedule, emailRecipient }),
    });
    setMessage("Settings saved.");
    setSaving(false);
  }

  if (!settings) return <p>Loading...</p>;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Instagram Cookies
            {settings.hasCookies && !settings.cookiesStale && (
              <Badge className="bg-green-100 text-green-800">Active</Badge>
            )}
            {settings.cookiesStale && (
              <Badge variant="destructive">Stale - update required</Badge>
            )}
            {!settings.hasCookies && (
              <Badge variant="secondary">Not configured</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="sessionid">sessionid</Label>
            <Input id="sessionid" value={sessionid} onChange={(e) => setSessionid(e.target.value)} placeholder="Paste sessionid cookie" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="csrftoken">csrftoken</Label>
            <Input id="csrftoken" value={csrftoken} onChange={(e) => setCsrftoken(e.target.value)} placeholder="Paste csrftoken cookie" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ds_user_id">ds_user_id</Label>
            <Input id="ds_user_id" value={dsUserId} onChange={(e) => setDsUserId(e.target.value)} placeholder="Paste ds_user_id cookie" />
          </div>
          <div className="flex gap-2">
            <Button onClick={saveCookies} disabled={saving || !sessionid}>
              {saving ? "Saving..." : "Save Cookies"}
            </Button>
            {settings.hasCookies && (
              <Button
                variant="outline"
                disabled={testing}
                onClick={async () => {
                  setTesting(true);
                  setMessage("");
                  setTestLog("");
                  await fetch("/api/cookies/test", { method: "POST" });
                  // Poll for result + log (scraper runs the actual test)
                  const poll = setInterval(async () => {
                    try {
                      const res = await fetch("/api/cookies/test");
                      const data = await res.json();
                      if (data.log) setTestLog(data.log);
                      if (data.status === "valid") {
                        clearInterval(poll);
                        setMessage(`Cookies valid — logged in as @${data.username}`);
                        setTesting(false);
                      } else if (data.status === "error") {
                        clearInterval(poll);
                        setMessage(`Cookie test failed: ${data.error}`);
                        setTesting(false);
                      }
                    } catch {
                      clearInterval(poll);
                      setMessage("Cookie test failed: network error");
                      setTesting(false);
                    }
                  }, 2000);
                  // Timeout after 5min (rate limit retries can take ~3min)
                  setTimeout(() => {
                    clearInterval(poll);
                    if (testing) {
                      setMessage("Cookie test timed out — scraper may be busy");
                      setTesting(false);
                    }
                  }, 300000);
                }}
              >
                {testing ? "Testing..." : "Test Cookies"}
              </Button>
            )}
          </div>
          {testLog && (
            <pre className="max-h-48 overflow-auto border bg-muted p-2 text-xs text-muted-foreground whitespace-pre-wrap">
              {testLog}
            </pre>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Schedule & Email</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="cron">Cron Schedule</Label>
            <Input id="cron" value={cronSchedule} onChange={(e) => setCronSchedule(e.target.value)} placeholder="0 8 * * *" />
            <p className="text-xs text-muted-foreground">Standard cron expression (minute hour day month weekday)</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="email">Email Recipient</Label>
            <Input id="email" type="email" value={emailRecipient} onChange={(e) => setEmailRecipient(e.target.value)} placeholder="you@example.com" />
          </div>
          <Button onClick={saveConfig} disabled={saving}>
            {saving ? "Saving..." : "Save Settings"}
          </Button>
        </CardContent>
      </Card>

      {message && <p className="text-sm text-green-600">{message}</p>}
    </div>
  );
}
