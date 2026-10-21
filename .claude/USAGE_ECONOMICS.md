# Usage economics — SUPERSEDED 2026-08-18

> **This file is no longer the policy.** The authoritative token/usage law is the HQ project doc
> **`claude/TOKEN_ECONOMY_LAW.md`**, with its evidence in `claude/TOKEN_ECONOMY_DOSSIER_2026-08-18.md`.
> Where anything here and that file disagree, that file wins. Both live in the Cowork project
> (`019ff3cc…`) and are **not on disk** — no Claude Code session can open them, so quote from this
> file and ask Cowork for the rest rather than searching for a path that has never existed.
>
> **What changed and why.** Everything this file used to say was derived from token COUNTS. Weighting
> those counts by price (cache-read 0.1x / cache-write 2.0x / output 5x) across 152 sessions and
> 29,928 assistant turns says: carried context 45.6% + prefix build 39.0% = **85% of spend**, output
> **15%**. Every rule this file carried governed the 15%.
>
> **The one reversal to know about.** Old §1 said never spawn a subagent for anything the main
> context already covers. That is now wrong. A subagent gets a fresh context window and returns only
> its summary, so a sonnet worker that absorbs 50 KB of reads and hands back 2 KB removes that 50 KB
> from the parent prefix permanently. **Delegate anything verbose, hard or not.**
>
> Sections 1-4 and 6 of the old file are retired wholesale. Section 5's number table is retired in
> favour of the instruments themselves (`scripts/usage-audit.mjs`,
> `scripts/lib/compaction-window.mjs`), which compute rather than restate. The full retirement list,
> with the evidence for each, is in the dossier.

## The only numbers still stated here

Every other context/token number in this repo now lives in code and is computed, not restated.
One remains here because a guard pins it to its code and would go red if it moved.

| Name | Value | Meaning | Source of truth |
|---|---|---|---|
| Compaction window | see `.claude/settings.json` | `CLAUDE_CODE_AUTO_COMPACT_WINDOW`, the ONE literal. `tools/entry/context-policy.json`'s `default` must agree or the launcher refuses. | `.claude/settings.json` |

**Where compaction actually fires is no longer a number in any doc.** It is
`nativeCompactCeiling(window)` in `scripts/lib/compaction-window.mjs` — window minus a measured
additive reserve. The previous documented value here was a fraction fitted to a single window; it
was wrong by 24k from the day the window changed, and it printed a confident figure in every weekly
report for eleven days. **A measured constant is unmeasured the moment you change its input.**

## Code-enforced guards (unchanged, still live)

- `.claude/hooks/subagent-model-guard.mjs` — DENIES an opus/fable subagent outside the one
  documented exception (`web-design-director`). Measured compliance: 324/326 runs on sonnet.
- `.claude/hooks/context-size-advisor.mjs` — Stop-hook persist-to-disk instruction, and it verifies
  something was actually written rather than only instructing it.
- `.claude/hooks/subagent-throttle.mjs` and `.claude/hooks/workflow-usage-guard.mjs` — advisory
  reminders. The subagent one was narrowed 2026-09-18 (#479) to fan-out bursts only; it no longer
  nudges against a single delegation, which is the recommended default.
- `scripts/doc-budget.ps1` — line AND byte budgets. Resident in `npm test`.
- `scripts/usage-audit.mjs` — the weekly instrument. Reports cost-weighted spend shares, carried
  context against the real ceiling, per-turn floor week-over-week, and byte budgets. Written Mondays
  by the `CompyUsageAudit` scheduled task, zero tokens.

## Owner directive 2026-10-21 — use the budget

The weekly token cap is a **resource**, not a ceiling to stay well under. The owner's words
(2026-10-21): sessions "constantly keep running into approval blocks or review blocks or some sort of
hindrance", so he is "not reaching my normal token usage weekly cap". Thrift below the cap is not a
goal; **a week that ends well under cap with startable work parked is the failure**, not spend.

Every guard above stays, because each guards against **waste** — unbounded carried context, silent
truncation, an opus subagent where sonnet answers the same — never against spend itself. What changes:

- The Workflow tool is sanctioned for any genuinely multi-step work (audit, sweep, burst,
  implement-and-verify fan-outs), not only the repo-wide class. `workflow-usage-guard.mjs` now asks
  for bounded scope and logged drops; it no longer tells a session to work solo.
- A hosted (claude.ai/code) session judges the thrash floor only when the window is known. The
  `CLAUDE_CODE_AUTO_COMPACT_WINDOW` literal above is the **desk** window; the hosted harness
  summarizes against a larger native window, so `context-size-advisor.mjs` v7 stands its
  size-relative checks down there (`scripts/lib/context-thrash.mjs` `judgeableWindow`) and keeps the
  window-free refill-velocity signal. Before v7 a healthy hosted summarization read as a no-headroom
  floor hit and told the session to hand off.
- The reader of the weekly audit treats under-use the way over-use was treated: a week well under cap
  while `docs/BACKLOG.md` holds startable slices is a finding to explain, not a saving.
