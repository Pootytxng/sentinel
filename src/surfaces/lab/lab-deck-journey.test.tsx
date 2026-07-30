import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";

// JOURNEY TESTS for the decision-journey Lab candidate (product-recovery train, 2026-07-28).
//
// These are the owner's validation list read literally, at the destination the deck owns:
//
//   5  the exact recommendation is highlighted at the destination
//   7  a stale or already-applied recommendation is handled honestly
//   9  Ignore / "Not for me" remains available
//   11 a rig with no justified action receives an honest, useful state
//   12 goal groups render only when supported recommendations exist
//   13 a relevant recommendation reaches a real proof tool WHERE a structured mapping exists
//   14 diagnostics is reachable through a user-problem route
//   15 room orientation is understandable (one nav grammar, and it says where you are)
//   17 long copy + realistic recommendation density don't collapse the structure
//   18 reduced motion works
//   20 screen-reader naming and hierarchy are sensible
//
// (4/6/10/21 are proven upstream by check-handoff / doorknob / cursor guards; 16 and 19 need the
// installed build and belong to the owner-review pass — jsdom has no layout and no focus ring.)
//
// The deck is rendered DIRECTLY here rather than through LabGround: lab-deck-flag.test.tsx already
// pins the room-level swap (flag off = today's Lab byte-identical, flag on = deck instead of dock),
// so these tests can stay about the journey itself. Nothing below reaches for a mutation — the deck
// adds no apply path of its own and these assertions must never be the thing that proves one.

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
const { writeHandoff } = await import("../../data/check-handoff");

afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("compy_motion", "reduced");
});

// Catalog-real ids, so the goal map under test is the one that ships (lab-deck-data.ts pins the
// full catalog separately). A fabricated id would only prove the category fallback.
const rec = (over: Record<string, unknown> = {}) =>
  ({
    id: "power-ultimate",
    title: "Ultimate Performance power plan",
    category: "Power",
    severity: "safe",
    description: "Windows' hidden power plan, which stops the CPU idling between frames.",
    impact: "Switches the active power plan.",
    downside: null,
    applies_to: "Currently Balanced",
    currently_applied: false,
    provenance: "verified",
    eligible: true,
    ...over,
  }) as never;

const FPS_REC = rec({
  id: "gpu-prefer-discrete",
  title: "Prefer the discrete GPU",
  category: "GPU",
  applies_to: "Currently auto",
});
const CLEANUP_REC = rec({
  id: "reserved-storage-off",
  title: "Turn off reserved storage",
  category: "Storage",
  applies_to: "Currently on",
});

type DeckOpts = {
  recs?: never[] | null;
  diagnostics?: boolean;
  activeCount?: number;
  isAppliable?: (id: string) => boolean;
};

const renderDeck = (opts: DeckOpts = {}) => {
  const fast = {
    recs: opts.recs === undefined ? [rec()] : opts.recs,
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
        diagnostics={opts.diagnostics === false ? undefined : <div data-testid="diag" />}
        diagnosticsCaptured={opts.diagnostics !== false}
        priorities={null}
        activeCount={opts.activeCount ?? 0}
      />
    </ConfirmProvider>,
  ).container;
};

const text = (el: Element | null) => el?.textContent ?? "";

// A deck row is addressed here the way a screen reader addresses it: the head button owns the body
// through aria-controls. Selecting by that pins the accessible wiring at the same time as the
// behaviour — if a row ever loses aria-controls these tests fail loudly instead of quietly testing
// a div.
const door = (c: HTMLElement, id: string) =>
  c.querySelector<HTMLButtonElement>(`[aria-controls="${id}-body"]`);

describe("item 5 + 7 — the check's findings arrive with their identity intact", () => {
  it("the exact carried recommendation is named and led with at the destination", () => {
    writeHandoff({ station: "optimize", rec_ids: ["power-ultimate"], source: "check" });
    const c = renderDeck({ recs: [rec(), FPS_REC] });

    const banner = c.querySelector(".lab-carried");
    expect(banner).not.toBeNull();
    expect(banner!.getAttribute("role")).toBe("status");
    // Named, not counted — the whole point of recovery item 2.
    const items = Array.from(c.querySelectorAll(".lab-carried-item")).map((n) => text(n));
    expect(items.some((s) => s.includes("Ultimate Performance power plan"))).toBe(true);
    expect(items.some((s) => s.includes("Prefer the discrete GPU"))).toBe(false);
    // And the row itself is marked, so the list and the banner agree about which one it is.
    const marked = Array.from(c.querySelectorAll(".slimrow-carried, .fix-row-carried"));
    expect(marked.length).toBe(1);
    expect(text(marked[0])).toContain("Ultimate Performance power plan");
    expect(text(marked[0])).toContain("From your check");
  });

  it("a carried rec applied before arrival is stated as done, not re-offered", () => {
    writeHandoff({ station: "optimize", rec_ids: ["power-ultimate"], source: "check" });
    const c = renderDeck({ recs: [rec({ currently_applied: true })] });
    const head = text(c.querySelector(".lab-carried-head"));
    expect(head.length).toBeGreaterThan(0);
    expect(c.querySelector(".lab-carried-item")).toBeNull();
  });

  it("a carried rec that vanished from the catalog says so instead of pretending", () => {
    writeHandoff({ station: "optimize", rec_ids: ["a-rec-that-no-longer-exists"], source: "check" });
    const c = renderDeck({ recs: [rec()] });
    // Still an honest arrival note; no invented row, no silent drop.
    expect(c.querySelector(".lab-carried")).not.toBeNull();
    expect(c.querySelector(".lab-carried-item")).toBeNull();
  });

  it("no handoff → an ordinary visit: no arrival banner at all", () => {
    const c = renderDeck();
    expect(c.querySelector(".lab-carried")).toBeNull();
  });
});

describe("item 11 — a rig with nothing worth changing gets a result, not an empty page", () => {
  it("no recommendations at all: the honest 'nothing to change' state, with a way forward", () => {
    const c = renderDeck({ recs: [] });
    const move = c.querySelector(".ld-move");
    expect(move).not.toBeNull();
    expect(text(c.querySelector(".ld-move-head"))).toBe("Nothing worth changing on this rig");
    // A useful state means an onward door, not a dead end.
    expect(text(c.querySelector(".ld-move-actions .ld-btn"))).toBe("Measure how it runs anyway");
    // And it never manufactures urgency by inventing a move.
    expect(c.querySelector(".ld-move-facts")).toBeNull();
  });

  it("everything already applied: the all-clear names the count and offers proof", () => {
    const c = renderDeck({ recs: [rec({ currently_applied: true })], activeCount: 1 });
    expect(text(c.querySelector(".ld-move-head"))).toBe("Your safe stack is set");
    expect(text(c.querySelector(".ld-move-line"))).toContain("1 change is applied");
    expect(text(c.querySelector(".ld-move-actions .ld-btn"))).toBe("Measure what they did");
  });

  it("catalog not read yet (null): it says so rather than showing a confident empty room", () => {
    const c = renderDeck({ recs: null });
    expect(text(c.querySelector(".ld-move-head"))).toBe("Compy hasn't read this rig yet");
  });
});

describe("item 9 — the decline stays available on the headline move", () => {
  it("'Not for me' sits beside the apply action, not buried", () => {
    const c = renderDeck();
    const actions = Array.from(c.querySelectorAll(".ld-move-actions .ld-btn")).map((b) => text(b));
    expect(actions).toContain("Not for me");
    expect(actions).toContain("Apply this");
  });

  it("a rec Compy cannot set offers the real steps instead of a button that can't deliver", () => {
    const c = renderDeck({ isAppliable: () => false });
    const actions = Array.from(c.querySelectorAll(".ld-move-actions .ld-btn")).map((b) => text(b));
    expect(actions).toContain("Show me how");
    expect(actions).not.toContain("Apply this");
    // The "Compy won't set this one for you" note moved into the proof layer with the rest of the
    // detail (glance-first, 2026-07-29) — it is one labelled interaction away, never deleted.
    fireEvent.click(c.querySelector<HTMLButtonElement>(".ld-more")!);
    expect(text(c.querySelector(".ld-move-note"))).toContain("won't set this one for you");
  });

  // GUARD (bug→guard, consumer panel 2026-07-29 — 5/5 seats). This assertion is the INVERSE of the
  // one it replaces. The old rule withheld the accent fill from every state where the choice was the
  // user's, on the reasoning that a solid CTA shouldn't push a change Compy can't undo. Sound as far
  // as it went — but it left the can't-apply state rendering three identically-weighted buttons, and
  // every consumer seat independently reported choosing between three options instead of following
  // one path. The owner's law settles it: "secondary actions must not compete with the primary."
  // The accent still never argues for an unsafe apply — in that state it moves to "Show me how",
  // which only navigates. What is guarded is the COUNT: exactly one primary, in every state.
  it("every state offers exactly one accented action — never three of equal weight", () => {
    const cantSet = renderDeck({ isAppliable: () => false });
    expect(cantSet.querySelectorAll(".ld-move-actions .ld-btn-primary").length).toBe(1);
    // …and it is the navigating action, not an apply Compy cannot perform.
    expect(text(cantSet.querySelector(".ld-move-actions .ld-btn-primary"))).toBe("Show me how");
    // The alternatives are still there, still reachable, just no longer competing.
    const cantSetActions = Array.from(cantSet.querySelectorAll(".ld-move-actions .ld-btn")).map((b) =>
      text(b),
    );
    expect(cantSetActions).toContain("Not for me");
    cleanup();

    // …and it IS still spent on the ordinary reversible apply, or the accent would mean nothing.
    const safe = renderDeck();
    expect(safe.querySelectorAll(".ld-move-actions .ld-btn-primary").length).toBe(1);
    expect(text(safe.querySelector(".ld-move-actions .ld-btn-primary"))).toBe("Apply this");
  });

  // GUARD (bug→guard, consumer panel 2026-07-29 — 4/5 seats, Burned Skeptic's top fix). Compy may
  // only promise rollback for changes Compy itself makes. These two strings used to render together
  // on every non-appliable rec: "Compy records how to put this back" immediately above "Compy won't
  // set this one for you" — a promise-shaped sentence on top of a feature that structurally cannot
  // exist for that item. They must be mutually exclusive, and the honest branch must still tell the
  // user how to reverse it by hand (safety information may be moved, never deleted).
  it("never promises Compy-recorded rollback for a rec Compy does not apply", () => {
    const cantSet = renderDeck({ isAppliable: () => false });
    fireEvent.click(cantSet.querySelector<HTMLButtonElement>(".ld-more")!);
    const detail = text(cantSet.querySelector(".ld-move-detail"));
    expect(detail).not.toContain("Compy records how to put this back");
    expect(cantSet.querySelector(".ld-move-safe")).toBeNull();
    // The undo route survives the removal, in words the user can act on.
    expect(text(cantSet.querySelector(".ld-move-note"))).toContain("nothing for Compy to put back");
    expect(text(cantSet.querySelector(".ld-move-note"))).toContain("turns it off again");
    cleanup();

    // …and the promise IS still made where Compy really does capture the rollback contract.
    const appliable = renderDeck();
    fireEvent.click(appliable.querySelector<HTMLButtonElement>(".ld-more")!);
    expect(text(appliable.querySelector(".ld-move-safe"))).toContain("put this back");
    expect(appliable.querySelector(".ld-move-note")).toBeNull();
  });

  // GUARD (bug→guard, consumer panel 2026-07-29 — 4/5 seats). Opening the detail used to lead with
  // the catalog's prose paragraph, and on a long-description rec several seats stopped reading before
  // they reached the trade-off underneath. The fix was ORDER, not deletion: the three labelled facts
  // (what it is now, what changes, the downside) answer the decision, so they come first; the prose
  // is the background behind them. This guard pins both halves — facts before prose, and every word
  // still present — because "reduce the text" is exactly how safety information gets quietly cut.
  it("the opened detail leads with the labelled facts, and still contains every word", () => {
    const c = renderDeck({ recs: [rec({ downside: "Slightly higher idle power draw." })] });
    fireEvent.click(c.querySelector<HTMLButtonElement>(".ld-more")!);
    const detail = c.querySelector(".ld-move-detail")!;
    const facts = detail.querySelector(".ld-move-facts")!;
    const prose = Array.from(detail.querySelectorAll(".ld-move-line")).find((p) =>
      text(p).includes("stops the CPU idling"),
    )!;
    expect(facts).not.toBeNull();
    expect(prose).not.toBeUndefined();
    // Bitwise, because that is the only order assertion that survives a wrapper being added.
    expect(facts.compareDocumentPosition(prose) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Nothing was traded for the reorder: the labelled trio, the prose, the reversibility promise
    // and the do-nothing line are all still rendered.
    expect(detail.querySelectorAll(".ld-move-fact dt").length).toBe(3);
    expect(text(detail)).toContain("Slightly higher idle power draw.");
    expect(text(detail)).toContain("stops the CPU idling");
    expect(text(detail)).toContain("put this back");
    expect(text(detail)).toContain("Skip it and nothing changes");
  });

  // GUARD (bug→guard, consumer panel 2026-07-29 — 2/5 seats, and both of them named it their TOP fix).
  // Ordering the facts first was right and still not enough. On the VBS rec the labelled trio is
  // dense security jargon ("Hypervisor-protected code integrity", "DMA attacks",
  // "vulnerable-signed-driver exploits"), and the two lines that actually calm a non-technical reader —
  // Compy can put this back, and you may simply decline — sat UNDERNEATH a 90-word catalog paragraph
  // written for someone else. Both seats stopped reading at the jargon. So the reassurance now follows
  // the facts immediately and the prose goes last: reassurance before the jargon's explanation, never
  // after it. Pure reorder — nothing here may be removed to achieve it, which is why every element is
  // also asserted PRESENT.
  it("the reassurance and the decline reach the reader before the catalog's prose", () => {
    const c = renderDeck();
    fireEvent.click(c.querySelector<HTMLButtonElement>(".ld-more")!);
    const detail = c.querySelector("#ld-move-detail")!;
    const prose = detail.querySelector(".ld-move-prose")!;
    const choice = detail.querySelector(".ld-move-choice")!;
    const safe = detail.querySelector(".ld-move-safe")!;
    expect(prose).not.toBeNull();
    expect(choice).not.toBeNull();
    expect(safe).not.toBeNull();
    const precedes = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(precedes(safe, prose)).toBe(true);
    expect(precedes(choice, prose)).toBe(true);
    // …and the reversibility promise still comes before the choice to walk away from it, so the
    // reader learns it is undoable before being offered the exit.
    expect(precedes(safe, choice)).toBe(true);

    // The same holds on the branch where Compy CANNOT apply the rec: there the note is the only undo
    // route stated at all, so burying it under the prose would be the worse version of this defect.
    cleanup();
    const cantSet = renderDeck({ isAppliable: () => false });
    fireEvent.click(cantSet.querySelector<HTMLButtonElement>(".ld-more")!);
    const d2 = cantSet.querySelector("#ld-move-detail")!;
    expect(precedes(d2.querySelector(".ld-move-note")!, d2.querySelector(".ld-move-prose")!)).toBe(
      true,
    );
  });
});

describe("item 12 — goal groups exist only where this rig really has recommendations", () => {
  it("one group → no filter at all (a filter with one option is noise, not navigation)", () => {
    const c = renderDeck({ recs: [rec()] });
    expect(c.querySelector(".ld-chips")).toBeNull();
  });

  it("three real groups → exactly those three chips, counted, in journey order", () => {
    const c = renderDeck({ recs: [rec(), FPS_REC, CLEANUP_REC] });
    const chips = Array.from(c.querySelectorAll(".ld-chip")).map((b) => text(b));
    expect(chips).toEqual(["All", "More FPS1", "Lower latency1", "Cleanup & recovery1"]);
    // The groups this rig has nothing in are absent — never an empty shelf.
    expect(chips.some((s) => s.startsWith("Stability"))).toBe(false);
    expect(chips.some((s) => s.startsWith("Image quality"))).toBe(false);
  });

  it("picking a group scopes the ONE audited list and explains what the group means", () => {
    const c = renderDeck({ recs: [rec(), FPS_REC, CLEANUP_REC] });
    const fpsChip = Array.from(c.querySelectorAll<HTMLButtonElement>(".ld-chip")).find((b) =>
      text(b).startsWith("More FPS"),
    )!;
    fireEvent.click(fpsChip);
    expect(fpsChip.getAttribute("aria-pressed")).toBe("true");
    expect(text(c.querySelector(".ld-chip-line"))).toBe(
      "Frees the graphics card to draw more frames.",
    );
    // Still ONE list — filtering must never split the room into a list per group.
    expect(c.querySelectorAll(".ld-chips").length).toBe(1);
  });
});

describe("item 13 — proof doors exist only where a structured mapping really does", () => {
  it("a latency rec offers the proof tool that can actually see the change", () => {
    const c = renderDeck({ recs: [rec()] });
    const actions = Array.from(c.querySelectorAll(".ld-move-actions .ld-btn")).map((b) => text(b));
    expect(actions).toContain("How you'd prove it");
  });

  it("a cleanup rec offers NO proof door (no instrument here measures disk space)", () => {
    const c = renderDeck({ recs: [CLEANUP_REC] });
    const actions = Array.from(c.querySelectorAll(".ld-move-actions .ld-btn")).map((b) => text(b));
    expect(actions).not.toContain("How you'd prove it");
    // The move card is still complete — the missing door is honesty, not a broken card.
    expect(text(c.querySelector(".ld-move-head"))).toBe("Turn off reserved storage");
  });

  it("the proof door opens the instrument in place and moves the user to it", () => {
    const c = renderDeck({ recs: [rec()] });
    const prove = Array.from(c.querySelectorAll<HTMLButtonElement>(".ld-move-actions .ld-btn")).find(
      (b) => text(b) === "How you'd prove it",
    )!;
    fireEvent.click(prove);
    expect(door(c, "ld-prove-latency")!.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(c.querySelector("#ld-prove"));
  });

  // bug→guard (self-review round 7, 2026-07-29): the test above is the ONLY proof-door journey
  // there used to be, and it fixtures a latency goal — whose instrument happens to live in the
  // "prove" section. So it never noticed that the click handler hardcoded that section for EVERY
  // goal. A stability rec's proof is the Black Box, which lives under Advanced: the jump scrolled
  // to the wrong section and expanded nothing at all — a labelled button that visibly did nothing.
  // Compounding it, Advanced is a native <details> that was uncontrolled, so even the right host
  // would have landed the user on a collapsed summary. Pin the goal whose proof lives OUTSIDE
  // "prove"; that is the whole class of bug this door can have.
  it("a proof door whose instrument lives outside section 3 still lands ON the instrument", () => {
    const c = renderDeck({ recs: [rec({ id: "fast-startup-off" })] });
    const prove = Array.from(c.querySelectorAll<HTMLButtonElement>(".ld-move-actions .ld-btn")).find(
      (b) => text(b) === "How you'd prove it",
    )!;
    fireEvent.click(prove);
    // Opened, in the section it really lives in — and the disclosure hiding it was opened too,
    // so the row is on screen rather than sealed behind a summary the user never clicked.
    expect(door(c, "ld-advanced-blackbox")!.getAttribute("aria-expanded")).toBe("true");
    expect(c.querySelector<HTMLDetailsElement>("details.ld-advanced")!.open).toBe(true);
    expect(document.activeElement).toBe(c.querySelector("#ld-advanced"));
    // Still exactly one instrument live app-wide — a jump is a move, not a second copy.
    expect(c.querySelectorAll(".ld-row-body").length).toBe(1);
  });

  it("Advanced stays the user's disclosure — it is not forced open on arrival", () => {
    const c = renderDeck({ recs: [rec({ id: "fast-startup-off" })] });
    expect(c.querySelector<HTMLDetailsElement>("details.ld-advanced")!.open).toBe(false);
  });
});

describe("item 14 — diagnostics is reachable by saying what's wrong, not by knowing the tool", () => {
  it("the symptom rows are named in the user's words and open the instrument in place", () => {
    const c = renderDeck();
    const head = door(c, "ld-problem-changed")!;
    expect(text(head.querySelector(".ld-row-name"))).toBe("Something changed and I don't know what");
    expect(c.querySelector("[data-testid='diag']")).toBeNull();
    fireEvent.click(head);
    expect(c.querySelector("[data-testid='diag']")).not.toBeNull();
    expect(head.getAttribute("aria-expanded")).toBe("true");
  });

  it("no dead ends: a rig without diagnostics drops the row and says why, honestly", () => {
    const c = renderDeck({ diagnostics: false });
    expect(door(c, "ld-problem-changed")).toBeNull();
    const notes = Array.from(c.querySelectorAll(".ld-unavailable")).map((n) => text(n));
    expect(notes.some((s) => s.includes("Raw diagnostics appear once"))).toBe(true);
  });

  it("one instrument is live at a time — opening a second closes the first", () => {
    const c = renderDeck();
    const changed = door(c, "ld-problem-changed")!;
    const delay = door(c, "ld-problem-inputDelay")!;
    fireEvent.click(changed);
    expect(changed.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(delay);
    expect(changed.getAttribute("aria-expanded")).toBe("false");
    expect(delay.getAttribute("aria-expanded")).toBe("true");
  });

  // bug→guard (self-review round 6, 2026-07-29): the test above picked two rows that route to
  // DIFFERENT instruments, so it never touched the real hazard. Two problem rows legitimately share
  // one instrument — "The game hitches or stutters" and "My FPS jumps around" both open Benchmark
  // (PROBLEM_STATION in lab-deck-data.ts) — and the open slot used to key on (station, section),
  // so a single click expanded BOTH rows and mounted the benchmark twice. Pin the rows that share
  // a station specifically; a duplicate instrument is the one thing this slot exists to prevent.
  it("rows that share ONE instrument still open independently — a click never expands two", () => {
    const c = renderDeck();
    const stutter = door(c, "ld-problem-stutter")!;
    const unstable = door(c, "ld-problem-unstableFps")!;
    // Same destination, by design — that is what made the old keying collide.
    expect(stutter).not.toBe(unstable);

    fireEvent.click(stutter);
    expect(stutter.getAttribute("aria-expanded")).toBe("true");
    expect(unstable.getAttribute("aria-expanded")).toBe("false");
    expect(c.querySelectorAll(".ld-row-body").length).toBe(1);

    fireEvent.click(unstable);
    expect(stutter.getAttribute("aria-expanded")).toBe("false");
    expect(unstable.getAttribute("aria-expanded")).toBe("true");
    expect(c.querySelectorAll(".ld-row-body").length).toBe(1);
  });

  // bug→guard (consumer panel P2, 2026-07-29): the same reading was printed in three places at
  // once. The benchmark's line appeared on its own instrument row in "Measure & prove" AND on both
  // symptom rows that open it; the latency line appeared on its row plus "It feels delayed or
  // floaty". A reading belongs to the instrument that took it. A symptom row names the symptom and
  // opens the tool — it does not take readings. The first draft of this fix exempted instruments
  // that live inside collapsed Advanced, which only hid the duplication until the user opened it;
  // the rule is exception-free so it holds at every disclosure state.
  it("a reading appears in exactly one place — on the instrument that took it", () => {
    const c = renderDeck();
    const readings = Array.from(c.querySelectorAll(".ld-row-reading")).map((n) => text(n).trim());
    expect(readings.filter((r, i) => readings.indexOf(r) !== i)).toEqual([]);

    // No symptom row carries one, whether its instrument sits in Prove or inside Advanced.
    // (Selected by aria-controls, not id: `id` only lands on the body, which exists while open —
    // an id-based selector would match nothing here and pass on an empty set.)
    const symptoms = Array.from(c.querySelectorAll('[aria-controls^="ld-problem-"]'));
    expect(symptoms.length).toBeGreaterThan(3);
    for (const p of symptoms) expect(p.querySelector(".ld-row-reading")).toBeNull();
    // Nothing was deleted: every instrument still states its own, and it stays reachable.
    for (const id of ["ld-prove-benchmark", "ld-advanced-diagnostics"]) {
      expect(door(c, id)!.querySelector(".ld-row-reading")).not.toBeNull();
    }
  });
});

describe("item 15 — orientation is in the layout, not in a paragraph of explanation", () => {
  it("ONE nav grammar, and it tells you which step you're on", () => {
    const c = renderDeck();
    const nav = c.querySelector(".ld-nav")!;
    expect(nav.getAttribute("aria-label")).toBe("Lab sections");
    const items = Array.from(nav.querySelectorAll("button"));
    // Exactly one lit pill — "where am I" has one answer, never zero and never two.
    const current = items.filter((b) => b.getAttribute("aria-current") === "true");
    expect(current.length).toBe(1);
    expect(text(current[0])).toBe("Your next best move");
  });

  it("the nav, the rail and the sections are the same five steps in the same order", () => {
    const c = renderDeck();
    const navText = Array.from(c.querySelectorAll(".ld-nav button")).map((b) => text(b));
    const headings = Array.from(c.querySelectorAll(".ld-section > .ld-h")).map((h) => text(h));
    expect(navText).toEqual(headings);
    // One rail node per section, and the rail is decoration to a screen reader — the nav says it
    // in words, so the rail must not repeat it.
    const rails = Array.from(c.querySelectorAll(".ld-rail"));
    expect(rails.length).toBe(5);
    for (const r of rails) {
      expect(r.getAttribute("aria-hidden")).toBe("true");
      expect(r.querySelector(".ld-rail-node")).not.toBeNull();
    }
    const lit = Array.from(c.querySelectorAll(".ld-section[data-here='on']"));
    expect(lit.length).toBe(1);
    expect(lit[0].id).toBe("ld-move");
  });

  it("jumping moves focus, so a keyboard user lands where a mouse user lands", () => {
    const c = renderDeck();
    const proveBtn = Array.from(c.querySelectorAll<HTMLButtonElement>(".ld-nav button")).find(
      (b) => text(b) === "Measure & prove",
    )!;
    fireEvent.click(proveBtn);
    expect(document.activeElement).toBe(c.querySelector("#ld-prove"));
  });
});

describe("item 17 — realistic density and long copy don't collapse the structure", () => {
  const LONG =
    "Turn off the Windows feature that quietly reserves several gigabytes of your system drive " +
    "for updates that may never arrive, and hand that space back to your games library";
  const dense = [
    rec(),
    FPS_REC,
    CLEANUP_REC,
    rec({ id: "hags-enable", title: "Hardware-accelerated GPU scheduling", category: "Windows" }),
    rec({ id: "fast-startup-off", title: LONG, description: LONG, category: "Windows" }),
    rec({ id: "storage-c-low", title: "C: drive is nearly full", category: "Storage" }),
    rec({ id: "sysmain-disable", title: "SysMain is thrashing the disk", category: "Windows" }),
    rec({ id: "monitor-max-refresh", title: "Display is below its max refresh", category: "Display" }),
    rec({ id: "amd-uxp", title: "AMD user experience program", category: "GPU" }),
    rec({ id: "gpu-driver-update", title: "Graphics driver is out of date", category: "GPU" }),
    rec({ id: "reserved-storage-off", title: LONG, description: LONG, category: "Storage" }),
    rec({ id: "ssd-upgrade-advisory", title: "Boot drive is a hard disk", category: "Storage" }),
    rec({ id: "nvidia-telemetry", title: "NVIDIA telemetry is running", category: "GPU" }),
  ] as never[];

  it("thirteen recommendations still produce one focal card, one nav, one filter row", () => {
    const c = renderDeck({ recs: dense });
    expect(c.querySelectorAll(".ld-section").length).toBe(5);
    expect(c.querySelectorAll(".ld-nav").length).toBe(1);
    expect(c.querySelectorAll(".ld-move").length).toBe(1);
    expect(c.querySelectorAll(".ld-chips").length).toBe(1);
  });

  it("no repeated headings at density — five sections, five distinct h2s", () => {
    const c = renderDeck({ recs: dense });
    const h2 = Array.from(c.querySelectorAll("h2")).map((h) => text(h));
    expect(h2).toEqual([
      "Your next best move",
      "Optimize",
      "Measure & prove",
      "Diagnose a problem",
      "Advanced instruments",
    ]);
    expect(new Set(h2).size).toBe(h2.length);
  });

  it("long copy is rendered whole, never silently truncated into a different meaning", () => {
    const c = renderDeck({ recs: [rec({ id: "fast-startup-off", title: LONG, description: LONG })] });
    expect(text(c.querySelector(".ld-move-head"))).toBe(LONG);
  });
});

describe("item 18 — reduced motion is honoured by the face itself", () => {
  it("the pref is mirrored onto the deck, so CSS and JS read one source", () => {
    expect(renderDeck().querySelector(".lab-deck")!.getAttribute("data-motion")).toBe("reduced");
    cleanup();
    localStorage.setItem("compy_motion", "full");
    expect(renderDeck().querySelector(".lab-deck")!.getAttribute("data-motion")).toBe("full");
  });
});

describe("item 20 — screen-reader naming and hierarchy are sensible", () => {
  it("every section is a labelled region whose name is its own visible heading", () => {
    const c = renderDeck();
    for (const s of Array.from(c.querySelectorAll<HTMLElement>(".ld-section"))) {
      const h = c.querySelector(`#${s.getAttribute("aria-labelledby")}`)!;
      expect(h.tagName).toBe("H2");
      expect(text(h).length).toBeGreaterThan(0);
      expect(s.tabIndex).toBe(-1);
    }
  });

  it("heading order descends: the section is h2, the move inside it is h3", () => {
    const c = renderDeck();
    const move = c.querySelector("#ld-move")!;
    expect(move.querySelector("h2")!.textContent).toBe("Your next best move");
    expect(move.querySelector("h3")!.className).toContain("ld-move-head");
  });

  it("every door is a real button that announces its own state", () => {
    const c = renderDeck();
    for (const head of Array.from(c.querySelectorAll(".ld-row-head"))) {
      expect(head.tagName).toBe("BUTTON");
      expect(head.getAttribute("aria-expanded")).toMatch(/^(true|false)$/);
      expect(head.getAttribute("aria-controls")).toBeTruthy();
    }
    // The chevron is drawn state, not information — it must not be read out twice.
    for (const chev of Array.from(c.querySelectorAll(".ld-row-chev"))) {
      expect(chev.getAttribute("aria-hidden")).toBe("true");
    }
  });
});
