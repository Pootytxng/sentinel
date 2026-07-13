import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { BlackbookV2 } from "../BlackbookV2";

// Guards for the Blackbook console flag (plan 2026-07-12-console-hud-phase4-blackbook; flipped
// DEFAULT ON 2026-07-13 on the owner's eyeball verdict — "it looks much better" — per
// ship-approved-work-as-the-build). Key absent renders the Logbook console face byte-identical to
// an explicit "1" (both compy_editorial states, so the default can't drift silently); the explicit
// "0" devtools failsafe restores TODAY's classic Learn library. Mirrors
// monitor-console-flag.test.tsx's post-flip DEFAULT-ON polarity AND its stubbing rationale — Learn
// is the audited heavy surface (its own suites cover it), stubbed here to a trivial marker so the
// byte-compare is deterministic and the assertion is purely about the flag branch.
vi.mock("../Learn", () => ({ default: () => <div data-testid="learn-stub" /> }));

beforeAll(() => {
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
  sessionStorage.clear();
});

// Reduced motion keeps the render deterministic for the byte-compares (no DecryptedText churn).
const useReduced = () => localStorage.setItem("compy_motion", "reduced");

function mount() {
  return render(<BlackbookV2 focusId={null} vendor="amd" onClose={() => {}} />);
}

describe("Blackbook console DEFAULT ON — absent renders the Logbook console, byte-identical to '1'", () => {
  it("editorial default ON: key absent renders the console face, byte-identical to '1'", () => {
    useReduced();
    const absent = mount().container.innerHTML;
    expect(absent).toContain("blackbook-console");
    expect(absent).not.toContain("learn-stub"); // the classic Learn tree does NOT render directly
    cleanup();
    localStorage.setItem("compy_blackbook_console", "1");
    const on = mount().container.innerHTML;
    expect(on).toBe(absent);
  });

  it("editorial OFF: key absent still renders the console face, byte-identical to '1'", () => {
    useReduced();
    localStorage.setItem("compy_editorial", "0");
    const absent = mount().container.innerHTML;
    expect(absent).toContain("blackbook-console");
    cleanup();
    localStorage.setItem("compy_editorial", "0");
    localStorage.setItem("compy_blackbook_console", "1");
    const on = mount().container.innerHTML;
    expect(on).toBe(absent);
  });
});

describe("Blackbook console '0' failsafe — the classic Learn library renders, both editorial states", () => {
  it("editorial default ON: '0' renders the classic Learn tree (no console, no face toggle)", () => {
    useReduced();
    localStorage.setItem("compy_blackbook_console", "0");
    const { container } = mount();
    expect(container.querySelector(".blackbook-console")).toBeNull();
    expect(container.innerHTML).toContain("learn-stub"); // the classic tree renders directly
  });

  it("editorial OFF: '0' still restores the classic tree (failsafe independent of compy_editorial)", () => {
    useReduced();
    localStorage.setItem("compy_editorial", "0");
    localStorage.setItem("compy_blackbook_console", "0");
    const { container } = mount();
    expect(container.querySelector(".blackbook-console")).toBeNull();
    expect(container.innerHTML).toContain("learn-stub");
  });
});
