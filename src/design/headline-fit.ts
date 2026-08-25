/* #213 B3, the real mechanism — the hero headline outgrows its own column.
 *
 * B3 was filed as "the Health headline is set too large for its column". A previous session
 * rebutted it by measuring the approved comp's headline at ~16ch and concluding the shipped
 * `max-width: 20ch` was already wider, so the wrap had to be copy length — and attributed it to
 * `revertedTitle_one`. Both halves were wrong. `revertedTitle_one` renders at `--type-body` in a
 * spotlight row, not in a headline at all, and `max-width: 20ch` never binds: at 52px it computes
 * to 716px against a 452px narrative column, so the COLUMN is the constraint and the cap is inert.
 *
 * WHAT ACTUALLY HAPPENS, measured over CDP on the owner's own installed build (452px column,
 * `--type-hero` 52px/650, line-height 57.2px), counting real line boxes with a Range:
 *
 *     len   52px  40px  26px   text
 *      20     2     1     1    You're ready to play          <- the comp's own state
 *      31     2     2     1    Drive reporting a SMART warning
 *      34     3     2     2    Compy changes were turned back off      <- HIS LIVE SCREEN
 *      37     3     2     2    Power plan isn't performance-oriented
 *      43     3     2     2    Memory running single-channel · and 3 more
 *      44     3     3     2    Drive reporting a SMART warning · and 3 more
 *      50     4     3     3    Power plan isn't performance-oriented · and 3 more
 *
 * The approved comp draws TWO lines (line 1 is 366px for the 15 characters of "You're ready to").
 * Three and four are the deviation, and the owner's machine is sitting in a three-line state right
 * now: 172px of headline where the picture has 114px.
 *
 * THE RULE. `--type-hero` is comp-derived (type-scale.css, measured 2026-08-23) and is NOT changed
 * here. What changes is which step a LONG headline uses: at or under the measured break the hero
 * step still draws two lines, so it keeps it; past the break it steps down one to
 * `--type-verdict`, which restores two lines for everything up to 43 characters. Nothing gets
 * worse — the three longest multi-flag headlines go from 3–4 lines to 3.
 *
 * WHY NOT FIX THE COPY. The remaining 3-liners are all the "· and N more" suffix, which adds 13
 * characters to a headline that already fits. Moving that suffix to the dek would fix them
 * outright, but it is verdict copy in two locales and it is the owner's own name-it-and-fix-it
 * -inline law speaking, so it is filed with its numbers rather than rewritten at will.
 */

/** The measured break: at `--type-hero` every headline this long or shorter draws two lines. */
export const HERO_MAX_WEIGHT = 31;

/* CJK glyphs are full-width, so a raw `.length` would leave a Simplified Chinese headline at hero
 * long after it had outgrown the column. 2.2 latin units per glyph is an ESTIMATE, not a
 * measurement -- unlike the latin table above, no CJK string was rendered and counted. It is
 * defensive rather than load-bearing: today's zh-CN posture headlines are 6-9 glyphs
 * ("你可以开玩了", "数据还不足以判断", "正在扫描你的系统…"), so they weigh 13-20 and this rule never
 * fires for them. If a longer one is ever written, measure it the way the latin table was measured
 * instead of trusting this constant. */
const WIDE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x11ff], // Hangul Jamo
  [0x2e80, 0x303e], // CJK radicals, Kangxi, CJK symbols & punctuation
  [0x3041, 0x33ff], // kana through CJK compatibility
  [0x3400, 0x4dbf], // CJK Unified Ext A
  [0x4e00, 0x9fff], // CJK Unified
  [0xa000, 0xa4cf], // Yi
  [0xac00, 0xd7a3], // Hangul syllables
  [0xf900, 0xfaff], // CJK compatibility ideographs
  [0xfe30, 0xfe6f], // CJK compatibility forms
  [0xff00, 0xff60], // fullwidth forms
  [0xffe0, 0xffe6], // fullwidth signs
];

const isWide = (ch: string): boolean => {
  const c = ch.codePointAt(0) ?? 0;
  return WIDE_RANGES.some(([lo, hi]) => c >= lo && c <= hi);
};

/** Approximate width of `text` in latin-character units. */
export function headlineWeight(text: string): number {
  let w = 0;
  for (const ch of text) w += isWide(ch) ? 2.2 : 1;
  return w;
}

/**
 * Which type step the verdict headline should use.
 * `"hero"` — the comp's state, two lines at `--type-hero`.
 * `"tight"` — one step down to `--type-verdict`, which buys those headlines their second line back.
 */
export function headlineFit(text: string | null | undefined): "hero" | "tight" {
  if (!text) return "hero";
  return headlineWeight(text) > HERO_MAX_WEIGHT ? "tight" : "hero";
}
