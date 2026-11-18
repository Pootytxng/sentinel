import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { readFileSync } from "fs";
import { resolve } from "path";
import { invoke } from "@tauri-apps/api/core";

// LabConsole — the Ops Console that replaces the Instrument Bench bento (spec
// 2026-07-09-lab-redesign-direction-proposal, Phase 1, Task 4). A real 3D hologram sits center-stage
// with four corner arc gauges (honesty-rail: absent readings render NOT-YET, never a fabricated
// number), a Dock of stations (Optimize primary + the measure/prove stations), and exactly ONE open
// detail panel at a time — Optimize opens <OptimizeStation> inline (it is NOT always-on), the measure
// stations open their existing instrument bodies. Ported verbatim from the deleted LabBench.tsx: the
// probe useEffects, measureTuning, safeReady/stackApplied, measureKeys, stationBody switch, and the
// one-open station state.

// Lab + the embedded instrument tabs poll on mount; mock invoke so they don't throw.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));
// Reduced motion simplifies gauge assertions (useCountTo snaps instead of tweening).
vi.mock("../design/use-motion", () => ({ useReducedMotion: () => true }));
// RigViewer pulls in the ~600KB three.js bundle lazily — stub only the WebGL surface while keeping
// its selected-id boundary real. The buttons let the evidence tests drive the same callback an
// actual mesh click emits without asserting anything about the stub itself.
vi.mock("./rig/RigViewer", () => ({
  RigViewer: ({
    onSelectedIdChange,
    focusId,
    dimmed,
  }: {
    // Both arguments, exactly as the real viewer emits them: the id AND which of the three drawn
    // lists it came from. A mock that emitted the id alone let the console's fan / user-added
    // branches go untested — that gap is what shipped a click that highlighted a part and then
    // showed nothing.
    onSelectedIdChange?: (id: string | null, what: RigSelection | null) => void;
    // P7-rig-care: what the Care station's crash record asks the rig to show.
    focusId?: string | null;
    dimmed?: boolean;
  }) => (
    <div data-testid="rig-hologram" data-focus-id={focusId ?? ""} data-dimmed={dimmed ? "1" : "0"}>
      <button
        onClick={() =>
          onSelectedIdChange?.("gpu-1", {
            source: "part",
            id: "gpu-1",
            name: "NVIDIA GeForce RTX 4070",
            detected: true,
          })
        }
      >
        Select GPU 2
      </button>
      <button
        onClick={() =>
          onSelectedIdChange?.("disk-1", {
            source: "part",
            id: "disk-1",
            name: "Archive SSD",
            detected: true,
          })
        }
      >
        Select drive 2
      </button>
    </div>
  ),
}));

const { LabConsole } = await import("./LabConsole");
const { ConfirmProvider } = await import("../design/ConfirmDialog");
import type { LabFastPathProps } from "./lab/OptimizeStation";
import type { HardwareInfo } from "../App";
import type { RigSelection } from "./rig/rig-parts";

afterEach(cleanup);
beforeEach(() => localStorage.clear());

// Two safe, one-click, not-yet-applied recs — relocated from lab-bench.test.tsx's SAFE_RECS. Gives
// Fix's slim "Apply reviewed (N)" enable-all bar (renders at safeBatch.length >= 2) once Optimize's
// detail panel opens.
const recsFixture = [
  {
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
  },
  {
    id: "hags",
    title: "Hardware GPU scheduling",
    category: "system",
    severity: "safe",
    description: "d",
    impact: "i",
    downside: null,
    applies_to: "all",
    currently_applied: false,
    provenance: "verified",
    eligible: true,
  },
] as never[];

const changesFixture = [] as never[];
const isAppliableFixture = () => true;

// Copied from home-v2.test.tsx's `hw` fixture (same shape App threads through as HardwareInfo).
const hwFixture = {
  cpu_brand: "AMD Ryzen 7 9850X3D",
  cpu_arch: { family_label: "Ryzen 7 9850X3D", architecture: "Zen 5", generation: "9000" },
  cpu_cores_logical: 16,
  cpu_cores_physical: 8,
  cpu_frequency_mhz: 5100,
  ram_total_bytes: 32 * 1024 ** 3,
  ram_used_bytes: 16 * 1024 ** 3,
  gpus: [{ name: "AMD Radeon RX 9070 XT", vram_bytes: 16 * 1024 ** 3 }],
  disks: [
    {
      mount_point: "C:\\",
      total_bytes: 1000 * 1024 ** 3,
      available_bytes: 130 * 1024 ** 3,
      file_system: "NTFS",
    },
  ],
  memory_modules: [],
  physical_disks: [],
  display: { current_refresh_rate_hz: 165 },
  os_name: "Windows",
  os_version: "11",
} as unknown as HardwareInfo;

const multiDeviceHw = {
  ...hwFixture,
  gpus: [
    {
      name: "AMD Radeon RX 9070 XT",
      vram_bytes: 16 * 1024 ** 3,
      driver_version: "25.5.1",
      driver_date: "",
      driver_age_days: null,
      video_processor: "",
      current_refresh_rate_hz: 165,
    },
    {
      name: "NVIDIA GeForce RTX 4070",
      vram_bytes: 12 * 1024 ** 3,
      driver_version: "555.99",
      driver_date: "",
      driver_age_days: null,
      video_processor: "",
      current_refresh_rate_hz: 144,
    },
  ],
  disks: [
    {
      mount_point: "C:\\",
      total_bytes: 1000 * 1024 ** 3,
      available_bytes: 130 * 1024 ** 3,
      file_system: "NTFS",
    },
    {
      mount_point: "D:\\",
      total_bytes: 4000 * 1024 ** 3,
      available_bytes: 3000 * 1024 ** 3,
      file_system: "NTFS",
    },
  ],
  physical_disks: [
    { friendly_name: "System SSD", media_type: "SSD", bus_type: "NVMe", size_bytes: 1000 * 1024 ** 3 },
    { friendly_name: "Archive SSD", media_type: "SSD", bus_type: "SATA", size_bytes: 4096 * 1024 ** 3 },
  ],
} as unknown as HardwareInfo;

const fast: LabFastPathProps = {
  recs: recsFixture,
  startup: [],
  changes: changesFixture,
  busyId: null,
  isAppliable: isAppliableFixture,
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
};

const base = {
  fast,
  diagnostics: <div data-testid="diag" />,
  diagnosticsCaptured: true,
  vendor: "amd" as const,
  hw: hwFixture,
  // The console composes its own RoomShell since issue #49 slice 6, so the harness has to hand it
  // what the room used to wrap it in. `hud: true` is the DEFAULT composition (compy_editorial is
  // on by default and "0" is only the devtools failsafe), so this suite keeps testing the room
  // people actually see; the failsafe branch has its own coverage in lab-ground.test.tsx.
  hud: true,
  ledState: "ok" as const,
  classicVerdict: "Everything checked out.",
};

const renderConsole = (props = base) =>
  render(
    <ConfirmProvider>
      <LabConsole {...props} />
    </ConfirmProvider>,
  );

// THE BENCH READING SET, by position. The four gauges left the canvas CORNERS in issue #49
// slice 6 (04-test-approved.png draws them as a strip under the hologram, and the handoff forbids
// covering that canvas with click targets or diagrams), so `.lc-tl/.lc-tr/.lc-bl/.lc-br` are gone.
// Index order is the comp's own, re-set 2026-08-27 on the Codex REJECT: Proven · Noise floor ·
// Instruments read · Safe stack — arc, numeral, numeral, arc, so the two rings bookend the strip.
// Guard 1 below pins exactly that, and the rhythm itself is pinned in the rhythm guards at the foot of this file.
// TWO handles on ONE door since slice 6: the comp's "Start with Optimize" primary and the
// "Optimize · Start here" row in the station list both call the same setter, so a bare
// /optimize/i role query now matches both. Tests about the LIST say so with this.
const stationNode = (re: RegExp) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>(".dock-node")).find((b) =>
    re.test(b.textContent ?? ""),
  )!;

const reading = (i: number) => document.querySelectorAll(".lc-readings > .lc-reading")[i]!;

// The open station's NAME. Since Mission 1 (2026-08-28) a selected station REPLACES the overview
// and its name IS the room's <h1> — the <BentoTile> that used to wrap the panel, and print the name
// a second time an inch below the room's own headline, is the classic failsafe's shape now.
const openStationName = () =>
  document.querySelector('.v2-room[data-room="lab"] > .v2-verdict h1 .lc-ws-title')?.textContent;

// The way out of a workspace. There is no dock to click a second time while a station is open —
// that is the point of the mode — so every "now close it" step goes through this control.
const backToTest = () => document.querySelector<HTMLButtonElement>(".lc-ws-back")!;

describe("LabConsole", () => {
  it("renders the recognizable rig hologram at center", () => {
    renderConsole();
    expect(screen.getByTestId("rig-hologram")).toBeInTheDocument();
  });

  it("keeps GPU 2's identity through the evidence panel instead of showing GPU 1's readings", () => {
    renderConsole({ ...base, hw: multiDeviceHw });
    fireEvent.click(screen.getByRole("button", { name: "Select GPU 2" }));

    const evidence = document.querySelector(".lc-evidence")!;
    expect(evidence.querySelector(".lc-evidence-part")!.textContent).toBe("NVIDIA GeForce RTX 4070");
    expect(evidence.textContent).toContain("12.0 GB");
    expect(evidence.textContent).toContain("555.99");
    expect(evidence.textContent).not.toContain("16.0 GB");
    expect(evidence.textContent).not.toContain("25.5.1");
  });

  it("keeps drive 2's identity through the evidence panel instead of showing C: free space", () => {
    renderConsole({ ...base, hw: multiDeviceHw });
    fireEvent.click(screen.getByRole("button", { name: "Select drive 2" }));

    const evidence = document.querySelector(".lc-evidence")!;
    expect(evidence.querySelector(".lc-evidence-part")!.textContent).toBe("Archive SSD");
    expect(evidence.textContent).toContain("4096.0 GB");
    expect(evidence.textContent).not.toContain("130.0 GB");
    expect(evidence.textContent).not.toContain("1000.0 GB");
  });

  it("renders a dock node for every Lab station (no gallery) with Optimize as the primary", () => {
    renderConsole();
    expect(stationNode(/optimize/i)).toHaveClass("dock-node-primary");
    expect(screen.getByRole("button", { name: /benchmark/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /latency/i })).toBeInTheDocument();
    // Renamed 2026-08-11 (§4): the dock node says the problem ("crash"), not the metaphor.
    expect(screen.getByRole("button", { name: /crash & freeze/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /gallery/i })).toBeNull();
  });

  it("opens the Optimize enable-all when its dock node is clicked", () => {
    renderConsole();
    fireEvent.click(stationNode(/optimize/i));
    // OptimizeStation's real enable-all control — Fix's slim view renders "Apply reviewed (N)",
    // not "Apply all safe fixes (N)" (that longer label is the non-slim/classic view only).
    expect(screen.getByRole("button", { name: /apply reviewed/i })).toBeInTheDocument();
  });

  // REWORDED for Mission 1, same invariant: ONE station body at a time, and switching stations
  // really does switch. What changed is the route — a selected station owns the room, so the list
  // is not on screen to click a second station directly from; you come back and pick. The old
  // "click the open station again to close it" toggle is still in `openFrom` and still covers the
  // classic failsafe, where the dock and the panel do share a screen.
  it("opens exactly one station body; coming back and picking another swaps it; back closes it", () => {
    renderConsole();
    fireEvent.click(stationNode(/benchmark/i));
    expect(document.querySelectorAll(".lc-detail")).toHaveLength(1);
    expect(openStationName()).toBe("Benchmark");
    fireEvent.click(backToTest());
    fireEvent.click(stationNode(/latency/i));
    expect(document.querySelectorAll(".lc-detail")).toHaveLength(1);
    expect(openStationName()).toBe("Latency");
    fireEvent.click(backToTest());
    expect(document.querySelector(".lc-detail")).toBeNull();
  });

  // bug -> guard (DIR-1 first-timer walk, 2026-08-26, finding #1). The detail panel renders BELOW
  // the dock, so a station could open entirely off screen. The walk measured the deep-link case
  // live: from Health's "It crashed, froze, or restarted" -> "Read the crash record", the Crash &
  // Freeze Rescue node came back aria-pressed="true" and #lab-console-detail was in the DOM, while
  // the only thing visible was this room's unrelated hero. A press with no visible effect is the
  // dead end the walk was sent to find.
  //
  // Two traps this guard fell into first, both of which make it pass VACUOUSLY: src/test/setup.ts
  // stubs `scrollIntoView` on HTMLElement.prototype, which SHADOWS Element.prototype (spy the same
  // prototype the stub is on), and `spy.mock.contexts` is where `this` lands -- `.instances`
  // records only `new` calls, so it reads empty for a prototype method.
  //
  // `block: "nearest"` is load-bearing and pinned below: it is what keeps a hand click from
  // yanking the dock off screen when the panel is already visible. Falsified both ways -- dropping
  // the scroll fails the first two, and scrolling on close fails the third.
  //
  // Mission 1 moved the TARGET and nothing else. The station is no longer a panel below the dock;
  // it is the room, and the thing that has to be on screen is the TOP of that room — the bar
  // carrying "Back to Test", the only way out. (It was the heading for one build; that landed the
  // Back control under the fixed chrome at 1280x720, and lab-station-workspace.test.tsx now pins
  // the top instead.) So the filter accepts the workspace bar as well as the old panel id, which
  // the classic failsafe still scrolls, and the guard falsifies exactly as before: drop the scroll
  // and the first two fail, scroll on close and the third fails.
  const onDetail = (spy: { mock: { contexts: unknown[] } }) =>
    spy.mock.contexts.filter((el) => {
      const node = el as Element | undefined;
      return node?.id === "lab-console-detail" || !!node?.classList?.contains("lc-ws-bar");
    });

  // The ALIGNMENT is the half that flipped, and only because the thing it protected went away.
  // "Nearest" existed so a hand click could not yank the dock off screen — the dock and the panel
  // shared a screen. In the workspace the dock is unmounted, so there is nothing to preserve the
  // reader's place in, and "nearest" actively hurt: it made the landing depend on where the reader
  // had been standing, which put the Back control under the fixed chrome at 1280x720. "start" is
  // one landing every time. The classic failsafe below still shares its screen with the dock and
  // still gets "nearest" — the original invariant, kept where it still means something.
  it("scrolls a hand-opened station into view, landing at the top of the workspace", () => {
    const spy = vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
    try {
      renderConsole();
      fireEvent.click(screen.getByRole("button", { name: /benchmark/i }));
      expect(onDetail(spy).length, "the opened station was never scrolled into view").toBeGreaterThan(0);
      // `.at(-1)` is not in this project's lib target — index arithmetic instead.
      const last = spy.mock.calls[spy.mock.calls.length - 1];
      expect(last?.[0], "the workspace must land at its own top, not wherever the reader was")
        .toEqual({ block: "start" });
    } finally {
      spy.mockRestore();
    }
  });

  it("the classic failsafe still scrolls only as far as it has to — its dock stays on screen", () => {
    const spy = vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
    try {
      renderConsole({ ...base, hud: false });
      fireEvent.click(screen.getByRole("button", { name: /benchmark/i }));
      const last = spy.mock.calls[spy.mock.calls.length - 1];
      expect(last?.[0], "a hand click must not yank the classic dock off screen")
        .toEqual({ block: "nearest" });
    } finally {
      spy.mockRestore();
    }
  });

  it("scrolls the deep-linked station into view on arrival", () => {
    const spy = vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
    try {
      localStorage.setItem("compy_lab_open_station", "benchmark");
      renderConsole();
      expect(openStationName(), "the deep link did not open its station").toBe("Benchmark");
      expect(onDetail(spy).length, "the deep-linked station was never scrolled into view").toBeGreaterThan(0);
    } finally {
      spy.mockRestore();
      localStorage.removeItem("compy_lab_open_station");
    }
  });

  // Closing is the Back control since Mission 1 — with a station open the dock is not on screen,
  // so there is no second click on its row to make. Focus DOES return to that row, and focus is
  // deliberately not a scroll: `back.focus()` on the restored row, never a scrollIntoView.
  it("does not scroll when a station is CLOSED — the reader keeps their place", () => {
    renderConsole();
    fireEvent.click(stationNode(/benchmark/i));
    const spy = vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
    try {
      fireEvent.click(backToTest());
      expect(document.querySelector(".lc-detail"), "the station did not close").toBeNull();
      // Nothing at all, not merely "not the detail panel": closing must not move the lane by way
      // of some other node either. A filtered assertion here let a scroll-the-dock-on-close
      // mutation survive falsification.
      expect(spy, "closing a station moved the page").not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("shows an honest NOT-YET gauge when a reading is absent (no fabricated number)", () => {
    renderConsole();
    expect(screen.getAllByText(/not yet/i).length).toBeGreaterThan(0);
  });

  it("the safe-stack gauge shows the real remaining count when recs are loaded", () => {
    renderConsole();
    // Two unapplied safe recs in the fixture → the gauge reads "2 · measured", never NOT-YET.
    const bl = reading(3);
    expect(bl.textContent).toContain("Safe stack");
    expect(bl.querySelector(".ag-v")!.textContent).toBe("2");
    expect(bl.querySelector(".ag-tag-ny")).toBeNull(); // NOT the NOT-YET tag
  });

  // Intimidation pass 2026-08-21: with the whole safe stack applied the gauge used to read
  // "0 ready" on an empty ring — the room's bottom-left alarm. Same recs, read as done.
  it("the safe-stack gauge reads 'N on · = all N applied' on a full ring once nothing is left to apply", () => {
    const applied = (recsFixture as Array<Record<string, unknown>>).map((r) => ({ ...r, currently_applied: true }));
    renderConsole({ ...base, fast: { ...fast, recs: applied as never[] } });
    const bl = reading(3);
    expect(bl.querySelector(".ag-v")!.textContent).toBe("2");
    expect(bl.textContent).toContain("on");
    expect(bl.textContent).not.toContain("ready");
    expect(bl.querySelector(".ag-note")!.textContent).toBe("all 2 applied");
    expect(bl.querySelector(".ag-tag-ny")).toBeNull();
    // The ring is full: dashoffset 0 (ArcGauge draws CIRC * (1 - frac)).
    const fill = bl.querySelector<SVGCircleElement>(".ag-fill")!;
    expect(Number.parseFloat(fill.style.strokeDashoffset || fill.getAttribute("stroke-dashoffset") || "1")).toBeCloseTo(0, 3);
  });

  // s44 batch 2 (B1): "all 8 applied" beside Optimize's "8/9 ... 1 was turned off outside Compy".
  it("the safe-stack note agrees with Optimize when a change the user turned on now reads off", () => {
    const recs: Array<Record<string, unknown>> = (recsFixture as Array<Record<string, unknown>>).map((r, i) => ({
      ...r,
      currently_applied: i === 0,
    }));
    const changes = [
      { rec_id: String(recs[1].id), rec_title: String(recs[1].title), status: "applied", is_still_active: false },
    ];
    renderConsole({ ...base, fast: { ...fast, recs: recs as never[], changes: changes as never[] } });
    const note = reading(3).querySelector(".ag-note")!.textContent;
    expect(note).toBe("1 of 2 on · 1 was turned off outside Compy");
    expect(note).not.toContain("all");
  });

  it("the dock says where to start: 'Start here' on Optimize and a plain when-line under the row", () => {
    renderConsole();
    const dock = document.querySelector(".dock")!;
    const eyebrow = dock.querySelector(".dock-eyebrow")!;
    expect(eyebrow.textContent).toBe("Start here");
    expect(eyebrow.closest(".dock-node")).toHaveClass("dock-node-primary");
    // In LIST layout every row prints its OWN when-line — the plain sentence the router and the
    // guided face use — so the shared hover caption is gone: it would have said a second time what
    // the row already says an inch away, and announced it through aria-live besides.
    expect(dock.querySelector(".dock-caption"), "the list must not also draw the hover caption").toBeNull();
    const primary = dock.querySelector(".dock-node-primary")!;
    // The comp's subtitle, not the symptom line — 04-test-approved.png prints the TASK under each
    // station name. whenLine is untouched and still feeds the command palette's search.
    expect(primary.querySelector(".dock-hint")!.textContent).toBe(
      "Test one change at a time and keep what helps.",
    );
    // Every station carries its own, not just the primary one.
    expect(dock.querySelectorAll(".dock-node").length).toBe(dock.querySelectorAll(".dock-hint").length);
  });

  it("the safe-stack gauge is honest NOT-YET (never a fabricated 0) while recs are not loaded — bug→guard 2026-07-09", () => {
    // recs load independently of hw in App (App gates LabGround on hw only), so before
    // get_recommendations resolves — or permanently if it errors — fast.recs is null. The gauge must
    // read NOT-YET, never "0 ready · measured" (the honesty-rail violation the branch review caught).
    renderConsole({
      ...base,
      fast: { ...fast, recs: null as unknown as LabFastPathProps["recs"] },
    });
    const bl = reading(3);
    expect(bl.querySelector(".ag-tag-ny")).not.toBeNull(); // the NOT-YET tag is present
    expect(bl.querySelector(".ag-v")!.textContent).not.toBe("0"); // never a fabricated 0
  });

  it("reduced motion is threaded through, ON THE STAGE the glow is actually gated on", () => {
    renderConsole();
    // bug→guard, and it is the SECOND time this exact bug has shipped: the pointer glow is gated
    // on `[data-motion="full"] .lc-stage`, and in the approved composition the stage has no
    // `.lab-console` ancestor at all — so a switch set on that root would have been set on an
    // element the stage no longer lives inside, and silently done nothing. History's row stagger
    // died the same way when the tape moved out of its console (fixed 2026-08-23). The switch now
    // rides the element the selector names, and this test reads it there.
    expect(document.querySelector(".lc-stage")!.getAttribute("data-motion")).toBe("reduced");
  });

  it("no lede line — the console opens straight on the stage (owner header-slop law 2026-07-10)", () => {
    const { container } = renderConsole();
    expect(container.querySelector(".lab-console-lede")).toBeNull();
    // The room's reassurance lives in the Optimize panel (its context), not the header;
    // the undo half moved to Fix's consent line (title-header law) so the panel says it once.
    expect(container.querySelector(".lc-detail-note")).toBeNull(); // closed → nowhere
    // The LIST row is the one this test is about, not the primary above it.
    fireEvent.click(stationNode(/optimize/i));
    const note = container.querySelector(".lc-detail-note")!.textContent!;
    // bug→guard (self-review 2026-07-17, rounds 1–3): this note twice shipped a FALSE room-wide
    // census. Round 1 said "the only station ... that changes anything" — false once Intelligence
    // Phase 3 armed the Controlled experiments bench. Round 2 said "everything else just reads" —
    // still false, because Benchmark's ungated "Measure this tweak" tweak-trial (start_tweak_trial →
    // real apply_recommendation, benchmark_trial.rs) is a mutator too. The Lab has SEVERAL mutators,
    // each disclosing its own mutation at its own surface, so the durable fix drops the census and
    // states the one invariant true across every station: everything here is reversible. Guard that
    // neither false census can return, that undo stays out (it lives on Fix's consent line), and that
    // the reversibility reassurance stays.
    expect(note).not.toMatch(/just reads?\b/i); // round-2 false census ("everything else just reads")
    expect(note).not.toMatch(/only .*(changes?|change) anything/i); // round-1 false sole-mutator claim
    expect(note).not.toMatch(/undo/i); // undo lives on Fix's consent line (title-header law)
    expect(note).toMatch(/reversible|rolls? back|nothing.*permanent/i); // the true reassurance must stay
    // Back out and open a MEASURE station: the reassurance is Optimize's, and must not follow the
    // reader to a station that applies nothing.
    fireEvent.click(backToTest());
    fireEvent.click(stationNode(/benchmark/i));
    expect(container.querySelector(".lc-detail-note")).toBeNull(); // measure stations: no note
  });

  it("never paints the vendor MagicBento purple — the console is token-only (Task 5)", () => {
    const { container } = renderConsole();
    // No 132,0,255 (the vendored gamer-RGB default) anywhere in the rendered tree — the console uses
    // only the theme accent via ArcGauge/Dock/ReticleCursor, no MagicBento ParticleCard.
    expect(container.innerHTML).not.toMatch(/132\s*,\s*0\s*,\s*255/);
  });
});


// TRAIN 1 GUARD (2026-08-12) — the add-a-part form must be reachable from the Lab, the app's ONLY
// live RigViewer mount. The PR #102 self-review caught the defect this pins: the Lab renders the
// viewer chromeless, chromeless hid the viewer's built-in form, so manual parts (manual-parts.ts,
// compy_rig_manual_parts, the user-added evidence fallback) were reachable in tests only — a user
// could not add the PSU or cooler Compy admits it cannot read. The form now lives in the Lab's own
// chrome (.lc-manual > RigManualParts); this block fails the build if it ever unmounts again.
describe("LabConsole — add a part (manual parts in the Lab's own chrome)", () => {
  // Slice 6 makes the form a DISCLOSURE — 04-test-approved.png draws "Add a part Compy can't
  // detect" as the station list's last row, not as an always-open form. It is a disclosure and
  // never a removal: the form stays MOUNTED when closed (`hidden`), which is what keeps the
  // TRAIN 1 guard above true, and this helper is the one click a user makes to reach it.
  const openManual = () => fireEvent.click(document.querySelector(".lc-route")!);

  it("mounts the add-a-part form in the Lab chrome, outside the chromeless viewer", () => {
    renderConsole();
    // MOUNTED even while closed — the defect this block exists for was the form UNMOUNTING, and a
    // disclosure that unmounted its body would re-ship it wearing a chevron.
    expect(document.querySelector(".lc-manual .rig-manual")).not.toBeNull();
    expect(document.querySelector<HTMLElement>(".lc-manual")!.hidden).toBe(true);
    openManual();
    expect(document.querySelector<HTMLElement>(".lc-manual")!.hidden).toBe(false);
    expect(screen.getByText("Add a part Compy can't detect:")).toBeInTheDocument();
    // The row's own label drops the form's trailing colon, as the comp draws it.
    expect(document.querySelector(".lc-route-nm")!.textContent).toBe("Add a part Compy can't detect");
  });

  it("adding a part from the Lab persists it and lists it as user-added", () => {
    renderConsole();
    openManual();
    const input = screen.getByPlaceholderText("e.g. Corsair RM850x");
    fireEvent.change(input, { target: { value: "Corsair RM850x" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(screen.getByText("Corsair RM850x")).toBeInTheDocument();
    expect(screen.getByText("user-added")).toBeInTheDocument();
    const stored = JSON.parse(localStorage.getItem("compy_rig_manual_parts") ?? "[]");
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe("Corsair RM850x");
    expect(stored[0].kind).toBe("psu");
  });

  it("removing the part from the Lab clears it from storage", () => {
    renderConsole();
    openManual();
    fireEvent.change(screen.getByPlaceholderText("e.g. Corsair RM850x"), {
      target: { value: "Noctua NH-D15" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.click(screen.getByRole("button", { name: /remove noctua nh-d15/i }));

    expect(screen.queryByText("Noctua NH-D15")).toBeNull();
    expect(JSON.parse(localStorage.getItem("compy_rig_manual_parts") ?? "[]")).toHaveLength(0);
  });
});

// TEST'S OWN READING SET (spec 2026-08-21-test-rig-reading-set) — Test used to repeat three of
// Health's four verdict numbers (Readiness, Avg FPS, 1% low) under the identical "Your rig" title,
// so a user who walked Health → Test saw the same instrument twice. The reading set below answers a
// different question — what has this BENCH proved, not what is the machine's verdict — and these
// guards are what makes the duplication unable to return.
describe("LabConsole — Test's own reading set (spec 2026-08-21-test-rig-reading-set)", () => {
  afterEach(async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockImplementation(() => Promise.resolve(null));
  });

  it("guard 1 — the four cells are exactly Proven · Noise floor · Instruments read · Safe stack, never Health's numbers", () => {
    renderConsole();
    const strip = document.querySelector(".lc-readings")!;
    // 04-test-approved.png prints READINESS, AVG FPS and 1% LOW in this strip. They are NOT
    // adopted and this guard is why: the handoff names them "the older duplicated Health metrics
    // shown in an early generated draft", and the comp itself says its values are examples, not a
    // licence. A picture is not a reason to move Health's verdict into Test.
    expect(strip.textContent).not.toContain("Readiness");
    expect(strip.textContent).not.toContain("Avg FPS");
    expect(strip.textContent).not.toContain("1% low");
    const readingLabel = (i: number) => reading(i).querySelector(".ag-label span")!.textContent;
    expect(readingLabel(0)).toBe("Proven");
    expect(readingLabel(1)).toBe("Noise floor");
    expect(readingLabel(2)).toBe("Instruments read");
    expect(readingLabel(3)).toBe("Safe stack");
    // ...and the strip sits UNDER the canvas, never over it. The handoff is explicit that the real
    // rig stays the focal surface and its canvas is not to be covered with click targets or
    // diagrams; four rings floating in its corners were doing exactly that.
    expect(document.querySelector(".lc-stage")!.contains(strip)).toBe(false);
  });

  it("guard 2 — cross-room duplication: Test's corner labels and Health's corner labels are disjoint (read from the i18n bundles)", () => {
    const labEn = JSON.parse(readFileSync(resolve("src/i18n/locales/en/lab.json"), "utf8"));
    const homeEn = JSON.parse(readFileSync(resolve("src/i18n/locales/en/home.json"), "utf8"));
    const testLabels: string[] = [
      labEn.labConsole.provenLabel,
      labEn.labConsole.noiseFloorLabel,
      labEn.labConsole.safeStackLabel,
      labEn.labConsole.instrumentsReadLabel,
    ];
    const healthLabels = new Set<string>([
      homeEn.homeConsole.stage.readinessLabel,
      homeEn.homeConsole.stage.avgFps,
      homeEn.homeConsole.stage.onePercentLow,
      homeEn.homeConsole.stage.gpuTemp,
    ]);
    expect(testLabels.filter((l) => healthLabels.has(l))).toEqual([]);
  });

  it("guard 3 — noise-floor source: the TR gauge must never read bench.efficacy.noise_floor_pct (a different measurement wearing the same field name)", () => {
    const src = readFileSync(resolve("src/surfaces/LabConsole.tsx"), "utf8");
    const line = src.split("\n").find((l) => l.includes("const noiseFloorPct ="));
    expect(line).toBeDefined();
    expect(line).not.toMatch(/bench(\?)?\.efficacy/);
    expect(line).toMatch(/trial/);
  });

  it("guard 4 — Proven and Noise floor are honest NOT-YET (never a fabricated 0) while the scoreboard/trial probes are unread", () => {
    renderConsole();
    expect(reading(0).querySelector(".ag-tag-ny")).not.toBeNull();
    expect(reading(1).querySelector(".ag-tag-ny")).not.toBeNull();
  });

  it("Proven reads the scoreboard's award count once loaded", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockImplementation((cmd: string) =>
      cmd === "get_scoreboard"
        ? Promise.resolve({ total_points: 30, awards: [{}, {}, {}], local_percentiles: [null, null, null] })
        : cmd === "get_session_summaries"
          ? Promise.resolve([])
          : Promise.resolve(null),
    );
    renderConsole();
    const tl = reading(0);
    await waitFor(() => expect(tl.querySelector(".ag-v")!.textContent).toBe("3"));
    expect(tl.querySelector(".ag-tag-ny")).toBeNull();
    // The gloss line under this ring is GONE (Codex REJECT 2026-08-27: the strip carried a unit
    // line AND a stamp AND an explanation under every cell, which is what made it denser and
    // taller than the composition). One supporting line remains, and here it is the stamp.
    expect(tl.querySelector(".ag-note")).toBeNull();
    expect(tl.querySelector(".ag-tag")!.textContent).toBe("measured");
  });

  it("Noise floor reads get_trial_state's noise_floor_pct once a calibration has produced one", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockImplementation((cmd: string) =>
      cmd === "get_trial_state"
        ? Promise.resolve({
            running: false,
            kind: "calibration",
            status: "done",
            collected: 20,
            target: 20,
            verdict: null,
            noise_floor_pct: 4,
            rolled_back: false,
            error: null,
          })
        : cmd === "get_session_summaries"
          ? Promise.resolve([])
          : Promise.resolve(null),
    );
    renderConsole();
    const tr = reading(1);
    await waitFor(() => expect(tr.querySelector(".ag-v")!.textContent).toBe("4"));
    expect(tr.querySelector(".ag-tag-ny")).toBeNull();
  });

  // s44 tester pass: with no calibration, the tile read "NOT YET" beside a Test-room line quoting the
  // game's measured noise. It reads that same measured figure (a Trial record's assumed_band).
  it("Noise floor reads the game's measured noise from its Trial records when no calibration exists", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockImplementation((cmd: string) =>
      cmd === "get_experiments"
        ? Promise.resolve([
            {
              id: "e1", rec_id: "visual-effects", rec_title: "x", game: "robrun.exe", created_at: "2026-11-11T10:00:00Z",
              concluded_at: "2026-11-11T11:00:00Z", verdict: "too-noisy", kept: false,
              assumed_band: { assumed_pct: 3, measured_low1_pct: 29, measured_sessions: 6 },
            },
          ])
        : cmd === "get_session_summaries"
          ? Promise.resolve([])
          : Promise.resolve(null),
    );
    renderConsole();
    const tr = reading(1);
    await waitFor(() => expect(tr.querySelector(".ag-v")!.textContent).toBe("29"));
    expect(tr.querySelector(".ag-tag-ny")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE STRIP'S RHYTHM — bug→guard for the Codex REJECT of candidate 9bef1cc2 (2026-08-27).
//
// The rejected build drew the reading set as four heavy rings, each carrying a unit line AND a
// MEASURED stamp AND an explanatory gloss. The approved composition draws arc · numeral · numeral ·
// arc with exactly ONE supporting line under each. Both halves are structural, not cosmetic:
//
//   the arcs   an arc says "this reading sits somewhere on a scale you can see". True of a count out
//              of a known total; false of a raw magnitude, where the ceiling is the caller's
//              invention. Drawing an invented ceiling as a filled arc is a claim, so the variant is
//              an honesty rule and belongs in a test rather than in a stylesheet comment.
//   one line   the stamp and the note share one grid row. Two of them in one cell would overlap,
//              silently, and the thing that would disappear under the other is a measurement.
//
// Neither guard may pass by the strip having been deleted, so each asserts its own population.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("the bench reading strip wraps at narrow window widths", () => {
  const css = readFileSync(resolve("src/surfaces/lab-console.css"), "utf8").replace(/\r\n/g, "\n");
  const start = css.indexOf("@media (max-width: 900px)");
  // The wrap rule is the first @media block after the strip's own rules; read just its body.
  const block = start < 0 ? "" : css.slice(start, css.indexOf("\n}\n", start));

  it("goes two by two under 900px so four rings never run into each other", () => {
    expect(start, "a max-width: 900px block exists in the hub's own stylesheet").toBeGreaterThan(-1);
    expect(block).toMatch(/\.lc-readings \{[^}]*grid-template-columns:\s*repeat\(2,/);
    expect(block).toMatch(/\.lc-readings \{[^}]*row-gap:/);
  });

  it("drops the dotted rule on the cell that starts the second row", () => {
    expect(block).toMatch(/\.lc-reading:nth-child\(odd\)::before \{[^}]*display:\s*none/);
  });
});

describe("the bench reading set keeps the approved rhythm", () => {
  const cells = () => Array.from(document.querySelectorAll(".lc-readings > .lc-reading"));

  it("draws arc · numeral · numeral · arc — a ring only where a real scale exists", () => {
    renderConsole();
    const drawn = cells().map((c) => (c.querySelector("svg .ag-track") ? "arc" : "numeral"));
    expect(drawn, "four cells, in the comp's own order").toEqual(["arc", "numeral", "numeral", "arc"]);
    // The numerals are not arcs that failed to render: they say so on the element itself.
    expect(cells()[1].querySelector(".arc-gauge")).toHaveClass("ag-as-numeral");
    expect(cells()[2].querySelector(".arc-gauge")).toHaveClass("ag-as-numeral");
    expect(cells()[0].querySelector(".arc-gauge")).toHaveClass("ag-as-ring");
    expect(cells()[3].querySelector(".arc-gauge")).toHaveClass("ag-as-ring");
  });

  it("gives every cell at most ONE supporting line, in every data state", () => {
    // Three states over the same strip: nothing probed (NOT-YET), recs with work left (a stamp),
    // and the whole stack applied (a note). If stamp and note could ever coexist, one of these
    // three is where it would happen.
    const applied = (recsFixture as Array<Record<string, unknown>>).map((r) => ({
      ...r,
      currently_applied: true,
    }));
    const states: Array<[string, typeof base]> = [
      ["nothing probed", { ...base, fast: { ...fast, recs: null as unknown as LabFastPathProps["recs"] } }],
      ["work left", base],
      ["all applied", { ...base, fast: { ...fast, recs: applied as never[] } }],
    ];
    for (const [name, props] of states) {
      cleanup();
      renderConsole(props);
      const seen = cells();
      expect(seen.length, `${name}: the strip must still be four cells`).toBe(4);
      for (const [i, cell] of seen.entries()) {
        const lines = cell.querySelectorAll(".ag-tag, .ag-grade, .ag-note").length;
        expect(lines, `${name}: cell ${i} drew ${lines} supporting lines, and the row holds one`)
          .toBeLessThanOrEqual(1);
      }
      // Anti-vacuous: at least one cell is actually saying something in each state.
      expect(
        seen.some((c) => c.querySelector(".ag-tag, .ag-grade, .ag-note")),
        `${name}: no cell said anything at all — this guard would pass on an empty strip`,
      ).toBe(true);
    }
  });

  it("keeps the honest states the density fix was not allowed to cost", () => {
    renderConsole();
    // NOT-YET still reachable (unread probes), and the strip never invents a zero for them.
    expect(reading(0).querySelector(".ag-tag-ny")).not.toBeNull();
    expect(reading(1).querySelector(".ag-tag-ny")).not.toBeNull();
    expect(reading(0).querySelector(".ag-v")!.textContent).not.toBe("0");
    // NO READING is the empty-state unit word, and it survived the unit trim.
    expect(document.querySelector(".lc-readings")!.textContent).toContain("no reading");
  });
});

// P6-timeline: "See what changed" pointers promise the Care view's "Since it last worked" list, so
// arriving there through one scans on arrival; opening the station by hand still waits for a click.
describe("LabConsole — Crash & Freeze Rescue scans on a promised arrival (P6-timeline)", () => {
  const report = {
    incidents: [],
    skipped_sources: [],
    since_last_worked: {
      anchor: null,
      none_reason: "none-clean",
      events: [],
      unplaced: [],
      open_drift: [
        {
          id: "drift:1",
          timestamp: "2026-10-22T10:00:00Z",
          event_type: "readiness-drift",
          source: "drift-watch",
          scope: "observed",
          game: null,
          summary: "Game Mode was found changed",
          detail: null,
          observed_between: null,
          since_rolled_back: false,
          rec_id: null,
        },
      ],
    },
  };
  const scans = () => vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "get_crash_blackbox").length;
  beforeEach(() => {
    vi.mocked(invoke).mockImplementation(((cmd: string) =>
      // Sessions must be a list: this test waits long enough for the console's own session read
      // to land, and the tuning evidence reads it as one.
      Promise.resolve(cmd === "get_crash_blackbox" ? report : cmd === "get_session_summaries" ? [] : null)) as never);
  });
  afterEach(() => {
    vi.mocked(invoke).mockImplementation((() => Promise.resolve(null)) as never);
    vi.mocked(invoke).mockClear();
    localStorage.clear();
  });

  it("a deep-link to the station scans on arrival and renders the list", async () => {
    localStorage.setItem("compy_lab_open_station", "blackbox");
    renderConsole();
    const list = await screen.findByRole("region", { name: "Since it last worked" });
    expect(scans()).toBe(1);
    expect(list.textContent).toContain("Still drifted now:");
    expect(list.textContent).toContain("Game Mode was found changed");
  });

  it("Check's drift pointer inside Optimize opens the station, which scans once and shows the list", async () => {
    vi.mocked(invoke).mockImplementation(((cmd: string) => {
      if (cmd === "get_crash_blackbox") return Promise.resolve(report);
      if (cmd === "get_session_summaries") return Promise.resolve([]);
      if (cmd === "get_game_readiness")
        return Promise.resolve({
          checks: [{ id: "a", label: "SSD check", status: "ready", detail: "", value: null }],
          ready_count: 1,
          attention_count: 0,
          unknown_count: 0,
          advisory_count: 0,
          advisory: "",
          dismissed_ids: [],
          drifts: [{ id: "game-mode", label: "Game Mode", detail: "Off.", noticed_at: "2026-10-22T10:00:00Z" }],
        });
      if (cmd === "get_priorities" || cmd === "priorities_from")
        return Promise.resolve({ limiters: [], already_fine: [], not_worth_touching: [], session_hint: null, upgrade_path: null });
      return Promise.resolve(null);
    }) as never);
    renderConsole();
    fireEvent.click(stationNode(/optimize/i));
    const pointer = await screen.findByRole("button", { name: "See what changed" }, { timeout: 5000 });
    expect(scans()).toBe(0);
    fireEvent.click(pointer);
    const list = await screen.findByRole("region", { name: "Since it last worked" });
    expect(scans()).toBe(1);
    expect(list.textContent).toContain("Still drifted now:");
  });

  it("opening the station by hand does not scan until asked", async () => {
    renderConsole();
    fireEvent.click(stationNode(/crash/i));
    expect(await screen.findByRole("button", { name: "Scan for recent crashes" })).toBeTruthy();
    expect(scans()).toBe(0);
  });
});

// P7-rig-care (ROADMAP P7 bullet 4, Constitution §24, §25): once the Care station has read the crash
// records, the newest assessed one drives the Lab rig — its rule's part highlighted, or the rig dimmed
// when it reads as the app itself — with one line saying which, in the rules' own "consistent with"
// frame. An open station draws no rig, so it shows when the user comes back to the room. Fails on the
// code before this slice (the rig ignored the record).
describe("P7-rig-care: the Care station's crash record picks out the part on the Lab rig", () => {
  const assessed = (when: string, rule: string, tag = "GPU stopped responding") => ({
    incident_id: `id-${when}`,
    headline: "h",
    tag,
    when,
    when_display: when,
    vitals: null,
    receipt: { source: "System", event_ids: [4101], faulting_app: null, faulting_module: "amdkmdag", code: null, detail: "" },
    assessment: {
      rule,
      consistent_with: "c",
      strength: "strong",
      evidence: ["e"],
      next_step: { headline: "Do a clean reinstall of your graphics driver", detail: "d", reversible: true, research_only: false },
      beyond_us: false,
    },
  });
  const withIncidents = (incidents: unknown[]) =>
    vi.mocked(invoke).mockImplementation(((cmd: string) =>
      Promise.resolve(
        cmd === "get_crash_blackbox"
          ? { incidents, skipped_sources: [] }
          : cmd === "get_session_summaries"
            ? []
            : null,
      )) as never);
  const rig = () => screen.getAllByTestId("rig-hologram")[0];
  /** Deep-link to Care (it scans on arrival), wait for the read, then come back to the room. */
  const scanThenBack = async () => {
    localStorage.setItem("compy_lab_open_station", "blackbox");
    renderConsole();
    await waitFor(() =>
      expect(vi.mocked(invoke).mock.calls.some(([cmd]) => cmd === "get_crash_blackbox")).toBe(true),
    );
    // Let the read resolve and the station hand its report up before leaving it.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    fireEvent.click(screen.getByRole("button", { name: /Back to Test/ }));
  };
  const note = () => document.querySelector('[data-testid="lc-rig-note"]');
  afterEach(() => {
    vi.mocked(invoke).mockImplementation((() => Promise.resolve(null)) as never);
    localStorage.clear();
  });

  it("a repeating graphics-driver timeout highlights the GPU and says so", async () => {
    withIncidents([assessed("2026-10-20T10:00:00Z", "app-specific"), assessed("2026-10-24T10:00:00Z", "graphics-driver")]);
    await scanThenBack();
    await waitFor(() => expect(rig().getAttribute("data-focus-id")).toBe("gpu-0"));
    expect(rig().getAttribute("data-dimmed")).toBe("0");
    expect(note()!.getAttribute("data-focus")).toBe("part");
    expect(note()!.textContent).toMatch(/consistent with its graphics driver timing out/);
    // Review r1 SHOULD-FIX 1: the line names its source and the record's own date.
    expect(note()!.textContent).toContain("crash scan (2026-10-24T10:00:00Z)");
  });

  it("an app-specific record dims the rig and says the app, not a part", async () => {
    withIncidents([assessed("2026-10-24T10:00:00Z", "app-specific", "App crash")]);
    await scanThenBack();
    await waitFor(() => expect(rig().getAttribute("data-dimmed")).toBe("1"));
    expect(rig().getAttribute("data-focus-id")).toBe("");
    expect(note()!.textContent).toMatch(/problem in the app itself, not a part/);
    expect(note()!.textContent).toContain("(2026-10-24T10:00:00Z)");
  });

  it("an ambiguous record (heat, power or memory) claims nothing", async () => {
    withIncidents([assessed("2026-10-24T10:00:00Z", "hardware-error", "Hardware error")]);
    await scanThenBack();
    await screen.findAllByTestId("rig-hologram");
    // The read DID land (so the nulls below are a decision, not a race): Care read the record.
    expect(vi.mocked(invoke).mock.calls.some(([cmd]) => cmd === "get_crash_blackbox")).toBe(true);
    expect(rig().getAttribute("data-focus-id")).toBe("");
    expect(rig().getAttribute("data-dimmed")).toBe("0");
    expect(note()).toBeNull();
  });

  it("without a crash read this visit the rig is its own", async () => {
    withIncidents([assessed("2026-10-24T10:00:00Z", "graphics-driver")]);
    renderConsole();
    await screen.findAllByTestId("rig-hologram");
    expect(rig().getAttribute("data-focus-id")).toBe("");
    expect(rig().getAttribute("data-dimmed")).toBe("0");
    expect(note()).toBeNull();
  });
});
