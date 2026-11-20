# AGENTS.md — pointer for Codex and other agents

Read `CLAUDE.md` (same rules for every agent: one writer per scope, the gate, the game rule, stop rules) and `docs/QUEUE.md` (the one work list). Authority: `docs/PRODUCT_CONSTITUTION.md` §38, `docs/ARCHITECTURE_LOCKS.md`, `docs/RELEASE_STATE.md`.

Safety markers kept here for the policy guard (full text in `docs/ARCHITECTURE_LOCKS.md` §1.8):
- Capability Exception Gate; no third-party game/process injection. A Compy-shipped driver is policy-possible only through the named gate; none ships today.
- No new network, telemetry, CSP, capability or updater behavior outside an owner-approved record. Issue #91 authorizes Tier 1 design + dark implementation; endpoint, signing custody and arming stay owner-gated.
