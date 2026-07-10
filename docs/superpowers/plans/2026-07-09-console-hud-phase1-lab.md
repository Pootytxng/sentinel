# Compy Console HUD — Phase 1 (Console kit + merged Optimize/Benchmark Lab) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.
> **Design source of truth:** `docs/superpowers/specs/2026-07-09-compy-console-hud-direction.md` (owner-
> approved 2026-07-09: the app-wide Ops Console HUD; Phase 1 = the shared Console kit + the merged Lab).
> **Visual reference:** <https://claude.ai/code/artifact/e2830b73-cfc0-43c6-b263-5b59a1075639> (Scene A).

**Goal:** Replace the Lab's rejected bento (`LabBench`) with **the Ops Console** — the real 3D rig
hologram at center, live arc-gauge readouts in the corners, and a **Dock** of stations (Optimize's
toggle tweaks as the glowing primary + the measure/prove stations), one detail panel open at a time —
behind the existing `compy_lab_ground` preview flag (DEFAULT OFF). Ship it for the owner's eyeball.

**Architecture:** App already swaps `LabV2`→`LabGround` when `compy_lab_ground` is on (App.tsx). This
phase keeps that swap and `LabGround`'s `RoomShell`/verdict, but **replaces `LabGround`'s body**:
instead of `<LabBench>` it renders a new **`LabConsole`**. A small reusable **Console kit** (`ArcGauge`,
`Sparkline`, `Dock`, `ReticleCursor`) is built first (Tasks 1–3, 5) and assembled into `LabConsole`
(Task 4). The measure-station bodies (Benchmark/Latency/Tuning/Black Box/Diagnostics) are the existing
components, opened one at a time. Optimize's apply is the existing audited `apply_recommendations_batch`
path via `OptimizeStation` (zero new IPC, zero new mutation primitive).

**Tech Stack:** React 19 + TS · existing `useCountTo` (`src/surfaces/lab/use-count-to.ts`, GSAP) ·
`RigViewer` (`src/surfaces/rig/RigViewer.tsx`, the self-contained 3D hologram) · `useReducedMotion`
(`src/design/use-motion`) · `RoomShell`/`HudMasthead` · vitest + @testing-library/react + tsc.
**Zero new dependencies.**

## Global Constraints

- **Flag:** `compy_lab_ground` stays the gate, **DEFAULT OFF** the entire phase. Flag OFF → App renders
  the untouched `LabV2` + `OptimizeV2` rooms → **byte-identical app** (already test-pinned in
  `src/surfaces/lab-ground.test.tsx`; that test must stay green untouched).
- **No `src-tauri` changes.** `git diff -- src-tauri` MUST be empty for this whole phase. No new IPC, no
  new mutation primitive. Optimize reuses the existing `LabFastPathProps` handlers.
- **HONESTY RAIL (LOCKED):** every animated/gauge value MUST trace to a real measured number. A gauge
  renders a number ONLY when its source exists; `value === null` ⇒ an honest **NOT YET** state, never a
  fabricated `0`. This is `useCountTo`'s existing `null` contract — reuse it, never bypass it.
- **Never gamer-RGB.** The theme accent (`--ix-accent`) is the only accent; the vendored MagicBento
  violet `132, 0, 255` must be unable to paint (there is an existing `lab-bento.test.tsx` vendor-purple
  pin pattern — mirror it for any vendored glow).
- **Reduced-motion:** all motion gated via `useReducedMotion()` (Compy's resolved reduced-motion, NOT
  the raw OS media query — [[motion-on-by-default-override-os]]). Reduced ⇒ static console: no reticle,
  no spotlight, no hover-lift, no reveal, gauges snap. A reduced path must exist and be test-pinned.
- **All new CSS scoped under `:root[data-v2="on"]`** (the flag-off byte-identity mechanism) and
  registered in `src/surfaces/tokens-v2-guard.test.ts`'s `V2_CSS` list — mirror how `lab-bench.css` was
  registered (the file this phase deletes).
- **Every UI task ends with `self-review`** (project law) before it may be called done; no done-claim
  without a quoted PASS. Green tsc/vitest is not a visual review.

---

### Task 1: `ArcGauge` — the honest ticked ring readout (Console kit)

**Files:**
- Create: `src/design/console/ArcGauge.tsx`, `src/design/console/arc-gauge.css`
- Test: `src/design/console/arc-gauge.test.tsx`

**Interfaces:**
- Consumes: `useCountTo(target: number | null, opts?: { reduced?: boolean }): number | null` from
  `src/surfaces/lab/use-count-to.ts`; `useReducedMotion(): boolean` from `src/design/use-motion`.
- Produces: `export function ArcGauge(props): JSX` where
  `props = { label: string; value: number | null; max: number; unit: string; tone?: "accent" | "warn" | "good" | "neutral"; measured?: boolean }`.
  `value === null` renders the honest NOT-YET state (no number). Later tasks render four of these.

- [ ] **Step 1: Write the failing test** `arc-gauge.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
vi.mock("../use-motion", () => ({ useReducedMotion: () => true })); // reduced ⇒ useCountTo snaps (deterministic)
import { ArcGauge } from "./ArcGauge";

describe("ArcGauge", () => {
  it("renders an honest NOT-YET state when value is null — never a fabricated number", () => {
    render(<ArcGauge label="GPU temp" value={null} max={100} unit="°C" />);
    expect(screen.getByText(/not yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/^\d+$/)).toBeNull(); // no numeric readout at all
  });
  it("renders the measured value + a 'measured' tag when a real value is present", () => {
    render(<ArcGauge label="Safe stack" value={7} max={9} unit="ready" measured />);
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText(/measured/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it, verify it fails.** Run: `npx vitest run src/design/console/arc-gauge.test.tsx` → FAIL (ArcGauge not defined).

- [ ] **Step 3: Implement `ArcGauge.tsx`:**

```tsx
import { useReducedMotion } from "../use-motion";
import { useCountTo } from "../../surfaces/lab/use-count-to";
import "./arc-gauge.css";

export type ArcTone = "accent" | "warn" | "good" | "neutral";
const R = 20;
const CIRC = 2 * Math.PI * R;
const TICKS = Array.from({ length: 24 }, (_, i) => {
  const a = (i / 24) * 2 * Math.PI - Math.PI / 2;
  return { x1: 28 + Math.cos(a) * 25, y1: 28 + Math.sin(a) * 25, x2: 28 + Math.cos(a) * 27.5, y2: 28 + Math.sin(a) * 27.5 };
});

export function ArcGauge({
  label, value, max, unit, tone = "neutral", measured = true,
}: {
  label: string; value: number | null; max: number; unit: string; tone?: ArcTone; measured?: boolean;
}) {
  const reduced = useReducedMotion();
  const shown = useCountTo(value, { reduced });     // null → null (honesty rail); reduced → snaps
  const empty = shown === null;
  const frac = empty ? 0 : Math.min(1, Math.max(0, shown / max));
  const dashoffset = CIRC * (1 - frac);
  return (
    <div className={`arc-gauge ag-${tone} ${empty ? "ag-empty" : ""}`}>
      <svg viewBox="0 0 56 56" aria-hidden="true">
        {TICKS.map((t, i) => <line key={i} className="ag-tick" x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} />)}
        <circle className="ag-track" cx="28" cy="28" r={R} />
        {!empty && (
          <circle className="ag-fill" cx="28" cy="28" r={R} transform="rotate(-90 28 28)"
            strokeDasharray={CIRC} strokeDashoffset={dashoffset} />
        )}
      </svg>
      <div className="ag-ctr">
        <div className="ag-v">{empty ? "— —" : Math.round(shown!)}</div>
        <div className="ag-u">{empty ? "no reading" : unit}</div>
      </div>
      <div className="ag-label">
        <span>{label}</span>
        {empty ? <span className="ag-tag ag-tag-ny">not yet</span>
               : measured ? <span className="ag-tag">measured</span> : null}
      </div>
    </div>
  );
}
export default ArcGauge;
```

- [ ] **Step 4: Write `arc-gauge.css`** (scoped under `:root[data-v2="on"]`, theme-token colors only — no hardcoded accent):

```css
/* Console kit — ArcGauge. Ticked ring readout; tone maps to a theme/semantic token, never a literal.
   Scoped under [data-v2="on"] (flag-off byte-identity; registered in tokens-v2-guard V2_CSS). */
:root[data-v2="on"] .arc-gauge { display: grid; grid-template-columns: auto 1fr; gap: 10px; align-items: center; }
:root[data-v2="on"] .arc-gauge > svg { width: 56px; height: 56px; grid-row: span 2; }
:root[data-v2="on"] .ag-tick { stroke: var(--ix-text-3); stroke-width: 1; opacity: .5; }
:root[data-v2="on"] .ag-track { fill: none; stroke: var(--ix-glass-border); stroke-width: 3; }
:root[data-v2="on"] .ag-fill { fill: none; stroke: var(--ix-accent); stroke-width: 3; stroke-linecap: round;
  transition: stroke-dashoffset .3s ease; }
:root[data-v2="on"] .ag-warn .ag-fill { stroke: var(--v2-warn, #ffb020); }
:root[data-v2="on"] .ag-good .ag-fill { stroke: var(--ready, #45d98a); }
:root[data-v2="on"] .ag-ctr { position: relative; grid-column: 1; grid-row: 1 / span 2;
  place-self: center; text-align: center; pointer-events: none; margin-left: -56px; width: 56px; }
:root[data-v2="on"] .ag-v { font-family: var(--ix-mono); font-size: 18px; font-weight: 600;
  color: var(--ix-text-1); font-variant-numeric: tabular-nums; line-height: 1; }
:root[data-v2="on"] .ag-empty .ag-v { color: var(--ix-text-3); }
:root[data-v2="on"] .ag-u { font-family: var(--ix-mono); font-size: 8px; letter-spacing: .1em;
  text-transform: uppercase; color: var(--ix-text-3); margin-top: 2px; }
:root[data-v2="on"] .ag-label { grid-column: 2; display: flex; flex-direction: column; gap: 4px;
  font-family: var(--ix-mono); font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--ix-text-2); }
:root[data-v2="on"] .ag-tag { align-self: flex-start; font-size: 8px; letter-spacing: .1em;
  padding: 1px 5px; border: 1px solid var(--ready); color: var(--ready); }
:root[data-v2="on"] .ag-tag-ny { border-color: var(--v2-warn, #ffb020); color: var(--v2-warn, #ffb020); }
```

- [ ] **Step 5: Run tsc + the test.** Run: `npm run build` then `npx vitest run src/design/console/arc-gauge.test.tsx`. Expected: tsc 0 errors; both tests PASS.

- [ ] **Step 6: Commit.** `git add src/design/console/ArcGauge.tsx src/design/console/arc-gauge.css src/design/console/arc-gauge.test.tsx && git commit -m "feat(console): ArcGauge — honest ticked ring readout (null=NOT YET), reuses useCountTo"`

---

### Task 2: `Sparkline` — a tiny inline-SVG trend (Console kit)

**Files:**
- Create: `src/design/console/Sparkline.tsx`
- Test: `src/design/console/sparkline.test.tsx`

**Interfaces:**
- Produces: `export function Sparkline(props): JSX` where
  `props = { values: number[]; tone?: "accent" | "muted"; dot?: boolean; w?: number; h?: number }`.
  Empty `values` renders nothing (no `NaN` path). Used by `ArcGauge` sides and `Dock` nodes later.

- [ ] **Step 1: Write the failing test** `sparkline.test.tsx`:

```tsx
import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Sparkline } from "./Sparkline";

describe("Sparkline", () => {
  it("renders a polyline with one point per value", () => {
    const { container } = render(<Sparkline values={[1, 2, 3, 4]} />);
    const pts = container.querySelector("polyline")?.getAttribute("points")?.trim().split(/\s+/);
    expect(pts).toHaveLength(4);
  });
  it("renders nothing for empty values (no NaN path)", () => {
    const { container } = render(<Sparkline values={[]} />);
    expect(container.querySelector("polyline")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, verify it fails.** Run: `npx vitest run src/design/console/sparkline.test.tsx`.

- [ ] **Step 3: Implement `Sparkline.tsx`:**

```tsx
export function Sparkline({
  values, tone = "accent", dot = true, w = 60, h = 18,
}: { values: number[]; tone?: "accent" | "muted"; dot?: boolean; w?: number; h?: number }) {
  if (!values.length) return null;
  const max = Math.max(...values) || 1;
  const n = values.length;
  const pts = values.map((v, i) => `${(i / Math.max(1, n - 1) * (w - 2) + 1).toFixed(1)},${(h - 1 - (v / max) * (h - 3)).toFixed(1)}`);
  const [lx, ly] = pts[pts.length - 1].split(",");
  const stroke = tone === "muted" ? "var(--ix-text-3)" : "var(--ix-accent)";
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" width={w} height={h} aria-hidden="true">
      <polyline points={pts.join(" ")} fill="none" stroke={stroke} strokeWidth="1" opacity="0.85" />
      {dot && <circle cx={lx} cy={ly} r="1.6" fill={stroke} />}
    </svg>
  );
}
export default Sparkline;
```

- [ ] **Step 4: Run tsc + the test.** Run: `npm run build` then `npx vitest run src/design/console/sparkline.test.tsx`. Expected: tsc 0; both PASS.

- [ ] **Step 5: Commit.** `git add src/design/console/Sparkline.tsx src/design/console/sparkline.test.tsx && git commit -m "feat(console): Sparkline — tiny inline-SVG trend (empty=render nothing)"`

---

### Task 3: `Dock` — the magnify station selector (Console kit)

**Files:**
- Create: `src/design/console/Dock.tsx`, `src/design/console/dock.css`
- Test: `src/design/console/dock.test.tsx`

**Interfaces:**
- Consumes: `useReducedMotion()`.
- Produces: `export function Dock(props): JSX` where
  `props = { nodes: DockNode[]; activeKey: string | null; onOpen: (key: string) => void }` and
  `export type DockNode = { key: string; name: string; icon?: string; primary?: boolean; measured?: boolean }`.
  Each node is a `<button>` (accessible name = `name`). The primary node gets `.dock-node-primary`.
  The grid carries `data-motion="reduced" | "full"`. `LabConsole` (Task 4) renders this.

- [ ] **Step 1: Write the failing test** `dock.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
vi.mock("../use-motion", () => ({ useReducedMotion: () => true }));
import { Dock } from "./Dock";

const nodes = [
  { key: "optimize", name: "Optimize", primary: true },
  { key: "bench", name: "Benchmark" },
];

describe("Dock", () => {
  it("renders a button per node and marks the primary", () => {
    render(<Dock nodes={nodes} activeKey={null} onOpen={() => {}} />);
    expect(screen.getByRole("button", { name: /optimize/i })).toHaveClass("dock-node-primary");
    expect(screen.getByRole("button", { name: /benchmark/i })).toBeInTheDocument();
  });
  it("fires onOpen with the node key on click", () => {
    const onOpen = vi.fn();
    render(<Dock nodes={nodes} activeKey={null} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: /benchmark/i }));
    expect(onOpen).toHaveBeenCalledWith("bench");
  });
  it("marks reduced-motion so bays render static", () => {
    const { container } = render(<Dock nodes={nodes} activeKey={null} onOpen={() => {}} />);
    expect(container.querySelector(".dock")).toHaveAttribute("data-motion", "reduced");
  });
});
```

- [ ] **Step 2: Run it, verify it fails.** Run: `npx vitest run src/design/console/dock.test.tsx`.

- [ ] **Step 3: Implement `Dock.tsx`:**

```tsx
import { useReducedMotion } from "../use-motion";
import "./dock.css";

export type DockNode = { key: string; name: string; icon?: string; primary?: boolean; measured?: boolean };

export function Dock({ nodes, activeKey, onOpen }: {
  nodes: DockNode[]; activeKey: string | null; onOpen: (key: string) => void;
}) {
  const reduced = useReducedMotion();
  return (
    <div className="dock" data-motion={reduced ? "reduced" : "full"}>
      {nodes.map((n) => (
        <button
          key={n.key}
          type="button"
          className={`dock-node ${n.primary ? "dock-node-primary" : ""} ${activeKey === n.key ? "dock-node-active" : ""}`}
          aria-pressed={activeKey === n.key}
          onClick={() => onOpen(n.key)}
        >
          {n.icon && <span className="dock-ic" aria-hidden="true">{n.icon}</span>}
          <span className="dock-nm">{n.name}</span>
          <span className={`dock-led ${n.measured ? "dock-led-on" : ""}`} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
export default Dock;
```

- [ ] **Step 4: Write `dock.css`** (scoped, CSS hover-lift; the neighbor-magnify + spotlight land in Task 5):

```css
/* Console kit — Dock. Game-style action bar of station nodes; the primary node glows in the theme
   accent (never gamer-RGB). Scoped under [data-v2="on"]; registered in tokens-v2-guard V2_CSS. */
:root[data-v2="on"] .dock { display: flex; justify-content: center; align-items: flex-end; gap: 9px; padding: 6px; }
:root[data-v2="on"] .dock-node { position: relative; display: grid; place-items: center; gap: 3px;
  min-width: 78px; padding: 12px 10px 10px; background: var(--ix-glass-fill);
  border: 1px solid var(--ix-glass-border); border-top-color: var(--ix-glass-top); color: var(--ix-text-2);
  font-family: var(--ix-mono); cursor: pointer;
  clip-path: polygon(0 0, 100% 0, 100% calc(100% - 7px), calc(100% - 7px) 100%, 0 100%);
  transition: transform .16s ease, border-color .16s, color .16s; }
:root[data-v2="on"] .dock-node .dock-ic { font-size: 18px; line-height: 1; }
:root[data-v2="on"] .dock-node .dock-nm { font-size: 9px; letter-spacing: .06em; text-transform: uppercase; color: var(--ix-text-3); }
:root[data-v2="on"] .dock-node .dock-led { position: absolute; right: 7px; top: 7px; width: 5px; height: 5px;
  border-radius: 50%; border: 1px solid var(--ix-glass-border); }
:root[data-v2="on"] .dock-node .dock-led-on { background: var(--ready); border-color: var(--ready); box-shadow: 0 0 6px var(--ready); }
:root[data-v2="on"] .dock[data-motion="full"] .dock-node:hover { transform: translateY(-8px); border-color: var(--ix-accent); color: var(--ix-text-1); }
:root[data-v2="on"] .dock-node-primary { border-color: var(--ix-accent); color: var(--ix-accent); }
:root[data-v2="on"] .dock-node-primary .dock-nm { color: var(--ix-accent); }
:root[data-v2="on"] .dock-node-active { border-color: var(--ix-accent); }
```

- [ ] **Step 5: Run tsc + the test.** Run: `npm run build` then `npx vitest run src/design/console/dock.test.tsx`. Expected: tsc 0; all 3 PASS.

- [ ] **Step 6: Commit.** `git add src/design/console/Dock.tsx src/design/console/dock.css src/design/console/dock.test.tsx && git commit -m "feat(console): Dock — magnify station selector (primary glows theme accent, reduced-motion static)"`

---

### Task 4: `LabConsole` — assemble the Ops Console; replace the bento; wire + delete

**Files:**
- Create: `src/surfaces/LabConsole.tsx`, `src/surfaces/lab-console.css`
- Modify: `src/surfaces/LabGround.tsx` (render `<LabConsole>` instead of `<LabBench>`; thread `hw`),
  `src/App.tsx` (pass `hw={hw}` to `<LabGround>` — grep `LabGround`; App already holds `hw: HardwareInfo`),
  `src/surfaces/tokens-v2-guard.test.ts` (swap `lab-bench.css` → `lab-console.css` + add the three kit CSS
  files to `V2_CSS`)
- Delete: `src/surfaces/LabBench.tsx`, `src/surfaces/lab-bench.css`, `src/surfaces/lab-bench.test.tsx`
- Test: `src/surfaces/lab-console.test.tsx` (relocate the fact/prop fixtures from `lab-bench.test.tsx`
  BEFORE deleting it)

**Interfaces:**
- Consumes: `LabFastPathProps` (from `lab/OptimizeStation`), `HardwareInfo` (from `../App`), `RigViewer`
  (`rig/RigViewer.tsx`, `<RigViewer hw={hw} />` — self-contained), `ArcGauge`/`Dock`/`DockNode` (kit),
  the measure bodies `BenchmarkTab` (`Benchmark.tsx`, prop `provingGround`), `LatencyTab`
  (`Latency.tsx`), `BlackBox` (`BlackBox.tsx`, prop `onReport`), `TuningInstrument`
  (`TuningInstrument.tsx`), the `diagnostics: ReactNode` prop, `LAB_STATIONS`/`LAB_STATION_ORDER`/
  `LabStationKey`/`LabStationFacts` (`lab-guided-data.ts`), `stationHasReading` (`lab-bento-data.ts`),
  `safeFixesReady` (`optimize-v2-data.ts`), `deriveReverted` (`use-scan.ts`), `peekProbe`/`cachedProbe`
  (`data/probe-cache.ts`), `measureTuning`/`tuningEvidence` (`data/tuning-measure.ts`),
  `tuningGuideForVendor` (`data/tuning-guides.ts`), `useReducedMotion`.
- Produces: `export function LabConsole(props): JSX` with the same prop shape `LabBench` had:
  `{ fast: LabFastPathProps; diagnostics?: ReactNode; diagnosticsCaptured?: boolean; vendor?: GpuVendor; hw: HardwareInfo }`.

- [ ] **Step 1: Relocate fixtures + write the failing test.** Copy the fact/prop fixtures out of
  `src/surfaces/lab-bench.test.tsx` into a new `src/surfaces/lab-console.test.tsx` (same `recs`/`changes`/
  `isAppliable`/`diagnostics` fixtures; add a minimal `hw` fixture — copy the `hw` shape from
  `src/surfaces/home-v2.test.tsx`). Then assert the console contract:

```tsx
// lab-console.test.tsx (fixtures relocated from lab-bench.test.tsx)
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
vi.mock("../design/use-motion", () => ({ useReducedMotion: () => true }));
// RigViewer pulls in the ~600KB three bundle lazily — stub it so the console test stays a DOM test.
vi.mock("./rig/RigViewer", () => ({ RigViewer: () => <div data-testid="rig-hologram" /> }));
import { LabConsole } from "./LabConsole";
import { recsFixture, changesFixture, isAppliableFixture, hwFixture } from "./__fixtures__/lab"; // or inline

const base = {
  fast: { recs: recsFixture, changes: changesFixture, isAppliable: isAppliableFixture, vendor: "any",
          onApplyBatch: vi.fn(), onToggleRec: vi.fn(), onRollback: vi.fn() },
  diagnostics: <div>diag</div>, diagnosticsCaptured: true, vendor: "any" as const, hw: hwFixture,
};

describe("LabConsole", () => {
  it("renders the recognizable rig hologram at center", () => {
    render(<LabConsole {...base} />);
    expect(screen.getByTestId("rig-hologram")).toBeInTheDocument();
  });
  it("renders a dock node for every Lab station (no gallery) with Optimize as the primary", () => {
    render(<LabConsole {...base} />);
    expect(screen.getByRole("button", { name: /optimize/i })).toHaveClass("dock-node-primary");
    expect(screen.getByRole("button", { name: /benchmark/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /gallery/i })).toBeNull();
  });
  it("opens the Optimize enable-all when its dock node is clicked", () => {
    render(<LabConsole {...base} />);
    fireEvent.click(screen.getByRole("button", { name: /optimize/i }));
    expect(screen.getByRole("button", { name: /apply all safe/i })).toBeInTheDocument(); // OptimizeStation's enable-all
  });
  it("shows an honest NOT-YET gauge when a reading is absent (no fabricated number)", () => {
    render(<LabConsole {...base} />);
    expect(screen.getAllByText(/not yet/i).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it, verify it fails.** Run: `npx vitest run src/surfaces/lab-console.test.tsx` → FAIL (LabConsole not defined).

- [ ] **Step 3: Implement `LabConsole.tsx`.** Port the measure-station reads + facts VERBATIM from the
  deleted `LabBench.tsx` (the probe `useEffect`, `measureTuning`, `safeReady`/`stackApplied`,
  `measureKeys`, `stationBody` switch, `openStation` one-at-a-time state) — that logic is correct and
  unchanged; only the RENDER changes from a bento grid to the console. The new render:

```tsx
// structure (port the data/probe logic from the old LabBench.tsx unchanged):
return (
  <div className="lab-console" data-motion={reduced ? "reduced" : "full"}>
    <p className="lab-console-lede">
      Your rig's console. Everything here only <em>reads</em> — measure freely. The one tap that
      changes anything snapshots its undo first.
    </p>

    {/* CONSOLE STAGE — bracketed frame, real 3D hologram center, four corner arc gauges */}
    <div className="lc-stage">
      <span className="lc-brk lc-brk-tl" /><span className="lc-brk lc-brk-tr" />
      <span className="lc-brk lc-brk-bl" /><span className="lc-brk lc-brk-br" />
      <div className="lc-corner lc-tl"><ArcGauge label="Readiness" value={readinessScore} max={100} unit="score" tone="accent" /></div>
      <div className="lc-corner lc-tr"><ArcGauge label="Avg FPS" value={avgFps} max={240} unit="fps" measured={avgFps != null} /></div>
      <div className="lc-corner lc-bl"><ArcGauge label="Safe stack" value={safeReady} max={Math.max(1, safeReady)} unit="ready" tone="accent" /></div>
      <div className="lc-corner lc-br"><ArcGauge label="1% low" value={lowFps} max={240} unit="frames" tone="warn" measured={lowFps != null} /></div>
      <div className="lc-rig"><RigViewer hw={hw} /></div>
    </div>

    {/* DOCK — Optimize primary + the measure stations */}
    <Dock nodes={dockNodes} activeKey={openStation} onOpen={onDockOpen} />

    {/* ONE open panel: Optimize (inline OptimizeStation) OR a measure body */}
    {openStation && (
      <div className="lc-detail lab-card" id="lab-console-detail">
        <div className="lc-detail-head">
          <span className="lc-detail-name">{LAB_STATIONS[openStation].name}</span>
          <button className="lc-detail-close" onClick={() => setOpenStation(null)} aria-label="Close station">Close</button>
        </div>
        <div className="lab-card-body">
          {openStation === "optimize" ? <OptimizeStation {...fast} /> : stationBody(openStation)}
        </div>
      </div>
    )}
  </div>
);
```

  Data notes (HONESTY RAIL — read the real field names in `src/types.ts`; if a field is absent pass
  `null`, never `0`): `readinessScore` = the readiness score from `readiness` (`GameReadiness`) if
  present else `null`; `avgFps`/`lowFps` = the average-fps / 1%-low fields from the latest
  `bench` (`BenchmarkState`) or session if present else `null`; `safeReady` = the existing `safeReady`
  count (always a number). `dockNodes: DockNode[]` = `[{ key: "optimize", name: LAB_STATIONS.optimize.name,
  icon: "⛭", primary: true, measured: stackApplied || safeReady > 0 }, ...measureKeys.map(k => ({ key: k,
  name: LAB_STATIONS[k].name, icon: STATION_ICON[k], measured: stationHasReading(k, facts) }))]`. Reuse
  the `STATION_ICON` map from the guided/bento data if present, else define a small local one.
  `onDockOpen(k)` = the old `openMeasure` toggle, generalized to include `"optimize"` (Optimize opens the
  panel too — it is NOT always-on; that dominating always-on form was the rejected problem).

- [ ] **Step 4: Write `lab-console.css`** — the stage grid (relative box, `min-height` ~ 380px, the rig
  centered via `place-items: center`, the four `.lc-corner` absolutely positioned, `.lc-brk` corner
  brackets), the lede, and the detail panel. Scope EVERY selector under `:root[data-v2="on"]`. Model the
  corner/bracket/detail styling on the deleted `lab-bench.css` (same tokens: `--ix-glass-fill`,
  `--ix-glass-border`, `--ix-accent`, `--ix-radius`). No accent FILLS behind text (no ink-contrast hazard).

- [ ] **Step 5: Wire `LabGround.tsx`.** Change the import `LabBench` → `LabConsole`; add `hw: HardwareInfo`
  to `LabGround`'s props (import the type from `../App`); render `<LabConsole fast={fast} diagnostics={diagnostics}
  diagnosticsCaptured={diagnosticsCaptured} vendor={vendor} hw={hw} />` in place of `<LabBench .../>`. Leave
  the `RoomShell`/verdict/`HudMasthead`/`DecryptedText` header untouched.

- [ ] **Step 6: Thread `hw` in `App.tsx`.** Grep `<LabGround` and add `hw={hw}` to that element (App already
  passes `hw` to `HomeV2`/`HomeHud`). No other App change.

- [ ] **Step 7: Delete the bento + re-register CSS.** Delete `LabBench.tsx`, `lab-bench.css`,
  `lab-bench.test.tsx`. In `src/surfaces/tokens-v2-guard.test.ts` remove `lab-bench.css` from `V2_CSS` and
  add `../design/console/arc-gauge.css`, `../design/console/dock.css`, and `lab-console.css` (match the
  existing path style in that array).

- [ ] **Step 8: Run tsc + full vitest.** Run: `npm run build` then `npx vitest run`. Expected: tsc 0;
  `lab-console.test.tsx` green; `tokens-v2-guard.test.ts` green (new CSS registered + scoped); the
  flag-off byte-identity test `src/surfaces/lab-ground.test.tsx` still green **unchanged** (App renders
  `LabV2` when the flag is off — this task never touched that path); overall count drops the deleted
  `lab-bench.test.tsx` and adds `lab-console.test.tsx`.

- [ ] **Step 9: Confirm boundary + commit.** Run: `git diff -- src-tauri` → empty. Then:
  `git add -A && git commit -m "feat(lab): Ops Console replaces the bento — 3D hologram center + arc gauges + station Dock (flag OFF)"`

---

### Task 5: Bring the console ALIVE — accent spotlight + staggered reveal + reticle Target Cursor

**Files:**
- Modify: `src/surfaces/LabConsole.tsx`, `src/surfaces/lab-console.css`
- Create: `src/design/console/ReticleCursor.tsx`, `src/design/console/reticle.css`
- Test: `src/design/console/reticle.test.tsx`, extend `src/surfaces/lab-console.test.tsx`

**Interfaces:**
- Produces: `export function ReticleCursor(props): JSX | null` where
  `props = { scopeRef: React.RefObject<HTMLElement> }` — a Target Cursor that follows the pointer and
  snaps (corner-spread) over `[data-target]`/`button` elements INSIDE `scopeRef`; renders `null` under
  reduced-motion or coarse pointer (native cursor stays). Stage-scoped: `cursor: none` applies only
  while the pointer is inside `scopeRef` (toggle a class on it), never app-wide.

- [ ] **Step 1: Write the failing tests.**
  `reticle.test.tsx`: under reduced motion the component renders `null` (native cursor preserved).

```tsx
import { render } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { createRef } from "react";
vi.mock("../use-motion", () => ({ useReducedMotion: () => true }));
import { ReticleCursor } from "./ReticleCursor";
it("renders nothing under reduced motion (native cursor preserved)", () => {
  const { container } = render(<ReticleCursor scopeRef={createRef()} />);
  expect(container.firstChild).toBeNull();
});
```

  Extend `lab-console.test.tsx` (reduced-motion static + no vendor purple): assert the console root carries
  `data-motion="reduced"` (mock already returns reduced) and that no inline style or class token equals the
  vendor purple `132, 0, 255` anywhere in the rendered tree (mirror the `lab-bento.test.tsx` vendor-purple pin).

- [ ] **Step 2: Run them, verify they fail.** Run: `npx vitest run src/design/console/reticle.test.tsx src/surfaces/lab-console.test.tsx`.

- [ ] **Step 3: Implement `ReticleCursor.tsx`** — a `position: fixed` reticle (four corner brackets + a
  center dot) that lerps toward the pointer via `requestAnimationFrame`; on `pointerover` a `[data-target],
  button` inside `scopeRef` it adds `.snap` (scale up); it toggles a `lc-has-reticle` class on `scopeRef`
  on enter/leave (that class sets `cursor: none` on the stage only). Early-return `null` when
  `useReducedMotion()` or `matchMedia("(pointer: coarse)").matches`. Clean up listeners + rAF on unmount.

- [ ] **Step 4: Add the reactivity to `lab-console.css`** (all under `:root[data-v2="on"] .lab-console[data-motion="full"]`):
  a cursor-follow **accent spotlight** on `.lc-stage` (a radial-gradient masked to the border, driven by
  `--glow-x/--glow-y` custom props set by a pointer handler — port the exact mechanism from the deleted
  `lab-bench.css` `.lab-bench-card::after`, retuned to the stage); a **staggered mount reveal**
  (`@keyframes` with per-element `animation-delay` via a `--i` index custom prop, `animation-fill-mode:
  backwards` NOT `both` — the `both`/`forwards` bug the bench hit permanently blocks `:hover`); and the
  `[data-motion="reduced"]` branch that zeroes all of it (no spotlight, no reveal, `animation: none`).
  Wire the reticle into `LabConsole` with a `scopeRef` on `.lc-stage`.

- [ ] **Step 5: Run tsc + the tests.** Run: `npm run build` then `npx vitest run src/design/console src/surfaces/lab-console.test.tsx`. Expected: tsc 0; reticle-null-under-reduced PASS; reduced-motion + vendor-purple pins PASS.

- [ ] **Step 6: `git diff -- src-tauri` empty. Commit.** `git add -A && git commit -m "feat(lab): console comes alive — accent spotlight + staggered reveal + reticle Target Cursor (reduced-motion static)"`

---

### Task 6: Self-review + ship behind the flag + owner eyeball

**Files:** none (verification + ship only)

- [ ] **Step 1: Run the `self-review` skill** on the Lab console (dispatches `self-reviewer` at native
  1500×980, flag `compy_lab_ground` ON). It must prove, with computed evidence: the 3D hologram reads as a
  recognizable PC at center; four corner gauges present with the honest NOT-YET on any unmeasured one; the
  Dock leads with Optimize as the glowing primary (theme accent, never vendor purple); clicking Optimize
  opens the enable-all panel (not an always-on dominating form); measure stations open one at a time; the
  reticle snaps to targets; reduced-motion renders a flat static console; verdict headline legible. Do NOT
  claim done without a quoted PASS. (Note: this is a WebView2 build — perf-verify the 3D + spotlight on the
  installed build per [[dev-build-not-a-perf-test]], GL-draw idle-rest probe per the self-review rubric.)

- [ ] **Step 2: Full verify.** Run: `npm run build` (tsc 0) · `npx vitest run` (all green, note the new
  count) · `cargo test --manifest-path src-tauri/Cargo.toml` (unchanged count — no src-tauri diff) ·
  `git diff -- src-tauri` empty.

- [ ] **Step 3: Build + silent-reinstall via the `ship` skill** (`scripts/ship-reinstall.ps1`) —
  stamp-verify live == HEAD via the embedded `COMPY_GIT_HASH`, one installer on the Desktop
  ([[silent-reinstall-is-my-job]]).

- [ ] **Step 4: Update state docs** in the ship-docs commit: `docs/RELEASE_STATE.md` Snapshot row,
  `docs/BACKLOG.md` steering-log entry, `docs/UI_VISION_BACKLOG.md` §C.

- [ ] **Step 5: Owner eyeball.** Tell the owner: flip **Settings → Appearance → "Lab proving ground
  (preview)"**, open the **Lab** tab, react to the Ops Console. This is the taste gate before default-on and
  before the per-tab rollout (Phases 2…N). Surface the two open calls from the spec: does the Optimize panel
  open-on-click feel right (vs always-visible), and drop the standalone Optimize tab at default-on?

---

## Phases 2…N (sketch — each gets its own plan AFTER the P1 eyeball)

Per the spec's build order (Lab first, then per-tab). Each rolls the **same Console kit** to one tab,
tailored to its features, behind that tab's preview flag, ending in a `self-review` PASS + the
"no-generic-slop-remains" exit check: **Home** (console cold-open) · **Monitor** (gauges + a real
`Oscilloscope` kit component bound to live telemetry) · **History/Black Box** (flight-recorder log) ·
**Gaming Mode** (arm/engage console) · **Settings/Setup** (quiet console chrome) · then app-wide viewport
HUD frame + global reticle once every tab has adopted the language.

## Self-Review (plan vs spec) — done
- Spec coverage: Console kit (T1–T3, T5) ✓ · real 3D hologram center (T4, `RigViewer`) ✓ · arc gauges +
  honesty rail (T1 + T4 null-when-unmeasured) ✓ · Dock nav replacing wide boxes (T3/T4) ✓ ·
  Optimize+Benchmark merged, each individually accessible, Optimize opens-not-dominates (T4) ✓ · bolder
  reactivity + reticle (T5) ✓ · flag-OFF byte-identity / zero-src-tauri / reduced-motion / no-vendor-purple
  rails (Global Constraints + T4/T5 pins) ✓ · self-review + ship + eyeball gate (T6) ✓.
- Placeholder scan: no "TBD"/"handle edge cases"; the one deliberate "read the real field names in
  types.ts, pass null if absent" is the honesty rail, not a placeholder (inventing field names would be
  worse than instructing the honest lookup).
- Type consistency: `useCountTo(target: number|null, {reduced})` · `ArcGauge{value:number|null}` ·
  `DockNode{key,name,icon?,primary?,measured?}` · `Dock{nodes,activeKey,onOpen}` · `RigViewer{hw}` ·
  `LabConsole{fast,diagnostics?,diagnosticsCaptured?,vendor?,hw}` used consistently across tasks.
