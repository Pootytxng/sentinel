// Last-check snapshot — the honest record behind Home's "Re-run check" band (RerunCheckBand).
//
// Honesty law (RECEIPTS DOCTRINE): the band may only show an AGE + count summary when a REAL check
// actually completed. So we persist the timestamp TOGETHER with the count summary at first-check
// completion — the band renders a self-consistent "as of your last check" record, never a live
// count paired with an implied/stale time. No snapshot yet → the band shows live counts with NO age.

export const LAST_CHECK_KEY = "compy_last_check_v1";

export type LastCheck = {
  at: number; // epoch ms when the check completed
  total: number; // checks measured
  green: number; // checks that came back clean
  fixCount: number; // limiters worth fixing
};

export function recordLastCheck(v: Omit<LastCheck, "at">): void {
  try {
    const rec: LastCheck = { ...v, at: Date.now() };
    localStorage.setItem(LAST_CHECK_KEY, JSON.stringify(rec));
  } catch {
    /* non-fatal — the band falls back to live counts */
  }
}

export function readLastCheck(): LastCheck | null {
  try {
    const raw = localStorage.getItem(LAST_CHECK_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<LastCheck>;
    if (
      typeof p.at === "number" &&
      typeof p.total === "number" &&
      typeof p.green === "number" &&
      typeof p.fixCount === "number"
    ) {
      return { at: p.at, total: p.total, green: p.green, fixCount: p.fixCount };
    }
  } catch {
    /* corrupt / unavailable → fallback */
  }
  return null;
}

// Pure + testable. Coarse, human ages — never implies more precision than a "last check" deserves.
export function formatCheckAge(at: number, now: number): string {
  const ms = now - at;
  if (ms < 60000) return "just now";
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "yesterday";
  if (day < 7) return `${day}d ago`;
  const wk = Math.floor(day / 7);
  return `${wk}w ago`;
}
