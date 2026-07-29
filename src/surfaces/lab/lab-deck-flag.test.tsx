import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { readLabDeck, applyLabDeck } from "../../design/theme";

// Guard for `compy_lab_deck` — the TEMPORARY owner-comparison flag carrying the decision-journey
// Lab candidate (product-recovery train, 2026-07-28). Two contracts, both load-bearing:
//
//   1. DEFAULT OFF, and the failsafe is the DEFAULT, not a setting. Absent / "0" / garbage all
//      read false; only the literal "1" opts in. Nothing about today's shipped Lab may move
//      because this candidate exists — the flag-off render is pinned BYTE-IDENTICAL across all
//      three off-states, so the candidate can never leak into what users actually receive.
//   2. Flag ON renders the deck INSTEAD of the dock — not beside it. The five journey sections
//      are present, the dock is gone, and ExperimentBench is hosted by the deck's "Measure &
//      prove" section rather than mounted twice (the room-level copy must disappear).
//
// This is the guard that lets Phase 4 prune with evidence: if the deck ever becomes canonical the
// off-branch here is exactly what gets deleted, and until then this test proves it is untouched.

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));
// LabConsole's center hologram lazily pulls the ~600KB three.js bundle — same stub as
// lab-ground.test.tsx keeps this a fast DOM test.
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

const { LabGround } = await import("../LabGround");
const { ConfirmProvider } = await import("../../design/ConfirmDialog");

afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
  // Reduced motion keeps the render deterministic for the byte-compares (no DecryptedText churn).
  localStorage.setItem("compy_motion", "reduced");
});

const SAFE_REC = {
  id: "game-mode",
  title: "Game Mode",
  category: "system",
  severity: "safe",
  description: "Windows' own gaming setting.",
  impact: "Turns Game Mode on.",
  downside: null,
  applies_to: "Currently off",
  currently_applied: false,
  provenance: "verified",
  eligible: true,
} as never;

const hw = {
  cpu_brand: "AMD Ryzen 7 9850X3D",
  cpu_cores_logical: 16,
  cpu_cores_physical: 8,
  ram_total_bytes: 32 * 1024 ** 3,
  gpus: [{ name: "AMD Radeon RX 9070 XT", vram_bytes: 16 * 1024 ** 3 }],
} as never;

const renderGround = (recs: never[] = [SAFE_REC]) =>
  render(
    <ConfirmProvider>
      <LabGround
        hw={hw}
        isAppliable={() => true}
        onOpenLibrary={() => {}}
        onChanged={() => {}}
        vendor="amd"
        sessions={[]}
        gpus={[]}
        recs={recs}
        startup={[]}
        changes={[]}
        busyId={null}
        activeChangeFor={() => undefined}
        onToggleRec={() => {}}
        onToggleStartup={() => {}}
        onRollback={() => {}}
        onApplyBatch={async () => ({ applied: 0, skipped: [] })}
        readiness={null}
        activeCount={0}
        priorities={null}
        diagnostics={<div data-testid="diag" />}
        diagnosticsCaptured
      />
    </ConfirmProvider>,
  ).container;

describe("compy_lab_deck flag reader — DEFAULT OFF, opt-in only", () => {
  it("absent → false (the candidate never arrives by accident)", () => {
    localStorage.removeItem("compy_lab_deck");
    expect(readLabDeck()).toBe(false);
  });

  it("'1' → true; '0' and any other value → false; applyLabDeck round-trips", () => {
    applyLabDeck(true);
    expect(localStorage.getItem("compy_lab_deck")).toBe("1");
    expect(readLabDeck()).toBe(true);
    applyLabDeck(false);
    expect(localStorage.getItem("compy_lab_deck")).toBe("0");
    expect(readLabDeck()).toBe(false);
    localStorage.setItem("compy_lab_deck", "yes");
    expect(readLabDeck()).toBe(false);
  });
});

describe("flag OFF — today's shipped Lab is byte-identical", () => {
  it("absent renders the LabConsole station dock and NO deck", () => {
    const c = renderGround();
    expect(c.querySelector(".lab-deck")).toBeNull();
    const nodeNames = Array.from(c.querySelectorAll(".dock-node .dock-nm")).map((n) => n.textContent);
    expect(nodeNames).toEqual([
      "Optimize",
      "Diagnostics",
      "Benchmark",
      "Latency",
      "Tuning",
      "Black Box",
    ]);
  });

  it("absent, '0' and a garbage value render the SAME html (the failsafe can't drift on)", () => {
    const absent = renderGround().innerHTML;
    cleanup();
    localStorage.setItem("compy_lab_deck", "0");
    const off = renderGround().innerHTML;
    cleanup();
    localStorage.setItem("compy_lab_deck", "nope");
    const garbage = renderGround().innerHTML;
    expect(off).toBe(absent);
    expect(garbage).toBe(absent);
  });
});

describe("flag ON — the deck REPLACES the dock (one Lab on screen, never two)", () => {
  const on = () => {
    localStorage.setItem("compy_lab_deck", "1");
    return renderGround();
  };

  it("the five journey sections render in order, and the station dock is gone", () => {
    const c = on();
    expect(c.querySelector(".lab-deck")).not.toBeNull();
    expect(c.querySelector(".dock-node")).toBeNull();
    const sections = Array.from(c.querySelectorAll(".ld-section")).map((s) => s.id);
    expect(sections).toEqual(["ld-move", "ld-optimize", "ld-prove", "ld-diagnose", "ld-advanced"]);
  });

  it("ONE navigation grammar: a single nav whose items match the five sections", () => {
    const c = on();
    const navs = c.querySelectorAll(".ld-nav");
    expect(navs.length).toBe(1);
    const items = Array.from(navs[0].querySelectorAll("button")).map((b) => b.textContent);
    expect(items).toEqual([
      "Your next best move",
      "Optimize",
      "Measure & prove",
      "Diagnose a problem",
      "Advanced instruments",
    ]);
    // The retired faces stay absent — no router, no bento, no welcome band, no gallery.
    expect(c.querySelector(".lab-router")).toBeNull();
    expect(c.querySelector(".lab-bento")).toBeNull();
    expect(c.querySelector(".lab-welcome")).toBeNull();
  });

  it("every section is a real landmark: labelled heading + focusable anchor", () => {
    const c = on();
    for (const s of Array.from(c.querySelectorAll<HTMLElement>(".ld-section"))) {
      expect(s.tabIndex).toBe(-1);
      const labelledBy = s.getAttribute("aria-labelledby")!;
      expect(c.querySelector(`#${labelledBy}`)!.tagName).toBe("H2");
    }
  });

  it("ExperimentBench is hosted by the deck, not mounted a second time at room level", () => {
    const c = on();
    // The deck owns the bench as a row in "Measure & prove"; the room-level copy is dropped, so
    // the bench can never render twice on one screen.
    const rowNames = Array.from(c.querySelectorAll(".ld-row-name")).map((n) => n.textContent);
    expect(rowNames.filter((n) => n === "Experiments").length).toBe(1);
  });

  it("the RoomShell contract survives the swap (still the Lab room, still one verdict)", () => {
    const c = on();
    expect(c.querySelector(".v2-room[data-room='lab']")).not.toBeNull();
    expect(c.querySelector(".v2-verdict .hud-headline")!.textContent).toBe("Lab");
  });

  it("empty rig (no recs): the deck still renders all five sections and does not throw", () => {
    localStorage.setItem("compy_lab_deck", "1");
    const c = renderGround([]);
    expect(c.querySelectorAll(".ld-section").length).toBe(5);
    expect(c.querySelector(".ld-move")).not.toBeNull();
  });
});
