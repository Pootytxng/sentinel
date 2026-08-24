# SESSION HANDOFF — paste-ready prompt for the next session

> Live pointer only. Gate truth: [`RELEASE_STATE.md`](RELEASE_STATE.md). Queue:
> [`BACKLOG.md`](BACKLOG.md) ▶ NEXT UP. Owner asks: [`OWNER_ACTION_CHECKLIST.md`](OWNER_ACTION_CHECKLIST.md).
> Budget 120 lines — trim from the bottom, never grow past it. Replace this file, never append.

## Where the train is standing

**Issue [#49](https://github.com/Pootytxng/sentinel/issues/49)'s work is ON `main`, and so is
[#213](https://github.com/Pootytxng/sentinel/issues/213)'s correctness half and
[#211](https://github.com/Pootytxng/sentinel/issues/211).** No lane branch on origin. The owner's
desk runs `f223466a`, installed silently, one installer on the Desktop.

Worktree `C:\Users\Kuya\code\sentinel-visual-2026-08-24` · branch `lane/four-room-land-2026-08-24`
(local only, never pushed under its own name — it fast-forwards `main` and carries no ref).

**Neither #49 nor #213 is closed.** #49's direction half and #213's B1–B5 are the same unbuilt work.

## What this session did

1. **Landed #49 on `main`** — the owner handed over the merge decision and it was made **land it**:
   49 commits of installed, self-review-PASSed work sat on one disk plus a backup ref. Zero source
   conflicts. The backup ref was deleted in the same change as its disposition row.
2. **Disk bloat, both halves.** The flag was not green because the machine was clean — it was
   *structurally blind*. Six build trees held **59.08 GB** and not one crossed the 20 GB per-tree
   line, on a drive at 92%. `cargo clean` on the four idle trees returned **35.9 GB** (81 → 112 GB
   free). Then the rule was extended — an **IDLE** class and a **FLEET** total (40 GB across all
   worktrees) — with 11 new guard cases. Still report-only in every class.
3. **#213 triaged against the pixels: 3 real, 2 not.** **A4** (a raw Windows tooltip on the rail,
   repeating the label an inch below it) and **A5** (the titlebar printing "Compy" beside the
   wordmark) are FIXED and installed. **A2** (the "orphan bracket") is `hud-frame.css` drawing all
   four corners symmetrically — working as designed. **A3** (the "clipped left edge") was the
   *capture tool*: `GetWindowRect` includes the invisible DWM resize border, so `CopyFromScreen`
   took ~8px of desktop and another window's text showed through it. **A1** (`©ompy`) is real and
   is the owner's, because the taste decree reserves the logo.
4. **#211 fixed** — every room passed its `<RoomEyebrow>` inside `verdict`, which renders inside the
   `<h1>`, so a room's one top-level heading was its stable name welded to a live measurement.
   `eyebrow` is its own `RoomShell` slot now, same place on screen, one level out of the heading.
5. **The Cowork amendment landed as a guard, not a paragraph** — *a clipped element, an overlapping
   glyph, or an unstyled native control is a correctness failure, not a matter of taste* is **rubric
   item 12** in `.claude/agents/self-reviewer.md`, ALWAYS-on, named regions required as evidence,
   plus a routing rule in the `self-review` skill. It carries A2/A3 as its counter-precedent with
   equal weight: **prove the pixels before calling something a defect.**
6. **A flaky push-gate test fixed.** `release-transaction-e2e`'s retry-boundaries case spawns
   powershell 16 times and crossed its 120s allowance *inside the full suite* (216s for the file),
   failing the gate on wall clock rather than an assertion. Allowance 300s; assertions untouched.
7. **The self-review FAILED the first build, and that is the point.** Round 1 on `9c349ce6` found
   #211 only half-fixed: `MonitorConsole.tsx` — the file that mounts when Live opens — still welded
   the heading, and the guard's hand-written room list could not see it. Fixed in `f223466a` with a
   THIRD guard half that reads `src/surfaces` from disk, plus a 6px gap the Sessions segment was
   quietly eating. Round 2 on the reinstalled build: **PASS**, 16px measured in all four rooms.

## What is left, and who owns it

- **#213 B1–B5 is direction and belongs to #49** — blocked on the owner's ChatGPT mockups, which no
  session in this repo has. Ask for them before anything else visual is planned.
- **#211 is fixed but still OPEN**, deliberately. Closing it is a proof-dependent transition and
  `scripts/work-control-gate.mjs` wants an independent review bound to the *current* head; the
  self-review PASS is bound to `f223466a`, and the doc commits after it move the head. Close it from
  a head where both the push gate and an independent review ran — that is a five-minute first act
  for the next lane, not a blocker.
- **[PR #163](https://github.com/Pootytxng/sentinel/pull/163) is still open** and needs a
  disposition; its handoff-block half already reached `main` as `39841601`.
- Smaller owed items, unchanged: the zh-CN locale's 4 keys carrying the unmeasured "without dropping
  frames" promise · the `doc-truth-guard` RETIRED_CLAIMS entry unblocked by #207 ·
  `license.rs:181-184` writing `license.key` with no `MutationRoot` gate (latent — reproduce before
  filing) · `site/library/invented-issue-counter.html:7,12`'s literal "847 issues found".

## Live traps for whoever is next

1. **A short-lived PR branch is a trap here.** The disposition audit fails **both** ways, so a pushed
   lane ref with no row turns `main` red for every other lane, and a row for a ref the merge deletes
   turns it red the other way. Land fast-forward to `main` and carry no lane branch.
2. **Deletion-only pushes skip the gate** (`.githooks/pre-push`) — the only way out of the deadlock
   where the audit fails *because* the ref it wants deleted still exists.
3. **`.codex/config.toml` regresses every few days** ([#196](https://github.com/Pootytxng/sentinel/issues/196))
   — a red `codex-config-guard` in the push gate IS that regression: discard it, do not debug it.
4. **`npm run tauri build` exits 1 on a desk build and that is not a failure.** Both bundles are
   written; the non-zero comes from the updater-signature step alone. Read the log, not the exit
   code — and never pipe the build through `tail`, which reports `tail`'s exit code instead.
5. **The suite's own exit code lies too.** The full frontend run reported exit 0 with 2 failed test
   files. Read the `Test Files` line, never the wrapper's status.
6. **The owner-installed row is byte-capped at 3000** (`LINEAGE_ROW_CAPS`, check 5b), **NEXT UP is
   capped at 12.2KB**, and **check 9 reads the Bottom line too** — re-stamping the row and the
   `STATE:` anchor is not enough, and a new ① row costs an old closed one moved to the archive.
7. **A fresh worktree needs its own `npm ci`**, and its `node_modules` must never be junctioned from
   a neighbour: the pre-push gate `npm ci`s through the link and wipes the other tree.

## Waiting on the owner

1. **The `©ompy` wordmark call** — brand territory, the one thing in #213 that is not mine. Sent
   with a recommendation and a rendered before/after: drop the interior pulse below ~24px only.
2. **His ChatGPT mockups for the four rooms**, which unblock #213's B half and the rest of #49.
3. **PR #163's disposition.**

Full standing list: [`OWNER_ACTION_CHECKLIST.md`](OWNER_ACTION_CHECKLIST.md).
