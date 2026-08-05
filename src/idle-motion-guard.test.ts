import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

// IDLE-MOTION GUARD (2026-08-04) — mechanizes Q7 acceptance line 399:
// "reduced-motion and step-aside modes eliminate continuous decorative work."
//
// WHY THIS EXISTS — the same shape of gap the hidden-poll guard was written for:
//
//   `HardwareTourScene` (the onboarding hardware tour) took a `paused` prop and derived
//   `frameloop={paused ? "demand" : "always"}` — and its ONLY mount site hardcoded `paused={false}`.
//   So the WebGL render loop ran at full rate unconditionally: reduced motion, hidden window,
//   fullscreen game, didn't matter. Every part-level animation inside it DID check `reduced`, which
//   made it worse, not better — full GPU cost producing an identical frame. `RigHologram` next door
//   gates on all three axes and documents the law in a header comment; prose does not fail a build.
//
// Two halves, because the acceptance line has two:
//
//   A. The CSS half — one unconditional reset in tokens.css stands down every keyframe animation in
//      the app. 32 `infinite` declarations across 21 stylesheets depend on it; none of them repeat
//      the check locally, and none of them should have to. Delete the reset and the whole app keeps
//      animating under reduced motion with nothing turning red.
//   B. The WebGL half — a `<Canvas>` frameloop is not covered by the CSS reset and not covered by
//      per-object `if (reduced) return` checks either. It is its own axis and needs its own rule.
//
// SCOPE, stated honestly: half B reads the `frameloop` binding as TEXT, not as an AST. It proves the
// stand-down axes are named in the expression that decides the render loop; it cannot prove they are
// combined correctly. Deliberate — cheap and robust beats clever and brittle, and it catches the
// failure that actually happened (an axis simply absent). If a future author hides the axes behind a
// helper const, this fails loudly and they either name them inline or add an exemption with a reason.
//
// Paths are repo-root-relative; vitest runs from the repo root (scripts/run-vitest.mjs).

// ── Half A: the CSS reset ───────────────────────────────────────────────────────────────────────

describe("idle-motion guard — the reduced-motion CSS reset", () => {
  it("tokens.css still stands every keyframe animation down", () => {
    // Motion is ON by default in Compy and OVERRIDES the OS (owner ruling 2026-06-19), so the switch
    // is the app's own `data-motion` attribute — NEVER a raw prefers-reduced-motion media query.
    const css = readFileSync("src/design/tokens.css", "utf8");
    const block = css.match(/:root\[data-motion="reduced"\]\s*\{[\s\S]*?\n\}/);
    expect(block, `tokens.css lost its :root[data-motion="reduced"] reset`).not.toBeNull();
    const reset = block![0];
    expect(reset, "the reset must be universal — every stylesheet relies on it").toMatch(
      /\*\s*,\s*\*::before\s*,\s*\*::after/,
    );
    expect(reset, "looping animations must be cut to a single iteration").toContain(
      "animation-iteration-count: 1 !important",
    );
    expect(reset, "the single remaining iteration must not be a visible animation").toMatch(
      /animation-duration:\s*0\.001ms\s*!important/,
    );
  });

  it("the reset is load-bearing (the corpus is the weak part)", () => {
    // If this ever drops to ~0 the test above is guarding a dead rule, which is worse than no test:
    // it reads as coverage. The census found 32 `infinite` declarations across 21 stylesheets on
    // 2026-08-04, none of which check reduced motion locally.
    const files = readdirSync("src", { recursive: true })
      .map(String)
      .filter((p) => p.endsWith(".css"))
      .map((p) => join("src", p).replace(/\\/g, "/"));
    const looping = files.filter((f) => readFileSync(f, "utf8").includes("infinite"));
    expect(looping.length).toBeGreaterThanOrEqual(15);
  });
});

// ── Half B: the WebGL render loop ───────────────────────────────────────────────────────────────

/** Tokens that name a stand-down axis inside a frameloop expression. */
const REDUCED_AXIS = /\breduced\b|useReducedMotion/;
const VISIBLE_AXIS = /\bvisible\b|useDocumentVisible/;

// Exemptions carry a REASON, never a bare path — an unexplained exemption is how a guard rots into a
// formality. Empty today: every canvas in the app either rests unconditionally or gates on both axes.
const EXEMPT: Record<string, string> = {};

/**
 * Comment lines are dropped before anything is scanned. Not cosmetic — both gated canvases DOCUMENT
 * the law in prose above the code (`// ... under frameloop="demand" only one frame renders ...`), and
 * a first cut of this guard read those sentences as the binding: deleting the real `frameloop` prop
 * outright still passed, because the comment about it matched. A guard satisfied by a comment about
 * the rule is exactly the failure mode the rule exists to prevent.
 */
function stripComments(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join("\n");
}

function canvasSurfaces(): { file: string; text: string }[] {
  return readdirSync("src", { recursive: true })
    .map(String)
    .filter((p) => /\.tsx$/.test(p) && !/\.test\.tsx$/.test(p))
    .map((p) => join("src", p).replace(/\\/g, "/"))
    .sort()
    .map((file) => ({ file, text: stripComments(readFileSync(file, "utf8")) }))
    .filter(({ text }) => text.includes("<Canvas"));
}

/**
 * The text that decides this file's render loop: either the literal JSX value, or — when the JSX
 * passes an identifier — that identifier's `const` declaration, read through to its terminating `;`.
 */
function frameloopBindings(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/frameloop=(?:"([^"]*)"|\{([A-Za-z_$][\w$]*)\})/g)) {
    const [, literal, ident] = m;
    if (literal !== undefined) {
      out.push(`"${literal}"`);
      continue;
    }
    const decl = text.match(new RegExp(`const\\s+${ident}\\b[^=]*=([\\s\\S]*?);`));
    // An unresolvable identifier (imported, a prop, computed elsewhere) reads as an empty binding,
    // which fails below. That is the intended outcome: the deciding expression must be legible here.
    out.push(decl ? decl[1] : "");
  }
  return out;
}

describe("idle-motion guard — the WebGL render loop", () => {
  it("finds the canvases at all (the corpus is the weak part)", () => {
    // A rename of the r3f import would silently empty the corpus and turn the assertion below into a
    // no-op. Pin the floor: the census found 3 canvas surfaces on 2026-08-04.
    expect(canvasSurfaces().length).toBeGreaterThanOrEqual(3);
  });

  it("every canvas stands its render loop down", () => {
    const offenders: string[] = [];
    for (const { file, text } of canvasSurfaces()) {
      if (file in EXEMPT) continue;
      const bindings = frameloopBindings(text);
      if (bindings.length === 0) {
        offenders.push(`${file} mounts a <Canvas> with no frameloop at all (r3f defaults to "always")`);
        continue;
      }
      for (const b of bindings) {
        // Unconditional rest is the strictest possible answer — nothing to gate.
        if (/^"demand"$/.test(b.trim())) continue;
        const missing = [
          REDUCED_AXIS.test(b) ? null : "reduced motion",
          VISIBLE_AXIS.test(b) ? null : "window visibility",
        ].filter(Boolean);
        if (missing.length) offenders.push(`${file} frameloop ignores ${missing.join(" and ")}`);
      }
    }

    expect(
      offenders,
      `A <Canvas> keeps painting when nobody can see it or asked it not to.\n` +
        `Derive the frameloop from the stand-down axes, in the file, by name:\n` +
        `    const visible = useDocumentVisible();\n` +
        `    const frameloop: "always" | "demand" = reduced || !visible ? "demand" : "always";\n` +
        `Under "demand" r3f still repaints on every React commit, so state changes land — what stops\n` +
        `is the continuous decorative work (Q7 §399). A canvas with nothing to animate should say\n` +
        `frameloop="demand" outright. Add a game-active (step-aside) axis too where a sensor owner\n` +
        `already supplies it — never a second poller for it (Q7 §398).\n` +
        `If a canvas genuinely must paint continuously, add it to EXEMPT WITH A REASON.\n`,
    ).toEqual([]);
  });

  it("every exemption still exists and still mounts a canvas (no dead entries)", () => {
    // An exemption that outlives its file is a lie the next reader has to disprove.
    const live = new Set(canvasSurfaces().map((s) => s.file));
    const stale = Object.keys(EXEMPT).filter((f) => !live.has(f));
    expect(stale, `EXEMPT names files that no longer mount a <Canvas> — delete them`).toEqual([]);
  });
});
