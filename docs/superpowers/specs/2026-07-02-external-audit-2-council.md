# 2026-07-02 — External audit #2 (council review)

Owner pasted a second external audit (other-model critique of product scope, docs, and CC token
usage). This doc persists the fact-check + council verdict. Full council ran in Cowork chat same day.

## Fact-check vs RELEASE_STATE.md @ 733f132

| Audit claim | Verdict |
|---|---|
| "Gaming Mode remains gated / keeping F1 gated is correct" | **STALE-FALSE.** LIVE since 2026-06-18 (`lib.rs:500`); service-suspend + debloat ARMED w/ live QA. |
| "Local-only, zero telemetry is the identity" | **Retired by owner decree 2026-06-12** (Receipts Doctrine). Receipts DARK; zero-outbound verified-true *today* but not the identity. |
| "No single compact source of truth → create PRODUCT_SPINE.md" | **Already solved** — RELEASE_STATE.md (2026-06-26) is that doc. A second spine = new drift vector. Rejected. |
| "Replace /self-review with mechanical checks" | **Backwards here** — self-review law exists because green tests missed visual defects (2026-06-20 bug→guard). Mechanical checks already tier 1. |
| "docs/ is bloated; archive stale plans" | **VALID.** 40 md files in docs/, archive nearly empty. Actioned → archive sweep spec below. |
| "CC sessions too big; fresh session per task, subagents as checkpoint tools" | **VALID direction**, consistent with 2026-07-01 token-routing protocol. Reinforce, don't rewrite. |
| "Park signing/legal until beta is boring" | Matches current state — both OPEN public-release gates, owner/$-gated. No change. |

## Council verdict (Chairman)

Adopt the **hygiene third** (docs archive sweep, CC session discipline), reject the **strategy
two-thirds** (re-gating Gaming Mode, retiring monetization/telemetry direction, PRODUCT_SPINE
duplication) — it was written against a pre-2026-06-18 snapshot and contradicts standing owner
decrees. Re-gating live, QA-passed mutation features is owner territory and nothing in the audit
presents new evidence of harm (zero defect reports from the live build).

## Actioned

- CC prompt issued: docs archive sweep (move stale/point-in-time docs → docs/archive/, verify no
  live references break, RELEASE_STATE.md untouched as authority).
- Standing reinforcement: fresh CC session per task; subagents for audits/investigation only —
  already in `2026-07-01-token-routing-protocol.md`; no new doc created.

## Token-usage claims — MEASURED 2026-07-02 (local transcripts, all sentinel projects, deduped)

Source: `C:\Users\Kuya\.claude\projects\*sentinel*` — 316 main sessions (318 MB) + 483 subagent
transcripts (76 MB). "Processed tokens" = input + cache_creation + cache_read summed over every
API call (volume, not dollars — cache reads are ~10x cheaper, so marathons cost less per token
than raw volume suggests, but volume is what hits rate limits).

| Audit claim | Measured |
|---|---|
| "Subagents burning a major part of usage (53%)" | **FALSE.** Subagents = **6%** of processed tokens (1.06B of 18.3B), 3% of output tokens, 19% of bytes. Restricting subagents solves a non-problem. |
| "Giant 150k+ context sessions" | **TRUE — understated.** 59 sessions ≥150K max-context = 95% of transcript bytes. **13 marathon sessions (>5MB) alone = 74% of ALL processed tokens** (13.5B). Multiple sessions repeatedly hit ~1M context (top: 83MB session 06-22, 999K ctx). |
| "/self-review overused (13%)" | Not locally reproducible (3,678 transcript lines mention it, incl. hook nudges). Its cost driver is marathon-session re-reads, not the skill. Skill stays (bug→guard law). |

**Conclusion:** the leak is MARATHON SESSIONS, not subagents. The fix is the already-written
fresh-session-per-task rule in `2026-07-01-token-routing-protocol.md` — enforce it. Note the
07-01 session (15MB, ~1000K ctx) shows the protocol had not yet changed behavior on day one.

## Rejected (do not re-propose without new evidence)

- PRODUCT_SPINE.md (duplicate spine)
- Re-gating Gaming Mode / service-suspend / debloat
- "Zero telemetry forever" identity
- Dropping the self-review skill in favor of build/test only
