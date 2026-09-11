# TOKEN ECONOMY LAW — 2026-08-18

**This file is the single authoritative token/usage policy for every lane, every model, every
surface.** It replaces, in full: `.claude/USAGE_ECONOMICS.md` §§1–6, `CLAUDE.md` TOKEN LAW 1–5, and
the machine memory `usage-economics-subagent-session-rules`. Where any of those disagree with this
file, this file wins — no reconciliation, no "newer directive" judgment call.

Evidence: `claude/TOKEN_ECONOMY_DOSSIER_2026-08-18.md`. Every number below was measured on this
machine's own transcripts with zero LLM tokens, or is cited to an official Anthropic doc.

---

## 0. The cost model — read this before you change any other rule

Measured 2026-08-18 across **152 sessions / 29,928 assistant turns** under `~/.claude/projects`,
weighted by the published price ratios (cache-read 0.1× · cache-write 2.0× at the 1-hour TTL Claude
Code auto-requests on a subscription · output 5× for Opus-class):

| | share of spend |
|---|---|
| **carried context** — the conversation re-read on every turn | **45.6%** |
| **prefix build** — writing new material into the cache | **39.0%** |
| new work — output + thinking | **15.4%** |

**Carried context is 85% of the bill. Output is 15%.** Every control the system owned before today
— subagent model routing, the self-review dispatcher, the workflow reminder, terse-report rules —
points at that 15%.

The sharpest number inside it: the **fixed per-turn floor** (median 66k, p75 75k) against 110k
average carried context is roughly **60% of all cache-read, i.e. ~27% of total spend**, paid on
every turn of every session, forever. Cutting 5k off the floor is worth ~2% of everything.

---

## 1. The rules that move the 85%

1. **`/clear` between unrelated tasks. Do not `/compact` your way through a topic change.**
   A cleared session restarts at the floor and pays no summarisation rewrite; a compact re-sends the
   whole history. "Stale context wastes tokens on every subsequent message."
   → https://code.claude.com/docs/en/costs

2. **A subagent is a context firewall, not just a cheaper model.**
   Each subagent gets a *fresh context window*; only its final summary returns to the parent. So a
   sonnet worker that absorbs 50 KB of file reads and hands back 2 KB removes that 50 KB from the
   parent prefix **permanently** — you stop paying to re-read it on every later turn.
   **Delegate anything VERBOSE — test runs, log analysis, wide search, doc reading — whether or not
   it is hard.** → https://code.claude.com/docs/en/sub-agents

   **This reverses the old rule.** `USAGE_ECONOMICS.md` §1 said never spawn for "anything the main
   context already covers", and `subagent-throttle.mjs` nudges against spawning every third time.
   That was written on 2026-07-02 when subagent-heavy sessions were 53% of burn — measured on
   *output*, with subagents on expensive models. Today 324 of 326 subagent runs are sonnet and the
   bill is 85% context. The old rule now optimises the wrong quantity.

3. **One lane, one directory.**
   Prompt cache is scoped per machine **and directory** — two worktrees of the same repo build
   different prefixes and share nothing. 67% of measured session starts already open with a cold
   prefix (cache-write exceeding cache-read on the first turn), each rebuilding at 2.0×.
   → https://code.claude.com/docs/en/prompt-caching

4. **Do not invalidate the prefix mid-session.**
   Switching model, changing effort level, enabling fast mode, connecting or disconnecting an MCP
   server, enabling or disabling a plugin, or denying a whole tool each rebuild the entire cached
   prefix. Batch every config change to session start.
   → https://code.claude.com/docs/en/prompt-caching

5. **Bound every read.** `big-read-guard` denies an unbounded Read over 48 KB and says how to bound
   it. Reads are **50.6% of all tool-result inflow** — the largest single writer into any prefix.
   Search first, then `offset`/`limit`.

6. **Docs are budgeted in BYTES, not lines.** Both budgets apply; a doc must clear both.
   `scripts/doc-budget.ps1` carries the table. Move to archive, never delete, leave a pointer.

7. **Cheapest capable model for subagents.** `CLAUDE_CODE_SUBAGENT_MODEL=sonnet`. Measured
   compliance 324/326 — including from worktree-rooted sessions, which settles the open question of
   whether the env var reaches them. It does.

8. **Prefer CLI tools over MCP servers** where both exist (`gh`, `wrangler`, `vercel`): a CLI adds
   nothing to the per-turn floor, an MCP server's tool schemas can add tens of thousands of tokens.
   → https://code.claude.com/docs/en/costs

---

## 2. Settings that are NOT levers — measured, do not re-litigate

- **The compaction window is near a local optimum at 250000. Leave it.** Lowering it cuts carried
  context ~20% but raises cache-write ~29%, because every compaction is a full-prefix rewrite and a
  lower ceiling means more of them. Net ≈ 2 points worse. Raising it is worse the other way. The
  2026-08-07 raise was correct; further tuning is noise.
- **No Bash-output guard is warranted.** Bash returns 1,145 bytes on average, max 29 KB across 9,762
  calls. Measured before building; the leak is not there. (Marathon law 3 held.)
- **Global `~/.claude/CLAUDE.md` is not fat.** Ablated 2026-08-11 for a −2.6% yield with a
  documented "do not re-run before ~2027-02". Its §6 "read big docs by section" is **not** a
  duplicate of TOKEN LAW 2 — it is the only coverage outside Compy, where `big-read-guard` does not
  load. Leave both.
- **Doc trimming is hygiene, not savings.** Bringing all three overage docs inside budget recovers
  well under 0.1% of spend. Byte budgets exist to stop unbounded growth, not to recover money. Do
  not sell them as a cost win.

---

## 3. The instrument is the authority

`scripts/usage-audit.mjs` + `scripts/lib/compaction-window.mjs` are the only place a token number
lives. Any doc quoting one must cite them rather than restate it. The weekly report is written by
the `CompyUsageAudit` Windows scheduled task, Mondays, zero tokens
(verified running: last 2026-08-17 09:17, result 0, next 2026-08-24).

The audit now reports and flags: cost-weighted spend shares · carried context against the real
ceiling · **per-turn floor week-over-week** · byte budgets · window breaches counted only from the
date the window setting existed.

---

## 4. Retired today — do not reinstate without new measurement

| Retired | Why |
|---|---|
| `NATIVE_COMPACT_FRACTION = [0.77, 0.80]` | Fitted to one window; understated the real ceiling by 24k. Replaced by `NATIVE_COMPACT_RESERVE = 33_000`, which reproduces **both** measured windows. |
| The "🔴 N/80 sessions peaked past the window" flag as written | Counted sessions from before the setting existed. Every 🔴 in the last three weekly reports was pre-fix history. Zero sessions have breached since 2026-08-07. |
| `USAGE_ECONOMICS.md` §1's "never spawn a subagent for anything the main context covers" | Optimises output, which is 15% of spend. See law 1.2. |
| `CLAUDE.md` TOKEN LAW 5, "a weekly Cowork sweep (Mondays 6 AM PT) runs the budget check — extend that sweep, never build a parallel monitor" | **No such sweep exists.** No scheduled task in the account, no Windows task. The clause also forbids fixing the real monitor. The `CompyUsageAudit` task is the sweep; point the law at it. |
| The line-only doc budget | Passed all ten docs while three were over the byte line. |

---

## 5. Owner's hands — two items, both blocked by `~/.claude/settings.json`'s own `hard_deny`

1. **34 auto-mode classifier denials in the last 80 sessions**, up from 5 the week before. Each is a
   wasted round-trip. The fix is allow-list entries in `~/.claude/settings.json`, which that file
   forbids the assistant from editing.
2. **`effortLevel` was changed `xhigh` → `high`** in the 2026-08-03/04 settings rewrite. Worth
   knowing it happened; changing it mid-session invalidates the prefix, so it is a session-start
   decision either way.
