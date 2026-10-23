# OWNER DIRECTIVE 2026-10-23 — Product-first recovery

**Authority:** explicit owner decision (authority rank 1 in `CLAUDE.md` / `AGENTS.md`). Where this
directive conflicts with `docs/WORK_CONTROL.md`, `CLAUDE.md`, `AGENTS.md`, a skill, a hook or a guard,
**this directive wins** for its period. It does not override `docs/ARCHITECTURE_LOCKS.md` or any
SAFETY-class guard.

**Period:** 2026-10-23 through 2026-11-22. The owner may end or extend it in writing.

**Why (measured, not asserted):** between 2026-09-23 and 2026-10-18, `main` took 219 commits: 6 added
product behaviour, ~80 were receipts or lease bookkeeping, ~48 were guard-only tests, 32 were review-round
follow-ups. One CSS overflow bug (#614) cost 16 commits over 11 review rounds, the same as the entire Trial
Protocol (#583). No roadmap phase has moved since 2026-09-30. The owner saw no visible change for nine
weeks, and the 2026-10-20 desk install was never recorded or explained. The code itself is healthy:
tsc 0 errors, cargo 0 warnings, 29,714 tests passing. The problem is process, not product.

## Rules

1. **Product only.** A task may start only if it (a) fixes an open product issue, (b) advances a
   Roadmap phase exit (`docs/product/ROADMAP.md`), or (c) clears a release blocker (#672 supply-chain
   expiry 2026-10-31). No new guards, hooks, scripts, receipt formats, work-control rules, skills,
   consoles or coordination docs. One exception: a guard for a tester-reported product defect.
2. **Friday desk install.** Every Friday, whatever is on `main` is built and installed on the owner's
   desk via `scripts/ship-reinstall.ps1 -VerifyRuntime`, and `docs/RELEASE_STATE.md` is updated in the
   same commit. If a week produced nothing visible, the Friday report says so in one sentence.
3. **Two review rounds, then ship or drop.** An independent review may request changes once; a second
   round closes it. The "named injection" requirement (WORK_CONTROL §#322 guard 3) applies to
   SAFETY-class guards only.
4. **One receipt per merge.** Receipts and `work-control-gate` run for merges to `main` only. No receipts
   for mark-ready, close-issue or mark-done; no carry commits.
5. **One executor at a time.** The repo runs as a single lane: one worker holds write access to the
   checkout; others are read-only until handed off in one line. `lease-overlap-gate` is removed from
   `pre-push`; scope-drift and ownership hooks are frozen (keep, do not extend).
6. **Session boot = three files.** Read `CLAUDE.md`, `docs/RELEASE_STATE.md` and this directive.
   Open `PRODUCT_CONSTITUTION.md`, `WORK_CONTROL.md`, `ARCHITECTURE_LOCKS.md` only when the task
   touches their domain.
7. **Report to the owner in three lines, every session, in plain words:**
   - *What you can see now* — the visible change, or "nothing visible this session".
   - *What changed under the hood* — one sentence, no internal dialect.
   - *What I need from you* — a concrete action with a time estimate, or "nothing".
   "Blocked on owner rig" is not a report. Name the click and the minutes.
8. **One coordinator.** The owner talks to one coordinator; that coordinator assigns one executor per
   task. Review-of-review chains (coordinator → executor → second-model review → receipts) end.

## Immediate sequence (in order)

1. Reconcile `docs/RELEASE_STATE.md` with the live desk build (`e9727c04`, installed 2026-10-20 from
   `claude/haul-609-20261016`) so `verify-release-state` is green.
2. Land PR #686 (#620 read-back: the five applied rows that block every Trial start on the owner's
   rig), desk-install it, then run the Phase 3 live trial with the owner at the keyboard (Roadmap Phase 3
   exit) and the four-screen agreement check (Phase 2 exit, #453). Record both in `BACKLOG.md`.
3. Clear #672 before 2026-10-31.
4. Triage: the 21 open product issues are the backlog; the 41 process-tagged issues are labelled
   `process-frozen` and not worked during the period. Product PRs (#686, #673, #666, #661, #627, #604)
   are reviewed under rule 3; process PRs are parked, not merged.
5. Resume Roadmap Phase 4 only after steps 1–3.

## Guard classes referenced

SAFETY (keep, rule 3 full strength): outbound/case-evidence tiers, CSP, command authority, mutation
boundary, record-first, what-changed rollback, ledger-health, never-paywall-safety, store-lock,
release pipeline, updater key, secret containment, data-root, privacy.
PRODUCT (keep, frozen for additions): design, surfaces, idle/perf, i18n, copy, reachability,
machine-model reader.
PROCESS (frozen; retire as they block product work, one commit per retirement touching guard, residency
table and doc together): claude-md-laws, claude-directory, agent-machinery, product-constitution-guard,
superseded-plan, ui-vision-status, owner-checklist, self-review-rubric, dynamic-mutation-lease,
gate-mutex, hookspath-fleet, gate-residency, codex-*, tools/entry, tools/console.
