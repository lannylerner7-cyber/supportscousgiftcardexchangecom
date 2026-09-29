/**
 * Outgoing app email (server-only).
 *
 * Delivery goes through the SMTP account configured in the project secrets:
 * SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE,
 * APP_EMAIL_FROM, APP_EMAIL_FROM_NAME, APP_EMAIL_REPLY_TO.
 *
 * Templates are table-based so Gmail, Outlook, Apple Mail and mobile clients
 * all render them, and every send carries a plain-text alternative which keeps
 * the spam score low.
 */
import { smtpSend, type SmtpConfig } from "./smtp.server";

export type SendResult = { sent: boolean; reason?: string };

const BRAND = "ScousGiftCardExchange";

export function mailConfig(): (SmtpConfig & { from: string; fromAddress: string; replyTo?: string }) | null {
  const host = process.env["SMTP_HOST"];
  const from = process.env["APP_EMAIL_FROM"];
  if (!host || !from) return null;
  const name = process.env["APP_EMAIL_FROM_NAME"] ?? BRAND;
  const port = Number(process.env["SMTP_PORT"] ?? 587);
  const replyTo = process.env["APP_EMAIL_REPLY_TO"];
  return {
    host,
    port,
    user: process.env["SMTP_USER"] ?? "",
    pass: process.env["SMTP_PASS"] ?? "",
    secure: (process.env["SMTP_SECURE"] ?? (port === 465 ? "true" : "false")) === "true",
    from: /[",:;<>]/.test(name) ? `"${name.replace(/"/g, "")}" <${from}>` : `${name} <${from}>`,
    fromAddress: from,
    ...(replyTo ? { replyTo } : {}),
  };
}

export function emailConfigured(): boolean {
  return mailConfig() !== null;
}

export async function sendEmail(input: {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
}): Promise<SendResult> {
  const cfg = mailConfig();
  if (!cfg) return { sent: false, reason: "not_configured" };
  const to = (Array.isArray(input.to) ? input.to : [input.to]).filter(Boolean);
  if (to.length === 0) return { sent: false, reason: "no_recipient" };

  try {
    await smtpSend(cfg, {
      from: cfg.from,
      fromAddress: cfg.fromAddress,
      to,
      ...(cfg.replyTo ? { replyTo: cfg.replyTo } : {}),
      subject: input.subject,
      html: input.html,
      text: input.text,
    });
    return { sent: true };
  } catch (e) {
    console.error("[email] send failed", (e as Error).message);
    return { sent: false, reason: (e as Error).message };
  }
}

/* ------------------------------------------------------------------ */
/* Shared layout                                                       */
/* ------------------------------------------------------------------ */

function esc(v: string) {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type Layout = {
  preheader: string;
  heading: string;
  /** Pre-escaped HTML block rendered inside the card. */
  bodyHtml: string;
  footerNote: string;
};

function shell({ preheader, heading, bodyHtml, footerNote }: Layout) {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${esc(heading)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f5f7;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f5f7;padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background-color:#ffffff;border:1px solid #e3e6eb;border-radius:14px;">
      <tr><td style="padding:22px 28px 6px;border-bottom:1px solid #eef0f3;">
        <p style="margin:0;font:700 17px/1.3 Arial,Helvetica,sans-serif;color:#0d1220;">${BRAND}</p>
      </td></tr>
      <tr><td style="padding:26px 28px 8px;">
        <h1 style="margin:0 0 10px;font:700 21px/1.3 Arial,Helvetica,sans-serif;color:#0d1220;">${esc(heading)}</h1>
        ${bodyHtml}
      </td></tr>
      <tr><td style="padding:18px 28px 26px;border-top:1px solid #eef0f3;">
        <p style="margin:0 0 6px;font:400 12px/1.6 Arial,Helvetica,sans-serif;color:#6b7280;">${esc(footerNote)}</p>
        <p style="margin:0;font:400 12px/1.6 Arial,Helvetica,sans-serif;color:#9aa1ad;">${BRAND} &middot; Gift card exchange &middot; This message was sent to you because of activity on your account.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

function paragraph(text: string) {
  return `<p style="margin:0 0 14px;font:400 15px/1.65 Arial,Helvetica,sans-serif;color:#33384a;">${esc(text)}</p>`;
}

function detailRows(rows: Array<[string, string]>) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 16px;border:1px solid #e3e6eb;border-radius:10px;">
    ${rows
      .map(
        ([k, v], i) =>
          `<tr><td style="padding:10px 14px;font:400 13px/1.5 Arial,Helvetica,sans-serif;color:#6b7280;${
            i ? "border-top:1px solid #eef0f3;" : ""
          }">${esc(k)}</td><td align="right" style="padding:10px 14px;font:700 13px/1.5 Arial,Helvetica,sans-serif;color:#0d1220;${
            i ? "border-top:1px solid #eef0f3;" : ""
          }">${esc(v)}</td></tr>`,
      )
      .join("")}
  </table>`;
}

/* ------------------------------------------------------------------ */
/* Templates                                                           */
/* ------------------------------------------------------------------ */

const PURPOSE_COPY: Record<string, { subject: string; heading: string; line: string }> = {
  signup: {
    subject: "Your ScousGiftCardExchange sign-up code",
    heading: "Confirm your email address",
    line: "Enter this code on the sign-up screen to finish creating your account.",
  },
  login: {
    subject: "Your ScousGiftCardExchange sign-in code",
    heading: "Confirm it is you",
    line: "Enter this code on the sign-in screen to continue to your account.",
  },
  reset: {
    subject: "Your ScousGiftCardExchange password reset code",
    heading: "Reset your password",
    line: "Enter this code to choose a new password.",
  },
  pin: {
    subject: "Your ScousGiftCardExchange withdrawal PIN code",
    heading: "Reset your withdrawal PIN",
    line: "Enter this code to set a new 4-digit withdrawal PIN.",
  },
};

export function otpEmail(code: string, purpose: string, minutes: number) {
  const copy = PURPOSE_COPY[purpose] ?? PURPOSE_COPY["login"]!;
  const bodyHtml = `
    ${paragraph(copy.line)}
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:6px 0 16px;">
      <tr><td align="center" style="background-color:#f7f8fa;border:1px solid #dfe3e9;border-radius:12px;padding:18px 12px;">
        <p style="margin:0;font:700 34px/1.2 'Courier New',Courier,monospace;letter-spacing:10px;color:#0d1220;">${esc(code)}</p>
      </td></tr>
    </table>
    ${paragraph(`The code stays valid for ${minutes} minutes and can be used once.`)}
    ${paragraph("If you did not request it, you can ignore this message and nothing will change.")}
  `;
  return {
    subject: copy.subject,
    html: shell({
      preheader: `${code} is your ${BRAND} code`,
      heading: copy.heading,
      bodyHtml,
      footerNote: "We will never ask you for this code by phone, chat or email reply.",
    }),
    text: `${copy.heading}\n\n${copy.line}\n\nCode: ${code}\n\nIt stays valid for ${minutes} minutes and can be used once. If you did not request it, ignore this message.\n\n${BRAND}`,
  };
}

export function welcomeEmail(name: string) {
  const who = name.trim() || "there";
  const bodyHtml = `
    ${paragraph(`Hello ${who}, your account is ready.`)}
    ${paragraph("Add your bank details, choose a card brand and see the Naira value before you submit anything.")}
    ${paragraph("Your card photos stay private to you and our review desk.")}
  `;
  return {
    subject: `Welcome to ${BRAND}`,
    html: shell({
      preheader: "Your account is ready to use.",
      heading: `Welcome to ${BRAND}`,
      bodyHtml,
      footerNote: "You are receiving this because an account was created with this email address.",
    }),
    text: `Hello ${who}, your ${BRAND} account is ready.\n\nAdd your bank details, choose a card brand and see the Naira value before you submit anything.\n\n${BRAND}`,
  };
}

export function tradeAlertEmail(input: {
  member: string;
  email: string;
  phone: string;
  brand: string;
  region: string;
  cardType: string;
  faceValue: string;
  payout: string;
  reference: string;
  images: number;
  link: string;
}) {
  const bodyHtml = `
    ${paragraph("A gift card was just submitted and is waiting for review.")}
    ${detailRows([
      ["Member", input.member],
      ["Email", input.email],
      ["Phone", input.phone],
      ["Card", `${input.brand} ${input.region} (${input.cardType})`],
      ["Face value", input.faceValue],
      ["Expected payout", input.payout],
      ["Proof images", String(input.images)],
      ["Reference", input.reference],
    ])}
    ${paragraph(`Open the trade: ${input.link}`)}
  `;
  return {
    subject: `New card submitted — ${input.brand} ${input.faceValue}`,
    html: shell({
      preheader: `${input.member} submitted ${input.brand} ${input.faceValue}`,
      heading: "New card awaiting review",
      bodyHtml,
      footerNote: "You are receiving this because this address is set as an alert address in the admin console.",
    }),
    text: `New card awaiting review\n\nMember: ${input.member} (${input.email}, ${input.phone})\nCard: ${input.brand} ${input.region} ${input.cardType}\nFace value: ${input.faceValue}\nExpected payout: ${input.payout}\nProof images: ${input.images}\nReference: ${input.reference}\n\n${input.link}`,
  };
}

export function withdrawalAlertEmail(input: {
  member: string;
  email: string;
  phone: string;
  amount: string;
  fee: string;
  net: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
  reference: string;
  link: string;
}) {
  const bodyHtml = `
    ${paragraph("A member requested a withdrawal. The balance has already been held.")}
    ${detailRows([
      ["Member", input.member],
      ["Email", input.email],
      ["Phone", input.phone],
      ["Amount", input.amount],
      ["Fee", input.fee],
      ["Send to bank", input.net],
      ["Bank", input.bankName],
      ["Account number", input.accountNumber],
      ["Account name", input.accountName],
      ["Reference", input.reference],
    ])}
    ${paragraph(`Open the withdrawal queue: ${input.link}`)}
  `;
  return {
    subject: `Withdrawal requested — ${input.net} to ${input.bankName}`,
    html: shell({
      preheader: `${input.member} requested ${input.amount}`,
      heading: "Withdrawal requested",
      bodyHtml,
      footerNote: "You are receiving this because this address is set as an alert address in the admin console.",
    }),
    text: `Withdrawal requested\n\nMember: ${input.member} (${input.email}, ${input.phone})\nAmount: ${input.amount}\nFee: ${input.fee}\nSend to bank: ${input.net}\nBank: ${input.bankName}\nAccount number: ${input.accountNumber}\nAccount name: ${input.accountName}\nReference: ${input.reference}\n\n${input.link}`,
  };
}

export function contactAlertEmail(input: { name: string; email: string; message: string }) {
  const bodyHtml = `
    ${paragraph("A visitor sent a message from the website.")}
    ${detailRows([
      ["Name", input.name],
      ["Email", input.email],
    ])}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px;border:1px solid #e3e6eb;border-radius:10px;">
      <tr><td style="padding:14px;font:400 14px/1.6 Arial,Helvetica,sans-serif;color:#33384a;white-space:pre-wrap;">${esc(input.message)}</td></tr>
    </table>
  `;
  return {
    subject: `Website message from ${input.name}`,
    html: shell({
      preheader: input.message.slice(0, 90),
      heading: "New website message",
      bodyHtml,
      footerNote: "You are receiving this because this address is set as an alert address in the admin console.",
    }),
    text: `New website message\n\nFrom: ${input.name} (${input.email})\n\n${input.message}`,
  };
}

export function testEmail() {
  return {
    subject: `${BRAND} mail settings test`,
    html: shell({
      preheader: "Your mail settings are working.",
      heading: "Mail settings test",
      bodyHtml: paragraph(
        "This is a test message from your admin console. If you can read it, sign-in codes and alerts will reach your members.",
      ),
      footerNote: "You are receiving this because you pressed Send test email in the admin console.",
    }),
    text: `Mail settings test\n\nThis is a test message from your admin console. If you can read it, sign-in codes and alerts will reach your members.\n\n${BRAND}`,
  };
}

/* Words commonly scored as spam; used by the admin mail screen checker. */
export const SPAM_WORDS = [
  "free",
  "winner",
  "urgent",
  "act now",
  "click here",
  "guaranteed",
  "risk free",
  "cash bonus",
  "limited time",
  "congratulations",
  "100%",
  "$$$",
];

export function spamScan(text: string) {
  const lower = text.toLowerCase();
  return SPAM_WORDS.filter((w) => lower.includes(w));
}
