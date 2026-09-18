# AGENTS.md — Codex / ChatGPT control file for the Compy repo

> Product direction is not duplicated here. Re-derive current native state before asserting any
> identifier, claim, branch, priority, gate, completion state, or owner.

## Authority stack

These files own different domains. Do not collapse them into one hierarchy.

1. **`docs/PRODUCT_CONSTITUTION.md` — SUPREME PRODUCT AUTHORITY**
   - product identity, principles, flagship journeys, strategy, priorities, and anti-goals.
   - If an older roadmap, doctrine, PRD, issue, spec, marketing note, or agent instruction conflicts
     on product direction, the Constitution wins.

2. **`docs/ARCHITECTURE_LOCKS.md` — SAFETY / ARCHITECTURE AUTHORITY**
   - rollback/mutation boundaries, privilege/security, immutable contracts, capability/network rules.
   - Product ambition never silently weakens these locks.

3. **`docs/RELEASE_STATE.md` — CURRENT IMPLEMENTATION / RELEASE AUTHORITY**
   - what is built, armed, installed, verified, or blocked right now.
   - Product intent never changes current-state truth by proclamation.

4. **`docs/WORK_CONTROL.md` — EXECUTION / MUTATION-LEASE AUTHORITY**
   - current mutation leases, exact scopes, work locations, handoffs, and proof-bound transitions.
   - Product priority never grants write ownership by itself.

5. **`docs/product/ROADMAP.md` — DERIVED EXECUTION SEQUENCE**
   - must conform to the Constitution and current safety/release truth.

6. **`docs/BACKLOG.md` — EXECUTION LEDGER ONLY**
   - status/history; never a source of product philosophy or inherited priority.

## Product boot rule

Before product design, prioritization, UX, feature, marketing, monetization, or roadmap work:

1. read `docs/PRODUCT_CONSTITUTION.md`;
2. read the relevant derived file under `docs/product/`;
3. read `docs/ARCHITECTURE_LOCKS.md` for safety constraints;
4. read `docs/RELEASE_STATE.md` for current truth;
5. read `docs/WORK_CONTROL.md` before any write.

`docs/RECEIPTS_DOCTRINE.md`, historical PRDs, old Product Direction documents, archived roadmaps,
and pre-rebirth strategy specs are historical evidence only. They never outrank the Constitution.

## Dynamic executor routing — no permanent implementation department

Claude Code, Codex, ChatGPT HQ, and Grok may all implement. Role specialization is a routing hint, not
jurisdiction.

- **ChatGPT HQ** usually coordinates native state, priority, dependencies, handoffs, and proof status.
- **Claude Code** is often the best executor for long local Windows implementation/build/test slices.
- **Codex** is often the best executor for code-heavy implementation, adversarial repair, and audits.
- **ChatGPT HQ** may also execute bounded repository mutations through connected tools when that is
  the shortest safe path.

For each bounded slice, select the executor that has the best combination of current context,
remaining capacity, local/tool access, and ability to reach the next proof boundary. Do not keep a
slice with a model merely because it wrote the previous commit.

The invariant is **one active mutation lease per overlapping scope**:

- all models may inspect/read/reason/coordinate in parallel;
- only the lease holder mutates that overlapping scope;
- disjoint scopes may proceed in separate worktrees/branches with exact non-overlapping claims;
- lease transfer is lightweight and recorded on the linked issue;
- a handoff transfers mutation authority only, not participation or product ownership.

Never infer the lease holder from tool identity, chat, or an old comment. Read the current linked issue
and actual worktree/process state.

Commit under your own executor git identity as defined in `docs/WORK_CONTROL.md` "Executor identity".

Before a proof-dependent GitHub transition, follow `docs/WORK_CONTROL.md` and run
`scripts/work-control-gate.mjs`. Exact required gates cannot be substituted; environment inability is
BLOCKED, not PASS.

Independent review is required at the proof-transition boundary, not as a permanent job assignment.
The exact-head reviewer must not be one of the mutation authors whose work is being approved. A head
change makes that review stale.

## Owner-only boundaries

Kuya controls:

- fleet-visible publication/distribution;
- secrets/signing custody and credentials;
- security/system settings;
- destructive/irreversible actions;
- money/paid services;
- people/account access;
- genuine product forks;
- material telemetry/network/updater/capability arming decisions.

Routine engineering forks, executor selection, reversible Git plumbing, and lease handoffs are not
owner gates unless they cross one of those boundaries.

## Hard constraints that bind every executor and reviewer

Read the full locks before proposing implementation. At minimum:

- **No fabricated or unmeasured claims.** Unknown/unavailable remains unknown.
- **Rollback-first integrity.** A change Compy applies must retain the restoration path required by
  the governing architecture contract.
- **One mutation boundary.** Windows mutation belongs in `src-tauri/src/actions.rs` under the repo's
  established exceptions/guards; do not invent a second mutation path.
- **Capability Exception Gate; no third-party game/process injection.** Default remains local,
  user-mode, least-privilege and non-invasive. A Compy-shipped driver is policy-possible only through
  the named gate (`docs/ARCHITECTURE_LOCKS.md` §1.8); none ships today, no vulnerable third-party
  driver is allowed, and no generic physical-memory/MSR/PCI/device-register surface is allowed. DLL
  injection, game-memory access and runtime hooks remain prohibited.
- **AI explains/advises; it does not invent privileged mutations or own the action allowlist.**
- **Security/system settings are owner-gated.** Diagnose read-only unless explicitly authorized.
- **No new network / telemetry / CSP / capability / updater behavior** outside an owner-approved
  Capability Exception record. Issue #91 authorizes Tier 1 design + dark implementation; endpoint,
  signing custody, and arming stay owner-gated.
- **Signed remote rules remain fail-closed.** Private signing keys never enter repo, `.env*`, or CI.

## Product laws that must not be diluted

From `docs/PRODUCT_CONSTITUTION.md`:

- **The user chooses the destination. Compy handles the technical route, proves the result, explains
  the tradeoffs, and never hides the way back.**
- **Compy optimizes outcomes, not settings.**
- **MAKE THIS PC BETTER** and **FIGURE OUT WHAT WENT WRONG** are equal flagship journeys through the
  same machine model, evidence, history, Trial, and rollback system.
- Users choose understandable outcomes and risk tolerance; Compy translates them into candidates.
- Average FPS alone is not sufficient optimization evidence.
- A null result is valid; no measurable benefit beyond credible noise means the default wins unless
  another explicit reason justifies keeping the change.
- Optimize for the smallest validated configuration that best serves the chosen outcome, not tweak
  count or process count.
- Simple outside, deep inside: progressive disclosure, not duplicated beginner/expert products.
- User freedom does not obligate Compy to automate unsupported or indefensible operations.

## Repo location and collision discipline

The canonical Windows checkout is commonly named `sentinel`, while the product is Compy. Always
resolve the active repo root with `git rev-parse --show-toplevel`; never assume a hardcoded path.

Before mutation, re-derive repository, remote head, linked claim, worktree, branch, dirty state,
relevant live processes, and exact write scope. Never reset, stash, discard, force, delete, or kill
unknown work to make a lease convenient.

A separate worktree/clone is mandatory for each active writer. One folder has one writer. Overlapping
scopes serialize. Unknown scope/folder/process ownership means locked until measured.

## Collaboration style

Owner is Kuya. Lead with current verified truth, challenge weak assumptions, recommend one default
when a fork can be resolved, distinguish verified/inferred/unknown/blocked/owner-only, and keep native
records synchronized. Product changes are framed in user impact first, implementation detail second.
