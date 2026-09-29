import { useState } from "react";

import { cn } from "@/lib/utils";
import { playTap } from "@/lib/sounds";

export type BrandLike = {
  id: string;
  name: string;
  slug: string;
  accent_color: string | null;
  logo_url?: string | null;
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

export function BrandLogo({
  brand,
  className,
}: {
  brand: BrandLike;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const accent = brand.accent_color ?? "#f0c453";

  if (brand.logo_url && !broken) {
    return (
      <span
        className={cn(
          "ring-border/60 flex items-center justify-center rounded-xl bg-black/40 ring-1",
          className,
        )}
      >
        <img
          src={brand.logo_url}
          alt={`${brand.name} logo`}
          loading="lazy"
          referrerPolicy="no-referrer"
          width={28}
          height={28}
          className="h-[60%] w-[60%] object-contain"
          onError={() => setBroken(true)}
        />
      </span>
    );
  }

  return (
    <span
      className={cn("flex items-center justify-center rounded-xl text-sm font-bold", className)}
      style={{ background: accent, color: "#0b1020" }}
    >
      {initials(brand.name)}
    </span>
  );
}

export function BrandTile({
  brand,
  selected,
  onSelect,
  className,
}: {
  brand: BrandLike;
  selected?: boolean;
  onSelect?: (brand: BrandLike) => void;
  className?: string;
}) {
  const accent = brand.accent_color ?? "#f0c453";
  return (
    <button
      type="button"
      onClick={() => {
        playTap();
        onSelect?.(brand);
      }}
      className={cn(
        "group bg-surface border-border/70 active:animate-tilt-tap relative flex aspect-[4/3] flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border p-3 transition-all duration-300",
        "hover:border-primary/60 hover:-translate-y-1 hover:shadow-xl hover:shadow-black/40",
        selected && "border-primary ring-primary/40 ring-2",
        className,
      )}
    >
      <span
        className="absolute inset-x-0 top-0 h-14 opacity-25 blur-2xl transition-opacity group-hover:opacity-50"
        style={{ background: accent }}
      />
      <BrandLogo
        brand={brand}
        className="relative h-11 w-11 transition-transform duration-300 group-hover:scale-110"
      />
      <span className="relative text-center text-xs leading-tight font-semibold">{brand.name}</span>
    </button>
  );
}

export function BrandTileSkeleton() {
  return <div className="bg-surface-2 shimmer aspect-[4/3] rounded-2xl" />;
}
