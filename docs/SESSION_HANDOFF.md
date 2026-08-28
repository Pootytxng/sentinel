# SESSION HANDOFF — paste-ready prompt for the next session

> Live pointer only. Gate truth: [`RELEASE_STATE.md`](RELEASE_STATE.md). Queue:
> [`BACKLOG.md`](BACKLOG.md) ▶ NEXT UP. Owner asks: [`OWNER_ACTION_CHECKLIST.md`](OWNER_ACTION_CHECKLIST.md).
> Budget 120 lines; this file, `BRANCH_DISPOSITIONS.md` and `BACKLOG.md::Conformance queue` are all
> AT cap — trim before adding a line. Replace this file, never append.

## Where the train is standing

**`main` is clean and pushed at `9424f11c`; the desk build is still `1703be9f`** (no rebuild — the
change since is copy on a card that needs a real measured session to appear). **DIR-1a has now walked
Live · History · Test:** History and Test came back clean; Live's one real violation is fixed.

| | |
|---|---|
| Installed | `1703be9f`, stamp byte-found in the installed exe, one installer on the Desktop; `main` is deliberately not pinned here — run `git log --oneline -4` |
| Shipped | `1703be9f` rule 5's "GPU sensor coverage" sentence reaches a screen · `9c43015c` Live's debrief stops calling a change "the #1 fix" after a session it graded smooth · `9424f11c` three fixture states so those three outcomes can be LOOKED at |
| Self-review | **PASS 12/12** at `9424f11c`, through the three new `?state=debrief-*` previews. `.debrief-clean` → `.debrief-cta` gap measured 10px (matches the rule written blind); CTA contrast 6.85:1 |
| Gate | `tsc` clean · 5630 frontend tests · doc-truth 9 · doc-budget ALL PASS · pre-push local gate PASS |

## The rule that came out of the walk — read this before touching Health

**DIR-1a: offering help is conditional on evidence.** Asked a narrow question (Health's front door
and its shortcut cards ask the same thing) the owner **rejected both options to say something
larger**: every door on that screen was symptom-framed, and a front door built only out of symptoms
tells a healthy PC's owner either that they are in the wrong place or that Compy found something.
Compy also does optimisation, and *"i want more fps"* is a legitimate reason to be here. Shipped:
the interview gained four **goal** answers under two labelled halves (`home-interview-data.ts`,
`groupChoices`); Health picks the half from `somethingDetected` — a flagged readiness check **or** an
incident the observer read out of Windows (`HomeConsole.tsx`). Guard
`src/surfaces/home-console-front-door-gate.test.tsx`, falsified three ways. **A STANDING lens, not a
closed row** — every new Health affordance must answer *"is this framing earned?"* first.
**DIR-1b:** the attention state carries a one-line ROUTE to the room that acts on it (#180 §C
untouched — the detail paragraph still does not render on Health).

**Rooms are `Health · Live · History · Test`**, never the ids (`home`/`play`/`learn`/`lab` are
persistence keys). **Read the rail from `src/design/homeRail.ts`, never from a doc.**

**The lesson ② left behind: SOURCE-reachability is not USER-reachability.** The honesty line sat
outside the gate the walk blamed; its whole component was dark one level up and **three guards
stayed green** (vendor-honesty proved only "not wrapped in a condition"; the affordance census
counted 80 unreachable strings as live; the mono census described CSS nothing rendered). When a
guard certifies a surface, check a route reaches it. Finding #4 was also partly WRONG (two Test
gauges already carry plain-English notes) — **an audit is not a work order.**

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

**Build the Consumer / Technical / Support evidence exports** — P2's last item, and the last thing
`UI_VISION_BACKLOG.md` still lists as open under DIR-1. The backend half exists
(`src-tauri/src/support_evidence.rs`, `src/surfaces/SupportEvidence.tsx`); the Consumer and Technical
projections as SURFACES do not. DIR-1a applies to them before they ship: earned framing, or none.

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

- **14 worktrees besides `main`; seven carry commits not on main — do NOT delete or hard-reset
  those seven before checking them**: `feat/user-feedback-lab-recovery` (49) ·
  `claude/compy-health-parity` (24) · `claude/compy-visual-recovery-kit-6fd074` (15) ·
  `feat/lab-49-parity-port` (6) · `lane/cleanup-train-2026-08-20` (5) ·
  `lane/vision-pointer-guard-2026-08-24` (3) · `sentinel-mission0-accent-landing`, which carries
  only `docs/mission0-carrier-truth` — this bullet's own edit, pruned the moment it lands, after
  which that checkout parks on the trunk's tip carrying nothing. Mission 0 itself already landed.
  Re-derived 2026-08-28 vs `origin/main` dd562737. The `.claude/worktrees/` pair still holds the
  unaccepted Test and Health candidates, preserved on purpose — rule A fails on a landed lane.

## Waiting on the owner — two arming gates, nothing else

**Money items are ON HOLD by his standing rule (2026-08-25) and are deliberately NOT listed here as
blockers** — `compy.gg`, the Ko-fi URL and Compy Pro pricing live in
`docs/OWNER_ACTION_CHECKLIST.md` §B/§C and must stop being reported as things he owes. The two
DIR-1 walk questions are ANSWERED and shipped; nothing design-side is parked on him.

- **Receipts telemetry arming** (§C) and **Tier 1 arming** (§C) — signing-key custody, the catalog
  domain, and the arming itself, after an independent security review. Only the arming is his.
