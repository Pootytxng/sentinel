# Sentinel — Technical Audit (2026-06-04)

*A full sweep for vulnerabilities, loose ends, and unfinished work — the residue of a fast,
sometimes-chaotic build. Severity tags: 🔴 address before public release · 🟡 watch / hygiene ·
🟢 fine by design / informational.*

---

## A. Security posture — the good news first (it's genuinely strong)

- 🟢 **No network egress, at all.** There is no HTTP client dependency in `Cargo.toml` (no reqwest /
  ureq / hyper). The remote-rules fetch is a stub that returns `None` (`remote_rules.rs:359`), and
  the CSP locks `connect-src` to `'self' ipc:` (`tauri.conf.json:43`). Sentinel is truly local-first
  today — nothing leaves the machine.
- 🟢 **No secrets in the repo.** The rules-signing key is the *public* key only, currently the
  all-zeros placeholder (`remote_rules.rs:84`), guarded by a hard-fail: while it's all-zeros, every
  manifest is rejected (`remote_rules.rs:235`). Verification is real (`ed25519-compact`), there is no
  private key anywhere.
- 🟢 **Elevation model is sound.** Sentinel never runs itself elevated. Each elevated mutation spawns
  a one-shot elevated PowerShell child via UAC (`actions.rs:246 run_elevated_powershell`), so the
  app's own attack surface stays unprivileged and every elevated step is an explicit user consent.
- 🟢 **No kernel driver, no game injection.** All telemetry is vendor libraries (NVML, ADLX), OS APIs
  (PDH, WMI, DXGI, ETW), or read-only interop (HWiNFO shared memory). Anti-cheat-safe by construction.
- 🟢 **Strong CSP** (`default-src 'self'`, `script-src 'self'`, `object-src 'none'`,
  `frame-ancestors 'none'`). Only `style-src` allows `'unsafe-inline'` (normal, low risk).
- 🟢 **Mutations are snapshot-first + reversible** (Trust Ledger), and the A-B trial wraps applied
  changes in a `Drop`-guard so a measurement can never leave the rig changed — even on panic
  (`benchmark_trial.rs:132`). Panic safety is intact because we do **not** use `panic = "abort"`.
- 🟢 **`gaming_mode_gate()` is still `false`** (`lib.rs:188`) — the mutation feature has not been
  self-flipped; it correctly waits on owner QA.

## B. Security watch-items (not exploitable today, but the sharp edges)

- ✅ **Elevated PowerShell built by string interpolation — ADDRESSED (`0315181`).**
  `run_elevated_powershell` takes a `format!`-built command, e.g. `Set-Service -Name {} -StartupType
  {}` with `service.name()` interpolated. Today every interpolated value comes from a hardcoded
  curated catalog, so it was not exploitable — but it was the highest-leverage *future* vulnerability
  (elevated command injection if any token ever came from remote rules / user input). Now hardened:
  `actions::ps_safe()` validates every interpolated token against a `[A-Za-z0-9_.-]` whitelist
  (rejecting every shell metacharacter) at all six interpolation sites, with tests. The Ed25519
  signed-manifest infra remains the complementary defense for the remote-rules case (built; fetch
  disabled).
- 🟡 **37 `unsafe` FFI blocks** across 6 files — `amd_freesync.rs` (12), `latency.rs` (11),
  `cpu_temp.rs` (5), `hardware.rs` (4), `benchmark.rs` (3), `fps.rs` (2). All are vendor COM /
  memory-mapped / Win32 calls following a canary + `read_unaligned` + fail-soft-to-`None` pattern.
  The live-validated ones (FreeSync on RX 9070 XT, HWiNFO reader) don't crash. Residual risk: a
  driver/format change shifting an offset → UB/crash. The **least live-validated is `latency.rs`**
  (its GUI path is still unverified — see D.3), so that's where an untested offset would bite first.
- 🟡 **`adlx = "=0.0.0-alpha.1"`** — a pinned pre-1.0 alpha crate (Traverse Research) doing COM FFI
  into the AMD driver. Riskiest dependency (alpha API, small maintainer surface). Exact-pinned (good),
  and we already hand-write the FreeSync vtables because the crate stubs them — so we partly bypass it.
- ✅ **Dependency CVE scan run (`cargo audit`, 2026-06-04): 0 vulnerabilities.** 17 advisory
  *warnings*, all transitive and irrelevant to the shipped Windows binary: 11 are the Linux GTK/glib
  GUI stack (`gtk`/`gdk`/`atk`/`gdkx11`/`gdkwayland-sys`/… + `glib` `VariantStrIter` unsoundness) that
  Tauri pulls for the Linux target but doesn't compile/ship on Windows; 6 are unmaintained build/
  transitive helpers (`unic-*`, `proc-macro-error`). Nothing exploitable on the user's PC. Remaining
  🟡: to make `cargo audit` a clean CI gate, add an `audit.toml` ignoring these known-noise advisory
  IDs so a real future CVE stands out.

## C. Loose ends (chaos residue / code hygiene)

- ✅ **Stale module comments in `lib.rs` — FIXED (`0315181`).** Lines 6–9 and 18 described
  `benchmark` / `benchmark_verdict` / `benchmark_scoreboard` / `benchmark_trial` / `latency` as
  "PARKED + DARK / not registered" — but they're all wired (Benchmark + Latency tabs, Score card,
  trials). Comments now state what's live vs. still dark.
- 🟡 **Blanket `#![allow(dead_code)]`** at the top of `benchmark.rs`, `latency.rs`,
  `benchmark_verdict.rs`, `benchmark_scoreboard.rs`, `benchmark_trial.rs`. These made sense while the
  modules were dark, but now that they're partly wired the module-wide allow **masks the genuinely
  unused items** (e.g. `percentile_rank`, `completeness_pct`, the latency Correlate engine, benchmark
  normalization constants). Better: drop the module-level allow and `#[allow(dead_code)]` only the
  specific still-unused items, so real dead code stays visible and tracked.
- 🟡 **Placeholders that are real unfinished work:**
  - `benchmark.rs:260,443` — score normalization (0..100) + reference constants are PLACEHOLDER and
    untuned. Safe because the UI de-emphasizes the absolute score and uses the **delta** (which
    cancels normalization), but the absolute number is meaningless until tuned.
  - `remote_rules.rs` — HTTP fetch stub + all-zeros pubkey. The entire remote-rules track is
    non-functional by design (safely off).
  - `latency.rs:681` — TODO: measure **real** HID polling rate by timing report intervals (current
    reading is approximate). Directly relevant to the earlier "is my mouse at 1000 Hz?" question.
- 🟢 `history.rs:205` — unknown rec types return "not yet supported for one-click apply"; some catalog
  entries are advisory-only by design.

## D. Unfinished tasks / pending owner actions (the "forgot about it" list)

- 🔴 **Gaming Mode** — fully built, merged, behind `gaming_mode_gate()=false`. **Pre-QA review
  (2026-06-04): restore/recovery logic verified sound** (contract-before-mutation, atomic writes,
  best-effort restore-all, never-false-success, idempotent re-run, full orphan coverage); **one gap
  found + closed** — recovery now greets the user **globally on launch** (`df0013c`), not just when
  the Gaming tab is opened. Remaining: owner runs the spec §7 mutation QA on a UAC-on machine (8
  scenarios: normal · app-crash · reboot · game-exit · UAC-cancel-on-start · UAC-cancel-on-restore ·
  missing-plan · external-plan-change) + sign-off → **then** flip the gate. (Claude must not
  self-flip a mutation gate.) Biggest built-but-unshipped item; now QA-ready.
- ✅ **§1.7 PresentMon — COMPLETE (owner-confirmed validated 2026-06-04).** The "ambiguous status" was
  a stale note. Decision done + owner-confirmed (`3076f02`); seam built + live
  (`benchmark_trial::start_tweak_trial` measures real game frametimes — 1%/0.1% lows via the `fps.rs`
  ETW helper — before/after a tweak → Keep/Revert/Inconclusive with 95% CI + 3% noise floor); and the
  owner confirms it's validated end-to-end. Intel's PresentMon binary is not required (home-grown
  DXGI-ETW capture satisfies §1.7). Closed.
- 🟡 **Latency tab GUI validation** — the tab + "Measure wake"/"Measure mouse" buttons need a live
  look; known wart: those two on-demand buttons briefly freeze the UI (sync commands on the STA
  thread). Easy `spawn_blocking`/async follow-up.
- 🟡 **Latency real capture (Stage 1–2)** — the Correlate engine + capture-processing core are landed
  but dark; the elevated ETW kernel-session wiring (the actual DPC/latency capture) is **not wired**.
  Substantial unfinished feature.
- 🟡 **Benchmark absolute-score tuning** — normalization placeholders (see C).
- 🟡 **Scoreboard P4** — cross-user efficacy sharing (cohort/anti-spoof). Not built; it's Sentinel's
  *first* network egress, a deliberate opt-in/anonymous owner decision.
- 🟡 **VRR Phase 2b** (AMD `SetEnabled` write — toggle FreeSync, not just read) and **NVIDIA NVAPI**
  VRR — future.
- 🟡 **Live validations pending**: the tweak A-B trial leaving the rig clean (owner). The proposed
  Readiness "RAM headroom" check is **decided: SKIP** (owner, 2026-06-04) — the live RAM warning is
  sufficient; a free-RAM-when-idle Readiness row would be misleading.
- 🔴 **Public-release blockers**: code-signing cert (~$10/mo) + a legal/privacy pass. Until signed,
  users hit SmartScreen warnings.
- 🟢 **`SENTINEL_OVERVIEW.md`** is untracked — decide commit vs. keep-local.

## E. Robustness / quality

- 🟡 **~75 `unwrap()`/`expect()`** (lib 16, actions 11, latency 10, remote_rules 8, monitoring 7…).
  Most are `Mutex::lock().unwrap()` (only fails on poisoning) or test code — low risk. But unwraps in
  command paths can panic; Tauri returns a command panic as an error (and the Drop-guard survives,
  since not `panic=abort`), so it's not fatal — still, the elevated-mutation path (`actions.rs`) and
  the FFI path (`latency.rs`) deserve a pass to convert to graceful errors.
- 🟢 **Test coverage**: 186 Rust lib tests + 52 frontend, solid on the pure logic. Inherent gaps are
  the FFI/live paths (ADLX, HWiNFO, ETW, elevated mutation) — unavoidably validated live, some still
  pending.

---

## Recommended order

1. ✅ Harden elevated-PowerShell construction — **done (`0315181`)**.
2. 🟡 Remaining hygiene: replace blanket `#![allow(dead_code)]` with targeted allows (deferred —
   churn-prone; better done when the dark items are wired or cut); add `cargo audit` to CI (deferred
   — installing it is a heavy build, avoided mid-gaming-session). Stale `lib.rs` comments ✅ fixed.
3. 🟡 Reconcile the §1.7 PresentMon status; answer the open Readiness-RAM question.
4. 🔴 Owner: Gaming Mode §7 QA → gate flip. (Gates real value already built.)
5. 🔴 Pre-public: signing cert + legal pass.
6. 🟡 Then the feature backlog (latency capture, benchmark tuning, scoreboard P4, VRR 2b/NVAPI).
