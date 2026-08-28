import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";

// Guard for the Lab overhaul (spec 2026-07-08-lab-proving-ground). LabGround IS the Lab now: the
// 2026-08-06 generation prune deleted Lab.tsx and LabV2.tsx and retired the `compy_lab_ground`
// flag, so there is no longer a second face to be byte-identical to and no flag reader to pin —
// those three describes went with the files. What survives is the contract that actually ships:
// the Ops Console face (below).

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));
// LabGround's ground mode now always renders the Ops Console (LabConsole), whose center hologram
// lazily loads the ~600KB three.js bundle — stub it so this stays a fast DOM test (Task 4).
vi.mock("./rig/RigViewer", () => ({ RigViewer: () => <div data-testid="rig-hologram" /> }));

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
const { LabGround } = await import("./LabGround");
const { ConfirmProvider } = await import("../design/ConfirmDialog");

afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
});

describe("LabGround OPS CONSOLE — LabConsole replaces the Instrument Bench bento (spec 2026-07-09, Task 4)", () => {
  // The Ops Console (Task 4) swaps the bento grid of station bays for a console room: a real
  // hologram + corner gauges, and a Dock of stations (Optimize primary, the measure/prove stations
  // beside it). These guards pin (a) the old seam classes stay GONE, (b) every station gets a dock
  // node regardless of whether tweaks exist (no crash on the empty-recs case), (c) Optimize opens
  // inline on click (it is NOT always-on), and (d) the RoomShell verdict + no-Gallery invariants
  // hold through the swap.
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

  const hw = {
    cpu_brand: "AMD Ryzen 7 9850X3D",
    cpu_cores_logical: 16,
    cpu_cores_physical: 8,
    ram_total_bytes: 32 * 1024 ** 3,
    gpus: [{ name: "AMD Radeon RX 9070 XT", vram_bytes: 16 * 1024 ** 3 }],
  } as never;

  const renderMerged = (recs: never[] = [], gamingEnabled = false) =>
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
        gamingEnabled={gamingEnabled}
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

  it("the hologram + a dock node per station render; Optimize is primary; verdict present", () => {
    const c = renderMerged([SAFE_REC]);
    expect(c.querySelector('[data-testid="rig-hologram"]')).not.toBeNull();
    const nodeNames = Array.from(c.querySelectorAll(".dock-node .dock-nm")).map((n) => n.textContent);
    // "Crash & Freeze Rescue" — the plan's locked user label for the station (#91 Task 8), renamed
    // 2026-08-12 so Home's Care entry and this dock node are the same words.
    expect(nodeNames).toEqual(["Optimize", "Diagnostics", "Benchmark", "Latency", "Tuning", "Crash & Freeze Rescue"]);
    expect(c.querySelector(".dock-node-primary")!.textContent).toContain("Optimize");
    // One idiom: the retired linear-spine + bento + gallery faces stay absent.
    expect(c.querySelector(".lab-router")).toBeNull();
    expect(c.querySelector(".lab-bento")).toBeNull();
    expect(c.querySelector(".lab-welcome")).toBeNull();
    expect(c.innerHTML).not.toContain("Gallery");
    // RoomShell verdict present.
    expect(c.querySelector(".v2-room[data-room='lab']")).not.toBeNull();
  });

  it("empty state (no recs): every dock node still renders, no throw, verdict present", () => {
    const c = renderMerged();
    const nodeNames = Array.from(c.querySelectorAll(".dock-node .dock-nm")).map((n) => n.textContent);
    expect(nodeNames).toEqual(["Optimize", "Diagnostics", "Benchmark", "Latency", "Tuning", "Crash & Freeze Rescue"]);
    expect(c.querySelector(".v2-room[data-room='lab']")).not.toBeNull();
  });

  it("the h1 is the room's own sentence now, and it still carries no count", () => {
    // SUPERSEDED, deliberately: the owner title-header law of 2026-07-10 made this h1 the bare word
    // "Test", and 04-test-approved.png overrules it the same way UX-1 overruled it on Health and
    // slices 4-5 did on Live and History. The rail that navigated here already said "Test"; a
    // masthead repeating it pushed the room's own sentence a third smaller than the label above it.
    //
    // What the old law was PROTECTING is untouched and still pinned below: no status sentence, and
    // above all NO COUNT in a heading. "3 fixes ready" as an h1 is the room shouting a number at
    // someone who has not been told what it means yet.
    const c = renderMerged([SAFE_REC]);
    expect(c.querySelector(".hud-headline"), "the Instrument-HUD masthead left this room").toBeNull();
    const h1 = c.querySelector(".v2-verdict h1")!;
    expect(h1.textContent).toContain("Test one change at a time");
    // The dateline lives in the eyebrow INSIDE the h1 (RoomShell composes it that way on every
    // room), so the no-count rule is read off the headline itself — which is where a fixes count
    // would land if this ever regressed.
    expect(c.querySelector(".lc-headline")!.textContent, "no count may reach the headline").not.toMatch(/\d/);
    expect(c.querySelector(".v2-eyebrow")!.textContent).toContain("Proving ground");
    // ...and the room now explains itself in one sentence under it, as every other room does.
    expect(c.querySelector(".v2-verdict-sub")!.textContent).toContain("measures before and after");
    cleanup();
    // The classic "0" failsafe keeps the pre-rollout contract: the verdict sentence as the h1.
    localStorage.setItem("compy_editorial", "0");
    const off = renderMerged([SAFE_REC]);
    expect(off.querySelector(".hud-headline")).toBeNull();
    expect(off.querySelector(".v2-verdict h1")!.textContent!.trim()).not.toBe("Test");
  });

  it("Optimize is NOT always-on — its detail panel opens only when its dock node is clicked", () => {
    const c = renderMerged([SAFE_REC]);
    expect(c.querySelector(".lc-detail")).toBeNull();
    const optimizeNode = Array.from(c.querySelectorAll<HTMLButtonElement>(".dock-node")).find((b) =>
      b.textContent?.includes("Optimize"),
    )!;
    fireEvent.click(optimizeNode);
    expect(c.querySelector(".lc-detail")).not.toBeNull();
    // The station's name is the ROOM's own heading since Mission 1 (2026-08-28) — a selected
    // station replaces the overview instead of mounting as a tile inside it, so there is no tile
    // title left to read, and no second copy of the name to disagree with this one.
    expect(
      c.querySelector('.v2-room[data-room="lab"] > .v2-verdict h1 .lc-ws-title')!.textContent,
    ).toBe("Optimize");
  });

  it("undo stays reachable via the Lab panel (owner decision 2026-07-10, guard for the self-review catch): the opened Optimize panel carries the Applied & history ledger disclosure", () => {
    // The standalone Optimize tab is dropped at default-ON — this panel is the ONE door to the
    // toggles, so it must also carry the record/undo surface the classic room's "Applied" segment
    // had (Fix view="ledger"). Caught missing by the self-reviewer on the flip train.
    const c = renderMerged([SAFE_REC]);
    const optimizeNode = Array.from(c.querySelectorAll<HTMLButtonElement>(".dock-node")).find((b) =>
      b.textContent?.includes("Optimize"),
    )!;
    fireEvent.click(optimizeNode);
    const ledger = c.querySelector(".lab-optimize-ledger");
    expect(ledger).not.toBeNull();
    expect(ledger!.querySelector(".lab-optimize-more-summary")!.textContent).toContain(
      "Applied & history",
    );
  });

  it("§5 Power-features bay shows in the opened Optimize panel ONLY when Gaming Mode is armed; stays collapsed (lazy-mounts)", () => {
    // Armed → the read-first Power-features disclosure is offered inside the opened Optimize panel
    // (Gaming Mode + service-suspend, provable in the Lab). Closed by default so Gaming Mode never
    // mounts/polls until opened.
    const armed = renderMerged([SAFE_REC], true);
    const optimizeNode = Array.from(armed.querySelectorAll<HTMLButtonElement>(".dock-node")).find((b) =>
      b.textContent?.includes("Optimize"),
    )!;
    fireEvent.click(optimizeNode);
    const summaries = Array.from(armed.querySelectorAll(".lab-optimize-more-summary")).map(
      (s) => s.textContent,
    );
    expect(summaries.some((t) => t?.includes("Power features"))).toBe(true);
    expect(armed.querySelector(".lab-optimize-power")).not.toBeNull();
    expect((armed.querySelector(".lab-optimize-power") as HTMLDetailsElement).open).toBe(false);
    cleanup();
    // Disarmed (default) → no Power-features bay at all, even with the panel open.
    const off = renderMerged([SAFE_REC], false);
    const offNode = Array.from(off.querySelectorAll<HTMLButtonElement>(".dock-node")).find((b) =>
      b.textContent?.includes("Optimize"),
    )!;
    fireEvent.click(offNode);
    expect(off.querySelector(".lab-optimize-power")).toBeNull();
  });
});
