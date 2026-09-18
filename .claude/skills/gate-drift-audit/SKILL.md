---
name: gate-drift-audit
description: >-
  Use to verify docs/RELEASE_STATE.md still tells the truth — the standing state-drift audit (the
  project's #1 named risk). Triggers: after any refactor/train that moved code in files RELEASE_STATE
  cites; before asserting current gate state to the owner; before/after a ship; periodically ("audit
  state", "is RELEASE_STATE current", "drift check"); after editing lib.rs/actions.rs/remote_rules.rs/
  receipts.rs/license.rs/leftovers.rs.
---

# Gate-Drift Audit — RELEASE_STATE.md vs reality, two layers

RELEASE_STATE.md wins every current-state disagreement — which only works if IT is verified against
code, not asserted from memory. Drift was flagged by an external audit as risk #1; citations have
already drifted in practice (c056fee re-anchored one the same day it moved). Two layers:

## Layer 1 — mechanical citation check (no LLM judgment needed)

```
node scripts/verify-release-state.mjs          # NEAR (≤40-line drift) warns
node scripts/verify-release-state.mjs --strict # NEAR also fails
```

Parses every backticked `path:line` citation, resolves the file, checks the bound symbol
(`gaming_mode_gate()` — `lib.rs:500` style) still lives at/near the cited line. Verdicts:
**OK / OK-FILE** anchored · **NEAR** re-anchor (it prints the actual line) · **DRIFT / GONE /
LINE-OOB / MISSING-FILE** broken, exit 1.

Fix-forward rule: re-anchor citations in the SAME commit as whatever moved them. If you're the one
about to move cited code, update the row in that commit — don't leave it for the audit to catch.

## Layer 2 — truth check (script checks LOCATION, not VALUES)

A gate can flip value while its line number stays valid. For each **Gate matrix** row, re-read the
gate function body at source and compare against the row's State column:

- `gaming_mode_gate()` · `service_suspend_gate()` · `bloat_removal_gate()` · `preload_removal_gate()`
  · `restore_gate()` · `receipts_gate()` · `licensing_armed()` · `remote_fetch_enabled()`
  · `benchmark_trial::stack_trial_gate()` (§2a aggregate-stack A/B — DARK) — does the returned value
  match LIVE/ARMED/DARK/OFF as printed?
- Outbound-network row: still no HTTP client in `Cargo.toml`, CSP still `connect-src 'self' ipc:`?
- Updater row: do the dependency, config and capability lines it cites still say what the row
  claims? Take the claim from the row itself, never from a remembered value.

**Dispatch layer 2 to a sonnet subagent** (read-only: Read/Grep) and have it return one line per row:
`<gate> · cited <state> · source says <state> · MATCH/MISMATCH (file:line)`. Do not paste function
bodies back into the orchestrator.

## On MISMATCH

That's not a doc fix — it means either an unrecorded gate flip (find the commit, reconstruct why,
tell the owner) or the doc recorded intent that never shipped. Never silently edit the row to match
code: a gate that flipped without a RELEASE_STATE row in the same commit is itself a process breach
worth reporting. LOCKED gates (remote fetch, signing keys, frozen beta refs) mismatching = stop and
welfare-check immediately.

## Report

```
GATE-DRIFT: layer1 <n> citations — <ok>/<near>/<broken> · layer2 <n> gates — <match>/<MISMATCH list>
fixes: <re-anchors committed, or none needed> · flags: <mismatches → owner>
```
