---
name: compy-coverage-sweep
description: >-
  Use whenever the user wants to expand, add, improve, or "sweep" automated test coverage in
  the Compy (sentinel) repo — especially adding unit tests for untested PURE-LOGIC modules
  (TypeScript helpers under src/data and src/surfaces, and pure Rust parsers under
  src-tauri/src). Trigger on phrases like "add tests", "improve/expand coverage", "test the
  untested modules", "coverage sweep", "what isn't tested?", or when the user points at a
  specific helper module and asks for tests. Runs a parallel-subagent authoring workflow with
  a three-ring verification gate. Do NOT use it to test hardware IO / FFI surfaces
  (monitoring, sensors, tray) or to change production code — it writes tests only.
version: 0.1.0
---

# Codex adapter

Before acting, read `../../../.claude/skills/compy-coverage-sweep/SKILL.md` completely.

Authority order: `docs/RELEASE_STATE.md` owns current state; `CLAUDE.md` owns standing product law; `AGENTS.md` adds only the Codex-lane overlay. Provider authority does not transfer: Codex remains read-only audit and advice unless the owner explicitly requests a specific write action in this turn.
