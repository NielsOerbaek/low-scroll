import { Feed } from "@/components/feed";
import { AccountSidebar } from "@/components/account-sidebar";

export default function HomePage() {
  return (
    <div className="flex gap-6">
      <aside className="w-1/4 shrink-0 hidden md:block">
        <AccountSidebar />
      </aside>
      <div className="flex-1 min-w-0 max-w-[512px]">
        <Feed />
      </div>
    </div>
  );
}
