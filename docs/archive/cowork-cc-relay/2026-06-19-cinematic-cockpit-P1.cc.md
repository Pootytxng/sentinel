# CC WORK ORDER — Cinematic Cockpit P1 (Home) — 2026-06-19

**Lane:** CC owns build/compile/test/git. Cowork (director) wrote this; audit happens against git after.
**Gated on:** owner blessing the prototype's *look* first (taste). Do not start until the owner says go.

## Read first
- Spec (canonical, hard lines): `docs/superpowers/specs/2026-06-19-cinematic-cockpit.md`
- Visual north star (the FEEL to match): `docs/superpowers/specs/2026-06-19-cinematic-cockpit-prototype.html`
- Pattern to mirror: `src/design/living-instrument.css` + `src/design/theme.ts` + `src/main.tsx`

## Build (P1 — Home only)
Create a new reversible skin layer **`src/design/cinematic.css`**, scoped entirely under
`:root[data-cinematic="on"]`, additive **on top of** the living layer. Wire a `compy_cinematic` flag
(**default OFF**) in `theme.ts`/`main.tsx` exactly like `compy_living_instrument`. Apply to **Home**:
- Posture ring: sweep stroke to the real reading then **hold**, slow breathe (transform/opacity only).
- Hardware grid + telemetry: entrance rise + stagger (nth-child delays, like `liv-rise`).
- Accent glow on **live** surfaces only (dials/sparklines/live dot) — never a static number.
- Hover lift/magnetism on cards (transform + shadow + accent edge).
- The **one** sanctioned scan/win streak on the scan action (single sweep; nothing else shimmers).

## THE FREEZE LAW (the load-bearing piece — build this, not just the pretty parts)
While an FPS/game session is being measured, set `data-session="active"` on `<html>` from the **same
fps-status signal `AmbientBackdrop` already reads**, and gate ALL continuous motion (aurora drift,
ring breathe, heartbeat, live-dot pulse) to `animation:none`. Add a small "measuring — motion paused"
affordance. Add a regression test that asserts the freeze attribute follows the session signal.

## HARD LINES (do NOT cross)
- Default OFF; additive; dropping `cinematic.css` + the attribute = **byte-identical** app.
- **Cosmetic only:** no logic / data / IPC / capability / CSP / tweak-catalog touched. `actions.rs`,
  monitoring, FFI untouched. Nothing Compy *measures* changes.
- Tokens only — no bare theme hexes, no fallback-less `--ix-*`. All 5 themes keep contrast.
- One shimmer (sweep-guard). Reduced-motion kills all movement, keeps depth+glow.
- Frozen beta refs (`16069fa`) untouched. **No installer cut.**

## Verify (one line in the report)
`cargo test` (count unchanged) · `npm test` · `clippy -D warnings` · `tsc` · `vite build` ·
guards green: `theme-contrast` `sweep-guard` `border-hygiene` `theme-literal` `doorknob` `homeRail` ·
`/security` clean.

## After committing
Run `npm run tauri dev` so the owner can see it live (set `compy_cinematic="1"` in localStorage to view).

## Report back (terse)
`hash · what changed · the one verify line · any flag/owner-decision`. Write it to the sibling
`2026-06-19-cinematic-cockpit-P1.REPORT.md`.
