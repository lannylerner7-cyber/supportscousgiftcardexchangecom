import { REFERRAL_BONUS_KOBO } from "./referral.ts";

/** One D1 transaction: valid OTP, inviter ledger/payment, verification, consumption.
 * The ledger guard includes legacy payouts. No backfill for already-verified users.
 */
export function verificationStatements(input: {
  email: string; otpId: string; now: string; maxAttempts: number;
  rewardId: string; notificationId: string; signup: boolean;
}) {
  const { email, otpId, now, maxAttempts, rewardId, notificationId, signup } = input;
  const active = `EXISTS (SELECT 1 FROM otp_codes WHERE id = ? AND email = ?
    AND consumed_at IS NULL AND expires_at > ? AND attempts < ?)`;
  const params = [otpId, email, now, maxAttempts];
  const statements: { sql: string; params: unknown[] }[] = [];
  if (signup) statements.push(
    {
      sql: `INSERT INTO wallet_transactions
        (id,wallet_id,user_id,type,amount,balance_after,reference_type,reference_id,note,created_at)
        SELECT ?, w.id, w.user_id, 'credit', ?, w.balance_naira + ?, 'referral', p.id,
          'Referral bonus — your friend verified their email', ?
        FROM profiles p JOIN wallets w ON w.user_id = p.referred_by
        JOIN profiles inviter ON inviter.id = w.user_id
        WHERE p.email = ? AND p.is_verified = 0 AND p.deleted_at IS NULL
          AND inviter.deleted_at IS NULL AND p.id <> w.user_id
          AND NOT EXISTS (SELECT 1 FROM wallet_transactions
            WHERE reference_id = p.id AND reference_type IN ('referral','referral_unlock'))
          AND ${active}`,
      params: [rewardId, REFERRAL_BONUS_KOBO, REFERRAL_BONUS_KOBO, now, email, ...params],
    },
    {
      sql: `UPDATE wallets SET balance_naira = balance_naira + ?, updated_at = ?
        WHERE id = (SELECT wallet_id FROM wallet_transactions WHERE id = ?)`,
      params: [REFERRAL_BONUS_KOBO, now, rewardId],
    },
    {
      sql: `INSERT INTO notifications (id,user_id,title,body,type,link,created_at)
        SELECT ?, user_id, 'Referral bonus paid',
          '₦2,000 has been added to your wallet after your friend verified their email.',
          'success', '/app', ? FROM wallet_transactions WHERE id = ?`,
      params: [notificationId, now, rewardId],
    },
    {
      // Old Coolify builds check referral_unlock, not referral, before paying at
      // redemption. Retain a zero-value marker while old/new builds may overlap.
      sql: `INSERT INTO wallet_transactions
        (id,wallet_id,user_id,type,amount,balance_after,reference_type,reference_id,note,created_at)
        SELECT ? || '-legacy', w.id, w.user_id, 'release', 0, w.balance_naira,
          'referral_unlock', t.reference_id, 'Inviter reward settled at email verification', ?
        FROM wallet_transactions t JOIN wallets w ON w.user_id = t.reference_id
        WHERE t.id = ?`,
      params: [rewardId, now, rewardId],
    },
    {
      sql: `UPDATE profiles SET is_verified = 1, updated_at = ? WHERE email = ? AND ${active}`,
      params: [now, email, ...params],
    },
    {
      sql: `UPDATE users SET email_confirmed_at = COALESCE(email_confirmed_at, ?), updated_at = ?
        WHERE email = ? AND ${active}`,
      params: [now, now, email, ...params],
    },
  );
  statements.push({
    sql: `UPDATE otp_codes SET consumed_at = ? WHERE id = ? AND email = ?
      AND consumed_at IS NULL AND expires_at > ? AND attempts < ? RETURNING id`,
    params: [now, ...params],
  });
  return statements;
}
