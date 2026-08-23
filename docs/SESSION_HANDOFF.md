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

### Round 1 FAIL → `7cb43840` (committed + installed; superseded by round 2)

The h1 read **"Applied Compy changes"** at 40px. The name-it-and-fix-it-inline law makes the verdict
BE the flagged check's label and `system-posture.test.ts` pins `headline === label` — but it was
guarded with a SYNTHETIC fixture while every `ReadinessStatus::Attention` branch in `readiness.rs`
emitted a category noun. **All ten Attention labels now name the finding**; calm branches keep their
category label on purpose. Guard `src/surfaces/readiness-attention-label-guard.test.ts` scans the
Rust catalog (both the `check()` helper and the struct-literal form) and fails if any check reuses
its calm label for its attention state; its first assertion pins the parsed row count so a refactor
cannot make it pass vacuously. **Proven to fail on the pre-fix source.**

### Round 2 FAIL → UNCOMMITTED, in progress

`.hud-frame-readout` (viewport-fixed bottom-right chrome) **covered real readings at rest** — at
1280×720 the READINESS / AVG FPS numbers, at **1500×980, the owner's real viewport**, the Detected
record's Processor row. Its clearance was `padding-bottom: 52px`, and padding only clears the END of
a document, never the band a viewport-fixed element occupies at an arbitrary scroll offset; the
2026-08-20 intimidation pass had given the readout an OPAQUE ground, which is what turned it from a
smudge into a curtain. A covered reading reads as an absent one — honest-measurement, not cosmetics.

- **DONE, uncommitted:** `src/design/console/hud-frame.css` reserves the band with
  `margin-bottom: 36px` (+ non-load-bearing `padding-bottom: 16px`), shortening the scroll viewport
  so nothing renders under the readout in any room at any offset. New
  `src/design/console/hud-frame-clearance-guard.test.ts` parses the stylesheet's own geometry and
  fails if the reserve is a padding or is smaller than the band. **Proven to fail on the old CSS.**
- **DONE, uncommitted:** [ShellV2.tsx:360](../src/design/ShellV2.tsx#L360) stands the rig segment
  down on Health — the readout was printing the CPU/GPU model a THIRD time (Detected record +
  the 3D rig's annotations), against `HudFrame.tsx`'s own doctrine. `HudFrame` omits a null
  segment, so there it collapses to the clock. Guard
  `src/design/console/hud-readout-no-duplicate-guard.test.tsx`; its second case renders a room
  that DOESN'T show the rig, so the guard cannot pass by the frame vanishing. **Proven to fail.**

**EXACT NEXT STEP.** Both fixes are in the tree and both guards are green. Re-run the full gate
(`npm run build` + `npx vitest run` + `cargo test`) → commit → `npm run tauri build` → `scripts/ship-reinstall.ps1` → the same script
`-ProofOnly -ExpectedCommit <full 40-char HEAD>` → **self-review round 3, a complete fresh review**,
including the reviewer's own re-verification: `getBoundingClientRect` on `.hud-frame-readout` vs
`.hc-readout` vs `.hc-spec-row` at 1280×720 / 1500×980 / 1920×1080 must show ZERO intersection. On
PASS → `docs/RELEASE_STATE.md` (line 45 `STATE:owner_installed_stamp`; the desk row at line 65 moved
VERBATIM into `archive/RELEASE_STATE_HISTORY.md` under that file's existing
`### <date> - the <hash> … moved verbatim (byte budget)` convention; plus the `d5a6a630` mentions at
lines 77, 176, 191) → THEN slice 3.

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

**This session: LEAVE OPEN — slice 2 of 7 is mid-flight with uncommitted work in
`sentinel-fourroom`.** His live app is `7cb43840`, one installer on the Desktop.

## Cycle notes before this train — archived

Moved verbatim to [archive/SESSION_HANDOFF_HISTORY.md](archive/SESSION_HANDOFF_HISTORY.md) to stay
inside the 120-line budget: the 2026-08-22 BACKLOG section-caps pass, and the closed
`lane/train-2026-08-22` persistent train (pricing ruling, PR #193, C-14 GPU screen, #125 write
refusal — all landed on `main`).
