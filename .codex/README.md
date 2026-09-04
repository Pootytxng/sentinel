# .codex/config.toml - what it is, why it has exactly this shape

This file is the prose that used to live in the header of `config.toml`. It moved here on
2026-09-04 (#196) because comments cannot survive in that file any more - see "Why this exact
shape" below. Do not add a comment line to `config.toml`; put it here instead.

## 1. The file IS loaded, and it is the advisory lane's floor

Current Codex reads a project-scoped `.codex/config.toml` whenever the repository is trusted, and
this repo is `trust_level = "trusted"` in the global `%USERPROFILE%\.codex\config.toml`. The keys
are LIVE for ordinary runs started here, not portable scaffolding. (An older header claimed the
opposite - "NOT LOADED BY DEFAULT ... only when CODEX_HOME points at this directory" - which was
true of codex-cli 0.146.0 on 2026-08-18 and is not true now.)

Codex's role in this repo is READ-ONLY audit and advice (AGENTS.md lane split), so the config
refuses writes and refuses to prompt for escalation rather than granting a bypass:

- `sandbox_mode = "read-only"` - the filesystem/exec sandbox rejects writes and escalations.
- `approval_policy = "never"` - no interactive approval prompts; combined with read-only, an
  action the sandbox forbids is DENIED, not surfaced as an approve/deny prompt.

Both are bare top-level keys and MUST precede the first `[table]` header (TOML rule). Below a
header they silently become that table's keys and the top-level setting is gone.

CONSEQUENCE, stated honestly: read-only + never is FILE-READING ONLY. Codex never asks to run a
command, so any COMMAND-based check is denied outright - it does not pause for approval, it just
fails. In this default lane the custom agents' command steps are UNAVAILABLE, not merely
unattended: frontend-ipc-contract-auditor's `tsc --noEmit`, self-reviewer's CDP capture/eval and
web-design-director's headless-Chrome capture cannot run here. Those agents degrade to
source-only reasoning and MUST say so rather than claim a check they could not execute.

To actually RUN those checks, an owner-approved VERIFICATION lane is launched SEPARATELY - it is
NOT switchable from this file. A project-local `.codex/config.toml` cannot define OR select a
named profile: Codex profiles live under `$CODEX_HOME` as `profile-name.config.toml` and are
chosen with `codex --profile <name>`. The safer near-no-prompt verification starting point is
`read-only` + `approval_policy = "on-request"` + `approvals_reviewer = "auto_review"` (commands
surface for auto-review instead of an unrestricted bypass); a write-capable step additionally
needs `--sandbox workspace-write`. The safe default stays read-only/never for every other run.

## 2. Why this exact shape (the import sync)

The Codex desktop app's external-agent import sync rewrites `<repo>/.codex/config.toml`
deterministically: it re-serializes the tracked TOML, DROPPING EVERY COMMENT LINE, and adds

- `[shell_environment_policy.set]`, copied from the `env` block of `.claude/settings.json`;
- `[mcp_servers.shadcn]`, copied from `.mcp.json`.

Two earlier attempts to hold a different shape did not survive it (the 2026-07-19 hardening was
reverted byte for byte in two lanes' working trees; the 2026-08-24 global toggle
`external-agent-import-sync-enabled = false` did not hold either). So since 2026-09-04 the tracked
file IS the sync's output, byte for byte, which makes the rewrite a no-op. That has consequences:

- NO comment may be added to `config.toml` - the sync strips them, so the next rewrite would show
  as a diff. Prose belongs in this README.
- The `CLAUDE_CODE_*` keys under `[shell_environment_policy.set]` are NO-OPS for Codex. They are
  Claude Code env-var names and configure nothing here; they exist only because the sync copies
  them from `.claude/settings.json`, and they must stay equal to that file's `env` block.
- `[mcp_servers.shadcn]` must stay pinned to exactly the `package@version` `.mcp.json` pins
  (`shadcn@4.19.0` today). Never `@latest`: the sync copies whatever `.mcp.json` says, so the pin
  is enforced at the source by `scripts/mcp-config-guard.test.mjs` and at the copy by
  `scripts/codex-config-guard.test.mjs`.

`scripts/codex-config-guard.test.mjs` pins all of this: the read-only/never floor as top-level
keys, no `@latest`, the shadcn pin equal to `.mcp.json`, the env table equal to
`.claude/settings.json`, no comment lines, nothing under `[shell_environment_policy]` but
`inherit = "core"`, and this README's existence.

## 3. Layering

Per the openai/codex config loader: in a trusted repo the project `.codex/config.toml` overrides
the user-level `~/.codex/config.toml`; runtime flags (`-c key=value`, `--sandbox`, `--profile`)
and the app's UI selector override both. So the floor here is the default for runs started in
this checkout, and a single run can still be launched above it on purpose.

## 4. History

- 2026-07-19 - lane hardening: `[mcp_servers.*]` and the `CLAUDE_CODE_*` keys removed, floor kept.
- 2026-08-24 - header rewritten to say the file IS loaded; global import-sync toggle set to
  false as the causal fix. It did not hold - the sync kept rewriting the file.
- 2026-09-04 - sync-immune shape (#196): the tracked file is the sync's exact output, comments
  moved here, guard re-pinned to the new shape.
