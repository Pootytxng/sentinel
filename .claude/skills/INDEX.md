# Compy Skills Index

> Written 2026-07-06, inside the closing Fable-5 window: this file + the skills it maps exist to keep
> post-Fable sessions (Opus 4.8 / Sonnet / any model) executing at the same floor â€” judgment lives in
> the checklists, verdict blocks, and scripts, not in whichever model happens to be running. New
> sessions: skim this table before starting any train whose class appears here. Keep the table current
> in the same commit that adds/changes a skill (doc-sync law).

## Live skills

| Skill | Fires when | Cheapest executor | Notes |
|---|---|---|---|
| `self-review` | any UI change about to be claimed done/fixed/ready | dispatcher: any Â· worker: **sonnet** (pinned) | Verdict block = the license. Never review inline (token law: evidence stays in worker context). |
| `impeccable` | building / critiquing / polishing frontend UI | main agent; its `scripts/` do the heavy lift | 26 subcommands, anti-pattern detector wired as PostToolUse hook via settings.local.json. |
| `hygiene` | "maintenance" / "cleanup" / stale-state or bloat suspicion | main agent (script does the lift) | `scripts/repo-hygiene.ps1` + doc-budget gate; PROCESS-KILL SAFETY rule inside - read it before killing anything named claude. |
| `compy-coverage-sweep` | expanding test coverage (test-only, never prod code) | orchestrator: any Â· crews: **sonnet** | Disjoint file domains, 3-ring verification gate. |
| `mutation-gate` | ANY diff touching `actions.rs` / `history.rs`, gate flips, elevation | any (it's a checklist) Â· reviewer dispatch: **sonnet** | 10-item rollback-first contract + required dispatches. Highest-stakes surface in the repo. |
| `gate-drift-audit` | state assertions, after refactors moving cited code, periodic | layer 1: `node scripts/verify-release-state.mjs` (no LLM) Â· layer 2: **sonnet** worker | RELEASE_STATE.md citation + truth verification. |
| `ship` | after every `npm run tauri build` | any | Silent reinstall is Claude's job; stamp-proof, ONE installer, RELEASE_STATE row, owner report format. |
| `guard-forge` | a defect was caught, BEFORE its fix is claimed done | any | bugâ†’guard law; redâ†’green proof required; tiers: test > rubric > memory. |
| `doc-sync` | any state change; any two docs disagreeing | any | Precedence (RELEASE_STATE=state, CLAUDE.md=law, code>both) + same-commit ordering. |
| `usage-audit` | owner asks about usage/tokens/budget; a ðŸ”´ in `docs/usage-audit/LATEST.md` | layer 1: `node scripts/usage-audit.mjs` (no LLM) Â· layer 2: any (terse) | Session/token discipline meter. Weekly report auto-written by the `CompyUsageAudit` scheduled task (Mondays, zero tokens). |

**Subagent routing (condensed):** haiku = mechanical search/read/format Â· sonnet = research/verify/
audit/review (the default worker â€” CC pins it via `settings.json` `CLAUDE_CODE_SUBAGENT_MODEL`) Â·
opus = rare, judgment-heavy workers only Â· fable = never a subagent. Full table:
`docs/COWORK_HANDOFF.md` â†’ Subagent-model orchestration.

## Tier 2 â€” spec'd, not built (build when the surface goes live; specs are the decisions, pre-made)

1. **`receipts-copy-lint`** â€” rubric-lint ALL outward copy (compy.gg pages, share cards, Learn
   entries, marketing) against `RECEIPTS_DOCTRINE.md` + `ARCHITECTURE_LOCKS.md` Â§1.7: the three
   labels stay strictly distinct (Verified / Measured signal / Expected impact); zero unmeasured or
   fabricated claims; measured wins amplified loudly (retired: "your PC is probably fine" defensive
   copy); NVIDIA sensor confidence never upgraded past what a monitored session proves; noise-floor
   deltas reported as "no measurable change". Verdict block per page/string batch. Executor: sonnet.
   **Build when:** Phase-1 Libraryâ†’web content work starts.
2. **`new-tester-onboarding`** â€” per `NVIDIA_VALIDATION_PLAN.md`: ingest a tester export â†’ grade
   exactly which confidence labels that export licenses upgrading (detection vs apply vs NVML sensor
   vs monitored-session), produce the doc/tooltip diffs, and list what STAYS unverified. Guards LOCKED
   rule 5 mechanically. Executor: sonnet. **Build when:** the next tester export lands.
3. **`council-strip`** â€” `docs/COUNCIL_PROTOCOL.md` (~line 50) already carries the paste template;
   only build a skill if strips start getting skipped in marathon logs. Executor: any.
4. **`receipts-arming-review`** â€” stop-rule-3 runbook for arming the telemetry boundary: payload
   sanitize/bucket verification, consent UI + preview + kill-switch checks, endpoint/queue review,
   sign-off checklist. Executor: opus worker + owner decision. **Build when:** owner schedules
   Receipts arming (it is the FIRST outbound boundary â€” do not arm without this).

## House rules for adding skills

Terse, imperative, evidence-required verdict block; the `description:` frontmatter states concrete
triggers (it's what fires the skill); heavy evidence gathering dispatches to a cheap worker, only the
verdict returns; the name states the domain; update THIS index in the same commit.
