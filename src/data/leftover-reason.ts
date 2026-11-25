// a10 r1 (F1): the one leftover "unchecked" reason that carries a number. The core-parking detector
// read the setting, but with no second support (the plan's own default reading below 100) Compy can't
// tell a tweak from Windows' per-processor choice, so it names the setting with this sentence instead
// of calling it a finding or "clean". Rust fills `{pct}` (src-tauri/src/leftovers.rs
// REASON_PER_CPU_DEFAULT); `leftover-reason.test.ts` pins this copy byte-equal to that const, so a
// reworded Rust sentence fails the gate instead of showing English on a zh-CN screen.
//
// The sibling reasons ("couldn't read this setting", "needs admin to check") are shown as the backend
// sends them; this one is matched here and shown through `optimize.check.perCpuDefault` (en + zh-CN).

/** Byte-equal to leftovers.rs `REASON_PER_CPU_DEFAULT`. */
export const PER_CPU_DEFAULT_REASON =
  "Compy can read this setting ({pct}% of cores always kept awake), but Windows chooses this value per processor, so Compy can't tell whether a tweak changed it.";

/** The percentage when `reason` is that sentence with a whole number of 1-3 digits in it, else null. */
export function perCpuDefaultPct(reason: string): string | null {
  const [pre, post] = PER_CPU_DEFAULT_REASON.split("{pct}");
  if (reason.length <= pre.length + post.length || !reason.startsWith(pre) || !reason.endsWith(post)) return null;
  const pct = reason.slice(pre.length, reason.length - post.length);
  return /^\d{1,3}$/.test(pct) ? pct : null;
}
