# Experience Pass — SystemPosture Reframe Implementation Plan (sub-project #3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **⚠️ EXECUTION GATE:** Touches product code (`src/`). Per spec Decision E, **do not execute until the
> owner green-lights.** **Prerequisite:** sub-project #1 (design-system foundation). **Pairs with**
> sub-project #2 (Dashboard), which consumes the posture this plan derives. Implements spec Decision A
> (reframe the gamified "Tune tier" to a transparent, read-only `SystemPosture`).

**Goal:** Replace the gamified app-wide "Tune tier (Stock→Apex) / Garage / unlock-gated themes /
Surprise" layer with a transparent, read-only **`SystemPosture`** derived from real readiness facts —
honest, always click-through to its source rows, no opaque score, no grind.

**Architecture:** A pure, unit-tested `deriveSystemPosture()` turns the existing read-only signals
(`readiness.attention_count` + its checks, active-changes count, monitoring availability) into a
`SystemPosture` (`scanning | dialed-in | attention | unknown` + headline/sub + the specific reasons).
`App.tsx` computes it once and passes it to the Dashboard hero (sub-project #2). The Tune/Garage
gamification and theme-unlock gating are deleted; themes become freely selectable.

**Tech Stack:** React 19, TS 5.8, Vite 7, Vitest (from sub-project #1).

---

## File structure (this plan)

- Create: `src/surfaces/system-posture.ts` — pure `deriveSystemPosture()` + types. **Unit-tested.**
- Create: `src/surfaces/system-posture.test.ts`
- Modify: `src/App.tsx` — compute posture; **remove** `computeTuneState`, `TUNE_TIERS`, `peakTier`,
  the `data-tune` attribute wiring, the `Garage` tab, and theme-unlock gating; pass posture to `<Dashboard>`.
- Modify: `src/App.css` — remove the `[data-tune=...]` escalation rules and the theme-lock styles
  (`.theme-swatch-locked`, the 🔒 affordance).

> The honest "dialed-in" feeling now comes from posture (real facts), not a tier ladder. Themes stay
> (curated separately in the theme-curation step) but are **ungated** — no unlocks, no Surprise dice.

---

## Task 1: Pure `deriveSystemPosture()` (TDD)

**Files:**
- Create: `src/surfaces/system-posture.ts`
- Test: `src/surfaces/system-posture.test.ts`

- [ ] **Step 1: Write the failing test `src/surfaces/system-posture.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { deriveSystemPosture } from "./system-posture";
import type { GameReadiness, ReadinessCheck } from "../types";

const check = (status: ReadinessCheck["status"], label: string): ReadinessCheck =>
  ({ id: label, label, status, detail: "", value: null });

const readiness = (checks: ReadinessCheck[]): GameReadiness => ({
  checks,
  ready_count: checks.filter((c) => c.status === "ready").length,
  attention_count: checks.filter((c) => c.status === "attention").length,
  unknown_count: checks.filter((c) => c.status === "unknown").length,
  advisory: "",
});

describe("deriveSystemPosture", () => {
  it("is 'scanning' before readiness loads", () => {
    expect(deriveSystemPosture({ readiness: null, activeChanges: 0, monitoringAvailable: false }).state).toBe("scanning");
  });

  it("is 'attention' with the count + reasons when checks need attention", () => {
    const r = readiness([check("ready", "SSD"), check("attention", "Monitor below max refresh")]);
    const p = deriveSystemPosture({ readiness: r, activeChanges: 2, monitoringAvailable: true });
    expect(p.state).toBe("attention");
    expect(p.attentionCount).toBe(1);
    expect(p.reasons).toEqual(["Monitor below max refresh"]);
    expect(p.headline).toMatch(/attention/i);
  });

  it("is 'dialed-in' when all checks pass", () => {
    const r = readiness([check("ready", "SSD"), check("ready", "Refresh")]);
    const p = deriveSystemPosture({ readiness: r, activeChanges: 4, monitoringAvailable: true });
    expect(p.state).toBe("dialed-in");
    expect(p.attentionCount).toBe(0);
    expect(p.reasons).toEqual([]);
  });

  it("is 'unknown' when readiness has no usable checks", () => {
    expect(deriveSystemPosture({ readiness: readiness([]), activeChanges: 0, monitoringAvailable: false }).state).toBe("unknown");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- system-posture`
Expected: FAIL — `./system-posture` cannot be resolved.

- [ ] **Step 3: Implement `src/surfaces/system-posture.ts`**

```ts
import type { GameReadiness } from "../types";

export type PostureState = "scanning" | "dialed-in" | "attention" | "unknown";

export type SystemPosture = {
  state: PostureState;
  headline: string;
  sub: string;
  attentionCount: number;
  reasons: string[]; // the exact checks driving "attention" — click-through to readiness rows
};

export function deriveSystemPosture(input: {
  readiness: GameReadiness | null;
  activeChanges: number;
  monitoringAvailable: boolean;
}): SystemPosture {
  const { readiness, activeChanges } = input;

  if (readiness == null) {
    return { state: "scanning", headline: "Scanning your system…", sub: "Reading hardware and running checks.", attentionCount: 0, reasons: [] };
  }

  if (readiness.checks.length === 0) {
    return { state: "unknown", headline: "Not enough to judge yet", sub: "Run a scan to see your readiness.", attentionCount: 0, reasons: [] };
  }

  const reasons = readiness.checks.filter((c) => c.status === "attention").map((c) => c.label);
  const n = reasons.length; // == readiness.attention_count, recomputed for honesty

  if (n > 0) {
    return {
      state: "attention",
      headline: `${n} thing${n === 1 ? "" : "s"} need${n === 1 ? "s" : ""} your attention`,
      sub: readiness.advisory || reasons[0],
      attentionCount: n,
      reasons,
    };
  }

  const changeNote = activeChanges > 0
    ? `${activeChanges} safe change${activeChanges === 1 ? "" : "s"} active & reversible`
    : "nothing needs changing";
  return {
    state: "dialed-in",
    headline: "You're ready to play",
    sub: `All readiness checks pass · ${changeNote}.`,
    attentionCount: 0,
    reasons: [],
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- system-posture`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/surfaces/system-posture.ts src/surfaces/system-posture.test.ts
git commit -m "feat(posture): pure, transparent SystemPosture derivation"
```

---

## Task 2: Remove the gamification layer

> Deletes the "optimized-score-as-progression" surface (spec §4 / Decision A). Each removal is
> independent; after all of them the app reads from `SystemPosture` instead of a tier.

**Files:** Modify `src/App.tsx` and `src/App.css`.

- [ ] **Step 1: Remove the Tune state machine from `App.tsx`** — delete:
  - the `TUNE_TIERS` array and the `computeTuneState(...)` function;
  - the `const tune = useMemo(() => computeTuneState(...))` line and the `useEffect` that sets
    `document.documentElement.dataset.tune = tune.tier.key`;
  - the `peakTier` state + its persistence `useEffect` (`localStorage` `sentinel-peak-tier`).

- [ ] **Step 2: Remove the Garage tab** — in `App.tsx`:
  - drop `"Garage"` from the `Tab` union;
  - drop the `Garage` entry from `SECTION_META`;
  - delete the `if (tune.tierIndex >= 1) list.push("Garage")` line in the visible-tabs `useMemo`
    (and remove `tune.tierIndex` from that memo's dependency array);
  - delete the `activeTab === "Garage"` render branch and the Garage component if present.

- [ ] **Step 3: Ungate themes** — in `App.tsx`:
  - remove `unlockTier` from the `Theme` type and from every entry in the `THEMES` array;
  - simplify `ThemePicker` to drop `maxTier`, the `unlocked`/`locked` logic, the 🔒 affordance, and the
    `🎲 Surprise` button + its `surprise()` handler. It becomes a plain grid of selectable themes.
  - remove the "fall back if saved theme is above tier" `useEffect` (themes are no longer gated).

  The picker body becomes:

```tsx
<div className="theme-grid">
  {THEMES.map((t) => (
    <button
      key={t.id}
      className={`theme-swatch ${current === t.id ? "theme-swatch-on" : ""}`}
      onClick={() => { onPick(t.id); setOpen(false); }}
      title={t.label}
    >
      <span className="theme-swatch-chips">
        {t.swatch.map((c, i) => <span key={i} style={{ background: c }} />)}
      </span>
      <span className="theme-swatch-label">{t.label}</span>
    </button>
  ))}
</div>
```

- [ ] **Step 4: Remove the escalation + lock CSS from `App.css`** — delete every `:root[data-tune=...]`
  / `[data-tune=...]` rule block and the `.theme-swatch-locked` style (and any 🔒 pseudo-content).

- [ ] **Step 5: Verify the app still builds and runs with no tier/Garage references**

Run: `npm run build`
Expected: `tsc` clean — **zero** unresolved references to `tune`, `TUNE_TIERS`, `peakTier`, `unlockTier`,
`maxTier`, or `Garage`. (If `tsc` flags a leftover use, remove it.)
Then `npm run tauri dev`: themes all selectable immediately; no Garage tab; no Surprise button; app
otherwise unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/App.css
git commit -m "refactor(ui): retire Tune-tier/Garage/theme-unlock gamification (Decision A)"
```

---

## Task 3: Wire `SystemPosture` into `App` + the Dashboard hero

**Files:** Modify `src/App.tsx`.

- [ ] **Step 1: Import the derivation**

```ts
import { deriveSystemPosture } from "./surfaces/system-posture";
import { activeChangeCount } from "./surfaces/dashboard-data";
```

- [ ] **Step 2: Replace the temporary posture** (added in sub-project #2, Task 3) with the real one:

```ts
const posture = deriveSystemPosture({
  readiness,
  activeChanges: activeChangeCount(changes),
  monitoringAvailable: true, // TODO-free: pass the app's real monitoring-capability flag if one exists; otherwise true is correct (monitoring is always available to start)
});
```

> `DashboardPosture` (sub-project #2) and `SystemPosture` share the same `state` union and
> `headline`/`sub` fields, so `posture` is assignable to the `<Dashboard posture=...>` prop directly.
> If TS complains about extra fields (`attentionCount`/`reasons`), widen `DashboardProps.posture` to
> `SystemPosture` by importing the type from `./surfaces/system-posture` — they are intentionally the
> same shape.

- [ ] **Step 3: Make the hero reasons click through** — in `Dashboard.tsx` (sub-project #2), the
  attention hero already shows the sub line; add a "See what to look at" affordance that calls
  `onNavigate("Readiness")` when `posture.state === "attention"`, so the posture is always traceable
  to its source checks. (One button; no new data.)

- [ ] **Step 4: Verify**

Run: `npm test` (all green) then `npm run build` (`tsc` clean + `vite build`).
Then `npm run tauri dev`: Dashboard hero reflects real posture (scanning → dialed-in / attention);
attention state links to Readiness; no tier/Garage anywhere. No new outbound network.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/surfaces/Dashboard.tsx
git commit -m "feat(posture): drive the Dashboard hero from the real SystemPosture"
```

---

## Self-Review

**Spec coverage:** transparent `SystemPosture` replacing the tier (spec §3.2 + §4 / Decision A);
Dialed-in / Attention / Scanning / Unknown states (spec items 9 & 10); click-through to source rows
(Task 3 Step 3); gamification removed (Task 2). Pairs with sub-project #2 which renders the hero.

**Placeholder scan:** none. The one inline note (Task 3 Step 2 `monitoringAvailable`) states the
correct default explicitly rather than leaving a TODO. All code blocks are complete.

**Type consistency:** `deriveSystemPosture` returns `SystemPosture`; its `state` union
(`scanning|dialed-in|attention|unknown`) matches `DashboardPosture.state` in sub-project #2.
`activeChangeCount` is reused from `dashboard-data.ts` (sub-project #2). `GameReadiness`/`ReadinessCheck`
come from `src/types.ts`.

---

## Execution Handoff

HELD pending owner approval + prerequisite #1. Pairs with #2. When approved, execute via
subagent-driven-development or executing-plans.
