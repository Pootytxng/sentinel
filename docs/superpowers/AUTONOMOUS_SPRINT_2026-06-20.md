# Autonomous overnight sprint — 2026-06-20

Owner asleep (~a few hours), directed an unattended, self-sufficient, council-guided, sub-agent-driven
marathon. Branch: `auto/overnight-2026-06-20` (off `main` @ `aee0f64`). **NOT pushing `main`** while the
owner sleeps — everything accumulates here for a ranked review queue on return.

## Guardrails (unattended = conservative)
- Reversible only. Locked gates UNTOUCHED: frozen beta refs (`16069fa`), remote-fetch/updater stay off,
  no secrets, no kernel/injection, frozen tweak catalog, security/system settings owner-gated.
- No shared-`main` push; no rebuild/reinstall churn of the running installed app (batch for return).
- Verification never skipped (cargo/npm/clippy/tsc + guards). Self-review law on anything visual.
- Don't duplicate Cowork's lane (strategy/specs/review). I'm CC = build/git.

## Council strip (5 lenses)
- 🔴 **Contrarian:** unattended → highest breakage risk. Favor tests + read-only audits + tiny reversible
  polish. AVOID big deletions (classic-surface retirement), mutation/elevation/gate touches, `main` pushes.
- 🟢 **First-Principles:** 1.0 bar = correctness · honesty · polish · hardening. Safest high-leverage work
  needs no owner taste call: test coverage, correctness/honesty audits, design-law guard enforcement.
- 🟢 **Expansionist:** build a durable safety net (tests) + a findings backlog the owner can act on; fan
  sub-agents out on audits in parallel.
- 🟢 **Outsider:** don't break what just shipped — make it MORE solid; no groggy-morning regressions.
- 🟢 **Executor:** anchor on the coverage-sweep skill (parallel sub-agents, verification-gated, tests-only);
  then guards/clippy/tsc; then read-only honesty + a11y audits → small fixes; SPEC the risky retirement.

## Backlog (value × safety, unattended order)
1. **Coverage sweep** — unit tests for untested pure-logic modules (TS helpers + Rust parsers). Tests-only,
   sub-agent-driven, three-ring verification. ANCHOR. [in progress]
2. **Guard/lint sweep** — run every CI guard (theme-literal, contrast, border-hygiene, sweep, homeRail
   parity, design-law) + tsc + clippy `-D warnings` + cargo test; fix violations.
3. **Rust correctness pass** — clippy clean; review recent Rust for panics/edge cases; small fixes + tests.
4. **Honesty audit** (read-only sub-agent) — sweep copy/surfaces for any unmeasured/fabricated claim or
   un-surfaced drift; log findings + small fixes.
5. **A11y audit** — keyboard/focus/dialog semantics on new surfaces (onboarding, Tune gaming section,
   Settings motion); small fixes.
6. **UX polish** (self-reviewed; needs a dev build) — tasteful touch-ups; later (may close the installed app).
7. **Classic-surface retirement** — write a SPEC for owner review; DO NOT execute the big deletion unattended.
8. **/simplify** on the session's changed code — safe reuse/clarity cleanups.

## Log
- Setup: branch + this log created (`aee0f64` base).
