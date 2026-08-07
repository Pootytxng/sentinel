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

Compact around 80–120k of *conversation*; don't keep a giant thread alive because it "knows
everything." The auto-compact window in `.claude/settings.json` is **250000** — raised from 150000
on 2026-08-07 after measurement (§"open questions" below, and `scripts/lib/compaction-window.mjs`).

**Why the target did not change but the number did.** The 150k pin was set as a quality/cost target,
not a technical ceiling, and that reasoning still holds. What it missed is that the window is not
the working set — the working set is `where compaction actually fires − the fixed per-turn floor`,
and both of those moved. Compaction fires at 0.77–0.80 of the window (measured; the code said
0.92–0.95), so 150000 meant a real ceiling of ~116k. Meanwhile the fixed floor — system prompt, MCP
tool listings, auto-loaded CLAUDE.md/MEMORY.md, skill and agent listings — grew from ~55k in July to
a p75 of **77k** in August, with one session opening at 128k. That leaves ~38k to work in, which two
file reads exhaust, which is the owner's recurring "Autocompact is thrashing" dialog. 250000 restores
~115k. **Cutting the floor is still the better lever and is not done** — a bigger window buys room,
it does not make the floor cheaper, and cache-read cost per turn scales with what is carried.
`scripts/context-headroom-guard.test.mjs` fails the build if headroom narrows below 60k again.
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
| `CLAUDE_CODE_AUTO_COMPACT_WINDOW` | **250000** (was 150000 until 2026-08-07) | The one literal env-var value | `.claude/settings.json` — the ONLY place this literal should be set. `tools/entry/context-policy.json` `default` must agree or the launcher refuses. |
| Where compaction really fires | **0.77–0.80 of the window** (~193k at 250000) | MEASURED from 34 transcripts, replacing a documented-but-never-checked 0.92–0.95 | `scripts/lib/compaction-window.mjs` (`NATIVE_COMPACT_FRACTION`) |
| Fixed per-turn floor | ~77k p75 (min 51k, max 128k) | Payload re-sent every turn before any work — system prompt, MCP tool listings, auto-loaded docs, skill/agent listings. The other half of the arithmetic. | measured from first-turn tokens by `scripts/context-headroom-guard.test.mjs` |
| Working headroom | ceiling − floor, **min 60k** | The number that decides thrash. 60k is the last width known to have worked (July sessions, 4,731 turns, no complaint). | `MIN_WORKING_HEADROOM` in `scripts/lib/compaction-window.mjs`; build fails below it |
| Advisor warn threshold | 70% of the window, computed at runtime | When the Stop hook injects a persist-to-disk instruction. Was 85%, which sat ABOVE the real ceiling — so it never fired once in its life. | `.claude/hooks/context-size-advisor.mjs` — reads the env var, does not hardcode a copy |
| Audit red-flag | 200k peak context | Sanity check only — should never be reached if auto-compact is working; hitting it means compaction failed to fire, not a target to approach | `.claude/skills/usage-audit/SKILL.md`, `scripts/usage-audit.mjs` |
| Autopilot continuation cap | 8 (was 2) | Hard code clamp (was: unenforced doc convention) on how many tasks autopilot chains in one session, so it can't manufacture a >150k context on its own. Raised 2→8 on 2026-08-03 under the owner's standing autonomy grant; lower it again if the context advisor starts firing | `.claude/hooks/stop-continue.mjs` (`MAX_CONTINUES`) — the code is the source, this row mirrors it |

Unrelated metric that happens to also round to "200k" and should not be confused with the audit
red-flag above: `docs/LANE_WORKFLOW.md`'s **~200k output tokens per shipped burst item** — a
cost-estimation constant for sizing parallel build bursts, nothing to do with context-window size.

## 6. Code-enforced guards (2026-07-18, round 2 — closing the "policy-only" gaps)

The 2026-07-18 audit's remaining open items were all policy sentences with nothing checking them
in the moment. Two are now real code, one is fixed, two are named honestly as still open rather
than papered over:

- **Autopilot continuation cap — FIXED (§5).** `MAX_CONTINUES` hard-clamped in
  `stop-continue.mjs`, closing the exact gap the 2026-07-01 spec flagged as unenforced. The clamp
  VALUE lives only in that file (2 originally, 8 since 2026-08-03) — never restate a literal here.
- **Subagent model-routing override — NOW ENFORCED.** `.claude/hooks/subagent-model-guard.mjs`
  (PreToolUse on the `Agent` tool) denies any call whose `model` field requests opus/fable
  outside the one documented exception (`web-design-director`, opus). Verified against the real
  Claude Code Agent-tool schema (`prompt`/`description`/`subagent_type`/`model`), not guessed —
  live-tested: denies an opus override on `rust-tauri-reviewer`, allows it for
  `web-design-director`.
- **Subagent spawn frequency/necessity — ADVISORY ONLY, by design.** "Should this have been a
  subagent" is a judgment call a hook can't make from a JSON blob, so
  `.claude/hooks/subagent-throttle.mjs` (PreToolUse on `Agent`) counts spawns per session and
  injects a reminder (via `additionalContext`, not `permissionDecisionReason` — the latter isn't
  delivered to the model on an "allow" decision, verified against the current hooks reference)
  every 3rd spawn, pointing back to the §1 worth-spawning list. It never blocks. This is a real
  improvement over pure hope, but it is not enforcement — a session can still ignore the reminder.
- **Persist-before-compaction — NOW VERIFIED, not just instructed.** `context-size-advisor.mjs`
  used to tell the model to persist state but never checked it happened. It now compares the
  latest mtime of `docs/BACKLOG.md` and `docs/superpowers/{specs,plans}` against the last time it
  fired in the same growth-cycle; if nothing changed, the injected reason escalates from a
  reminder to "step 1 below is not optional this time." Still can't verify the persisted content
  is actually *sufficient* to resume from cold — only that something was written.
- **Boot tax — FIXED (2026-07-22, owner-approved tier-1 archive).** `docs/BACKLOG.md` had grown
  to 128 KB — past the usage-audit skill's 120KB flag — at exactly its 12-cycle retention cap,
  so the excess was completed non-cycle content living past the rolling window. The judgment
  pass this bullet used to defer was made and owner-approved: five sections verified
  complete/superseded (TOOLCHAIN pack · TOP PRIORITY LANE · Branch-integration health · UI
  SLIM-DOWN TRAIN · the stale Bottom line) moved verbatim to `BACKLOG_ARCHIVE.md` with one-line
  pointers left — ~21 KB off the board, back under the flag (107 KB). Remaining size is inherent
  cycle-log verbosity; next lever if it regrows past the flag: Phase-A detail (~37 KB, needs
  cross-reference re-pointing first — its Phase-D row and closure note cite lines inside it).
- **~~The 150k window number is inherited, not re-derived.~~ RE-DERIVED 2026-08-07 — and it was
  wrong.** Measured across 34 recent sessions' transcripts: under the pin, every session's peak turn
  landed in a 116.0k–119.9k band (0.77–0.80 of the window, not the documented 0.92–0.95), while the
  first-turn floor rose to a p75 of 77k. Headroom ~38k → thrash. Window raised to 250000; the
  measurement lives in `scripts/lib/compaction-window.mjs` and is enforced by
  `scripts/context-headroom-guard.test.mjs`. What is still NOT re-derived: whether 250000 is optimal
  rather than merely sufficient, and what the floor's ~64k of harness-injected payload (MCP tool
  listings and instruction blocks for connectors unrelated to Compy) is actually costing.
- **`docs/LANE_WORKFLOW.md`'s "Workflow tool" — CONFIRMED + GUARDED (2026-07-22).** The live
  PreToolUse `tool_name` is `Workflow`, captured empirically via a temporary catch-all logging
  hook + a no-op workflow run (0 agents), not assumed. Now guarded:
  `.claude/hooks/workflow-usage-guard.mjs` (PreToolUse, matcher `Workflow`) injects the §2
  reminder on every call — advisory like `subagent-throttle.mjs`, since "was this workflow
  warranted" is judgment, not mechanics. Live-fired in-session: the reminder reached the model.
  **This item is CLOSED.** The paragraph that used to trail here ("a matcher would be a guess …
  to close this, run a Workflow call and check `tool_name`") described the PRE-measurement state
  and was left standing after the measurement was actually taken — removed 2026-08-05. The
  empirical confirmation is recorded in `.claude/hooks/workflow-usage-guard.mjs`'s header.
