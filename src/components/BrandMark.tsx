import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <img src="/branding/scous-mark.svg" width={64} height={64}
      className={cn("h-9 w-9", className)} alt="" aria-hidden="true" />
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
