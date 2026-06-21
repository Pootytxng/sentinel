# Optimize Merge — Phase 1a (flag-gated shell) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or
> superpowers:executing-plans. Steps use `- [ ]` checkboxes. Spec:
> `docs/superpowers/specs/2026-06-21-optimize-merge-design.md`.

**Goal:** A flag-gated, *working* merged "Optimize" tab — Check + Tune content reorganized under
Fixes / Applied / History segments + a persistent "N active · undo" chip + land-on-Applied — with NO
restyle yet (V0 polish is phase 1b). Prove the merge breathes before polishing.

**Architecture:** A new `Optimize.tsx` wrapper owns the segmented control + chip + segment state, and
*composes the existing surfaces*: **Fixes** renders `<Check>` (diagnose + ranked inline applies) plus
Tune's unique apply pieces (Gaming Mode, startup); **Applied** + **History** render Tune's Trust-Ledger
sections. Driven by a `view` prop added to `Fix.tsx` so it renders only the requested sections (no
duplication, no big extraction yet). Gated by `compy_optimize` (default OFF) — old Check + Tune
untouched when off.

**Tech Stack:** React 19 + TS, Tauri, the existing `useScan`/ledger/`compy_changes_active` data, the
`compy_*` localStorage dev-flag pattern, the `HOME_RAIL` one-rail system.

## Global Constraints
- Default the flag **OFF**; old `Check` + `Optimize`(Tune) tabs fully intact when off (reversible).
- **Zero new IPC**, no mutation/rollback/elevation changes — pure composition over existing data.
- Mutations stay **confirm-gated** (reuse `useConfirm`); no casual instant toggles.
- All doctrine guards stay green (voice/jargon/contrast/border); no banned literals in new copy.
- Naming: tab **"Optimize"**, segments **"Fixes" / "Applied" / "History"** (verbatim).
- The lifecycle framing: **Fixes = worth-doing (not-yet-applied)**, **Applied = on now (+undo)**,
  **History = full audit**. Recommendations flow Fixes → Applied → History.

---

### Task 1: The `compy_optimize` flag

**Files:** Modify `src/App.tsx` (the `compy_*` flag block near the other dev flags).
**Interfaces:** Produces `const optimizeMerged: boolean` read once at startup from
`localStorage.getItem("compy_optimize") === "1"` (default false), mirroring the existing flag readers.

- [ ] **Step 1:** Add `optimizeMerged` alongside the other `compy_*` reads (default OFF).
- [ ] **Step 2:** `tsc` clean. Commit `feat(optimize): compy_optimize flag (default off)`.

### Task 2: Rail 6→5 when merged

**Files:** Modify `src/design/homeRail.ts` (or a flag-aware filter in `App.tsx` where `HOME_RAIL` is
consumed for the rail). Test: `src/design/homeRail.test.ts`.
**Interfaces:** Consumes `optimizeMerged`. Produces the rendered rail: when merged, `check` + `fix`
rooms collapse to ONE `fix` room **labeled "Optimize"**; order Home · Optimize · Monitor · Blackbook ·
Advanced (5). When off, unchanged (6).

- [ ] **Step 1:** Write a test: with merged=true the rail has 5 ids and no standalone `check`; label of
      the merged room is "Optimize". With merged=false, 6 ids unchanged.
- [ ] **Step 2:** Implement a `railFor(merged)` helper (pure) the shell + CommandCenter rails both use
      (keep the parity guard happy). Run the test → pass.
- [ ] **Step 3:** `tsc` + `vitest homeRail` green. Commit `feat(optimize): rail collapses check+tune→Optimize when merged`.

### Task 3: `Fix.tsx` gains a `view` prop (section filter)

**Files:** Modify `src/surfaces/Fix.tsx`. Test: `src/surfaces/Fix.test.tsx` (if present) or a new
focused test.
**Interfaces:** Produces `Fix`'s new optional prop `view?: "all" | "fixes" | "ledger"` (default
`"all"` — old Tune behavior byte-identical). `"fixes"` = recs + Gaming Mode + startup (NO ledger);
`"ledger"` = Active + Full history ONLY. Old callers pass nothing → `"all"`.

- [ ] **Step 1:** Write a test: `<Fix view="ledger">` renders the "Active on this PC"/"Full history"
      headings and NOT "Worth making for your rig"; `view="fixes"` is the inverse; default renders both.
- [ ] **Step 2:** Wrap the rec/gaming/startup blocks in `view !== "ledger"` and the two ledger blocks
      in `view !== "fixes"`. Default unchanged.
- [ ] **Step 3:** `tsc` + the Fix test + full `vitest` green (old Tune still whole). Commit
      `refactor(fix): optional view prop to render fixes-only or ledger-only sections`.

### Task 4: `Optimize.tsx` — the segmented shell + chip + land-on-Applied

**Files:** Create `src/surfaces/Optimize.tsx`, `src/surfaces/Optimize.css`. Test:
`src/surfaces/Optimize.test.tsx`.
**Interfaces:** Consumes the same props App passes to `Check` + `Fix` today (hw, recs, startup, the
apply/rollback/toggle handlers, `compy_changes_active`). Produces `<Optimize ...>`:
- A segmented control: **Fixes** (default) | **Applied** | **History**.
- **Fixes** = `<Check ...>` then `<Fix view="fixes" ...>`.
- **Applied** = `<Fix view="ledger" ...>` showing the Active layer (History collapsed within, or split
  — for the shell, `view="ledger"` renders both; History segment can re-use it scrolled, acceptable
  for 1a; 1c refines the Active/History split).
- A persistent header chip: `{activeCount} active · undo` (activeCount = `compy_changes_active`) →
  clicking selects the **Applied** segment. Hidden when count is 0.
- `onApplied()` callback fired by the apply handlers → sets the segment to **Applied** (land-on-Applied).

- [ ] **Step 1:** Write a test: renders the three segment buttons; defaults to Fixes; clicking
      "Applied" shows the ledger; the chip shows the active count and is absent at 0; calling the
      exposed apply handler switches the active segment to "Applied".
- [ ] **Step 2:** Implement `Optimize.tsx` (segment `useState`, the chip, compose Check + Fix-views).
      Minimal CSS (plain segmented control — NO V0 yet).
- [ ] **Step 3:** `tsc` + `vitest Optimize` green. Commit `feat(optimize): segmented shell (Fixes/Applied/History) + active-undo chip`.

### Task 5: Wire it into App behind the flag

**Files:** Modify `src/App.tsx` (the tab render + `visibleTabs` + `navHome` + `HOME_FOR_TAB`).
**Interfaces:** Consumes `optimizeMerged` + `<Optimize>`. When merged: the `fix` room renders
`<Optimize>`; `check` is folded in (no standalone Check tab/room); `navHome("check"|"fix")` →
the merged Optimize tab. When off: today's behavior exactly.

- [ ] **Step 1:** Behind `optimizeMerged`, render `<Optimize>` for the merged room; drop the standalone
      Check from `visibleTabs`; map `navHome`/`HOME_FOR_TAB` so both old homes resolve to Optimize.
- [ ] **Step 2:** Manual/CDP verify (the law): flag OFF → 6 rooms, Check + Tune separate, all work.
      Flag ON → 5 rooms, one Optimize with Fixes/Applied/History; apply a fix → lands on Applied +
      chip increments; undo → chip decrements; scan/gaming/startup/drift all function.
- [ ] **Step 3:** Full `tsc` + `vitest` + `cargo test` + `clippy` green. Commit
      `feat(optimize): wire the merged Optimize tab behind compy_optimize`.

---

## Verification (end of 1a)
Toggle `compy_optimize` on/off in localStorage + relaunch: OFF = today's app unchanged; ON = the merged
Optimize tab works end-to-end (segments, chip, land-on-Applied, apply/undo/scan/gaming/startup). Then
the review stack: `/check`, `/security`, doctrine guards, council critic. Self-review live at the
owner's resolution. **Flag stays OFF in the repo** until phase 1b/1c + owner sign-off flips it.

## Out of scope (1a)
V0 styling (1b). The Active/History *visual* split + repointing old-tab copy to "Optimize" + the rail
parity polish (1c). The receipts/proof-card History build (later). The other tabs (future phases).

## Self-review (plan vs spec)
- Spec's IA (Optimize · Fixes/Applied/History) → Tasks 4-5. ✓
- Persistent chip + land-on-Applied → Task 4. ✓
- Flag-gated reversible → Tasks 1, 5. ✓
- Confirm-gated mutations (reuse useConfirm) → Global Constraints + Task 4 (no new mutation path). ✓
- Working-shell-first, no V0 → whole plan; V0 explicitly out of scope. ✓
- Rail 6→5 → Task 2. ✓
- Gap noted: the Active-vs-History *visual* split is deferred to 1c (1a's `view="ledger"` renders both);
  acceptable — the spec's History layout refinement is a later step.
