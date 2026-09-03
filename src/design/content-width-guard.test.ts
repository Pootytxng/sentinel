// bug→guard, twice over, for the two Codex REJECTs that shaped `.v2-content-wrap`:
//
// Round 1 (candidate 9bef1cc2, 2026-08-27): a FIXED 1160px cap left the Test room a centred
// island at 1920 — ~267px of dead margin each side on the display the owner actually works at.
// Rejected on sight.
//
// Round 2 (candidate 16e28044, 2026-08-27): the fix overreached. Making the cap proportional for
// EVERY room shipped an unreviewed geometry change to Live and History, which read visibly
// stretched and sparse at 1920. The round-2 REJECT's correction 2 was explicit: scope the wider
// treatment to Test (the room issue #224 actually reviews) and give Health, Live and History back
// the fixed 1160 they shipped with. Their own 1920 treatment is a future, separately-reviewed
// decision.
//
// So the guard now pins BOTH halves of that ruling, plus the arithmetic that round 1 established:
//
//   1. the DEFAULT wrap rule is the fixed 1160px again — a proportional default is the round-2
//      overreach coming back;
//   2. a Test-scoped rule (`:has(> .v2-room[data-room="lab"])`) carries the proportional cap —
//      losing the scope re-ships the overreach, losing the rule re-ships round 1's dead margins;
//   3. the proportional cap still lands the comps' box at 1500 and grows at 1920, with a ceiling
//      for displays wide enough to stretch a sentence past reading;
//   4. (correction 3, same REJECT) the Test headline keeps a measure that forces the comp's own
//      two-line break — the wider box handed the story a column wide enough that "Test one change
//      at a time" ran as one line at 1920.
//
// Read from the stylesheet rather than from a rendered page: jsdom does not lay out, so the source
// is the only honest place to check a layout rule in a unit test. The live check is the four-room
// visual smoke that ships with the change.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const CSS = readFileSync(resolve("src/design/shell-v2.css"), "utf8");

/** The declaration block for a selector, as written. */
function ruleFor(selector: string): string {
  const at = CSS.indexOf(selector + " {");
  expect(at, `${selector} has no rule in shell-v2.css`).toBeGreaterThan(-1);
  return CSS.slice(at, CSS.indexOf("}", at));
}

const WRAP = ruleFor(':root[data-v2="on"] .v2-content-wrap');
const LAB_WRAP = ruleFor(':root[data-v2="on"] .v2-content-wrap:has(> .v2-room[data-room="lab"])');
const CONTENT = ruleFor(':root[data-v2="on"] .v2-content');

/** What `max-width: min(P%, Cpx)` resolves to inside the content lane at a given window width. */
function capAt(windowPx: number, pct: number, ceilPx: number): number {
  const RAIL = 216; // the shell's fixed navigation rail, measured on the live build
  const SCROLLBAR = 10; // `scrollbar-width: thin` on .v2-content, also measured live
  const padding = 2 * Number(/padding:\s*\d+px\s+(\d+)px/.exec(CONTENT)![1]);
  return Math.min(((windowPx - RAIL - SCROLLBAR - padding) * pct) / 100, ceilPx);
}

describe("the default content box is the fixed cap the reviewed rooms shipped with", () => {
  it("caps Health, Live and History at the measured 1160px, not a proportion", () => {
    expect(
      /max-width:\s*1160px/.test(WRAP),
      "the DEFAULT `.v2-content-wrap` rule must be the fixed 1160px — a proportional default is " +
        "the round-2 overreach (unreviewed 1920 geometry shipped to Live/History) coming back",
    ).toBe(true);
  });

  it("keeps the proportional cap OUT of the default rule", () => {
    expect(/min\(/.test(WRAP), "the default rule must not carry a min() cap — that is Test's alone").toBe(false);
  });
});

describe("the Test room's content box scales with the window instead of stranding it", () => {
  const m = /max-width:\s*min\(\s*([\d.]+)%\s*,\s*(\d+)px\s*\)/.exec(LAB_WRAP);

  it("caps by proportion with a ceiling, never by a bare pixel width", () => {
    expect(
      m,
      "a fixed `max-width: <n>px` here is the round-1 1920 dead-margin defect — Test's cap must " +
        "be a percentage of the space the rail leaves, with a px ceiling behind it",
    ).not.toBeNull();
  });

  it("still lands the comps' box at 1500 and keeps the proportion at 1920", () => {
    const [pct, ceil] = [Number(m![1]), Number(m![2])];
    // 1500 is the owner's window and the width every approved comp was drawn at. Re-measured off
    // assets/approved/test.png 2026-08-27 by scanning for the bench panel's own right border: the
    // content box runs x288..1488 comp px, i.e. 279..1440 app px = 1161. A few px either way is the
    // rounding; a 40px drift is a redesign.
    expect(Math.abs(capAt(1500, pct, ceil) - 1161)).toBeLessThan(8);
    // 1920 is his display. Round 1's fixed cap left it at 1160 with ~267px dead each side; the box
    // must take most of what the rail leaves, while still keeping a gutter rather than running edge
    // to edge.
    const at1920 = capAt(1920, pct, ceil);
    expect(at1920, "1920 must not still be stranded at the 1500 box").toBeGreaterThan(1450);
    expect(at1920, "…but it must not consume the gutter either").toBeLessThan(1644);
  });

  it("keeps a ceiling for displays wide enough to stretch a sentence past reading", () => {
    const ceil = Number(m![2]);
    expect(ceil).toBeGreaterThan(1560); // never binds at 1920
    expect(ceil).toBeLessThanOrEqual(1900); // but does bind on a very wide monitor
  });
});

describe("the Test headline keeps the comp's two lines (round-2 REJECT, correction 3)", () => {
  // The wider Test box hands the story a ~634px column at 1920 — wide enough that "Test one
  // change at a time" ran as ONE line where the approved comp draws two. The measure cap is what
  // forces the comp's break ("Test one change" / "at a time") at any column width, and it is in
  // ch so it follows the headline-fit step-down instead of fighting it.
  // The same selector text also CLOSES the shared hero rule's comma list, so a plain indexOf
  // lands on the wrong block — collect every block this selector opens and take the one that
  // carries the cap.
  const SEL = ':root[data-v2="on"] .v2-room[data-layout="split"][data-room="lab"] > .v2-verdict h1 {';
  const LAB_H1_BLOCKS: string[] = [];
  for (let at = CSS.indexOf(SEL); at !== -1; at = CSS.indexOf(SEL, at + 1)) {
    LAB_H1_BLOCKS.push(CSS.slice(at, CSS.indexOf("}", at)));
  }

  it("caps the Test hero headline's measure in ch, tight enough to break before 'at'", () => {
    expect(LAB_H1_BLOCKS.length, "the Test hero h1 selector vanished from shell-v2.css").toBeGreaterThan(0);
    const cap = LAB_H1_BLOCKS.map((b) => /max-width:\s*([\d.]+)ch/.exec(b)).find(Boolean);
    expect(cap, "the Test hero h1 must carry its own ch measure cap — the shared 20ch never binds first").toBeTruthy();
    const ch = Number(cap![1]);
    // 15ch holds "Test one change" (15 chars, proportional ≈ 390px at the hero size); 18ch admits
    // "Test one change at" and the comp's break point is lost.
    expect(ch).toBeGreaterThanOrEqual(14);
    expect(ch).toBeLessThan(18);
  });
});
