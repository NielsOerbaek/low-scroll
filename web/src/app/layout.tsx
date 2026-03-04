import type { Metadata, Viewport } from "next";
import { Geist_Mono } from "next/font/google";
import "./globals.css";
import Link from "next/link";
import { headers } from "next/headers";
import { getCurrentUserId } from "@/lib/auth";
import { isUserAdmin } from "@/lib/db";

const geistMono = Geist_Mono({ subsets: ["latin"] });

export const viewport: Viewport = {
  themeColor: "#DD2A7B",
};

export async function generateMetadata(): Promise<Metadata> {
  const host = (await headers()).get("host") || "";
  const isNews = host.startsWith("news.");

  if (isNews) {
    return {
      title: "Føhns Stiftstidende",
      icons: { icon: "/news-favicon.ico" },
    };
  }

  return {
    title: "low-scroll",
    description: "Instagram digest feed",
    manifest: "/manifest.json",
    appleWebApp: {
      capable: true,
      statusBarStyle: "default",
      title: "low-scroll",
    },
    icons: {
      icon: "/favicon.ico",
      apple: "/apple-touch-icon.png",
    },
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const headersList = await headers();
  const host = headersList.get("host") || "";
  const isNewsDomain = host.startsWith("news.");

  const userId = await getCurrentUserId();
  const admin = userId ? isUserAdmin(userId) : false;

  return (
    <html lang={isNewsDomain ? "da" : "en"}>
      <head>
        {!isNewsDomain && (
          <script
            dangerouslySetInnerHTML={{
              __html: `if("serviceWorker"in navigator)navigator.serviceWorker.register("/sw.js")`,
            }}
          />
        )}
      </head>
      <body className={geistMono.className}>
        {!isNewsDomain && (
          <header className="border-b">
            <div className="h-[2px] bg-gradient-to-r from-[#FEDA77] via-[#DD2A7B] to-[#515BD4]" />
            <nav className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
              <Link href={userId ? "/feed" : "/"} className="flex items-center gap-2">
                <img src="/icon-192.png" alt="low-scroll" width={28} height={28} />
                <span className="font-semibold text-lg tracking-tight">low-scroll</span>
              </Link>
              {userId && (
                <div className="flex items-center gap-4">
                  <Link href="/newsletters" className="text-sm text-muted-foreground hover:text-foreground">
                    Newsletters
                  </Link>
                  <Link href="/settings" className="text-sm text-muted-foreground hover:text-foreground">
                    Settings
                  </Link>
                  {admin && (
                    <Link href="/admin" className="text-sm text-muted-foreground hover:text-foreground">
                      Admin
                    </Link>
                  )}
                  <a href="/api/auth/logout" className="text-sm text-muted-foreground hover:text-foreground">
                    Logout
                  </a>
                </div>
              )}
            </nav>
          </header>
        )}
        <main className={isNewsDomain ? "px-4 py-6" : "max-w-5xl mx-auto px-4 py-3"}>
          {children}
        </main>
      </body>
    </html>
  );
}
