# Fable 5 marathon — standing order + reversible backlog — 2026-06-11

**Owner directive 2026-06-11:** loose CC-on-Fable-5 for a long, *paced + thorough* autonomous run to
get the most out of the model. Scope = the **reversible backlog** below, **rails ON.** The rails are
not post-beta timing — they are exactly what makes an unattended marathon safe to leave running.

## The honest lock map (the answer to "what can we unlock?")
- **Pure timing / parking — UNLOCKED for the marathon.** The read-only/advisory feature backlog,
  test-gap fills, hardening, classic-surface retirement, bundle split. All reversible, in-lane,
  honest-law-compatible. ← the marathon runs here, and it's a big stretch of open road.
- **Genuine necessity, NOT timing — stay locked (Fable may BUILD dark, never SHIP/FLIP).** Mutation
  ship/flip (Gaming Mode flag, Leftovers v2 restore, per-game profiles) rides its own apply/rollback/
  crash-safety QA on a real UAC rig + owner sign-off; remote-fetch/updater arming needs signing infra
  + CDN that don't exist yet; the tweak catalog stays frozen against risky tweaks (the moat is what it
  refuses); NVIDIA/Intel sensor confidence needs real hardware (honesty law). Build behind a
  default-off gate = fine; flipping/shipping = owner-gated.
- **Absolute safety rails — NEVER, marathon or not.** Security/system settings (UAC/EnableLUA/CPBA,
  Defender, firewall, `HKLM\...\Policies`) — never autonomous, even reversibly, even to diagnose (the
  *window* of weakened security IS the risk; Fable's own safety layer halts here — treat a model-flip
  as a STOP signal). Signing keys / secrets in the repo. Frozen refs (`16069fa` /
  `beta/private-beta-001`), force-push, history rewrite. Kernel driver / game injection (architectural
  identity + anti-cheat safety). Rollback-first integrity (the soul — never apply what it can't undo).

## Per-item discipline (paced + thorough — this is the "still methodical" part)
Build → `cargo test --manifest-path src-tauri/Cargo.toml` + `cargo clippy --all-targets -- -D warnings`
+ `npx tsc --noEmit` + `npx vite build` + `/security` → **ONE reversible commit per item** → append a
log line below (what · hash · verify) → next. No batching items into one commit. If an item is bigger
or forkier than scoped, log a one-line note and move on — don't rabbit-hole. Rigor never drops; "loose"
means fewer check-ins, not less verification.

## STOP + welfare-check the owner the moment an item would touch ANY rail above. Otherwise proceed + report.

## Backlog (priority order)
1. **Leftovers detector v1** — spec `docs/superpowers/specs/2026-06-11-leftovers-detector-v1-build.md`
   (+ charter `2026-06-06-leftovers-rot-detection-brief.md`). Read-only; framework + the 2 proven
   detectors (fixed pagefile, memory-compression-off). After it commits, run `npm run tauri dev` so the
   owner can eyeball the new Check section live.
2. **Audit M1 / M2** — fill the test gaps: `diagnostics.rs` first, then Benchmark / SessionDebrief /
   Latency / FirstCheck. Additive tests only.
3. **Audit L1 + L4** — graceful FPS-mutex poison handling (`unwrap_or_else(|p| p.into_inner())`);
   refresh the `/security` skill doc to the real CSP + capabilities.
4. **Leftovers detectors 2–8** — bcdedit timer flags / MMCSS-SystemResponsiveness / core-parking /
   Defender-policy-off / MPO / NIC-TCP autotuning / Win32PrioritySeparation. Read-only, each
   fixture-tested; bcdedit degrades to "needs admin to check" honestly.
5. **Latency "name the guilty device"** — deepen `latency.rs` (+ its TODO:777). Read-only diagnostic depth.
6. **Driver win-source** — extend the freshness advisory beyond GPU; honest "newer exists" + copyable vendor link.
7. **M3 — retire the redundant classic surfaces** — deletion behind git history; tests stay green; the
   bundle-split it enables (cuts the 495 kB chunk + dead code).

## Running log (Fable appends — what · commit · verify)
- Item 1 Leftovers v1 — framework (rule-#7 endorsement gate, unreadable≠clean) + pagefile +
  memory-compression detectors, on-demand Check section, 1 read-only IPC · `f0f5eb1` · cargo 275
  (+7) · npm 242 (+2) · clippy -D warnings · tsc+vite clean · /security clean (no args on the new
  command, fixed-literal PS read, zero mutation). Note: no Learn entry exists yet for
  memory-compression (WhatsThis auto-hides); pagefile maps to the existing pagefile-disable autopsy.
- Item 2 audit M1/M2 — diagnostics.rs structural contracts (+5) + Latency/SessionDebrief/Benchmark/
  FirstCheck render-honesty tests (+11), additive only · `726cf4a` · cargo 280 · npm 253 · clippy
  -D warnings · tsc+vite clean · /security N/A-clean (test-only diff, zero production change).
- Item 3 audit L1+L4 — lock_status() poison-recovery helper over the 7 FPS-status unwraps ·
  `4fa6c31` · cargo 280 · npm 253 · clippy -D warnings · tsc+vite clean. L4: /security skill doc
  (in ~/.claude/skills, OUTSIDE the repo) corrected to the real strict CSP + capability set
  (core/opener/notification + the 3-URL ms-settings allowlist) — future audits judge reality.

## Owner-deferred (taste / money / mutation-ship — Fable parks here, owner decides)
- Leftovers user-facing name ("Leftovers" recommended). Pricing shape (Q4). Any mutation flip/ship.
