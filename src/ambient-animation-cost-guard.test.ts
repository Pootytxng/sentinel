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
  {
    // bug→guard, v0.9.24: this row is the defect. The update pill's LED shipped animating
    // box-shadow spread forever, in the shell topbar, in the AVAILABLE branch — the permanent
    // resting state of every tester on an older build. Guard 1 could not see it (the LED is not a
    // document-level pseudo layer) and this inventory did not list its sheet, so a green suite
    // shipped the exact defect class this file exists to prevent. The inventory's blind spot IS
    // that it is hand-kept; the only repair is to keep it.
    file: "design/update-pill.css",
    selector: ".v2-update-led",
    why: "the update pill lives in the shell topbar, so an available update pulses on every screen",
  },
  {
    // bug->guard, v0.9.25 (#127): the inventory's second blind spot. HomeConsole, HomeHud and
    // HomeV2 all mount <SetupLauncherCard /> unconditionally, so its two pulse rings ran forever on
    // the landing screen for every user. The subtraction waterfall measured them at 4.156% of a CPU
    // core -- 21.2% of the whole idle cost -- and neither promoting them nor moving the motion onto
    // opacity changed that. Only stopping did.
    file: "surfaces/setup/SetupLauncherCard.css",
    selector: ".stl-ring",
    why: "all three Home surfaces mount SetupLauncherCard unconditionally, so its rings are always on",
  },
];

// ── The 2026-08-19 correction to this file's model ───────────────────────────────────────
// Guards 1-3 above encode "compositor-safe properties are free". Measurement against the shipped
// v0.9.25 binary falsified that in two separate ways, and these two guards pin what was actually
// measured (docs/perf/raw/idle-attribution-2026-08-19-A-rig-on.json and
// -2026-08-19-C-no-scale-anywhere.json, #127 -- both SETTLED runs; see the 2026-08-21 correction
// below for why that qualifier is now load-bearing):
//
//   1. SCALE IS NOT FREE ON A FULL-WINDOW LAYER. `aurora` animated transform only, was promoted
//      with will-change, and still cost 13.257% of a core -- 67.5% of all idle -- because a scale
//      animation makes the compositor re-raster the layer at its new size. With the scale removed
//      everywhere, total idle fell 19.632 -> 9.421. Translating costs less; resizing is worse.
//   2. ON A SMALL ALWAYS-ON SURFACE, RUNNING FOREVER IS ITSELF THE COST. `stl-pulse` measured
//      4.156 as shipped and 4.721 rewritten to animate opacity alone. Two different mechanisms,
//      one number. Nothing about HOW it animated mattered.
//
// So: full-window layers may drift but not breathe, and always-on badges get a bounded ping.

// ── The 2026-08-21 correction to the correction: DRIFT IS NOT FREE EITHER ────────────────
// The half of the sentence above that reads "translating is free" was never measured. It came from
// run B, whose own file records "baselineStability": { "settled": false } -- the probe's way of
// saying the baseline never held still, so no band measured against it means anything. Two SETTLED
// runs on 2026-08-21 against the installed build measured what the surviving pure-translate3d
// `aurora` actually costs, and it is not nothing:
//
//     E (as shipped)     total idle 22.392% of a core -> 2.067% with aurora alone frozen
//     F (type reverted)  total idle 21.178% of a core -> 1.681% with aurora alone frozen
//     (docs/perf/raw/idle-attribution-2026-08-21-E-baseline.json and -F-type1-reverted.json)
//
// ~88% of everything Compy burns sitting idle is the ambient backdrop drifting behind a window
// nobody is looking at. The #127 fix removed a scale that was genuinely expensive; it did not make
// the layer cheap, and the number that said it had was noise.
//
// THIS FILE CANNOT CATCH THAT, AND SHOULD NOT PRETEND TO. It is a static CSS analyser: it reads
// selectors and keyframe bodies, so it can see `scale(` in a keyframe but it can never see what a
// layer costs on a machine. The guard that owns cost is the recorded budget --
// docs/perf/q7-baseline.json's idleCpuPercentOfOneCore, enforced by
// scripts/perf-budget-guard.test.mjs -- and the guard that stops a bad measurement from becoming a
// rule in the first place is src/perf-evidence-integrity-guard.test.ts, written the same day for
// exactly this failure. Do not add a cost assertion here; ratchet the budget there.

// A keyframe body that changes the layer's raster geometry. Includes the individual `scale`
// property, which is a transform written a different way and costs exactly the same.
const RESIZES_THE_RASTER = ["scale(", "scale3d(", "scaleX(", "scaleY("];

const resizesRaster = (kf: Rule): string[] => {
  const hit = RESIZES_THE_RASTER.filter((t) => kf.body.includes(t));
  if (declaredProps(kf.body).includes("scale")) hit.push("the scale property");
  return hit;
};

/**
 * GUARD 4 — a document-level ambient layer may drift, but may not resize.
 * Takes its inputs so the falsification suite below can drive this exact function with synthetic
 * CSS parsed by the same parser the disk test uses. A guard whose mutation test builds its own
 * input string proves the matcher, not the guard (the no-raw-select lesson, 2026-08-18).
 */
const docLevelResizeOffenders = (rules: Rule[], keyframes: Map<string, Rule>): string[] => {
  const offenders: string[] = [];
  for (const rule of rules) {
    const sels = rule.prelude.split(",").map((s) => s.trim());
    if (!sels.some(isDocLevelPseudo)) continue;
    if (rule.body.includes(ALLOW)) continue;
    for (const name of infiniteAnimationNames(rule, keyframes)) {
      const kf = keyframes.get(name);
      if (!kf) continue;
      const hit = resizesRaster(kf);
      if (hit.length)
        offenders.push(
          `${rule.file}:${rule.line} (${sels.join(", ")}) runs @keyframes ${name} forever with ` +
            `${hit.join(", ")} — a scale animation re-rasters the whole layer every frame.`,
        );
    }
  }
  return offenders;
};

/**
 * GUARD 6 — a document-level ambient layer may not animate FOREVER AT ALL, whatever it animates.
 *
 * bug→guard (2026-08-21). Guard 4 forbids the mechanism that was understood in August: a scale
 * re-rasters the layer. What replaced it -- a pure translate3d drift, promoted with will-change,
 * the textbook free animation -- then measured at ~88% of everything Compy burned sitting idle
 * (22.392% of a core -> 2.067% with that one animation frozen, and 21.178 -> 1.681 on the run
 * beside it). Two settled runs, same binary, same room, back to back.
 *
 * So the rule this file was built on -- "compositor-safe properties are free" -- is false for this
 * one class of layer, and no property list can rescue it. A full-window layer is composited into a
 * window carrying ~25 backdrop-filter surfaces at 240 Hz; moving it at all invalidates them. That
 * mechanism is a HYPOTHESIS (see src/App.css). The cost is not: it was measured twice.
 *
 * Hence the blunt rule. Document-level pseudo layers are always-on by construction, exactly like
 * the inventory guard 5 protects, so they get the same verdict guard 5 gives: a bounded run or
 * nothing. Guard 4 stays because a scale is worse still and deserves its own message.
 *
 * Escape hatch is the same line-level, greppable `ambient-cost-allow` -- and it is for a layer
 * whose cost has been MEASURED and accepted, not for one assumed cheap. That assumption is the
 * defect this guard exists to stop repeating.
 */
const docLevelForeverOffenders = (rules: Rule[], keyframes: Map<string, Rule>): string[] => {
  const offenders: string[] = [];
  for (const rule of rules) {
    const sels = rule.prelude.split(",").map((s) => s.trim());
    if (!sels.some(isDocLevelPseudo)) continue;
    if (rule.body.includes(ALLOW)) continue;
    const names = infiniteAnimationNames(rule, keyframes);
    if (names.length)
      offenders.push(
        `${rule.file}:${rule.line} (${sels.join(", ")}) runs @keyframes ${names.join(", ")} ` +
          `forever on a layer that is on screen in every room.`,
      );
  }
  return offenders;
};

/**
 * GUARD 5 — an always-on surface from the inventory may not animate forever, full stop.
 * `readRules` is injected for the same falsification reason as above.
 */
const foreverOnAlwaysOnOffenders = (
  entries: { file: string; selector: string }[],
  readRules: (file: string) => Rule[],
  keyframes: Map<string, Rule>,
): string[] => {
  const offenders: string[] = [];
  for (const entry of entries) {
    for (const rule of readRules(entry.file)) {
      const sels = rule.prelude.split(",").map((s) => s.trim());
      if (!sels.some((s) => s.includes(entry.selector))) continue;
      if (rule.body.includes(ALLOW)) continue;
      const names = infiniteAnimationNames(rule, keyframes);
      if (names.length)
        offenders.push(
          `${entry.file}:${rule.line} (${entry.selector}) runs @keyframes ${names.join(", ")} ` +
            `with an infinite iteration count — measured at ~4 points of a CPU core regardless of ` +
            `which property it animates.`,
        );
    }
  }
  return offenders;
};

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

// ── Guards 4 and 5 — what the 2026-08-19 re-teardown actually measured ────────────────────
describe("ambient animation cost guard: always-on motion stays bounded and never resizes", () => {
  const rules = allRules();
  const keyframes = keyframeIndex(rules);

  it("no document-level ambient layer animates scale forever", () => {
    const offenders = docLevelResizeOffenders(rules, keyframes);
    expect(
      offenders,
      `A full-window backdrop may drift, but it may not breathe.\n` +
        `Fix: express the motion as translate3d alone, or drop the animation.\n` +
        `Evidence: with scale(1.09) aurora measured 13.257 points of a CPU core; removing the\n` +
        `scale everywhere took total idle 19.632 -> 9.421 (docs/perf/raw/idle-attribution-2026-08-19-A-rig-on.json\n` +
        `vs -C-no-scale-anywhere.json). The "and -0.105 without" that stood here came from run B,\n` +
        `which never settled, and is withdrawn -- see guard 6.\n` +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("no document-level ambient layer animates forever, whatever it animates", () => {
    const offenders = docLevelForeverOffenders(rules, keyframes);
    expect(
      offenders,
      `A layer that is on screen in every room gets a bounded run, or none.\n` +
        `Fix: drop the animation (the resting frame is the picture), give it a finite iteration\n` +
        `count, or drive it from :hover / a real user action.\n` +
        `Evidence: the pure-translate3d drift that replaced the scale still measured ~88% of all\n` +
        `idle CPU -- 22.392% of a core -> 2.067% with it alone frozen, and 21.178 -> 1.681 on the\n` +
        `run beside it (docs/perf/raw/idle-attribution-2026-08-21-E-baseline.json and\n` +
        `-F-type1-reverted.json). "Compositor-safe" did not mean free here.\n` +
        `If you have MEASURED a new layer and accepted its cost, say so with ${ALLOW} on the line\n` +
        `and cite the run. Do not use it on a layer you assume is cheap.\n` +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("no always-on surface in the inventory animates forever", () => {
    const offenders = foreverOnAlwaysOnOffenders(
      ALWAYS_ON_AMBIENT,
      (file) => parseRules(file, readCssStripped(file)),
      keyframes,
    );
    expect(
      offenders,
      `An always-on surface gets a bounded ping, not a permanent animation.\n` +
        `Fix: give it a finite iteration count (add "forwards" if the resting frame matters), or\n` +
        `drive it from :hover / :focus-visible so it only runs when someone is there.\n` +
        `Evidence: stl-pulse measured ~4 points of a core as shipped, promoted, AND rewritten to\n` +
        `animate opacity alone — running forever was the cost, not the property.\n` +
        offenders.join("\n"),
    ).toEqual([]);
  });
});

// ── Falsification — drive the guards' OWN functions with CSS that should trip them ────────
// A mutation test that hand-builds the string its matcher expects proves the matcher and nothing
// else; the no-raw-select guard shipped green over a live blind spot that way (2026-08-18). These
// parse synthetic CSS with parseRules — the same parser the disk tests use — and call the same two
// functions, so a refactor that quietly stops detecting shows up here.
describe("ambient animation cost guard: the guards themselves are armed", () => {
  const index = (css: string, file = "synthetic.css") => {
    const rules = parseRules(file, css);
    return { rules, keyframes: keyframeIndex(rules) };
  };

  const DRIFTS = `@keyframes drift { from { transform: translate3d(0,0,0); } to { transform: translate3d(-3%,2.5%,0); } }`;
  const BREATHES = `@keyframes breathe { from { transform: translate3d(0,0,0) scale(1); } to { transform: translate3d(-3%,2.5%,0) scale(1.09); } }`;
  const BREATHES_LONGHAND = `@keyframes breathe { from { scale: 1; } to { scale: 1.09; } }`;

  it("guard 4 fires on a body::before that scales forever", () => {
    const { rules, keyframes } = index(
      `${BREATHES} body::before { animation: breathe 20s ease-in-out infinite alternate; }`,
    );
    expect(docLevelResizeOffenders(rules, keyframes)).toHaveLength(1);
  });

  it("guard 4 fires on the longhand scale property too", () => {
    const { rules, keyframes } = index(
      `${BREATHES_LONGHAND} :root::after { animation: breathe 20s linear infinite; }`,
    );
    expect(docLevelResizeOffenders(rules, keyframes)).toHaveLength(1);
  });

  it("guard 4 stays silent on the shipped fix — a translate-only drift", () => {
    const { rules, keyframes } = index(
      `${DRIFTS} body::before { animation: drift 20s ease-in-out infinite alternate; }`,
    );
    expect(docLevelResizeOffenders(rules, keyframes)).toEqual([]);
  });

  it("guard 4 stays silent on a scale that plays a finite number of times", () => {
    const { rules, keyframes } = index(
      `${BREATHES} body::before { animation: breathe 20s ease-in-out 3; }`,
    );
    expect(docLevelResizeOffenders(rules, keyframes)).toEqual([]);
  });

  it("guard 6 fires on the translate-only drift guard 4 was built to permit", () => {
    const { rules, keyframes } = index(
      `${DRIFTS} body::before { animation: drift 20s ease-in-out infinite alternate; }`,
    );
    // The exact CSS the "guard 4 stays silent" case above calls the shipped fix. It was not free.
    expect(docLevelResizeOffenders(rules, keyframes)).toEqual([]);
    expect(docLevelForeverOffenders(rules, keyframes)).toHaveLength(1);
  });

  it("guard 6 stays silent on a bounded run and on a layer with no animation", () => {
    const bounded = index(`${DRIFTS} body::before { animation: drift 20s ease-in-out 3 forwards; }`);
    expect(docLevelForeverOffenders(bounded.rules, bounded.keyframes)).toEqual([]);
    const still = index(`${DRIFTS} body::before { inset: -25%; z-index: -1; }`);
    expect(docLevelForeverOffenders(still.rules, still.keyframes)).toEqual([]);
  });

  it("guard 6 respects the ambient-cost-allow escape hatch", () => {
    const { rules, keyframes } = index(
      `${DRIFTS} body::before { animation: drift 20s linear infinite; /* ambient-cost-allow */ }`,
    );
    expect(docLevelForeverOffenders(rules, keyframes)).toEqual([]);
  });

  it("guard 5 fires on an inventoried surface animating forever", () => {
    const css = `@keyframes ping { 0% { opacity: 0.9; } 100% { opacity: 0; } }
      .stl-ring { animation: ping 2.4s ease-out infinite; }`;
    const { keyframes } = index(css);
    const offenders = foreverOnAlwaysOnOffenders(
      [{ file: "synthetic.css", selector: ".stl-ring" }],
      () => parseRules("synthetic.css", css),
      keyframes,
    );
    expect(offenders).toHaveLength(1);
  });

  it("guard 5 stays silent on the shipped fix — a bounded ping", () => {
    const css = `@keyframes ping { 0% { opacity: 0.9; } 100% { opacity: 0; } }
      .stl-ring { animation: ping 2.4s ease-out 6 forwards; }`;
    const { keyframes } = index(css);
    const offenders = foreverOnAlwaysOnOffenders(
      [{ file: "synthetic.css", selector: ".stl-ring" }],
      () => parseRules("synthetic.css", css),
      keyframes,
    );
    expect(offenders).toEqual([]);
  });

  it("guard 5 respects the ambient-cost-allow escape hatch", () => {
    const css = `@keyframes ping { 0% { opacity: 0.9; } 100% { opacity: 0; } }
      .stl-ring { animation: ping 2.4s ease-out infinite; /* ambient-cost-allow */ }`;
    const { keyframes } = index(css);
    const offenders = foreverOnAlwaysOnOffenders(
      [{ file: "synthetic.css", selector: ".stl-ring" }],
      () => parseRules("synthetic.css", css),
      keyframes,
    );
    expect(offenders).toEqual([]);
  });
});
