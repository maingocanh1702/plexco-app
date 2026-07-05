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

/** Build a VietQR image URL (img.vietqr.io dynamic QR). */
export function buildVietQrUrl(opts: VietQrOpts): string {
  const { bin, account, holder, amount, addInfo } = opts;
  const base = `https://img.vietqr.io/image/${bin}-${account}-compact2.png`;
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
