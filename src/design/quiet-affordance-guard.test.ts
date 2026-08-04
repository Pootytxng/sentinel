import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Quiet-row affordance guard (bug→guard, 2026-08-04).
//
// The RoomShell `quiet` slot is the room's "more, not attention-needing" drawer (P5 calm chrome).
// It shipped set in --v2-faint — the ink this design system reserves for MACHINE METADATA
// (.v2-measured provenance lines, .v2-version stamps) — with a colour-only hover. That made the
// row that opens real content read FAINTER and DEADER than the ForwardDoor, which the P6 law
// explicitly calls "quiet chrome, a doorknob not a CTA". Testers read it as footer legalese.
//
// The law this pins: a quiet row is quieter than the room's ONE primary action, but never quieter
// than the doorknob. Affordance weight, not attention weight.

const css = readFileSync(join("src", "design", "shell-v2.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

/** Body of a flat (unnested) rule, looked up by its exact selector header. */
function rule(selector: string): string {
  const at = css.indexOf(`${selector} {`);
  expect(at, `rule not found in shell-v2.css: ${selector}`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", at);
  return css.slice(open + 1, css.indexOf("}", open));
}

const decl = (body: string, prop: string): string | undefined =>
  body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;}]+)`))?.[1].trim();

const QUIET = ':root[data-v2="on"] .v2-quiet';
const DOOR = ':root[data-v2="on"] .v2-door';

describe("quiet slot reads as a control, not as fine print", () => {
  it("its resting ink is --v2-muted — never the --v2-faint metadata tier", () => {
    const ink = decl(rule(QUIET), "color");
    expect(ink).toBe("var(--v2-muted)");
    // Stated as its own assertion so a regression names the actual mistake.
    expect(ink, "--v2-faint is metadata ink (.v2-measured/.v2-version), not control ink").not.toMatch(
      /--v2-faint/,
    );
  });

  it("it is never fainter than the ForwardDoor, the deliberately-quiet doorknob", () => {
    // Same token = same tier. If the door is ever re-inked, this forces the quiet row to be
    // re-considered with it rather than silently sinking below it again.
    expect(decl(rule(QUIET), "color")).toBe(decl(rule(DOOR), "color"));
  });

  it("hover lifts more than colour — border AND fill, so the whole row responds", () => {
    const hover = rule(`${QUIET}:hover`);
    expect(decl(hover, "color")).toBe("var(--v2-text)");
    expect(decl(hover, "border-color"), "colour-only hover is what read as dead text").toBeTruthy();
    expect(decl(hover, "background")).toBeTruthy();
    // …and every lifted property is actually transitioned (no snap on one, ease on another).
    const transition = decl(rule(QUIET), "transition") ?? "";
    for (const prop of ["background", "color", "border-color"]) {
      expect(transition, `${prop} lifts on hover but is not transitioned`).toContain(prop);
    }
  });

  it("stays calmer than the room's ONE primary action — a neutral lift, not the door's accent", () => {
    // P5: the primary action is the only affordance that gets to shout; the door owns the accent
    // because it is where you go NEXT. The quiet row is more of THIS room, so it lifts neutral.
    const hover = rule(`${QUIET}:hover`);
    expect(hover, "quiet row must not borrow the accent").not.toMatch(/--v2-accent/);
    expect(rule(`${DOOR}:hover`), "sanity: the door still owns the accent lift").toMatch(
      /--v2-accent/,
    );
  });
});

describe("quiet slot caret is a rotating disclosure, not swapped glyphs", () => {
  it("the caret rotates open off aria-expanded (one glyph, translation-proof)", () => {
    expect(decl(rule(`${QUIET}-caret`), "transition")).toContain("transform");
    const open = rule(`${QUIET}[aria-expanded="true"] .v2-quiet-caret`);
    expect(decl(open, "transform")).toMatch(/rotate\(/);
  });

  it("the rotation obeys the motion law (data-motion, never a raw media query)", () => {
    expect(decl(rule(`:root[data-v2="on"][data-motion="reduced"] .v2-quiet-caret`), "transition")).toBe(
      "none",
    );
    expect(css, "motion must gate on data-motion, not prefers-reduced-motion").not.toMatch(
      /prefers-reduced-motion/,
    );
  });
});

// ── the consumers: every quiet head is a real, announced disclosure control ──

const sources = import.meta.glob("../**/*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("every .v2-quiet head is a semantic disclosure button", () => {
  it("is a <button> with aria-expanded + aria-controls, and carries the rotating caret", () => {
    const heads: string[] = [];
    const violations: string[] = [];
    for (const [path, src] of Object.entries(sources)) {
      if (path.endsWith(".test.tsx")) continue;
      for (const m of src.matchAll(/className="v2-quiet"/g)) {
        const i = m.index!;
        const back = src.slice(Math.max(0, i - 400), i);
        const tagAt = back.lastIndexOf("<");
        const tag = back.slice(tagAt + 1).match(/^([A-Za-z][\w]*)/)?.[1];
        const line = src.slice(0, i).split("\n").length;
        const where = `${path}:${line}`;
        heads.push(where);
        const el = src.slice(Math.max(0, i - 400) + tagAt, i + 700);
        if (tag !== "button") violations.push(`${where} — quiet head is <${tag}>, must be <button>`);
        if (!/aria-expanded=/.test(el)) violations.push(`${where} — missing aria-expanded`);
        if (!/aria-controls=/.test(el)) violations.push(`${where} — missing aria-controls`);
        if (!/v2-quiet-caret/.test(el)) violations.push(`${where} — missing the .v2-quiet-caret`);
        if (/["']▾["']/.test(el)) {
          violations.push(`${where} — swapped ▾/▸ glyphs; the caret rotates instead`);
        }
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
    // The slot is real and in use — this guard must never pass vacuously.
    expect(heads.length, "no .v2-quiet heads found — guard would be vacuous").toBeGreaterThanOrEqual(2);
  });
});
