# Compy Tool-Shed Hygiene Implementation Plan

> **For Codex:** Execute this plan with `superpowers:subagent-driven-development`.

**Goal:** Replace the unsafe ignored Codex skill mirror with a small tracked adapter layer, make
repository hygiene checks prove the relevant invariants, and retire stale project documents without
changing Compy runtime behavior.

**Architecture:** `.claude/skills/` remains the canonical implementation for project skills.
`.agents/skills/` becomes ten tracked, hand-authored Codex adapters that load those canonical files
while preserving the authority split in `CLAUDE.md` and `AGENTS.md`. Lightweight Node/PowerShell
guards catch broken Markdown links and distinguish the standalone Claude CLI from desktop processes.
Historical plans remain available under `docs/archive/`, with short live pointers in active docs.

**Tech stack:** Markdown, PowerShell, Node.js, Git.

## Global constraints

- Work only in `C:\Users\Kuya\code\sentinel-codex-hygiene` on
  `codex/tool-shed-hygiene`, based on `origin/main` commit `20306bc`.
- Do not touch `src/`, `src-tauri/`, package manifests, capabilities, updater behavior, installers,
  release gates, signing, networking, telemetry, Windows settings, or user credentials.
- `docs/RELEASE_STATE.md` owns current gate/build state; `CLAUDE.md` owns standing product law;
  `AGENTS.md` adds the Codex-lane overlay. Loading a skill never transfers Claude Code's normal
  build/write/ship authority to Codex.
- Preserve history: archive superseded documents; do not delete their content.
- Use `apply_patch` for edits. Commit each task separately. Never push, merge, tag, publish, or
  install.

### Task 1: Replace the ignored mirror with tracked Codex adapters

**Files:**

- Modify: `.gitignore`
- Create: `.agents/skills/{compy-coverage-sweep,doc-sync,gate-drift-audit,guard-forge,hygiene,impeccable,mutation-gate,self-review,ship,usage-audit}/SKILL.md`
- Modify: `.claude/skills/INDEX.md`

**Steps:**

1. Remove the complete root `/.agents/` ignore/comment block from `.gitignore`.
2. Add exactly ten concise adapters, one per canonical skill directory. Each adapter must keep valid
   YAML frontmatter, direct Codex to read `../../../.claude/skills/<name>/SKILL.md` completely before
   acting, state the three-file authority order above, and explicitly say that provider authority
   does not transfer.
3. Add only these special notes where relevant:
   - `usage-audit`: audit `~/.claude/projects`, not a fabricated Codex project store.
   - `self-review`: dispatch the registered Codex `self-reviewer` role backed by
     `.codex/agents/self-reviewer.toml`.
   - `ship`: audit-only for Codex unless the owner explicitly requests that exact write/build action.
   - `impeccable`: use the canonical `.claude/skills/impeccable/scripts/`; do not duplicate support
     files.
4. Update the live-skills index with a short Codex-adapter note.
5. Verify the Claude/Codex skill-name sets are identical, exactly ten adapter `SKILL.md` files are
   tracked, no provider-replacement residue remains, and `git diff --check` passes.
6. Commit as `chore(codex): replace broken skill mirror with adapters`.

### Task 2: Harden repository hygiene checks

**Files:**

- Modify: `.claude/USAGE_ECONOMICS.md`
- Modify: `.claude/skills/hygiene/SKILL.md`
- Modify: `scripts/repo-hygiene.ps1`
- Create: `scripts/markdown-link-guard.mjs`
- Modify: `docs/archive/Roadmap.md`
- Modify: `docs/archive/cowork-cc-relay/2026-06-15-funnel-golive-todo.cc.md`

**Steps:**

1. Remove the stale claim that the empirically confirmed `Workflow` matcher was only a guess and was
   deliberately not built. Preserve the verified description of the live hook.
2. In both hygiene instructions and the PowerShell script, resolve the standalone CLI with
   `Get-Command claude`. A process counts as Claude CLI only when its executable path exactly equals
   the resolved CLI executable path; every other `claude.exe` is skipped. Do not kill or alter any
   process while implementing or testing.
3. Add a dependency-free Node guard that enumerates tracked Markdown files, validates relative
   Markdown link targets (including anchors only as file existence, not heading semantics), ignores
   web/mail/data links and image fragments appropriately, reports every broken target, and exits
   nonzero on failure.
4. Call that guard from `scripts/repo-hygiene.ps1`.
5. Fix the five relative targets in `docs/archive/Roadmap.md` by prepending `../`, and correct the
   nested relay target to `../../../src/data/site.ts`.
6. Prove red-to-green for the link guard by recording that it fails on the six original broken links,
   then passes after the link fixes. Run `scripts/repo-hygiene.ps1`, the strict release-state verifier,
   the Codex hook self-test, and `git diff --check`.
7. Commit as `chore(hygiene): guard links and process ownership`.

### Task 3: Retire stale active documents without losing history

**Files:**

- Modify: `COMPY_OVERVIEW.md`
- Create: `docs/archive/PACKAGING_SIGNING_PLAN_LEGACY.md`
- Replace: `docs/PACKAGING_SIGNING_PLAN.md`
- Create: `docs/archive/UI_SPEC_INITIAL_CONCEPT.md`
- Delete: `ui-spec.md`
- Modify: the one tracked document that links to `ui-spec.md`

**Steps:**

1. Correct `COMPY_OVERVIEW.md` so it does not claim zero outbound behavior, categorical CPU
   temperature unavailability, NVIDIA validation beyond live evidence, an unsent beta, a disabled
   updater, or the retired separate recovery-store design. Keep it an overview and point volatile
   details to canonical state docs.
2. Preserve the complete old packaging/signing plan in the archive with a conspicuous historical
   warning. Replace the active file with a short pointer describing the owner-held signing gate and
   directing live-state readers to `docs/RELEASE_STATE.md` and owner actions to
   `docs/OWNER_ACTION_CHECKLIST.md`.
3. Move the initial `ui-spec.md` content to `docs/archive/UI_SPEC_INITIAL_CONCEPT.md`, prepend a
   historical warning explaining that its stack/layout is not authoritative, and update its one
   inbound reference.
4. Run the Markdown link guard, repo hygiene, strict release-state verifier, Codex hook self-test,
   document budgets, and `git diff --check`.
5. Commit as `docs: archive superseded Compy plans`.

### Final branch verification

Run:

```powershell
git diff --check origin/main...HEAD
node scripts/markdown-link-guard.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/repo-hygiene.ps1
node scripts/verify-release-state.mjs --strict
node .codex/hooks/hooks-selftest.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/doc-budget.ps1
git status --short --branch
```

Then request a whole-branch review. Do not merge or push while hosted GitHub Actions cannot start.
