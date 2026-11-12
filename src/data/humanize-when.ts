// Humanized ledger timestamp (ledger §2): "3 days ago · 6:08 AM", never raw seconds.
//
// CR-hist-today (view-1112a/04-test-applied.png): rows from Nov 11 6:14 AM and 4:19 AM read
// "today" at 00:35 on Nov 12, because the bucket was elapsed time floored to 24 h. "Today" and
// "yesterday" are calendar days in the user's local time zone, so the bucket is the number of
// local midnights between the two moments. Days are counted on local calendar dates, so a 23 h or
// 25 h day (a DST change) is still one day. The date and time are formatted in the app's language,
// not the OS locale.
import type { TFunction } from "i18next";

/** Local calendar days from `then` to `now` (0 = same local date; negative = `then` is later). */
export function calendarDaysBetween(then: Date, now: Date): number {
  // Date.UTC on the LOCAL y/m/d components: whole days with no DST hour in between.
  const a = Date.UTC(then.getFullYear(), then.getMonth(), then.getDate());
  const b = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((b - a) / 86400000);
}

export function humanizeWhen(iso: string, t: TFunction, lang: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return t("optimize.fix.humanizeRecently");
  const time = d.toLocaleTimeString(lang, { hour: "numeric", minute: "2-digit" });
  const days = calendarDaysBetween(d, now);
  // A stamp later than now (a clock set back) keeps the old reading: today, never "-1 days ago".
  if (days <= 0) return t("optimize.fix.humanizeToday", { time });
  if (days === 1) return t("optimize.fix.humanizeYesterday", { time });
  if (days < 7) return t("optimize.fix.humanizeDaysAgo", { days, time });
  return t("optimize.fix.humanizeDateTime", {
    date: d.toLocaleDateString(lang, { month: "short", day: "numeric" }),
    time,
  });
}
