import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { BlackbookV2 } from "../BlackbookV2";

// Guards for the Blackbook console flag (plan 2026-07-12-console-hud-phase4-blackbook). The flag
// compy_blackbook_console is DEFAULT OFF (owner eyeball is the gate before a default-ON flip):
// key absent or "0" renders TODAY's classic Learn library byte-identical (both compy_editorial
// states, so the failsafe can't drift ON silently); "1" renders the Logbook console face. Mirrors
// monitor-console-flag.test.tsx's pre-flip DEFAULT-OFF polarity AND its stubbing rationale — Learn
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

describe("Blackbook console DEFAULT OFF — absent renders the classic library, byte-identical to '0'", () => {
  it("editorial default ON: key absent renders the classic Learn tree (no console), byte-identical to '0'", () => {
    useReduced();
    const absent = mount().container.innerHTML;
    expect(absent).not.toContain("blackbook-console");
    expect(absent).toContain("learn-stub"); // the classic Learn tree renders directly
    cleanup();
    localStorage.setItem("compy_blackbook_console", "0");
    const off = mount().container.innerHTML;
    expect(off).toBe(absent);
  });

  it("editorial OFF: key absent renders the classic Learn tree, byte-identical to '0'", () => {
    useReduced();
    localStorage.setItem("compy_editorial", "0");
    const absent = mount().container.innerHTML;
    expect(absent).not.toContain("blackbook-console");
    expect(absent).toContain("learn-stub");
    cleanup();
    localStorage.setItem("compy_editorial", "0");
    localStorage.setItem("compy_blackbook_console", "0");
    const off = mount().container.innerHTML;
    expect(off).toBe(absent);
  });
});

describe("Blackbook console '1' — the Logbook console face renders, both editorial states", () => {
  it("editorial default ON: '1' renders the console (.blackbook-console) + the face toggle, not the raw library", () => {
    useReduced();
    localStorage.setItem("compy_blackbook_console", "1");
    const { container } = mount();
    expect(container.querySelector(".blackbook-console")).not.toBeNull();
    expect(container.querySelector(".bbv2-bar")).not.toBeNull(); // Logbook | Field guide toggle
  });

  it("editorial OFF: '1' still renders the console (flag is independent of compy_editorial)", () => {
    useReduced();
    localStorage.setItem("compy_editorial", "0");
    localStorage.setItem("compy_blackbook_console", "1");
    const { container } = mount();
    expect(container.querySelector(".blackbook-console")).not.toBeNull();
  });
});
