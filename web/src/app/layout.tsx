import type { Metadata, Viewport } from "next";
import { Geist_Mono } from "next/font/google";
import "./globals.css";
import Link from "next/link";

const geistMono = Geist_Mono({ subsets: ["latin"] });

export const viewport: Viewport = {
  themeColor: "#DD2A7B",
};

export const metadata: Metadata = {
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `if("serviceWorker"in navigator)navigator.serviceWorker.register("/sw.js")`,
          }}
        />
      </head>
      <body className={geistMono.className}>
        <header className="border-b">
          <div className="h-[2px] bg-gradient-to-r from-[#FEDA77] via-[#DD2A7B] to-[#515BD4]" />
          <nav className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2">
              <img src="/icon-192.png" alt="low-scroll" width={28} height={28} />
              <span className="font-semibold text-lg tracking-tight">low-scroll</span>
            </Link>
            <Link href="/settings" className="text-sm text-muted-foreground hover:text-foreground">
              Settings
            </Link>
          </nav>
        </header>
        <main className="max-w-5xl mx-auto px-4 py-6">
          {children}
        </main>
      </body>
    </html>
  );
}
