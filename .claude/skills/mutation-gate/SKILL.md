---
name: mutation-gate
description: >-
  Use before writing OR committing any diff that touches src-tauri/src/actions.rs or history.rs — the
  ONLY Windows-mutation + rollback boundary. Triggers: adding an AppliedAction/RollbackAction/Snapshot
  variant; editing any apply_*/rollback_*_typed/dispatch_rollback/resolve_rollback/synthesize_legacy_rollback;
  touching run_elevated_powershell or elevation flow; flipping/arming/darkening any *_gate(); adding a
  mutating command. This is the highest-stakes surface in the repo — one silent contract break is a
  "users-can't-rollback" class incident.
---

# Mutation Gate — the rollback-first contract, mechanized

No mutation-boundary diff is "done" until every item below carries one evidence line. This encodes
`docs/ARCHITECTURE_LOCKS.md` §1 + §2 and the LOCKED rules as a pre-commit gate instead of doctrine
you have to remember. Any model can run this checklist; the judgment is already in it.

## The contract (10 items, each needs evidence)

1. **Additive-only enums.** `AppliedAction` / `RollbackAction` / `Snapshot` / `AppliedChange` fields:
   new variants/fields only (new fields `#[serde(default)]`), never rename/remove/reorder semantics.
   Retired recs keep their dispatch handlers forever — historical history.json entries must still roll back.
2. **Full contract captured AT APPLY.** The apply path stores `applied_action` + `rollback_action` +
   `snapshot` (prior machine state) inside `AppliedChange` at apply time. Nothing is derived later.
3. **Rollback resolves from history.json ALONE.** `resolve_rollback` never consults the live catalog
   (`Vec<Recommendation>`). A removed/renamed/deprecated rec stays undoable. (history.rs → `actions::resolve_rollback`.)
4. **`dispatch_rollback` totality.** Every `RollbackAction` variant handled; garbled/mismatched snapshot
   = loud `Err`, never a silent skip-and-continue (guard test exists: `resolve_rollback_rejects_garbled_typed_snapshot`).
5. **Typed allowlist only.** No generic dispatchers (`registry-set` / `service-set` / `powershell-run`
   kinds are forbidden). Unknown enum variants, fields, services, parameters → loud parse rejection.
   Every privileged operation enumerable by reading the Rust source.
6. **Elevation discipline.** Elevation only via the existing `run_elevated_powershell` / `--run-elevated`
   relaunch path; 4-way honest UAC outcome attribution preserved (`elevation_outcome`); UAC-cancel ⇒
   ZERO partial mutation (all-or-nothing per action). PowerShell args pass `ps_safe`/`ps_safe_squoted`.
7. **New mutating capability ships DARK.** Gate fn hard-returns `false`; the command refuses while dark;
   FE renders nothing (test-pinned, like `preload_removal_gate`). Arming = live QA + owner sign-off —
   a deliberate, reviewable commit, never a side effect.
8. **Tests before done.** `cargo test --manifest-path src-tauri/Cargo.toml` + clippy clean. New
   variant ⇒ new guard tests: apply→rollback exact-restore round trip · unknown-input rejection ·
   no-partial-on-cancel. Test count must go UP.
9. **Security/system settings are owner territory.** UAC keys, Defender, firewall, anything under
   `Policies\System`: welfare-check FIRST, never flip solo — not to diagnose, not reversibly
   (precedent 2026-06-10). Read-only probes only.
10. **Frozen catalog.** No new risky tweaks; the optimizer-rot blocklist (timer/HPET, bcdedit, MMCSS,
    NIC-offload packs, core parking, Defender disable, MPO, fixed pagefile, TCP mega-packs, AI-generated
    actions) is absolute. Product grows upward (advisory/measurement), not sideways into switches.

## Required dispatches (not optional)

- **`rust-tauri-reviewer` subagent on the full diff** (it pins sonnet). Its verdict block goes in your report.
- **Flag the train for a Cowork-lane adversarial audit** — mutation/rollback diffs are high-stakes
  class #1 in `docs/COWORK_HANDOFF.md` audit routing. Say so in the report; don't wait to be asked.
- **Doc-sync in the SAME commit** for any gate/state change: RELEASE_STATE.md row with fresh
  `file:line` (then run `.claude/skills/gate-drift-audit` if code moved).

## Report block (license to claim done)

```
MUTATION-GATE: 10/10 PASS
  <item n>: <one evidence line each>
reviewer: <rust-tauri-reviewer verdict line>
docs: RELEASE_STATE row updated @ <commit> · cowork audit flagged: <yes/n-a>
```

A FAIL on any item = fix or welfare-check the owner. There is no "minor" contract break on this file.
