---
name: gate-drift-audit
description: >-
  Use to verify docs/RELEASE_STATE.md still tells the truth — the standing state-drift audit (the
  project's #1 named risk). Triggers: after any refactor/train that moved code in files RELEASE_STATE
  cites; before asserting current gate state to the owner; before/after a ship; periodically ("audit
  state", "is RELEASE_STATE current", "drift check"); after editing lib.rs/actions.rs/remote_rules.rs/
  receipts.rs/license.rs/leftovers.rs.
---

# Codex adapter

Before acting, read `../../../.claude/skills/gate-drift-audit/SKILL.md` completely.

Authority order: `docs/RELEASE_STATE.md` owns current state; `CLAUDE.md` owns standing product law; `AGENTS.md` adds only the Codex-lane overlay. Provider authority does not transfer: Codex remains read-only audit and advice unless the owner explicitly requests a specific write action in this turn.
