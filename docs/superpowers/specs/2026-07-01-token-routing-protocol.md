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
   **ENFORCED IN CONFIG (2026-07-05, orchestrator pattern; REVISED same day — see the
   2026-07-05 reassessment below):** `.claude/settings.json` now sets
   `"env": { "CLAUDE_CODE_SUBAGENT_MODEL": "sonnet" }` — subagents without their own model
   (Explore, general-purpose, Plan, skill-spawned) run Sonnet instead of inheriting Fable;
   the two project agents already pin Sonnet via frontmatter. Initial choice was Opus
   workers ("adversarial audits deserve worker quality"), reversed hours later: post-Jul 7
   CC's orchestrator IS Opus 4.8, so opus workers = zero savings; the orchestrator doc's
   ~58% cut assumed Sonnet workers. Pin `model: opus` per-agent only where judgment is
   provably the point. Fable stays the orchestrator: planning, judgment, the build itself.
2. **Tighten subagent prompts** — a subagent brief states scope + the exact artifacts to
   check + report format; no doctrine restating (it inherits CLAUDE.md).
3. **The bigger lever is context length, not subagents:** 72% of usage ran at >150k context.
   Long sessions compound cost — every turn re-reads the pile. Mitigation below.

## Session-refresh cadence (the >150k fix) — ⚠️ SUPERSEDED 2026-07-14/2026-07-18

**The manual `/compact`/`/clear` cadence below is retired.** As of 2026-07-14, refresh is native
(`CLAUDE_CODE_AUTO_COMPACT_WINDOW` in `.claude/settings.json`, currently 150000 — see
`.claude/USAGE_ECONOMICS.md` §5 for the current reconciled numbers) plus the context-size-advisor
Stop hook (v4 as of 2026-07-18) that only makes sure state is persisted to disk before compaction,
never asks for a manual command. The CC-side instructions below (type `/compact`/`/clear` yourself)
are kept for historical record only — do not follow them; follow USAGE_ECONOMICS.md instead.

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

## 2026-07-05 panel reassessment (VS Code usage panel, week ending Jul 5)

Numbers vs the 07-01 baseline: **subagent share 53% → 33%** (improving, and the config guard
only landed 07-05) · **>150k context 72% → 74%** (the session-refresh rule was prescribed 07-01
and did NOT move the number) · **self-review 13% → 64%** (new dominant cost).

Root-cause on self-review: `model: sonnet` was added to the skill frontmatter only late in the
window, so most of the 64% billed at full rate — but the deeper cost was **context residency**,
not model: the skill ran inline, so every native-res capture + cdp-eval dump entered the main
transcript and was re-sent on every subsequent turn. This is also a direct feeder of the 74%
>150k stat — the two numbers are one problem.

**Enforcement shipped 2026-07-05 (all in-git, standing):**
1. **`.claude/agents/self-reviewer.md`** (sonnet, Bash/Read/Grep/Glob) — owns the capture
   procedure + 7-item rubric; returns ONLY the SELF-REVIEW verdict block. Evidence lives and
   dies in the worker's context.
2. **`.claude/skills/self-review/SKILL.md`** → thin dispatcher. New Token Law: never run the
   rubric inline; no done-claim without a quoted PASS verdict. Rigor unchanged (full re-review
   on FAIL), residency moved. Hook message updated to match.
3. **`CLAUDE_CODE_SUBAGENT_MODEL` opus → sonnet** (rationale above). Note: the owner's global
   `~/.claude/settings.json` may still say opus — project settings win in this repo; aligning
   the global copy is a one-line owner edit affecting other repos only.

**Autopilot vs session-refresh ruling:** the Stop-hook autopilot chains tasks through one
session by design — it manufactures the >150k contexts the refresh rule bans. Standing
resolution: **cap autopilot queues at 1–2 tasks; `/clear` between trains.** A long queue is a
deliberate trade (autonomy over tokens), not the default.

**Watch item for the next panel:** self-review share should collapse (sonnet + isolated
context); >150k share should fall only if the queue-cap + `/clear` cadence is actually
followed — if it doesn't move again, the failure is behavioral, not structural.

**Context-refresh advisor (added 2026-07-05; v2 same day — owner directive "CC hands me the
paste") — ⚠️ DESCRIPTION BELOW IS STALE, describes v2 file-size-based behavior.** The hook has
since moved to v3 (2026-07-14, live-usage-parsing — file size is a broken proxy post-compaction,
since the file keeps growing while live context resets) and v4 (2026-07-18, reads the compact
window from the env var at runtime instead of a hardcoded threshold). Current behavior, mechanism,
and the full reconciled number set live in `.claude/USAGE_ECONOMICS.md` §5 and the hook file's own
header comment — read those, not the paragraph below, for what it actually does today.

`.claude/hooks/context-size-advisor.mjs` (Stop hook) stats the session transcript
after each turn; past ~1.5 MB (≈ the >150k-token zone) it blocks the stop ONCE (per +1 MB
growth) and instructs CC to (1) persist any conversation-only state to the spec/BACKLOG, then
(2) end its reply with a ready-to-send **CONTEXT REFRESH block**: which command to type
(`/clear` if state is on disk, `/compact` only if it couldn't persist) + the exact resume
prompt to paste after. The owner's whole job is type-command → paste. Guards: `stop_hook_active`
(never loops) · growth-step marker (never nags) · autopilot armed → downgrades to a plain
systemMessage so it never fights the queue. The command itself remains owner-typed — models
cannot clear their own context; this is the ceiling of automation.
