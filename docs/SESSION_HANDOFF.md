# Session Handoff

> **REPLACE this file's content every time you write it — never append.** It holds only the
> *current* lane's state, not a log. One lane at a time. When the lane lands (merged + branch
> deleted), clear this file back to the template below in the same commit.
>
> Written by `.claude/hooks/context-size-advisor.mjs` when it detects context-thrash (fast
> drop→refill cycles with no real headroom gained — see `scripts/lib/context-thrash.mjs`), and by
> any session that sees its own context filling fast. Read this FIRST on a fresh session that
> mentions "continue" or "resume" with no other lead. Budget: 120 lines
> (`scripts/doc-budget.ps1`) — if you're about to blow it, cut detail, don't skip the write.

## Lane

- **Worktree:** `C:\Users\Kuya\code\sentinel\.claude\worktrees\compy-next-phase-1f6a80`
- **Branch:** `claude/context-thrash-fix-1f6a80` — tracking `origin/main`
- **Started:** 2026-08-07

## What this lane is doing

The owner kept hitting "context full, please rewind/compact/move to a new session" mid-workflow.
Root cause: the old advisor only warned at 85% of the 150k-token window, but this session's
context was almost entirely fixed per-turn payload (system prompt, docs, tool listings), so
compaction reclaimed nothing and refilled instantly, before the 85% line was ever crossed. Fix
detects refill *velocity* (fast drop→rebound cycles), not absolute size, and writes this file
itself so the next session can resume cold.

## Done so far

- `scripts/lib/context-thrash.mjs` — pure-arithmetic thrash detector (`detectThrash`,
  `describeThrash`, `appendSeries`). Confirmed correct on disk, no edit needed.
- `scripts/context-thrash-guard.test.mjs` — 13 tests, subprocess-drives the hook. HOOK path
  derivation confirmed correct on disk, no edit needed.
- `.claude/hooks/context-size-advisor.mjs` — fixed a real bug: `if (!ctx) process.exit(0)`
  discarded a legitimate `ctx === 0` measurement (e.g. right after `/clear`), which is exactly the
  signature `detectThrash` needs to see twice to fire. Replaced with a `found` flag distinct from
  `ctx`'s value. All 13 tests in the guard suite now pass.

## Left to do

1. Add `"docs/SESSION_HANDOFF.md" = 120` to `$budgets` in `scripts/doc-budget.ps1`.
2. Targeted vitest: `context-thrash-guard.test.mjs`, `compaction-window-guard.test.mjs`,
   `src/agent-machinery-guard.test.ts`. Also check `tools/entry/tracked-hooks.test.mjs` and
   `tools/entry/hooks-verify.test.mjs` (they reference this hook).
3. Full `npx vitest run` — baseline 304 files / 3894 tests, expect +1 file / +13 tests.
4. `npx tsc --noEmit` (never piped through `tail`).
5. `pwsh -NoProfile -Command "& .\scripts\doc-budget.ps1"` — expect `ALL PASS`.
6. Commit all of: `.claude/hooks/context-size-advisor.mjs`, `scripts/context-thrash-guard.test.mjs`,
   `scripts/lib/context-thrash.mjs`, `docs/SESSION_HANDOFF.md`, `scripts/doc-budget.ps1` — ONE
   commit. Push, open PR, add a `docs/BRANCH_DISPOSITIONS.md` row (separate commit+push),
   `gh pr merge <n> --squash --repo Pootytxng/sentinel`, delete the remote branch, `git fetch
   origin --prune`, `node scripts/branch-disposition-audit.mjs`.
7. Clear this file back to the blank template in the same commit the PR merges.

## Do NOT

- Do not change `CLAUDE_CODE_AUTO_COMPACT_WINDOW` or the coupled 150,000-token threshold
  (`scripts/lib/compaction-window.mjs:24`, `scripts/compaction-window-guard.test.mjs:85`,
  `.claude/settings.json:5`, the advisor's own `|| 150_000` fallback) — window size isn't the bug,
  refill velocity is.
- Do not add a CLAUDE.md pointer for this file.
- Do not write a guessed `enabledPlugins` key for Intercom anywhere.

## Resume with

Run the targeted vitest pass (Left-to-do #2), then continue down the list in order.
