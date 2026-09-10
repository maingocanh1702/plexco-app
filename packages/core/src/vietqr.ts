/**
 * VietQR dynamic-QR URL builder. Pure — no network call, URL only.
 * Lifted from the production single-club bot (src/vietqr.ts).
 */
export interface VietQrOpts {
  bin: string;
  account: string;
  holder: string;
  amount?: number;
  addInfo?: string;
}

/** VietQR/NAPAS bank BIN: exactly 6 digits. */
export const VIETQR_BIN_RE = /^[0-9]{6}$/;
/** Bank account number as VietQR accepts it in the path: 1–19 alphanumerics, no separators. */
export const VIETQR_ACCOUNT_RE = /^[A-Za-z0-9]{1,19}$/;
/** Upper bound on a QR amount — same ceiling as parseMoney (dates.ts MAX_MONEY_AMOUNT). */
export const VIETQR_MAX_AMOUNT = 1_000_000_000_000;

export class VietQrInputError extends Error {
  constructor(public readonly field: "bin" | "account" | "amount") {
    super(`buildVietQrUrl: invalid ${field}`);
    this.name = "VietQrInputError";
  }
}

/**
 * Build a VietQR image URL (img.vietqr.io dynamic QR).
 *
 * Audit 2026-09-06 C-2: `bin` and `account` were interpolated into the URL PATH unencoded and
 * `amount` was unvalidated — a bank account string from tenant config could carry `/`, `?`, `#`
 * or `..` and rewrite the request, and a NaN/negative/huge amount produced a QR nobody could
 * pay. Both path segments are now validated against the provider's own vocabulary (which is
 * strictly narrower than any encoding), and the amount must be a non-negative safe integer
 * within the shared money ceiling. Invalid input throws VietQrInputError rather than returning
 * a URL that looks right — a QR for the wrong account is a money bug, not a formatting bug.
 */
export function buildVietQrUrl(opts: VietQrOpts): string {
  const { bin, account, holder, amount, addInfo } = opts;
  if (!VIETQR_BIN_RE.test(bin)) throw new VietQrInputError("bin");
  if (!VIETQR_ACCOUNT_RE.test(account)) throw new VietQrInputError("account");
  if (
    amount !== undefined &&
    !(Number.isSafeInteger(amount) && amount >= 0 && amount <= VIETQR_MAX_AMOUNT)
  ) {
    throw new VietQrInputError("amount");
  }
  const base = `https://img.vietqr.io/image/${encodeURIComponent(bin)}-${encodeURIComponent(account)}-compact2.png`;
  const params = new URLSearchParams();
  if (amount !== undefined) params.set("amount", String(amount));
  if (addInfo) params.set("addInfo", addInfo);
  params.set("accountName", holder);
  return `${base}?${params.toString()}`;
}

/** True when bank bin + account are both present — required for dynamic QR. */
export function canBuildDynamicVietQr(cfg: {
  bankBin?: string | null;
  bankAccount?: string | null;
}): boolean {
  return Boolean(cfg.bankBin && cfg.bankAccount);
}
