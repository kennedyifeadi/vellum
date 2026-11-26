import type { Metadata } from "next";

// The pricing page is a client component, which cannot export metadata itself.
export const metadata: Metadata = {
  title: "Pricing | Vellum",
  description: "Use Vellum free without an account, or sign in for more storage, larger files and longer file retention on Basic, Pro or Enterprise.",
};

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
