# SESSION HANDOFF — paste-ready prompt for the next session

> Live pointer only. Gate truth: [`RELEASE_STATE.md`](RELEASE_STATE.md). Queue:
> [`BACKLOG.md`](BACKLOG.md) ▶ NEXT UP. Owner asks: [`OWNER_ACTION_CHECKLIST.md`](OWNER_ACTION_CHECKLIST.md).
> Budget 120 lines; this file, `BRANCH_DISPOSITIONS.md` and `BACKLOG.md::Conformance queue` are all
> AT cap — trim before adding a line. Replace this file, never append.

## Where the train is standing

**Two visual-recovery candidates sit at an independent-review boundary, and NEITHER is pushed.**
`claude/compy-health-parity` carries the #225 Health parity candidate `6bf99c8c` — that is what is
INSTALLED on the desk. `claude/compy-visual-recovery-kit-6fd074` carries #224's Test candidate
`bf88150a`. `main` is clean at `5bf84051`. **Green gates and a PASS self-review are evidence, not
acceptance** — the kit closes a room on the owner's eye, and neither room is closed. Do not push
either lane, do not close #224/#225, do not write in the other lane's tree.

| | |
|---|---|
| Installed | `6bf99c8c`, runtime `get_build_stamp` → `6bf99c8c · release`, one installer on the Desktop, SHA-256 `14EAC3C3…C669` |
| Health #225 | round 1, 12 files. Health-only rig camera (`HEALTH_CAMERA_DIST` 10.1) · Health-scoped `--v2-aside` + `column-gap` · one shared token `--v2-panel-card` |
| Shared-token proof | Live · History · Test captured from the OLD build, then again from the new one. Test **0 differing pixels**; History 75 (the wall clock's digits); Live 1062 (live telemetry). Fingerprints differ only by the token no rule in those rooms consumes |
| Gate | `tsc` clean · targeted vitest 7 files / 128 tests / 0 failed · `verify-release-state` 31 citations, 31 ok, 0 drift · doc-budget ALL PASS |
| Evidence | `…\GPT HQ\operations\compy-visual-recovery-kit\REVIEW_HEALTH_CANDIDATE_6bf99c8c.md` — the measured mismatch report, captures and composites at 1280x720 / 1500x980 / 1920x1080, and 13 named remaining differences. `GPT HQ` is outside this repo, so **the kit's own `CLAUDE.md` and hooks are INERT** for writes into it — a PostToolUse hook says so on every one |

## The two lenses every Health/room change must clear

**DIR-1a: offering help is conditional on evidence.** A front door built only out of symptoms tells
a healthy PC's owner either that they are in the wrong place or that Compy found something — and
*"i want more fps"* is a legitimate reason to be here, hence the interview's **goal** half, picked
by `somethingDetected` in `HomeConsole.tsx` and guarded by `home-console-front-door-gate.test.tsx`.
**A STANDING lens, not a closed row. DIR-1b:** an attention state carries a one-line ROUTE out.

**SOURCE-reachability is not USER-reachability.** The vendor-honesty line once sat behind a
component dark one level up while three guards stayed green — when a guard certifies a surface,
prove a route reaches it. Corollary: **an audit is not a work order.** **Rooms are `Health · Live ·
History · Test`**, never the ids (`home`/`play`/`learn`/`lab` are persistence keys); read the rail
from `src/design/homeRail.ts`.

## Before you touch the UI — the fixture route, and the guards already covering copy

`docs/ui-sweep/fixture/` mounts the REAL component against a build-time stub of
`@tauri-apps/api/core`: six FirstWin `?state=` values (`firstwin-held`, `-reverted`, `-unreadable`,
`-check-failed`, `-undo-failed`, `-latest`) and three debrief ones (`debrief-smooth-offer`,
`-rough-fix`, `-clean-none`). Serve on 5199 — `npx vite --config docs/ui-sweep/fixture/vite.config.mts`;
a bare `/` drops your `?state=`. `src/fixture-parity-guard.test.ts` fails the build if the stub
stops answering a command a card sends, **or if a WRITE is answered outside its own branch** —
and it is how the self-reviewer reaches a state the shipped app cannot be put into on demand.

- `src/data/jargon-guard.test.ts` covers the **Blackbook DATA corpus only**, NOT surface copy. A
  wayfinding fix in a SURFACE needs its own guard, or an extension of one of: `jargon-term-gloss-`,
  `voice-`, `stale-reference-`, `readiness-attention-label-`, `crash-rescue-naming-`,
  `post-check-lab-route-`, `home-console-standard-readout-`, `heading-is-a-name-`,
  `home-console-front-door-` (`src/**/*guard*.test.*` / `*gate.test.tsx`).

## Four gate traps this repo keeps paying for — do not pay again

- **`tools/entry/doc-truth.test.mjs` decision 7** fails any live-doc SENTENCE pairing the word
  `merge` with the word `worktree` unless it also denies propagation. True sentences still fail, and
  `\b` matches across a hyphen, so **"pre-merge review" counts** — fixing the first offender creates
  the second. Reword, never loosen (precedent PR #166). Run it **alone** before pushing
  (`node scripts/run-vitest.mjs tools/entry/doc-truth.test.mjs`): seconds versus four minutes in
  `.githooks/pre-push`. Its corpus includes `git status`, so uncommitted docs are scanned too, and
  its test COUNT is dynamic (9, 10, 11, 12 seen) — never cite a fixed number.
- **`verify-release-state.mjs` cannot pass on an unpushed stamp.** `SOURCE-COMMIT-ORPHAN` fires
  because `STATE:source_main_commit` is not yet an ancestor of `origin/main` — the row cannot be
  written until the commit it names has landed. Push the code commit FIRST (stash the doc edit),
  then write the RELEASE_STATE row and push that. Same shape as the disposition-row trap.
- **A doc-budget FAIL is paid from the ARCHIVE, never from the cap** — oldest CLOSED row out
  byte-for-byte, one collapsed pointer, then ratchet the cap DOWN. **A relocated row still owes its
  links a re-point**: a relative path that resolved from `docs/` does not resolve from
  `docs/archive/`, and `markdown-link-guard` catches it at the push, not at the move (`093f5600`).
- **`git checkout <file>` on an uncommitted fix destroys it silently.** Copy the file to the
  scratchpad and restore with `cp`, or commit first.

## THE NEXT STEP, exactly

**Health #225 is at its review boundary — the next move on it is the OWNER'S EYE, not more code.**
Show him the composites in the kit, take his verdict, and only then either close the row or open
round 2 from the 13 named differences. The two biggest are already measured and deliberately NOT
implemented in round 1: the rig stage is **500 app px tall against the comp's 530.3**, and its top
sits at **111 against 158.7** — one change to the evidence card's box, which would also move
first-viewport fit at 1280x720. Do not start Live or History until Health's verdict lands.

Standing queue behind it: **the Consumer / Technical / Support evidence exports**, P2's last item —
the backend half exists (`src-tauri/src/support_evidence.rs`, `src/surfaces/SupportEvidence.tsx`),
the two projections as SURFACES do not, and DIR-1a applies before they ship.

**The Instrument Bench plan is NOT an option and must never be offered as one.** It was BUILT
(`403be45`) and the owner REJECTED it as the Lab on 2026-07-09; the live Test room is the Ops
Console (`LabConsole`), and its proving bench already ships armed as `ExperimentBench`.
`src/superseded-plan-citation-guard.test.ts` fails the build on any live doc citing a dead plan.

**Do NOT touch** Tier 1 plan tasks 10–11 (independent security review + arming). Owner territory,
filed in `docs/OWNER_ACTION_CHECKLIST.md` §C so arming can never happen quietly; still dark behind
three independent locks (`case_intelligence_gate()` hard-false · `CASE_SIGNING_PUBKEY` all zeros ·
`CASE_CATALOG_ENDPOINTS` **and** `CASE_CATALOG_ORIGINS` empty). **Before any UI work:** read
`docs/UI_VISION_BACKLOG.md` 🔴 OPEN rows — today **DIR-1** (§"⭐ DIR-1", carrying DIR-1a) and **§G**
(the site). Read them THERE, never from a paraphrase.

- **Thirteen worktrees besides `main`. Seven are spent or read-only (`test-design-visual-fixes-fec3ec`
  and `health-lane-bootstrap-a2a8cc` both carry zero own commits); six carry commits not on main —
  do NOT delete or hard-reset those six unchecked**: `feat/user-feedback-lab-recovery` (49) ·
  `claude/compy-health-parity` (15, the #225 Health lane, candidate awaiting independent review) ·
  `claude/compy-visual-recovery-kit-6fd074` (15, the #224 Test candidate, same) ·
  `feat/lab-49-parity-port` (6) · `lane/cleanup-train-2026-08-20` (5) ·
  `lane/vision-pointer-guard-2026-08-24` (3). A detached, branchless one was retired 2026-08-26
  under tag `preserve/checklist-disk-item-c5660e` (5 commits, none on `main`). Rule C of
  `scripts/handoff-worktree-truth.test.mjs` fails on any carrier this bullet does not name; re-derive
  with `git worktree list` + `git rev-list --count origin/main..X`.

## Waiting on the owner — his eye, then two arming gates

**Money items are ON HOLD by his standing rule (2026-08-25) and are deliberately NOT listed here as
blockers** — `compy.gg`, Ko-fi and Pro pricing live in `docs/OWNER_ACTION_CHECKLIST.md` §B/§C.

- **Health #225 and Test #224 both need his LOOK.** That is the only thing standing between the two
  candidates and their rows closing; nothing design-side beyond those two is parked on him.
- **Receipts telemetry arming** (§C) and **Tier 1 arming** (§C) — signing-key custody, the catalog
  domain, and the arming itself, after an independent security review. Only the arming is his.
