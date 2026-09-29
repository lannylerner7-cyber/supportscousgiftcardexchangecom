import { createFileRoute, Link } from "@tanstack/react-router";
import { MessageCircle, Mail, Clock } from "lucide-react";

import { PublicFooter, PublicHeader } from "@/components/PublicHeader";

export const Route = createFileRoute("/support")({
  head: () => ({
    meta: [
      { title: "Support — ScousGiftCardExchange" },
      {
        name: "description",
        content: "Get help with a trade, a withdrawal or your account. We answer fast.",
      },
      { property: "og:title", content: "ScousGiftCardExchange support" },
      { property: "og:description", content: "Help with trades, withdrawals and your account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Support,
});

const FAQS = [
  {
    q: "How long does a trade take?",
    a: "Most cards are reviewed within minutes during trading hours. You'll see the status change live and get a notification the moment it's decided.",
  },
  {
    q: "Why was my card partially paid?",
    a: "Sometimes only part of a card's value is still available. When that happens we pay for the usable balance and leave a note explaining exactly what we found.",
  },
  {
    q: "When does my money arrive?",
    a: "Approved trades credit your wallet instantly. Bank withdrawals are processed by our desk and carry a flat ₦300 fee.",
  },
  {
    q: "Is my card image private?",
    a: "Yes. Uploads are visible only to you and the reviewer handling your trade.",
  },
];

function Support() {
  return (
    <div className="min-h-screen">
      <PublicHeader />
      <main className="mx-auto max-w-3xl px-4 py-12">
        <h1 className="font-display text-4xl font-extrabold tracking-tight">We&apos;re here</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Questions about a trade, a payout or your account? Start a chat from inside your account
          and a real person will pick it up.
        </p>

        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          {[
            { icon: MessageCircle, title: "Live chat", body: "Inside your account, per trade." },
            { icon: Clock, title: "Trading hours", body: "8am – 11pm daily, WAT." },
            { icon: Mail, title: "Email", body: "support@scousexchange.com" },
          ].map((c) => (
            <div key={c.title} className="border-border/70 bg-surface rounded-2xl border p-5">
              <c.icon className="text-primary h-5 w-5" />
              <h2 className="mt-3 text-sm font-bold">{c.title}</h2>
              <p className="text-muted-foreground mt-1 text-xs">{c.body}</p>
            </div>
          ))}
        </div>

        <h2 className="font-display mt-12 text-2xl font-bold">Common questions</h2>
        <div className="mt-4 space-y-3">
          {FAQS.map((f) => (
            <details key={f.q} className="border-border/70 bg-surface group rounded-2xl border p-5">
              <summary className="cursor-pointer list-none text-sm font-semibold">{f.q}</summary>
              <p className="text-muted-foreground mt-2 text-sm">{f.a}</p>
            </details>
          ))}
        </div>

        <div className="border-border/70 bg-surface mt-10 rounded-2xl border p-6 text-center">
          <p className="text-sm font-semibold">Still stuck?</p>
          <Link
            to="/signup"
            className="bg-gold-gradient text-primary-foreground mt-4 inline-flex rounded-full px-6 py-3 text-sm font-bold"
          >
            Create an account to chat
          </Link>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
