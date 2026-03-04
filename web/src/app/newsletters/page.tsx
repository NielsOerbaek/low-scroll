import { NewsletterDashboard } from "@/components/newsletter-dashboard";
import { Logo } from "@/components/logo";

export default function NewslettersPage() {
  return (
    <div className="max-w-[1600px] mx-auto">
      <div className="flex justify-center mb-6">
        <Logo />
      </div>
      <NewsletterDashboard />
    </div>
  );
}
