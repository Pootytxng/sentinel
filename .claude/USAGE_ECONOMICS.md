# Usage economics — subagent, workflow, session, and self-review rules

> Owner directive 2026-07-02, from a usage-source audit. This is the **versioned, in-repo mirror**
> of the local memory `usage-economics-subagent-session-rules` (machine-pinned under `~/.claude/
> projects/.../memory/`) so the rules survive any machine/launch-path change — same reason
> CLAUDE.md exists in git. The two must be kept in sync; on conflict the newer owner directive wins.
>
> The audit: 72% of burn came from sessions above 150k context; 53% from subagent-heavy sessions;
> the Workflow tool alone was 22%; /self-review passes 13%. The burn is structural — long sessions
> and uncontrolled subagents, not the work itself. Extends the token-awareness governance rule
> (the 2026-06-25 lane-fleet burn) from loop structure to session/subagent structure.

## 1. Subagent split

**Main agent = planning + implementation. Subagents = verification, search, review, and risk
checks ONLY.** Worth spawning: audits, repo-wide search, diff review, test/log checks,
requirements comparison, regression hunts, release validation, security review. NEVER spawn for:
small edits, one-file fixes, obvious refactors, formatting, simple bug fixes, explanations, or
anything the main context already covers. Never fan out subagents just to "think harder."

The project reviewer agents are pinned to a cheaper model for this reason
(`.claude/agents/*.md` → `model: sonnet`), as is the self-review rubric
(`.claude/skills/self-review/SKILL.md` → `model: sonnet`). Note: a skill's model override
applies for the REST of the current turn — run /self-review at the checkpoint (its intended
cadence), not mid-build.

## 2. Workflow tool — the biggest named sink

Use it only for genuinely multi-step repo-wide work (the audit/sweep class), never normal edits.
Even when an ultracode session-flag says "use Workflow on every substantive task," this owner
directive OVERRIDES it: default to solo main-agent work; workflows only where separation
genuinely reduces mistakes.

## 3. Session length — the #1 lever

Compact around 80–120k context; avoid working above 150k. Work to a milestone → write a compact
handoff → the owner starts a fresh session and pastes it. Don't keep one giant thread alive
because it "knows everything."

## 4. /self-review at checkpoints, not per-edit

Reconciled with the standing visual-review law (always-self-review-visual-work / bug-becomes-
guard): the law binds before *claiming UI work done / committing / reinstalling* — so batch UI
edits and run ONE self-review pass at that checkpoint (before commit, before build/package,
before handoff, after a risky architectural change), not after every minor file edit or during
exploratory iteration. The PostToolUse hook nudge is a reminder for the checkpoint, not a
per-edit obligation. **Rigor unchanged** — the pass still happens before anything is called done.
