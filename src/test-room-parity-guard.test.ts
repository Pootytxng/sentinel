import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

// ── TEST-ROOM PARITY GUARD (bug→guard, owner-caught 2026-08-26, issue #224) ──────────────────
//
// THE REJECTION: the owner compared the installed Test room against the approved comp
// (`compy-visual-recovery-kit/assets/approved/test.png`) and rejected it. Six of the faults were
// STRUCTURAL — a rule in a stylesheet, not a judgement call — and each one is pinned here so the
// room cannot quietly drift back:
//
//   1. A corner-bracket HUD frame the comp does not draw.
//   2. A nested grey stage: the rig canvas drew its own border/plinth inside the bench panel.
//   3. A SIZE-INVARIANT rig. `.lc-rig` shrink-wrapped the canvas, so the hologram measured ~299 px
//      at 1280, at 1500 and at 1920 alike — 15.6% of width on the owner's monitor against the
//      comp's 30.5%. It came back a second way at 1280 once the canvas was stretched: r3f writes
//      its measured size back as an inline style, so an IN-FLOW rig fed its own stale width to the
//      grid track and spilled out of a stage that had shrunk. Both fixes are load-bearing.
//   4. Green per-station pips down the station list; the comp draws none.
//   5. `INSTRUMENTS READ` rendered above a ring whose unit ALSO said `READ`.
//
// The reading dividers are NOT here: `comp-fidelity-guard` already pins them against the comp, and
// it is the guard that caught this session asserting they were solid when the comp draws them
// dotted. One fact, one guard.
//
// WHAT THIS GUARD CANNOT DO: it does not resolve the cascade and it cannot see a rendered pixel.
// Visual acceptance is the owner's and Codex's, and the live measurement belongs to `self-review`.
// What it locks down is structural and exact — the declarations that produced each fault.

const SEP = String.fromCharCode(92);
/** Repo-relative, like the sheets' own import paths: vitest roots at the repo. */
const read = (rel: string) => readFileSync(rel.split("/").join(SEP), "utf8");

const LAB_CSS = read("src/surfaces/lab-console.css");
const DOCK_CSS = read("src/design/console/dock.css");
const LAB_TSX = read("src/surfaces/LabConsole.tsx");
const ARC_TSX = read("src/design/console/ArcGauge.tsx");

/** The body of the LAST rule whose selector list matches `selector`, comments stripped.
 *  A brace-depth walk rather than a regex: these sheets nest (`@keyframes`), and a flat
 *  `[^{}]` pattern silently misaligns on everything after the first nested block. */
function ruleBody(css: string, selector: string): string | null {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const stack: { sel: string; body: string }[] = [];
  let found: string | null = null;
  let buf = "";
  for (const ch of bare) {
    if (ch === "{") {
      stack.push({ sel: buf.trim(), body: "" });
      buf = "";
    } else if (ch === "}") {
      const top = stack.pop();
      if (top) {
        const sels = top.sel.split(",").map((s) => s.trim().replace(/\s+/g, " "));
        if (sels.includes(selector)) found = buf;
      }
      buf = "";
    } else buf += ch;
  }
  return found;
}

/** Value of `prop` in a rule body, or null. Split rather than matched: a declaration is exactly
 *  what sits between two semicolons, and a hand-rolled pattern here would be one more thing to
 *  get wrong in a file whose whole job is being right about declarations. */
function decl(body: string, prop: string): string | null {
  for (const part of body.split(";")) {
    const i = part.indexOf(":");
    if (i < 0) continue;
    if (part.slice(0, i).trim().toLowerCase() === prop) return part.slice(i + 1).trim();
  }
  return null;
}

describe("Test room — approved-comp parity (structural)", () => {
  it("1. draws no corner-bracket HUD frame", () => {
    // The comp's bench is one surface with one edge. `lc-brk` was four absolutely-positioned
    // L-shapes over its corners; nothing may reintroduce them in markup or in a sheet.
    expect(LAB_CSS).not.toMatch(/lc-brk/);
    expect(LAB_TSX).not.toMatch(/lc-brk/);
  });

  it("2. lets the rig canvas be the stage — no second frame inside the panel", () => {
    const body = ruleBody(LAB_CSS, ':root[data-v2="on"] .lc-rig .rig-canvas');
    expect(body, ".lc-rig .rig-canvas must be reset inside the bench").not.toBeNull();
    expect(decl(body!, "border")).toBe("0");
    expect(decl(body!, "background")).toBe("transparent");
  });

  it("3a. stretches the rig to its stage instead of shrink-wrapping it", () => {
    const rig = ruleBody(LAB_CSS, ':root[data-v2="on"] .lc-rig');
    expect(rig).not.toBeNull();
    expect(decl(rig!, "width")).toBe("100%");
    expect(decl(rig!, "height")).toBe("100%");
    // `place-items: center` on an auto-sized parent is what produced the 299 px rig.
    expect(rig!).not.toMatch(/place-items/);
    for (const sel of [':root[data-v2="on"] .lc-rig .rig-viewer', ':root[data-v2="on"] .lc-rig .rig-canvas']) {
      const b = ruleBody(LAB_CSS, sel)!;
      expect(decl(b, "width")).toBe("100%");
      expect(decl(b, "height")).toBe("100%");
    }
  });

  it("3b. rules the bench stage by aspect, never by a fixed height", () => {
    const stage = ruleBody(LAB_CSS, ':root[data-v2="on"] .lc-bench .lc-stage');
    expect(stage, "the bench stage needs its own rule").not.toBeNull();
    // Aspect is what keeps the framing identical at 1280, 1500 and 1920, and what keeps the box at
    // FIT_REF_ASPECT so camera-fit never pulls back.
    expect(decl(stage!, "aspect-ratio")).toBeTruthy();
    const mh = decl(stage!, "min-height");
    expect(mh, "a px min-height overrides the aspect and re-freezes the rig").toBe("0");
    expect(decl(stage!, "height"), "an explicit height would do the same").toBeNull();
  });

  it("3c. keeps the rig out of flow so r3f's inline size cannot size the stage", () => {
    const body = ruleBody(LAB_CSS, ':root[data-v2="on"] .lc-bench .lc-rig');
    expect(body, "the bench rig must be taken out of flow").not.toBeNull();
    expect(decl(body!, "position")).toBe("absolute");
    expect(decl(body!, "inset")).toBe("0");
  });

  it("4. draws no per-station pip in the station list", () => {
    const body = ruleBody(DOCK_CSS, ':root[data-v2="on"] .dock[data-layout="list"] .dock-led');
    expect(body, "the list layout must silence the LED").not.toBeNull();
    expect(decl(body!, "display")).toBe("none");
  });

  it("5. never gives the instruments-read gauge a unit that repeats its own label", () => {
    // The label already says INSTRUMENTS READ; `unitRead` printed "read" a second time under the
    // ring. The gauge takes an empty unit instead, and ArcGauge must render nothing for one.
    expect(LAB_TSX).not.toMatch(/unitRead\b/);
    expect(ARC_TSX).toMatch(/unit\.length\s*>\s*0\s*&&\s*unit\.length\s*<=\s*3/);
  });

  it("5b. renders no empty unit node beside the label either", () => {
    // The side-unit branch must not fire on a caller-supplied empty string — only on `empty`
    // (no reading at all) or a unit too long for under the ring.
    expect(ARC_TSX).toMatch(/\(empty \|\| unit\.length > 3\)/);
  });
});
