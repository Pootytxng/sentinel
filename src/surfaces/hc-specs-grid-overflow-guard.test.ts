import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

// Bug → guard (#614, found by the self-reviewer during the #599 review, 2026-09-28). Health's
// Detected tile is the bento hero, 7 of 12 columns. Its spec cards (Graphics, Processor, Memory,
// Storage) sat in `repeat(auto-fit, minmax(230px, 1fr))`. auto-fit can drop to one column, but no
// further: the last track still demands 230px. Below a ~700px window the hero's content box is
// narrower than that, so the cards spilled out of the tile and ran under Findings. The window's
// minWidth is 380, so a user can reach it.
//
// The fix is the breakpoint-free clamp `minmax(min(230px, 100%), 1fr)`. It is identical wherever
// the container is at least 230px, and caps the track at the container below that. This file bans
// `@media`, so there is no breakpoint to add instead.
//
// jsdom does no layout, so this guard resolves each track minimum for real container widths. That
// catches the defect itself, not one spelling of it. It reads EVERY declaration that can set a
// guarded property, in every sheet under src/, not the first rule it finds: a later override wins
// the cascade, so one safe rule proves nothing (Codex review of PR 624, round 1).

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "");

type Decl = { file: string; selector: string; prop: string; value: string };

/** Split `s` on `sep` wherever it sits outside (), [] and quotes. */
function splitTop(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = "";
  let cur = "";
  for (const c of s) {
    if (quote) {
      if (c === quote) quote = "";
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (c === sep && depth === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

/** A nested rule's full selector: `&` stands for the parent, and a bare selector is its descendant. */
function nest(parent: string | null, sel: string): string {
  if (!parent) return sel;
  return splitTop(parent, ",")
    .flatMap((p) => splitTop(sel, ",").map((s) => (s.includes("&") ? s.split("&").join(p.trim()) : `${p.trim()} ${s.trim()}`)))
    .join(", ");
}

/** Every declaration in one sheet, with the full selector of the style rule it sits in. At-rule
 *  blocks are descended, and nested rules are read (App.css nests under `:root[data-motion]`). */
function declarations(file: string, text: string): Decl[] {
  const out: Decl[] = [];
  const stack: (string | null)[] = []; // the style selector in force at each depth; null = none
  let buf = "";
  let parens = 0;
  let quote = "";
  const emit = () => {
    const selector = stack[stack.length - 1];
    const colon = buf.indexOf(":");
    if (selector && colon > 0) {
      const value = buf.slice(colon + 1).replace(/!important/i, "").trim();
      out.push({ file, selector, prop: buf.slice(0, colon).trim().toLowerCase(), value });
    }
    buf = "";
  };
  for (const c of text) {
    if (quote) {
      if (c === quote) quote = "";
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "(") parens++;
    else if (c === ")") parens--;
    else if (parens === 0 && c === "{") {
      const prelude = buf.trim();
      const parent = stack[stack.length - 1] ?? null;
      stack.push(prelude.startsWith("@") ? parent : nest(parent, prelude));
      buf = "";
      continue;
    } else if (parens === 0 && (c === ";" || c === "}")) {
      emit();
      if (c === "}") stack.pop();
      continue;
    }
    buf += c;
  }
  return out;
}

/** Whether any selector in the list puts `.cls` on its subject, its last compound. */
function targets(selectorList: string, cls: string): boolean {
  const own = new RegExp(`\\.${cls}(?![\\w-])`);
  return splitTop(selectorList, ",").some((sel) => {
    let subject = sel.trim();
    for (const comb of [" ", ">", "+", "~"]) subject = splitTop(subject, comb).pop()!.trim() || subject;
    // `.x:not(.cls)` does not target .cls.
    let bare = subject;
    for (let prev = ""; prev !== bare; ) [prev, bare] = [bare, bare.replace(/\([^()]*\)/g, "")];
    return own.test(bare);
  });
}

const SHEET = join("src", "surfaces", "home-console.css");
const ALL: Decl[] = (readdirSync("src", { recursive: true }) as string[])
  .filter((f) => f.endsWith(".css"))
  .flatMap((f) => declarations(join("src", f), stripComments(readFileSync(join("src", f), "utf8"))));

/** Every declaration of `props`, in every sheet, on a rule whose subject is `.cls`. */
const on = (cls: string, props: string[]) => ALL.filter((d) => props.includes(d.prop) && targets(d.selector, cls));
const V2 = '[data-v2="on"]';

/** Every `repeat(auto-fit|auto-fill, minmax(<min>, <max>))` in a value: its minimum, and its end. */
function autoRepeats(value: string): { min: string; start: number; end: number }[] {
  const out: { min: string; start: number; end: number }[] = [];
  for (const m of value.matchAll(/repeat\(\s*auto-(?:fit|fill)\s*,\s*minmax\(/g)) {
    // Walk minmax's first argument to its comma, then on to the `)` that closes repeat.
    let i = m.index! + m[0].length;
    let depth = 0;
    let min = "";
    for (; i < value.length; i++) {
      const c = value[i];
      if (c === "(") depth++;
      else if (c === ")") depth--;
      else if (c === "," && depth === 0) break;
      min += c;
    }
    for (depth = 2; i < value.length && depth > 0; i++) {
      if (value[i] === "(") depth++;
      else if (value[i] === ")") depth--;
    }
    out.push({ min: min.trim(), start: m.index!, end: i });
  }
  return out;
}

/** The px a track minimum resolves to inside a container `w` px wide. Unknown forms throw. */
function resolveMin(min: string, w: number): number {
  const px = min.match(/^(\d+(?:\.\d+)?)px$/);
  if (px) return Number(px[1]);
  const clamp = min.match(/^min\(\s*([^,]+?)\s*,\s*([^,]+?)\s*\)$/);
  if (clamp) return Math.min(resolveMin(clamp[1], w), resolveMin(clamp[2], w));
  const pct = min.match(/^(\d+(?:\.\d+)?)%$/);
  if (pct) return (Number(pct[1]) / 100) * w;
  throw new Error(`unrecognised track minimum "${min}" — teach resolveMin its form`);
}

// Content-box widths the hero tile really takes, from the 380px minWidth up past the point where
// the clamp stops mattering. 1280x720 and wider sit far above the top of this range.
const WIDTHS = Array.from({ length: 70 }, (_, k) => 100 + k * 10);
const GRID_PROPS = ["grid-template-columns", "grid-template", "grid"];
const where = (d: Decl) => `${d.file} "${d.selector}" { ${d.prop}: ${d.value} }`;

describe("Health's Detected tile — spec cards never overflow their tile (#614)", () => {
  it("every track list on .hc-specs-grid, in every sheet, is one auto-fit clamp that fits its container", () => {
    const decls = on("hc-specs-grid", GRID_PROPS);
    expect(decls.some((d) => d.selector.includes(V2) && d.prop === "grid-template-columns")).toBe(true);
    for (const d of decls) {
      // A shorthand or a fixed track list would override the clamp without this guard seeing it.
      expect(d.prop, `${where(d)}: set the spec grid's tracks with grid-template-columns`).toBe(
        "grid-template-columns",
      );
      const reps = autoRepeats(d.value);
      const whole = reps.length === 1 && reps[0].start === 0 && reps[0].end === d.value.length;
      expect(whole, `${where(d)}: must be exactly one repeat(auto-fit, minmax(...))`).toBe(true);
      for (const w of WIDTHS) {
        expect(resolveMin(reps[0].min, w), `${where(d)}: wider than a ${w}px container`).toBeLessThanOrEqual(w);
      }
      // The clamp changes nothing where the tile is wide: the cards still ask for 230px there.
      for (const w of [230, 400, 700]) expect(resolveMin(reps[0].min, w), where(d)).toBe(230);
    }
  });

  it("no auto-fit/auto-fill track in home-console.css asks for more width than its container has", () => {
    const tracks = ALL.filter((d) => d.file === SHEET && GRID_PROPS.includes(d.prop)).flatMap((d) =>
      autoRepeats(d.value).map((r) => ({ d, min: r.min })),
    );
    expect(tracks.length).toBeGreaterThan(0);
    for (const { d, min } of tracks) {
      for (const w of WIDTHS) {
        expect(resolveMin(min, w), `${where(d)}: track minimum "${min}" is wider than a ${w}px container`).toBeLessThanOrEqual(w);
      }
    }
  });

  // A card clamped to a 62px tile is only half the fix. Its title, keys and values must also yield
  // inside it, or they cross the card's frame and the defect moves one box inward. Measured on the
  // unfixed build at 504px: "PROCESSOR" alone is wider than the card's content box. Each property
  // must be set under v2 scope, and every declaration of it anywhere must agree, because a later one
  // wins.
  const pinned = (cls: string, props: string[], ok: (v: string) => boolean, why: string) => {
    const decls = on(cls, props);
    expect(decls.some((d) => d.selector.includes(V2)), `.${cls} needs its ${props[0]} under ${V2}`).toBe(true);
    for (const d of decls) expect(ok(d.value), `${where(d)}: ${why}`).toBe(true);
  };

  it("a spec card's own contents yield before they cross its frame", () => {
    const anywhere = (v: string) => v === "anywhere";
    pinned("hc-spec-title", ["overflow-wrap", "word-wrap"], anywhere, "a card title must break inside a narrow card");
    pinned("hc-spec-k", ["overflow-wrap", "word-wrap"], anywhere, "a key must break inside a narrow card");
    pinned("hc-spec-v", ["overflow-wrap", "word-wrap"], anywhere, "a value must break inside a narrow card");
    pinned("hc-spec-row", ["flex-wrap", "flex-flow"], (v) => /(^|\s)wrap(\s|$)/.test(v), "a row must wrap its value under its key");
    pinned("hc-spec-k", ["max-width"], (v) => /^(\d+(\.\d+)?)%$/.test(v) && parseFloat(v) <= 100, "a key must never outgrow its row");
    pinned("hc-spec-v", ["min-width"], (v) => /^0(px)?$/.test(v), "a value must be able to shrink");

    // Wrapping is inherited, so a `nowrap` anywhere in the card defeats every rule above.
    for (const cls of ["hc-specs", "hc-specs-grid", "hc-spec", "hc-spec-title", "hc-spec-rows", "hc-spec-row", "hc-spec-k", "hc-spec-v"]) {
      for (const d of on(cls, ["white-space", "text-wrap", "text-wrap-mode"])) {
        expect(/(^|\s)(nowrap|pre)(\s|$)/.test(d.value), `${where(d)}: this stops a spec card's text from wrapping`).toBe(false);
      }
    }
  });

  // The wrap above must not change the approved wide layout (#225): at 1280 and 1500 every key and
  // value still share one line. So the three numbers that decide when a row wraps are pinned, in both
  // directions. The value's basis must stay 6ch. A 0 basis never wraps, and a narrow card crushes the
  // value into a letter-per-line column beside its key. A wide basis (auto, 100%) drops values under
  // their keys even in the wide tracks. The key stays unflexed, and the gap between them stays the
  // 12px the wide layout was approved with.
  it("the rules that decide when a row wraps keep the wide layout unchanged", () => {
    pinned("hc-spec-v", ["flex"], (v) => /^1\s+1\s+6ch$/.test(v), "the value's flex must stay `1 1 6ch`");
    expect(on("hc-spec-v", ["flex-grow", "flex-shrink", "flex-basis"]).map(where)).toEqual([]);
    pinned("hc-spec-k", ["flex"], (v) => v === "none", "the key must stay unflexed");
    expect(on("hc-spec-k", ["flex-grow", "flex-shrink", "flex-basis"]).map(where)).toEqual([]);
    pinned(
      "hc-spec-row",
      ["gap", "grid-gap", "column-gap", "grid-column-gap"],
      (v) => (v.trim().split(/\s+/).pop() ?? "") === "12px",
      "the key–value gap must stay 12px",
    );
  });

  // An inline style beats every sheet, so the component must not set one on a spec card.
  it("SpecBox sets no inline style that could override these rules", () => {
    const tsx = readFileSync(join("src", "surfaces", "HomeConsole.tsx"), "utf8");
    const start = tsx.indexOf("function SpecBox(");
    expect(start).toBeGreaterThan(-1);
    const body = tsx.slice(start, tsx.indexOf("\n}\n", start));
    expect(body).toContain('className="hc-spec-v');
    expect(body).not.toMatch(/\bstyle=/);
  });
});
