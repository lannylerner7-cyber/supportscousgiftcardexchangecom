import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { PUBLIC_PATHS, SITE_ORIGIN } from "./lib/public-site";
import { startDelivery } from "./lib/delivery.server";
import { observedRequest } from "./lib/observability.server";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    return observedRequest(async () => {
    const url = new URL(request.url);
    if (url.pathname === "/api/public/live") return Response.json({ok:true}, {headers:{"Cache-Control":"no-store"}});
    startDelivery(url.origin);
    const production = process.env["NODE_ENV"] === "production"
      && url.hostname === new URL(SITE_ORIGIN).hostname;
    if (url.pathname === "/robots.txt") return new Response(production
      ? `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /_server/\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`
      : "User-agent: *\nDisallow: /\n", {headers:{"Content-Type":"text/plain","Cache-Control":"no-store"}});
    if (url.pathname === "/sitemap.xml") return new Response(
      `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${production ? PUBLIC_PATHS.map(path => `<url><loc>${SITE_ORIGIN}${path}</loc></url>`).join("") : ""}</urlset>`,
      {headers:{"Content-Type":"application/xml","Cache-Control":"no-store","X-Robots-Tag":"noindex"}});
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      const normalized = await normalizeCatastrophicSsrResponse(response);
      const headers = new Headers(normalized.headers);
      if (!production || !PUBLIC_PATHS.includes(url.pathname) || normalized.status !== 200)
        headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
      if (!PUBLIC_PATHS.includes(url.pathname))
        headers.set("Cache-Control", "private, no-store");
      return new Response(normalized.body, {status:normalized.status, statusText:normalized.statusText, headers});
    } catch (error) {
      console.error("Request failed; details redacted");
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    });
  },
};
