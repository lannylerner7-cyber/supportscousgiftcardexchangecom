import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Menu, X } from "lucide-react";

import { BrandWordmark } from "./BrandMark";

const LINKS = [
  { to: "/rates", label: "Rates" },
  { to: "/support", label: "Support" },
  { to: "/terms", label: "Terms" },
] as const;

export function PublicHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header className="border-border/60 bg-background/80 sticky top-0 z-40 border-b backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <Link to="/" className="shrink-0">
          <BrandWordmark />
        </Link>

        <nav className="hidden items-center gap-7 md:flex">
          {LINKS.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              className="text-muted-foreground hover:text-foreground text-sm font-medium transition-colors"
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <Link
            to="/login"
            className="text-foreground hover:bg-surface-2 rounded-full px-4 py-2 text-sm font-medium transition-colors"
          >
            Log in
          </Link>
          <Link
            to="/signup"
            className="bg-gold-gradient text-primary-foreground rounded-full px-5 py-2 text-sm font-semibold shadow-lg shadow-black/30"
          >
            Get started
          </Link>
        </div>

        <button
          type="button"
          aria-label="Menu"
          onClick={() => setOpen((v) => !v)}
          className="bg-surface-2 rounded-xl p-2 md:hidden"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {open && (
        <div className="border-border/60 bg-background animate-pop-in border-t px-4 py-4 md:hidden">
          <div className="flex flex-col gap-1">
            {LINKS.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                onClick={() => setOpen(false)}
                className="hover:bg-surface-2 rounded-lg px-3 py-2.5 text-sm font-medium"
              >
                {l.label}
              </Link>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Link
              to="/login"
              onClick={() => setOpen(false)}
              className="border-border rounded-full border px-4 py-2.5 text-center text-sm font-medium"
            >
              Log in
            </Link>
            <Link
              to="/signup"
              onClick={() => setOpen(false)}
              className="bg-gold-gradient text-primary-foreground rounded-full px-4 py-2.5 text-center text-sm font-semibold"
            >
              Get started
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className="border-border/60 mt-24 border-t">
      <div className="text-muted-foreground mx-auto flex max-w-6xl flex-col gap-4 px-4 py-10 text-sm sm:flex-row sm:items-center sm:justify-between">
        <BrandWordmark className="text-foreground" />
        <div className="flex flex-wrap gap-5">
          <Link to="/rates" className="hover:text-foreground">
            Rates
          </Link>
          <Link to="/support" className="hover:text-foreground">
            Support
          </Link>
          <Link to="/terms" className="hover:text-foreground">
            Terms
          </Link>
          <Link to="/privacy" className="hover:text-foreground">
            Privacy
          </Link>
        </div>
        <p>© {new Date().getFullYear()} ScousGiftCardExchange</p>
      </div>
    </footer>
  );
}
