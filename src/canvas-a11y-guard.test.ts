import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";

// CANVAS A11Y GUARD (2026-08-05) — mechanizes the ONE ❌ row of the Q7 native accessibility matrix
// (docs/superpowers/specs/2026-07-31-q7-native-baseline.md, recording docs/perf/raw/a11y.json).
//
// WHAT THE SWEEP FOUND, against the installed build over CDP:
//
//   Home and Lab both render the hologram bay (RigViewer → RigHologram), and in BOTH rooms the
//   <canvas> came back with aria-label, aria-labelledby, role, aria-hidden AND fallback content all
//   null, with no adjacent text either. To a screen reader the centrepiece of the app — a picture of
//   the user's own machine — was nothing at all. Not "described badly": absent. Meanwhile Monitor's
//   chart canvas carried aria-hidden="true" correctly, so the pattern already existed in the repo
//   and two rooms simply did not use it.
//
// THE r3f TRAP, which is why this needs a guard and not a code review:
//
//   `CanvasProps extends React.HTMLAttributes<HTMLDivElement>`, and the render body spreads
//   `...props` onto the OUTER wrapper div. The inner <canvas> is handed exactly three things: a ref,
//   `style: {display:"block"}`, and `children: fallback`. So writing `aria-label` on <Canvas> looks
//   like fixing the canvas and does not touch it — the attribute lands on a div two levels up. The
//   ONLY prop that reaches the canvas element is `fallback`, which r3f's own typings describe as
//   "Canvas fallback content, similar to img's alt prop" (verified against v9.6.1 below).
//
//   That is a trap a reviewer reads straight past, because the broken version and the correct
//   version look identical in the diff. Hence: both are required, and the requirement is mechanical.
//
// THE RULE — every <Canvas> in the app answers one of two questions at its own call site:
//
//   • "This picture says something the text does not"  → role="img" + aria-label + fallback.
//   • "This picture is decoration"                     → aria-hidden="true".
//
//   Decorative is a legitimate answer and two of the three canvases use it honestly (TwoFuturesScene
//   sits between the dates above it and the before → after numbers below it; HardwareTourScene sits
//   beside the tour's text panel). What is NOT legitimate is silence, which is what Home and Lab
//   shipped. The rule is enforced at the CALL SITE deliberately: HardwareTourScene was already
//   hidden by its host's wrapper, and a component whose accessibility depends on where it happens to
//   be mounted is one remount away from regressing.
//
// SCOPE, stated honestly: this reads the opening tag as TEXT. It proves a name or an explicit
// hide exists; it cannot prove the name is any good. A useless label ("canvas", "3D") passes here
// and is caught by the self-review rubric, not by this file.
//
// Paths are repo-root-relative; vitest runs from the repo root (scripts/run-vitest.mjs).

/** Same comment strip as the idle-motion guard, for the same reason: a guard that a COMMENT about
 *  the rule can satisfy is the failure mode the rule exists to prevent. These very canvases carry
 *  prose above their props explaining the a11y decision. */
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
 * The opening `<Canvas ...>` tag only. Brace-depth aware and string aware, because real props
 * contain both: `onPointerMissed={() => onSelect("")}` holds a `>` that must not end the tag.
 */
function openingTags(text: string): string[] {
  const out: string[] = [];
  for (let start = text.indexOf("<Canvas"); start !== -1; start = text.indexOf("<Canvas", start + 1)) {
    let depth = 0;
    let quote: string | null = null;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (quote) {
        if (c === quote && text[i - 1] !== "\\") quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) {
        out.push(text.slice(start, i + 1));
        break;
      }
    }
  }
  return out;
}

describe("canvas a11y guard — every <Canvas> is named or explicitly hidden", () => {
  it("finds the canvases at all (the corpus is the weak part)", () => {
    // A rename of the r3f import would empty the corpus and turn the assertion below into a no-op
    // that still reads as coverage. The census found 3 canvas surfaces on 2026-08-05.
    expect(canvasSurfaces().length).toBeGreaterThanOrEqual(3);
  });

  it("no canvas is silent to a screen reader", () => {
    const offenders: string[] = [];
    for (const { file, text } of canvasSurfaces()) {
      for (const tag of openingTags(text)) {
        if (/\baria-hidden=/.test(tag)) continue; // decorative, declared as such
        const named = /\baria-label=|\baria-labelledby=/.test(tag);
        const alt = /\bfallback=/.test(tag);
        if (named && alt) continue;
        const missing = [
          named ? null : `aria-label (names the wrapper div for the AX tree)`,
          alt ? null : `fallback (the ONLY prop that reaches the <canvas> element itself)`,
        ].filter(Boolean);
        offenders.push(`${file} — <Canvas> missing ${missing.join(" and ")}`);
      }
    }

    expect(
      offenders,
      `A <Canvas> is invisible to a screen reader.\n\n` +
        `If the picture carries meaning, name it at the call site — BOTH props, because r3f spreads\n` +
        `...props onto the outer wrapper div and hands the <canvas> only \`fallback\`:\n` +
        `    <Canvas role="img" aria-label={altText} fallback={altText} ... />\n` +
        `Build the text from the same data the scene draws, never from a written-out description of\n` +
        `hardware — see RigHologram's altText memo (honest ghosts included, nothing invented).\n\n` +
        `If the picture is genuinely decoration — every fact it shows is already text beside it —\n` +
        `say so instead:\n` +
        `    <Canvas aria-hidden="true" ... />\n` +
        `That is a real answer, not a cop-out, and two of the three canvases use it. Silence is not.\n`,
    ).toEqual([]);
  });

  it("r3f still routes props the way this rule assumes", () => {
    // The rule above is only correct while `fallback` is what reaches the <canvas>. If a future r3f
    // changes that contract, this guard would keep passing while enforcing the wrong thing — so pin
    // the upstream fact rather than trusting a comment about it. Verified against v9.6.1.
    const decl = "node_modules/@react-three/fiber/dist/declarations/src/web/Canvas.d.ts";
    expect(existsSync(decl), `${decl} moved — re-verify how r3f routes props before trusting this guard`).toBe(true);
    const types = readFileSync(decl, "utf8");
    expect(types, "CanvasProps no longer inherits div attributes — recheck where aria-* lands").toMatch(
      /extends[^{]*HTMLAttributes<HTMLDivElement>/,
    );
    expect(types, "`fallback` is gone — recheck what reaches the <canvas> element").toMatch(/fallback\?:/);

    const impl = "node_modules/@react-three/fiber/dist/react-three-fiber.esm.js";
    expect(existsSync(impl), `${impl} moved — re-verify how r3f routes props before trusting this guard`).toBe(true);
    const js = readFileSync(impl, "utf8");
    // The canvas element's children ARE the fallback; ...props are spread higher up.
    expect(js, "r3f no longer renders `fallback` as the canvas element's children").toMatch(
      /jsx\("canvas",\s*\{[\s\S]{0,200}?children:\s*fallback/,
    );
  });
});
