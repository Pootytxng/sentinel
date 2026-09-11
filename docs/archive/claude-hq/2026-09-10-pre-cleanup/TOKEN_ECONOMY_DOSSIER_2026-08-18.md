# Token-economy audit — evidence pack, 2026-08-18

Companion to `claude/TOKEN_ECONOMY_LAW.md`. Read the law; read this only to check its working or to
re-derive something. Zero LLM tokens were spent producing any measurement here — everything is
`node` over `~/.claude/projects` transcripts. Probes live in
`C:\Users\Kuya\code\token-economy-audit\` (outside the repo, deliberately).

**Collision note.** The live Compy lane (issue #130 → and past it; HEAD moved from `1664f0e1` to
`66c6aa60` during this audit) was working in the canonical checkout throughout. Nothing was written
to `C:\Users\Kuya\code\sentinel`. The repo-side changes are built, tested and queued — see §8.

---

## 1. What the system actually was

The side-channel brief that opened this lane was **substantially out of date**. The real inventory:

**Code-enforced (these run):** `scripts/doc-budget.ps1` (line budgets, resident in `npm test`) ·
`scripts/usage-audit.mjs` + `scripts/lib/compaction-window.mjs` + `CompyUsageAudit` scheduled task ·
`scripts/context-headroom-guard.test.mjs` · `scripts/context-thrash-guard.test.mjs` ·
`scripts/compaction-window-guard.test.mjs` · `scripts/gate-residency-guard.test.mjs` ·
`.claude/settings.json` (`CLAUDE_CODE_SUBAGENT_MODEL=sonnet`, `CLAUDE_CODE_AUTO_COMPACT_WINDOW=250000`)
· ten hooks, of which six are token-economic: `big-read-guard` (DENY) · `subagent-model-guard` (DENY)
· `subagent-throttle` (advisory) · `workflow-usage-guard` (advisory) · `context-size-advisor` (Stop)
· `stop-continue` (`MAX_CONTINUES` clamp).

**Rubric/prose:** `.claude/USAGE_ECONOMICS.md` (143 lines, self-declared canonical) ·
`.claude/skills/INDEX.md` · `CLAUDE.md` TOKEN LAW 1–5 · global `~/.claude/CLAUDE.md` §2 and §6 ·
`docs/LANE_WORKFLOW.md` · `docs/superpowers/specs/2026-07-01-token-routing-protocol.md`.

It is a genuinely good system. Its problem is not sloppiness — it is that **it was aimed at the
wrong 15%.**

---

## 2. Finding 1 — the cost model was never built, and it inverts the priorities

`usage-audit.mjs` counted tokens and flagged none of what they cost. Weighted by published price
ratios (cache-read 0.1× · cache-write 2.0× · output 5×, all normalised to one base-input token):

```
=== 152 sessions, 29,928 assistant turns ===
raw: out 26.0M | cache-read 3.73B | cache-write 160.7M | uncached-in 0.96M
  45.2%  cache-read (carried context)
  38.9%  cache-write (prefix build)
  15.8%  output (new work + thinking)
   0.1%  uncached input
  carried-context share = 84.1%   ·   avg carried context 125k/turn
```

On the 80-session window the weekly report uses, it is 45.6 / 39.0 / 15.4 → **85%**.

Inside that: the fixed per-turn floor (median 66k) against 110k average carried context is ~60% of
all cache-read → **~27% of total spend is re-reading the floor.** Of the ~66k floor, only ~14.6k is
repo-controlled (CLAUDE.md 6.2k + global 1.1k + AGENTS.md 1.6k + src-tauri 1.0k + all skill/agent
frontmatter 4.7k). The rest is harness.

---

## 3. Finding 2 — the compaction ceiling has been wrong since 2026-08-07

`NATIVE_COMPACT_FRACTION = [0.77, 0.80]` was fitted to the 150k window in July. Re-measured across
every transcript with ≥20 assistant turns, split at the 2026-08-07 window change:

```
WINDOW 150000 (before 2026-08-07)  n=93   -- no window was actually set; peaks to 514k
WINDOW 250000 (on/after)           n=25   median of top quartile 217k
   RESERVE (window - ceiling) = 33k       proportional f = 0.867   [stored model said 0.77-0.80]
   top peaks: 217k 217k 217k 217k 217k 217k 217k 216k 216k 216k 216k 216k
```

Twelve independent sessions pinned inside a ±1k band. The stored fraction predicts 192.5–200k — it
is **short by 24k, 12% of the window**, and every weekly report since 2026-08-07 printed
"native compaction fires ≈193k-200k", a point that does not exist.

The code's own comment had already guessed the mechanism ("the harness reserves the max output
budget, 150k − 32k ≈ 118k") and then declined to encode it, storing the ratio instead. The
additive model reproduces **both** windows (150k−33k = 117k, inside the measured 116.0–119.9k band;
250k−33k = 217k, inside the measured band). The proportional model reproduces only the first.

**Consequence:** `usableHeadroom()` understated headroom by ~24k. Real headroom at the p75 floor is
**142k, not the 117k** the last report printed. This is the number that justified raising the window
on 2026-08-07 — the decision was still right, but it was made on arithmetic that was 24k pessimistic.

*Honest limit:* with one window in force, additive-33k and proportional-0.867 both fit. Additive is
preferred because it matches a known mechanism and because the proportional model has already been
falsified once. The falsifying test is one more window change.

---

## 4. Finding 3 — the loudest weekly signal was noise

`flagPeakContext` compared every session's peak against the configured window, with no notion of
when that window was configured. `CLAUDE_CODE_AUTO_COMPACT_WINDOW` did not exist before 2026-08-07;
older sessions ran on the model default and peaked as high as 514k. They sit in the rolling
80-session sample for weeks.

Every 🔴 in the last three reports (`2026-08-10`: 15/80, worst 2026-08-04 / 07-13 / 07-07;
`2026-08-17`: 4/80, worst 2026-08-04 / 07-07 / 07-30) named **only pre-fix sessions**. With the
cutoff applied:

```
🟢 0/31 sessions since 2026-08-07 exceeded the 250k window (49 older sessions predate the setting).
```

**Zero breaches since the fix.** The headline red flag was training the owner to ignore red flags.

---

## 5. Finding 4 — the doc budget measures the wrong unit

Run against the live repo, both tables, same moment:

```
PASS  CLAUDE.md                 259/380 lines      FAIL  CLAUDE.md              24.3KB/20KB
PASS  docs/BACKLOG.md          1378/1400 lines     FAIL  docs/BACKLOG.md       141.7KB/120KB
PASS  docs/RELEASE_STATE.md     274/300 lines      FAIL  docs/RELEASE_STATE.md  56.4KB/48KB
PASS  (7 more)                                     PASS  (2 more)
```

**Every doc passes on lines. Three fail on bytes.** BACKLOG averages 113 bytes/line,
RELEASE_STATE 222. Tokens are charged by bytes, so the gate enforcing TOKEN LAW 1 was structurally
blind to it. The usage audit's own 🟡 had said "BACKLOG > 120 KB" for three consecutive weeks
(131 → 136 → 142 KB) while the gate said PASS every time.

Budgets are derived, not chosen: **48 KB** = `MAX_UNBOUNDED_BYTES` in `big-read-guard.mjs` (past it,
the repo's own hook refuses to read the file whole) · **120 KB** = the audit's existing boot-tax line
for BACKLOG, which is read by section by law · **20 KB** ≈ Anthropic's published "keep CLAUDE.md
under ~200 lines" at this repo's ~110 bytes/line.

---

## 6. Finding 5 — the floor stepped +30k in one day and nothing said a word for eleven days

```
2026-07-31  median 53k     2026-08-04  median 83k  (max 128k)     2026-08-11  median 74k
2026-08-01  median 53k     2026-08-05  median 81k                 2026-08-12  median 84k
                           2026-08-07  median 86k                 2026-08-18  median 64k
```

Two config events land on that date: `~/.claude/_archive/settings.json.bak-20260803-preroothook`
(mtime 2026-08-04) and the superpowers plugin's `lastUpdated 2026-08-04T16:31Z`. The settings diff
across that rewrite: `CLAUDE_CODE_AUTO_COMPACT_WINDOW` added · `effortLevel` **xhigh → high** ·
global hooks added · permissions widened · `cloudflare` plugin out, `playground` in (08-10).

Nothing flagged it, because the only floor control fails on *absolute breach* (headroom < 60k) —
which at the corrected 217k ceiling is months away. Fixed: a week-over-week floor-delta flag.

Also fixed: the floor metric is the first recorded turn, which contains the **opening prompt**. A
session opened with a pasted skill body reports a higher "floor" than one opened with "hi" — the
128k outlier's first prompt is literally `# Update Config Skill Modify Claude Code configuration…`.
The report now prints the spread (p25 57k · median 66k · p75 75k · max 128k) so a contaminated p75
cannot silently drive another window decision.

---

## 7. Refuted — hypotheses that did NOT survive measurement

Recorded because a refutation is data, and because three of these were in the opening brief.

| Claim | Verdict |
|---|---|
| "Bash/PowerShell output is an ungoverned inflow; build a guard like `big-read-guard`" | **REFUTED.** Bash averages 1,145 B/result, max 29 KB over 9,762 calls; 34.4% of inflow but tiny per call. Read is 50.6% at 4,545 B avg and is *already* guarded — only 7 results over 40 KB in 80 sessions. No guard warranted; designed, then not built. |
| "PostToolUse hooks firing on 9,722 Bash / 5,376 Read / 5,257 Edit calls are injecting context every time" | **REFUTED.** All are gated and throttled: `ship-reminder` only on `tauri build` + 10-min throttle; `self-review-reminder` only on `src/**/*.{tsx,css}` + 15-min throttle; `subagent-throttle` every 3rd spawn. |
| "Duplication across tiers: 'read big docs by section' is in global §6 *and* TOKEN LAW 2 — pure cost" | **REFUTED.** `~/.claude/notes/laws-history.md` shows the 2026-08-11 ablation kept it deliberately: `big-read-guard` is Compy-only, so global §6 is the only coverage elsewhere. Not duplication. |
| "Verify whether `CLAUDE_CODE_SUBAGENT_MODEL=sonnet` reaches worktree sessions" | **SETTLED — it does.** 324/326 subagent runs on sonnet, across many worktree-rooted sessions. |
| "Lower the compaction window to cut carried context" | **REFUTED by arithmetic.** Every compaction is a full-prefix rewrite; a lower ceiling means more of them. Read −20% × 45.6 vs write +29% × 39.0 ≈ 2 points worse. 250000 is near a local optimum. |
| "self-review is the largest fixable leak (64% of weekly usage)" | **NOT REPRODUCIBLE and superseded.** 196/326 subagent runs are `self-reviewer`, all sonnet, 1,512k total output across 324 runs ≈ 4.7k each. Cheap. The 64% figure predates the dispatcher fix and the model routing. |
| "The weekly Cowork sweep, Mondays 6 AM PT" | **DOES NOT EXIST.** No scheduled task in the account, no Windows task. `CompyUsageAudit` (verified: last run 2026-08-17 09:17, result 0) is the only weekly mechanism. |

---

## 8. What is built, proved, and queued

Eight files in `C:\Users\Kuya\code\token-economy-audit\staged\`. Nothing has touched the repo.

| File | Change | Proof |
|---|---|---|
| `scripts/lib/compaction-window.mjs` | `NATIVE_COMPACT_FRACTION` → `NATIVE_COMPACT_RESERVE = 33_000` + `nativeCompactCeiling()`; `flagPeakContext` gains `configuredSince` | 25/25 vitest green |
| `scripts/compaction-window-guard.test.mjs` | +7 cases pinning the additive model and the cutoff | **falsified:** reinstating `window*0.77` turns 6 cases red |
| `scripts/context-headroom-guard.test.mjs` | one case re-pinned (132.5k → 157k breach point) + a new case asserting the corrected ceiling reproduces both windows | green; re-pinned not deleted, per the law-3 corollary |
| `scripts/usage-audit.mjs` | cost-weighted spend section · carried-context flag · **floor-trend flag** · byte budgets · first-turn spread · `configuredSince` · `USAGE_AUDIT_REPO` for testability | run against real data; floor-trend **falsified** in 3 directions (fires on +25k, fires on −15k, silent on 1k) |
| `scripts/doc-budget.ps1` | `$byteBudgets` table alongside `$budgets` | parses clean; correctly reds exactly the three real overages |
| `scripts/doc-budget-guard.test.mjs` | parses the byte table from the `.ps1` (never restates a number) + 5 cases | **falsified both ways:** red on real sizes, green once trimmed |
| `.claude/USAGE_ECONOMICS.md` | replaced by a pointer at the new law; §§1–4 and 6 retired, §5's number table retired in favour of the instruments | verified against the two assertions in `src/agent-machinery-guard.test.ts` |
| `CLAUDE.md` `## TOKEN LAW` | replaced **in place** (not by copying a whole file — the live lane edits CLAUDE.md) with a 6-clause version pointing at the law | verified against `src/claude-md-laws-guard.test.ts` |

### Two hidden tripwires the "remove anything currently instated" instruction would have hit

Both were found by writing a checker that mirrors the repo's own guards
(`token-economy-audit/verify-prose.mjs`) and running it before landing anything.

1. **`.claude/USAGE_ECONOMICS.md` cannot be deleted.** `src/agent-machinery-guard.test.ts` requires
   the file to exist *and* to carry an `| Autopilot continuation cap | <N> |` row matching
   `MAX_CONTINUES` in `stop-continue.mjs`, *and* forbids any other scanned file from restating that
   literal in an assignment-like form. The replacement satisfies all three.
2. **`CLAUDE.md`'s TOKEN LAW is pinned by two literal markers** —
   `scripts/doc-budget.ps1` and the exact phrase `never build a parallel monitor`. The first draft
   of the replacement line-wrapped that phrase across a newline, which passes a human read and fails
   `includes()`. **It would have gone red in CI.** Caught by the checker, fixed by keeping the
   phrase unwrapped. The clause now points at `usage-audit.mjs`, which exists, instead of the sweep
   that does not.

### One thing measured and reported rather than fudged

The CLAUDE.md replacement is **+0.4 KB, not a saving** (24.3 → 24.7 KB) — it adds two rules that did
not exist before (delegate-verbose, don't-invalidate-prefix) and a precedence pointer. That is
`laws-history.md`'s documented trap ("a trim is a measurement, not a judgement" — the 2026-08-11
pass grew the file 8.5% mid-edit while believing it was trimming), and the honest answer is to state
the number rather than mutilate the law to win ~100 tokens per boot. The 4.7 KB CLAUDE.md still owes
its byte budget comes from the archive pass in step 2, not from the law text.

**To land:** `powershell -NoProfile -File C:\Users\Kuya\code\token-economy-audit\APPLY.ps1`.
It refuses unless the repo is clean and on `main`, refuses if `.claude/USAGE_ECONOMICS.md` was
committed after this bundle was built, and refuses if `## TOKEN LAW` is no longer CLAUDE.md's last
section. **Step 2 is not optional** — the byte budgets fail three docs on purpose, and landing
without the archive pass leaves the push gate red. That archive pass touches `docs/BACKLOG.md` and
`docs/RELEASE_STATE.md`, which is exactly why it could not be done while the Compy lane was live.

**Not done, deliberately:** nothing was written to `~/.claude/settings.json` or `~/.claude/CLAUDE.md`
— that file's own `autoMode.hard_deny` reserves both for the owner's hands. See law §5.
