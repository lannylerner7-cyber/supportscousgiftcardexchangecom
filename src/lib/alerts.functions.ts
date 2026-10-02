/**
 * Outgoing alerts: new card submitted, new withdrawal, contact form, plus the
 * admin console's mail status and test send. All reads are on D1 and every
 * caller is authorised here.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

function siteUrl() {
  try {
    const req = getRequest();
    return new URL(req.url).origin;
  } catch {
    return process.env["APP_URL"] ?? "";
  }
}

async function alertRecipients(): Promise<string[]> {
  const { queryOne } = await import("./d1.server");
  const row = await queryOne<{ alert_emails: string | null }>(
    "SELECT alert_emails FROM app_settings WHERE id = 1",
  );
  try {
    const parsed = JSON.parse(row?.alert_emails ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((v): v is string => Boolean(v)) : [];
  } catch {
    return [];
  }
}

const naira = (v: number) => `₦${Number(v).toLocaleString("en-NG")}`;

/** Email the admin alert addresses about a freshly submitted card. */
export const notifyTradeSubmitted = createServerFn({ method: "POST" })
  .inputValidator((d: { tradeId: string }) => z.object({ tradeId: z.string().min(10) }).parse(d))
  .handler(async ({ data }) => {
    const { requireUserId } = await import("./guard.server");
    const { queryOne, toNaira } = await import("./d1.server");
    const { sendEmail, tradeAlertEmail } = await import("./email.server");

    const userId = await requireUserId();
    const trade = await queryOne<Record<string, unknown>>(
      `SELECT t.id, t.user_id, t.brand_name, t.region_code, t.card_type, t.face_value,
              t.currency, t.expected_payout,
              p.full_name, p.email, p.phone,
              (SELECT COUNT(*) FROM trade_images ti WHERE ti.trade_id = t.id) AS image_count
         FROM trades t JOIN profiles p ON p.id = t.user_id
        WHERE t.id = ? LIMIT 1`,
      [data.tradeId],
    );
    if (!trade || trade["user_id"] !== userId) return { sent: false as const };

    const to = await alertRecipients();
    if (to.length === 0) return { sent: false as const };

    const mail = tradeAlertEmail({
      member: String(trade["full_name"] || "Member"),
      email: String(trade["email"] ?? ""),
      phone: String(trade["phone"] ?? "not provided"),
      brand: String(trade["brand_name"]),
      region: String(trade["region_code"]),
      cardType: trade["card_type"] === "ecode" ? "E-code" : "Physical",
      faceValue: `${trade["currency"]} ${Number(trade["face_value"]).toLocaleString()}`,
      payout: naira(toNaira(trade["expected_payout"])),
      reference: String(trade["id"]).slice(0, 8).toUpperCase(),
      images: Number(trade["image_count"] ?? 0),
      link: `${siteUrl()}/ScousGiftCardExchange/admin/trades/${String(trade["id"])}`,
    });
    const res = await sendEmail({ to, subject: mail.subject, html: mail.html, text: mail.text });
    return { sent: res.sent };
  });

/** Email the admin alert addresses about a new withdrawal request. */
export const notifyWithdrawalRequested = createServerFn({ method: "POST" })
  .inputValidator((d: { withdrawalId: string }) =>
    z.object({ withdrawalId: z.string().min(10) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { requireUserId } = await import("./guard.server");
    const { queryOne, toNaira } = await import("./d1.server");
    const { sendEmail, withdrawalAlertEmail } = await import("./email.server");

    const userId = await requireUserId();
    const w = await queryOne<Record<string, unknown>>(
      `SELECT w.id, w.user_id, w.amount, w.fee, w.net_amount, w.bank_snapshot,
              p.full_name, p.email, p.phone
         FROM withdrawals w JOIN profiles p ON p.id = w.user_id
        WHERE w.id = ? LIMIT 1`,
      [data.withdrawalId],
    );
    if (!w || w["user_id"] !== userId) return { sent: false as const };

    const to = await alertRecipients();
    if (to.length === 0) return { sent: false as const };

    let snap: { bank_name?: string; account_number?: string; account_name?: string } = {};
    try {
      snap = JSON.parse(String(w["bank_snapshot"] ?? "{}"));
    } catch {
      snap = {};
    }

    const mail = withdrawalAlertEmail({
      member: String(w["full_name"] || "Member"),
      email: String(w["email"] ?? ""),
      phone: String(w["phone"] ?? "not provided"),
      amount: naira(toNaira(w["amount"])),
      fee: naira(toNaira(w["fee"])),
      net: naira(toNaira(w["net_amount"])),
      bankName: snap.bank_name ?? "",
      accountNumber: snap.account_number ?? "",
      accountName: snap.account_name ?? "",
      reference: String(w["id"]).slice(0, 8).toUpperCase(),
      link: `${siteUrl()}/ScousGiftCardExchange/admin/withdrawals`,
    });
    const res = await sendEmail({ to, subject: mail.subject, html: mail.html, text: mail.text });
    return { sent: res.sent };
  });

/** Public contact form on the homepage. */
export const submitContactMessage = createServerFn({ method: "POST" })
  .inputValidator((d: { name: string; email: string; message: string }) =>
    z
      .object({
        name: z.string().trim().min(2).max(120),
        email: z.string().trim().email().max(200),
        message: z.string().trim().min(5).max(2000),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { queryOne, execute, newId, nowIso } = await import("./d1.server");
    const { sendEmail, contactAlertEmail } = await import("./email.server");
    const email = data.email.toLowerCase();

    // Simple flood guard: max 3 messages per email address per hour.
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const recent = await queryOne<{ c: number }>(
      "SELECT COUNT(*) AS c FROM contact_messages WHERE email = ? AND created_at >= ?",
      [email, since],
    );
    if ((recent?.c ?? 0) >= 3) return { ok: false as const, error: "too_many" };

    await execute(
      "INSERT INTO contact_messages (id, name, email, message, created_at) VALUES (?, ?, ?, ?, ?)",
      [newId(), data.name, email, data.message, nowIso()],
    );

    const to = await alertRecipients();
    if (to.length > 0) {
      const mail = contactAlertEmail({ name: data.name, email, message: data.message });
      await sendEmail({ to, subject: mail.subject, html: mail.html, text: mail.text });
    }
    return { ok: true as const };
  });

/** Admin console: is mail wired up? */
export const mailStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { requireAdminId } = await import("./guard.server");
  await requireAdminId();
  const { mailConfig, emailConfigured, usesCloudflareEmail } = await import("./email.server");
  const cfg = mailConfig();
  const viaApi = usesCloudflareEmail();
  const from = process.env["APP_EMAIL_FROM"] ?? null;
  return {
    configured: emailConfigured(),
    host: viaApi ? "Cloudflare Email Service (HTTPS)" : (cfg?.host ?? null),
    port: viaApi ? 443 : (cfg?.port ?? null),
    secure: viaApi ? true : (cfg?.secure ?? null),
    from: cfg?.from ?? from,
    replyTo: process.env["APP_EMAIL_REPLY_TO"] ?? null,
  };
});

/** Admin console: does a test message actually arrive? */
export const sendTestEmail = createServerFn({ method: "POST" })
  .inputValidator((d: { to: string }) => z.object({ to: z.string().email() }).parse(d))
  .handler(async ({ data }) => {
    const { requireAdminId } = await import("./guard.server");
    await requireAdminId();
    const { sendEmail, testEmail } = await import("./email.server");
    const mail = testEmail();
    const res = await sendEmail({
      to: data.to,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    });
    return { sent: res.sent, reason: res.reason ?? null };
  });

/** Admin console: who gets the alert emails. */
export const getAlertEmails = createServerFn({ method: "GET" }).handler(async () => {
  const { requireAdminId } = await import("./guard.server");
  await requireAdminId();
  return { emails: await alertRecipients() };
});

export const setAlertEmails = createServerFn({ method: "POST" })
  .inputValidator((d: { emails: string[] }) =>
    z.object({ emails: z.array(z.string().email().max(200)).max(10) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { requireAdminId } = await import("./guard.server");
    const { execute, nowIso, newId } = await import("./d1.server");
    const actorId = await requireAdminId();
    const emails = Array.from(new Set(data.emails.map((e) => e.trim().toLowerCase())));
    await execute(
      `INSERT INTO app_settings (id, alert_emails, updated_at) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET alert_emails = excluded.alert_emails, updated_at = excluded.updated_at`,
      [JSON.stringify(emails), nowIso()],
    );
    await execute(
      `INSERT INTO admin_audit_log (id, actor_id, action, target_type, after, created_at)
       VALUES (?, ?, 'alert_emails.update', 'app_settings', ?, ?)`,
      [newId(), actorId, JSON.stringify(emails), nowIso()],
    );
    return { ok: true as const, emails };
  });
