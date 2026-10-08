import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";

export function HomeAdvert() {
  return (
    <aside
      id="scous-advert"
      aria-label="Scous Gift Card Exchange advertisement"
      className="border-border/70 relative mx-auto mt-10 max-w-4xl scroll-mt-24 overflow-hidden rounded-[2rem] border text-left shadow-2xl shadow-black/60"
      style={{ background: "oklch(0.15 0.04 268)" }}
    >
      <div className="relative sm:aspect-[16/10]">
        <img
          src="/scous-gift-card-ad.webp"
          alt="Illustrative photo of a delighted man holding a fan of gift cards"
          width={1024}
          height={1024}
          loading="eager"
          className="block aspect-square w-full object-cover object-[70%_center] sm:absolute sm:inset-0 sm:aspect-auto sm:h-full sm:object-[right_20%]"
        />
        <div
          className="pointer-events-none absolute inset-0 hidden sm:block"
          style={{
            background:
              "linear-gradient(90deg, oklch(0.15 0.04 268) 0%, oklch(0.15 0.04 268 / 85%) 30%, transparent 58%)",
          }}
        />
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-24 sm:hidden"
          style={{ background: "linear-gradient(0deg, oklch(0.15 0.04 268), transparent)" }}
        />
        <div className="relative px-6 pt-2 pb-7 sm:absolute sm:inset-y-0 sm:left-0 sm:flex sm:w-[52%] sm:flex-col sm:justify-center sm:px-10 sm:py-10">
          <p className="text-money text-xs font-bold tracking-[0.18em] uppercase">
            Unused gift cards?
          </p>
          <h2 className="font-display mt-2 text-3xl leading-[1.02] font-extrabold tracking-tight sm:text-4xl lg:text-5xl">
            Your gift cards. <span className="text-primary">Your next move.</span>
          </h2>
          <p className="text-muted-foreground mt-3 max-w-sm text-sm sm:text-base">
            Check today&apos;s rates, submit your card for review, and withdraw your available
            balance to your bank.
          </p>
          <div className="mt-6 flex flex-col gap-2.5 sm:flex-row">
            <Link
              to="/signup"
              className="bg-gold-gradient text-primary-foreground inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-bold"
            >
              Sell a card <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              to="/rates"
              className="border-border bg-surface/80 hover:bg-surface-2 inline-flex items-center justify-center rounded-full border px-6 py-3 text-sm font-semibold"
            >
              Check rates
            </Link>
          </div>
        </div>
      </div>
    </aside>
  );
}
