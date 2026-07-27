---
name: self-review
description: >-
  Use when about to claim any visual or UI change in Compy is done, fixed, ready, or "looks good" —
  before reporting it, reinstalling, or shipping. Triggers: edited a .tsx/.css/surface/component and
  about to say it works; captured a screenshot and about to move on; finishing a UI fix the owner
  asked for. Catches illegible text, duplicated UI, broken hover/empty states, and stale wording —
  the things green tests and a quick glance miss.
---

# Codex adapter

Before acting, read `../../../.claude/skills/self-review/SKILL.md` completely. Dispatch the registered Codex role `self-reviewer`, backed by `.codex/agents/self-reviewer.toml`.

Authority order: `docs/RELEASE_STATE.md` owns current state; `CLAUDE.md` owns standing product law; `AGENTS.md` adds only the Codex-lane overlay. Provider authority does not transfer: Codex remains read-only audit and advice unless the owner explicitly requests a specific write action in this turn.
