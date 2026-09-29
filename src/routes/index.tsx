import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { ArrowRight, BadgeCheck, ShieldCheck, Zap } from "lucide-react";

import { listBanners, listBrands, listTopRates } from "@/lib/catalog.functions";
import { PublicHeader, PublicFooter } from "@/components/PublicHeader";
import { BrandTile, BrandTileSkeleton, type BrandLike } from "@/components/BrandTile";
import { ContactForm } from "@/components/ContactForm";
import { naira } from "@/lib/format";
import heroCards from "@/assets/hero-cards.jpg";
import { useMarketRealtime } from "@/hooks/useMarketRealtime";


export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ScousGiftCardExchange — Trade gift cards for Naira" },
      {
        name: "description",
        content:
          "Sell Apple, Amazon, Steam, Razer Gold and more gift cards for Naira. Honest rates, quick reviews and payouts straight to your bank.",
      },
      { property: "og:title", content: "Trade gift cards for Naira, fast" },
      {
        property: "og:description",
        content: "Honest rates, quick reviews and payouts straight to your bank.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Home,
});

function useBrands() {
  return useQuery({
    queryKey: ["public-brands"],
    queryFn: () => listBrands() as Promise<BrandLike[]>,
  });
}

function useBanners() {
  return useQuery({ queryKey: ["public-banners"], queryFn: () => listBanners() });
}


function useTopRates() {
  return useQuery({ queryKey: ["public-top-rates"], queryFn: () => listTopRates() });
}

function Home() {
  useMarketRealtime();
  const brands = useBrands();
  const banners = useBanners();
  const rates = useTopRates();
  const bannerRef = useRef<HTMLDivElement | null>(null);

  // Auto-rotate the campaign banners, pausing while the visitor is touching them.
  useEffect(() => {
    const el = bannerRef.current;
    if (!el) return;
    let paused = false;
    const pause = () => (paused = true);
    const resume = () => (paused = false);
    el.addEventListener("pointerdown", pause);
    el.addEventListener("pointerup", resume);
    el.addEventListener("mouseenter", pause);
    el.addEventListener("mouseleave", resume);

    const id = window.setInterval(() => {
      if (paused || !el.scrollWidth) return;
      const step = el.clientWidth * 0.88;
      const next = el.scrollLeft + step;
      el.scrollTo({
        left: next >= el.scrollWidth - el.clientWidth - 8 ? 0 : next,
        behavior: "smooth",
      });
    }, 4000);

    return () => {
      window.clearInterval(id);
      el.removeEventListener("pointerdown", pause);
      el.removeEventListener("pointerup", resume);
      el.removeEventListener("mouseenter", pause);
      el.removeEventListener("mouseleave", resume);
    };
  }, [banners.data]);



  return (
    <div className="min-h-screen">
      <PublicHeader />

      <main>
        {/* Hero */}
        <section className="relative overflow-hidden px-4 pt-14 pb-10">
          <div
            className="pointer-events-none absolute -top-32 left-1/2 h-72 w-[36rem] -translate-x-1/2 rounded-full opacity-25 blur-3xl"
            style={{ background: "var(--gold)" }}
          />
          <div className="relative mx-auto max-w-3xl text-center">
            <span className="border-border bg-surface text-muted-foreground inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium">
              <span className="bg-money h-1.5 w-1.5 rounded-full" />
              Rates updated daily by our desk
            </span>
            <h1 className="font-display mt-5 text-4xl leading-[1.05] font-extrabold tracking-tight sm:text-6xl">
              Turn gift cards into <span className="text-money">Naira</span>, in minutes.
            </h1>
            <p className="text-muted-foreground mx-auto mt-4 max-w-xl text-base sm:text-lg">
              Upload your card, we price and verify it, and the money lands in your wallet. Withdraw
              to your bank whenever you like.
            </p>
            <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                to="/signup"
                className="bg-gold-gradient text-primary-foreground inline-flex w-full items-center justify-center gap-2 rounded-full px-7 py-3.5 text-sm font-bold shadow-xl shadow-black/40 sm:w-auto"
              >
                Start trading <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                to="/rates"
                className="border-border bg-surface hover:bg-surface-2 inline-flex w-full items-center justify-center rounded-full border px-7 py-3.5 text-sm font-semibold sm:w-auto"
              >
                See today&apos;s rates
              </Link>
            </div>

            <div className="animate-float relative mx-auto mt-10 max-w-lg">
              <div
                className="pointer-events-none absolute inset-6 rounded-full opacity-30 blur-3xl"
                style={{ background: "var(--money)" }}
              />
              <img
                src={heroCards}
                alt="Gift cards turning into Naira"
                width={1280}
                height={960}
                className="relative w-full rounded-[2rem] shadow-2xl shadow-black/60"
              />
            </div>
          </div>
        </section>


        {/* Rate ticker */}
        <section className="border-border/60 border-y py-3">
          <div className="flex gap-3 overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_8%,#000_92%,transparent)]">
            <div className="animate-ticker flex shrink-0 gap-3">
              {(rates.data ?? []).concat(rates.data ?? []).map((r, i) => {
                const brand = (r as { gift_card_brands?: { name?: string } }).gift_card_brands;
                const region = (r as { gift_card_regions?: { code?: string } }).gift_card_regions;
                return (
                  <span
                    key={`${r.id}-${i}`}
                    className="bg-surface border-border/70 flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs whitespace-nowrap"
                  >
                    <span className="font-semibold">{brand?.name}</span>
                    <span className="text-muted-foreground">{region?.code}</span>
                    <span className="text-money font-bold">{naira(r.rate_naira)}/$</span>
                  </span>
                );
              })}
              {rates.isLoading &&
                Array.from({ length: 6 }).map((_, i) => (
                  <span key={i} className="bg-surface-2 shimmer h-7 w-40 rounded-full" />
                ))}
            </div>
          </div>
        </section>

        {/* Banners */}
        <section className="mx-auto max-w-6xl px-4 pt-10">
          <div
            ref={bannerRef}
            className="scrollbar-none -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth px-4 pb-2"
          >

            {banners.isLoading &&
              Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="bg-surface-2 shimmer h-32 w-[85%] shrink-0 rounded-3xl" />
              ))}
            {(banners.data ?? []).map((b, i) => (
              <article
                key={b.id}
                className="border-border/70 bg-surface relative w-[85%] shrink-0 snap-start overflow-hidden rounded-3xl border p-5 sm:w-[46%]"
              >
                <span
                  className="pointer-events-none absolute -top-10 -right-10 h-32 w-32 rounded-full opacity-30 blur-2xl"
                  style={{ background: i % 2 === 0 ? "var(--gold)" : "var(--money)" }}
                />
                <h3 className="font-display relative text-lg font-bold">{b.title}</h3>
                <p className="text-muted-foreground relative mt-1 text-sm">{b.subtitle}</p>
                <Link
                  to="/signup"
                  className="text-primary relative mt-4 inline-flex items-center gap-1 text-sm font-semibold"
                >
                  Start trading <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </article>
            ))}

          </div>
        </section>

        {/* Brands */}
        <section className="mx-auto max-w-6xl px-4 pt-12">
          <div className="flex items-end justify-between">
            <h2 className="font-display text-2xl font-bold tracking-tight">Cards we buy</h2>
            <Link to="/rates" className="text-primary text-sm font-semibold">
              All rates
            </Link>
          </div>
          <div className="mt-5 grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {brands.isLoading
              ? Array.from({ length: 12 }).map((_, i) => <BrandTileSkeleton key={i} />)
              : (brands.data ?? []).map((b) => <BrandTile key={b.id} brand={b} />)}
          </div>
        </section>

        {/* Why */}
        <section className="mx-auto mt-16 max-w-6xl px-4">
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              {
                icon: Zap,
                title: "Reviewed fast",
                body: "Our desk gets an alert the second you submit. Most trades are priced within minutes.",
              },
              {
                icon: ShieldCheck,
                title: "Your card, protected",
                body: "Uploads are private to you and our review team. Nothing is shared, ever.",
              },
              {
                icon: BadgeCheck,
                title: "Honest payouts",
                body: "You see the rate and the exact amount before you submit. Partial payments always come with a note.",
              },
            ].map((f) => (
              <div key={f.title} className="border-border/70 bg-surface rounded-3xl border p-6">
                <f.icon className="text-primary h-6 w-6" />
                <h3 className="font-display mt-4 text-lg font-bold">{f.title}</h3>
                <p className="text-muted-foreground mt-1.5 text-sm">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="contact" className="mx-auto mt-16 max-w-2xl px-4">
          <ContactForm />
        </section>

        <section className="mx-auto mt-16 max-w-4xl px-4">
          <div className="bg-night-gradient border-border/70 relative overflow-hidden rounded-[2rem] border p-10 text-center">
            <span
              className="pointer-events-none absolute -bottom-16 left-1/2 h-40 w-96 -translate-x-1/2 rounded-full opacity-25 blur-3xl"
              style={{ background: "var(--money)" }}
            />
            <h2 className="font-display relative text-3xl font-extrabold tracking-tight">
              Ready when you are
            </h2>
            <p className="text-muted-foreground relative mx-auto mt-2 max-w-md text-sm">
              Create an account in under a minute and trade your first card today.
            </p>
            <Link
              to="/signup"
              className="bg-gold-gradient text-primary-foreground relative mt-6 inline-flex items-center gap-2 rounded-full px-7 py-3.5 text-sm font-bold"
            >
              Create free account <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}
