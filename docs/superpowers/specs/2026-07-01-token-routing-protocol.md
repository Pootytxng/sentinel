# Token-routing protocol — Cowork × CC on Fable 5 (2026-07-01)

> Owner directive: use Cowork (2× promo) in conjunction with CC to burn fewer Fable tokens.
> Source blend: Nate Herk, "How Anthropic Engineers Actually Prompt Fable 5" (YouTube,
> 2026-07-01, owner-supplied) + Anthropic promo terms (web-verified 2026-07-01) + our existing
> doctrine (CLAUDE.md SPORT MODE / TOKEN DISCIPLINE / shorthand-audit). Standing protocol;
> the promo windows expire, the routing table doesn't.

## The verified promo mechanics (why this works)

- **Cowork 2× (Jun 5 → Jul 5):** the **5-hour rolling cap** in Cowork is doubled. **Weekly
  limits are NOT doubled** — the weekly pool is shared across Cowork + CC. So 2× buys longer
  uninterrupted Cowork sessions, not free tokens.
- **Fable 5 on-plan (→ Jul 7):** included up to **50% of weekly limits**; after Jul 7 it goes
  **usage-credits only** (off subscriptions — API billing at ~2× Opus: $10/M in, $50/M out).
- Consequence: **the single biggest lever is not "use Cowork more," it's "stop spending Fable
  turns on non-build work."** Second lever: make Fable's build turns finish in fewer rounds.

## The routing table (standing)

| Work | Lane | Model note |
|---|---|---|
| Builds: multi-file code, Rust/TS, refactors, long autonomous trains | **CC** | Fable 5 while on-plan (→Jul 7); effort-matched (below). After Jul 7: Opus 4.8. |
| Specs, plans, design calls, mockups, copy, docs | **Cowork** | Fable session only for heavy synthesis/design; routine turns don't need it. |
| Audits of CC's work (read git, diff vs hard lines, grep) | **Cowork** | Read commits/diffs — never ask CC to re-narrate (that's Fable output tokens). |
| Research, competitor reads, council runs | **Cowork** | — |
| Quick status/decision turns | **Cowork** | Continuity beats capability; stay put. |

Rule of thumb from the video that matches our lanes: **Fable earns its cost on ~5–15% of
tasks** — for us, that's CC build trains. Everything else was already Cowork's job; now it's
also the token-correct choice.

## Six prompting rules → what actually changes for us

Most of the video is already our doctrine — noted so we don't "adopt" what we invented:

1. **Give it the why** → already: every CC prompt carries the spec path + one intent line. Keep.
2. **Negative prompting** ("report and stop; don't fix/send/edit until go") → already: our
   HARD-LINES block IS negative prompting. Keep it in every CC prompt.
3. **Act once it has enough / stop over-planning** → already SPORT MODE. **NEW — effort
   matching on CC:** default **high**; **x-high** only for correctness-critical work at the
   mutation/rollback boundary; **medium/low** for routine edits. (Video: Fable-low ≈ Opus-x-high
   capability at lower cost.)
4. **Make it prove it** → already: the verify line + shorthand-audit. Adopt the phrasing into
   CC's report contract: *point to the result that proves it; only report what you can show;
   if unverified, say so plainly* (that's Receipts law applied to reports).
5. **NEW — never ask Fable to show its reasoning.** A standing "explain your reasoning" line
   can trigger a refusal or a silent route to Opus 4.8. We audit via commits/diffs/specs, not
   via asking the model to narrate. This also matches our documented STOP signal: if Fable
   auto-switches models on security-adjacent work, halt and involve the owner (CLAUDE.md).
6. **Say less, not more** → already TOKEN DISCIPLINE. Rules live in CLAUDE.md/skills/specs,
   not restated per prompt. Prompts lead with the outcome.

## Operating cadence (the promo-window play, expires Jul 5/7)

1. **Now → Jul 5:** run long Cowork sessions (2× 5-hr headroom) doing all spec/audit/design
   work; queue CC builds as paste-ready prompts.
2. **Now → Jul 7:** spend the Fable 50% ONLY on CC build trains; pull forward any big
   Fable-worthy train that's ready (it's the last week Fable is on-plan). Zero-budget law:
   post-Jul 7 Fable = paid API credits = **owner-gated spend, default no** — CC falls back to
   Opus 4.8.
3. **CC session starts get the compact defaults block** now in CLAUDE.md (§ FABLE 5 PROMPTING
   DEFAULTS) — no per-prompt restating.
4. **Cowork model choice (owner-side):** heavy design/synthesis sessions on Fable; routine
   relay/status sessions on a lighter model — same weekly pool either way.

## Report contract (unchanged, restated once)

CC: `hash · what-changed (1–2 lines) · one verify line (point to the proof) · flags`.
Cowork: terse, answer-first, next move teed up. Mechanism lives in commits/specs.
