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

## Subagent policy (owner Q 2026-07-01: "should I stop using subagents?" — NO)

Owner's usage panel (2026-07-01): weekly 12% / Fable 21% — headroom is fine; subagents earn
their cost (53% of usage, but they're doing the verification work the doctrine demands). Keep
them; make them cheaper:

1. **Cheaper models for read-only subagents.** The project agents
   (`.claude/agents/frontend-ipc-contract-auditor.md`, `rust-tauri-reviewer.md`) and the
   `self-review` skill (13% of usage) are read-only report-writers — they don't need Fable.
   Add `model: sonnet` (or haiku for the mechanical passes) to their frontmatter.
   **ENFORCED IN CONFIG (2026-07-05, orchestrator pattern):** `.claude/settings.json` now sets
   `"env": { "CLAUDE_CODE_SUBAGENT_MODEL": "opus" }` — subagents without their own model
   (Explore, general-purpose, Plan, skill-spawned) run Opus instead of inheriting Fable; the
   two project agents stay Sonnet via frontmatter. Fable stays the orchestrator: planning,
   judgment, and the build itself. Source: owner-supplied "Fable 5 Orchestrator" doc
   (Google Docs, 2026-07-05); it reports ~58% usage cut w/ Sonnet workers, ~74% w/ Haiku —
   we chose Opus workers because Compy's subagents are adversarial audits at the
   mutation/rollback boundary, where worker quality is the point. No per-session verbal
   routing instruction needed anymore — the setting is the guard.
2. **Tighten subagent prompts** — a subagent brief states scope + the exact artifacts to
   check + report format; no doctrine restating (it inherits CLAUDE.md).
3. **The bigger lever is context length, not subagents:** 72% of usage ran at >150k context.
   Long sessions compound cost — every turn re-reads the pile. Mitigation below.

## Session-refresh cadence (the >150k fix, standing)

- **One train per session.** When a train lands (or context clearly >150k / feels sluggish):
  CC → `/compact` mid-task, `/clear` between tasks; Cowork → start a fresh session with the
  kickoff paste below. State lives on disk (specs/BACKLOG/handoff), so a fresh session loses
  nothing the relay needs — that's what PERSIST-TO-DISK is for.
- **Cowork standing duty:** when a Cowork session's context has grown long (many tool calls /
  several trains deep), END the response with the kickoff paste so the owner can hop to a
  fresh session in one copy.

### Fresh Cowork session — kickoff paste (durable)

```
Continue Compy — fresh Cowork session (token refresh).
FIRST attach C:\Users\Kuya\code\sentinel (Space = memory only, not file access).
Read in order: CLAUDE.md → docs/COWORK_HANDOFF.md → docs/superpowers/specs/
2026-07-01-token-routing-protocol.md → docs/BACKLOG.md, then resume the top non-gated
item unless I redirect. Lanes: Cowork = specs/audits/design/research; CC = builds.
Audit CC by reading git directly — never ask me to paste CC reports. Terse, answer-first,
every response ends with the next paste-ready step. No git write commands (CC may be
live on main). Current thread: <one line — what's mid-flight>
```

## Docs-sprawl ruling (owner Q 2026-07-01: "too many per-feature .md files?")

**Many small per-feature spec .mds are token-CORRECT — keep them.** They cost nothing until a
task references one (pay-per-use context); one mega-doc would force every session to swallow
everything. The only always-loaded files are `CLAUDE.md` (every CC session) + skill/agent
descriptions — THOSE stay lean. The 2026-06-26 overhaul already moved CLAUDE.md's history
strata to `docs/CHANGELOG.md` and the board to archive; the routing overhaul (this doc) covered
prompting/lanes, not docs — no consolidation needed beyond: new standing rules go here or in
COWORK_HANDOFF as a POINTER, full text in a spec.

## Report contract (unchanged, restated once)

CC: `hash · what-changed (1–2 lines) · one verify line (point to the proof) · flags`.
Cowork: terse, answer-first, next move teed up. Mechanism lives in commits/specs.
