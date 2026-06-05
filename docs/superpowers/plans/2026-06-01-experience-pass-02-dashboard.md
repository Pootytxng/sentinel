# Experience Pass — Dashboard Surface Implementation Plan (sub-project #2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **⚠️ EXECUTION GATE:** Touches product code (`src/`). Per spec Decision E, **do not execute until the
> owner green-lights.** **Prerequisites:** sub-project #1 (design-system foundation — primitives in
> `src/design/`) and sub-project #3 (SystemPosture derivation). This plan consumes a precomputed
> posture as a prop, so it is independently buildable/testable once #1 exists; #3 wires the live
> derivation in `App.tsx`. See `docs/superpowers/specs/2026-06-01-experience-design-system-pass-design.md`.

**Goal:** Rebuild the Dashboard (the `Overview` tab) as the home-base landing view that answers the
7 product questions at a glance, composed entirely from the `src/design/` primitives.

**Architecture:** A new `src/surfaces/Dashboard.tsx` consumes the app's existing read-only state
(`hw`, `recs`, `changes`, `readiness`, `priorities`, `sessions`) plus a precomputed `DashboardPosture`
prop, and renders a posture hero + a grid of question-cards using the primitives. Pure data-shaping
lives in a tested `dashboard-data.ts`. `App.tsx`'s inline `Overview` block is replaced with
`<Dashboard/>`. No data fetching or mutation is added — presentation only.

**Tech Stack:** React 19, TS 5.8, Vite 7, Vitest + @testing-library/react (from sub-project #1).

---

## File structure (this plan)

- Create: `src/surfaces/dashboard-data.ts` — pure selectors over existing state. **Unit-tested.**
- Create: `src/surfaces/dashboard-data.test.ts`
- Create: `src/surfaces/Dashboard.tsx` — the surface, built on `src/design/` primitives.
- Create: `src/surfaces/Dashboard.css`
- Create: `src/surfaces/Dashboard.test.tsx` — render-smoke.
- Modify: `src/App.tsx` — replace the inline `Overview` render with `<Dashboard .../>` and pass state.

> The existing types (`HardwareInfo`, `Recommendation`, `AppliedChange`, `GameReadiness`,
> `Priorities`, `PriorityItem`, `SessionSummary`) already live in `App.tsx`. Task 0 extracts the ones
> this surface needs into a shared `src/types.ts` so both `App.tsx` and `src/surfaces/` import them
> without a circular dependency.

---

## Task 0: Extract shared types

**Files:**
- Create: `src/types.ts`
- Modify: `src/App.tsx` (import from `./types` instead of local declarations for the moved types)

- [ ] **Step 1: Create `src/types.ts`** — move these verbatim from `App.tsx` (keep field names exact):

```ts
export type ReadinessStatus = "ready" | "attention" | "unknown";
export type PriorityStatus = "ready" | "attention" | "unknown";
export type Confidence = "high" | "medium" | "low";

export type AppliedChange = {
  id: string;
  rec_id: string;
  rec_title: string;
  applied_at: string;
  snapshot: unknown;
  status: "applied" | "rolled_back";
  is_still_active: boolean;
  applied_action?: Record<string, unknown> | null;
  rollback_action?: Record<string, unknown> | null;
  app_version_at_apply?: string | null;
  ruleset_version_at_apply?: string | null;
  elevation_used?: boolean | null;
};

export type ReadinessCheck = { id: string; label: string; status: ReadinessStatus; detail: string; value: string | null };
export type GameReadiness = { checks: ReadinessCheck[]; ready_count: number; attention_count: number; unknown_count: number; advisory: string };

export type PriorityItem = { id: string; title: string; reason: string; linked: string | null; confidence: Confidence; status: PriorityStatus };
export type Priorities = { limiters: PriorityItem[]; already_fine: PriorityItem[]; not_worth_touching: PriorityItem[]; session_hint: string | null };

export type SessionSummary = {
  started_at: string;
  duration_secs: number;
  process_name: string;
  samples: number;
  avg_fps: number;
  avg_frametime_ms: number;
  low1_fps_est: number;
  peak_gpu_temp_c: number | null;
  peak_gpu_usage_pct: number | null;
  peak_ram_used_bytes: number | null;
  ram_total_bytes: number | null;
};
```

- [ ] **Step 2: In `App.tsx`, delete those local `type` declarations** and add at the top with the other imports:

```ts
import type {
  AppliedChange, GameReadiness, ReadinessCheck, ReadinessStatus,
  Priorities, PriorityItem, PriorityStatus, Confidence, SessionSummary,
} from "./types";
```

- [ ] **Step 3: Verify the build still compiles**

Run: `npm run build`
Expected: `tsc` clean (no duplicate/missing type errors), `vite build` succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/types.ts src/App.tsx
git commit -m "refactor(types): extract shared surface types into src/types.ts"
```

---

## Task 1: Pure dashboard selectors (TDD)

**Files:**
- Create: `src/surfaces/dashboard-data.ts`
- Test: `src/surfaces/dashboard-data.test.ts`

- [ ] **Step 1: Write the failing test `src/surfaces/dashboard-data.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { activeChangeCount, topLimiters, latestSession, leaveAloneCount } from "./dashboard-data";
import type { AppliedChange, Priorities, SessionSummary } from "../types";

const change = (over: Partial<AppliedChange>): AppliedChange => ({
  id: "c", rec_id: "r", rec_title: "t", applied_at: "2026-06-01T00:00:00Z",
  snapshot: null, status: "applied", is_still_active: true, ...over,
});

describe("activeChangeCount", () => {
  it("counts only applied + still-active changes", () => {
    const changes = [
      change({ status: "applied", is_still_active: true }),
      change({ status: "applied", is_still_active: false }),
      change({ status: "rolled_back", is_still_active: false }),
    ];
    expect(activeChangeCount(changes)).toBe(1);
  });
  it("handles empty", () => expect(activeChangeCount([])).toBe(0));
});

describe("topLimiters", () => {
  const p = (titles: string[]): Priorities => ({
    limiters: titles.map((t, i) => ({ id: `l${i}`, title: t, reason: "r", linked: null, confidence: "high", status: "attention" })),
    already_fine: [], not_worth_touching: [], session_hint: null,
  });
  it("returns the first n limiters", () => {
    expect(topLimiters(p(["a", "b", "c", "d"]), 3).map((x) => x.title)).toEqual(["a", "b", "c"]);
  });
  it("returns [] for null priorities", () => expect(topLimiters(null, 3)).toEqual([]));
});

describe("leaveAloneCount", () => {
  it("sums already_fine + not_worth_touching", () => {
    const p: Priorities = {
      limiters: [], session_hint: null,
      already_fine: [{ id: "a", title: "", reason: "", linked: null, confidence: "high", status: "ready" }],
      not_worth_touching: [
        { id: "b", title: "", reason: "", linked: null, confidence: "low", status: "ready" },
        { id: "c", title: "", reason: "", linked: null, confidence: "low", status: "ready" },
      ],
    };
    expect(leaveAloneCount(p)).toBe(3);
  });
  it("0 for null", () => expect(leaveAloneCount(null)).toBe(0));
});

describe("latestSession", () => {
  const s = (started_at: string, name: string): SessionSummary => ({
    started_at, duration_secs: 1, process_name: name, samples: 1, avg_fps: 1,
    avg_frametime_ms: 1, low1_fps_est: 1, peak_gpu_temp_c: null, peak_gpu_usage_pct: null,
    peak_ram_used_bytes: null, ram_total_bytes: null,
  });
  it("returns the most recent by started_at", () => {
    const out = latestSession([s("2026-05-01T10:00:00Z", "old"), s("2026-06-01T10:00:00Z", "new")]);
    expect(out?.process_name).toBe("new");
  });
  it("returns null for empty", () => expect(latestSession([])).toBeNull());
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- dashboard-data`
Expected: FAIL — `./dashboard-data` cannot be resolved.

- [ ] **Step 3: Implement `src/surfaces/dashboard-data.ts`**

```ts
import type { AppliedChange, Priorities, PriorityItem, SessionSummary } from "../types";

/** Changes Compy applied that are still live (the honest "what's improved" count). */
export function activeChangeCount(changes: AppliedChange[]): number {
  return changes.filter((c) => c.status === "applied" && c.is_still_active).length;
}

/** Top N biggest limiters (already rank-ordered by the backend). */
export function topLimiters(priorities: Priorities | null, n: number): PriorityItem[] {
  return priorities ? priorities.limiters.slice(0, n) : [];
}

/** "Already fine" + "not worth touching" — the honest "leave it alone" count. */
export function leaveAloneCount(priorities: Priorities | null): number {
  if (!priorities) return 0;
  return priorities.already_fine.length + priorities.not_worth_touching.length;
}

/** Most recent session by start time, or null. Does not mutate the input. */
export function latestSession(sessions: SessionSummary[]): SessionSummary | null {
  if (sessions.length === 0) return null;
  return [...sessions].sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))[0];
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- dashboard-data`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/surfaces/dashboard-data.ts src/surfaces/dashboard-data.test.ts
git commit -m "feat(dashboard): pure home-base selectors"
```

---

## Task 2: The `<Dashboard>` surface

**Files:**
- Create: `src/surfaces/Dashboard.tsx`, `src/surfaces/Dashboard.css`, `src/surfaces/Dashboard.test.tsx`

> **Posture is a prop** (`DashboardPosture`), computed by `App` in sub-project #3. Defining the type
> here keeps this surface self-contained and testable without #3.

- [ ] **Step 1: Create `src/surfaces/Dashboard.css`**

```css
.dash{display:flex;flex-direction:column;gap:16px;}
.dash-hero{position:relative;border:1px solid var(--border);border-radius:var(--r-lg);padding:22px 24px;
  background:radial-gradient(900px 240px at 12% -40%,var(--heroSoft,var(--accent-soft)),transparent 70%),var(--panel);
  box-shadow:var(--edge),var(--shadow-1);display:flex;align-items:center;gap:18px;}
.dash-hero .dash-orb{width:60px;height:60px;border-radius:50%;flex:0 0 60px;display:grid;place-items:center;
  border:1px solid var(--hairline);background:radial-gradient(circle at 30% 30%,var(--heroGlow,var(--accent-soft)),transparent);}
.dash-hero h1{margin:0;font-size:24px;letter-spacing:-.01em;}
.dash-hero .dash-sub{color:var(--muted);margin-top:3px;font-size:13.5px;}
.dash-hero .dash-why{margin-left:auto;text-align:right;color:var(--faint);font-size:12px;}
.dash-hero .dash-why b{display:block;font-size:28px;font-weight:650;font-family:var(--font-mono);}
.dash-grid{display:grid;grid-template-columns:repeat(12,1fr);gap:14px;}
.dash-grid .col6{grid-column:span 6;} .dash-grid .col4{grid-column:span 4;} .dash-grid .col8{grid-column:span 8;}
.dash-limiter{display:flex;gap:10px;align-items:baseline;padding:8px 0;border-bottom:1px solid var(--hairline);}
.dash-limiter:last-child{border-bottom:0;} .dash-limiter .t{font-weight:500;} .dash-limiter .r{color:var(--muted);font-size:12.5px;}
.dash-honesty{color:var(--faint);font-size:12px;line-height:1.5;}
```

- [ ] **Step 2: Create `src/surfaces/Dashboard.tsx`**

```tsx
import "./Dashboard.css";
import { Card, SectionHeader, StatusPill, Stat, TrustCue, EmptyState, Icon } from "../design";
import { activeChangeCount, topLimiters, leaveAloneCount, latestSession } from "./dashboard-data";
import type { AppliedChange, GameReadiness, Priorities, SessionSummary } from "../types";

export type DashboardPosture = {
  state: "dialed-in" | "attention" | "scanning" | "unknown";
  headline: string;   // e.g. "You're ready to play"
  sub: string;        // one honest line
};

export type DashboardProps = {
  posture: DashboardPosture;
  readiness: GameReadiness | null;
  priorities: Priorities | null;
  changes: AppliedChange[];
  sessions: SessionSummary[];
  onNavigate: (tab: string) => void;
  onExport: () => void;
};

const HERO_VARS: Record<DashboardPosture["state"], { soft: string; glow: string; icon: string; tone: string }> = {
  "dialed-in": { soft: "var(--status-ready-soft)", glow: "rgba(70,217,138,.30)", icon: "shield", tone: "var(--ready)" },
  attention:   { soft: "var(--status-attention-soft)", glow: "rgba(245,183,64,.30)", icon: "alert", tone: "var(--attention)" },
  scanning:    { soft: "var(--accent-soft)", glow: "var(--accent-soft)", icon: "pulse", tone: "var(--accent)" },
  unknown:     { soft: "transparent", glow: "transparent", icon: "grid", tone: "var(--muted)" },
};

export function Dashboard(p: DashboardProps) {
  const v = HERO_VARS[p.posture.state];
  const limiters = topLimiters(p.priorities, 3);
  const active = activeChangeCount(p.changes);
  const leaveAlone = leaveAloneCount(p.priorities);
  const last = latestSession(p.sessions);
  const heroStyle = { ["--heroSoft" as string]: v.soft, ["--heroGlow" as string]: v.glow } as React.CSSProperties;

  return (
    <div className="dash">
      {/* Q1: Am I ready to play? */}
      <section className="dash-hero" style={heroStyle}>
        <span className="dash-orb" style={{ color: v.tone }}><Icon name={v.icon} size={28} /></span>
        <div>
          <h1>{p.posture.headline}</h1>
          <div className="dash-sub">{p.posture.sub}</div>
        </div>
        {p.readiness ? (
          <div className="dash-why"><b style={{ color: v.tone }}>{p.readiness.ready_count}/{p.readiness.checks.length}</b>checks clear</div>
        ) : null}
      </section>

      <div className="dash-grid">
        {/* Q2: What's holding this PC back? */}
        <Card className="col8" interactive>
          <SectionHeader title="What's holding this PC back" right={
            <StatusPill status={limiters.length ? "attention" : "ready"} label={limiters.length ? `${limiters.length} to look at` : "Nothing urgent"} />
          } />
          {limiters.length === 0 ? (
            <p className="dash-honesty">No real limiters for this rig right now. Nothing here is worth touching.</p>
          ) : (
            limiters.map((l) => (
              <div className="dash-limiter" key={l.id}>
                <span className="t">{l.title}</span><span className="r">{l.reason}</span>
              </div>
            ))
          )}
          <div style={{ marginTop: 10 }}>
            <button className="btn ghost" onClick={() => p.onNavigate("Priorities")}>See all priorities</button>
          </div>
        </Card>

        {/* Q3 + Q4: What has Compy improved? / What not to touch? */}
        <Card className="col4">
          <TrustCue title={active > 0 ? "You're protected" : "Nothing changed yet"}
            detail={active > 0 ? `${active} change${active === 1 ? "" : "s"} active — all reversible from the Ledger.` : "No changes applied. Your system is untouched."} />
          <div style={{ marginTop: 12 }}>
            <Stat value={String(leaveAlone)} label="Checked & fine — leave alone" />
          </div>
        </Card>

        {/* Q5: How did the last session perform? */}
        <Card className="col8" interactive>
          <SectionHeader title="Last session" right={last ? <StatusPill status="unknown" label={last.process_name} /> : undefined} />
          {last ? (
            <div style={{ display: "flex", gap: 24 }}>
              <Stat value={last.avg_fps.toFixed(0)} unit="fps" label="Average" tone="ready" />
              <Stat value={last.avg_frametime_ms.toFixed(1)} unit="ms" label="Frametime" />
              <Stat value={last.low1_fps_est.toFixed(0)} unit="fps" label="1% low · estimate" />
            </div>
          ) : (
            <EmptyState icon="chart" title="No sessions yet">
              Play a game with monitoring on and a debrief lands here.
            </EmptyState>
          )}
        </Card>

        {/* Q6: What can I share? / Q7: Real performance or snake oil? */}
        <Card className="col4">
          <SectionHeader title="Share & honesty" />
          <button className="btn" onClick={p.onExport}>Export a diagnostic report</button>
          <p className="dash-honesty" style={{ marginTop: 12 }}>
            Compy shows measured facts and reversible changes — never fake percentages, boost claims,
            or an opaque "score." 1% low is a live estimate. No CPU temp by design (no kernel driver).
          </p>
        </Card>
      </div>
    </div>
  );
}
```

> `.btn` / `.btn.ghost` already exist in `App.css`; if sub-project #1 has not promoted them into a
> primitive yet, they resolve from the global stylesheet. No new button styles are introduced here.

- [ ] **Step 3: Render-smoke test `src/surfaces/Dashboard.test.tsx`**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Dashboard, type DashboardProps } from "./Dashboard";

const base: DashboardProps = {
  posture: { state: "dialed-in", headline: "You're ready to play", sub: "All checks pass." },
  readiness: { checks: [], ready_count: 8, attention_count: 0, unknown_count: 0, advisory: "" },
  priorities: null, changes: [], sessions: [],
  onNavigate: vi.fn(), onExport: vi.fn(),
};

describe("Dashboard", () => {
  it("renders the posture headline", () => {
    render(<Dashboard {...base} />);
    expect(screen.getByText("You're ready to play")).toBeInTheDocument();
  });
  it("shows the empty session state when there are no sessions", () => {
    render(<Dashboard {...base} />);
    expect(screen.getByText("No sessions yet")).toBeInTheDocument();
  });
  it("shows 'Nothing urgent' when there are no limiters", () => {
    render(<Dashboard {...base} />);
    expect(screen.getByText("Nothing urgent")).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run + verify**

Run: `npm test -- Dashboard`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/surfaces/Dashboard.tsx src/surfaces/Dashboard.css src/surfaces/Dashboard.test.tsx
git commit -m "feat(dashboard): home-base surface on the design-system primitives"
```

---

## Task 3: Wire `<Dashboard>` into `App.tsx`

**Files:**
- Modify: `src/App.tsx` (the `activeTab === "Overview"` render branch)

- [ ] **Step 1: Import the surface** near the other imports in `App.tsx`:

```ts
import { Dashboard, type DashboardPosture } from "./surfaces/Dashboard";
```

- [ ] **Step 2: Provide a temporary posture until #3 lands.** Inside the `App` component, add:

```ts
// Placeholder posture; sub-project #3 replaces this with deriveSystemPosture(...).
const posture: DashboardPosture = readiness == null
  ? { state: "scanning", headline: "Scanning your system…", sub: "Reading hardware and checks." }
  : readiness.attention_count > 0
    ? { state: "attention", headline: `${readiness.attention_count} thing${readiness.attention_count === 1 ? "" : "s"} need your attention`, sub: readiness.advisory || "See what to look at below." }
    : { state: "dialed-in", headline: "You're ready to play", sub: "All readiness checks pass." };
```

- [ ] **Step 3: Replace the inline `Overview` JSX** with the surface. Find the `activeTab === "Overview"`
  render block and substitute its body for:

```tsx
<Dashboard
  posture={posture}
  readiness={readiness}
  priorities={priorities}
  changes={changes}
  sessions={sessions}
  onNavigate={setActiveTab}
  onExport={() => { /* call the existing export handler used by the header "Export report" button */ }}
/>
```

> Reuse the app's existing export action for `onExport` (the same handler wired to the header "Export
> report" button). If that handler is a named function, pass it directly; if it's inline, lift it to a
> named `handleExport` first so both call sites share it.

- [ ] **Step 4: Verify**

Run: `npm test` (all suites green) then `npm run build` (`tsc` clean + `vite build`).
Then `npm run tauri dev`: open the Dashboard tab — posture hero + the four question-cards render;
the rest of the app is unchanged. No new outbound network.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat(dashboard): mount the home-base Dashboard surface on the Overview tab"
```

---

## Self-Review

**Spec coverage:** Dashboard home-base + 7 questions (spec §3.3) — Q1 hero, Q2 limiters card, Q3+Q4
protected/leave-alone card, Q5 last-session card, Q6 export, Q7 honesty note. Primitives reused from
#1 (spec §3.1). Posture consumed as a prop, derivation owned by #3 (spec §3.2). Decision A honored
(transparent posture, no Tune/Garage). Decision B honored (Dashboard-first, no full carve here).

**Placeholder scan:** none — all code complete. The two cross-plan dependencies (`DashboardPosture`
derivation in #3; the export handler in `App.tsx`) are defined locally or pointed at a concrete
existing handler, not left as TODOs. The Task-3 temporary posture is real, runnable code that #3
later swaps.

**Type consistency:** `dashboard-data.ts` signatures (`activeChangeCount`, `topLimiters`,
`leaveAloneCount`, `latestSession`) match their imports in `Dashboard.tsx` and the tests. `DashboardPosture`
and `DashboardProps` match between `Dashboard.tsx`, its test, and the `App.tsx` wiring. Shared types
come from `src/types.ts` (Task 0), imported by both `App.tsx` and `src/surfaces/`.

---

## Execution Handoff

HELD pending owner approval + prerequisites (#1 primitives; #3 posture derivation). When approved,
execute via subagent-driven-development (fresh subagent per task, review between) or executing-plans.
