import { describe, it, expect, afterEach, beforeAll, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { BlackbookV2 } from "./BlackbookV2";
import Learn from "./Learn";
import { blackbookVerdict as blackbookVerdictRaw } from "./blackbook-v2-data";
import { KNOWLEDGE } from "../data/knowledge";
import { recordAutopsy, type AutopsyLedgerEntry } from "../data/autopsy-ledger";
import { autopsyScan } from "../data/knowledge-autopsy";
// i18n update (2026-07-23): blackbookVerdict's headline/sub now come from t(...) (Simplified
// Chinese translation pass) instead of literal English strings, so it takes a TFunction as its
// last param. This test-local wrapper resolves it through the real i18next instance (English is
// the default language, matching what every assertion below already expects) so every call site
// below stays exactly as written — same text, just sourced from locale JSON instead of a .ts
// literal.
import i18n from "../i18n";

const blackbookVerdict = (ledger: AutopsyLedgerEntry[]) => blackbookVerdictRaw(ledger, i18n.t);

// V2-6 guards (bug→guard tier 1): the V2 Blackbook room composes RoomShell (one verdict, one
// door to Lab, deliberately NO primary action — the P6 spec names Blackbook the room that may
// have none), its verdict is a PURE derivation from the local autopsy ledger (honest no-record
// state; branch-proper copy — never "(s)"), the measured line's corpus count is computed (never
// hardcoded), the one-mention law holds (Learn's standalone head + in-panel record yield to the
// room verdict), and the CLASSIC Learn render stays pinned unchanged (head + record intact).

beforeAll(() => {
  // jsdom lacks the observers the vendored DecryptedText uses; inert stubs, animation never starts.
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  class IO {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  (globalThis as Record<string, unknown>).ResizeObserver ??= RO;
  (globalThis as Record<string, unknown>).IntersectionObserver ??= IO;
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear(); // Learn persists mode + autopsy text per session — isolate tests
});

// This suite pins the CLASSIC room composition — the Instrument HUD is default-ON since the
// 2026-07-06 owner approval, so the classic tree lives behind the "0" failsafe; the HUD
// masthead's own contract is pinned in hud-rooms-flag.test.tsx. Same for the Blackbook console
// (default-ON since the 2026-07-13 owner approval): "0" keeps this suite on the classic
// Learn/RoomShell tree it exists to pin (console contract: blackbook-console*.test.tsx).
beforeEach(() => {
  localStorage.setItem("compy_editorial", "0");
  localStorage.setItem("compy_blackbook_console", "0");
});

const entry = (over: Partial<AutopsyLedgerEntry> = {}): AutopsyLedgerEntry => ({
  at: 1,
  real: 0,
  placebo: 0,
  risky: 0,
  unknown: 0,
  scamFlags: 0,
  ...over,
});

const useReduced = () => localStorage.setItem("compy_motion", "reduced");

function mount() {
  return render(<BlackbookV2 focusId={null} vendor="amd" onClose={() => {}} />);
}

describe("blackbookVerdict — pure, measured, branch-proper copy", () => {
  it("no record → the standing promise, zero invented numbers", () => {
    const v = blackbookVerdict([]);
    expect(v.headline).toBe("Heard a tweak online? Look it up here before you try it.");
    expect(v.sub).toBe(
      "We only answer what's been verified — search the Blackbook, or paste a whole guide and get every claim graded.",
    );
  });

  it("record with graded tweaks → the share in the headline, the raw counts in the sub", () => {
    const v = blackbookVerdict([entry({ real: 2, placebo: 1, risky: 1 })]);
    expect(v.headline).toBe("You've fact-checked 1 guide — 50% of its tweaks were real.");
    expect(v.sub).toBe("Of the tweaks we recognized: 2 real · 1 placebo · 1 risky.");
  });

  it("plural guides read 'their'; scam flags append branch-proper", () => {
    const v = blackbookVerdict([
      entry({ real: 3, scamFlags: 1 }),
      entry({ placebo: 1, scamFlags: 1 }),
    ]);
    expect(v.headline).toBe("You've fact-checked 2 guides — 75% of their tweaks were real.");
    expect(v.sub).toBe(
      "Of the tweaks we recognized: 3 real · 1 placebo · 0 risky · 2 known scam patterns flagged.",
    );
    const one = blackbookVerdict([entry({ real: 1, scamFlags: 1 })]);
    expect(one.sub).toContain("· 1 known scam pattern flagged.");
  });

  it("record with NO graded tweaks → no percentages (0% of nothing would mislead)", () => {
    const scamOnly = blackbookVerdict([entry({ scamFlags: 1 })]);
    expect(scamOnly.headline).toBe("You've fact-checked 1 guide here.");
    expect(scamOnly.sub).toBe("1 known scam pattern flagged so far.");
    const unknownOnly = blackbookVerdict([entry({ unknown: 3 })]);
    expect(unknownOnly.sub).toBe(
      "Its claims weren't tweaks we've verified, so no grades — we never guess.",
    );
    const unknownPlural = blackbookVerdict([entry({ unknown: 1 }), entry({ unknown: 2 })]);
    expect(unknownPlural.sub).toBe(
      "Their claims weren't tweaks we've verified, so no grades — we never guess.",
    );
  });

  it("never '(s)' across every branch", () => {
    const branches = [
      [],
      [entry({ real: 1 })],
      [entry({ scamFlags: 2 })],
      [entry({ unknown: 1 })],
      [entry({ real: 1, scamFlags: 1 }), entry({ risky: 2 })],
    ];
    for (const ledger of branches) {
      const v = blackbookVerdict(ledger);
      expect(`${v.headline} ${v.sub ?? ""}`).not.toContain("(s)");
    }
    expect(KNOWLEDGE.length).toBeGreaterThan(0);
  });
});

describe("BlackbookV2 — RoomShell composition", () => {
  it("renders ONE verdict (the pure helper's output) and ONE forward door to Lab", () => {
    useReduced();
    const { container } = mount();
    const h1s = container.querySelectorAll(".v2-verdict h1");
    expect(h1s.length).toBe(1);
    expect(h1s[0].textContent).toBe("Heard a tweak online? Look it up here before you try it.");
    const doors = container.querySelectorAll(".v2-door");
    expect(doors.length).toBe(1);
    expect(doors[0].textContent).toContain("Open the instruments");
  });

  it("no measured-line header strip — header space is header-format text only (owner law 2026-07-10)", () => {
    useReduced();
    const { container } = mount();
    expect(container.querySelector(".v2-measured")).toBeNull();
  });

  it("no primary action — the P6 spec names Blackbook the room that may have none", () => {
    useReduced();
    const { container } = mount();
    expect(container.querySelector(".v2-verdict-action")).toBeNull();
  });

  it("one-mention law: Learn's standalone head yields to the room verdict", () => {
    useReduced();
    const { container } = mount();
    expect(container.querySelector(".lx-head")).toBeNull();
    expect(container.querySelector(".lx-title")).toBeNull();
    expect(container.querySelector(".lx-tagline")).toBeNull();
    // …but the working face is intact: search + type filters + the mode tabs render.
    expect(screen.getByLabelText("Search the knowledge library")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Autopsy a guide" })).toBeTruthy();
    // The browse "Try Autopsy" hint also yields — the verdict sub coaches it and the mode tab
    // sits right there (a third mention otherwise).
    expect(container.querySelector(".lx-autopsy-hint")).toBeNull();
  });

  it("one-mention law: the in-panel autopsy record yields (the verdict states it)", () => {
    useReduced();
    // Seed a real graded guide into the persisted ledger before mount.
    recordAutopsy(autopsyScan("force hpet with bcdedit"), 1000);
    const { container } = mount();
    expect(
      (container.querySelector(".v2-verdict h1") as HTMLElement).textContent,
    ).toContain("You've fact-checked 1 guide");
    fireEvent.click(screen.getByRole("tab", { name: "Autopsy a guide" }));
    expect(container.querySelector(".lx-autopsy-record")).toBeNull();
  });

  it("grading a guide updates the room verdict live (the recorded ledger feeds up)", () => {
    useReduced();
    const { container } = mount();
    fireEvent.click(screen.getByRole("tab", { name: "Autopsy a guide" }));
    fireEvent.change(screen.getByLabelText("Paste a tweak guide to autopsy"), {
      target: { value: "force hpet with bcdedit" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Grade this guide" }));
    expect(
      (container.querySelector(".v2-verdict h1") as HTMLElement).textContent,
    ).toContain("You've fact-checked 1 guide");
  });
});

describe("classic Learn — pinned unchanged (flag-off byte-identity at the render level)", () => {
  it("keeps its standalone head (title + tagline + autopsy hint) and renders no RoomShell chrome", () => {
    const { container } = render(<Learn asPanel onClose={() => {}} />);
    expect(screen.getByRole("heading", { name: "Blackbook" })).toBeTruthy();
    expect(container.querySelector(".lx-tagline")).toBeTruthy();
    expect(container.querySelector(".lx-autopsy-hint")).toBeTruthy();
    expect(container.querySelector(".v2-verdict")).toBeNull();
    expect(container.querySelector(".v2-door")).toBeNull();
  });

  it("keeps the in-panel autopsy record (no v2 prop → nothing suppressed)", () => {
    recordAutopsy(autopsyScan("force hpet with bcdedit"), 1000);
    const { container } = render(<Learn asPanel onClose={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "Autopsy a guide" }));
    expect(container.querySelector(".lx-autopsy-record")).toBeTruthy();
  });
});
