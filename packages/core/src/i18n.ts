/**
 * Đa ngôn ngữ tối giản (HR5): vi (mặc định) / en.
 *
 * Dùng helper `t(vi, en)` ngay tại chỗ ghi chuỗi — không cần quản lý key:
 *   reply(t("Không tìm thấy buổi chơi.", "Session not found."));
 *
 * Ngôn ngữ per-request đọc từ AsyncLocalStorage; moduleFallback (setLang/getLang)
 * chỉ dùng cho boot default và ngoài request context. Persistence per-tenant
 * (bảng settings) do caller lo — i18n KHÔNG import db (giữ core thuần).
 *
 * Lifted from the production single-club bot (src/i18n.ts); "club default" is
 * generalized to the per-tenant default resolved by the caller.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export type Lang = "vi" | "en";

const als = new AsyncLocalStorage<Lang>();
let moduleFallback: Lang = "vi";

export function getLang(): Lang {
  return als.getStore() ?? moduleFallback;
}

/** Returns the process-default language directly — never reads ALS.
 *  Use where tenant-broadcast paths must ignore any per-user ALS context. */
export function getDefaultLang(): Lang {
  return moduleFallback;
}

export function setLang(lang: Lang): void {
  moduleFallback = lang;
}

/** Chuẩn hoá input ("EN", " vi ") -> Lang hợp lệ, hoặc null nếu không phải vi/en. */
export function parseLang(raw: string): Lang | null {
  const v = raw.trim().toLowerCase();
  return v === "vi" || v === "en" ? v : null;
}

/** Chọn chuỗi theo ngôn ngữ của request hiện tại (ALS) hoặc module fallback. */
export function t(vi: string, en: string): string {
  return getLang() === "en" ? en : vi;
}

/**
 * Bọc fn trong context ngôn ngữ lang. Mọi lời gọi t() bên trong fn
 * (kể cả qua await) sẽ đọc lang này — không rò sang request khác.
 */
export function runWithLang<T>(lang: Lang, fn: () => T): T {
  return als.run(lang, fn);
}

/**
 * Chọn ngôn ngữ cho một người dùng: locale cá nhân nếu đã chọn,
 * ngược lại dùng default của tenant. Hàm thuần — không import db.
 */
export function resolveLang(memberLocale: Lang | null, tenantDefault: Lang): Lang {
  return memberLocale ?? tenantDefault;
}
