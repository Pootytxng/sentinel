# P1 — `slimRows`: master-detail rec rows on Optimize (spec)

> 2026-07-01 · Cowork. Phase 1 of `docs/UI_SLIMDOWN_PLAN.md` §5 (council-approved; owner §8
> decisions locked 2026-07-01). Reference mockup: `docs/mockups/ui-slimdown-preview-v2.html`
> (Optimize screen, "After" view). UI-only, flag-gated, reversible. File:line refs are
> point-in-time — verify against current code before editing.

## Goal

Collapse the multi-affordance recommendation row (~8 visible controls) to a **master-detail
row** — `status dot + title + ONE measured proof line + Recommended badge + one control +
chevron` — with everything else in a **detail panel that expands in place**. Optimize's
"Fixes" segment only. Target: **8 → 3 interactive affordances visible per collapsed row.**

## Flag (the reversibility license)

Follow the exact `theme.ts` pattern of `readDashV2`/`applyDashV2`:

- localStorage key `compy_slim_rows`, **DEFAULT OFF** (`readSlimRows()` returns true only on `"1"`).
- `applySlimRows(on)` sets/deletes `data-slim-rows="on"` on `<html>`, dispatches
  `compy:slimrows-changed`.
- Settings → Appearance toggle next to the Living Instrument / Dashboard v2 switches, same copy
  register ("Slim rows (preview)").
- **Flag OFF ⇒ the current UI renders byte-identical.** No shared-component edits that leak into
  the classic path.

## The row (collapsed state)

New shared primitive `SlimRecRow` in `src/design/` (it will be reused by Home's limiter row and
the session list in later phases — build it as a primitive, not a Fix-local).

```
●  <plain-English title>                    [ Recommended ]   ( TrustSwitch )   ⌄
   Measured: <evidence line> · reversible
```

- Status dot: existing `.ds-dot` semantics (attention / neutral / applied-ready).
- Title: the rec's existing plain title. No jargon added (Sarah & Caleb bar).
- **Proof line: ALWAYS visible, from the rec's real evidence/measurement fields** — the same
  data today's evidence chip + reason render. Falls back to the reason line when no measured
  number exists. **Never empty, never fabricated, never hidden behind the tap.**
- Badge: `Recommended` (ready-soft) or `Optional` (muted) from existing rec ranking.
- One control: the **existing `TrustSwitch` untouched** — same component, same apply/rollback
  semantics, same confirm flow. The slim row changes LAYOUT only.
- Chevron + whole-row click toggles the detail panel (clicks on TrustSwitch/buttons excluded).

## The detail panel (expands in place — never a route change)

Contains everything the busy row used to show, revealed on demand: why-it-matters reason ·
evidence detail · what-changes list · AMD/vendor note · `TrustSnapshotLine` (applied rows) ·
Walkthrough link · `WhatsThis` → Learn · **Dismiss** (existing rule kept: applied rows can't be
dismissed — roll back instead). Reuse the existing subcomponents; do not fork their logic.

## §8c — pre-select Recommended (owner decision 2026-07-01)

Where the fixes list drives a batch ("Apply reviewed"), Recommended rows arrive **selected**,
one-tap deselect, and the list always shows exactly what will change. **Selection ≠
application: Apply remains an explicit user action. NO auto-apply on render, ever.** Rollback
capture per applied item unchanged.

## Scope

- **In:** Fix.tsx `view="fixes"` rec rows (the `RecRow` block, ~`Fix.tsx:180–250`) rendered as
  `SlimRecRow` when the flag is on; Optimize "Fixes" segment is the only consumer.
- **Out (P1):** Applied/History segments, Check's cards, Home, Monitor, Gaming Mode slot, any
  render-path deletion (that's P4). Startup-apps & debloat task rows: only if they already
  share `RecRow`; do not restructure them separately.

## HARD LINES (must not change)

1. `src-tauri/**` untouched — **zero Rust**; `actions.rs`/`history.rs`/rollback contract are out
   of bounds. UI-only.
2. Honesty guardrail (council 🔴): **one measured proof line visible per collapsed row** — add
   a vitest guard (`slim-row-proof-guard`) asserting the collapsed row renders a non-empty
   evidence/reason line for every rec fixture. Hiding evidence = the black-box failure mode.
3. `TrustSwitch` semantics, confirm flow, and dismiss rules unchanged.
4. Flag default OFF; flag off = today's UI byte-identical.
5. All guards stay green: `theme-contrast` · `theme-literal` · `border-hygiene` · `doorknob` ·
   `homeRail` · `sweep`. Tokens only — no bare hexes; no side-stripe borders.
6. No LOCKED gate touched (catalog frozen, no new network, gaming_mode gate untouched).

## Tests / verify

- New: `SlimRecRow` unit tests — collapsed row exposes ≤3 interactive affordances (row-toggle,
  TrustSwitch, and nothing else tabbable); proof line non-empty; detail reveals
  Walkthrough/WhatsThis/Dismiss; dismiss absent when `currently_applied`.
- Existing `Fix.test.tsx` passes untouched with flag off.
- Verify line: `npx tsc --noEmit && npm test`
- Visual: run the `self-review` skill rubric; capture before/after density screenshot of the
  Fixes segment (the 8→3 receipt) for the report.

## Report format (CC)

hash · what-changed (1–2 lines) · verify line output · flags/owner-decisions.
