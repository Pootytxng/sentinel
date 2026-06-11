# Technical Audit — 2026-06-11 (diagnosis only, nothing changed)

**HEAD:** `c6c7a01` · **Method:** every tool actually run (no inference): `cargo test`,
`cargo clippy --all-targets`, `npm test`, `tsc --noEmit`, `vite build`, `npm audit`, plus the
/security pattern sweep and targeted greps with production/test code separated.
**Scope rule honored:** no code changed, actions.rs untouched, frozen refs/gates untouched.

## Tool results (ground truth)

| Tool | Result |
|---|---|
| `cargo test` | **266 passed / 0 failed / 4 ignored** (all 4 legitimately gated: ADLX hardware probe, 2× manual UAC QA, interactive mouse poll) |
| `cargo clippy --all-targets` | **zero warnings** (including test code) |
| `npm test` | **240/240**, 50 files |
| `tsc --noEmit` | clean |
| `vite build` | clean — single JS chunk **495 kB** (gzip 153 kB) |
| `npm audit` | **0 vulnerabilities** |

## Findings — ranked by severity · reversibility

### HIGH

**H1 · Trust Ledger write is non-atomic AND corrupt-load is silently empty** — the one real
rollback-integrity risk found.
- `history.rs:184-187` — `save_history_to` does `std::fs::write` **in place** on `history.json`.
  A crash/power-loss mid-write can leave a torn/truncated file.
- `history.rs:169-177` — `load_history_from` on unparseable JSON returns `Vec::new()`
  **silently** (`.ok()…unwrap_or_default()`). The next apply/rollback then SAVES over the
  corrupt-but-recoverable file → **permanent, unnoticed loss of every rollback contract for
  currently-active changes.** For a rollback-first product this is the core promise at stake.
- Probability low (torn write on a small file), impact maximal, **fix small + fully reversible**:
  write to a temp file + `rename` (atomic same-volume), and on parse failure preserve the bad
  file as `history.json.corrupt` + fail loud instead of returning empty. Same in-place pattern
  (lower stakes — no undo data) in `sessions.json` / `drift.json` / benchmark stores.
- NOT fixed here per the report-only mandate; recommend this as the first treatment.

### MEDIUM

**M1 · Frontend test gaps cluster on the live measurement surfaces.** Untested (0 test files):
`Benchmark.tsx` (508 lines — orchestrates runs/polling), `SessionDebrief.tsx` (381),
`Latency.tsx` (180), `FirstCheck.tsx` (168 — the first-run arc), plus render-only smalls
(`HardwareGrid` 197, `ScanStream`, `TuningGuide`, `TuningVerdict`, dark-gated `GamingMode`).
The mutation-adjacent surfaces (Fix, Check, Play, Settings) ARE tested. Reversible: additive tests.

**M2 · `diagnostics.rs` (254 lines) and `gaming_orchestrator.rs` (149) have zero unit tests.**
Diagnostics is read-only but Export consumes its shape; the orchestrator is dark-gated (and
`gaming_session.rs` underneath it has 6 tests) — still, it's the only mutation-adjacent module
with none of its own. Reversible: additive tests; orchestrator already rides the F1 QA gate.

**M3 · Bundle/dead-code debt: one 495 kB chunk at vite's warn threshold; App.tsx = 3,022 lines
still carrying the retired classic surfaces** (default-off since the v2 flip; the preview-flag UI
is already gone). The recorded post-beta cleanup (retire classic surfaces) would cut both this
and the dead-code surface in one stroke. Reversible: deletion behind git history.

### LOW

**L1 · 7 production `.lock().unwrap()` on the FPS status mutex** (`monitoring.rs:730-1004`).
Accepted project pattern (process-local, poison ≈ impossible for a string store), but a poisoned
lock would cascade-panic all status reads; `unwrap_or_else(|p| p.into_inner())` would degrade
gracefully. Cosmetic hardening. (Only other prod expect: `recommendations.rs:175` on the
compile-time-embedded baseline rules — fail-loud-at-boot is correct there; note, not a finding.)

**L2 · Seven independent frontend pollers** (overlay 500 ms, App monitoring tick + Play 1 s,
backdrop 1.5 s [already gated to step-aside], benchmark 2 s ×2, cosmetic carousels 2.2/2.8 s).
All have cleanups; none leak. Event-push consolidation is a recorded future idea, not debt.

**L3 · One real TODO in production code:** `latency.rs:777` — verify real HID polling rate by
timing report intervals (known "deeper increment"). Honest as shipped (current readout is
capability-qualified).

**L4 · Security-skill doc drift:** `/security` skill text says "CSP is null for the trusted
beta" and "capabilities: core:default + opener:default only" — **reality is stricter/different**:
config carries a strict CSP (`default-src 'self'`; loose CSP is dev-only `devCsp`) and
capabilities also include `notification:default` + 3 fixed `ms-settings:` opener URLs. Future
audits should judge against reality; refresh the skill text. (Doc-only.)

## Security observations (whole-repo sweep — clean)

- **Network: zero.** No HTTP/socket crates in `Cargo.toml`, no `reqwest|ureq|hyper|TcpStream`
  hits in source. Remote-rules gate remains **absent-by-construction** (`remote_rules.rs:96` —
  no pubkey const, no cfg flag exists to flip), so beta cannot accidentally arm it.
- **Process spawns (5 sites, all fixed/typed args):** `explorer` on a fixed exports dir;
  FPS helper = `std::env::current_exe()` self-spawn; `runas` elevates literal
  `powershell.exe` with scripts from the typed action layer; `actions::quiet_command(program)`
  is called only with literal program names (powercfg/sc/logman/powershell). No webview string
  reaches any spawn.
- **Webview injection: zero** `dangerouslySetInnerHTML|innerHTML|eval|new Function` in `src/`.
- **Capabilities tight** (core/opener/notification defaults + 3 fixed ms-settings deep links);
  strict CSP in config — the recorded pre-public gate is to *verify* it under a packaged build.
- **unsafe: 31 blocks across 7 FFI files** (ADLX/GDI/DXGI/ETW/HID) — all vendor-API-bounded,
  none added by recent waves; no new findings on spot-check.
- **Panic surface in safety-critical modules: zero.** actions.rs, history.rs, lib.rs,
  latency.rs, fps.rs, remote_rules.rs have **no** production unwrap/expect (all 131 repo hits
  are in `#[cfg(test)]` mods except the 8 benign ones covered in L1/L2 notes).
- No secrets/keys in the repo (pattern sweep clean).

## Honest-measurement / rollback-integrity spot-checks (clean, beyond H1)

- Rollback resolves from `history.json` alone; legacy-synthesis + stored-plan-GUID fidelity are
  regression-tested (the `070c3c9` contract). Apply paths snapshot before mutation.
- 1%-low is labeled estimate everywhere it appears; Export sessions say "live estimates, not
  benchmark-grade proof"; tuning verdicts filter inside `measureTuning` (test-pinned); the
  driver-freshness advisory states age as fact and "newer" only as a maybe; overlay frametime
  scale is fixed (never auto-stretched noise).
- Catalog frozen: appliable dispatch in `history.rs` matches `APPLIABLE_REC_IDS`; no blocklist
  tweak present.

## Count

**1 HIGH · 3 MEDIUM · 4 LOW** (plus 2 explicit notes). Recommended treatment order:
H1 (atomic ledger write + loud corrupt-load) → M1/M2 (tests) → M3 rides the recorded post-beta
classic-surface retirement. All findings are reversible, additive fixes; none touch locked gates.
