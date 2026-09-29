import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { BrandWordmark } from "./BrandMark";

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="bg-night-gradient flex min-h-screen flex-col px-4 py-8">
      <Link to="/" className="mx-auto">
        <BrandWordmark />
      </Link>

      <div className="mx-auto mt-10 w-full max-w-sm">
        <h1 className="font-display text-3xl font-extrabold tracking-tight">{title}</h1>
        {subtitle && <p className="text-muted-foreground mt-2 text-sm">{subtitle}</p>}
        <div className="mt-7">{children}</div>
        {footer && <div className="text-muted-foreground mt-6 text-center text-sm">{footer}</div>}
      </div>
    </div>
  );
}
