/** Opt-in preview transport; Coolify continues using its existing credentials. */
export function usesReplitCloudflare() {
  return process.env["CLOUDFLARE_USE_REPLIT_CONNECTOR"] === "true";
}

export async function cloudflareFetch(url: string, init: RequestInit = {}) {
  if (!usesReplitCloudflare()) return fetch(url, init);
  const target = new URL(url);
  if (target.hostname !== "api.cloudflare.com" || !target.pathname.startsWith("/client/v4/")) {
    throw new Error("The Replit connection requires the direct Cloudflare API endpoint.");
  }
  const { ReplitConnectors } = await import("@replit/connectors-sdk");
  const headers = new Headers(init.headers);
  headers.delete("Authorization");
  headers.delete("X-Connection-Api-Key");
  return new ReplitConnectors().proxy("cloudflare", target.pathname.slice("/client".length) + target.search, {
    ...init,
    headers: Object.fromEntries(headers.entries()),
  });
}
