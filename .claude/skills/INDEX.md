# Compy Skills Index

> Written 2026-07-06, inside the closing Fable-5 window: this file + the skills it maps exist to keep
> post-Fable sessions (Opus 4.8 / Sonnet / any model) executing at the same floor — judgment lives in
> the checklists, verdict blocks, and scripts, not in whichever model happens to be running. New
> sessions: skim this table before starting any train whose class appears here. Keep the table current
> in the same commit that adds/changes a skill (doc-sync law).

## Live skills

| Skill | Fires when | Cheapest executor | Notes |
|---|---|---|---|
| `self-review` | any UI change about to be claimed done/fixed/ready | dispatcher: any · worker: **sonnet** (pinned) | Verdict block = the license. Never review inline (token law: evidence stays in worker context). |
| `impeccable` | building / critiquing / polishing frontend UI | main agent; its `scripts/` do the heavy lift | 28 subcommands (`reference/*.md`). Its detector is a **build gate** (`src/design-detector-guard.test.ts`, #214) AND a PostToolUse hook in **tracked** `.claude/settings.json` (the 2026-08-21 settings.local.json unwire can't recur). **Owns motion too** — `reference/animate.md` + DESIGN.md §Motion. Vendored v3.9.1 (Apache 2.0): do NOT hand-edit, and **never `npx impeccable update` — npm's "latest" is 3.6.0, a DOWNGRADE** (version-floored by the guard). |
| `hygiene` | "maintenance" / "cleanup" / stale-state or bloat suspicion | main agent (script does the lift) | `scripts/repo-hygiene.ps1` + doc-budget gate; PROCESS-KILL SAFETY rule inside - read it before killing anything named claude. |
| `compy-coverage-sweep` | expanding test coverage (test-only, never prod code) | orchestrator: any · crews: **sonnet** | Disjoint file domains, 3-ring verification gate. |
| `mutation-gate` | ANY diff touching `actions.rs` / `history.rs`, gate flips, elevation | any (it's a checklist) · reviewer dispatch: **sonnet** | 10-item rollback-first contract + required dispatches. Highest-stakes surface in the repo. |
| `gate-drift-audit` | state assertions, after refactors moving cited code, periodic | layer 1: `node scripts/verify-release-state.mjs` (no LLM) · layer 2: **sonnet** worker | RELEASE_STATE.md citation + truth verification. |
| `ship` | after every `npm run tauri build` | any | Silent reinstall is Claude's job; stamp-proof, ONE installer, RELEASE_STATE row, owner report format. |
| `guard-forge` | a defect was caught, BEFORE its fix is claimed done | any | bug→guard law; red→green proof required; tiers: test > rubric > memory. |
| `doc-sync` | any state change; any two docs disagreeing | any | Precedence (RELEASE_STATE=state, CLAUDE.md=law, code>both) + same-commit ordering. |
| `usage-audit` | owner asks about usage/tokens/budget; a 🔴 in `docs/usage-audit/LATEST.md` | layer 1: `node scripts/usage-audit.mjs` (no LLM) · layer 2: any (terse) | Session/token discipline meter. Weekly report auto-written by the `CompyUsageAudit` scheduled task (Mondays, zero tokens). |
| `status` | "where are we" / "what's left" / "show me" / end of any train | dispatcher: any · doc reads: **sonnet** | Added 2026-08-05: >50% of the owner's short messages are status questions and there was no surface for them. Reconstructs from git + the state docs; never answers from session memory. |

### Evaluated and rejected — do not re-add without reading this

- **`emilkowalski/skills`** (review-animations · improve-animations · find-animation-opportunities ·
  animation-vocabulary) — evaluated 2026-08-24 in the design-system lock-in (#214). The strongest
  motion content reviewed, and unlike LottieFiles it **agrees** with `impeccable` on every hard rule
  (ease-out only, GPU props, reduced-motion, restraint). Not added because everything worth keeping
  was **extracted into the toolchain instead** (`~/.claude/CLAUDE.md` §6: guard > prose): its
  mechanizable absolutes the impeccable detector lacked — `transition: all`, standalone `ease-in`,
  `scale(0)` entrances — are now the motion-law test in `src/design-detector-guard.test.ts` (the
  sweep fixed the 3 real `transition: all` hits it found), and its four-question motion gate
  (frequency/purpose/speed/function) is DESIGN.md §Motion. The remainder is review-workflow prose
  duplicating `impeccable animate`/`audit` + the self-review law, at permanent boot cost;
  animation-vocabulary is a naming glossary with no repo use. On-demand:
  `npx skills use https://github.com/emilkowalski/skills --skill review-animations` (et al.).
- **`anthropics/skills` frontend-design** — evaluated 2026-08-24. Greenfield brand/identity guidance
  (pick a subject, signature element, avoid templated palettes) for projects **without** a design
  system; Compy's is LOCKED (DESIGN.md: Instrument cockpit, Hearth palette) and `impeccable`'s
  register system + detector covers the same ground deeper and mechanically. Nothing to extract.
- **`vercel-labs/skills` web-design-guidelines** — evaluated 2026-08-24. A 46-line wrapper that
  **WebFetches its rules from a GitHub URL on every run** — unpinned upstream + network dependency,
  the exact drift class #214 exists to end — and its generic a11y/UX checks are already run locally
  by `impeccable audit` + the theme-contrast/doorknob/border-hygiene guards. Nothing to extract.

- **`LottieFiles/motion-design-skill`** (MIT, docs-only) — added 2026-08-05 (`23c30e8d`), **voided the
  same day**. Not rejected for quality; rejected because it **contradicts `impeccable` on hard rules**
  and two loaded skills issuing conflicting CRITICAL directives is worse than either alone. The
  conflicts: (a) `impeccable/reference/animate.md` bans bounce/elastic easing as dated, motion-design
  prescribes `ease-out-back` + 10–20% overshoot for its Playful/Joy archetypes; (b) `impeccable` warns
  on animation fatigue and cutting decorative motion, motion-design mandates "always three motion
  layers" including an ambient one — wrong for a dense telemetry dashboard. `impeccable` also wins on
  two things motion-design's SKILL.md never covers at all: `prefers-reduced-motion` and GPU/layout
  performance discipline. And it is **wired to a live PostToolUse hook**, so it is mechanical, not
  prose (`~/.claude/CLAUDE.md` §6). What was genuinely better in motion-design — distance-scaled
  duration, stagger budgets, the 1/3 choreography rules, material-based easing — was **not preserved**;
  it is theory no open Compy item is blocked on, and a doc to hold it is exactly the bloat TOKEN LAW
  targets. If a 🔴 UI_VISION_BACKLOG motion item ever needs it, it is one command away:
  `npx skills add LottieFiles/motion-design-skill`.

- **`CloudAI-X/threejs-skills`** (10 skills, docs-only, 2.9k stars) — evaluated 2026-08-05, **never
  added**. Three independent blockers: (1) **Wrong paradigm.** All 11 three.js files in `src/` are
  React Three Fiber declarative (`<Canvas>`, `useFrame`, `@react-three/drei`,
  `@react-three/postprocessing`); all 10 skills are vanilla imperative with **zero** R3F mentions —
  `document.body.appendChild(renderer.domElement)`, manual `requestAnimationFrame` loops,
  `three/addons/postprocessing/EffectComposer.js`. (2) **Teaches a pattern the build bans.**
  `src/idle-motion-guard.test.ts` fails on a `<Canvas>` mounted without `frameloop` (r3f defaults to
  `"always"` = repaints forever); the skill's Quick Start is exactly that unconditional rAF loop. A
  skill that generates code our own tests reject is worse than no skill. (3) **No license**
  (`licenseInfo: null` = all rights reserved, no grant to vendor it), and its README's install command
  points at `pinkforest/threejs-playground` — dead, different owner, `isFork: false`, attribution
  stripped. Plus 10 more description lines on every session boot forever. **For R3F work use the
  `context7` MCP** — current three.js/R3F docs on demand, correct version, zero boot cost.

**Subagent routing (condensed):** haiku = mechanical search/read/format · sonnet = research/verify/
audit/review (the default worker — CC pins it via `settings.json` `CLAUDE_CODE_SUBAGENT_MODEL`) ·
opus = rare, judgment-heavy workers only · fable = never a subagent. Full table:
`docs/COWORK_HANDOFF.md` → Subagent-model orchestration.

## Tier 2 — spec'd, not built (build when the surface goes live; specs are the decisions, pre-made)

1. **`receipts-copy-lint`** — rubric-lint ALL outward copy (compy.gg pages, share cards, Learn
   entries, marketing) against `RECEIPTS_DOCTRINE.md` + `ARCHITECTURE_LOCKS.md` §1.7: the three
   labels stay strictly distinct (Verified / Measured signal / Expected impact); zero unmeasured or
   fabricated claims; measured wins amplified loudly (retired: "your PC is probably fine" defensive
   copy); NVIDIA sensor confidence never upgraded past what a monitored session proves; noise-floor
   deltas reported as "no measurable change". Verdict block per page/string batch. Executor: sonnet.
   **Build when:** Phase-1 Library→web content work starts.
2. **`new-tester-onboarding`** — per `NVIDIA_VALIDATION_PLAN.md`: ingest a tester export → grade
   exactly which confidence labels that export licenses upgrading (detection vs apply vs NVML sensor
   vs monitored-session), produce the doc/tooltip diffs, and list what STAYS unverified. Guards LOCKED
   rule 5 mechanically. Executor: sonnet. **Build when:** the next tester export lands.
3. **`council-strip`** — `docs/COUNCIL_PROTOCOL.md` (~line 50) already carries the paste template;
   only build a skill if strips start getting skipped in marathon logs. Executor: any.
4. **`receipts-arming-review`** — stop-rule-3 runbook for arming the telemetry boundary: payload
   sanitize/bucket verification, consent UI + preview + kill-switch checks, endpoint/queue review,
   sign-off checklist. Executor: opus worker + owner decision. **Build when:** owner schedules
   Receipts arming. The signed updater is already live; Receipts is a Tier 2 precursor and must not
   inherit updater or Tier 1 approval.

## House rules for adding skills

Terse, imperative, evidence-required verdict block; the `description:` frontmatter states concrete
triggers (it's what fires the skill); heavy evidence gathering dispatches to a cheap worker, only the
verdict returns; the name states the domain; update THIS index in the same commit.
