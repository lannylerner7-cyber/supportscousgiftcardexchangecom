/**
 * Member email alerts (server-only). Never throws and never waits more than
 * 8 seconds, so an alert can't fail or stall the action that triggered it.
 */
import { queryOne } from "./d1.server";

type Mail = { subject: string; html: string; text: string };

export async function mailMember(userId: string, build: (name: string) => Mail) {
  try {
    const { sendEmail, emailConfigured } = await import("./email.server");
    if (!emailConfigured()) return;
    const who = await queryOne<{ full_name: string; email: string }>(
      "SELECT full_name, email FROM profiles WHERE id = ? AND deleted_at IS NULL",
      [userId],
    );
    if (!who?.email) return;
    const mail = build(who.full_name ?? "");
    await Promise.race([
      sendEmail({ to: who.email, subject: mail.subject, html: mail.html, text: mail.text }),
      new Promise((r) => setTimeout(r, 8_000)),
    ]);
  } catch (e) {
    console.error("[email] member alert failed", (e as Error).message);
  }
}

export const naira = (kobo: number) => `₦${(kobo / 100).toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;
