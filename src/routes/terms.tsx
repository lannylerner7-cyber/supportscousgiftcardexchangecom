import { createFileRoute } from "@tanstack/react-router";

import { PublicFooter, PublicHeader } from "@/components/PublicHeader";
import { publicHead } from "@/lib/public-site";

export const Route = createFileRoute("/terms")({
  head: () => ({
    ...publicHead("/terms", "Terms of service — ScousGiftCardExchange", "Read the rules for trading gift cards, rate calculations, partial payments, wallet balances and Naira withdrawals with Scous Gift Card Exchange."),
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
    p: "Request deactivation in Settings. Withdraw available funds using the usual fee and minimum and settle pending activity before admin approval. Unlocked rewards remain part of your balance; still-locked promotional credit may be waived only with explicit consent. Inactive records are retained for possible reactivation, subject to admin review. Contact support for permanent deletion requests.",
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
