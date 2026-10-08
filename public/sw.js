/* Only fixed, non-sensitive install assets are cached. Never cache fetched pages. */
const CACHE = "scous-install-v1";
const ASSETS = ["/offline.html", "/icon-192.png", "/icon-512.png", "/icon-maskable.png"];
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith("scous-install-") && key !== CACHE)
    .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("message", event => {
  if (event.data === "ACTIVATE_UPDATE") self.skipWaiting();
});
self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request, {cache:"no-store"}).catch(async () =>
      (await caches.match("/offline.html")) || new Response("Offline. Reconnect to continue.", {status:503})));
  } else if (!url.search && ASSETS.includes(url.pathname)) {
    event.respondWith(caches.match(request).then(cached => cached || fetch(request)));
  }
  // API, server functions, proofs and all other resources pass through untouched.
});
self.addEventListener("push", event => {
  let data={};
  try {data=event.data?.json() || {};} catch { /* Generic message only. */ }
  event.waitUntil(self.registration.showNotification("ScousExchange",{
    body:"You have a new account update. Open Scous to view it.",
    icon:"/icon-192.png",badge:"/icon-192.png",
    tag:typeof data.tag==="string"?data.tag:"scous-update",
    data:{url:"/app/notifications"},
  }));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  // Never accept an arbitrary URL from a push payload.
  event.waitUntil(self.clients.openWindow(new URL("/app/notifications",self.location.origin).href));
});
