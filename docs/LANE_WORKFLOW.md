# 🏗️ Compy Looped-Workflow — the cost-efficient master structure (v2)

> **Why this exists.** v1 (the perpetual `lane-runner.ps1` fleet) did real work fast but burned a 5-hour
> token budget in ~30 min (~10×). This is the redesign that keeps the speed + thoroughness while making cost
> **bounded and predictable**. Primary engine: **`scripts/compy-burst.workflow.js`** (run via the Workflow tool).
> The old perpetual runner is retained only as a hard-capped fallback.

## 1. Where v1's tokens went (so we never repeat it)
| Driver | v1 | v2 fix |
|---|---|---|
| Perpetual loops (~250 ticks across 5 lanes) | re-fired forever | **Bounded burst** — N items then STOPS |
| No budget visibility | runaway | **Hard budget cap** — sizes the fleet to tokens left |
| Full context reload every tick (CLAUDE.md+bus+git ×250) | huge repeated overhead | **One agent per item** — no re-tick reload |
| Bookkeeping churn (~half of 82 commits were ledger ticks) | per-step doc commits | **1-line ledger edit** per item |
| Dry-spin tail (full-session cost for zero output) | looped on empty queues | **Finite** — never runs on empty |
| Redundant per-push verify | tests re-run every push | **ONE** integration verify per burst |
| Persistent worktrees + stale branches | manual cleanup | **Ephemeral** auto-cleaned worktrees |

## 2. The v2 engine — `compy-burst` (a bounded, budget-capped parallel burst)
Three phases, then it ends:
1. **Triage** (1 cheap read-only `Explore` agent) → picks up to *N* highest-value, **non-gated, cleanly-buildable**,
   **disjoint-file-domain** Phase-A items. Excludes gated (B/C/D), feasibility-walled, and (by default) marginal items.
2. **Build** (parallel, one agent per item, **isolated worktree**, budget-gated) → each builds with **full rigor**
   (TDD → `/check` + `/security` → `cargo`+`npm` green → self-review if UI) and lands on `main` via
   `git push origin HEAD:main` (rebase-retry for races). Stops launching if budget would be exceeded.
3. **Verify** (1 agent) → ONE integration check on the merged result; flags a culprit if red (re-runs a lone flake
   in isolation before calling red).

Returns: `{ shipped[], skipped[], verify, spent }`.

**This preserves quality** (same rigor + a final integration gate + disjoint domains so lanes can't corrupt each
other) and **productivity** (parallel, fast) while making **cost bounded** (finite items + hard budget cap).

## 3. Cost model (gauge output vs remaining budget)
- Per burst ≈ **(N builds + triage + verify)** agents. Rough: `COST_PER_ITEM ≈ 60k` output tokens/build (tune from
  real runs), triage/verify cheap.
- The script **sizes N to the budget**: with a target set, `N ≈ floor(remaining / 60k) − 1`, capped at 6. With no
  target, it defaults to a conservative 3.
- So a "+300k" burst builds ~4 items and **stops**; a "+120k" burst builds ~1–2. Predictable, never runaway.

## 4. How to run it
```
# bounded burst, sized to a token target you set for the turn:
Workflow({ scriptPath: 'scripts/compy-burst.workflow.js' })            # default ~3 items
Workflow({ scriptPath: 'scripts/compy-burst.workflow.js', args: { maxItems: 2 } })
# with a budget directive ("+300k" on the turn), it auto-sizes to fit and hard-caps spend.
```
Watch it live with the read-only dashboard: `pwsh scripts/lane-dashboard.ps1`.
Cadence: **owner triggers a burst** when they want progress (or schedule periodic bursts). Each burst is bounded
and its cost is known up front — no standing token drain between bursts.

## 5. Governance rules (always-on)
- **No perpetual loops.** Bounded efforts only; kill anything that idle-spins.
- **Low concurrency**, scaled to budget; don't run a big fleet "just because."
- **High-value first**; defer marginal items under pressure; **gated work needs an owner gate decision**, never tokens-on-spec.
- **Batch bookkeeping**; **periodic, not per-push, verify**.
- **Gauge against remaining budget**; no live meter, so the owner gives a budget signal and the burst sizes to it.
- See memory [[token-awareness-governance]].

## 6. Fallback — `lane-runner.ps1` (DEPRECATED for perpetual use)
The old per-lane runner is now **hard-capped at `-MaxTicks` (default 8)** — it stops after that many ticks instead of
looping forever, so even if used it can't run away or dry-spin for long (v1 ran ~50 ticks/lane). Prefer `compy-burst`
for cost control; reach for the runner only when a lane genuinely must run independently of the HQ session, and always
with a tight `-MaxTicks`.
