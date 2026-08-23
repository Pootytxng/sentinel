# SESSION HANDOFF — paste-ready prompt for the next session

> Live pointer only. Gate truth: [`RELEASE_STATE.md`](RELEASE_STATE.md). Queue:
> [`BACKLOG.md`](BACKLOG.md) ▶ NEXT UP. Owner asks: [`OWNER_ACTION_CHECKLIST.md`](OWNER_ACTION_CHECKLIST.md).
> Budget 120 lines — trim from the bottom, never grow past it.

## Cycle note — 2026-08-23, four-room visual direction (issue #49) — MID-TRAIN, slice 2 of 7

**Worktree `C:/Users/Kuya/code/sentinel-fourroom`, branch `feat/four-room-visual-direction`, head
`7cb43840` + UNCOMMITTED hud-frame work (below). Not pushed, not merged.** Owner brief: implement
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

### Four self-review rounds, four FAILs, six guards — slice 2 is NOT done

Every round was a complete fresh review against `01-health-approved.png` on the INSTALLED build, and
every fix was proven to FAIL on the pre-fix source first. All four findings were honest-measurement
failures wearing layout clothes — a reading nobody can read is a reading that came back empty. R1
and R2 are landed and written up in `docs/UI_VISION_BACKLOG.md` §FOUR-ROOM.

1. **R1 → `7cb43840`.** The 40px verdict read "Applied Compy changes", a filing-cabinet tab: the
   name-it law was guarded with a SYNTHETIC fixture the Rust catalog never matched. All ten
   `Attention` labels now name the finding. Guard `readiness-attention-label-guard.test.ts`.
2. **R2 → `d5bff77e`.** The viewport-fixed `.hud-frame-readout` was a curtain over live readings;
   its clearance was a `padding-bottom`, which only clears the END of a document. `margin-bottom`
   shortens the scroll viewport itself. Same commit: the readout printed the CPU/GPU model a THIRD
   time on Health, so the rig segment stands down there. Guards
   `hud-frame-clearance-guard.test.ts`, `hud-readout-no-duplicate-guard.test.tsx`.
3. **R3 → UNCOMMITTED. At 1280×720 the readout STRIP was sliced in half by `.v2-content`'s own
   overflow — five labels on screen, none of their values.** The comfortable-viewport stage box
   (`min-height: 500px` + 40px padding) costs 540px of a lane only ~595px tall. R2's reserve could
   not fix this; it cannot create height a 720px window lacks. **The stage floor now compresses below
   860px of viewport height** (320 stage / 280 rig / 280 card ceiling) — the rig is the one elastic
   element on Health, and 860 sits well below the owner's real 980px window, so his viewport and the
   comp's proportions are untouched. Guard: the short-viewport case in
   `src/surfaces/home-console.test.tsx` pins the threshold band, re-checks the card-viewport
   derivation inside the override, and caps the compressed box at the measured 397px.
4. **R4 → UNCOMMITTED. R3's floor was not enough and LOOKED like it was.** `getComputedStyle`
   reported the new 320px `min-height` while the box on screen stayed 500px: the rig is an r3f
   `<Canvas>` that measures its parent and writes its own inline size, and the parent — with no
   `height` of its own — is sized by that canvas in turn. Lowering a floor under a box already
   taller than it changes nothing. Growing the window worked, which is why R3 passed its own check;
   **launch-then-shrink, the path every human and every capture harness takes, did not.** The
   override now states an authoritative `height` on the stage AND the rig. Same guard, extended to
   require it.

**EXACT NEXT STEP.** R4's fix is in the tree, guarded and gated but NOT committed. Commit it →
`cargo clean -p compy --release` → `npm run tauri build` → `scripts/ship-reinstall.ps1` → the same
script `-ProofOnly -ExpectedCommit <full 40-char HEAD>` → **self-review round 5, complete and
fresh**. Its re-verification must use the ROUND-4 REPRO, not a cold mount: launch (or size up to
1500×980 first), THEN resize down to 1280×720, and confirm `.hc-stage canvas`'s inline style reports
`height: 280px` (not 460px) and that all five `.hc-readout` values are visible at scrollTop 0. A
cold mount at 720p passed even with the broken CSS. On PASS → `docs/RELEASE_STATE.md` (line 45
`STATE:owner_installed_stamp`; the desk row at line 65 moved VERBATIM into
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
is `2ea9683d`, one installer on the Desktop.

## Cycle notes before this train — archived

Moved verbatim to [archive/SESSION_HANDOFF_HISTORY.md](archive/SESSION_HANDOFF_HISTORY.md): the
2026-08-22 BACKLOG section-caps pass, and the closed `lane/train-2026-08-22` train (pricing ruling,
PR #193, C-14 GPU screen, #125 write refusal — all landed on `main`).
