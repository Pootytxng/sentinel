# SESSION HANDOFF — paste-ready prompt for the next session

> Live pointer only. Gate truth: [`RELEASE_STATE.md`](RELEASE_STATE.md). Queue:
> [`BACKLOG.md`](BACKLOG.md) ▶ NEXT UP. Owner asks: [`OWNER_ACTION_CHECKLIST.md`](OWNER_ACTION_CHECKLIST.md).
> Budget 120 lines — trim from the bottom, never grow past it. Replace this file, never append.

## Where the train is standing

**Issue [#49](https://github.com/Pootytxng/sentinel/issues/49) — the approved four-room visual direction.**
Worktree `C:\Users\Kuya\code\sentinel-fourroom` · branch `feat/four-room-visual-direction`.
**Installed desk build `ccc17355`** — stamp-proved live (`ccc17355 · release · shell 0.9.26`).

**The blocker this file carried for a day is GONE.** `FpsTrace` has been built, installed and
**self-reviewed PASS**. `git diff ccc17355 -- src` is empty: the desk and the lane tip are the same
screen code, and the BACKLOG §A2 box is closed.

## What this session did

It was not this lane's session. The owner asked the `sentinel-home-room` session to *"run the self
review and clear up any remaining work or unfinished task"*, and the one thing this lane's own
handoff named as blocking was a `self-review` round **the building session could not spawn**. Picked
up under a **verified takeover** (WORK_CONTROL §Collision rule 5) posted on #49 with the evidence —
clean worktree, no live build process, no CDP port, a handoff commit as the previous session's last
act. No four-room design decision was touched and nothing was merged to `main`.

1. **Gate** — `scripts/verify-local.ps1` at `ccc17355`, read in full: **371 test files / 5033 passed
   / 5 skipped**, type-check + build clean, **964 Rust tests 0 failed**, clippy clean, exit 0.
2. **Build + ship** — `npm run tauri build` (both bundles written; it exits 1 only on the
   updater-signature step, because `TAURI_SIGNING_PRIVATE_KEY` is owner territory and absent), then
   `scripts/ship-reinstall.ps1 -VerifyRuntime -ExpectedCommit ccc1735…` — runtime proof on **attempt
   1, 0 transient**, one installer on the Desktop, installer SHA-256 `B3D55577…C2BB4C`.
3. **`self-review` VERDICT: PASS, round 18** in the `self-reviewer` subagent, at the owner's
   1500×980, on the **installed** binary.
4. **Docs re-stamped in the same pass** — `RELEASE_STATE.md`'s owner-installed row + `STATE:` anchor
   + Bottom line now name `ccc17355`; `8b1599b3`'s row moved byte-for-byte to
   [`archive/RELEASE_STATE_HISTORY.md`](archive/RELEASE_STATE_HISTORY.md) under the row cap.
   `verify-release-state.mjs` → **31/31 ok, 0 drift**.

## What the review actually proved, and the one thing it could not

Two of `FpsTrace`'s three honesty properties were proved **on screen** against this desk's real
`sessions.json` (series of 1229 / 506 / 69 samples):

- **a missing bucket ENDS the run** — the 1229-sample session draws two visibly split polylines, no
  line painted across minutes nobody watched;
- **the axis is anchored at 0** — the rung sits at real half-peak, so a steady session reads flat
  instead of as a fabricated cliff.

**The third could not be produced and is NOT claimed.** A gap-isolated single sample renders as a
dot — none of the three real sessions has an isolated single-bucket run, so that property stays
verified in `geometry.ts` + `geometry.test.ts` only. It is written down as a real-data limit in the
BACKLOG row and the RELEASE_STATE row. **Do not upgrade it to "observed" without a session that
actually has one.**

`1916cca0` is in the reviewed binary: the gap label had shipped on `--status-attention`, which would
have made **amber mean two things** against COLOR-1. The installed build computes `--muted`
`rgb(139,147,167)`.

## What is left, and who owns it

- **#49's merge to `main` is the owner's**, and nothing here changes that. The lane is 44 commits
  ahead of `main` and one behind it (`1568f3d3`, the #209 copy-truth train). **`main`'s five
  Optimize copy fixes are not on the desk** — whoever merges carries them.
- **New: [#211](https://github.com/Pootytxng/sentinel/issues/211)** — the reviewer flagged, out of
  scope and correctly not failed, that the **Live room's `<h1>` concatenates its eyebrow with a
  dynamic sentence** ("Session monitor" + "Last session ran smooth — …"). Inherited, not introduced
  by `c725c0a6`. Needs its own bounded change plus the guard that stops the class.
- **The backup ref is current again** — `origin/backup/four-room-preservation-2026-08-23` was
  fast-forwarded to this tip, the additive move its own disposition row already authorizes.

## Live traps for whoever is next

1. **`.codex/config.toml` regresses every few days** ([#196](https://github.com/Pootytxng/sentinel/issues/196))
   — a red `codex-config-guard` in the push gate IS that regression: discard it, do not debug it.
2. **`ship-reinstall.ps1 -VerifyRuntime` needs three arguments, not one.** `-ExpectedCommit` must be
   the **full 40-char** sha, and `-ExpectedInstallerPath` / `-ExpectedInstallerSha256` are
   all-or-nothing. Bare `-VerifyRuntime` throws before it does anything.
3. **`npm run tauri build` exits 1 on a desk build and that is not a failure.** Both bundles are
   written; the non-zero comes from the updater-signature step alone. Read the log, not the exit
   code — and never pipe the build through `tail`, which reports `tail`'s exit code instead.
4. **The owner-installed row is byte-capped at 3000** (`LINEAGE_ROW_CAPS`, check 5b). A ship that
   overflows it must move the OLDEST inline predecessor to the archive and rewrite that segment's
   relative links for the extra directory level. Do not raise the cap.
5. **Check 9 reads the Bottom line too.** Re-stamping the row and the `STATE:` anchor is not enough
   — the Bottom-line paragraph names the desk build in prose and fails separately if it goes stale.

## Waiting on the owner

**Nothing blocking.** The one thing he may want to *look* at is the new trace: **Live → a past
session → "Session shape"**. Reviewed and PASSed, but his veto on sight always stands.

**This session: done for #49's review step — leave the lane open for its merge, which is his.**
