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
