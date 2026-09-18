---
name: usage-audit
description: >-
  Use when the owner asks how Claude usage/tokens/budget is going, for a "usage audit", "token
  audit", "session audit", "are we burning too much", or when the weekly scheduled report
  (docs/usage-audit/LATEST.md) shows a 🔴 flag. Audits the recent session transcripts mechanically
  (zero LLM tokens) and interprets the health flags against the standing usage laws.
---

# Usage Audit — session/token discipline, mechanized

The owner tracks no usage himself; the audit IS the meter. Layer 1 is a pure-node script —
never re-derive its numbers by reading transcripts into context (that burns the budget the
audit protects; the 2026-07-13 audit cost was the reason this script exists).

## Layer 1 — mechanical scan (no LLM tokens)

```
node scripts/usage-audit.mjs                 # stdout report, 80 newest sessions
node scripts/usage-audit.mjs --sessions 120  # widen the window
node scripts/usage-audit.mjs --report        # also writes docs/usage-audit/REPORT-<date>.md + LATEST.md
```

Streams every transcript under `~/.claude/projects` (main lanes + subagents), dedupes usage by
message.id, and prints: token totals, avg carried context/turn, per-session peaks, tool mix,
skills, subagent model routing, boot-tax read paths, error classes — plus **health flags**:

- 🔴 sessions whose peak context passed the configured compact window
  (`flagPeakContext()` in `scripts/lib/compaction-window.mjs`) — a sanity-check red-flag, not a
  target: it should never be reached if native auto-compact is working (the owner's actual working
  target is 80–120k). Sessions older than the window setting (2026-08-07) are counted separately,
  not flagged. Cache-read cost per turn scales with carried context, and it is the #1 spend driver.
  The current figures are whatever the script prints; quote them, never a remembered number. The
  law behind these flags is `claude/TOKEN_ECONOMY_LAW.md`, which lives in the Cowork project, not
  on disk; `.claude/USAGE_ECONOMICS.md` is the on-disk stub that points to it.
- 🔴 too little working headroom — the p75 first-turn floor sits so close under the compaction
  ceiling (`usableHeadroom()` against `nativeCompactCeiling()`, same lib) that sessions are
  configured to thrash.
- 🟡 subagents on opus/fable — routing law says cheapest capable model (sonnet default via
  `settings.json`; pre-2026-07-05 runs explain historical hits).
- 🔴/🟢 average carried context per turn as a share of that ceiling; the red line prints its own
  lever order.
- 🟡 doc boot tax in bytes — each doc in the script's `DOC_BYTE_BUDGETS` (`docs/BACKLOG.md`,
  `docs/RELEASE_STATE.md`, `CLAUDE.md`, `docs/OWNER_ACTION_CHECKLIST.md`) over its byte TARGET. This
  flag is not the gate: `CLAUDE.md` is gated by `MAX_BYTES` in `src/claude-md-laws-guard.test.ts`,
  the other three by `$byteBudgets` in `scripts/doc-budget.ps1`. For BACKLOG, archive steering-log
  cycles to `docs/BACKLOG_ARCHIVE.md` per the retention rule at the top of its steering-log section.
- 🟡 build-output bloat, in three classes — a worktree's `src-tauri/target` over ~20 GB; a target
  under that line but **untouched for 14 days** (build output no lane is using); and the **fleet
  total** across every worktree once it passes 40 GB. The middle two exist because the per-tree rule
  alone read green for four days while six trees held 59 GB. All three are REPORT-ONLY: name the
  tree and the `cargo clean` line, never run it. A target directory may hold an in-flight build, and
  which idle worktree is worth clearing is the owner's call.
- 🔴/🟢 per-turn floor step since the previous `docs/usage-audit/REPORT-*.md` — the floor is re-read
  every turn, so a step up taxes every session until it is cut; the line names what to check.
- 🟡 "file not read yet" Edit errors > 1/session — Read before Edit, even for files you knew
  in a prior session.

## Layer 2 — interpretation (this session, terse)

1. Run layer 1. Quote the health-flags block verbatim.
2. For each 🔴/🟡: name the ONE corrective action, referencing the standing law it enforces.
   Fix what is fixable now (e.g. run the BACKLOG archive move yourself); report what is
   behavioral (context handoffs) as a one-line reminder, not a lecture.
3. Compare against the previous `docs/usage-audit/REPORT-*.md` if one exists: are the flags
   improving or worsening? One line.
4. Report format (token law): flags · deltas · actions taken. No raw tables in chat — the
   report file has them.

## Standing calibrations (2026-07-18 — single-source reconciliation)

- **Context refresh is automatic.** The literal window value lives in exactly one place —
  `.claude/settings.json`'s `CLAUDE_CODE_AUTO_COMPACT_WINDOW`. Where compaction actually fires is
  computed, not stated: `nativeCompactCeiling()` in `scripts/lib/compaction-window.mjs`. Don't
  restate either value here, they drift (this file itself used to quote a stale 160000 before the
  2026-07-18 pass). The owner's /clear-paste job is retired; override per session by saying
  "NO REFRESH" in the driver prompt.
- The context-size-advisor Stop hook is tracked (`.claude/hooks/context-size-advisor.mjs`,
  registered in `.claude/settings.json`). It reads LIVE context from the LAST assistant `usage` in
  the transcript tail (file size is a broken proxy post-compaction — the file keeps growing while
  live context resets) and the compact window from the env var at runtime. Each time its size
  checkpoint fires, it blocks the stop once so mid-train state is persisted to
  `docs/SESSION_HANDOFF.md`, then lets the turn end; it never stops the work and never asks for an
  owner paste block. Only its separate thrashing advisory (refill velocity)
  escalates, to a one-line /clear note for the owner. Its thresholds live in the hook; don't
  restate them here.
- ~215k tokens per transcript-MB (measured 2026-07-13) is still the right ratio for reading the
  audit script's per-session table — but only pre-compaction; don't use file size for live thresholds.
- The weekly report is generated by a Windows scheduled task (`CompyUsageAudit`, Mondays) —
  zero tokens; it only writes `docs/usage-audit/`. If LATEST.md goes stale > 8 days, the task
  broke: `schtasks /query /tn CompyUsageAudit`.
