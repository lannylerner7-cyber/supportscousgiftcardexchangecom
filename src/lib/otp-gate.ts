/**
 * Navigation hint only. Server-side session verification enforces access.
 *
 * Never use this marker as authentication evidence. Clearing browser storage
 * cannot promote a pending session or authorize any protected request.
 */
const KEY = "scous.pending_otp";

export function markOtpPending(email: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, email.trim().toLowerCase());
}

export function pendingOtpEmail(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(KEY);
}

export function clearOtpPending() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY);
}
