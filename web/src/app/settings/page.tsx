import { SettingsForm } from "@/components/settings-form";
import { ManualScrape } from "@/components/manual-scrape";
import { ActivityLog } from "@/components/activity-log";

export default function SettingsPage() {
  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Settings</h1>
      <div className="space-y-6">
        <SettingsForm />
        <ManualScrape />
        <ActivityLog />
      </div>
    </div>
  );
}
