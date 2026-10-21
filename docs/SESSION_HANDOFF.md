# SESSION HANDOFF — the resume point a launched successor reads first

> Live pointer only. Product truth: [`PRODUCT_CONSTITUTION.md`](PRODUCT_CONSTITUTION.md). Gate truth:
> [`RELEASE_STATE.md`](RELEASE_STATE.md). Queue: [`BACKLOG.md`](BACKLOG.md) (ledger, P0 first, derived
> from `product/ROADMAP.md`); completion map: [`product/COMPLETION_ROADMAP.md`](product/COMPLETION_ROADMAP.md).
> Owner asks: [`OWNER_ACTION_CHECKLIST.md`](OWNER_ACTION_CHECKLIST.md). Budget 116 lines, 0 spare. Replace this file, never append.
> **Durable instructions only**: no fleet counts, no lane names, nothing another lane must repair (#291).

## Where the train is standing

**The desk build is `d7fed835`** (Wave 1 Lane B landing, #224/#225 via PR #401; version debt — batch the next cut).

| | |
|---|---|
| Installed | `d7fed835`, stamp byte-found in the installed exe (`d7fed835 · release · shell 0.9.26`, ship-reinstall OK), one installer on the Desktop; `main` is deliberately not pinned here — run `git log --oneline -4` |
| Gate | doc-budget ALL PASS · doc-truth/capability-policy/citation/link guards green · pre-push local gate at push · a hosted (claude.ai/code) lane is author and pre-proof only: it ends at a draft PR with a `verifyLocal: BLOCKED` receipt whose `boardRead` names the one structured `BOARD_UNREACHABLE` blocker, its issue reads (push-gate leases, its own claim, `adopt`) falling back to REST by explicit page where GraphQL is refused, so the lease and drift gates reach a verdict there ([`WORK_CONTROL.md`](WORK_CONTROL.md) "Hosted lane"); patch application, proof and review are executor work, never parked on the owner (ruling 2026-10-21) |
| Records | Q9b Stage 2 (#258), its 12/12 self-review and the Wave 1 Lane B landing (#224/#225, PR #401 at `3fe7a029`) are CLOSED and archived verbatim in [`archive/SESSION_HANDOFF_HISTORY.md`](archive/SESSION_HANDOFF_HISTORY.md) §2026-09-15; owner acceptance of Health/Test in the installed build is tracked in [`OWNER_ACTION_CHECKLIST.md`](OWNER_ACTION_CHECKLIST.md) §B8/§D_health, nowhere else |

## The rule that came out of the walk — read this before touching Health

**DIR-1a: offering help is conditional on evidence** — a front door built only out of symptoms tells
a healthy PC's owner they are in the wrong place, and *"i want more fps"* is a legitimate reason to be
here. Product authority is now the evidence-first and no-scareware laws in `docs/PRODUCT_CONSTITUTION.md`;
shipped `b21bc18b`, guard `src/surfaces/home-console-front-door-gate.test.tsx`; the walk's rationale and
falsification record are archived (§2026-09-15). **DIR-1b:** the attention state carries a one-line ROUTE
to the room that acts on it (#180 §C untouched — the detail paragraph still does not render on Health).

**Rooms are `Health · Live · History · Test`**, never the ids (`home`/`play`/`learn`/`lab` are
persistence keys). **Read the rail from `src/design/homeRail.ts`, never from a doc.**

**SOURCE-reachability is not USER-reachability.** A component can be dark one level up while **three
guards stay green** (three 2026-08 cases, archived §2026-09-15). When a guard certifies a surface, check
a route reaches it — and **an audit is not a work order.**

## Before you touch the UI — the fixture route, and the guards already covering copy

`docs/ui-sweep/fixture/` mounts the REAL component against a build-time stub of
`@tauri-apps/api/core`: six FirstWin `?state=` values (`firstwin-held`, `-reverted`, `-unreadable`,
`-check-failed`, `-undo-failed`, `-latest`) and three debrief ones (`debrief-smooth-offer`,
`-rough-fix`, `-clean-none`). Serve on 5199 — `npx vite --config docs/ui-sweep/fixture/vite.config.mts`;
a bare `/` drops your `?state=`. `src/fixture-parity-guard.test.ts` fails the build if the stub
stops answering a command a card sends, **or if a WRITE is answered outside its own branch** —
and it is how the self-reviewer reaches a state the shipped app cannot be put into on demand.

- `src/data/jargon-guard.test.ts` covers the **Blackbook DATA corpus only**, NOT surface copy.
  A wayfinding fix in a SURFACE needs its own guard, or an extension of one of these:
  `jargon-term-gloss-guard.test.ts`, `voice-guard.test.ts`, `stale-reference-guard.test.ts`,
  `readiness-attention-label-guard.test.ts`, `crash-rescue-naming-guard.test.ts`,
  `post-check-lab-route-guard.test.ts`, `home-console-standard-readout-guard.test.tsx`,
  `heading-is-a-name-guard.test.tsx`, `home-console-front-door-gate.test.tsx`.

## Four gate traps this repo keeps paying for — do not pay again

- **`tools/entry/doc-truth.test.mjs` decision 7** fails any live-doc SENTENCE pairing the word
  `merge` with the word `worktree` unless it also denies propagation. True sentences still fail, and
  `\b` matches across a hyphen, so **"pre-merge review" counts** — fixing the first offender creates
  the second. Reword, never loosen (precedent PR #166). Run it **alone** before pushing
  (`node scripts/run-vitest.mjs tools/entry/doc-truth.test.mjs`): seconds versus four minutes in
  `.githooks/pre-push`. Its corpus includes `git status` (uncommitted docs are scanned too) and its
  test COUNT is dynamic — never cite a fixed number.
- **`verify-release-state.mjs` cannot pass on an unpushed stamp** — `SOURCE-COMMIT-ORPHAN` fires
  until `STATE:source_main_commit` is an ancestor of `origin/main`: push the code commit FIRST,
  then write the RELEASE_STATE row and push that. Same shape as the disposition-row trap.
- **A doc-budget FAIL is paid from the ARCHIVE, never from the cap** — oldest CLOSED row out,
  pointer left, cap ratcheted DOWN. **A relocated row owes its links a re-point**: `docs/` relative
  paths break from `docs/archive/`; `markdown-link-guard` catches it at the push (`093f5600`).
- **`git checkout <file>` on an uncommitted fix destroys it silently** — copy it to the scratchpad
  first, or commit.
- **A raw control character inside a regex or a `sed` replacement is invisible and can vacate a
  guard** (#304, incident detail archived 2026-09-03) — `scripts/source-control-characters.test.mjs`
  ROOTS now covers `src`, `docs` and `src-tauri/src` too, not just `scripts`/`tools`.

## THE NEXT STEP, exactly

**Phase 2 Shared Machine Model v1 is the active train.** #449 and #450 are CLOSED on `main`; **#451 is
NEXT** — Health identity rows read `model.identity` facts, showing `unknown_reason` rather than "—" and
naming both producers on a disagreement. Then #452, then #453 (guards + live exit proof). #456 is
non-blocking debt; `src/data/machine-model.test.ts` lacks an `enabled`-branch test, carried into #451.
**Q9b Stage 4** (Tauri send command, #287 spec §11) is parked behind Phase 2, not abandoned.

**The Instrument Bench plan is NOT an option and must never be offered as one** — built (`403be45`),
REJECTED as the Lab 2026-07-09; the live Test room is the Ops Console (`LabConsole`), its bench ships
as `ExperimentBench`. `src/superseded-plan-citation-guard.test.ts` reds any live doc citing it.

**Do NOT touch** Tier 1 plan tasks 10–11 (independent security review + arming). Owner territory,
filed in `docs/OWNER_ACTION_CHECKLIST.md` §C so arming can never happen quietly. Still dark, three
independent locks, none touched: `case_intelligence_gate()` hard-false · `CASE_SIGNING_PUBKEY` all
zeros · `CASE_CATALOG_ENDPOINTS` **and** `CASE_CATALOG_ORIGINS` both empty. Before UI work, read `docs/PRODUCT_CONSTITUTION.md`, derive sequence from `docs/product/ROADMAP.md`, and reconcile the
historical `docs/UI_VISION_BACKLOG.md` 🔴 OPEN rows — including **DIR-1** and **§G** — as evidence;
they do not independently establish priority, approval, or authorization.

- **The fleet is measured, never written down.** `node scripts/fleet-snapshot.mjs` prints every
  checkout on this machine: its branch, how far past `origin/main` it sits, and whether anything it
  holds exists on no remote. No count, carrier list or lane name is stored in this file — #291's
  price for the old way is archived in `docs/archive/SESSION_HANDOFF_HISTORY.md` §2026-09-03.
- **The one shape that can still be LOST** is a checkout on a detached head holding commits no remote
  has. `git worktree remove` deletes the folder, and nothing else knew those commits existed. Rule C
  of `scripts/handoff-worktree-truth.test.mjs` fails on exactly that; the fix is to give the work a
  ref (`git branch <name> <sha>`) or push it, never a line here — prose does not make a commit
  reachable. A checkout on a branch is safe: local branches live in the common `.git` and outlive
  their worktree, so deleting the folder loses nothing.
- **Two lanes that overlap are a git question, not a remembered one.** Ask
  `git merge-base --is-ancestor <inner> <outer>` both ways before dropping either — neither
  containing the other is the common answer, and `refs/backup/*` is not a substitute for asking.
- **A claim the gate cannot READ is no claim** — `scripts/scope-drift-gate.mjs` prints "not measured"
  when no line of the Ownership claim starts with `### Ownership claim`, or when its paths hang off
  nested bullets: the Write scope is ONE bullet plus continuation lines, backticked
  (`scripts/lib/claim-scope.mjs`). A posted claim is never edited — post a superseding one.

## Waiting on the owner — two arming gates, nothing else

**Money items are ON HOLD (standing rule 2026-08-25) and are NOT blockers** — `compy.gg`, the Ko-fi URL
and Pro pricing live in `docs/OWNER_ACTION_CHECKLIST.md` §B/§C. DIR-1 is ANSWERED and shipped.

- **Receipts telemetry arming** (§C) and **Tier 1 arming** (§C) — signing-key custody, the catalog
  domain, and the arming itself, after an independent security review. Only the arming is his.
