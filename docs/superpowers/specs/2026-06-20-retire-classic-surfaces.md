# Spec — Retire the classic surfaces (post-merge cleanup)

Status: **DRAFT for owner review.** NOT executed (deliberately deferred from the overnight sprint —
too big/risky to run unattended; App.tsx is large, there is no `App.test.tsx` integration net, and the
`Tab` union change ripples ~20 sites). Mapped read-only by a sub-agent 2026-06-20.

## Why
The redesign (v2 surfaces) is merged + DEFAULT-ON and is the shipped app. The classic surfaces survive
only as dead code paths reachable when a `compy_*_v2` flag is `false` — but there is **no UI left to
flip those flags** (the "New look" hub was retired), and `readDevFlag` self-heals a stale `"0"` away.
So the classic paths are unreachable in normal use. Retiring them shrinks App.tsx + the bundle and
removes drift risk. This is the [[retire-classic-surfaces-cleanup]] memory, now unblocked.

## The one real decision (owner)
**The Fix "disable preview" escape hatch** (`Fix.tsx:556` → `App.tsx:1663-66`, `persistFlag(FIX_V2_KEY,false)`)
is the ONLY remaining runtime toggle back to a classic surface (`OptimizeTab`). Keep it as a failsafe, or
retire it with the rest? Everything below assumes **retire it** (full cleanup). If you want to keep the
failsafe, we keep `FIX_V2_KEY` + `persistFlag` + `OptimizeTab` and stop at Phase 4.

## Inventory (what's dead vs protected)
DEAD (unreachable in shipped state — safe to remove):
- Flags read-once with no setter: `compy_home_v2 / check_v2 / play_v2 / lab_v2 / learn_v2 / arc_v2`
  (+ `fix_v2` iff the escape hatch is retired). `readDevFlag`/`persistFlag` plumbing once the last reader goes.
- Inline classic tabs in App.tsx: `ReadinessTab` (337-490), `PrioritiesTab` (782-842), `OptimizeTab`
  (1864-2026), and the standalone renders of `SessionsTab`, `MonitoringTab`, `LatencyTab`, `BenchmarkTab`,
  `TweakEncyclopedia` (these are flag-off branches; the v2 surfaces embed the still-needed pieces).
- `Tab` union members that become unreachable: `Readiness`, `Priorities`, `Monitoring`, `Sessions`,
  `Latency`, `Benchmark` (keep `Overview/Check/Optimize/Play/Learn/Lab/Diagnostics/History`).
- `Dashboard.tsx` + `TweakEncyclopedia.tsx` are already never rendered (only their tests reference them).
- Overlay classic branch (`Overlay.tsx:169-195`) + the `compy_overlay_v2` self-heal.

PROTECTED — DO NOT DELETE (shared by v2 or still owner-reachable):
- `MonitoringTab` *function* (Play embeds it via `deepMonitoring`); `SessionDebrief`; `LatencyTab`/
  `BenchmarkTab` *imports* (Lab embeds them); `HardwareSection` (Overview + CommandCenter);
  `dashboard-data.ts`, `command-center-data.ts`, `homeRail.ts`, `gaming-mode.ts` (shared).
- Cosmetic flags are SEPARATE from the v2-consolidation flags and stay: `compy_living_instrument`
  (Settings toggle), `compy_dash_v2` (skin, default-on), `compy_committed` (inert). `theme.ts` untouched.

## Proposed safe order (lowest-risk first) — land each phase as its own verified commit
1. Remove the 5–6 dead `*_V2_KEY` consts + their read-once `useState` (after wiring below is simplified).
2. Delete `ReadinessTab`/`PrioritiesTab`/`OptimizeTab` defs + their flag-off render branches.
3. Collapse `visibleTabs` (1208-39), `navHome` (1262-82), CommandCenter `onNavigate` (1566-69) to the
   v2-only paths; trim the `Tab` union + `HOME_FOR_TAB`.
4. Drop the standalone `Latency/Benchmark/TweakEncyclopedia/Monitoring/Sessions` renders (keep the
   embedded uses inside Lab/Play/Learn).
5. (Optional) remove `Dashboard.tsx`/`TweakEncyclopedia.tsx` + their tests, or archive.
6. (Optional) Overlay classic branch + `overlay_v2` self-heal.

## Risk + the safety ask
- **No `App.test.tsx` exists** → before/with this, add an integration test covering: default tab on load,
  rail nav to each room, and tab-switch — so the simplification has a net. Recommend doing this FIRST.
- Each phase: `tsc` + full `vitest` + `cargo` unaffected; verify the live app per phase (close the
  installed app, dev-build, click every room) — this is exactly why it shouldn't run unattended.
- Fully reversible by git, but it's a large diff touching the app shell → wants the owner's eyes per phase.

**Recommendation:** land it as a small train (one phase per commit) with the integration test first,
during a session where the owner can eyeball each room live. Est. 6 small commits.
