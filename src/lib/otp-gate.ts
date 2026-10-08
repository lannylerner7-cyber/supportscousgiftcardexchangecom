/**
 * Keeps the emailed sign-in code unskippable.
 *
 * Signing in with a password creates a session, but the member is not allowed
 * into the app until the 6-digit code is confirmed. We park a marker in the
 * browser while a code is outstanding; the member area bounces back to the
 * code screen until it is cleared, and the marker only clears when the server
 * accepts the code.
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
