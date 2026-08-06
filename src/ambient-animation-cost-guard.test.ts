import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
// (fs/path typed by src/test-node-shims.d.ts — CSS-text invariants, same disk-read pattern as
//  overlay-ambient-guard.)

// ── Why this guard exists ────────────────────────────────────────────────────────────────
// bug → guard, owner defect: Compy burned ~50% of one CPU core sitting idle with nothing on
// screen and nobody at the keyboard. The subtraction waterfall in scripts/q7-probe.mjs
// (evidence: docs/perf/raw/idle-attribution.json) attributed 42.1 of those 51.7 points — 81%
// of the whole idle cost — to exactly TWO always-on decorative CSS animations:
//
//   aurora        body::before, 20s infinite   scale()s a filter: blur(26px) full-viewport
//                                              layer. Scaling invalidates the rasterized
//                                              texture, so every frame re-rasters a blurred
//                                              surface the size of the window.
//   v2-foil-pan   .v2-verdict h1, 14s infinite animates background-position under
//                                              background-clip: text — not a compositable
//                                              property, so every frame is a style recalc
//                                              plus a glyph re-rasterization.
//
// Neither was doing anything a user could see change; both ran forever on every screen. The
// mechanism is what matters and what recurs: an always-on animation is only free when the
// compositor can run it WITHOUT the main thread and WITHOUT re-rastering. These guards pin
// that property, because "remember not to animate paint properties on ambient layers" is
// prose, and prose does not fail a build.
//
// Scope is deliberately narrow — ALWAYS-ON ambient surfaces, not every animation in the app.
// A spinner that repaints while a scan runs costs something too, but it is bounded by the
// scan; these two were unbounded and unconditional.

const CSS_ROOT = "src";

const cssFiles = (): string[] =>
  (readdirSync(CSS_ROOT, { recursive: true }) as string[]).filter((f) => f.endsWith(".css"));

// Comment bodies name selectors and properties (that is how these files document themselves),
// so blank them before parsing — newlines preserved so offender line numbers stay true.
const readCssStripped = (rel: string): string =>
  readFileSync(join(CSS_ROOT, rel), "utf8").replace(/\/\*[\s\S]*?\*\//g, (m) =>
    m.replace(/[^\n]/g, " "),
  );

type Rule = { file: string; line: number; prelude: string; body: string; nested: boolean };

// Brace walker. Returns every block at every depth; `nested` marks blocks that themselves
// contain blocks (@media, @supports, @keyframes), so declaration checks can skip them and
// look only at leaf rules.
const parseRules = (file: string, css: string): Rule[] => {
  const out: Rule[] = [];
  const stack: { prelude: string; line: number; start: number }[] = [];
  let buf = "";
  let preludeLine = 1;
  let line = 1;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === "{") {
      stack.push({ prelude: buf.trim(), line: preludeLine, start: i + 1 });
      buf = "";
      preludeLine = line;
    } else if (ch === "}") {
      const top = stack.pop();
      if (top) {
        const body = css.slice(top.start, i);
        out.push({ file, line: top.line, prelude: top.prelude, body, nested: body.includes("{") });
      }
      buf = "";
      preludeLine = line;
    } else {
      if (!buf.trim() && ch.trim()) preludeLine = line;
      buf += ch;
    }
    if (ch === "\n") line++;
  }
  return out;
};

// Property names declared anywhere in a chunk of CSS text (keyframe stops included).
const declaredProps = (text: string): string[] =>
  text
    .split(/[;{}]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const c = s.indexOf(":");
      return c < 0 ? "" : s.slice(0, c).trim().toLowerCase();
    })
    .filter((p) => /^-?[a-z][a-z0-9-]*$/.test(p));

const declValue = (body: string, prop: string): string | null => {
  for (const chunk of body.split(";")) {
    const c = chunk.indexOf(":");
    if (c < 0) continue;
    if (chunk.slice(0, c).trim().toLowerCase() === prop) return chunk.slice(c + 1).trim();
  }
  return null;
};

// Properties the compositor can animate on its own thread without repainting: transforms and
// opacity, in shorthand or individual form. Everything else means the main thread does style
// + paint work on every single frame, forever, for an animation nobody asked for.
const COMPOSITOR_SAFE = new Set([
  "transform",
  "-webkit-transform",
  "translate",
  "rotate",
  "scale",
  "opacity",
  "visibility",
  "will-change",
  "animation-timing-function",
]);

// Line-level escape hatch, greppable, same idiom as outbound-claim-allow / mutation-boundary-allow.
const ALLOW = "ambient-cost-allow";

const allRules = (): Rule[] => cssFiles().flatMap((f) => parseRules(f, readCssStripped(f)));

// name -> the keyframes text + where it lives (last definition wins, as in the cascade)
const keyframeIndex = (rules: Rule[]): Map<string, Rule> => {
  const map = new Map<string, Rule>();
  for (const r of rules) {
    const p = r.prelude.trim();
    if (!p.startsWith("@keyframes") && !p.startsWith("@-webkit-keyframes")) continue;
    const name = p.split(/\s+/).pop();
    if (name) map.set(name, r);
  }
  return map;
};

// The `animation` shorthand (or animation-name) on a leaf rule, if it loops forever.
const infiniteAnimationNames = (rule: Rule, known: Map<string, Rule>): string[] => {
  if (rule.nested) return [];
  const shorthand = declValue(rule.body, "animation");
  const explicit = declValue(rule.body, "animation-name");
  const iteration = declValue(rule.body, "animation-iteration-count");
  const forever =
    (shorthand ?? "").includes("infinite") || (iteration ?? "").includes("infinite");
  if (!forever) return [];
  const text = `${shorthand ?? ""} ${explicit ?? ""}`;
  return [...known.keys()].filter((n) => text.split(/[\s,]+/).includes(n));
};

// Is this selector a document-level pseudo layer — html/body/:root/#root + ::before/::after?
// That class is mechanically complete: those four subjects are the only elements guaranteed to
// exist on every screen of the app, so a pseudo layer hung on them is BY CONSTRUCTION always-on.
const isDocLevelPseudo = (sel: string): boolean => {
  if (!/::(before|after)\s*$/.test(sel)) return false;
  const subject = sel.split(/[\s>~+]+/).filter(Boolean).pop() ?? "";
  return /^(html|body|:root|#root)([^a-z0-9-]|$)/i.test(subject);
};

// Always-on ambient surfaces that are NOT document-level pseudo layers, so no parser can find
// them for us. Hand-maintained, and each entry is verified to still exist below — a rename
// fails the guard loudly instead of silently voiding it (same shape as shell-idle-guard's
// ALWAYS_ON list). Add a row when a new surface animates on every screen.
const ALWAYS_ON_AMBIENT: { file: string; selector: string; why: string }[] = [
  {
    file: "surfaces/ambient-hud.css",
    selector: ".v2-verdict h1",
    why: "every room renders a verdict headline; the foil runs the moment any room is on screen",
  },
  {
    file: "surfaces/ambient-hud.css",
    selector: ".hud-headline",
    why: "the HUD masthead is present in every HUD room",
  },
];

describe("ambient animation cost guard: always-on animations stay on the compositor", () => {
  const rules = allRules();
  const keyframes = keyframeIndex(rules);

  // ── Guard 1 — the mechanically complete class: document-level pseudo layers ───────────
  // (this is the one that catches an `aurora` regression, and any future sibling of it)
  it("no document-level ambient layer animates a property the compositor cannot handle", () => {
    const offenders: string[] = [];
    for (const rule of rules) {
      const sels = rule.prelude.split(",").map((s) => s.trim());
      if (!sels.some(isDocLevelPseudo)) continue;
      if (rule.body.includes(ALLOW)) continue;
      for (const name of infiniteAnimationNames(rule, keyframes)) {
        const kf = keyframes.get(name);
        if (!kf) continue;
        const unsafe = [...new Set(declaredProps(kf.body))].filter((p) => !COMPOSITOR_SAFE.has(p));
        if (unsafe.length)
          offenders.push(
            `${rule.file}:${rule.line} (${sels.join(", ")}) runs @keyframes ${name} forever, ` +
              `and that animates ${unsafe.join(", ")} — every frame repaints the whole window.`,
          );
      }
    }
    expect(
      offenders,
      `An always-on backdrop may only animate transform/opacity.\n` +
        `Fix: move the motion into transform (translate3d/scale), or drop the animation.\n` +
        `Evidence this is expensive: docs/perf/raw/idle-attribution.json.\n` +
        offenders.join("\n"),
    ).toEqual([]);
  });

  // ── Guard 2 — the blurred-layer trap ─────────────────────────────────────────────────
  // A composited layer carrying filter: blur() is rasterized once, at its current geometry.
  // Anything that changes that geometry throws the texture away and re-blurs, every frame:
  // scale() changes the size, and top/left/width/height/inset are LAYOUT properties, so they
  // also drag the main thread through layout and paint before the blur is even reapplied.
  // Translating does not — the compositor just moves the existing texture. This is precisely the
  // aurora defect: `scale(1) -> scale(1.09)` on a blur(26px) full-viewport layer.
  it("no forever-animating layer combines filter: blur() with a keyframe that re-rasters it", () => {
    // Two kinds in one list, both fatal to a cached blur: size changes and layout-driven moves.
    const RESIZING = ["scale(", "scale3d(", "width", "height", "inset", "top", "left", "zoom"];
    const offenders: string[] = [];
    for (const rule of rules) {
      if (rule.nested || rule.body.includes(ALLOW)) continue;
      const filter = declValue(rule.body, "filter") ?? declValue(rule.body, "-webkit-filter");
      if (!filter || !filter.includes("blur(")) continue;
      for (const name of infiniteAnimationNames(rule, keyframes)) {
        const kf = keyframes.get(name);
        if (!kf) continue;
        const props = new Set(declaredProps(kf.body));
        const hit = RESIZING.filter((t) => (t.endsWith("(") ? kf.body.includes(t) : props.has(t)));
        if (hit.length)
          offenders.push(
            `${rule.file}:${rule.line} (${rule.prelude.trim()}) blurs a layer AND runs ` +
              `@keyframes ${name} forever with ${hit.join(", ")} — that changes the layer's ` +
              `geometry, so the blur is thrown away and recomputed every frame.`,
          );
      }
    }
    expect(
      offenders,
      `A blurred layer must hold still or only translate.\n` +
        `Fix: drop the blur (soft gradients rarely need it), or express the motion as a\n` +
        `translate3d on a fixed-size layer — a "breathing" scale usually reads just as well as\n` +
        `an opacity wobble, which is free.\n` +
        offenders.join("\n"),
    ).toEqual([]);
  });

  // ── Guard 3 — the hand-kept half: always-on surfaces no selector pattern can identify ──
  it("the always-on ambient inventory still matches real selectors", () => {
    const missing = ALWAYS_ON_AMBIENT.filter(
      (entry) => !readCssStripped(entry.file).includes(entry.selector),
    ).map((entry) => `${entry.file} no longer contains ${entry.selector}`);
    expect(
      missing,
      `An inventory row stopped matching, so its guard below is silently inert.\n` +
        `Fix: update the selector in ALWAYS_ON_AMBIENT, or delete the row if the surface is gone.\n` +
        missing.join("\n"),
    ).toEqual([]);
  });

  it("no always-on ambient surface animates a property the compositor cannot handle", () => {
    const offenders: string[] = [];
    for (const entry of ALWAYS_ON_AMBIENT) {
      for (const rule of parseRules(entry.file, readCssStripped(entry.file))) {
        const sels = rule.prelude.split(",").map((s) => s.trim());
        if (!sels.some((s) => s.includes(entry.selector))) continue;
        if (rule.body.includes(ALLOW)) continue;
        for (const name of infiniteAnimationNames(rule, keyframes)) {
          const kf = keyframes.get(name);
          if (!kf) continue;
          const unsafe = [...new Set(declaredProps(kf.body))].filter(
            (p) => !COMPOSITOR_SAFE.has(p),
          );
          if (unsafe.length)
            offenders.push(
              `${entry.file}:${rule.line} (${entry.selector}) runs @keyframes ${name} forever, ` +
                `and that animates ${unsafe.join(", ")} — a repaint per frame on every screen.`,
            );
        }
      }
    }
    expect(
      offenders,
      `An always-on surface may only animate transform/opacity, or run its animation a finite ` +
        `number of times.\n` +
        `Fix: drop the infinite iteration count so the effect plays once on arrival, or move it ` +
        `onto transform.\n` +
        offenders.join("\n"),
    ).toEqual([]);
  });
});
