import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { readFileSync } from "fs";
import { resolve } from "path";

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
  }: {
    // Both arguments, exactly as the real viewer emits them: the id AND which of the three drawn
    // lists it came from. A mock that emitted the id alone let the console's fan / user-added
    // branches go untested — that gap is what shipped a click that highlighted a part and then
    // showed nothing.
    onSelectedIdChange?: (id: string | null, what: RigSelection | null) => void;
  }) => (
    <div data-testid="rig-hologram">
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
// Index order is the same order those corners read in: Proven · Noise floor · Safe stack ·
// Instruments read — and guard 1 below still pins exactly that.
// TWO handles on ONE door since slice 6: the comp's "Start with Optimize" primary and the
// "Optimize · Start here" row in the station list both call the same setter, so a bare
// /optimize/i role query now matches both. Tests about the LIST say so with this.
const stationNode = (re: RegExp) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>(".dock-node")).find((b) =>
    re.test(b.textContent ?? ""),
  )!;

const reading = (i: number) => document.querySelectorAll(".lc-readings > .lc-reading")[i]!;

// The open station's NAME. Since the bento conversion it is the enclosing <BentoTile>'s title rather
// than a hand-rolled .lc-detail-name — the panel head is the tile's, so the assertion reads it there.
const openStationName = () =>
  document.querySelector(".lc-detail")?.closest(".v2-tile")?.querySelector(".v2-tile-title")
    ?.textContent;

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

  it("clicking a measure station opens exactly one detail; another swaps; same one closes", () => {
    renderConsole();
    fireEvent.click(screen.getByRole("button", { name: /benchmark/i }));
    expect(document.querySelectorAll(".lc-detail")).toHaveLength(1);
    expect(openStationName()).toBe("Benchmark");
    fireEvent.click(screen.getByRole("button", { name: /latency/i }));
    expect(document.querySelectorAll(".lc-detail")).toHaveLength(1);
    expect(openStationName()).toBe("Latency");
    fireEvent.click(screen.getByRole("button", { name: /latency/i }));
    expect(document.querySelector(".lc-detail")).toBeNull();
  });

  it("shows an honest NOT-YET gauge when a reading is absent (no fabricated number)", () => {
    renderConsole();
    expect(screen.getAllByText(/not yet/i).length).toBeGreaterThan(0);
  });

  it("the safe-stack gauge shows the real remaining count when recs are loaded", () => {
    renderConsole();
    // Two unapplied safe recs in the fixture → the gauge reads "2 · measured", never NOT-YET.
    const bl = reading(2);
    expect(bl.textContent).toContain("Safe stack");
    expect(bl.querySelector(".ag-v")!.textContent).toBe("2");
    expect(bl.querySelector(".ag-tag-ny")).toBeNull(); // NOT the NOT-YET tag
  });

  // Intimidation pass 2026-08-21: with the whole safe stack applied the gauge used to read
  // "0 ready" on an empty ring — the room's bottom-left alarm. Same recs, read as done.
  it("the safe-stack gauge reads 'N on · = all N applied' on a full ring once nothing is left to apply", () => {
    const applied = (recsFixture as Array<Record<string, unknown>>).map((r) => ({ ...r, currently_applied: true }));
    renderConsole({ ...base, fast: { ...fast, recs: applied as never[] } });
    const bl = reading(2);
    expect(bl.querySelector(".ag-v")!.textContent).toBe("2");
    expect(bl.textContent).toContain("on");
    expect(bl.textContent).not.toContain("ready");
    expect(bl.querySelector(".ag-note")!.textContent).toBe("= all 2 applied");
    expect(bl.querySelector(".ag-tag-ny")).toBeNull();
    // The ring is full: dashoffset 0 (ArcGauge draws CIRC * (1 - frac)).
    const fill = bl.querySelector<SVGCircleElement>(".ag-fill")!;
    expect(Number.parseFloat(fill.style.strokeDashoffset || fill.getAttribute("stroke-dashoffset") || "1")).toBeCloseTo(0, 3);
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
    expect(primary.querySelector(".dock-hint")!.textContent).toBe(
      "You just want it faster and safe, without fiddling.",
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
    const bl = reading(2);
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
    fireEvent.click(screen.getByRole("button", { name: /benchmark/i }));
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

  it("guard 1 — the four corners are exactly Proven · Noise floor · Safe stack · Instruments read, never Health's numbers", () => {
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
    expect(readingLabel(2)).toBe("Safe stack");
    expect(readingLabel(3)).toBe("Instruments read");
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
    expect(tl.querySelector(".ag-note")!.textContent).toBe("= verified before and after");
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
});
