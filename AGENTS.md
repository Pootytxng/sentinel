# AGENTS.md — Codex control file for the Compy repo

> **Codex auto-loads this file.** It is deliberately short. Product direction is not duplicated here.
> Read the authority stack below before making or recommending changes. Treat identifiers and status
> claims as point-in-time; re-derive current native state before asserting them.

## Authority stack

These files own different domains of truth. Do not collapse them into one hierarchy.

1. **`docs/PRODUCT_CONSTITUTION.md` — SUPREME PRODUCT AUTHORITY**
   - what Compy is;
   - the two flagship journeys;
   - outcome-first UX and optimization doctrine;
   - product strategy, priorities, anti-goals, and user promise.
   - If an older roadmap, doctrine, PRD, issue, spec, marketing note, or agent instruction conflicts
     on product direction, the Constitution wins.

2. **`docs/ARCHITECTURE_LOCKS.md` — SAFETY / ARCHITECTURE AUTHORITY**
   - rollback and mutation boundaries;
   - privilege/security rules;
   - immutable formats and operating constraints;
   - capability/network restrictions.
   - Product ambition never silently weakens these locks.

3. **`docs/RELEASE_STATE.md` — CURRENT IMPLEMENTATION / RELEASE AUTHORITY**
   - what is built, armed, installed, verified, or blocked right now.
   - Product intent never changes current-state truth by proclamation.

4. **`docs/WORK_CONTROL.md` — EXECUTION OWNERSHIP AUTHORITY**
   - active claims, scopes, writers, proof-bound transitions.
   - Product priority never grants write ownership by itself.

5. **`docs/product/ROADMAP.md` — DERIVED EXECUTION SEQUENCE**
   - must conform to the Constitution and current release/safety truth.

6. **`docs/BACKLOG.md` — LIVING WORK LEDGER**
   - tracks execution status only; it is not a source of product philosophy.

## Product boot rule

Before product design, prioritization, UX, feature, marketing, monetization, or roadmap work:

1. read `docs/PRODUCT_CONSTITUTION.md`;
2. read the relevant derived file under `docs/product/`;
3. read `docs/ARCHITECTURE_LOCKS.md` for safety constraints;
4. read `docs/RELEASE_STATE.md` for current truth;
5. read `docs/WORK_CONTROL.md` before any write.

`docs/RECEIPTS_DOCTRINE.md`, historical PRDs, old Product Direction documents, archived roadmaps,
and pre-rebirth strategy specs are historical evidence only. They never outrank the Constitution.

## Role specialization and exclusive implementation ownership

These are defaults, not permanent tool prohibitions:

- **Claude Code is the default implementation owner** for edits, builds, tests, Git, and the silent
  reinstall after a build.
- **Codex is the default independent reviewer** for audit, architecture, adversarial testing, drift,
  and second-opinion work; absent an explicit handoff, Codex stays read-only.
- Either model may become the sole implementation writer only through an explicit handoff in the
  current task and linked issue.
- Before a proof-dependent GitHub mutation, follow `docs/WORK_CONTROL.md` and run the required gate;
  inability to run a required gate is a blocker, never a pass.
- The owner controls fleet-visible publication/distribution, secrets/signing custody, security/system
  settings, destructive Git, paid services, and material telemetry/network/updater policy changes.

## Hard constraints that bind even an advisor

Read the full locks before proposing implementation. At minimum:

- **No fabricated or unmeasured claims.**
- **Rollback-first integrity.** A change Compy applies must retain a durable restoration path under
  the architecture rules that govern that capability.
- **No third-party game/process injection.**
- **No vulnerable-driver shortcut or generic physical-memory/MSR/PCI/device-register surface.**
- **AI explains and advises; it never invents privileged mutations or owns the action allowlist.**
- **Security/system settings are owner-gated.** Diagnose read-only unless explicitly authorized.
- **New outbound/network/capability behavior requires the named review/consent boundary.**
- **Signed remote rules remain fail-closed.** Private signing keys never enter repo, `.env*`, or CI.

## Product laws that must not be diluted

From `docs/PRODUCT_CONSTITUTION.md`:

- **The user chooses the destination. Compy handles the technical route, proves the result,
  explains the tradeoffs, and never hides the way back.**
- **Compy optimizes outcomes, not settings.**
- **MAKE THIS PC BETTER** and **FIGURE OUT WHAT WENT WRONG** are equal flagship journeys through the
  same machine model, evidence, history, trial, and rollback system.
- The user should choose understandable outcomes and risk tolerance; Compy translates them into
  technical candidates.
- Average FPS alone is not sufficient optimization evidence.
- A null result is a valid result; no measurable benefit means the default wins unless another
  explicit reason justifies keeping the change.
- The target is the smallest validated configuration that best serves the user's chosen outcome,
  not the largest tweak count.
- Simple outside, deep inside: progressive disclosure, not duplicated beginner/expert products.
- User freedom does not obligate Compy to automate unsupported or indefensible operations.

## Repo location

The canonical Windows checkout is commonly named `sentinel`, while the product is Compy. Always
resolve the active repo root with `git rev-parse --show-toplevel`; never assume a hardcoded path.

## Collaboration style

Owner is Kuya. Use facts over reassurance, challenge weak assumptions, recommend one default when a
fork can be resolved, and distinguish verified state from inference. Product changes should be framed
in user impact first, implementation detail second.
