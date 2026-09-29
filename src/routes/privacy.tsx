import { createFileRoute } from "@tanstack/react-router";

import { PublicFooter, PublicHeader } from "@/components/PublicHeader";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy policy — ScousGiftCardExchange" },
      {
        name: "description",
        content: "What we collect, why we collect it, and how your card uploads stay private.",
      },
      { property: "og:title", content: "Privacy policy" },
      { property: "og:description", content: "How we handle your data and card uploads." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
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
    p: "You can update your details any time, turn notifications off, and delete your account once your balance is zero.",
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
