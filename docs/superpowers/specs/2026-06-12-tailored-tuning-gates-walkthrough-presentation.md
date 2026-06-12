# 2026-06-12 — Tailored tuning gates + walkthrough presentation + build stamp (owner feedback)

> Owner verdicts (live review of the undervolt walkthrough): (1) the multi-panel storyboard reads
> as clutter — "looks terrible"; (2) undervolt/overclock-class guidance must be offered ONLY to
> rigs that demonstrably benefit — **per-rig tailoring is THE win condition and prestige line**
> ("extreme emphasis on per-user tailored suggestions"); (3) reviews keep risking stale-build
> mixups — the build must identify itself. All three reversible, frontend/advisory only.

## §A Evidence-gated tuning advice (doctrine-grade tailoring)

Knowledge vs recommendation split: entries may EXIST in Learn (searchable library — knowledge is
free), but RECOMMENDING surfaces (Check / Fix / Lab cards, "Show me the way" offers) gate on
evidence from THIS rig:

- **Undervolt (Radeon) offer requires:** AMD GPU detected AND rig evidence of headroom pain —
  recent-session GPU thermal pressure (reuse the existing `gpuRunningHot` 14-day recency signal)
  or sustained near-limit GPU usage. Absent evidence → the card simply doesn't push it; an
  always-honest "Not for this rig / nothing measured that suggests this helps" state (reuse the
  `eee-switch-exposed` / hardware-gate precedent) where a row must render.
- **General law (record in the design kernel):** any tuning/OC-class advisory names WHY this rig
  qualifies ("your GPU held 92° across 3 sessions") — the receipt IS the recommendation. No
  generic "free performance" pushes, ever. NVIDIA variant stays behind vendor-honesty rule #5.
- CC audits where the undervolt walkthrough currently surfaces + what gates it today; close every
  ungated path.

## §B Walkthrough presentation fix

Replace the stacked five-panel storyboard with ONE schematic panel + a stepper (dots/arrows,
keyboard accessible): step N highlights in place, prev/next, optional auto-advance honoring
reduced-motion (fallback = manual stepper, never the 5-stack). Caption rail per step (existing
captions). All-original schematic law unchanged; no skeleton-spam; fits the 380px floor.
Storyboard layout may survive ONLY as a print/export fallback if trivially free.

## §C Build provenance stamp (review hygiene, receipts-for-builds)

Compile-time stamp (no runtime git invocation, zero network): short commit hash + dirty flag +
profile, baked at build. Surfaces: Settings → About footer ("Compy 0.1.0 · ab12cd3 · dev") and
dev-window title suffix. Release/NSIS builds carry it too (tester bug reports gain ground truth).
Review protocol it enables: owner reviews ONLY in the dev window CC launches; stamp mismatch =
wrong window, say so instantly.

## Hard lines

actions.rs/mutation/rollback paths untouched · no appliable-catalog growth (gates SUBTRACT pushes,
never add tweaks) · capabilities/CSP/conf untouched · zero network · reduced-motion honored ·
frozen refs untouched · receipts law on every new string (the "why this rig" line quotes real
signals only).

## Verify

cargo + npm + tsc + clippy -D warnings green; tests: gate logic pure + pinned (AMD-no-evidence →
no offer; AMD+hot-sessions → offer with reason string; NVIDIA → vendor-honesty respected),
stepper reduced-motion fallback, stamp present in both surfaces. /check + /security. Then
`npm run tauri dev` for the owner eyeball (walkthrough single-panel + stamp + a gated card).
