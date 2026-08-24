# SESSION HANDOFF — paste-ready prompt for the next session

> Live pointer only. Gate truth: [`RELEASE_STATE.md`](RELEASE_STATE.md). Queue:
> [`BACKLOG.md`](BACKLOG.md) ▶ NEXT UP. Owner asks: [`OWNER_ACTION_CHECKLIST.md`](OWNER_ACTION_CHECKLIST.md).
> Budget 120 lines — trim from the bottom, never grow past it. Replace this file, never append.

## Where the train is standing

**Issue #49 — the approved four-room visual direction.**
Worktree `C:\Users\Kuya\code\sentinel-fourroom` · branch `feat/four-room-visual-direction`.
**HEAD `8b1599b3`** — built, silently installed, stamp-proved live (`8b1599b3 · release · shell 0.9.26`).
**UNPUSHED and UNDISTRIBUTED.** #49 authorized local implementation and its verification only.

Slices: 1 shell `34bd33e7` ✅ · 2 Health `40aca1ca` ✅ (round 11) · 3 instrument kit `acdb93c2` ✅
(round 12) · 4 Live `67ce2724` ✅ (round 13) · 5 History `c894e81c` ✅ · 6 Test `8c9fb804` ✅ ·
7 convergence `0c550138` ✅ (round 16) · 8 guards + mainline merge `8b1599b3` ✅ (round 17).

The lane's last two commits, both landed this session:
- `7dc87947` — `git merge origin/main` (took `b6727dfc`). **One conflict, `docs/RELEASE_STATE.md`,
  both sides kept**; `git diff 39c57201 7dc87947 -- src/ src-tauri/` is empty, so no app code moved.
  This is what turned the last red test — `branch-disposition-audit` — green: the row it wanted
  lives on main.
- `8b1599b3` — Codex findings 1–3, plus **check (9)** in `scripts/verify-release-state.mjs`.

## Check (9) — what it is and why it exists

Check (8) counts anchors; nothing read the **prose**, so a Bottom line could keep naming a desk build
the anchors had already superseded (it did, twice). (9) reads the `**Bottom line:**` paragraph alone:
**9a** — if that paragraph mentions the desk at all it must contain the current
`owner_installed_stamp`. **9b** — any other hex token in it that resolves to a real commit,
**is reachable from HEAD** (so this lane built it) and is **not an ancestor of `origin/main`** (so it
was never released) is a stale desk stamp and fails. That pair of conditions is the whole
discriminator: published hashes are mainline ancestors and pass; preserved off-lane branches are not
reachable from HEAD and pass; prose words made of hex letters resolve to nothing and pass.
It skips with a note (never a pass) on a shallow clone, outside git, or with no `main` to compare to.
8 cases in `scripts/verify-release-state-guard.test.mjs`, all four mutants of (9) proved red.

## Verification at `8b1599b3` — all green

`npm run build` exit 0 · `npx vitest run` **370 files, 4999 passed, 5 skipped** ·
`node scripts/verify-release-state.mjs` **32 citations, 0 near-drift, 0 broken, 0 state-drift** ·
`pwsh scripts/doc-budget.ps1` ALL PASS · `ship-reinstall.ps1 -VerifyRuntime` runtime-proved on
attempt 1, one installer on the Desktop, SHA-256 `32C7A354…C850065`.
`npm run tauri build` exits 1 on the **updater-signature step only** — `TAURI_SIGNING_PRIVATE_KEY` is
owner territory and absent by design. Both bundles are written; this is the normal desk condition and
is documented as such in the archive. It is not a build failure.

**SELF-REVIEW round 17: VERDICT PASS**, full fresh round on the installed binary at 1500×980.
All 11 rubric items PASS. Two carry-forwards, neither a defect:
1. `.ag-warn` / `.ag-good` are **dead code** — 9 `<ArcGauge>` call sites, none passes
   `tone="warn"`/`"good"` — so those two are provable only by injection.
2. WebView2's viewport would not follow an OS resize, so 1280×720 / 1920×1080 were **not** re-measured
   this round. Reported honestly rather than carried forward as if measured.

## ⛔ Three things are the owner's, and only his

1. **Push `feat/four-room-visual-direction`?** #49 authorized local work only. Nothing is pushed.
   Claude's recommendation: **yes, push the branch** (not a release, not a merge) — 36 commits exist
   on one disk, `origin/backup/four-room-preservation-2026-08-23` only covers up to `39c57201`, and
   pushing a branch reaches no one's machine. Deleting that backup ref is the same change.
2. **Three deviation sign-offs** (logged, shipped, reversible — see next section).
3. **Codex findings 4–8** — open and unassigned (see below).

## The three deviations awaiting sign-off

- **Test's bench readings** read *Proven · Noise floor · Safe stack · Instruments read*; the comp reads
  *READINESS · AVG FPS · 1% LOW · SAFE STACK*. The comp's four are Health's readings; on the Test room
  they would be a second copy of another room's instrument, not a bench.
- **Health's h1 names the flagged check** ("Your storage is nearly full") instead of the comp's generic
  *"One thing needs your attention."* Naming it is the more useful headline; it is also a deviation.
- **Live's trace cannot show a past session's per-sample series** — the ledger stores summaries, not
  samples. Unfixable inside this brief; it needs a storage change, which is its own issue.

## Codex findings 4–8 — open, unassigned

| # | Sev | What | Where |
|---|---|---|---|
| 4 | HIGH | The readiness-attention guard only proves two strings **differ** — it never proves either is the flagged check | `comp-fidelity-guard.test.ts` |
| 5 | MED | An **unlogged mono deviation**: the census blesses it as `chrome-tag` | `shell-v2.css:688` |
| 6 | MED | The a11y census equates **importing** a component with **mounting** it | a11y census test |
| 7 | MED | The type-scale guard accepts an arbitrary **local** `--type-*` override | `tokens-v2-guard.test.ts` |
| 8 | LOW | The one-hero rule is defeated by `import BentoGrid as Grid` | one-hero guard |

**One more of the same class, found this session, NOT from Codex:** `tools/entry/shortcut.test.mjs`
pins `CONTROL = C:UsersKuyacodecompy-control`, a directory that does not exist on this machine,
so `it.runIf` has left "the real Desktop shortcut passes every guard above" **permanently skipped**.
The shortcut itself is fine (it targets `codesentinelcompy-entry.ps1`, which exists). Fixing it means
deciding what `CONTROL` was meant to be — that is #125's call, not this lane's.

Claude's read: **4 is the only one worth doing before a push** — a guard that cannot fail is worse
than no guard, because it reads green in every report. 5–8 are guard-tightening, not app defects;
they belong in a follow-up issue, not in this lane.

## Standing constraints for whoever picks this up

**The owner's standard, verbatim:** *"this is exactly how its supposed to look and it still isnt quite
there not sure how you werent able to match this perfectly but it needs to to suffice. what should
remain is the color coded system we have for alert levels such as green yellow red for optimal metrics
and notifications please persist with this train until youve perfected your work"*

**Comps** (the only source of truth for the look):
`C:\Users\Kuya\.codex\visualizations\2026\08\23\01a02bee-5474-7961-b05a-e674fb8bb165\compy-four-room-handoff\`
`01-health` → room id **`home`** · `02-live` → **`play`** · `03-history` → **`learn`** · `04-test` → **`lab`**.
Room ids are not tab labels: `lab` is the tab the owner sees as **Test**.
The PNGs are **1550px renders of a 1500px design — divide every measurement by 1.0333.** Brightness
deltas against a screenshot are gamma, not findings.

**Headline sizes, settled:** `Home 52 · Live 40 · History 40 · Test 52` — the guard's own comp reading
(`comp-fidelity-guard.test.ts:300`). Round 16's record listed those four numbers in the wrong room
order; nothing in the app changed between rounds 16 and 17.

**Every write here needs a verified session.** After a compaction or a new window:
`node tools/entry/cli.mjs adopt --folder "C:\Users\Kuya\code\sentinel-fourroom" --issue 49 --session <id>`.
`Bash` is the named hole in the write guard — adopt before the first `sed`, not after.

## This session: done. Nothing is queued behind it.

The whole lane is committed, built, installed and reviewed. What remains is the owner's three calls
above. Leave this file open as the resume point for #49.
