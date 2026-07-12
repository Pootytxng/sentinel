# 2026-06-12 — R5 UNATTENDED MARATHON (Cowork-specced, owner resting)

> Owner is stepping away to rest and wants CC self-sufficient for as long as possible. This is the
> work order. SPORT MODE, fully unattended. Build → verify → commit → push → next; batch ALL
> questions/decisions into the Review Queue. Work the lanes IN ORDER, each to completion or until it
> hits a STOP, then move on. Never block on a reversible check-in. Depth over speed. Verification is
> NEVER skipped. Read CLAUDE.md + docs/COWORK_HANDOFF.md + docs/COUNCIL_PROTOCOL.md +
> docs/PRODUCT_DIRECTION.md + docs/RECEIPTS_DOCTRINE.md + §B of
> docs/superpowers/specs/2026-06-12-doctrine-voice-baptism-design-refresh.md first; trust them over
> assumptions; verify file/line claims against current code before asserting.

## HARD GATES — do NOT cross. Hit one → log it to the Review Queue and SKIP, never act.

- **No gate flips.** `gaming_mode`, Receipts telemetry, `proGate`, `restore_gate`, `remote_fetch`,
  the updater — all stay hard-false / OFF. No capabilities / CSP / network / outbound changes. The
  verified zero-outbound property must hold.
- **No new mutation.** `actions.rs` mutation+rollback boundary untouched; no new `apply_*`;
  rollback-first intact. New mutating features need their own attended QA — NOT this run.
- **Frozen tweak catalog (~29 appliable recs).** No new appliable tweaks; no blocklisted
  optimizer-rot (timer/HPET, bcdedit, MMCSS, core-parking, Defender-disable, MPO-disable, fixed
  pagefile, TCP/NIC packs, AI-arbitrary actions). Advisory **Blackbook KNOWLEDGE** entries MAY grow
  (Lane 2) — that is library growth, not catalog growth.
- **Owner territory = STOP + log, never act:** new theme hexes / colors (taste), naming or labels
  not already owner-approved, money, tester sends / hosting, anything irreversible.
- **Security/system settings:** never touch — not reversibly, not to diagnose. Read-only probes only.
- **Frozen refs** `16069fa` / `beta/private-beta-001` untouched; **no force-push**; secrets never
  enter the repo / `.env*` / CI.
- **NVIDIA sensor confidence** stays at hardware-proven only (vendor-honesty rule #5). Don't upgrade.
- **Leave the deploy alone** — `dist-site/` + Cloudflare Pages is Cowork's lane. Do NOT regenerate
  the site or touch `dist-site/`.

## LANE 1 — §B app VISUAL REFINEMENT (marquee; reversible, NON-taste only)

Per the §B spec: polish the EXISTING Instrument system for appeal without structural reversal —
typography scale + hierarchy, spacing/rhythm, card & density polish, iconography consistency,
micro-interaction restraint (single-shimmer / single-glow law, CI-guarded), empty states that sell
the next action. **Stay inside existing theme tokens.** If a refinement wants a NEW hex/color, do
NOT invent it — log it as an owner taste call in the Review Queue and move on. Go surface by
surface: Home/CommandCenter · Check · Play · Tune · Blackbook(Learn) · Lab · Settings · overlay.
For each: make the reversible refinement, keep all copy in receipts voice + the Sarah & Caleb
plain-language bar, **commit per surface**, and log exactly what the owner should EYEBALL (this is
his taste-gate). NOT in scope (that's §C, gated): IA/rail restructure, theme replacement, mockups.

## LANE 2 — BLACKBOOK / LIBRARY growth (content = the monetization engine)

Add several NEW honest KNOWLEDGE entries to `src/data/knowledge.ts` — debunks of popular myths,
plain-English terms, or guides. All-original (our words, never copied), graded honestly
(Real / Placebo / Risky), Sarah & Caleb bar (jargon never defined with jargon; plain ≠ vague),
receipts voice. Each must pass the knowledge lint tests. Advisory entries ONLY — no new appliable
tweaks. These auto-grow the site `ENTRY_COUNT` on the next regeneration — but do NOT regenerate the
site here (Cowork owns the deploy); just grow the data + its tests.

## LANE 3 — HARDENING / a11y / tests / law-guards

Edge + property tests on pure modules; a11y semantics passes on any surface touched in Lane 1;
extend CI law-guards (voice guard, jargon guard, design-law guards) to catch regressions. All
additive / reversible.

## LANE 4 — DOC + small-nit cleanup

Reconcile stale counts in docs (the 116 → 120 → 130 drift), dead-code/lint cleanups, any board nit
that is reversible and non-taste.

## PER-LANE, ALWAYS

- **Verify before every commit:** `cargo test --manifest-path src-tauri/Cargo.toml` · `npm test` ·
  `cargo clippy -- -D warnings` · `tsc` · `vite build` · then `/check` + `/security` on the phase.
  Suites must stay **≥ current green (cargo 329 · npm 298)** — never regress.
- **Commit per logical unit** (small, reversible, additive); push to `main`; frozen refs untouched.
- **Log** to `docs/archive/AUTONOMOUS_SPRINT_2026-06-12-R5.md` (use next free R-number if R5
  collides): per lane → what/why · commit hashes · one verify line · what the owner must
  eyeball/decide.
- **Close each lane with a 6-line COUNCIL STRIP** (Contrarian / First-Principles / Expansionist /
  Outsider / Executor / Chairman) per COUNCIL_PROTOCOL.md. A Contrarian 🔴 (funnel/trust risk) opens
  that lane's log section.

## STOP / REPORT

When all lanes are exhausted or every remaining item is owner-territory-blocked: write a final
**OWNER REVIEW QUEUE** (everything awaiting his taste/money/people/irreversible call, ranked) + a
final council strip, then stop. Report back TERSE: log path · total commits · final suites line ·
Review-Queue item count.

**Final verify line:** cargo + npm green at the reported counts · clippy/tsc/vite clean · /check +
/security clean · `git log --oneline` shows the lane commits on `main` · `git rev-parse 16069fa`
unmoved · `dist-site/` untouched.
