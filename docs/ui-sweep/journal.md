# UI Architecture & Aesthetics Sweep — transaction journal

North Star: navigation a tired 2 a.m. user finds without thinking, inside an interface
beautiful enough they enjoy being there. Intuitive AND beautiful; beauty never fights clarity.

## [LAP 1 · Phase 0 · Recon & arm the loop]
- Decision: Run the sweep on a dedicated worktree `ui/ia-aesthetics-sweep` cut off clean `main`
  (`f19d10c`), in `C:/Users/Kuya/code/sentinel-qa`. NOT the main worktree — it's on Cowork's
  `tests/coverage-sweep-2026-06-18` (`0907425`, committed) and a `src/**` sweep there would collide.
  (structural | setup)
- Recon: IA = ONE RAIL from `src/design/homeRail.ts` — Home·Check·Monitor·Tune·Blackbook·Lab,
  Settings gear + Export action. Labels are OWNER-DECIDED with dated rationale + a parity guard →
  structural IA = owner territory (propose-first). Token/theme system fully documented in `DESIGN.md`
  (5 `[data-itheme]` themes + living/dash skins; `--ix-*` tokens; guards: theme-contrast,
  theme-literal, border-hygiene, doorknob, homeRail-parity, sweep). Visual changes must flow through
  the tokens (guards enforce no raw literals).
- Visual loop: no Playwright/Puppeteer installed → built a dep-free CDP driver
  (`docs/ui-sweep/cdp-shot.mjs`, Node global fetch+WebSocket) to screenshot the real Tauri WebView2
  shell. **BLOCKED:** loop needs a dev build launched with `--remote-debugging-port`, but the app is
  single-instance and the owner's installed Compy is running (pid 11848). Precondition: owner closes
  Compy, then `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333 npm run tauri dev`.
- Verdict: recon ✓ · loop tooling ✓ · loop run BLOCKED (single-instance) · no baselines yet.
- Flag: 🟡 a "blind sweep is forbidden" (skill §6) — no destructive visual change until baselines render.

## [LAP 1 · Phase 1 · Cartography — baselines SEEN]
- Visual loop PROVEN: dep-free CDP driver (`cdp-shot.mjs` picks the largest viewport = main window,
  not the overlay; `cdp-eval.mjs` for DOM probing). Dev build on port 9333. Baselines captured + read
  back for all rooms: Home, Check, Monitor, Tune, Blackbook, Advanced, Gaming (`shots/baseline/`).
- Findings (ranked):
  - **S1 (structural, biggest): two-shell split.** Home = full-bleed CommandCenter (`.cc-rail-item`,
    no wordmark header). Every other room = app-shell (`.rail-item` + wordmark+tagline header +
    Back/Forward + Export). Moving Home↔room changes the whole chrome → breaks family resemblance.
    (= the recorded post-beta rail-merge follow-up.)
  - **S2 (structural, small): name collision.** Rail label "Advanced" vs `homeRail.ts` id-label "Lab"
    vs surface heading "Lab". Three sources, two names.
  - **S3 (structural, small): rail parity.** Home's `.cc-rail` omits Gaming; app-shell `.rail` includes
    it — the "matched" rails show different sets. (Falls out of S1.)
  - **V1 (visual): header band weight.** Repeated wordmark + "HARDWARE-AWARE PC OPTIMIZATION" tagline
    + Back/Forward + Export consume a tall band atop every room before content.
  - **V2 (visual): room-title inconsistency.** Title-case "Check/Monitor/Tune/Blackbook" vs uppercase
    "GAMING MODE" vs "Lab".
  - Theme note: dev build renders Midnight (teal); owner had said Violet default — confirm.
- Verdict: baselines Seen ✓ (all 7 rooms). App is coherent + polished; opportunities are refinement
  + the structural seams above.
- Flag: 🟡 structural (S1–S3) touches deliberate/owner-decided IA → propose-first (owner nod). Visual
  (V1–V2) = autonomous via tokens per standing green light.

## [LAP 1 · Phase 3 · Build — owner-approved moves]
- Owner answers: shell=Unify, theme=Violet, name=Advanced, header=Tighten.
- M1 (Violet default): NO code change — `theme.ts:36` + `main.tsx` already default Violet; the build
  showed Midnight only from stale localStorage in this dev origin. Verified Seen ✓ (violet render).
- M2 (`c27fb8e`): Lab → "Advanced" heading+copy (rail already hardcodes it; owner picked Advanced).
  tsc + vitest green; Lab.test assertion updated. Seen ✓ (advanced-violet.png).
- M4a (`<commit>`): slimmed the room header band (17px wordmark, no tagline, 11px pad; `.header` is
  room-only). tsc + vitest 365 green. Seen ✓ (check-slimhdr.png).
- **FINDING (changes M4 cost/benefit):** Violet + the slim header already make Home and the rooms read
  as one app (same titlebar, near-identical rounded rails, same accent). The "whole chrome changes"
  pain is mostly resolved WITHOUT the big cc-shell-everywhere refactor. Remaining true gaps are small:
  (a) S3 rail parity — Home's cc-rail omits Gaming; (b) Back/Forward+Export placement differs (rooms:
  slim header row; Home: chevrons in the hero, no top Export). Recommend the light targeted polish over
  the high-risk structural merge. → CHECKPOINT with owner.

## [LAP 1 · Phase 3b · Owner pick: FULL merge + bg + motion]
- Owner: full merge; + "themed bg doesn't encompass the canvas, no dead pure-black zones"; + "way
  more motion / lively interactive gizmos (examples coming; don't wait)".
- BG (`9879ec4`): root-caused the dead-black to hardcoded blue/green rgba in body + body::before
  (slipped the hex guard) with gappy placement → rewrote both theme-aware (streak tokens, color-mix)
  + cohesive coverage. App-wide. Seen ✓ (tune-bg/home-bg): violet canvas, no dead zones. This ALSO
  delivers the merge's "AmbientBackdrop app-wide" benefit (rooms had pure black before).
- MOTION C-1 (`ccd6e11`): `<AnimatedNumber>` (rAF ease-out, re-targets on change, reduced-motion →
  instant; sweep-guard safe) on Home live CPU/GPU. Unit-tested. Seen ✓.
- MOTION C-2 (committed): count-up on the Last-Session reveal + core count (Metric gained animate+fmt).
  Seen ✓ (home-countup2): 246/209/4.1/54 land correctly.
- All green throughout: tsc 0 · vitest 368 · guards (theme-literal/contrast/sweep) pass.
- **Re-assessment:** with Violet + slim header + the theme-aware canvas, the VISIBLE unify is largely
  done; the full structural shell-merge's remaining value is now mostly-internal (one shell component,
  rail parity, action placement). → Checkpoint: confirm whether the deep internal merge is still worth
  it vs. directing energy to more motion/fun (owner's other priority, examples pending).
