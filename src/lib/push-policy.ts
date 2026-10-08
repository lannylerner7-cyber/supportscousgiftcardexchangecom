export function validPushEndpoint(value: string) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password && !u.port && !u.hash
      && (u.hostname === "fcm.googleapis.com"
        || u.hostname === "updates.push.services.mozilla.com"
        || u.hostname === "web.push.apple.com"
        || /^[a-z0-9-]+\.notify\.windows\.com$/.test(u.hostname));
  } catch { return false; }
}
export const PUSH_MESSAGE = {title:"ScousExchange", body:"You have a new account update. Open Scous to view it.", url:"/app/notifications"};
