const socials = [
  {
    name: "Telegram",
    href: "https://t.me/scousgiftcardexchange",
    path: "M21.5 3.5 18.2 20c-.2 1-1 .9-1.6.5l-5-3.7-2.4 2.3c-.3.3-.5.5-1 .5l.4-5.1L18 6c.4-.4-.1-.6-.6-.3L5.8 13 1 11.5c-1-.3-1-1 .2-1.5L20 2.8c.9-.3 1.7.2 1.5.7Z",
  },
  {
    name: "Instagram", href: "#",
    path: "M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5Zm0 2a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3H7Zm5 3a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm5.5-3a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z",
  },
  {
    name: "Facebook", href: "#",
    path: "M13.5 22v-9h3l.5-3.5h-3.5V7.3c0-1 .3-1.8 1.8-1.8H17V2.3c-.3 0-1.4-.3-2.8-.3C11.4 2 9.5 3.7 9.5 7v2.5H6V13h3.5v9h4Z",
  },
  {
    name: "X", href: "#",
    path: "M18.9 2H22l-6.8 7.8L23.2 22h-6.3L12 14.6 5.5 22H2.4l8.2-9.4L2 2h6.5l4.4 6.7L18.9 2ZM17.9 20h1.7L7.4 4H5.6l12.3 16Z",
  },
  {
    name: "TikTok", href: "#",
    path: "M16 2c.3 2.8 1.8 4.5 4.5 4.7v3.5A9 9 0 0 1 16 8.9v7a6 6 0 1 1-6-6h.9v3.6a2.5 2.5 0 1 0 1.6 2.4V2H16Z",
  },
] as const;

export function SocialLinks() {
  return (
    <nav aria-label="Social media" className="flex flex-wrap gap-2">
      {socials.map(({ name, href, path }) => (
        <a key={name} href={href}
          aria-label={href === "#" ? `${name} (coming soon)` : name}
          title={href === "#" ? `${name} — coming soon` : name}
          target={href === "#" ? undefined : "_blank"}
          rel={href === "#" ? undefined : "noopener noreferrer"}
          onClick={href === "#" ? e => e.preventDefault() : undefined}
          className="border-border hover:text-primary focus-visible:ring-primary flex h-11 w-11 items-center justify-center rounded-full border focus-visible:outline-none focus-visible:ring-2">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
            <path d={path} fillRule="evenodd" />
          </svg>
        </a>
      ))}
    </nav>
  );
}
