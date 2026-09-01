# SESSION HANDOFF — paste-ready prompt for the next session

> Live pointer only. Gate truth: [`RELEASE_STATE.md`](RELEASE_STATE.md). Queue:
> [`BACKLOG.md`](BACKLOG.md) ▶ NEXT UP. Owner asks: [`OWNER_ACTION_CHECKLIST.md`](OWNER_ACTION_CHECKLIST.md).
> Budget 120 lines; this file, `BRANCH_DISPOSITIONS.md` and `BACKLOG.md::Conformance queue` are all
> AT cap — trim before adding a line. Replace this file, never append.

## Where the train is standing

**The desk build is `090bc58b`** (Mission 2 landing, #238; version debt — batch the next cut).

- **Installed** — `090bc58b`, stamp byte-found in the installed exe and `73b629ed` byte-absent, one installer on the Desktop; `main` is deliberately not pinned here — run `git log --oneline -4`
- **Shipped** — Q9b Stage 2 (#258): `src/surfaces/CaseEvidenceConsent.tsx` — the local preview/edit/one-submission-consent screen over Stage 1's canonical bytes, fixture-only, no command/HTTP/queue/persistence, gate still hard-false. Its guard now strips NOTHING and reads every byte: three independent reviews each defeated a comment-stripper and hid a real `invoke()`. Before it: Stage 1 (#252), rule D (#243), the Q9b contract (#247/#248/#249)
- **Self-review** — PASS 12/12 at `39f23847` over all six fixture states at 1484px, 200% zoom and 420px; nothing rendered has changed since
- **Gate** — doc-budget ALL PASS · doc-truth/capability-policy/citation/link guards green · pre-push local gate at push

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

**Q9b Stage 2 (#258) LANDED** — `cfc0d21a` / PR #263, the consent screen renders the payload itself.
**Stage 3 is NEXT**: receiver + migration, local/staged ONLY, never deployed — deployment is Stage 7
and owner territory. Spec: `docs/superpowers/specs/2026-08-29-q9b-tier3-case-evidence-contract.md` §11.

**The Instrument Bench plan is NOT an option and must never be offered as one.** It was BUILT
(`403be45`) and the owner REJECTED it as the Lab on 2026-07-09; the live Test room is the Ops
Console (`LabConsole`), and its proving bench already ships armed as `ExperimentBench`.
`src/superseded-plan-citation-guard.test.ts` fails the build on any live doc citing a dead plan.

**Do NOT touch** Tier 1 plan tasks 10–11 (independent security review + arming). Owner territory,
filed in `docs/OWNER_ACTION_CHECKLIST.md` §C so arming can never happen quietly. Still dark, three
independent locks, none touched: `case_intelligence_gate()` hard-false · `CASE_SIGNING_PUBKEY` all
zeros · `CASE_CATALOG_ENDPOINTS` **and** `CASE_CATALOG_ORIGINS` both empty. **Before any UI work:**
read `docs/UI_VISION_BACKLOG.md` 🔴 OPEN rows — today **DIR-1** (§"⭐ DIR-1", now carrying DIR-1a)
and **§G** (the site). Read them THERE, never from a paraphrase.

- **32 worktrees besides the canonical checkout; TWELVE branches carry commits not on main — do NOT delete or hard-reset
  those twelve before checking them**: `feat/user-feedback-lab-recovery` · `claude/compy-health-parity` ·
  `claude/compy-visual-recovery-kit-6fd074` · `feat/lab-49-parity-port` · `lane/cleanup-train-2026-08-20` ·
  `lane/vision-pointer-guard-2026-08-24` · `lane/rule-e-negation` (#295 — **LANDS WITH PR #297**, written before the
  merge because the merge is what makes it true) · `lane/shell-ownership-278` · `lane/remote-cache-design-286` (#286)
  → `lane/case-receiver-287` (#287) — the last stacked pair, so one repair does not land twice ·
  `lane/css-margin-separators-274` (#274 — **LANDED**, PR #275) · `lane/native-routing-271` (#271 — **LANDED**, PR #273)
  — both are listed only because **pruning them was denied**. `compy-health-parity` and `compy-visual-recovery-kit-6fd074`
  **share 14 commits and diverge at `c8366609` — neither contains the other** (`--is-ancestor`, NO both ways). Counted
  NOT-ON-MAIN, as this bullet counts, the kit has ONE unique commit and health-parity FOURTEEN; from the merge base
  that same branch answers 170, having merged main in repeatedly, and both writers reached for the unframed number
  first. Backed up only to `refs/backup/*`, so dropping either loses the other's work. **No depth/SHA pinned**: `git
  worktree list` + `git rev-list --count origin/main..<ref>`. Rule D (#243) fails this bullet for naming a zero-carry
  branch — **a landed lane's name leaves with the train that lands it**, which is why the #281 (PR #282), #284 (PR
  #285), #276 (PR #277 → `ee5bdd8b`) and #298 (PR #299 → `81b16d60`) lanes are not named here: all four merge-committed,
  so each dropped straight to zero, and each landing left open PRs pointing into a spent base (286/287, then
  #297/#299) that were retargeted at the landing rather than after it. Spent, at zero: `sentinel-segmented-237` (#298
  landed out of it), `sentinel-fleet-guard-276`, `sentinel-release-truth-256`, `sentinel-q9b-redactor-259`,
  `sentinel-q9b-stage2-258` (#258/#264 both landed out of it), four of the SIX registered under `.claude/worktrees/`
  (that folder holds seven entries; `data-root-integrity-432797` is not a worktree), parked
  `sentinel-mission0-accent-landing`, `sentinel-mission1-test-workspace` (Mission 1 is ON main, #231/#233),
  `sentinel-q9b-stage2`.

## Waiting on the owner — two arming gates, nothing else

**Money items are ON HOLD by his standing rule (2026-08-25) and are deliberately NOT listed here as
blockers** — `compy.gg`, the Ko-fi URL and Compy Pro pricing live in
`docs/OWNER_ACTION_CHECKLIST.md` §B/§C and must stop being reported as things he owes. The two
DIR-1 walk questions are ANSWERED and shipped; nothing design-side is parked on him.

- **Receipts telemetry arming** (§C) and **Tier 1 arming** (§C) — signing-key custody, the catalog
  domain, and the arming itself, after an independent security review. Only the arming is his.
