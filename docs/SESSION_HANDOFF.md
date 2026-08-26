# SESSION HANDOFF — paste-ready prompt for the next session

> Live pointer only. Gate truth: [`RELEASE_STATE.md`](RELEASE_STATE.md). Queue:
> [`BACKLOG.md`](BACKLOG.md) ▶ NEXT UP. Owner asks: [`OWNER_ACTION_CHECKLIST.md`](OWNER_ACTION_CHECKLIST.md).
> Budget 120 lines, and this file, `BRANCH_DISPOSITIONS.md` and `BACKLOG.md::Conformance queue` are
> all AT cap — trim or archive before adding a line anywhere. Replace this file, never append.

## Where the train is standing

**`main` is clean and pushed; the desk build is `014a3e8c`.** The last train shipped **both owner
rulings of 2026-08-26**, closed #213 and #219 through a PASS work-control receipt, and paid the NEXT
UP byte cap from the archive.

| | |
|---|---|
| `main` | deliberately not pinned — run `git log --oneline -3` |
| Installed | `014a3e8c · release · shell 0.9.26`, proof attempts 1, one installer on the Desktop |
| Shipped | `src/design/Wordmark.tsx` (#213 A1) · `src/surfaces/system-posture.ts` (#219) |
| Self-review | **PASS 12/12** at `014a3e8c`, quoted in the RELEASE_STATE owner-installed row |
| Gate | `tsc` clean · ruling guards 30/30 · verify-release-state 31/31, 0 drift · doc-truth green |

`PULSE_MIN_SIZE = 22` in `Wordmark.tsx`: below it the pulse is **absent, not transparent** — a
sub-pixel stroke still fattens the ring, which is the whole `©ompy` mechanism. The triple-click egg
survives by revealing it for one redraw, closed by a **timer**: under reduced motion `animation:
none` means `animationend` never fires and the pulse would strand forever. `system-posture.ts` drops
the `· and N more` tail; `home.posture.attentionMore` is gone from both locales.

**A correction an independent review caught — the lesson of this train.** Four places (code comment,
BACKLOG, RELEASE_STATE, the owner's checklist) said Home lists the remaining flagged checks "in full
below". **It does not:** Home shows the headline, the proportion and the #1 limiter tile — one
flagged thing plus a door — and the full per-check list is in Check and Fix, one press away.
`deriveSystemPosture`'s `reasons` carries every label and NOTHING renders it, which is what made the
false sentence plausible to four readers. All four corrected, disclosed on #219, and
`system-posture.test.ts` pins the comment to the code **both ways**. **A sentence about what a
screen shows is a claim** — unverified, the same defect in a comment as in a doc.

## IN FLIGHT — one background agent; re-dispatch if this session died before it reported

**The DIR-1 wayfinding walk** (the owner's chosen next task, picked 2026-08-26). An agent walks
Home · Monitor · Blackbook · Lab on the INSTALLED build as a first-time non-technical gamer whose PC
just froze, and returns a RANKED ≤12 finding list: what a first-timer cannot tell · on-screen
evidence (exact text + selector + a measured fact) · why it strands them · a STRUCTURAL fix.
**Intimidation is a STRUCTURE defect — grouping, boxed templates, fewer words; NEVER a switch and
never hiding** (he rejected gating information on 2026-08-06). Rendering defects report separately as
correctness failures. The ids `play`/`fix`/`learn`/`check` are persistence keys, never spoken.

## Before you touch the UI — the fixture route, and the guards already covering copy

`docs/ui-sweep/fixture/` mounts the REAL component against a build-time stub of
`@tauri-apps/api/core`; six FirstWin `?state=` values exist (`firstwin-held`, `-reverted`,
`-unreadable`, `-check-failed`, `-undo-failed`, `-latest`). Serve on 5199 with
`npx vite --config docs/ui-sweep/fixture/vite.config.mts`; a bare `/` drops your `?state=`.
`src/fixture-parity-guard.test.ts` fails the build if the stub stops answering a command the card
sends, **or if `rollback_change` is answered outside the FirstWin branch**.

- `src/data/jargon-guard.test.ts` covers the **Blackbook DATA corpus only** (tweaks/terms/tricks/
  guides), NOT surface copy — a wayfinding fix in a SURFACE needs its own guard, or an extension of
  one of these: `src/voice-guard.test.ts` (retired phrases across `src/`),
  `src/surfaces/readiness-attention-label-guard.test.ts`, `crash-rescue-naming-guard.test.ts`,
  `post-check-lab-route-guard.test.ts`, `home-console-standard-readout-guard.test.tsx`,
  `src/design/heading-is-a-name-guard.test.tsx`.

## Three gate traps this repo keeps paying for — do not pay again

- **`tools/entry/doc-truth.test.mjs` decision 7** fails any live-doc SENTENCE pairing the word
  `merge` with the word `worktree` unless it also denies propagation. True sentences still fail, and
  `\b` matches across a hyphen, so **"pre-merge review" counts** — fixing the first offender creates
  the second. Reword, never loosen (precedent PR #166). Run it **alone** before pushing
  (`node scripts/run-vitest.mjs tools/entry/doc-truth.test.mjs`): seconds versus four minutes in
  `.githooks/pre-push`. Its corpus includes `git status`, so uncommitted docs are scanned too, and
  its test COUNT is dynamic (9, 11, 12 seen) — never cite a fixed number.
- **`scripts/process-mutex-guard.test.mjs` flakes under full parallelism** — it failed once at a head
  that then passed unchanged, and passes 6/6 standalone. Re-run alone, and RECORD the re-run.
- **A doc-budget FAIL is paid from the ARCHIVE, never from the cap** — oldest CLOSED row to
  `BACKLOG_ARCHIVE.md` byte-for-byte, one collapsed pointer, then ratchet the cap DOWN. Done again
  2026-08-26: NEXT UP failed at 13320/12544, six closed blocks left (five were *pointers to
  already-archived work* — pure carried cost), 13320 → 11775, cap **12544 → 12288**, banking only
  256 of the 1545 bytes freed on purpose: this queue is where a NEW owner bug report lands.

## THE NEXT STEP, exactly

**Act on the wayfinding findings** — fix the top-ranked items as STRUCTURE, guard each one
(`bug → guard`, falsified in both directions), run the `self-review` skill, and hand the owner a
viewable before/after via `SendUserFile` for any taste substitution. After that, P2's last item is
the **Consumer / Technical / Support evidence exports**: the backend half exists
(`src-tauri/src/support_evidence.rs`, `src/surfaces/SupportEvidence.tsx`), the Consumer and
Technical projections as SURFACES do not.

**The Instrument Bench plan is NOT an option and must never be offered as one.** It was BUILT
(`403be45`) and the owner REJECTED it as the Lab on 2026-07-09; the live Lab is the Ops Console
(`LabConsole`), and its proving bench already ships armed as `ExperimentBench`.
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

## Waiting on the owner — two arming gates, nothing else

**Money items are ON HOLD by his standing rule (2026-08-25) and are deliberately NOT listed here as
blockers** — `compy.gg` registration, the Ko-fi URL and Compy Pro pricing live in
`docs/OWNER_ACTION_CHECKLIST.md` §B/§C and must stop being reported as things he owes.

- **Receipts telemetry arming** (§C) and **Tier 1 arming** (§C) — signing-key custody, the catalog
  domain, and the arming itself, after an independent security review. Only the arming is his.
- Both 2026-08-26 rulings are ANSWERED and shipped; nothing else is on his hands.
