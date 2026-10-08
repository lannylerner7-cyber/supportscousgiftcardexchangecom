import { createFileRoute } from "@tanstack/react-router";

import { PublicFooter, PublicHeader } from "@/components/PublicHeader";
import { publicHead } from "@/lib/public-site";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    ...publicHead("/privacy", "Privacy policy — ScousGiftCardExchange", "Read how Scous handles account information, payout details and private gift-card images, and the choices available for your personal data."),
  }),
  component: Privacy,
});

const SECTIONS = [
  {
    h: "What we collect",
    p: "Your name, email, phone number, bank details for payouts, and the card images or codes you submit for trading.",
  },
  {
    h: "Why we collect it",
    p: "To verify your cards, pay you, keep your account secure, and meet our record-keeping duties.",
  },
  {
    h: "Card uploads",
    p: "Images and codes are stored privately. Only you and the reviewer handling your trade can open them.",
  },
  {
    h: "Sharing",
    p: "We never sell your data. We share only what a payment partner needs to move your money.",
  },
  {
    h: "Your choices",
    p: "You can update your details and notification preferences in Settings. Deactivation requires settlement and admin review; records and card evidence are retained for possible reactivation, not permanently erased. For permanent deletion requests or retention questions, contact support@scousgiftcardexchange.com. Ownership verification and applicable record-retention review are required.",
  },
];

function Privacy() {
  return (
    <div className="min-h-screen">
      <PublicHeader />
      <main className="mx-auto max-w-3xl px-4 py-12">
        <h1 className="font-display text-4xl font-extrabold tracking-tight">Privacy policy</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Short, honest, and written for people rather than lawyers.
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
