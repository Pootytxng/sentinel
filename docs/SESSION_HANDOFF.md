# SESSION HANDOFF — paste-ready prompt for the next session

> Live pointer only. Gate truth: [`RELEASE_STATE.md`](RELEASE_STATE.md). Queue:
> [`BACKLOG.md`](BACKLOG.md) ▶ NEXT UP. Owner asks: [`OWNER_ACTION_CHECKLIST.md`](OWNER_ACTION_CHECKLIST.md).
> Budget 120 lines — trim from the bottom, never grow past it.

## Cycle note — 2026-08-23, four-room visual direction (issue #49) — MID-TRAIN, slice 2 of 7

**Worktree `C:/Users/Kuya/code/sentinel-fourroom`, branch `feat/four-room-visual-direction`, head
`8fd043d1`, not pushed + UNCOMMITTED R6 work (`home-console.*`, `console/arc-gauge.*`, docs).** Owner brief: implement
the approved comps in `~/.codex/visualizations/2026/08/23/01a02bee-.../compy-four-room-handoff/`
(`HANDOFF.md` + four PNGs), in the handoff's order: shell → Health → shared instruments → Live →
History → Test → convergence. **Local implementation only — the brief does NOT authorize release or
distribution.** Held throughout and mechanically checked: `git diff 34bd33e7~1 -- src` adds no
`invoke(`, `-- src-tauri` adds no `#[tauri::command]` — no new IPC, room, network path, mutation or
flag. Six substitutions are logged in `docs/UI_VISION_BACKLOG.md` §FOUR-ROOM and issue #49; the only
one waiting on the owner is **violet vs the comp's green primary action** (before/after already sent
for veto on sight — his silence is not approval).

- **Slice 1 `34bd33e7` — shell.** `RoomShell` gained `aside`/`below`; `data-layout="split"` derives
  from `aside`; the split is grid-AREAS in `shell-v2.css`, **no wrapper divs**, so non-split rooms
  stay byte-identical. `--v2-aside: min(620px, 58%)` yields FIRST below the 1120 cap so the 40px
  verdict keeps a column it can hold. DOM order: verdict → action → `aside` → `body` → `below`.
- **Slice 2 `e6e35dfb` — Health.** Corner gauges + control row came OFF the rig canvas onto a new
  `.hc-panel`, which took the chrome — so glow/parallax vars write on **`panelRef`, not `stageRef`**
  (`stageRef` is now only the reticle's scope). CPU temp moved to the readout strip carrying its
  `callout.cpuNoTemp` copy (why `cpu-temp-reachability-guard` needed no edit). `Reading` is
  deliberately Health-LOCAL; **slice 3 promotes it to `src/design/console/`**. The detected record is
  the `below` hero and is UNCONDITIONAL (one-hero-guard forbids a conditional hero). Seven guards
  that selected the CORNER a gauge sat in were re-anchored to `data-read="…"`, never deleted.

### Six self-review rounds, six FAILs, eight guards — slice 2 is NOT done

Every round was a complete fresh review against `01-health-approved.png` on the INSTALLED build, and
every fix was proven to FAIL on the pre-fix source first. All four findings were honest-measurement
failures wearing layout clothes — a reading nobody can read is a reading that came back empty. R1
and R2 are landed and written up in `docs/UI_VISION_BACKLOG.md` §FOUR-ROOM.

1. **R1 → `7cb43840`.** The 40px verdict read "Applied Compy changes", a filing-cabinet tab: the
   name-it law was guarded with a SYNTHETIC fixture the Rust catalog never matched. All ten
   `Attention` labels now name the finding. Guard `readiness-attention-label-guard.test.ts`.
2. **R2 → `d5bff77e`.** The viewport-fixed `.hud-frame-readout` was a curtain over live readings:
   its clearance was a `padding-bottom`, which clears only a document's END, where `margin-bottom`
   shortens the scroll viewport itself. Same commit: it named the CPU/GPU a THIRD time on Health, so
   the rig segment stands down. Guards `hud-frame-clearance-guard`, `hud-readout-no-duplicate-guard`.
3. **R3+R4 → `2ea9683d`, `cbb36365`. At 1280×720 the readout strip was sliced** — five labels on
   screen with none of their five values, which reads as five readings that came back empty. R3
   lowered the stage floor; R4 found that a floor ALONE does nothing, because the rig is an r3f
   `<Canvas>` that measures its parent and the parent, having no `height`, is sized by that canvas
   in turn. An authoritative `height` breaks the circle. Verified on the installed build in R5.
4. **R5 → `8fd043d1`. Those two shipped as an `@media` block the approved handoff forbids** —
   *"no responsive media queries. Do not add breakpoints as a shortcut."* The pixels were right and
   the mechanism was not, and two commits passed a live decision without naming it. Health's
   geometry is now ONE continuous derivation — `clamp(320px, calc(100vh − named chrome), 500px)` on
   `.hc-panel`, every subtrahend a named variable. **Verified in R6** at measured viewports
   971/711/1071, growing and shrinking. Guard rejects any `@media` in the file.
5. **R6 → UNCOMMITTED. At 1280×720 READINESS and AVG FPS touched with zero gap**, the readiness
   cell's content running 25px past its own column and the MEASURED pill sitting on its neighbour.
   Present since the strip was built; six rounds of review missed it. An `fr` track's automatic
   minimum is min-content, so the wide first track could not shrink below the ArcGauge's intrinsic
   width — the other four already carried `minmax(0, …)`. **The symptom was Health's, the defect is
   the console kit's**, so it is fixed at the source (`arc-gauge.css`: `minmax(0, 1fr)` label column
   + `min-width: 0` on the item) as well as in the readout track. Guards in both files.

**EXACT NEXT STEP.** R6's fix is in the tree, guarded and gated but NOT committed. Commit it →
`cargo clean -p compy --release` → `npm run tauri build` → `scripts/ship-reinstall.ps1` → the same
script `-ProofOnly -ExpectedCommit <full 40-char HEAD>` → **self-review round 7, complete and
fresh**. Arrive at every size by RESIZING, never by launching there — a cold mount renders correctly
even on broken CSS, which is how R3's defect survived a round. Prove all three handoff heights
(1280×720, 1500×980, 1920×1080) and **quote the measured `.hc-stage` box and canvas inline height at
each** — R6 confirmed the viewports but not those two numbers. On PASS → `docs/RELEASE_STATE.md`
(line 45 `STATE:owner_installed_stamp`; the desk row at line 65 moved VERBATIM into
`archive/RELEASE_STATE_HISTORY.md` under that file's existing `### <date> - the <hash> … moved
verbatim (byte budget)` convention; plus the `d5a6a630` mentions at lines 77, 176, 191) → slice 3.

## Live traps for whoever is next

1. **`npx tsc --noEmit` is NOT this project's typecheck.** It returned CLEAN on a file that then
   broke `npm run build` (`TS2304: __dirname` — this project is ESM). The gate is `cargo test` +
   **`npm run build`** + `npx vitest run`. Source-scanning guards resolve repo-root-relative
   (`join("src-tauri", "src", "x.rs")`), never `__dirname`.
2. **`npm run tauri build | tail -N` reports TAIL's exit code.** A dead build was notified as
   "exit 0" and two ship attempts died on the stale-build gate before anyone read the build's own
   output. Also: `tauri build` exits **1** on every desk build (missing `TAURI_SIGNING_PRIVATE_KEY`,
   owner-gated) *after* writing both bundles — the real success signal is "Finished 2 bundles".
   A docs-only commit chain can leave cargo's fingerprint fresh and re-package the PREVIOUS binary;
   `cargo clean -p compy --release` first.
3. **`.codex/config.toml` regresses every few days** — a red `codex-config-guard` in the push gate
   IS that abandoned regression: stash it, do not debug it.
4. **There is no "active but merged" lane state.** `branch-disposition-audit` treats `MERGED` as
   *prunable* and fails until the ref is deleted, while `UNLANDED` fails the moment a fast-forward
   makes the ref a no-op against `main`. A long train therefore cannot keep a lane ref alive: land
   fast-forward straight to `main` and carry no lane branch.
5. **`docs/RELEASE_STATE.md`'s two build-identity rows are byte-capped** (`LINEAGE_ROW_CAPS`,
   `verify-release-state.mjs` check 5b). A ship that overflows one must move the OLDEST inline
   predecessor to `archive/RELEASE_STATE_HISTORY.md` — the failure text says so. Do not raise the
   budget to make room; it is derived from those caps. File is 251/270 lines, 40.3KB/42KB.
6. **Python patches with backslashes must be written to a FILE**, never piped through a Bash heredoc
   — the heredoc and the string literal each eat one layer.
7. **A `SESSION_FOREIGN` refusal cannot be adopted away.** A lineage record that ACTIVELY disagrees
   falls past `cli.mjs adopt` to a branch whose own comment says adoption would refuse too. The cheap
   cure is the first one listed: **reopen the right folder** — a fresh worktree has no record, so it
   is not contended. Do NOT route the write through Bash to dodge it.
8. **The primary worktree `C:/Users/Kuya/code/sentinel` may be stale.** `git -C ... merge --ff-only
   origin/main` before cutting anything there.

## Waiting on the owner

**Nothing blocking.** One thing he may want to *look* at when this train lands: the reshaped Health
room — his veto on sight always stands, and the violet-vs-green call above is still open. The
checklist's remaining items are money/legal calls that cannot move until Pro exists.

**This session: LEAVE OPEN — slice 2 of 7 is mid-flight in `sentinel-fourroom`.** His live app
is `8fd043d1`, one installer on the Desktop.

## Cycle notes before this train — archived

Moved verbatim to [archive/SESSION_HANDOFF_HISTORY.md](archive/SESSION_HANDOFF_HISTORY.md): the
2026-08-22 BACKLOG section-caps pass, and the closed `lane/train-2026-08-22` train (pricing ruling,
PR #193, C-14 GPU screen, #125 write refusal — all landed on `main`).
