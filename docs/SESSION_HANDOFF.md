# SESSION HANDOFF — paste-ready prompt for the next session

> Live pointer only. Gate truth: [`RELEASE_STATE.md`](RELEASE_STATE.md). Queue:
> [`BACKLOG.md`](BACKLOG.md) ▶ NEXT UP. Owner asks: [`OWNER_ACTION_CHECKLIST.md`](OWNER_ACTION_CHECKLIST.md).
> Budget 120 lines — trim from the bottom, never grow past it. Replace this file, never append.

## Where the train is standing

**Issue #49 — the approved four-room visual direction.**
Worktree `C:\Users\Kuya\code\sentinel-fourroom` · branch `feat/four-room-visual-direction`.
**Installed desk build `8b1599b3`** — stamp-proved live (`8b1599b3 · release · shell 0.9.26`).
HEAD is guards + docs on top of it; `git diff 8b1599b3 -- src src-tauri` is test files only, so the
desk is current. **Off-disk 2026-08-24, UNDISTRIBUTED**: every lane commit was fast-forwarded onto
`origin/backup/four-room-preservation-2026-08-23`. See the push call below — the name was deliberate.

Slices: 1 shell `34bd33e7` ✅ · 2 Health `40aca1ca` ✅ (round 11) · 3 instrument kit `acdb93c2` ✅
(round 12) · 4 Live `67ce2724` ✅ (round 13) · 5 History `c894e81c` ✅ · 6 Test `8c9fb804` ✅ ·
7 convergence `0c550138` ✅ (round 16) · 8 guards + mainline merge `8b1599b3` ✅ (round 17).

The lane's last commits, all landed this session:
- `7dc87947` — `git merge origin/main` (took `b6727dfc`). **One conflict, `docs/RELEASE_STATE.md`,
  both sides kept**; `git diff 39c57201 7dc87947 -- src/ src-tauri/` is empty, so no app code moved.
  This is what turned the last red test — `branch-disposition-audit` — green: the row it wanted
  lives on main.
- `8b1599b3` — Codex findings 1–3, plus **check (9)** in `scripts/verify-release-state.mjs`.
- `b9bfcaf3` ship docs · `dae29252` Codex findings 4–8 + the shortcut guard · then this docs commit.

## Check (9) — the one mechanism worth knowing about

Check (8) counts anchors; nothing read the **prose**, so a Bottom line could keep naming a superseded
desk build (it did, twice). (9) reads the `**Bottom line:**` paragraph alone: it must carry the current
`owner_installed_stamp`, and any other hex token in it that resolves to a commit **reachable from HEAD**
but **not an ancestor of `origin/main`** is a stale desk stamp and fails. Skips with a note (never a
pass) outside git. 8 cases, all four mutants red. Full rationale: `8b1599b3`.

## Verification at HEAD — all green

`npm run build` exit 0 · `npx vitest run` **370 files, 5009 passed, 5 skipped** ·
`node scripts/verify-release-state.mjs` **32 citations, 0 near-drift, 0 broken, 0 state-drift** ·
`pwsh scripts/doc-budget.ps1` ALL PASS · `ship-reinstall.ps1 -VerifyRuntime` runtime-proved on
attempt 1 at `8b1599b3`, one installer on the Desktop, SHA-256 `32C7A354…C850065`.
`npm run tauri build` exits 1 on the **updater-signature step only** — `TAURI_SIGNING_PRIVATE_KEY` is
owner territory and absent by design. Both bundles are written: normal desk condition, not a failure.

**SELF-REVIEW round 17: VERDICT PASS**, full fresh round on the installed binary at 1500×980.
All 11 rubric items PASS. Two carry-forwards, neither a defect:
1. `.ag-warn` / `.ag-good` are **dead code** — 9 `<ArcGauge>` call sites, none passes `tone` — so those
   two are provable only by injection.
2. WebView2's viewport would not follow an OS resize, so 1280×720 / 1920×1080 were **not** re-measured.

## ⛔ What is still the owner's

**One thing: look at the two taste calls.** A before/after page was handed over this session
(`two-taste-calls.html`) — Test's bench readings and Health's headline, built from the real CSS with
tokens resolved. Both shipped under the taste decree: deciding was mine, seeing is his. Say the word
and either goes back.

Everything else parked on him is closed. **The push call, made and executed:** the commits went to the
existing `backup/four-room-preservation-2026-08-23` ref (fast-forward, additive), NOT to a new
`origin/feat/four-room-visual-direction`. A new remote ref is undispositioned until its row reaches
`main`, and until then `branch-disposition-audit` fails in *every other lane's* pre-push — and landing
that row means merging into `main`, bigger than the backup this was for. Work is off one disk, `main`
untouched, no lane broken; reasoning is in the ref's row. Codex findings 4–8 fixed and falsified.

## The two taste calls, and the one that was never a taste call

- **Test's bench reads** *Proven · Noise floor · Safe stack · Instruments read*; the comp reads
  *READINESS · AVG FPS · 1% LOW · SAFE STACK* — Health's and Live's readings, shown a second time.
- **Health's h1 names the flagged check** (*"Monitor below max refresh"*) instead of the comp's generic
  *"One thing needs your attention."* The 6px amber dot still carries the state; only the 52px changed.
- **Live's past-session trace was never a storage problem — corrected 2026-08-24.** The earlier claim
  here ("the ledger stores summaries, not samples") was wrong: `fps_series` IS persisted (per-10s mean,
  most-recent 20 sessions) and `grep -r fps_series src/` returns the `types.ts` declaration and nothing
  else. No component reads it. Filed as an ordinary UI item, `BACKLOG.md` §A2.

## Codex findings 4–8 — all closed in `dae29252`

Each measured first (0 offenders, so every guard closes at zero debt, no allow-list) and falsified
after — inject the real defect, confirm only the intended test goes red, restore:
| # | What the guard now proves | Falsified by |
|---|---|---|
| 4 | the attention headline IS the flagged check, by name, and its detail travels with it | 2 red, system-posture green |
| 5 | every census entry bucketed `chrome-tag` really is uppercase | reclassify `.cmp-delta` → 1 red |
| 6 | the a11y census counts **mounted** components, not imported ones | un-mount `ShellV2` → 1 red |
| 7 | a `--type-*` font size is a real scale step, declared only in `type-scale.css` | 2 mutants → 2 red |
| 8 | nobody aliases `BentoGrid`/`BentoTile` past the one-hero rule | alias → red, and cases 18→15 |

Finding 5's literal claim did not hold — `.v2-eyebrow`'s mono IS drawn by the comp
(`comp-fidelity-guard.test.ts:488`); the real adjacent weakness, an unbounded bucket, is what closed.

**One of the same class, not from Codex:** `tools/entry/shortcut.test.mjs` gated its live check on
`CONTROL`, a directory that does not exist here, so "the real Desktop shortcut passes" had been
silently skipped forever. What that constant should be is #125's call, so the check is now driven over
injected facts (`launcherProblems`) and the suite says out loud whether the real shortcut was reached:
26 passed, **0 skipped** (was 21 + 1 skipped).

## Standing constraints for whoever picks this up

**The owner's standard, verbatim:** *"this is exactly how its supposed to look and it still isnt quite
there not sure how you werent able to match this perfectly but it needs to to suffice. what should
remain is the color coded system we have for alert levels such as green yellow red for optimal metrics
and notifications please persist with this train until youve perfected your work"*

**Comps** (the only source of truth for the look):
`C:\Users\Kuya\.codex\visualizations\2026\08\23\01a02bee-5474-7961-b05a-e674fb8bb165\compy-four-room-handoff\`
`01-health` → room id **`home`** · `02-live` → **`play`** · `03-history` → **`learn`** · `04-test` → **`lab`**.
Room ids are not tab labels: `lab` is the tab the owner sees as **Test**. The PNGs are **1550px renders
of a 1500px design — divide by 1.0333.** Brightness deltas vs a screenshot are gamma, not findings.

**Headline sizes, settled:** `Home 52 · Live 40 · History 40 · Test 52` — the guard's own comp reading
(`comp-fidelity-guard.test.ts:300`).

**Every write here needs a verified session.** After a compaction or a new window:
`node tools/entry/cli.mjs adopt --folder "C:\Users\Kuya\code\sentinel-fourroom" --issue 49 --session <id>`.
`Bash` is the named hole in the write guard — adopt before the first `sed`, not after.

## This session: done. Nothing is queued behind it.

Committed, built, installed, reviewed, copied off-disk. Only the owner's look at the two taste calls
is outstanding. Leave this file open as the resume point for #49.
