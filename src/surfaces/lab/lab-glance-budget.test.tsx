import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";

// BUG → GUARD (consumer panel P3/P4/P5, 2026-07-29, LabDeck glance-first train)
//
// THE DEFECT. On arrival at the Lab, with no scrolling, the "next best move" card was 678px tall
// inside a 711px viewport at 1280×720 — one card taller than the screen it landed on. Its
// three-fact column (state / what changes / the trade-off) occupied y 625→756, which runs straight
// through the app's fixed status readout band at y 690→704. So the FIRST thing a beginner saw was
// 282 words of explanation, and the trade-off — the one fact that decides whether they should say
// no — was the part sitting under the chrome. Separately, the panel flagged 4/5 that the card's
// safety text (the rollback promise, the do-nothing choice, the "Compy won't set this one"
// warning) was the DIMMEST type on the card, and that the accent was spent on prose rather than on
// the one action.
//
// THE CAUSE. Everything the user might eventually want was rendered unconditionally. Eleven
// blocks, no disclosure, so height and word count grew with the length of whatever the catalog
// happened to say. Nothing measured or clamped the glance layer, and `--ix-text-3` — the token
// reserved for optional metadata — had been reached for on caveats the user must act on, because
// "quieter" reads as "tidier" when nothing enforces the difference.
//
// THE GUARD. Three independent locks, because the defect had three independent surfaces:
//   1. the recorded geometry is replayed as arithmetic, so the overlap can be reasoned about
//      without a browser and the numbers can never be quietly rounded away;
//   2. the CLOSED card is held to a fixed block sequence and a word budget, measured on the real
//      shipping copy of a real catalog rec — and every relocated safety/decision item is asserted
//      ABSENT when closed and PRESENT after one labelled click, so shrinking the card by DELETING
//      safety information fails just as loudly as not shrinking it at all;
//   3. the stylesheet is read as text: no class that carries safety, decision or interpretable
//      meaning may resolve to `--ix-text-3` or wear the tiny-uppercase eyebrow treatment.

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));
vi.mock("../rig/RigViewer", () => ({ RigViewer: () => <div data-testid="rig-hologram" /> }));

class IOStub {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
vi.stubGlobal("IntersectionObserver", IOStub);

const { LabDeck } = await import("../lab/LabDeck");
const { ConfirmProvider } = await import("../../design/ConfirmDialog");

afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("compy_motion", "reduced");
});

// ── the recorded scene ──────────────────────────────────────────────────────────────────────────
// Measured on the installed `af5bc2e` candidate over CDP: window 1280×720 (viewport 1264×711),
// `compy_lab_deck` on, `compy_expert_view` off, `.v2-content.scrollTop === 0`, real rig data.
const VIEWPORT_H = 711; // 1280×720 outer, the smallest display the owner reviews at
const MOVE_TOP = 285; // .ld-move, arrival, nothing scrolled
const MOVE_H_BEFORE = 678; // …so its bottom edge sat at 963, a quarter-screen past the fold
const FACTS_TOP = 625; // .ld-move-facts — the trade-off column
const FACTS_BOTTOM = 756;
const READOUT_TOP = 690; // .hud-frame-readout, fixed to the window, transparent
const READOUT_BOTTOM = 704;

// ── the fixture ─────────────────────────────────────────────────────────────────────────────────
// VERBATIM shipping copy from src-tauri/src/recommendations.rs (the `power-ultimate` entry). The
// budget has to be measured against the density that actually caused the defect, not against a
// convenient one-line stub — a short fixture would pass a card that overflows on the real catalog.
const REAL_DESCRIPTION =
  "Windows ships with a hidden 'Ultimate Performance' power plan that keeps your CPU at peak " +
  "responsiveness instead of letting it nap between workloads. Better for gaming. The honest " +
  "tradeoff: this permanently switches your daily power profile, so the higher power draw is in " +
  "effect even when you're not gaming. A future Compy release will offer a Gaming Mode that " +
  "automatically switches to high-performance only while a game is running, so your daily profile " +
  "stays alone — this rec is the manual interim option.";
const REAL_IMPACT = "Lower input latency · steadier frame times (when gaming)";
const REAL_DOWNSIDE =
  "Permanently mutates your daily power profile until you roll back. Higher idle power draw " +
  "(~5–10 W on most desktops). A smarter game-aware switch is planned.";

const rec = (over: Record<string, unknown> = {}) =>
  ({
    id: "power-ultimate",
    title: "Switch to the Ultimate Performance power plan",
    category: "Power",
    severity: "moderate",
    description: REAL_DESCRIPTION,
    impact: REAL_IMPACT,
    downside: REAL_DOWNSIDE,
    applies_to: "Currently on 'Balanced'",
    currently_applied: false,
    provenance: "measured-signal",
    eligible: true,
    ...over,
  }) as never;

const renderDeck = (opts: { isAppliable?: (id: string) => boolean; recs?: never[] } = {}) => {
  const fast = {
    recs: opts.recs ?? [rec()],
    startup: [],
    changes: [],
    busyId: null,
    isAppliable: opts.isAppliable ?? (() => true),
    activeChangeFor: () => undefined,
    onToggleRec: () => {},
    onToggleStartup: () => {},
    onRollback: () => {},
    onApplyBatch: async () => ({ applied: 0, skipped: [] }),
    onOpenLibrary: () => {},
    onChanged: () => {},
    sessions: [],
    gpus: [],
    vendor: "amd",
  } as never;
  return render(
    <ConfirmProvider>
      <LabDeck
        fast={fast}
        diagnostics={<div data-testid="diag" />}
        diagnosticsCaptured
        priorities={null}
        activeCount={0}
      />
    </ConfirmProvider>,
  ).container;
};

// What a person actually READS: aria-hidden nodes (the separator dot, the chevron) are chrome for
// the eye, not words for the reader, so they don't spend budget.
const visibleWords = (el: Element | null) => {
  if (!el) return 0;
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
  return (clone.textContent ?? "").trim().split(/\s+/).filter(Boolean).length;
};

const moveCard = (c: HTMLElement) => c.querySelector<HTMLElement>(".ld-move");
const more = (c: HTMLElement) => c.querySelector<HTMLButtonElement>(".ld-more");

describe("P4 — the glance layer fits the smallest screen the owner reviews at", () => {
  it("replays the recorded overlap: the old card ran off the bottom of the screen it arrived on", () => {
    // Not a tautology — these constants ARE the evidence. Stamped here so the defect stays
    // reasoned-about in CI: a "glance" that needs scrolling is not a glance.
    expect(MOVE_TOP + MOVE_H_BEFORE).toBeGreaterThan(VIEWPORT_H);
    // …and the block it pushed under the fixed readout was the trade-off column specifically.
    expect(FACTS_TOP).toBeLessThan(READOUT_BOTTOM);
    expect(FACTS_BOTTOM).toBeGreaterThan(READOUT_TOP);
  });

  it("the closed card renders exactly the glance sequence: name, reading, decision, then quiet metadata", () => {
    const c = renderDeck();
    const card = moveCard(c)!;
    const seq = Array.from(card.children).map((n) => n.className);
    expect(seq).toEqual([
      "ld-move-head", // the NAME of the move — the one thing read first
      "ld-move-why", // one real measured/status line, quoted never composed
      "ld-move-actions", // the decision, ABOVE the metadata that describes it
      "ld-move-meta", // goal + real technical name, quiet, for the user who wants it
      "ld-more", // the proof-on-demand door
      "ld-move-remaining", // where the rest of the stack lives
    ]);
    // The heading is the first thing in the card, so the accessible reading order and the visual
    // reading order are the same one.
    expect(card.firstElementChild!.tagName).toBe("H3");
  });

  it("holds a word budget on the real catalog copy that caused the defect", () => {
    const c = renderDeck();
    const closed = visibleWords(moveCard(c));
    // 282 words on arrival is what the panel saw. The budget is set with headroom for longer
    // titles and translations, but far below the cost of re-inlining the description (90 words on
    // its own) or the fact list — either regression trips this.
    expect(closed).toBeLessThanOrEqual(95);

    fireEvent.click(more(c)!);
    const opened = visibleWords(moveCard(c));
    // …and the substance is genuinely still there. If someone "fixes" the budget by deleting the
    // explanation instead of deferring it, the open card collapses and this fails.
    expect(opened).toBeGreaterThan(closed + 120);
  });
});

describe("P4 — deferred, never deleted: every safety and decision fact is one click away", () => {
  // Each entry is something the user needs in order to DECIDE. None of it may be visible before
  // they ask, and none of it may be missing after they do.
  const deferred: Array<[string, (card: HTMLElement) => boolean]> = [
    ["the full catalog explanation", (card) => card.textContent!.includes("hidden 'Ultimate")],
    ["what the change does", (card) => card.textContent!.includes(REAL_IMPACT)],
    ["the trade-off", (card) => card.textContent!.includes("Higher idle power draw")],
    ["the current state reading", (card) => card.textContent!.includes("Currently on 'Balanced'")],
    ["the three-fact list itself", (card) => !!card.querySelector(".ld-move-facts")],
    ["the rollback promise", (card) => !!card.querySelector(".ld-move-safe")],
  ];

  it.each(deferred)("%s is hidden at a glance and present once asked for", (_label, present) => {
    const c = renderDeck();
    const card = moveCard(c)!;
    expect(present(card)).toBe(false);
    fireEvent.click(more(c)!);
    expect(present(moveCard(c)!)).toBe(true);
  });

  it("the can't-apply warning follows the same rule instead of vanishing", () => {
    const c = renderDeck({ isAppliable: () => false });
    expect(moveCard(c)!.querySelector(".ld-move-note")).toBeNull();
    fireEvent.click(more(c)!);
    expect(moveCard(c)!.querySelector(".ld-move-note")!.textContent).toContain(
      "won't set this one for you",
    );
  });

  it("the door NAMES what is behind it — a disclosure is not a place to hide a caveat", () => {
    const c = renderDeck();
    const btn = more(c)!;
    const label = btn.textContent!.toLowerCase();
    expect(label).toContain("changes");
    expect(label).toContain("trade-off");
    expect(label).toContain("undo");
    // Wired for a screen reader, and honest about its own state.
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(btn.getAttribute("aria-controls")).toBe("ld-move-detail");
    fireEvent.click(btn);
    expect(more(c)!.getAttribute("aria-expanded")).toBe("true");
    expect(c.querySelector("#ld-move-detail")).not.toBeNull();
  });

  it("shares the deck's single open slot — opening the detail closes whatever else was open", () => {
    const c = renderDeck();
    const row = c.querySelector<HTMLButtonElement>('[aria-controls="ld-prove-benchmark-body"]');
    expect(row).not.toBeNull();
    fireEvent.click(row!);
    expect(row!.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(more(c)!);
    expect(c.querySelector('[aria-controls="ld-prove-benchmark-body"]')!.getAttribute("aria-expanded")).toBe(
      "false",
    );
  });
});

// ── the stylesheet, read as text ────────────────────────────────────────────────────────────────
// Innermost rules only: an @media wrapper's body contains braces, so it never matches, while the
// rules nested inside it do. That is exactly the granularity these assertions need.
const parseCss = (file: string) => {
  const css = readFileSync(join("src", "surfaces", "lab", file), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );
  return Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g)).map((m) => ({
    selectors: m[1].split(",").map((s) => s.trim()),
    body: m[2],
  }));
};
const rules = parseCss("LabDeck.css");
const rulesTouching = (sel: string) =>
  rules.filter((r) => r.selectors.some((s) => s === sel || s.startsWith(`${sel}[`)));

describe("P3 — ink rank follows meaning, not tidiness", () => {
  // `--ix-text-3` is for genuinely optional metadata. Not for instructions, not for safety
  // statements, not for a reading the user has to interpret, not for a decision.
  const mustCarryMeaning = [
    ".ld-move-why", // the one measured/status line
    ".ld-move-line", // explanation and the do-nothing choice
    ".ld-move-meta", // goal + the real technical name
    ".ld-move-safe", // the rollback promise
    ".ld-move-note", // "Compy won't set this one for you"
    ".ld-move-remaining", // what else is waiting
    ".ld-move-fact dt", // the label naming a trade-off
    ".ld-h-line", // the section's orienting line
    ".ld-chip-line", // what the goal filter is doing
    ".ld-row-sub", // what an instrument is for
    ".ld-unavailable", // why an instrument can't run on THIS rig
  ];

  it.each(mustCarryMeaning)("%s is not styled as optional metadata", (sel) => {
    const hits = rulesTouching(sel);
    // If the class was renamed, the guard must fail rather than silently pass on nothing.
    expect(hits.length).toBeGreaterThan(0);
    for (const r of hits) expect(r.body).not.toContain("--ix-text-3");
  });

  // GUARD (bug→guard, consumer panel 2026-07-29 — 4/5 seats, and the owner's own verdict: "too much
  // similarly muted copy"). The guard above only bans the FAINT step. That wasn't enough: the
  // rollback promise, the can't-apply route and the instrument's reading were all legible (the
  // supporting token composites at 5.76:1, over the 4.5:1 floor) and still read as footnotes, because
  // every supporting line on the deck shared one ink and nothing sat above it. This is a hierarchy
  // rule, not a contrast rule: text the user needs in order to DECIDE or to stay SAFE, and the
  // measured reading this room exists to show, are primary ink. Supporting ink is for what's optional.
  const mustBePrimaryInk = [
    ".ld-move-safe", // the rollback promise — safety
    ".ld-move-note", // the can't-apply route, which is now the ONLY undo route stated — safety
    ".ld-row-reading", // the reading itself — the evidence the Lab is built to show
    ".ld-move-choice", // "skip it and nothing changes" — the other half of the decision
  ];

  it.each(mustBePrimaryInk)("%s is primary ink, not one more muted supporting line", (sel) => {
    const hits = rulesTouching(sel);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((r) => r.body.includes("--ix-text-1"))).toBe(true);
    // …and no later rule quietly demotes it back onto the shared supporting step.
    for (const r of hits) expect(r.body).not.toContain("--ix-text-2");
  });

  it("the demotion is deliberate: what's genuinely optional still reads as supporting", () => {
    // If EVERYTHING became primary there would be no hierarchy either — the count of recommendations
    // still waiting is optional metadata and must stay a step down.
    const hits = rulesTouching(".ld-move-remaining");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((r) => r.body.includes("--ix-text-2"))).toBe(true);
    for (const r of hits) expect(r.body).not.toContain("--ix-text-1");
  });

  // GUARD (bug→guard, consumer panel G4, 2026-07-29 — 2/5 seats, both filing it as their TOP FIX).
  // The expanded panel used to be five paragraphs in one voice, so the two calming lines drowned in
  // the catalog's jargon. The fix promotes the decision lines and leaves the catalog paragraph a step
  // down — a three-token hierarchy that only works while BOTH halves hold. These two guards pin the
  // half that has no visible symptom when it breaks: the paragraph must NOT be promoted with them.
  it("the catalog paragraph stays a step down — it declares no ink of its own", () => {
    const hits = rulesTouching(".ld-move-prose");
    expect(hits.length).toBeGreaterThan(0);
    // It inherits the supporting step from `.ld-move-line`. Declaring any colour here — even the
    // "right" one — pins the paragraph to a literal and silently breaks the moment the shared
    // supporting token moves. Absence of the declaration IS the mechanism.
    for (const r of hits) expect(r.body).not.toMatch(/(^|[;{\s])color\s*:/);
  });

  it("and the promotion still wins the cascade: the shared rule comes first, the promotion later", () => {
    // `.ld-move-line` and `.ld-move-choice` are the same specificity (one class each) and the element
    // carries both, so source order alone decides which colour lands. Move `.ld-move-line` below the
    // promotion — a plausible tidy-up, alphabetising, or a merge — and the decision line reverts to
    // supporting ink with green tests and no visual error anywhere in the build.
    const idx = (sel: string) =>
      rules.findIndex((r) => r.selectors.some((s) => s === sel) && /color\s*:/.test(r.body));
    const shared = idx(".ld-move-line");
    const promoted = idx(".ld-move-choice");
    expect(shared).toBeGreaterThanOrEqual(0);
    expect(promoted).toBeGreaterThanOrEqual(0);
    expect(promoted).toBeGreaterThan(shared);
  });

  it("an absent reading stays legible — italic says 'not a value yet', dimming just hides it", () => {
    const hits = rulesTouching('.ld-row-reading[data-measured="no"]');
    expect(hits.length).toBeGreaterThan(0);
    for (const r of hits) {
      expect(r.body).not.toContain("--ix-text-3");
      expect(r.body).not.toMatch(/\bopacity\s*:/);
    }
  });

  it("nothing in the move card wears the tiny-uppercase eyebrow treatment", () => {
    const eyebrows = rules.filter(
      (r) =>
        /text-transform:\s*uppercase/.test(r.body) &&
        r.selectors.some((s) => s.includes(".ld-move") || s.includes(".ld-h")),
    );
    expect(eyebrows.map((r) => r.selectors.join(", "))).toEqual([]);
  });
});

// ── P8: the one measured gauge in Optimize ──────────────────────────────────────────────────────
// BUG → GUARD (consumer panel P8, 2026-07-29)
//
// THE DEFECT  The ring reads "8/9" and nothing at normal weight said what it counted. Its name —
// "Your safe stack" — was set as a 10.5px mono uppercase 0.12em-tracked kicker at `--ix-text-3`,
// and the "/9" denominator was faint too. Four panel personas read the ring as a score.
//
// THE GUARD  A number the user has to interpret, and the words that name it, may not live on the
// optional-metadata step; and the name may not go back to wearing the eyebrow costume.
describe("P8 — the ring's number is nameable in plain type", () => {
  const opt = parseCss("OptimizeStation.css");
  const touching = (sel: string) => opt.filter((r) => r.selectors.includes(sel));

  it.each([".lab-gauge-caption-name", ".lab-gauge-den", ".lab-gauge-caption"])(
    "%s carries the reading's meaning, so it is not styled as optional metadata",
    (sel) => {
      const hits = touching(sel);
      expect(hits.length).toBeGreaterThan(0);
      for (const r of hits) expect(r.body).not.toContain("--ix-text-3");
    },
  );

  it("the name is a label, not a kicker — no mono, no uppercase, no tracking", () => {
    const [name] = touching(".lab-gauge-caption-name");
    expect(name.body).not.toMatch(/text-transform\s*:\s*uppercase/);
    expect(name.body).not.toMatch(/letter-spacing\s*:/);
    expect(name.body).not.toMatch(/font-mono|monospace/);
    // …and it is distinguishable from the sentence beneath it by weight, not by costume.
    expect(name.body).toMatch(/font-weight\s*:\s*(600|700|bold)/);
  });

  it("nothing in the gauge block wears the eyebrow treatment at all", () => {
    const eyebrows = opt.filter(
      (r) =>
        /text-transform:\s*uppercase/.test(r.body) &&
        r.selectors.some((s) => s.includes(".lab-gauge")),
    );
    expect(eyebrows.map((r) => r.selectors.join(", "))).toEqual([]);
  });
});

describe("the new disclosure honours reduced motion both ways", () => {
  const stilled = rules.filter((r) => /transition:\s*none/.test(r.body));
  const selectors = stilled.flatMap((r) => r.selectors);

  it.each([".ld-more", ".ld-more-chev"])("%s is stilled by the flag AND by the OS setting", (sel) => {
    expect(selectors).toContain(`.lab-deck[data-motion="reduced"] ${sel}`);
    expect(selectors).toContain(sel);
  });
});
