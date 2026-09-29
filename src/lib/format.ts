export function naira(value: number | string | null | undefined, opts?: { decimals?: boolean }) {
  const n = Number(value ?? 0);
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: opts?.decimals ? 2 : 0,
    maximumFractionDigits: opts?.decimals ? 2 : 0,
  }).format(Number.isFinite(n) ? n : 0);
}

export function currencySymbol(code: string) {
  const map: Record<string, string> = {
    USD: "$",
    GBP: "£",
    EUR: "€",
    AUD: "A$",
    CAD: "C$",
    CHF: "CHF ",
    NZD: "NZ$",
    SGD: "S$",
    JPY: "¥",
    AED: "AED ",
  };
  return map[code] ?? "$";
}

export function shortDate(value: string | Date | null | undefined) {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleString("en-NG", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const TRADE_STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  successful: "Successful",
  partially_paid: "Partially paid",
  used: "Used",
  error: "Error",
};

export const WITHDRAWAL_STATUS_LABEL: Record<string, string> = {
  requested: "Requested",
  approved: "Approved",
  cancelled: "Cancelled",
  paid: "Paid",
};

export const WITHDRAWAL_FEE = 300;
