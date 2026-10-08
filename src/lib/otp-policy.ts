/**
 * Shared email-code policy.
 *
 * Kept in its own module so both the general OTP flow and the consolidated
 * signup call use exactly the same limits — changing a number here changes it
 * everywhere.
 */
export const OTP_TTL_MIN = 5;
export const OTP_RESEND_COOLDOWN_S = 60;
export const OTP_MAX_RESENDS_PER_HOUR = 5;
export const OTP_MAX_ATTEMPTS = 3;

/** Six random digits, zero-padded. */
export function sixDigitCode() {
  return String(crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000).padStart(6, "0");
}
