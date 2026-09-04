# Compy Constitutional Migration — Synchronization Runbook

**Status:** ACTIVE until issue #369 and PR #371 close. Historical after landing.

This document exists so ChatGPT HQ, Claude Code, Codex, future agents, and human reviewers execute the constitutional rebirth from the same proof boundary. Chat is context, not authority. Re-derive native state before every transition.

## 1. Migration objective

Replace Compy's pre-rebirth product-direction authority with `docs/PRODUCT_CONSTITUTION.md` without weakening safety, release truth, rollback, Work Control, or current implementation evidence.

The migration changes the project's product brain and authority graph before reborn feature work continues. It is not permission to arm dark capabilities, publish a release, change security/system settings, move secrets, or modify runtime behavior merely because the product direction changed.

## 2. Authority after migration

These domains remain separate:

1. `docs/PRODUCT_CONSTITUTION.md` — supreme product authority.
2. `docs/ARCHITECTURE_LOCKS.md` — supreme safety / architecture authority.
3. `docs/RELEASE_STATE.md` — current implementation / build / release authority.
4. `docs/WORK_CONTROL.md` — current execution ownership and proof-transition authority.
5. `docs/product/ROADMAP.md` — derived product sequence.
6. `docs/BACKLOG.md` — execution ledger only.

Historical Receipts Doctrine, old Product Direction, old PRDs, old monetization plans, archived roadmaps, and pre-rebirth strategy specs remain evidence/history. They do not regain product authority by being older, more detailed, linked from an issue, or quoted by an agent.

## 3. Current migration records

- Work Control / migration issue: **#369**
- Draft migration PR: **#371**
- Migration branch: `hq/product-constitution-rebirth`

Never trust a SHA copied into this document as current state. Derive the exact current `origin/main`, branch HEAD, PR head, worktree, dirty state, claim, and processes live.

## 4. Writer ownership

Exactly one implementation writer owns this migration scope at a time.

The intended final execution arrangement is:

- **Claude Code:** sole implementation writer/operator for local reconciliation, tests, gate repair, commit/push, and proof receipt preparation.
- **ChatGPT HQ:** coordinator and independent read-only reviewer while Claude owns the write scope.
- **Codex:** optional additional read-only/adversarial review; never wait on it and never treat it as the decision owner.
- **Kuya:** owner gates only: secrets/signing, security/system settings, distribution/publication, money, destructive/irreversible choices, or a genuine product fork.

A handoff is not complete until issue #369 records it. The incoming writer re-derives repository/worktree/branch/dirty/process truth before touching inherited work.

## 5. Mandatory preflight for the incoming writer

Before mutation:

```text
git fetch origin --prune
git rev-parse --show-toplevel
git rev-parse HEAD
git rev-parse origin/main
git status --short --branch
git worktree list --porcelain
```

Also inspect:

- issue #369 and PR #371 current state;
- the active Work Control claim / expiry / scope;
- running build, test, gate, dev-server, helper, subagent, and install processes;
- whether the migration branch is already checked out in another worktree;
- whether any dirty files exist in the intended migration worktree.

Do not reset, stash, discard, kill, or take over unknown work to make the lane convenient.

## 6. Reconcile current `main` before proving anything

The migration branch was originally created from an earlier `main`. Before tests or review, integrate the exact current `origin/main` into `hq/product-constitution-rebirth` in the isolated migration worktree.

At the 2026-09-04 synchronization check, `main` had advanced through PR #370, whose changed paths were:

- `.claude/hooks/session-root-assert.mjs`
- `.claude/settings.json`
- `docs/superpowers/specs/2026-08-21-unverified-session-write-refusal.md`
- `tools/entry/session-root-assert.test.mjs`

Those paths did not overlap the then-current constitutional migration diff. This is context only; re-check current state before integrating because `main` may move again.

After reconciliation, re-run the changed-file scope check. Any newly introduced migration change outside docs/bootstrap/constitutional guard scope must be explained and dispositioned, not silently absorbed.

## 7. Release-state truth is an independent gate

`docs/RELEASE_STATE.md` is not subordinate to the Product Constitution. The constitutional migration cannot declare release truth by prose.

At the 2026-09-04 synchronization check, `RELEASE_STATE.md` still carried `STATE:source_main_commit=81f407f5` while `main` was 31 commits ahead. The file's own contract says a `source_main_commit` more than 10 commits behind mainline fails `scripts/verify-release-state.mjs`.

The incoming writer must therefore run the verifier before interpreting any failure:

```text
node scripts/verify-release-state.mjs
```

If the only current failure is the stale `source_main_commit` anchor, fix it as a truth-only reconciliation according to the verifier's existing format/contract. Do not alter published version, installed-build, artifact, owner-GO, or fleet claims unless independently re-proven and actually changed.

If there is any additional release-state failure, report it separately. Do not hide it inside the constitutional migration.

## 8. Required constitutional proof

At the exact reconciled migration HEAD, run at minimum:

```text
npx vitest run src/product-constitution-guard.test.ts src/claude-md-laws-guard.test.ts
pwsh -NoProfile -File scripts/doc-budget.ps1
node scripts/verify-release-state.mjs
```

Then run the repository's exact full local gate:

```text
pwsh -NoProfile -File scripts/verify-local.ps1
```

A filtered or narrower test is supplemental only. If the exact full gate cannot run, that is BLOCKED, not PASS.

## 9. Active-authority audit

Do a repo-wide read-only audit for legacy product authority that could still be mistaken as current. At minimum search for variants of:

- `Care is the primary product`
- `Compy Care is the primary product`
- optimization / proving as `secondary` or `second` specialty
- Receipts Doctrine described as `canonical`, `supreme`, or winning over current product direction
- old Product Direction / PRD / monetization files presented as current priority authority

Historical text is allowed to exist when clearly classified as historical evidence, tombstone, archive, or superseded context. The failure condition is an active entrypoint, agent bootstrap, current roadmap/backlog, safety doc, or unclassified current-looking document that can still route work around the Constitution.

Record every hit as one of:

- CURRENT + CONFORMING
- HISTORICAL / SUPERSEDED
- FALSE POSITIVE
- DEFECT — MUST FIX BEFORE MERGE

Do not delete history merely to make grep quiet.

## 10. Safety-preservation review

Review `docs/ARCHITECTURE_LOCKS.md` adversarially against the pre-migration version. Confirm that the migration did not weaken or omit at least:

- one mutation boundary;
- rollback-from-history independence;
- additive persisted enum/schema compatibility;
- immutable bundle/data-path contracts;
- signed remote rules and key custody;
- default local/user-mode/least-privilege posture;
- no game/process injection or game-memory access;
- owner gate for security/system settings;
- capability exception discipline;
- permanent high-risk tweak exclusions;
- unknown/unavailable measurements remain unknown, never fabricated.

Product ambition may expand only inside those rails or through a separately owner-approved architecture amendment.

## 11. Product-intent preservation review

Review the Constitution and derived docs against the ratified rebirth direction. The migration is incomplete if it dilutes any of these core laws:

- The user chooses the destination; Compy handles the technical route, proves the result, explains tradeoffs, and never hides the way back.
- Compy optimizes outcomes, not settings.
- `MAKE THIS PC BETTER` and `FIGURE OUT WHAT WENT WRONG` are equal flagship journeys.
- The fundamental optimization unit is a Trial, not a tweak.
- No measurable benefit beyond credible noise means the default/original state wins.
- Optimize for the smallest validated configuration that best serves the user's goal, not tweak count or lowest process count.
- Average FPS alone is not sufficient optimization evidence.
- Care and Performance share Machine Model, evidence, history, rollback, confidence, and experiment machinery.
- Simple outside, deep inside: Answer → Explanation → Technical receipt.
- User freedom does not obligate Compy to automate unsupported or indefensible operations.

## 12. Proof receipt and independent review

After all writer-side changes and tests are complete:

1. commit and push the exact head;
2. record the full 40-character head SHA;
3. record exact commands/results;
4. record release-state result;
5. record authority-audit disposition;
6. record safety-preservation disposition;
7. stop writing and hand the exact head to the non-writing reviewer.

The independent reviewer must review that exact head. Any subsequent commit invalidates the review for transition purposes and requires review again.

Before marking PR #371 ready, merging it, closing #369, or marking its Project item Done, create the required JSON receipt and run:

```text
node scripts/work-control-gate.mjs <receipt.json>
```

Only `PASS` at the exact current head authorizes the proof-dependent transition.

## 13. Merge and activation sequence

When all exact-head gates and independent review pass:

1. re-fetch and re-derive `origin/main` immediately before transition;
2. reconcile again if main moved;
3. re-run any gate/review invalidated by a new head;
4. run the Work Control proof gate;
5. mark PR ready only when actually ready;
6. merge the green PR under normal engineering authority;
7. fetch merged `main` and verify the Constitution/bootstrap files from the merge result;
8. run the constitutional guard on merged `main`;
9. update/close #369 with exact merge SHA and proof summary;
10. re-triage remaining open product work against the new Constitution instead of restoring the old queue.

Do not publish a release merely because the migration lands. Release/distribution remains a separate owner-controlled boundary.

## 14. Post-merge boot verification

A fresh Claude Code session rooted in merged `main` must automatically route product work through `CLAUDE.md` → `docs/PRODUCT_CONSTITUTION.md` and preserve the separate safety/release/ownership authorities.

A fresh Codex session must route through `AGENTS.md` → the same authority stack.

A human entering through `README.md` or `docs/README.md` must reach the same product authority.

If any of those paths gives a different product hierarchy, the migration is not complete.

## 15. Definition of fully synchronized

The migration is fully synchronized only when:

- the same constitutional law is reachable from human, Claude, Codex, roadmap, backlog, and docs entrypoints;
- old doctrine is explicitly historical rather than ambiguously current;
- safety and release truth remain independent and green;
- exactly one writer owns the migration scope at a time;
- local full-gate proof exists at the exact remote-reachable head;
- independent review covers that exact head;
- merged `main` passes the constitutional boot/guard verification;
- post-migration product triage starts from the Constitution, not from inherited queue momentum.
