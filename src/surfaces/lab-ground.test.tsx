import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { readLabGround, applyLabGround } from "../design/theme";

// Guard for phase 1 of the Lab overhaul (spec 2026-07-08-lab-proving-ground): the merged
// proving-ground room behind `compy_lab_ground` (DEFAULT OFF). The flag lives at the App level —
// App swaps LabV2 → LabGround for the Lab tab — so the byte-identity contract has TWO parts:
//   1. the flag defaults OFF (readLabGround), and
//   2. Lab.tsx's new `ground` mode is purely additive — Lab WITHOUT the prop renders identically
//      regardless of the compy_lab_ground value (Lab.tsx never reads the flag; only App does), so
//      the whole flag-off app stays byte-identical.
// Plus: `ground` mode renders the ONE linear spine (router + numbered stations) and NONE of the
// three retired nav idioms (bento / guided-welcome / classic accordion / readings strip).

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));

// RoomShell's verdict animates via DecryptedText (animateOn="view") → IntersectionObserver, which
// jsdom lacks. A no-op stub lets the merged room mount; the text is the pure helper's real output.
class IOStub {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
vi.stubGlobal("IntersectionObserver", IOStub);

// Imported after the mock so their on-mount probe reads hit the stub.
const { default: Lab } = await import("./Lab");
const { LabGround } = await import("./LabGround");
const { ConfirmProvider } = await import("../design/ConfirmDialog");

afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
  // Pin the other Lab flags to fixed values so only the variable under test moves.
  localStorage.setItem("compy_lab_bento", "0");
  localStorage.setItem("compy_lab_guided", "0");
});

const renderClassic = () =>
  render(<Lab v2 vendor="amd" diagnostics={<div data-testid="diag" />} diagnosticsCaptured />)
    .container;

const renderGround = () =>
  render(
    <Lab v2 ground vendor="amd" diagnostics={<div data-testid="diag" />} diagnosticsCaptured />,
  ).container;

describe("compy_lab_ground flag reader", () => {
  it("defaults OFF (absent → false)", () => {
    localStorage.removeItem("compy_lab_ground");
    expect(readLabGround()).toBe(false);
  });

  it("'1' → true, '0' → false; applyLabGround round-trips", () => {
    applyLabGround(true);
    expect(readLabGround()).toBe(true);
    expect(localStorage.getItem("compy_lab_ground")).toBe("1");
    applyLabGround(false);
    expect(readLabGround()).toBe(false);
  });
});

describe("Lab `ground` mode is additive — flag-off byte-identity", () => {
  it("classic Lab (no ground prop) is byte-identical regardless of compy_lab_ground value", () => {
    // Lab.tsx must never read the flag itself — App owns the swap. Prove it: the classic render is
    // identical whether the flag is absent, '0', or '1'.
    localStorage.removeItem("compy_lab_ground");
    const absent = renderClassic().innerHTML;
    cleanup();
    localStorage.setItem("compy_lab_ground", "0");
    const off = renderClassic().innerHTML;
    cleanup();
    localStorage.setItem("compy_lab_ground", "1");
    const on = renderClassic().innerHTML;
    expect(off).toBe(absent);
    expect(on).toBe(absent);
  });
});

describe("Lab `ground` mode renders the ONE linear spine", () => {
  it("front door (router) + numbered stations present; the three old idioms absent", () => {
    const c = renderGround();
    // The intake router leads the room.
    expect(c.querySelector(".lab-router")).not.toBeNull();
    // Numbered stations (the linear spine) — at least one station number rendered.
    expect(c.querySelector(".lab-station-num")).not.toBeNull();
    expect(c.querySelector(".lab-station-lines")).not.toBeNull();
    // The ground marker on the root, and NOT the bento/guided markers.
    expect(c.querySelector("[data-ground]")).not.toBeNull();
    expect(c.querySelector("[data-bento]")).toBeNull();
    // None of the retired faces: bento grid, welcome band, classic-only readings strip.
    expect(c.querySelector(".lab-bento")).toBeNull();
    expect(c.querySelector(".lab-welcome")).toBeNull();
    expect(c.querySelector(".lab-readings")).toBeNull();
  });

  it("ground overrides even a default-ON bento flag (proving-ground is the single idiom)", () => {
    localStorage.setItem("compy_lab_bento", "1"); // bento would normally paint
    const c = renderGround();
    expect(c.querySelector(".lab-bento")).toBeNull();
    expect(c.querySelector(".lab-router")).not.toBeNull();
  });
});

describe("LabGround BLENDED room — station 1 'Optimize' is a native member of the spine (§8)", () => {
  // The owner rejected the first build's SEAM (a `.lg-fast` box stacked over a `.lg-utility` box).
  // The blended room has NO seam: the tweak-apply is station 1 of the Lab's own numbered spine, so
  // these guards pin (a) the seam classes are GONE, (b) with tweaks present, station 1 "Optimize"
  // LEADS the spine, and (c) the empty/no-recs case degrades to the bare measure spine, no crash.
  const SAFE_REC = {
    id: "game-mode",
    title: "Game Mode",
    category: "system",
    severity: "safe",
    description: "d",
    impact: "i",
    downside: null,
    applies_to: "all",
    currently_applied: false,
    provenance: "verified",
    eligible: true,
  } as never;

  const renderMerged = (recs: never[] = [], gamingEnabled = false) =>
    render(
      <ConfirmProvider>
      <LabGround
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
        gamingEnabled={gamingEnabled}
        readiness={null}
        activeCount={0}
        diagnostics={<div data-testid="diag" />}
        diagnosticsCaptured
      />
      </ConfirmProvider>,
    ).container;

  it("the rejected seam is gone — no `.lg-fast` / `.lg-utility` boxes anywhere", () => {
    const c = renderMerged([SAFE_REC]);
    expect(c.querySelector(".lg-fast")).toBeNull();
    expect(c.querySelector(".lg-utility")).toBeNull();
    expect(c.querySelector(".lg-utility-kicker")).toBeNull();
  });

  it("with tweaks present, station 1 'Optimize' LEADS the one spine (native station, no seam)", () => {
    const c = renderMerged([SAFE_REC]);
    // Station 1 is Optimize — first station card + first station number "1".
    const names = Array.from(c.querySelectorAll(".lab-card-name")).map((n) => n.textContent);
    expect(names[0]).toBe("Optimize");
    const nums = Array.from(c.querySelectorAll(".lab-station-num")).map((n) => n.textContent);
    expect(nums[0]).toBe("1");
    // It carries the same four-line station contract as every other station (native member).
    const firstLines = c.querySelector(".lab-card")!.querySelector(".lab-station-lines");
    expect(firstLines).not.toBeNull();
    // The router gained its ground-only lead row pointing at optimize.
    const stations = Array.from(c.querySelectorAll(".lab-router-station")).map((s) => s.textContent);
    expect(stations[0]).toBe("Optimize");
    // One idiom: the retired faces stay absent.
    expect(c.querySelector(".lab-bento")).toBeNull();
    expect(c.querySelector(".lab-welcome")).toBeNull();
    // Station 1 leads OPEN so the enable-all hero shows without a click (the fast path leads).
    expect(c.querySelector(".lab-card.lab-card-open")).not.toBeNull();
    // RoomShell verdict present.
    expect(c.querySelector(".v2-room[data-room='lab']")).not.toBeNull();
  });

  it("empty state (no recs): degrades to the bare measure spine — no Optimize station, no throw", () => {
    const c = renderMerged();
    // No tweaks to offer → station 1 is NOT prepended; the router lead is dropped too.
    const names = Array.from(c.querySelectorAll(".lab-card-name")).map((n) => n.textContent);
    expect(names).not.toContain("Optimize");
    const stations = Array.from(c.querySelectorAll(".lab-router-station")).map((s) => s.textContent);
    expect(stations).not.toContain("Optimize");
    // Still the one linear spine, no retired idioms, verdict present.
    expect(c.querySelector(".lab-router")).not.toBeNull();
    expect(c.querySelector(".lab-bento")).toBeNull();
    expect(c.querySelector(".lab-welcome")).toBeNull();
    expect(c.querySelector(".v2-room[data-room='lab']")).not.toBeNull();
  });

  it("§5 Power-features bay shows in station 1 ONLY when Gaming Mode is armed; the bay stays collapsed (Gaming Mode lazy-mounts)", () => {
    // Armed → the read-first Power-features disclosure is offered in station 1 (Gaming Mode +
    // service-suspend, provable in the Lab). Closed by default so Gaming Mode never mounts/polls
    // until opened.
    const armed = renderMerged([SAFE_REC], true);
    const summaries = Array.from(armed.querySelectorAll(".lab-optimize-more-summary")).map(
      (s) => s.textContent,
    );
    expect(summaries.some((t) => t?.includes("Power features"))).toBe(true);
    expect(armed.querySelector(".lab-optimize-power")).not.toBeNull();
    expect((armed.querySelector(".lab-optimize-power") as HTMLDetailsElement).open).toBe(false);
    cleanup();
    // Disarmed (default) → no Power-features bay at all.
    const off = renderMerged([SAFE_REC], false);
    expect(off.querySelector(".lab-optimize-power")).toBeNull();
  });

  it("the Gallery (COLLECT) always closes the ground spine — even with no recs (the completion signal)", () => {
    // Gallery is the terminal station: present with tweaks AND on the bare measure spine, since the
    // trophy room is the room's completion signal (an empty gallery still invites the first piece).
    const withTweaks = Array.from(renderMerged([SAFE_REC]).querySelectorAll(".lab-card-name")).map(
      (n) => n.textContent,
    );
    expect(withTweaks[0]).toBe("Optimize"); // fast path leads
    expect(withTweaks[withTweaks.length - 1]).toBe("Gallery"); // COLLECT closes
    cleanup();
    const bare = Array.from(renderMerged().querySelectorAll(".lab-card-name")).map((n) => n.textContent);
    expect(bare).not.toContain("Optimize");
    expect(bare[bare.length - 1]).toBe("Gallery");
  });
});
