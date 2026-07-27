---
name: usage-audit
description: >-
  Use when the owner asks how Claude usage/tokens/budget is going, for a "usage audit", "token
  audit", "session audit", "are we burning too much", or when the weekly scheduled report
  (docs/usage-audit/LATEST.md) shows a 🔴 flag. Audits the recent session transcripts mechanically
  (zero LLM tokens) and interprets the health flags against the standing usage laws.
---

# Codex adapter

Before acting, read `../../../.claude/skills/usage-audit/SKILL.md` completely. Inspect `~/.claude/projects`, not a fabricated Codex project store.

Authority order: `docs/RELEASE_STATE.md` owns current state; `CLAUDE.md` owns standing product law; `AGENTS.md` adds only the Codex-lane overlay. Provider authority does not transfer: Codex remains read-only audit and advice unless the owner explicitly requests a specific write action in this turn.
