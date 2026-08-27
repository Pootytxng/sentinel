# SESSION HANDOFF — paste-ready prompt for the next session

> Live pointer only. Gate truth: [`RELEASE_STATE.md`](RELEASE_STATE.md). Queue:
> [`BACKLOG.md`](BACKLOG.md) ▶ NEXT UP. Owner asks: [`OWNER_ACTION_CHECKLIST.md`](OWNER_ACTION_CHECKLIST.md).
> Budget 120 lines; this file, `BRANCH_DISPOSITIONS.md` and `BACKLOG.md::Conformance queue` are all
> AT cap — trim before adding a line. Replace this file, never append.

## Where the train is standing

**Test #224 is ACCEPTED. Health #225 is at a round-2 review boundary. Neither lane is pushed.**
`claude/compy-health-parity` carries the #225 Health candidate `98653732` — that is what is
INSTALLED on the desk. `claude/compy-visual-recovery-kit-6fd074` carries #224's `bf88150a`, which
**Codex independently ACCEPTED on 2026-08-27** — visuals only, explicitly **not a GO**: still
unpushed, #224 still open. `main` is clean at `5bf84051`. Do not push either lane, do not close
#224/#225, and do not write in the other lane's tree.

| | |
|---|---|
| Installed | `98653732`, runtime `get_build_stamp` → `98653732 · release · shell 0.9.26`, 1 attempt / 0 transient, one installer on the Desktop, SHA-256 `33418A2C…D847B` |
| Health #225 round 2 | 4 files, **all Health-only**. `--hc-stage-max` 500→530px · one new `--hc-comp-drop: 48px` declared ONCE on `.hc-panel` and spent twice (`margin-top` **and** subtracted inside the `max-height` cap, so NO BREAKPOINT holds) · symptom glyph `size` 28→40 |
| What round 2 answers | An independent verdict of ROUND 2 REQUIRED naming report items 6 and 7. Measured installed: stage **height 530** (comp 530.3), **top 159** (comp 158.7), bottom **689** (comp 689.0). At 1280x720 the cap binds at 550 and the stage lands at 334.9, above the 320 floor, with verdict / headline / primary action / stage all fully above the fold |
| Shared-room proof | Live **0** and History **0** differing fingerprint fields; Test 1 data-driven field (`.v2-room-below` height, a third value on the same build minutes later). Test's 37.6 % pixel diff is **reproduced by the same build against itself** (37.63 %) — `.v2-room::after`'s scanline phase follows the room's height (`hud-rooms.css:35`) |
| Gate | `tsc` clean · **full vitest 405 files / 5677 passed / 5 skipped / 0 failed** · `verify-release-state` 31 citations, 31 ok, 0 drift · doc-budget ALL PASS |
| Evidence | `…\GPT HQ\operations\compy-visual-recovery-kit\REVIEW_HEALTH_CANDIDATE_98653732.md` (round 1's report is amended, not overwritten), `assets/candidate-98653732/`, `assets/shared-regression/FINGERPRINT_DIFF.md` § Round 2. `GPT HQ` is outside this repo, so **the kit's own `CLAUDE.md` and hooks are INERT** for writes into it — a PostToolUse hook says so on every one |

## The two lenses every Health/room change must clear

**DIR-1a: offering help is conditional on evidence.** A front door built only out of symptoms tells
a healthy PC's owner either that they are in the wrong place or that Compy found something — and
*"i want more fps"* is a legitimate reason to be here, hence the interview's **goal** half, picked by
`somethingDetected` in `HomeConsole.tsx`, guarded by `home-console-front-door-gate.test.tsx`.
**A STANDING lens, not a closed row. DIR-1b:** an attention state carries a one-line ROUTE out.

**SOURCE-reachability is not USER-reachability.** The vendor-honesty line once sat behind a
component dark one level up while three guards stayed green — when a guard certifies a surface,
prove a route reaches it. Corollary: **an audit is not a work order.** **Rooms are `Health · Live ·
History · Test`**, never the ids (`home`/`play`/`learn`/`lab` are keys); rail `src/design/homeRail.ts`.

## Before you touch the UI — the fixture route, and the guards already covering copy

`docs/ui-sweep/fixture/` mounts the REAL component against a build-time stub of
`@tauri-apps/api/core`: six FirstWin `?state=` values (`firstwin-held`, `-reverted`, `-unreadable`,
`-check-failed`, `-undo-failed`, `-latest`) and three debrief ones (`debrief-smooth-offer`,
`-rough-fix`, `-clean-none`). Serve on 5199 — `npx vite --config docs/ui-sweep/fixture/vite.config.mts`;
a bare `/` drops your `?state=`. `src/fixture-parity-guard.test.ts` fails the build if the stub stops
answering a command a card sends, **or if a WRITE is answered outside its own branch** — and it is how
the self-reviewer reaches a state the shipped app cannot be put into on demand.

- `src/data/jargon-guard.test.ts` covers the **Blackbook DATA corpus only**, NOT surface copy. A
  wayfinding fix in a SURFACE needs its own guard, or an extension of one: `jargon-term-gloss-`,
  `voice-`, `stale-reference-`, `readiness-attention-label-`, `crash-rescue-naming-`,
  `post-check-lab-route-`, `home-console-standard-readout-`, `heading-is-a-name-`,
  `home-console-front-door-` (`src/**/*guard*.test.*`).

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
- **The Owner-installed row carries a 3000-byte cap** (`LINEAGE-BLOAT`, check 5b) and fits the
  current build + ONE predecessor. A new desk build pays for itself: move the OLD row byte-for-byte
  to the TOP of `docs/archive/RELEASE_STATE_HISTORY.md`, replace its label cell, re-point its one
  relative link for the extra directory level, then write the new row. Same law as a doc-budget
  FAIL: **paid from the archive, never from the cap.**
- **`git checkout <file>` on an uncommitted fix destroys it silently.** Copy the file to the
  scratchpad and restore with `cp`, or commit first.

## THE NEXT STEP, exactly

**Health #225 round 2 is at its review boundary — the next move is independent review or the
OWNER'S EYE, not more code.** Show him `composites/compare-1500x980.png` in the kit and take his
verdict. The round-2 report re-derives every remaining difference; what is left Health-scoped is
**all live data or product truth**, including one deliberate non-fix to know before anyone
"corrects" it: **the headline draws at 40px against the comp's ~52 because the live headline is 34
characters and #213 B3's fit rule steps `--type-hero` down past `HERO_MAX_WEIGHT = 31`** — the
comp's own is 31 and would draw at 52 here. Do not start Live or History until Health's verdict.

Standing queue behind it: **the Consumer / Technical / Support evidence exports** (P2's last item) —
`support_evidence.rs` + `SupportEvidence.tsx` exist, the two projections as SURFACES do not; DIR-1a applies first.

**The Instrument Bench plan is NOT an option and must never be offered as one.** It was BUILT
(`403be45`) and the owner REJECTED it as the Lab on 2026-07-09; the live Test room is the Ops
Console (`LabConsole`), its bench already armed as `ExperimentBench`, and
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
  `claude/compy-health-parity` (19, the #225 Health lane, round-2 candidate awaiting review) ·
  `claude/compy-visual-recovery-kit-6fd074` (15, the #224 Test lane, ACCEPTED, still unpushed) ·
  `feat/lab-49-parity-port` (6) · `lane/cleanup-train-2026-08-20` (5) ·
  `lane/vision-pointer-guard-2026-08-24` (3). A detached, branchless one was retired 2026-08-26
  under tag `preserve/checklist-disk-item-c5660e` (5 commits, none on `main`). Rule C of
  `scripts/handoff-worktree-truth.test.mjs` fails on any carrier this bullet does not name; re-derive
  with `git worktree list` + `git rev-list --count origin/main..X`.

## Waiting on the owner — his eye, then two arming gates

**Money items are ON HOLD by his standing rule (2026-08-25) and are deliberately NOT listed here as
blockers** — `compy.gg`, Ko-fi and Pro pricing live in `docs/OWNER_ACTION_CHECKLIST.md` §B/§C.

- **Health #225 needs his LOOK.** Test #224 has Codex's acceptance for its visuals; neither room
  has his eye yet, and nothing design-side beyond those is parked on him.
- **Receipts telemetry arming** (§C) and **Tier 1 arming** (§C) — signing-key custody, the catalog
  domain, and the arming itself, after an independent security review. Only the arming is his.
