# SESSION HANDOFF — paste-ready prompt for the next session

> Live pointer only. Gate truth: [`RELEASE_STATE.md`](RELEASE_STATE.md). Queue:
> [`BACKLOG.md`](BACKLOG.md) ▶ NEXT UP. Owner asks: [`OWNER_ACTION_CHECKLIST.md`](OWNER_ACTION_CHECKLIST.md).
> Budget 120 lines — trim from the bottom, never grow past it.

## Cycle note — 2026-08-23, four-room visual direction (issue #49) — MID-TRAIN, slice 5 of 7

**Worktree `C:/Users/Kuya/code/sentinel-fourroom`, branch `feat/four-room-visual-direction`,
nothing pushed.** Owner brief: implement
the approved comps in `~/.codex/visualizations/2026/08/23/01a02bee-.../compy-four-room-handoff/`
(`HANDOFF.md` + four PNGs), in the handoff's order: shell → Health → shared instruments → Live →
History → Test → convergence. **Local implementation only — the brief does NOT authorize release or
distribution.** Held throughout and mechanically checked: `git diff 34bd33e7~1 -- src` adds no
`invoke(`, `-- src-tauri` adds no `#[tauri::command]` — no new IPC, room, network path, mutation or
flag. Ten substitutions are logged in `docs/UI_VISION_BACKLOG.md` §FOUR-ROOM and issue #49; the only
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

### Slice 2 (Health) took eleven self-review rounds, ten FAILs, eleven permanent guards

All four findings were honest-measurement failures wearing layout clothes — a reading nobody can
read is a reading that came back empty. **The recurring root cause, and the one to expect again: a
track or box sized by CONTENT, in a strip whose content is translated and wraps.** Two rails came
out of it that still bind every slice: **no `@media` breakpoints** (the handoff forbids them, and a
guard now bans them), and cells that must line up **subgrid onto one shared set of rows**. Round by
round, verbatim, in
[archive/SESSION_HANDOFF_HISTORY.md](archive/SESSION_HANDOFF_HISTORY.md); R1–R2 also in
`docs/UI_VISION_BACKLOG.md` §FOUR-ROOM.

**SLICE 4 IS DONE — `67ce2724`, self-review round 13 PASS** (a real Start→Stop capture exercised on
the built app). Live's capture face composes its OWN `RoomShell` in the approved split; `MonitorV2`
delegates to it and hands down the two pieces that are the ROOM's (segment bar, presets expander).
Five corner ArcGauges became one five-up kit `Reading` strip; Start capture MOVED into the single
action slot; the bento deck, 2×2 readouts and session stack moved DOWN into `below`, none of it
deleted. **The Instrument-HUD masthead left Monitor in both flag states** — Live and Sessions are
one room and cannot wear two headers a tab apart (UX-1 precedent,
`docs/decisions/2026-08-11-design-foundation.md` decision 1). Seven new guards, each proven to FAIL
first. His live app is `67ce2724`; RELEASE_STATE says so.

**EXACT NEXT STEP — slice 5, History**, target `03-history-approved.png`: one chronological tape
grouped by month, `Review latest session` as the dominant action, Logbook/Field-Guide switching and
every filter preserved with their `aria-pressed` semantics, the eight-row screenful and the honest
"Show N older records" kept. THE PARENT CONTRACT TRAVELS wherever a `Reading` is placed: the strip
must be `display: grid` with exactly `READING_ROWS` row tracks and every non-Reading sibling must
span them. Then build + full vitest → commit → `tauri build` → `ship-reinstall.ps1` → prove the
stamp → **self-review round 14 against the History PNG**.

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
   budget to make room; it is derived from those caps. File is 253/270 lines, 41KB/42KB.
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

**This session: LEAVE OPEN — slice 5 of 7 is next in `sentinel-fourroom`.** His live app is
`67ce2724` (R13 PASS, installed and proven); slices 1–4 done, nothing pushed.

## Cycle notes before this train — archived

Moved verbatim to [archive/SESSION_HANDOFF_HISTORY.md](archive/SESSION_HANDOFF_HISTORY.md): the
2026-08-22 BACKLOG section-caps pass, and the closed `lane/train-2026-08-22` train (pricing ruling,
PR #193, C-14 GPU screen, #125 write refusal — all landed on `main`).
