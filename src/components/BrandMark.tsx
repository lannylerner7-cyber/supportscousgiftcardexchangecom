import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn("h-9 w-9", className)} aria-hidden="true">
      <defs>
        <linearGradient id="scous-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="oklch(0.83 0.16 89)" />
          <stop offset="100%" stopColor="oklch(0.8 0.16 152)" />
        </linearGradient>
      </defs>
      <rect x="4" y="12" width="56" height="40" rx="10" fill="url(#scous-gold)" />
      <rect x="4" y="24" width="56" height="7" fill="oklch(0.17 0.033 264 / 70%)" />
      <circle cx="18" cy="42" r="5" fill="oklch(0.17 0.033 264 / 80%)" />
      <path
        d="M32 38h20"
        stroke="oklch(0.17 0.033 264 / 80%)"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function BrandWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <BrandMark className="h-7 w-7" />
      <span className="font-display text-base font-bold tracking-tight">
        Scous<span className="text-primary">Exchange</span>
      </span>
    </span>
  );
}
