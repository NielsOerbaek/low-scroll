import { Feed } from "@/components/feed";
import { AccountSidebar } from "@/components/account-sidebar";

export default async function AccountPage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;

  return (
    <div className="flex gap-6">
      <aside className="w-1/4 shrink-0 hidden md:block">
        <AccountSidebar active={username} />
      </aside>
      <div className="flex-1 min-w-0 max-w-[512px]">
        <h1 className="text-2xl font-bold mb-4">@{username}</h1>
        <Feed account={username} />
      </div>
    </div>
  );
}
