// Shared locale-overlay helper (i18n, 2026-07-23). Lives in its own module — not in knowledge.ts —
// so both knowledge.ts and tuning-guides.ts can import it without a runtime circular dependency
// (knowledge.ts already pulls TUNING_GUIDE_ENTRIES from tuning-guides.ts to build KNOWLEDGE).

/**
 * Deep-merge a zh-CN override onto its English base: arrays merge by index (every shipped locale
 * file has matching array lengths at every nesting level — see the i18n handoff audit), plain
 * objects merge key-by-key, and a string/number/boolean in `zh` always wins. A key `zh` doesn't
 * mention (aliases, related, verdict, tier, x/y hotspot coordinates, ...) keeps its English value
 * untouched, since the locale JSON siblings intentionally carry translated text fields only.
 */
export function deepMergeLocale<T>(en: T, zh: unknown): T {
  if (Array.isArray(en) && Array.isArray(zh)) {
    return en.map((item, i) => (i < zh.length ? deepMergeLocale(item, zh[i]) : item)) as unknown as T;
  }
  if (en !== null && zh !== null && typeof en === "object" && typeof zh === "object" && !Array.isArray(en)) {
    const out: Record<string, unknown> = { ...(en as Record<string, unknown>) };
    for (const key of Object.keys(zh as Record<string, unknown>)) {
      out[key] = deepMergeLocale((en as Record<string, unknown>)[key], (zh as Record<string, unknown>)[key]);
    }
    return out as T;
  }
  return zh !== undefined && zh !== null ? (zh as T) : en;
}
