# SESSION HANDOFF — paste-ready prompt for the next session

> Live pointer only. Gate truth: [`RELEASE_STATE.md`](RELEASE_STATE.md). Queue:
> [`BACKLOG.md`](BACKLOG.md) ▶ NEXT UP. Owner asks: [`OWNER_ACTION_CHECKLIST.md`](OWNER_ACTION_CHECKLIST.md).
> Budget 120 lines; this file, `BRANCH_DISPOSITIONS.md` and `BACKLOG.md::Conformance queue` are all
> AT cap — trim before adding a line. Replace this file, never append.

## Where the train is standing

**The desk build is `090bc58b`** (Mission 2 landing, #238; version debt — batch the next cut). Installed and verified by
STAMP not mtime: byte-found in the exe, `73b629ed` byte-absent, one installer on the Desktop; `main` NOT pinned — `git log --oneline -4`.

## The rule that came out of the walk — read this before touching Health

**DIR-1a: offering help is conditional on evidence** — a front door built only out of symptoms tells
a healthy PC's owner they are in the wrong place, and *"i want more fps"* is a legitimate reason to be
here. **A STANDING lens, not a closed row**: every new Health affordance must answer *"is this framing
earned?"* first. The direction is authoritative at `docs/UI_VISION_BACKLOG.md` §"⭐ DIR-1a" — read it
THERE, never from a paraphrase, this line included. Shipped `b21bc18b`; guard
`src/surfaces/home-console-front-door-gate.test.tsx`, falsified three ways. **DIR-1b:** the attention
state carries a one-line ROUTE to the room that acts on it (#180 §C untouched — the detail paragraph
still does not render on Health).

**Rooms are `Health · Live · History · Test`**, never the ids (`home`/`play`/`learn`/`lab` are
persistence keys). **Read the rail from `src/design/homeRail.ts`, never from a doc.**

**SOURCE-reachability is not USER-reachability.** A component can be dark one level up while **three
guards stay green** (vendor-honesty proved only "not wrapped in a condition"; the affordance census
counted 80 unreachable strings as live; the mono census described CSS nothing rendered). When a guard
certifies a surface, check a route reaches it — and **an audit is not a work order.**

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

## THE NEXT STEP, exactly

**LIVE LANE — #313 / PR #317**, worktree `sentinel-remote-design-286`, draft, gate PASS. **Never merge.**
Head = the `origin/lane/guard-budget-313` tip — a SHA pinned here is stale on arrival, so re-read it.
BLOCKED on ONE thing: a review bound to THAT head. Receipt `2026-09-01-mark-pr-ready-313.json` is re-headed and carries a
real gate PASS at it; only `independentReview` is pending — fill it, re-run `scripts/work-control-gate.mjs`, `gh pr ready 317`.
**That gate compares that field to the receipt's OWN `currentHead`, never to live HEAD — a wholly stale receipt passes it.**

**Q9b Stage 3 is NEXT** (Stage 2 landed, `cfc0d21a` / PR #263): receiver + migration, local/staged
ONLY, never deployed — deployment is Stage 7, owner territory. Spec:
`docs/superpowers/specs/2026-08-29-q9b-tier3-case-evidence-contract.md` §11.

**The Instrument Bench plan is NOT an option and must never be offered as one.** BUILT (`403be45`) and
REJECTED as the Lab by the owner on 2026-07-09; the live Test room is the Ops Console (`LabConsole`), its
bench ships armed as `ExperimentBench`. `src/superseded-plan-citation-guard.test.ts` fails a dead citation.

**Do NOT touch** Tier 1 plan tasks 10–11 (independent security review + arming). Owner territory,
filed in `docs/OWNER_ACTION_CHECKLIST.md` §C so arming can never happen quietly. Still dark, three
independent locks, none touched: `case_intelligence_gate()` hard-false · `CASE_SIGNING_PUBKEY` all
zeros · `CASE_CATALOG_ENDPOINTS` **and** `CASE_CATALOG_ORIGINS` both empty. **Before any UI work:**
read `docs/UI_VISION_BACKLOG.md` 🔴 OPEN rows — today **DIR-1** (§"⭐ DIR-1", now carrying DIR-1a)
and **§G** (the site). Read them THERE, never from a paraphrase.

- **32 worktrees besides the canonical checkout; SEVENTEEN branches carry commits not on main — do NOT delete or
  hard-reset those seventeen before checking them**: `feat/user-feedback-lab-recovery` · `claude/compy-health-parity`
  · `claude/compy-visual-recovery-kit-6fd074` · `feat/lab-49-parity-port` · `lane/cleanup-train-2026-08-20` ·
  `lane/vision-pointer-guard-2026-08-24` · `lane/rule-e-negation` (#295) · `lane/shell-ownership-278` ·
  `lane/case-receiver-287` (#287) · `lane/receipt-modified-309` (#309) · `lane/docs-path-not-branch-310` (#310) ·
  `lane/vacuous-guards-304` (#304) · `lane/guard-budget-313` (#313, this lane) · `lane/prune-list-truth-305` (#305) ·
  `lane/wrapper-allowlist-308` (#308) · `lane/css-margin-separators-274` (#274) · `lane/native-routing-271` (#271) —
  **those two LANDED** (PR #275 · PR #273) listed only because **the prune was denied**. `compy-health-parity` and
  `compy-visual-recovery-kit-6fd074` **share 14 commits and diverge at `c8366609` — neither contains the other**
  (`--is-ancestor` is NO both ways). Counted **not on main**, as everywhere here: the kit has ONE unique commit,
  health-parity FOURTEEN (from the merge base instead it answers 170). Backed up only to `refs/backup/*`, so dropping
  either loses the other's work. **No depth/SHA pinned**: `git worktree list` +
  `git rev-list --count origin/main..<ref>`. Rule D (#243) fails this bullet for naming a zero-carry branch — **a
  landed lane's name leaves with the train that lands it**, which is why the #281 (PR #282), #284 (PR #285), #276 (PR
  #277 → `ee5bdd8b`), #298 (PR #299 → `81b16d60`) and #286 (PR #288 → `624fcc40`) lanes are not named here: all five
  merge-committed, so each dropped to zero, and a landing that strands an open PR on a spent base retargets it at the
  landing, not after. Spent, at zero: `sentinel-fleet-guard-276`, `sentinel-q9b-redactor-259`,
  `sentinel-q9b-stage2-258` (#258/#264 landed out of it), four of the SIX registered under `.claude/worktrees/` (seven
  entries there; `data-root-integrity-432797` is not one), parked `sentinel-mission0-accent-landing`,
  `sentinel-mission1-test-workspace` (Mission 1 is ON main, #231/#233), `sentinel-q9b-stage2`. Every detached checkout
  carries zero, so rule C has nothing to credit.

## Waiting on the owner — two arming gates, nothing else

**Money items are ON HOLD by his standing rule (2026-08-25) and are deliberately NOT listed here as
blockers** — `compy.gg`, the Ko-fi URL and Compy Pro pricing live in
`docs/OWNER_ACTION_CHECKLIST.md` §B/§C and must stop being reported as things he owes. The two
DIR-1 walk questions are ANSWERED and shipped; nothing design-side is parked on him.

- **Receipts telemetry arming** (§C) and **Tier 1 arming** (§C) — signing-key custody, the catalog
  domain, and the arming itself, after an independent security review. Only the arming is his.
