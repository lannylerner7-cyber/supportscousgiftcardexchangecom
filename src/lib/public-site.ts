// Owner-supplied Coolify domain, verified by HTTPS; not the Replit preview host.
export const SITE_ORIGIN = "https://scousgiftcardexchange.com";
export const PUBLIC_PATHS = ["/", "/rates", "/support", "/privacy", "/terms"];
export function publicHead(path: string, title: string, description: string) {
  const url = SITE_ORIGIN + path;
  return {
    meta: [
      { title }, { name: "description", content: description },
      { property: "og:title", content: title }, { property: "og:description", content: description },
      { property: "og:url", content: url }, { property: "og:type", content: "website" },
      { property: "og:image", content: SITE_ORIGIN + "/social.png" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: title }, { name: "twitter:description", content: description },
      { name: "twitter:image", content: SITE_ORIGIN + "/social.png" },
    ],
    links: [{ rel: "canonical", href: url }],
  };
}
