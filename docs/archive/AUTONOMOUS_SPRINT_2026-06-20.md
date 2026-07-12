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
- **[1] Coverage sweep DONE** (`3c1b928`) — 5 parallel sub-agent crews, tests-only, disjoint files.
  Full vitest **389 → 467 (+78)**; tsc clean; doctrine guards pass on the new test files. Files:
  use-motion (24), manual-parts (23), use-rig-colors (6), guided (13, SECURITY allowlist), rec-mutations (12).

## Review queue (for the owner, ranked)
1. **guided.ts allowlist tests (HIGH-STAKES, security)** — the new `guided.test.ts` pins the
   `openGuidedUri` allowlist (only the 3 fixed `ms-settings:` deep links open; off-allowlist/scheme/
   whitespace-mutated all rejected; allowlist derived from `GUIDED_STEPS`, no drift). No bypass found.
   Nod that this is now canon.
2. **Finding — `recMutation` prototype lookup** (NOT fixed): `REC_MUTATIONS[id] ?? null` over a plain
   object returns a prototype member for ids like `"toString"`. Harmless today (no rec id collides);
   hardenable via `Object.hasOwn`/null-proto map. Owner call whether to harden.
3. **Doc nit — use-rig-colors** comment says "faint ink" but the returned field is `ghost`.
4. **Classic-surface retirement SPEC** (`3876d65`, `docs/superpowers/specs/2026-06-20-retire-classic-surfaces.md`)
   — DRAFT for review; one decision inside (keep the Fix preview escape hatch?). Recommend landing as a
   small reviewed train with an `App.test.tsx` integration net first. NOT executed (too big for unattended).

## Log (cont.)
- **[2] Guard/lint sweep** — full vitest guards pass; tsc clean.
- **[3] Rust correctness** (`c80adaf`) — clippy now CLEAN (fixed `manual_range_contains` on the fan-RPM
  bounds, byte-identical semantics); cargo test green (~419) + build zero-warning.
- **[4] Honesty audit** — sub-agent swept the user-facing surfaces/copy: **Grade A, no findings.** NVIDIA
  stays "not hardware-verified", no fabricated promises, drift surfaced honestly, retired copy stays retired.
- **[5] A11y audit + fixes** (`b3f3912`) — focus/label/Esc/aria on the session's new surfaces (SetupTour,
  GamingMode consent modal, Fix details, Settings theme). Invisible; tsc clean; vitest 467.
- **[7] Retirement SPEC** written (`3876d65`).
- **[8] Coverage batch 2 — Rust pure parsers** (`7e1777f`) — +33 tests on hardware.rs parsers
  (parse_cpu_arch / intel_arch_for_gen / intel_family_label / parse_smbios_strings /
  parse_smbios_memory_devices). cargo **415 → 448**; build + clippy clean.

## Review-queue additions (batch 2)
5. **hardware.rs parser tests (review)** — pin the CPU-arch/SMBIOS heuristics. Findings (real behavior,
   NOT changed): AMD arch keys off the first model digit only (ignores U/H mobile suffix); Intel 3-digit
   Ultra maps a leading `2` → 15th/Arrow Lake; classic Xeon `E5-2xxx` → None; `parse_smbios_strings`
   drops an unterminated trailing string. Owner call whether any heuristic should change.

## NIGHT SUMMARY (handoff)
Branch `auto/overnight-2026-06-20` — **NOT pushed to `main`** (your call on return). All reversible.
- **+111 tests** (TS 389→467, Rust 415→448). tsc clean · full vitest 467 · cargo 448 · clippy clean.
- Commits: `4f7693f` plan · `3c1b928` TS coverage(+78) · `c80adaf` clippy fix · `3876d65` retirement
  spec · `b3f3912` a11y fixes · `7e1777f` Rust coverage(+33).
- Honesty audit: **Grade A, no findings.** Frozen beta refs / gates / remote-fetch / updater untouched.
- **To land it:** review the queue above, then (from a worktree on this branch)
  `git push origin auto/overnight-2026-06-20:main` is a clean FF over `aee0f64` — OR cherry-pick. Then
  one installer rebuild for the installed app. The classic-surface retirement stays a separate reviewed train.
