import { createFileRoute } from "@tanstack/react-router";

import { PublicFooter, PublicHeader } from "@/components/PublicHeader";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of service — ScousGiftCardExchange" },
      {
        name: "description",
        content: "The rules for trading gift cards and withdrawing Naira on our platform.",
      },
      { property: "og:title", content: "Terms of service" },
      { property: "og:description", content: "The rules for trading and withdrawing with us." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Terms,
});

const SECTIONS = [
  {
    h: "Who can trade",
    p: "You must be at least 18 and the rightful owner of every card you submit. One account per person.",
  },
  {
    h: "Card submissions",
    p: "Submit only cards you legally own and have not redeemed. Cards found to be used, stolen or already redeemed are rejected, and repeated attempts close the account.",
  },
  {
    h: "Rates and pricing",
    p: "The rate shown when you submit is the rate we honour for that trade. Rates change through the day and past rates do not bind future trades.",
  },
  {
    h: "Partial payments",
    p: "Where only part of a card's value is usable, we pay for that part and record a note explaining the shortfall.",
  },
  {
    h: "Wallet and withdrawals",
    p: "Your wallet balance is held for you in Naira. Withdrawals go to the bank account you save, carry a flat ₦300 fee, and are processed by our desk.",
  },
  {
    h: "Closing your account",
    p: "You can delete your account at any time once your balance is zero and no trade or withdrawal is pending.",
  },
];

function Terms() {
  return (
    <div className="min-h-screen">
      <PublicHeader />
      <main className="mx-auto max-w-3xl px-4 py-12">
        <h1 className="font-display text-4xl font-extrabold tracking-tight">Terms of service</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Plain-language rules for using ScousGiftCardExchange.
        </p>
        <div className="mt-8 space-y-7">
          {SECTIONS.map((s) => (
            <section key={s.h}>
              <h2 className="font-display text-lg font-bold">{s.h}</h2>
              <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">{s.p}</p>
            </section>
          ))}
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
