import { SettingsForm } from "@/components/settings-form";
import { ManualScrape } from "@/components/manual-scrape";
import { ActivityLog } from "@/components/activity-log";
import { Separator } from "@/components/ui/separator";

export default function SettingsPage() {
  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Settings</h1>
      <SettingsForm />

      <Separator className="my-8" />

      {/* ── Scrape & Activity ───────────────────────────────── */}
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Scrape & Activity</h2>
          <p className="text-sm text-muted-foreground">
            Trigger scrapes manually and view recent activity
          </p>
        </div>
        <div className="space-y-4">
          <ManualScrape />
          <ActivityLog />
        </div>
      </section>
    </div>
  );
}
