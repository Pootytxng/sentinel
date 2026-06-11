# Spec — M3 classic-surface retirement (PREP ONLY — execute in a FRESH attended session)

**Date:** 2026-06-11 (R2 marathon item 8, written unattended per the standing order: spec it, don't cut it.)
**Class:** large deletion through the shipped shell — HIGH blast radius, owner-paced timing.
**Precondition:** wave-2 tester feedback cycle is not mid-flight, or the owner accepts the churn.

## Why now-ish

The v2 surfaces have been release-default since 2026-06-06, parity is closed, the preview-flag hub
is gone, and the Settings "New look" escape hatch (`compy_*_v2 = "0"`) is the only remaining road
to the classics. Carrying them costs: ~3,022-line App.tsx, a 495 kB single bundle chunk, dead CSS,
and every shipped-surface change paying a "does the classic still compile/render?" tax.

## Dead-code inventory (verified by grep on `main` @ `d00ae34`)

1. **Classic tab render paths in App.tsx** — flag-off branches for: `Overview` (L1330/1525),
   `Readiness` (1536), `Priorities` (1539), `Optimize` (1540), `Monitoring` (1590-91),
   `Sessions` (926/1593), `Latency` (1620), `Benchmark` (1621), `Diagnostics` (1622). The v2 rooms
   render the SAME content components (Check/Play/Fix/Lab absorb them) — what dies is the classic
   TAB chrome + routing, not the underlying panels (MonitoringTab/BenchmarkTab/LatencyTab live on
   inside Play/Lab embeds).
2. **Flag plumbing** — `readDevFlag` + the 7 `compy_*_v2` keys + their useState wiring
   (App.tsx 832-904), `readOverlayV2` (Overlay.tsx 34-76), Settings → "New look" toggle group.
3. **Classic-only components** — `PrioritiesTab`, `ReadinessTab` (App.tsx-internal), classic
   `SECTION_META` remnants if any survive, `Dashboard.tsx` (built, never wired — delete or wire,
   owner call), the classic Optimize surface, `Fix.tsx`'s `fix-classic` button + `onDisablePreview`
   prop chain (and Lab's equivalent if present).
4. **CSS** — classic-tab styles in App.css. ⚠️ **Shared-style hazard:** `.modal/.modal-backdrop/`
   `.report-preview/.btn*` in App.css are used by the LIVE ReportModal + dialogs — the CSS cut
   must be selector-by-selector with grep proof, never block deletion.

## Execution plan (fresh session, in order, one commit per step)

1. **Step 0 — freeze a revert point:** tag `pre-m3-classic` on main (plain tag, not a frozen ref).
2. **Settings first:** remove the "New look" off-switches (self-heal: clear `compy_*_v2` keys on
   startup so a user stuck on "0" lands on v2, mirroring the settings-lockout fix precedent).
3. **Routing second:** delete the classic `activeTab` branches; collapse `activeTab` to the six
   rail ids + Settings/Gaming. Tests: homeRail parity + all surface tests stay green untouched.
4. **Components third:** delete now-unreachable classic components (compiler + `npx tsc --noEmit`
   prove unreachability; anything still imported is NOT classic-only — stop and re-check).
5. **Flags fourth:** delete `readDevFlag`/`readOverlayV2` + keys; Overlay v2 becomes the only path.
6. **CSS last:** selector-by-selector with `grep` proof of zero remaining users per deleted block.
7. **Bundle check:** `npx vite build` — expect the 495 kB chunk to drop meaningfully for free
   (this is where the R2-7 "bundle split" value actually lives; no lazy-loading needed).
8. **Verify:** full suites + owner drag-test of all six rooms + Export modal + overlay + a
   fresh-profile launch (no localStorage) + an upgrade-profile launch (stale `compy_*_v2="0"`).

## Hard lines

- The six SHIPPED rooms' behavior is byte-identical (deletion of the unreachable, never edits to
  the live path beyond removing the flag conditionals around it).
- `beta-kit/`, frozen refs, gates untouched. No force-push; the `pre-m3-classic` tag is the revert.
- If ANY classic component turns out to be live-path-shared mid-cut: stop, log, re-spec.

## Estimated yield

App.tsx ~3,022 → ~1,800-2,000 lines; bundle 495 kB → meaningfully smaller (classic CSS+JS gone);
the per-change classic tax gone. One session of careful work for a permanently lighter shipped app.
