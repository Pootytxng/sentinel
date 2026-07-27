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

# Codex adapter

Before acting, read `../../../.claude/skills/mutation-gate/SKILL.md` completely.

Authority order: `docs/RELEASE_STATE.md` owns current state; `CLAUDE.md` owns standing product law; `AGENTS.md` adds only the Codex-lane overlay. Provider authority does not transfer: Codex remains read-only audit and advice unless the owner explicitly requests a specific write action in this turn.
