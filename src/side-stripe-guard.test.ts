import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
// (fs/path typed by src/test-node-shims.d.ts — the guard grades the stylesheets that SHIP.)

// SIDE-STRIPE GUARD (bug -> guard, 2026-08-18).
//
// A coloured `border-left` / `border-right` wider than 1px, used as an accent on a card, list row,
// callout or alert, is a BANNED pattern. It is never an intentional design decision — it is the
// reflex move, and it is one of the loudest "a machine laid this out" tells there is. On Home it
// was making `.hc-care` — the calmest row on the screen, whose own source comment calls it "a sign,
// not a call to action" — shout in accent while the verdict above it did not.
//
// The owner caught the Home clutter by eye; per the bug -> guard law that costs the pattern a
// permanent guard, not a paragraph.
//
// WHAT IS NOT A SIDE STRIPE, and why this guard does not flag it:
//   - CSS TRIANGLES (`.fix-advisory-chev`, `.wt-cursor::before`) — a thick side border paired with
//     transparent top AND bottom borders IS the triangle idiom. Geometry, not decoration.
//   - CORNER FRAMES — a side border paired with a perpendicular top/bottom border draws a corner,
//     which is a deliberate frame. (Health's `.hc-brk-*` elbows were the example until #225
//     deleted them; the exemption is mechanical and survives its example.)
// Both share one mechanical signature: a real perpendicular edge in the same rule. That is the
// exemption below, and it is why the guard can be strict without arguing about intent.

const ROOT = "src";
const NL = String.fromCharCode(10);
const BSLASH = String.fromCharCode(92);

// Known, LOGGED offenders that predate this guard. Each is a real side stripe on a surface this
// train did not visually review, so they are named here rather than silently "fixed" blind — an
// unverified visual change on three surfaces is worse than three honest entries. Removing one is a
// one-line CSS deletion plus a self-review of that surface. Tracked in docs/UI_VISION_BACKLOG.md.
// ADDING to this list is the thing the guard exists to prevent: fix the rule instead.
const BASELINE: ReadonlyArray<readonly [string, string]> = [
  ["src/App.css", ".detail-flag"],
  ["src/surfaces/CpuTempOffer.css", ".cpu-temp-offer-how"],
  ["src/surfaces/monitor-console.css", ".ss-detail"],
];

const ALLOW = "side-stripe-allow"; // greppable line-level escape hatch

// Built from RegExp literals' own .source so no escape level can be eaten in transit — the exact
// failure that made a sibling guard report green over nine live violations (2026-08-18).
const SPLIT = new RegExp([/[ ,()]/.source, /\t/.source].join("|"), "g");

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true })
    .filter((rel) => rel.endsWith(".css"))
    .map((rel) => join(dir, rel));
}

/** First `<n>px` token in a declaration value, or null. */
function pxWidth(value: string): number | null {
  for (const tok of value.split(SPLIT)) {
    const t = tok.trim();
    if (t.endsWith("px")) {
      const n = Number.parseFloat(t.slice(0, -2));
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

type Hit = { file: string; selector: string; decl: string; line: number };

/** Flat rule scan: `selector { decls }`. Nesting is not used in this codebase's CSS. */
function scan(file: string): Hit[] {
  const text = readFileSync(file, "utf8");
  const hits: Hit[] = [];
  let cursor = 0;
  for (;;) {
    const open = text.indexOf("{", cursor);
    if (open < 0) break;
    const close = text.indexOf("}", open);
    if (close < 0) break;
    const rawSelector = text.slice(text.lastIndexOf("}", open - 1) + 1, open).trim();
    const selector = rawSelector.split(NL).pop()!.trim() || rawSelector;
    const body = text.slice(open + 1, close);
    cursor = close + 1;

    // At-rule wrappers (@media, @supports) have no declarations of their own; their inner rules
    // are visited by the loop on the next pass, so skipping them here loses nothing.
    if (selector.startsWith("@")) continue;

    const decls = body
      .split(";")
      .map((d) => d.trim())
      .filter(Boolean);
    const perpendicular = decls.some((d) => {
      const [prop, ...rest] = d.split(":");
      const p = prop.trim();
      return (p === "border-top" || p === "border-bottom") && pxWidth(rest.join(":")) != null;
    });
    if (perpendicular) continue;

    for (const d of decls) {
      const [prop, ...rest] = d.split(":");
      const p = prop.trim();
      if (p !== "border-left" && p !== "border-right") continue;
      const value = rest.join(":");
      const w = pxWidth(value);
      if (w == null || w < 2) continue;
      // NO "transparent" EXEMPTION. The first draft skipped any value containing `transparent`,
      // reasoning that a transparent edge is spacing rather than an accent — and the DISARM PROOF
      // below immediately failed, because the two loudest real stripes in the repo are written
      // `color-mix(in srgb, var(--attention) 45%, transparent)`. The substring disarmed the guard
      // on exactly the rules it existed to catch. Transparent-edge geometry (triangles) is already
      // exempt via the perpendicular-edge rule above, and no rule in src/ declares a standalone
      // `border-left: Npx solid transparent`, so the exemption bought nothing and cost everything.
      // A genuine future case uses the greppable hatch.
      if (value.includes(ALLOW)) continue;
      hits.push({
        file: file.split(BSLASH).join("/"),
        selector,
        decl: d,
        line: text.slice(0, open).split(NL).length,
      });
    }
  }
  return hits;
}

const HITS = cssFiles(ROOT).flatMap(scan);
const isBaselined = (h: Hit) =>
  BASELINE.some(([f, sel]) => h.file === f && h.selector.includes(sel));

describe("side stripes are banned (>1px coloured border-left/right as an accent)", () => {
  it("no NEW side stripe anywhere in src/**/*.css", () => {
    const fresh = HITS.filter((h) => !isBaselined(h));
    const report = fresh.map((h) => `${h.file}:${h.line}  ${h.selector}  {${h.decl}}`).join(NL);
    expect(
      fresh,
      `side stripe(s) introduced:${NL}${report}${NL}${NL}Fix the rule — full border, background tint, a leading dot, or nothing. Do NOT add to BASELINE.`,
    ).toEqual([]);
  });

  it("Home's care row stays de-striped (the row the owner caught)", () => {
    const care = HITS.find(
      (h) => h.selector.includes(".hc-care") && !h.selector.includes("-entry"),
    );
    expect(care, `.hc-care grew a side stripe back: ${JSON.stringify(care)}`).toBeUndefined();
  });

  // DISARM PROOF. A scanner that has stopped finding things is indistinguishable from a clean
  // tree, and this exact class of silent no-op already burned this repo once while a room-name
  // guard reported 3/3 green over nine live violations. So the guard proves it can still SEE.
  describe("DISARM PROOF — the scanner still works", () => {
    it("reaches the whole stylesheet tree", () => {
      const files = cssFiles(ROOT);
      expect(files.length, "css files found").toBeGreaterThan(15);
      expect(files.some((f) => f.includes("home-console.css"))).toBe(true);
    });

    it("still finds every baselined offender — a shrinking baseline means a blind scanner", () => {
      for (const [f, sel] of BASELINE) {
        expect(
          HITS.some((h) => h.file === f && h.selector.includes(sel)),
          `stopped seeing the known stripe at ${f} ${sel} — either it was fixed (remove it from BASELINE) or the scanner is broken`,
        ).toBe(true);
      }
    });

    it("reads widths, and leaves triangles alone", () => {
      expect(pxWidth(" 2px solid var(--x)")).toBe(2);
      expect(pxWidth(" 1px solid var(--x)")).toBe(1);
      expect(pxWidth(" solid var(--x)")).toBeNull();
      // Triangles are exempted by the perpendicular-edge rule — proven live by the fact that
      // these two are NOT in BASELINE and NOT reported. (The third example, `.hc-brk-*`, was
      // deleted by #225; asserting the absence of a selector that no longer exists proves
      // nothing, so it went with it.)
      expect(HITS.some((h) => h.selector.includes(".fix-advisory-chev")), "chevron").toBe(false);
      expect(HITS.some((h) => h.selector.includes(".wt-cursor")), "cursor arrow").toBe(false);
    });
  });
});
