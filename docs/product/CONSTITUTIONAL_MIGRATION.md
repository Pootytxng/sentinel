# Compy Constitutional Migration — Synchronization Runbook

**Status:** ACTIVE until issue #369 and PR #371 close and merged-main boot verification passes.

This is the execution runbook for the constitutional rebirth. GitHub/native repository state is
authority; chat is coordination context. Re-derive live state before every mutation, handoff, proof,
review, or transition. Do not trust a SHA or executor copied from an older section/comment.

## 1. Migration objective

Replace Compy's pre-rebirth product-direction authority with `docs/PRODUCT_CONSTITUTION.md` without
weakening safety, release truth, rollback, Work Control, or current implementation evidence.

The migration changes the project's product brain and authority graph before reborn feature work
continues. It is not permission to arm dark capabilities, publish a release, change security/system
settings, move secrets, or modify runtime behavior merely because product direction changed.

## 2. Authority after migration

These domains remain separate:

1. `docs/PRODUCT_CONSTITUTION.md` — supreme product authority.
2. `docs/ARCHITECTURE_LOCKS.md` — supreme safety / architecture authority.
3. `docs/RELEASE_STATE.md` — current implementation / build / release authority.
4. `docs/WORK_CONTROL.md` — mutation-lease, execution ownership, and proof-transition authority.
5. `docs/product/ROADMAP.md` — derived product sequence.
6. `docs/BACKLOG.md` — execution ledger only.

Historical Receipts Doctrine, old Product Direction, old PRDs, old monetization plans, archived
roadmaps, and pre-rebirth strategy specs remain evidence/history. They do not regain product authority
because they are older, detailed, linked from an issue, or quoted by an agent.

## 3. Native migration records

- Work Control / migration issue: **#369**
- Draft migration PR: **#371**
- Migration branch: `hq/product-constitution-rebirth`

Never trust a SHA, executor, worktree, claim, or proof receipt copied into prose as current. Derive the
exact current `origin/main`, PR head, migration branch head, active mutation lease(s), worktree/dirty
state, scope, processes, and latest review live.

## 4. Dynamic mutation leases

Owner-ratified 2026-09-04: there is no permanent `Claude = implementation` or
`Codex/HQ = read-only review` department.

For each bounded slice, route mutation to the executor with the best combination of:

- current context already loaded;
- remaining context/token capacity relative to the next proof boundary;
- required local-machine/worktree access;
- required connected-tool/API access;
- specialization relevant to the slice;
- ability to preserve an independent reviewer for the final proof delta.

Claude Code, Codex, and ChatGPT HQ may each implement. Cowork may implement within an explicitly
claimed suitable scope. ChatGPT HQ normally coordinates the whole control picture, but coordination
does not prohibit it from taking a bounded mutation lease when it is the best executor.

The hard invariant is **one active mutation lease per overlapping scope**:

- all models may inspect/read/reason/coordinate in parallel;
- only the current lease holder mutates an overlapping scope;
- one folder has one writer;
- disjoint scopes may proceed concurrently only in separate worktrees/branches with exact measured
  non-overlap;
- a handoff transfers mutation authority only, not knowledge, participation, or product ownership.

A handoff between models is routine engineering coordination and does not require Kuya approval unless
it crosses a genuine owner-only boundary.

## 5. Required preflight before mutation

Before any executor takes or uses a migration mutation lease:

```text
git fetch origin --prune
git rev-parse --show-toplevel
git rev-parse HEAD
git rev-parse origin/main
git status --short --branch
git worktree list --porcelain
```

Also inspect live:

- issue #369 and PR #371 state;
- current lease holder(s), expiry, exact write scope, folder, branch, and handoff history;
- running build/test/gate/dev/helper/subagent/install processes relevant to the intended folder;
- whether the intended branch is checked out elsewhere;
- dirty/staged/untracked/stashed/divergent work;
- overlap with every other Active mutation lease.

Do not reset, stash, discard, force, clean, delete, kill, or take over unknown work merely to make a
handoff convenient. Preserve first; reconcile deliberately.

A fresh unclaimed slice needs a claim. Inherited work needs a durable handoff/takeover record before
the incoming executor writes. Expiry is an alarm, never automatic takeover authority.

## 6. Reconcile current main before proving anything

The migration branch was created from an earlier `main`. Immediately before proof and again before a
proof-dependent transition, fetch and compare exact current `origin/main`.

At the 2026-09-04 synchronization check, `main` had advanced through PR #370, whose changed paths were:

- `.claude/hooks/session-root-assert.mjs`
- `.claude/settings.json`
- `docs/superpowers/specs/2026-08-21-unverified-session-write-refusal.md` (historical changed-path
  reference; its superseded session-policy framing is not migration authority)
- `tools/entry/session-root-assert.test.mjs`

Those paths did not overlap the then-current constitutional migration diff.

If main moved:

1. inspect the new main diff for overlap/semantic impact;
2. reconcile it into the isolated migration worktree without destroying unknown work;
3. re-run changed-file/scope measurement;
4. invalidate any gate/review whose exact head changed.

A historical statement that a previous main advance did not overlap is context only, never permission
to skip the current comparison.

## 7. Release-state truth stays independent

`docs/RELEASE_STATE.md` is not subordinate to the Product Constitution. The constitutional migration
cannot declare build/install/release truth by prose.

Run:

```text
node scripts/verify-release-state.mjs
```

Classify every failure in its actual domain. A stale `source_main_commit` may be repaired truth-only
when the verifier proves it. Installed-build, artifact, publication, owner-GO, fleet, or arming claims
must not be altered unless independently re-proven and actually changed.

Do not absorb another lane's installed-build reconciliation into #369 merely to make the migration
green.

## 8. Required constitutional proof

At the exact reconciled migration head, run at minimum:

```text
npx vitest run src/product-constitution-guard.test.ts src/claude-md-laws-guard.test.ts src/dynamic-mutation-lease-guard.test.ts
pwsh -NoProfile -File scripts/doc-budget.ps1
node scripts/verify-release-state.mjs
```

Then run the exact repository full local gate:

```text
pwsh -NoProfile -File scripts/verify-local.ps1
```

Run the explicit current issue-bound scope measurement required by Work Control as well.

A narrower/filtered/alternative test is supplemental only. If the exact full gate cannot run, the
state is **BLOCKED**, not PASS.

## 9. Active-authority audit

Do a repo-wide read-only audit for legacy product authority that could still be mistaken as current.
At minimum search variants of:

- `Care is the primary product` / `Compy Care is the primary product`;
- optimization/proving described as secondary or second specialty;
- Receipts Doctrine called canonical/supreme/current;
- old Product Direction / PRD / monetization / roadmap files presented as current authority;
- old fixed pricing/subscription decrees presented as current law;
- hidden agent/skill/spec/template paths that route around the Constitution.

Classify every meaningful hit as:

- CURRENT + CONFORMING
- HISTORICAL / SUPERSEDED
- FALSE POSITIVE
- DEFECT — MUST FIX BEFORE MERGE

Do not delete history merely to make grep quiet.

## 10. Safety-preservation review

Review `docs/ARCHITECTURE_LOCKS.md` adversarially against pre-migration safety law. Confirm at least:

- one mutation boundary;
- rollback-from-history independence;
- additive persisted enum/schema compatibility;
- immutable bundle/data-path contracts;
- signed remote rules and key custody;
- default local/user-mode/least-privilege posture;
- no game/process injection or game-memory access;
- owner gate for security/system settings;
- Capability Exception discipline;
- permanent high-risk tweak exclusions;
- unknown/unavailable measurements remain unknown, never fabricated.

Product ambition may expand only inside those rails or through a separately owner-approved architecture
amendment.

## 11. Product-intent preservation review

The migration is incomplete if it dilutes any core constitutional law, including:

- The user chooses the destination; Compy handles the route, proves the result, explains tradeoffs,
  and never hides the way back.
- Compy optimizes outcomes, not settings.
- `MAKE THIS PC BETTER` and `FIGURE OUT WHAT WENT WRONG` are equal flagship journeys.
- The fundamental optimization unit is a Trial, not a tweak.
- No measurable benefit beyond credible noise means the default/original state wins.
- Optimize for the smallest validated configuration that best serves the user's goal.
- Average FPS alone is not sufficient optimization evidence.
- Care and Performance share Machine Model, evidence, history, rollback, confidence, and experiment
  machinery.
- Simple outside, deep inside: Answer → Explanation → Technical receipt.
- User freedom does not obligate Compy to automate unsupported or indefensible operations.

## 12. Proof receipt and independent review

Sequential lease transfers are allowed during implementation. Therefore the final proof receipt must
represent **all mutation authors in the proof delta**, not only the final lease holder.

After writer-side changes/tests are complete:

1. commit and push the exact head;
2. record the full 40-character head SHA;
3. record exact commands/results and scope measurement;
4. record release-state disposition;
5. record authority-audit disposition;
6. record safety/product-intent disposition;
7. record all mutation authors represented in the proof delta;
8. stop mutation at that proof boundary and hand the exact head to an independent reviewer.

The independent reviewer must:

- review the exact current head;
- not be one of the mutation authors whose delta is being approved;
- report material findings with evidence;
- be repeated if any subsequent commit changes the head.

Independent review is a **proof-transition gate**, not a permanent model role. Handoffs between
executors do not require review by themselves.

Before marking #371 ready, merging, closing #369, closing a proof-dependent replacement, or marking the
Project item Done, create the required JSON receipt and run:

```text
node scripts/work-control-gate.mjs <receipt.json>
```

Only exact-head `PASS` authorizes the transition.

## 13. Merge and activation sequence

When all exact-head gates and independent review pass:

1. re-fetch/re-derive `origin/main` immediately before transition;
2. reconcile again if main moved;
3. repeat any proof/review invalidated by a new head;
4. run the exact Work Control proof gate;
5. mark PR ready only when actually ready;
6. merge the green PR under normal engineering authority;
7. fetch merged `main` and verify Constitution/bootstrap/control files from the merge result;
8. run the constitutional and dynamic-mutation-lease guards on merged main;
9. verify fresh Claude + Codex + human boot paths resolve to the same authority/control model;
10. update/close #369 with exact merge SHA and proof summary;
11. re-triage remaining product work from the Constitution rather than restoring inherited queue
    momentum.

Do not publish a release merely because the migration lands. Release/distribution remains separate
owner-controlled truth.

## 14. Post-merge boot verification

A fresh Claude Code session rooted in merged main must automatically route through `CLAUDE.md` to:

- Product Constitution for product law;
- Architecture Locks for safety;
- Release State for current implementation/release truth;
- Work Control for dynamic mutation leases;
- derived Roadmap for sequence.

A fresh Codex/ChatGPT repo session must route through `AGENTS.md` to the same stack.

A human entering through README/docs index must reach the same product authority.

No bootstrap may teach a permanent Claude implementation department or permanent Codex/HQ read-only
department. Local collision hooks may enforce folder/session/scope ownership; they must not choose the
model that receives implementation jurisdiction.

## 15. Definition of fully synchronized

The migration is fully synchronized only when:

- the same constitutional law is reachable from human, Claude, Codex/ChatGPT, roadmap, backlog, and
  docs entrypoints;
- old doctrine is explicitly historical rather than ambiguously current;
- safety and release truth remain independent and green;
- executor routing uses dynamic mutation leases with measured overlap protection;
- no generic selector/preflight silently assumes a Claude identity;
- local full-gate proof exists at the exact remote-reachable head;
- independent review covers that exact head and is by a non-author of the proof delta;
- merged main passes constitutional + dynamic lease boot/guard verification;
- post-migration product triage starts from the Constitution, not inherited queue momentum.

## 16. Historical execution records

The records in this section and in the writer records that follow are point-in-time evidence written
under the former fixed role split. They remain preserved here, in Git history, and on issue #369 as
provenance. They are historical evidence, not current execution law. The owner-ratified dynamic
mutation-lease decision (section 4) supersedes that former fixed role split while preserving the
collision, proof, safety, and owner-gate invariants.

Exact heads, commands, and results live on #369 / #371; this section records only what was decided
and why, so a reviewer can check the reasoning rather than re-derive it from the diff.

- **Main integrated by merge, not rebase.** The branch was HQ-authored through the GitHub API and
  already published under PR #371; rewriting it would have invalidated HQ's own review anchors. The
  #370 paths did not touch the migration file set and merged without conflict.
- **Release-state verifier had two drifts, not one.** `SOURCE-COMMIT-STALE` was re-stamped truth-only
  to current `main`, nothing else in `RELEASE_STATE.md` changed. `INSTALLED-STAMP-DRIFT` was **not**
  absorbed: the stamp the verifier reads from the installed `compy.exe` belongs to a #225-lane desk
  build that is not on `main`, and that lane's branch already carries the row reconciliation. Folding
  another writer's installed-build claim into a docs migration would violate both Work Control and §7.
- **Doc budget re-pointed, then ratcheted.** The migration removed the three BACKLOG sections whose
  byte caps `scripts/doc-budget.ps1` named, so the caps moved to the sections that replaced them and
  the BACKLOG file budgets followed the file down (the guard's slack rule forbids a padded budget).
  This is the one path outside the original PR #371 file set; it is a gate-truth repair, not product
  work.
- **Safety-preservation review found softenings and repaired them in place** rather than
  rationalizing: signature-before-download ordering; unconditional embedded-baseline cold start; the
  inline rollback exception hatch (removed — the only route is a §6 amendment); the advanced/
  problem-specific/user-initiated/warned conditions for surfacing barred items; the Tier 1
  implementation lock, enumerated kill-switch limits, `CASE_SOURCE_ORIGINS` ownership, and Tier 2
  "stays OFF after arming"; strict-serde specifics; key-custody storage prohibitions; the AI
  "human review" boundary and its full disallowed surface; universal MPO disable back on the barred
  list, consistent with `CLAUDE.md` rule 6; Capability Exception Gate provenance and directive
  pointers.
- **Product-intent review found one dilution and repaired it:** roadmap phase order read as
  Performance-before-Care ranking. The roadmap now states that numbering is dependency order and that
  neither flagship journey is subordinate. README's present-tense capability paragraph now defers
  current-state truth to `RELEASE_STATE.md`; the Optimization Engine restates the Constitution's
  multi-metric evidence families; each tombstone names the exact commit that carries its full
  pre-rebirth body.
- **The full suite, not the three named guards, found the rewrite's collateral.** `npm test` at the
  merged head failed six existing guards that pin exact bootstrap markers: the role/proof contract
  and `scripts/work-control-gate.mjs` reference (`work-control-gate.test.mjs`), the taste decree
  (`taste-autonomy-guard.test.mjs`), the "Subagent routing" rule the model-guard hook cites
  (`agent-machinery-guard.test.ts`), the 🔴 OPEN pointer to `UI_VISION_BACKLOG.md`
  (`ui-vision-status-guard.test.ts`), the mechanically verified Rust module map
  (`verify-module-map-guard.test.mjs`), and the Capability Exception mirrors
  (`capability-exception-policy-guard.test.ts`). All were restored in `CLAUDE.md`, `AGENTS.md` and
  `ARCHITECTURE_LOCKS.md` §1.8 in their pinned wording. The capability guard's corpus was amended
  rather than the tombstones: `COMPY_OVERVIEW.md`, `RECEIPTS_DOCTRINE.md`, `PRODUCT_DIRECTION.md`
  and `BACKLOG.md` no longer carry policy mirrors (they stay in the forbidden-permission scan), and
  `PRODUCT_CONSTITUTION.md` is pinned to its own deferral to the Locks.
- **Active-authority audit: twelve live routing files still named a tombstone as canonical**
  (`PRODUCT.md`, the session/Cowork handoffs, the Council protocol, pricing research, the owner
  checklist, three skills, both web-design-director seats, and the 2026-08-09 decision record). Each
  now routes to the Constitution or `product/MONETIZATION.md` and names the tombstone as history;
  nothing was deleted to quiet grep. `src/product-constitution-guard.test.ts` gained the law: a live
  routing file may mention a tombstone only in a paragraph that also says it is history, and may
  never call one canonical. The $4.99 / $39 / $89 band is recorded as a hypothesis under
  Constitution §32, which is what the Constitution itself says about historical price decrees.
- **Not touched, deliberately:** `src-tauri/**`, `docs/RELEASE_STATE.md` beyond `source_main_commit`,
  and every claim about what is published, installed, or armed.

## 17. Writer record — Codex verified takeover and adversarial repair (2026-09-04)

The exact-head independent review of `d13de5d6b2981d02cb98f0b98c4eb7edee24d5a3` returned
**CHANGES REQUIRED**. Claude's work was at a clean, pushed boundary, but its original desktop task
was not rooted in the migration worktree. Codex stopped the identified stale read-only tasks; a new
Claude task was then left paused and non-writing at the application's workspace-trust prompt. Codex
did not approve or bypass that security decision. The verified takeover and expanded file claim are
recorded natively on #369 before this repair.

The repair closes five authority paths that green string guards had missed:

- `docs/WORK_CONTROL.md` no longer gives BACKLOG product-priority authority; the Constitution owns
  direction, the Roadmap derives sequence/priority, and BACKLOG records execution status only.
- Four pre-rebirth specs/reviews whose headers still said `IN BUILD`, owner-approved,
  implementation-ready, or “begin implementing” now carry mandatory top-level product-direction
  supersession notices while preserving bounded technical and owner-history evidence.
- The 2026-08-18 outbound decision's `ACTIVE` Tier 2 default-ON instruction is explicitly historical
  and subordinate to the later owner #207 default-OFF ruling in `ARCHITECTURE_LOCKS.md`.
- `PRODUCT.md` now presents the two constitutional flagship journeys as equal instead of describing
  optimization as something the safety layer merely happens to do.
- The Constitution guard now discovers current-looking executable legacy documents structurally,
  requires their top-level classification, and pins Work Control routing. The capability guard keeps
  the mixed Care/capability spec in its live technical corpus while requiring its product
  supersession boundary, and separately validates the retired outbound decision.

No runtime, release, installed-state, publication, capability, or owner-only setting is changed.
The review at `d13de5d6b2981d02cb98f0b98c4eb7edee24d5a3` becomes stale when this repair produces a new head;
that new remote-reachable head requires a fresh independent review before any transition.

## 18. Second adversarial sweep — hidden authority and guard depth (2026-09-04)

Independent review of pushed head `7491bd0ff8b8dc6561b8f89a25b791c095cb4170` returned
**CHANGES REQUIRED**. The review is stale as soon as this repair is committed. It found that the first
guard still trusted a narrow current-looking phrase set and could miss executable authority late in a
document. A second repository-wide semantic sweep then found additional live-looking sources that the
review examples had not named.

This repair:

- scans the full body of legacy specs, plans, reviews, and decisions for multiple executable-authority
  shapes rather than trusting one header string or the first 1,800 bytes;
- pins the exact 47-file current-looking corpus so both detector blindness and unclassified additions
  fail loudly, and keeps a late-document positive control that proves the full-body scan;
- expands top-level supersession boundaries across the design-system, Gaming Mode, Knowledge,
  monetization, Console HUD, Lab, Monitor, Blackbook, Intelligence, capability, comprehensibility,
  site, and review families while preserving conforming technical provenance;
- makes the superseded-plan citation guard enumerate the expanded corpus and requires live citations
  to disclose supersession in place rather than widening its disclosure escape hatch;
- dynamically scans Claude skills/agents and Codex agent entrypoints for undisclosed tombstone
  routing;
- reclassifies `docs/UI_VISION_BACKLOG.md` as historical owner evidence, then rewires Claude bootstrap,
  status, self-review, handoff, and owner-checklist paths through the Constitution and roadmap;
- reclassifies the dormant parallel-worktree/bus/workflow documents under `docs/WORK_CONTROL.md` so a
  reader cannot follow a supersession chain into another dead execution model;
- preserves `docs/ARCHITECTURE_LOCKS.md` as the authority for rollback, mutation, schema, key custody,
  capability, injection, privilege, unknown-data, and owner-gate rules;
- leaves `INSTALLED-STAMP-DRIFT` in the separate #225 lane while keeping this migration's
  `source_main_commit` reconciliation distinct.

The writer must now post one complete machine-readable scope claim, pass the exact scope gate, run the
full local gate, push a new remote-reachable 40-character head, and obtain a fresh independent review
of that exact head before any PR transition.

## 19. Writer record - Cowork HQ verified takeover and reconciliation (2026-09-05)

Cowork HQ took the mutation lease for this branch after a verified takeover record was posted on #369.
Codex's uncommitted guard edit was preserved as
`C:\Users\Kuya\code\hq-desk-fix-2026-09-04\codex-369-guard-wip-2026-09-04.patch` and the worktree was
restored to a clean state before any write. `origin/main` `1aae437a` (PR #377) was merged in with no
conflicts. PR #375 (`hq/dynamic-mutation-lease`) was reconciled into this branch by merge; the single
conflicted file was this runbook, resolved so section 6 keeps both the explicit PR #370 path list and
the "if main moved" procedure, and section 16 keeps the full historical execution record beneath the
lease-model provenance notice. An executor identity rule was added to `docs/WORK_CONTROL.md` so the
gate's mutation-author check binds to real commit identities. Owner-directed follow-up: the tests
that pinned the retired role split were re-pinned to the lease law, never deleted. Reconciliation
proof head: `c276292a42b1270b5f3c6d2da352f9bd8443a612` (full `npm test` 6522 passed / 0 failed,
doc-budget ALL PASS). The commits between that SHA and the pushed head are this record and a
type-check-only import fix to the lease guard (no assertion changed); the exact pushed head is the
one the local gate passed on and is recorded on #369.
