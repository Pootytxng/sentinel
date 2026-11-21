// ONE way to write memory sizes, so two screens cannot show two numbers for the same RAM.
//
// view-1121b: a 2 x 16 GB PC read "33.7 GB" on the Something's-wrong card and "31.4 GB" on the Health
// check. Both were the same 33,7xx,xxx,xxx bytes (what Windows leaves usable): one screen divided by
// 1000^3, the other by 1024^3. Decided here, once:
//   - "GB" means what Windows means by it: 1 GB = 1024^3 bytes (Task Manager, Settings). Never 1000^3.
//   - INSTALLED memory is the sum of the memory modules (2 x 16 GB -> "32 GB"), a whole number.
//   - USABLE memory is what Windows reports (hardware.rs `ram_total_bytes`, 31.4 GB on that PC) and is
//     always written "31.4 GB usable", never as plain "31.4 GB".
// The Rust side (paramedic.rs `gb`) must divide by the same 1_073_741_824; see that file's one line.
import type { TFunction } from "i18next";

/** One Windows "GB". */
export const GIB = 1024 ** 3;

/** Bytes as a one-decimal number of GB ("31.4"), no unit. */
export const ramGB = (bytes: number): string => (bytes / GIB).toFixed(1);

/** The sum of the installed memory modules, in whole GB. Null when no module was listed OR when any
 *  one module's size was not read: a partial sum is not the installed total (one of two 16 GB sticks
 *  unread would print "16 GB" on a 32 GB PC), so callers show the usable figure, labelled "usable". */
export function installedRamGB(modules: ReadonlyArray<{ capacity_bytes: number }> | null | undefined): number | null {
  const list = modules ?? [];
  if (list.length === 0 || list.some((m) => !(m.capacity_bytes > 0))) return null;
  return Math.round(list.reduce((n, m) => n + m.capacity_bytes, 0) / GIB);
}

/** "31.4 GB usable". `t` is optional so a plain-data caller still gets the English words. */
export function usableRam(t: TFunction | undefined, bytes: number): string {
  return t ? t("common.ram.usable", { amount: ramGB(bytes) }) : `${ramGB(bytes)} GB usable`;
}

/** "31 GB usable" for the backend's whole-number `ram_gb`, which is Windows' usable total rounded
 *  (hardware.rs), never the installed sum: a stamp or baseline says so instead of printing a bare "31 GB". */
export function usableRamWhole(t: TFunction | undefined, gb: number): string {
  return t ? t("common.ram.usable", { amount: String(gb) }) : `${gb} GB usable`;
}

/** "19.6 / 31.4 GB usable": what is in use out of what is usable. */
export function usedOfUsableRam(t: TFunction | undefined, used: number, total: number): string {
  return t
    ? t("common.ram.usedOfUsable", { used: ramGB(used), total: ramGB(total) })
    : `${ramGB(used)} / ${ramGB(total)} GB usable`;
}
