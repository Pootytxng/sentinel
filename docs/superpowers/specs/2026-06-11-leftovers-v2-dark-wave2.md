# Leftovers v2 — dark resolver wave 2 — 2026-06-11 (owner AFK ~1h; Cowork-directed, within rails)

Continues R2-5 (the first 3 dark resolvers, `9cfec24`). Same discipline, same gates: **everything
here stays DARK** (`restore_gate()` returns false + ZERO Tauri command) and reversible — nothing
ships, nothing flips, the owner QAs + flips later.

## Resolved from the R2 review pile (Cowork calls while owner AFK)
- **Bundle split → SKIP accepted** (engineering call): in a Tauri desktop app the bundle loads from
  local disk, so route-splitting buys ~zero user value vs real shipped-shell risk; the chunk shrink
  rides M3's deletion for free. Nothing to build. (Owner may overrule.)
- **Defender-policy restore → GUIDED-ONLY, never a write — LOCKED.** Writing `HKLM\...\Policies` is
  the absolute security rail; this is rail-mandated, not a preference. A future Defender path = "open
  Windows Security yourself" guidance, never autonomous code. Excluded from this wave.
- **Name "Leftovers" stands** until the owner rules (taste; non-blocking, one-string swap).
- **M3 retirement stays SCHEDULED for a fresh attended session** — NOT run AFK (3,000-line cut through
  shipped surfaces). Spec already ready.

## Scope — 4 dark resolvers
**BUILD (dark):** pagefile · MPO · core-parking · TCP autotuning.
**EXCLUDE:** Defender (rail → guided-only, above) · **bcdedit** (boot-store writes = highest blast
radius; hold for an owner-present wave even dark).

### Pagefile resolver (the origin-story one — its own commit, extra care)
- **Rotted state detected (v1):** `AutomaticManagedPagefile = False` + a fixed `Win32_PageFileSetting`
  (e.g. 30,000 MB).
- **Restore-to-default:** re-enable Windows-managed paging — set
  `Win32_ComputerSystem.AutomaticManagedPagefile = True` (clears the fixed entry; Windows manages it).
  **Reboot required to take effect — the resolver must SAY SO up front; no silent reboot, ever.**
- **Snapshot BEFORE mutation** captures the exact rotted contract: the `PagingFiles`
  (`HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Memory Management\PagingFiles`, REG_MULTI_SZ)
  value + `AutomaticManagedPagefile=False`. So rollback restores the user's rot *exactly* (reversible-
  restore symmetry — the honesty flex).
- This is a **performance/system** setting (same class as the catalog's existing power-plan/USB/PCIe
  applies), NOT the security rail. Elevated, fail-loud, write-before-mutate — same audited contract.

### Easy resolvers (may share one commit, each fixture-tested)
- **MPO** — remove `OverlayTestMode` (DWORD delete → back to default-on). 
- **Core-parking** — remove the power-plan override so the plan default reconstructs.
- **TCP autotuning** — `netsh int tcp set global autotuninglevel=normal`; verify locale-honestly
  (don't assert on localized output — read the value back, not the message).

## HARD LINES
- **STAY DARK:** `restore_gate()` remains `false`; register **NO** Tauri command; not wired to UI; not
  flipped. (Re-verify both at the end: gate false + zero restore IPC.)
- Snapshot **before** any mutation; ONE elevated PS per restore (no partial mutation); **pure script
  builders** (unit-testable without elevation; interpolate **integers only** — no string into an
  elevated command); fail-loud rollback; snapshot holds the rotted value (restore is itself reversible).
- **Adversarial audit per resolver** (R2-5 pattern): gate-refusal-no-receipt · refuse-unreadable-prior-
  before-elevation · blind-rollback-fails-loud · pair-mismatch = contract violation — test-pinned.
- `actions.rs` additive only; `APPLIABLE_REC_IDS` + dispatch + catalog untouched; no new IPC;
  capabilities/CSP/`tauri.conf.json` untouched; frozen refs (`16069fa`/`beta/private-beta-001`) + all
  security rails untouched.

## Verify (per item)
`cargo test --manifest-path src-tauri/Cargo.toml` + `cargo clippy --all-targets -- -D warnings` +
`npx tsc --noEmit` + `npx vite build` + `/security` → self-audit diff vs these hard lines → one
reversible commit → log line in `AUTONOMOUS_SPRINT_2026-06-11-R2.md`. End: confirm `restore_gate()`
still false + still zero restore IPC.

## Fallback queue (if pagefile turns forky, or time remains — don't rabbit-hole)
If the pagefile WMI/reboot semantics get hairy, log a one-line note to the Review Queue and move on —
do NOT rabbit-hole. Then, time permitting, pure-additive only: deepen the a11y WCAG sweep
(Check/Fix/Play/Lab/Learn beyond R2-6's 3 collapsibles) · more pure-module property/edge tests
(leftovers/readiness/priorities) · docs sync. All reversible; same per-item discipline.
