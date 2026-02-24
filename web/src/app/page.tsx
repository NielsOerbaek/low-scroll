import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUserId } from "@/lib/auth";

export default async function LandingPage() {
  const userId = await getCurrentUserId();
  if (userId) redirect("/feed");

  return (
    <div className="max-w-2xl mx-auto py-12 space-y-16">
      {/* Hero */}
      <section className="text-center space-y-4">
        <h1 className="text-4xl font-bold tracking-tight">low-scroll</h1>
        <p className="text-lg text-muted-foreground leading-relaxed">
          Your Instagram feed, delivered as a daily email digest.
          <br />
          Less scrolling, more living.
        </p>
        <div className="flex items-center justify-center gap-4 pt-4">
          <Link
            href="/signup"
            className="inline-block px-6 py-2.5 rounded-md text-sm font-medium text-white bg-gradient-to-r from-[#FEDA77] via-[#DD2A7B] to-[#515BD4] hover:opacity-90 transition-opacity"
          >
            Sign up
          </Link>
          <Link
            href="/login"
            className="inline-block px-6 py-2.5 rounded-md text-sm font-medium border border-current hover:bg-foreground/5 transition-colors"
          >
            Log in
          </Link>
        </div>
      </section>

      {/* How it works */}
      <section className="space-y-6">
        <h2 className="text-xl font-semibold text-center">How it works</h2>
        <ol className="space-y-4">
          {[
            "Create an account and install the browser extension",
            "The extension syncs your Instagram cookies securely",
            "Get a daily email digest with posts and stories",
          ].map((step, i) => (
            <li key={i} className="flex items-start gap-4">
              <span className="flex-none w-8 h-8 rounded-full border-2 border-foreground flex items-center justify-center text-sm font-bold">
                {i + 1}
              </span>
              <span className="pt-1 text-muted-foreground">{step}</span>
            </li>
          ))}
        </ol>
      </section>

      {/* Trust & Transparency */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-center">
          Trust &amp; Transparency
        </h2>
        <ul className="space-y-3 text-sm text-muted-foreground">
          <li className="flex items-start gap-2">
            <span className="mt-1 block w-1.5 h-1.5 rounded-full bg-foreground/40 flex-none" />
            This service acts on your behalf on Instagram using your session
            cookies
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-1 block w-1.5 h-1.5 rounded-full bg-foreground/40 flex-none" />
            We recommend using a secondary/throwaway account
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-1 block w-1.5 h-1.5 rounded-full bg-foreground/40 flex-none" />
            Only intended for viewing content from public accounts
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-1 block w-1.5 h-1.5 rounded-full bg-foreground/40 flex-none" />
            Fully open source &mdash;{" "}
            <a
              href="https://github.com/niec-and-nansen/ig-sub"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-foreground transition-colors"
            >
              view on GitHub
            </a>
          </li>
        </ul>
      </section>

      {/* Footer */}
      <footer className="text-center text-xs text-muted-foreground pt-4 border-t">
        <a
          href="https://github.com/niec-and-nansen/ig-sub"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 hover:text-foreground transition-colors"
        >
          GitHub
        </a>
      </footer>
    </div>
  );
}
