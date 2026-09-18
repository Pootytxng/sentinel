---
name: doc-sync
description: >-
  Use whenever project STATE changes or docs disagree. Triggers: flipping/arming/darkening any gate;
  rebuilding/installing the app; closing or opening a release blocker; changing a standing law or
  working rule; noticing ANY two docs disagree about current state; finishing a train that touched
  gate functions or shipped an installer. Prevents the state/doc drift an external audit named the
  project's #1 risk.
---

# Doc-Sync — which doc, what order, same commit

State lives in exactly one place; everything else points at it. When they disagree, precedence is:
**RELEASE_STATE.md wins current state · PRODUCT_CONSTITUTION.md wins product truth ·
ARCHITECTURE_LOCKS.md wins safety · WORK_CONTROL.md wins ownership · CLAUDE.md is bootstrap, not law ·
code wins over any doc claim about what is built** (a code/doc mismatch is a finding to report, not
silently patch — see gate-drift-audit).

## The update order (same commit as the change wherever possible)

1. **`docs/RELEASE_STATE.md`** — in the SAME commit that flips any gate, arms any feature, or
   rebuilds the installer. Gate rows carry `state · gate_fn() — file:line · notes`; the Snapshot row
   carries installer SHA-256 + built-from commit + verify line + supersedes chain. Never assert a row
   from memory — cite the line you just read.
2. **`docs/BACKLOG.md`** — steering-log entry, newest-on-top, for what the cycle did and what it
   unblocks/gates. Item markers: `[x]` done · `[~]` partial · `[ ]` open · `[⛔]`/🪪/📡 gated.
3. **`docs/CHANGELOG.md`** — dated stratum for what would once have been a CLAUDE.md state banner.
   Point-in-time records; they are never "fixed" retroactively, they accumulate.
4. **The doc that owns the law** — ONLY when a standing law/working rule changes: product law →
   `docs/PRODUCT_CONSTITUTION.md`; a safety rule or new gate class → `docs/ARCHITECTURE_LOCKS.md`; a
   lane, claim or handoff rule → `docs/WORK_CONTROL.md`. `CLAUDE.md` is bootstrap, not law: where it
   summarizes the changed law, correct the summary in the same commit. Current state goes in none of
   these — that's what drifted before RELEASE_STATE existed.

## Invariants

- A ship without a RELEASE_STATE row is drift **by construction** (see the interim `b0ec87a` installs
  that had to be retro-closed). The `ship` skill ends with the row for this reason.
- Moving code that RELEASE_STATE cites ⇒ re-anchor the citation in the mover's commit
  (`node scripts/verify-release-state.mjs` proves you did).
- **False-done protocol:** no "done" claim without enumerating remaining `[ ]` + gated items in the
  touched area. "Done except X, Y gated on owner" is a valid done; bare "done" over open items is not.
- Legacy strata (CHANGELOG, old banners) are never edited to agree with today — they were true when
  written. Only live docs get corrected.

## Quick self-check before any state-touching report

```
DOC-SYNC: RELEASE_STATE row <updated @ commit / not needed> · BACKLOG log <written / n-a> ·
CHANGELOG stratum <written / n-a> · law doc <untouched / changed: which + CLAUDE.md summary> ·
drift script <exit 0 / findings>
```
