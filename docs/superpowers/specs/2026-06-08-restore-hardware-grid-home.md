# Restore the "Your hardware" grid to the (real) Home — owner regression, 2026-06-08

*Owner caught it live: the detailed hardware cards (CPU / Memory / Graphics / Network) are NOT on
the shipped Home. Root cause: the CommandCenter (compy_home_v2, now the release default) renders
only a ONE-LINE rig summary in its header (`cc-rig`: gpu · cpu · threads · RAM); the full
"Your hardware" card grid (`App.tsx:1586`, `<h2>Your hardware</h2>` + the 6-card count-agnostic
grid incl. the elastic §6 Network card) lives ONLY in the classic Overview surface (flag-off),
so it vanished from the default Home when the redesign shipped. The owner explicitly signed off to
KEEP the Overview hardware grid (recorded in CLAUDE.md) — this restores it. NOT a redesign; a
re-home of an existing, valued element that fell through the gap between the two Homes.*

---

## The fix

- Render the existing detailed hardware grid on the **CommandCenter Home**, as a "Your hardware"
  section **below the Last Session card** (the empty lower area in the owner's screenshot).
- **Reuse, don't rebuild:** extract the classic Overview's hardware-cards block (App.tsx ~1586–
  1720: the CPU / Memory / Graphics / Network cards + the count-agnostic 6-card grid) into a
  shared component (e.g. `HardwareGrid`) and render it in BOTH places (classic Overview AND
  CommandCenter) from one source — so they can never drift again. Same data (`hw` is already
  passed to CommandCenter), same card markup, same Network-adapter logic.
- The header one-line rig summary stays (it's the glance); the detailed grid returns as the
  section beneath the posture/limiter/last-session content. Both coexist — summary up top, detail
  below, exactly as a dashboard should read.
- This also makes the elastic §6 **Network card** finally visible on the default Home (it was
  stranded in the unseen classic grid).

## Constraints
Frontend-only; reuse existing card components + data; tokens-only; the count-agnostic /
orphan-graceful grid behavior from elastic §6 carries over (it already handles 6 cards cleanly
at every width); responsive (the cards must reflow under the Home's existing elastic rules — no
horizontal scroll, no clipping at the 380px floor); zero new IPC; copy locks untouched.

## Acceptance
- [ ] The CommandCenter Home shows "Your hardware" with the full detailed cards (CPU / Memory /
      Graphics / Network) below Last Session — visible by DEFAULT (home_v2 on).
- [ ] One shared HardwareGrid component renders in both classic Overview and CommandCenter (no
      duplicated markup; they can't drift).
- [ ] Network card visible on the default Home; grid tiles cleanly (count-agnostic) wide→floor.
- [ ] Responsive: no horizontal scroll / no clipped cards at any width incl. the 380×560 floor.
- [ ] Tests/guards green; frontend-only; owner sees the grid on Home in the next dev build.
