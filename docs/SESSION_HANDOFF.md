# SESSION HANDOFF — paste-ready prompt for the next session

> Live pointer only. Gate truth: [`RELEASE_STATE.md`](RELEASE_STATE.md). Queue:
> [`BACKLOG.md`](BACKLOG.md) ▶ NEXT UP. Owner asks: [`OWNER_ACTION_CHECKLIST.md`](OWNER_ACTION_CHECKLIST.md).
> Budget 120 lines, and this file, `BRANCH_DISPOSITIONS.md` and `BACKLOG.md::Conformance queue` are
> all AT cap — trim or archive before adding a line anywhere. Replace this file, never append.

## Where the train is standing

**`main` is clean and pushed; the desk build is `72efd7e6`, installed and live.** The last train ran
the **DIR-1 first-timer walk** — walk the app as someone who has never seen it and fix every spot
where a normal person cannot tell what to do next — and shipped three of its six findings.

| | |
|---|---|
| `main` | deliberately not pinned — run `git log --oneline -4` |
| Installed | `72efd7e6`, stamp byte-found in the installed exe, one installer on the Desktop |
| Shipped | room-scroll reset · Test station scroll-into-view · the glossary on 6 bare labels |
| Self-review | **PASS 12/12** at `72efd7e6`, quoted in the RELEASE_STATE owner-installed row |
| Gate | `tsc` clean · doc-truth green · doc-budget ALL PASS · verify-release-state 31/31, 0 drift |

**Rooms are `Health · Live · History · Test`.** Not Home/Monitor/Blackbook/Lab — the owner renamed
them 2026-08-12 and 2026-08-19, and for a fortnight CLAUDE.md, six docs, the self-reviewer's own
rubric and `stale-reference-guard` all still said the old four. The guard against stale room names
was carrying a stale room list. Fixed, and now DERIVED from `src/design/homeRail.ts`: a live label
can no longer be listed as retired, and the guard's own ground-truth sentence plus the self-reviewer
brief are both pinned to `railFor(false, true)`. **Read the rail from code, never from a doc.**

## What the walk found that is NOT done — read this before picking anything else

- **Two questions are with the owner** (both collide with decisions he already made, so neither was
  shipped): Health's front door and its symptom cards answer the same question, which sits against
  the approved comp and UX-1 decision 1's ONE ACTION; and the flagged check's own "what to do"
  sentence is computed and thrown away on Health, which sits against his #180 §C ruling that the
  paragraph stays in Test. **Do not implement either from this file** — his answer decides it.
- **Finding #4 was partly WRONG** and the audit is not a work order: two of the Test room's four
  gauges already carry plain-English notes. Verify every audit claim against the screen first.
- **`FpsPanel` is unreachable dead code**, and the "GPU sensor coverage" honesty line is stranded
  inside the same dead block. Both are filed as NEXT UP ② — that is the queue, not this file.

## Before you touch the UI — the fixture route, and the guards already covering copy

`docs/ui-sweep/fixture/` mounts the REAL component against a build-time stub of
`@tauri-apps/api/core`; six FirstWin `?state=` values exist (`firstwin-held`, `-reverted`,
`-unreadable`, `-check-failed`, `-undo-failed`, `-latest`). Serve on 5199 with
`npx vite --config docs/ui-sweep/fixture/vite.config.mts`; a bare `/` drops your `?state=`.
`src/fixture-parity-guard.test.ts` fails the build if the stub stops answering a command the card
sends, **or if `rollback_change` is answered outside the FirstWin branch**.

- `src/data/jargon-guard.test.ts` covers the **Blackbook DATA corpus only** (tweaks/terms/tricks/
  guides), NOT surface copy. New 2026-08-26: `src/jargon-term-gloss-guard.test.ts` derives its
  worklist from the shipped locale and fails if any label whose whole value is "1% low"/"frametime"
  renders without its `<Term>`. A wayfinding fix in a SURFACE still needs its own guard, or an
  extension of one of these: `src/voice-guard.test.ts`, `src/stale-reference-guard.test.ts`,
  `src/surfaces/readiness-attention-label-guard.test.ts`, `crash-rescue-naming-guard.test.ts`,
  `post-check-lab-route-guard.test.ts`, `home-console-standard-readout-guard.test.tsx`,
  `src/design/heading-is-a-name-guard.test.tsx`.

## Four gate traps this repo keeps paying for — do not pay again

- **`tools/entry/doc-truth.test.mjs` decision 7** fails any live-doc SENTENCE pairing the word
  `merge` with the word `worktree` unless it also denies propagation. True sentences still fail, and
  `\b` matches across a hyphen, so **"pre-merge review" counts** — fixing the first offender creates
  the second. Reword, never loosen (precedent PR #166). Run it **alone** before pushing
  (`node scripts/run-vitest.mjs tools/entry/doc-truth.test.mjs`): seconds versus four minutes in
  `.githooks/pre-push`. Its corpus includes `git status`, so uncommitted docs are scanned too, and
  its test COUNT is dynamic (9, 11, 12 seen) — never cite a fixed number.
- **`verify-release-state.mjs` cannot pass on an unpushed stamp.** `SOURCE-COMMIT-ORPHAN` fires
  because `STATE:source_main_commit` is not yet an ancestor of `origin/main` — the row cannot be
  written until the commit it names has landed. Push the code commit FIRST (stash the doc edit),
  then write the RELEASE_STATE row and push that. Same shape as the disposition-row trap.
- **A doc-budget FAIL is paid from the ARCHIVE, never from the cap** — oldest CLOSED row to
  `BACKLOG_ARCHIVE.md` byte-for-byte, one collapsed pointer, then ratchet the cap DOWN. Done twice
  on 2026-08-26: NEXT UP 13320 → 11775 (cap 12544 → 12288), then 12.2KB → 10.2KB when the walk's
  findings were filed (#213's A1, the process amendment and the whole B1–B5 half moved out
  verbatim, 4130 bytes, behind two pointers; cap 12288 → **11776**, banking 512 and leaving ~1.5KB
  on purpose, because this queue is where a NEW owner bug report lands).
- **`git checkout <file>` on an uncommitted fix destroys it silently.** It bit this session twice
  while falsifying guards. Copy the file to the scratchpad and restore with `cp`, or commit first.

## THE NEXT STEP, exactly

**Ask the owner the two questions above if he has not answered them, then take NEXT UP ②** (the
dead-code pair). After that, P2's last item is the **Consumer / Technical / Support evidence
exports**: the backend half exists (`src-tauri/src/support_evidence.rs`,
`src/surfaces/SupportEvidence.tsx`), the Consumer and Technical projections as SURFACES do not.

**The Instrument Bench plan is NOT an option and must never be offered as one.** It was BUILT
(`403be45`) and the owner REJECTED it as the Lab on 2026-07-09; the live Test room is the Ops
Console (`LabConsole`), and its proving bench already ships armed as `ExperimentBench`.
`src/superseded-plan-citation-guard.test.ts` fails the build on any live doc citing a dead plan.

**Do NOT touch** Tier 1 plan tasks 10–11 (independent security review + arming). Owner territory,
filed in `docs/OWNER_ACTION_CHECKLIST.md` §C so arming can never happen quietly. Still dark, three
independent locks, none touched: `case_intelligence_gate()` hard-false · `CASE_SIGNING_PUBKEY` all
zeros · `CASE_CATALOG_ENDPOINTS` **and** `CASE_CATALOG_ORIGINS` both empty.

**Before any UI work:** read `docs/UI_VISION_BACKLOG.md` 🔴 OPEN rows — today **DIR-1** (the
intuitive-UI directive, §"⭐ DIR-1") and **§G** (the site). Read them THERE, never from a paraphrase.

- **Nine worktrees besides `main`. Five are spent; four carry commits that are not on main — do
  NOT delete or hard-reset those four before checking them**: `feat/user-feedback-lab-recovery`
  (49) · `feat/lab-49-parity-port` (6) · `lane/cleanup-train-2026-08-20` (5) ·
  `lane/vision-pointer-guard-2026-08-24` (3). A tenth, detached with no branch name at all, hid for
  fifteen days because every audit here reads `origin` refs and a branchless checkout has none; it
  was retired 2026-08-26 under tag `preserve/checklist-disk-item-c5660e` (5 commits, recoverable,
  none on `main`). Rule C of `scripts/handoff-worktree-truth.test.mjs` fails the build if a checkout
  carries commits and this bullet does not name it. Re-derive with `git worktree list` +
  `git rev-list --count origin/main..<branch>`; never carry the numbers forward unchecked.

## Waiting on the owner — two arming gates and two design questions, nothing else

**Money items are ON HOLD by his standing rule (2026-08-25) and are deliberately NOT listed here as
blockers** — `compy.gg` registration, the Ko-fi URL and Compy Pro pricing live in
`docs/OWNER_ACTION_CHECKLIST.md` §B/§C and must stop being reported as things he owes.

- **Receipts telemetry arming** (§C) and **Tier 1 arming** (§C) — signing-key custody, the catalog
  domain, and the arming itself, after an independent security review. Only the arming is his.
- The two walk questions above — each was sent WITH a recommendation, never as a bare menu.
