# SESSION HANDOFF — paste-ready prompt for the next session

> Live pointer only. Gate truth: [`RELEASE_STATE.md`](RELEASE_STATE.md). Queue:
> [`BACKLOG.md`](BACKLOG.md) ▶ NEXT UP. Owner asks: [`OWNER_ACTION_CHECKLIST.md`](OWNER_ACTION_CHECKLIST.md).
> Budget 120 lines — trim from the bottom, never grow past it.

## Cycle note — 2026-08-23, four-room visual direction (issue #49) — MID-TRAIN, slice 2 of 7

**Worktree `C:/Users/Kuya/code/sentinel-fourroom`, branch `feat/four-room-visual-direction`, head
`a35e72fc`. Not pushed, not merged.** Owner brief: implement the approved comps in
`~/.codex/visualizations/2026/08/23/01a02bee-5474-7961-b05a-e674fb8bb165/compy-four-room-handoff/`
(`HANDOFF.md` + four PNGs). **Local implementation only — the brief does NOT authorize release or
distribution.** Order is the handoff's: shell → Health → shared instruments → Live → History →
Test → convergence. Constraint held throughout: no new IPC, backend source, room, network
behaviour, Windows mutation or feature flag.

- **Slice 1 `34bd33e7` — shell.** `RoomShell` gained `aside`/`below`; `data-layout="split"` derives
  from `aside`; the split is grid-AREAS in `shell-v2.css`, **no wrapper divs**, so non-split rooms
  stay byte-identical and every existing selector keeps resolving. `--v2-aside: min(620px, 58%)`
  (`tokens-v2.css`) is measured off the comps — 620px at the 1120 cap, and it yields FIRST below
  the cap so the 40px verdict keeps a column it can hold. DOM order is the handoff's a11y line:
  verdict → primary action → focal evidence (`aside`) → supporting (`body`) → deeper (`below`).
- **Slice 2 `e6e35dfb` — Health.** The four corner `ArcGauge`s and the floating control row came
  OFF the canvas onto a new `.hc-panel`, which also took the chrome — so the border-masked glow and
  the parallax vars are written on **`panelRef`, not `stageRef`** (`stageRef` is now only the
  reticle's scope). CPU temp left the annotation plane for the readout strip; its
  `callout.cpuNoTemp` line travelled WITH it, which is why `cpu-temp-reachability-guard` needed no
  edit. `Reading` is deliberately Health-LOCAL in `HomeConsole.tsx` (precedent: `Callout`,
  `SpecBox`); **slice 3 promotes it to `src/design/console/`** once Live/Test are the evidence. The
  detected record is the `below` grid's hero and is now UNCONDITIONAL — one-hero-guard forbids a
  conditional hero, so the empty case is an honest `.hc-none` line inside a tile that always
  renders. Quick-symptom rows are shortcuts into the interview via the new `HomeInterview`
  `initialPath` prop; their heading is **not** the interview's root question, because the guard on
  the owner-deleted intake band pins that it may not print on Home.
- **Guards re-anchored, never deleted.** Seven selected the CORNER a gauge sat in
  (`.hc-tl/.hc-tr/.hc-bl/.hc-br`). Every reading now carries
  `data-read="readiness|avgFps|low1|gpuTemp|cpuTemp"` and the guards anchor to the FACT. The
  2D-viewport `bug→guard` was re-aimed at the defect instead of its workaround: it now asserts
  nothing is positioned over the canvas at all and that all five readings survived the move.
- **Verified:** `tsc --noEmit` clean · vitest **364 files / 4870 passed, 6 skipped** · doc-budget
  ALL PASS.

**EXACT NEXT STEP.** A `npm run tauri build` was running in `sentinel-fourroom` when this was
written. When it finishes: `scripts/ship-reinstall.ps1` → prove live==build via `get_build_stamp`
(never an exe hash) → capture 1280×720 / 1500×980 / 1920×1080 → dispatch the `self-review`
subagent against `01-health-approved.png` → `SendUserFile` the violet-vs-green before/after — THEN
slice 3. Any visual correction requires another complete self-review. When all four rooms converge,
hand the head + evidence to **Codex** for independent visual and frontend-contract review.

**Four logged substitutions** (comp vs shipped) are in `docs/UI_VISION_BACKLOG.md` §FOUR-ROOM and
in issue #49's slice-2 comment: violet not green primary action · symptom rows carry no icon or
sub-description · the readiness cell keeps ArcGauge's ring-left layout (slice 3's job) · a symptom
picker is back in the Home slot the owner deleted on sight in August (different frame and wording,
guard still green, and the comp is the newer decision — flagged anyway).

## Cycle note — 2026-08-22, third pass — BACKLOG section caps (landed; the guard now says it)

`docs/BACKLOG.md`'s three append-only queues each got a byte cap in `scripts/doc-budget.ps1`
(`$sectionByteBudgets`) mirrored by `scripts/doc-budget-guard.test.mjs`, which PARSES them rather
than restating them — a file budget could see the total but never WHICH queue grew. 7 closed rows
archived to `BACKLOG_ARCHIVE.md` §`2026-08-22b`. Also corrected: `license.rs` is 380 finished lines
behind an all-zeros key, already recorded built-dark at `RELEASE_STATE.md:125` — what is left on
Pro is the owner's entity/merchant errands, not code.

## Cycle note — 2026-08-22, `lane/train-2026-08-22` — CLOSED (detail in git, not here)

Landed and reported: pricing evidence + the owner's **$4.99/mo · $39/yr · $89 lifetime** ruling
(`55ecb642`, `c796875b`; priced, NOT published — nothing goes on the site until Pro exists) · PR
#193 (`d5571766`) · C-14 GPU screen mounted in the Lab (`b9ce8354`) · the #125 write refusal ARMED
(`d5a6a630`) · five stale owner sign-offs archived. Desk build `0.9.26` / stamp **`d5a6a630`**,
`self-review` PASS 11/11.

**Still open, and NOT an agent's to move here:** Codex weekly automation → product-conformance scope
is the Codex lane's. **Compy Pro itself is unbuilt.** Recorded closed but not *solved*: #121's cause
stays unattributable at 100 ms poll resolution, and #128's **release** mutex has never been held
during a real publish.

## Live traps for whoever is next

1. **`.codex/config.toml` regresses every few days** — a red `codex-config-guard` in the push gate
   IS that abandoned regression: stash it, do not debug it.
2. **There is no "active but merged" lane state.** `branch-disposition-audit` treats `MERGED` as
   *prunable* and fails until the ref is deleted, while `UNLANDED` fails the moment a fast-forward
   makes the ref a no-op against `main`. A long train therefore cannot keep a lane ref alive: land
   fast-forward straight to `main` and carry no lane branch, which is what this train ended up doing.
3. **`docs/RELEASE_STATE.md`'s two build-identity rows are byte-capped** (`LINEAGE_ROW_CAPS`,
   `verify-release-state.mjs` check 5b). A ship that overflows one must move the OLDEST inline
   predecessor to `archive/RELEASE_STATE_HISTORY.md` — the failure text says so. Do not raise the
   budget to make room; it is derived from those caps. File is 251/270 lines, 40.3KB/42KB.
4. **Python patches with backslashes must be written to a FILE**, never piped through a Bash heredoc
   — the heredoc and the string literal each eat one layer.
5. **A `SESSION_FOREIGN` refusal cannot be adopted away.** `project-write-assert.mjs` routes
   unverified/lapsed sessions to `cli.mjs adopt`, but a lineage record that ACTIVELY disagrees
   falls to a third branch whose own comment says adoption would refuse too. Its first listed cure
   is the cheap one: **reopen the right folder** — a fresh worktree has no record, so it is not
   contended (`writer-contention.test.mjs`: "a Claude session in ANOTHER root is somebody else's
   business"). That is how this cycle got written. Do NOT route the write through Bash to dodge it.
6. **The primary worktree `C:/Users/Kuya/code/sentinel` may be stale.** `git -C ... merge --ff-only
   origin/main` before cutting anything there.

## Waiting on the owner

**Nothing blocking, and nothing newly urgent.** The checklist's remaining items are money/legal calls
that cannot move until Pro exists. The one thing he may want to *look* at: the new GPU panel in the
Lab room — reviewed and PASSed, but his veto on sight always stands.

**This session: done — archive it.** Tree clean, `main` carries every commit, his live app is
`d5a6a630`.
