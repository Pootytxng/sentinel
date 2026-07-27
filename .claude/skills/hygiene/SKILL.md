---
name: hygiene
description: Repo + machine maintenance sweep - doc budgets, stale-process and untracked-file WARNs, process-kill safety. Fires on "maintenance", "cleanup", "hygiene", stale-state or bloat suspicion.
---

# hygiene - standing maintenance sweep

Run: powershell -NoProfile -File scripts/repo-hygiene.ps1  (calls doc-budget, then WARN-only checks).

Act on WARNs:
- Budget FAIL -> MOVE history/log sections to docs/archive/ (append at top, leave pointer). Never delete.
- Untracked under docs/ -> commit it or gitignore it; nothing lives in limbo past 7 days.
- Dirty tree >24h -> commit or revert; stale working copies caused false state reads before.

PROCESS-KILL SAFETY (2026-07-22 - learned by severing our own bridge):
the process name "claude" matches BOTH the Claude Code CLI and the Claude DESKTOP APP
(Claude.exe under \AppData\Local\AnthropicClaude\) which hosts the Cowork device bridge.
- Resolve the standalone CLI with `Get-Command claude`, then compare normalized executable paths
  case-insensitively; only an exact match is Claude Code CLI.
- Skip every other `claude.exe`, including anything under `\AppData\Local\AnthropicClaude\`.
- Never kill the newest CLI session; leave node / node_repl / compy alone (Desktop Commander
  and dev servers live there).
- A process you cannot attribute is a process you report, not one you kill.

Weekly automation already exists: Cowork routine "Sentinel weekly token/doc budget sweep"
(Mon 6 AM PT) runs this same script. Extend that routine - never build a parallel monitor.
