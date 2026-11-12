import { describe, it, expect } from "vitest";
import i18n from "../i18n";
import { calendarDaysBetween, humanizeWhen } from "./humanize-when";

// CR-hist-today (view-1112a/04-test-applied.png): History rows from Nov 11 6:14 AM and 4:19 AM read
// "today" at 00:35 on Nov 12. The bucket was elapsed time floored to 24 h; it is now the local
// calendar day. Local constructors, so these hold in any time zone the suite runs in.
const en = i18n.getFixedT("en");
const zh = i18n.getFixedT("zh-CN");
const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min);

describe("humanizeWhen buckets by the local calendar day", () => {
  const now = at(2026, 11, 12, 0, 35);

  it("a row from the previous evening or early morning is yesterday just after midnight", () => {
    expect(humanizeWhen(at(2026, 11, 11, 6, 14).toISOString(), en, "en", now)).toMatch(/^yesterday · /);
    expect(humanizeWhen(at(2026, 11, 11, 4, 19).toISOString(), en, "en", now)).toMatch(/^yesterday · /);
    expect(humanizeWhen(at(2026, 11, 11, 23, 59).toISOString(), en, "en", now)).toMatch(/^yesterday · /);
  });

  it("a row from after midnight is today; the day before yesterday is 2 days ago", () => {
    expect(humanizeWhen(at(2026, 11, 12, 0, 1).toISOString(), en, "en", now)).toMatch(/^today · /);
    expect(humanizeWhen(at(2026, 11, 10, 23, 0).toISOString(), en, "en", now)).toMatch(/^2 days ago · /);
    // Late evening read of a same-day morning row: still today, though under 24 h either way.
    expect(humanizeWhen(at(2026, 11, 12, 0, 0).toISOString(), en, "en", at(2026, 11, 12, 23, 59))).toMatch(/^today · /);
  });

  it("a week or more shows the date in the app's language", () => {
    const row = at(2026, 11, 3, 9, 8).toISOString();
    expect(humanizeWhen(row, en, "en", now)).toMatch(/^Nov 3 · /);
    expect(humanizeWhen(row, zh, "zh-CN", now)).toContain("11月3日");
    // The time follows the app's language too, not the OS locale.
    // (zh-CN's own clock reads "9:08"; an en-US OS locale would have printed "9:08 AM" here.)
    expect(humanizeWhen(row, zh, "zh-CN", now)).toBe("11月3日 · 9:08");
    expect(humanizeWhen(row, en, "en", now)).toBe("Nov 3 · 9:08 AM");
  });

  it("zh-CN buckets the same way", () => {
    expect(humanizeWhen(at(2026, 11, 11, 6, 14).toISOString(), zh, "zh-CN", now)).toBe(
      zh("optimize.fix.humanizeYesterday", { time: at(2026, 11, 11, 6, 14).toLocaleTimeString("zh-CN", { hour: "numeric", minute: "2-digit" }) }),
    );
  });

  it("a stamp later than now reads today, never a negative day count; garbage reads recently", () => {
    expect(humanizeWhen(at(2026, 11, 13, 9, 0).toISOString(), en, "en", now)).toMatch(/^today · /);
    expect(humanizeWhen("not a date", en, "en", now)).toBe("recently");
  });
});

describe("calendarDaysBetween counts local dates, so a DST day is still one day", () => {
  // Stand-ins whose local date fields say consecutive days while their epochs are 23 h / 25 h
  // apart (the spring-forward / fall-back days): only the local date may decide the count.
  const local = (y: number, m: number, d: number, epoch: number) =>
    ({ getFullYear: () => y, getMonth: () => m - 1, getDate: () => d, getTime: () => epoch }) as unknown as Date;
  const H = 3600000;

  it("23 h and 25 h days count as one day", () => {
    expect(calendarDaysBetween(local(2026, 3, 8, 0), local(2026, 3, 9, 23 * H))).toBe(1);
    expect(calendarDaysBetween(local(2026, 11, 1, 0), local(2026, 11, 2, 25 * H))).toBe(1);
  });

  it("across a month and a year boundary", () => {
    expect(calendarDaysBetween(at(2026, 10, 31, 23), at(2026, 11, 1, 1))).toBe(1);
    expect(calendarDaysBetween(at(2026, 12, 31, 22), at(2027, 1, 1, 0, 5))).toBe(1);
    expect(calendarDaysBetween(at(2026, 11, 12, 1), at(2026, 11, 12, 23))).toBe(0);
  });

  it("a real DST week in this time zone still counts whole days", () => {
    // Whatever zone the suite runs in, noon-to-noon across both 2026 US and EU change dates is 7.
    for (const [m, d] of [[3, 5], [3, 26], [10, 22], [10, 29]] as const) {
      expect(calendarDaysBetween(at(2026, m, d, 0, 30), at(2026, m, d + 7, 23, 30))).toBe(7);
    }
  });
});
