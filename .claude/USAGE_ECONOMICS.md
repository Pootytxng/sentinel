# Usage economics — subagent, workflow, session, and self-review rules

> Owner directive 2026-07-02, from a usage-source audit. **This file is the single authoritative
> source for every context/token-window number in the repo (2026-07-18 correction).** It used to
> describe itself as a "mirror" of the machine-local memory `usage-economics-subagent-session-rules`
> that "must be kept in sync" — that framing was backwards: a git-tracked doc that travels with the
> repo cannot drift out of sync with a machine-pinned file the same way the machine-pinned file can
> drift from it. **This doc is canonical. The local memory is a cache of it, not a co-equal source.**
> If they ever disagree, this file wins, full stop — no reconciliation needed, no "newer directive"
> judgment call.
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

Compact around 80–120k context; avoid working above 150k. **This is why the auto-compact window
in `.claude/settings.json` is set to 150000, not higher** — it's not a technical ceiling (Opus's
real window is far larger), it's this deliberate quality/cost target: smaller working sets mean
less "lost in the middle" degradation on long threads, on top of the direct token savings.
Refresh is now automatic (§5) — don't manually `/clear`/`/compact` unless the driver prompt says
"NO REFRESH." Don't keep one giant thread alive because it "knows everything"; persist state to
disk (BACKLOG/spec/handoff) instead, per the context-size-advisor hook's own instruction.

## 4. /self-review at checkpoints, not per-edit

Reconciled with the standing visual-review law (always-self-review-visual-work / bug-becomes-
guard): the law binds before *claiming UI work done / committing / reinstalling* — so batch UI
edits and run ONE self-review pass at that checkpoint (before commit, before build/package,
before handoff, after a risky architectural change), not after every minor file edit or during
exploratory iteration. The PostToolUse hook nudge is a reminder for the checkpoint, not a
per-edit obligation. **Rigor unchanged** — the pass still happens before anything is called done.

## 5. The single set of numbers (2026-07-18 reconciliation)

A 2026-07-18 audit found five different context-size numbers scattered across five files with no
file deferring to another. Reconciled here — every other file (hooks, skills, specs) should either
match these exactly or point back to this section rather than restate its own copy:

| Name | Value | Meaning | Lives in |
|---|---|---|---|
| Handoff target | 80–120k | Ideal working range (§3, unchanged) | this doc only |
| Ceiling | 150k | "Avoid working above" (§3, unchanged) | this doc only |
| `CLAUDE_CODE_AUTO_COMPACT_WINDOW` | 150000 | The one literal env-var value; native auto-compact fires at ~92–95% of it (~140k) | `.claude/settings.json` — the ONLY place this literal should be set |
| Advisor warn threshold | 85% of the window above, computed at runtime | When the Stop hook injects a persist-to-disk instruction | `.claude/hooks/context-size-advisor.mjs` — reads the env var, does not hardcode a copy |
| Audit red-flag | 200k peak context | Sanity check only — should never be reached if auto-compact is working; hitting it means compaction failed to fire, not a target to approach | `.claude/skills/usage-audit/SKILL.md`, `scripts/usage-audit.mjs` |
| Autopilot continuation cap | 2 | Hard code clamp (was: unenforced doc convention) on how many tasks autopilot chains in one session, so it can't manufacture a >150k context on its own | `.claude/hooks/stop-continue.mjs` (`MAX_CONTINUES`) |

Unrelated metric that happens to also round to "200k" and should not be confused with the audit
red-flag above: `docs/LANE_WORKFLOW.md`'s **~200k output tokens per shipped burst item** — a
cost-estimation constant for sizing parallel build bursts, nothing to do with context-window size.
