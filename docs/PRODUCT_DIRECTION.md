# Sentinel — Product Direction & Feature Plan

**Thesis:** Sentinel grows **upward** into a *gaming readiness, monitoring, rollback, and
safe-configuration control center* — not **sideways** into more Windows tweak switches. The
recommendation catalog is one part of the value, not the product. The module refactor and the
locked safety model make higher-level features *safer* to add, not impossible.

> **Catalog discipline ≠ feature freeze.** "No more tweaks" means no more low-quality
> tweak-stuffing. It does **not** mean Sentinel stops adding value. What is locked is the
> **safety model**, not the **product scope**.

## Hard anti-goals — the "optimizer rot" blocklist (do NOT add)

These increase weight and lower trust. Adding any of them is a regression in product quality:
timer hacks, HPET toggles, `bcdedit` edits, MMCSS registry edits, global NIC offload packs,
forced core parking, Defender disable, MPO disable, fixed pagefile, TCP "mega-pack" edits, or
any unsigned/AI-generated/arbitrary registry-service-PowerShell action. Sentinel is not a
registry clown car.

## Foundation already in place (these features compose it; they don't re-derive it)

- **ETW present-event capture** (`fps.rs`) already produces FPS, avg frametime, **1%-low**,
  per-second frame counts, recent frametimes — **and identifies the presenting process** (the
  active game), with a compositor/shell denylist. This is the basis for game detection AND
  session summaries, with no injection.
- **GPU sensors** (AMD ADLX / NVIDIA NVML): temp, usage, clocks, fan, power, VRAM.
- **CPU/RAM poller**, **on-screen overlay**, **hardware/display detection** (`hardware.rs`,
  incl. DXGI for VRR/HDR signals), **diagnostics** (raw observations).
- **Hardened rollback engine** (`actions.rs` + `history.rs`): typed apply/rollback, exact-plan
  power targeting, fail-safe restore, Trust Ledger — the safe substrate for session-scoped
  changes.

## Feature plan (each tagged by safety class)

Safety classes: **READ-ONLY** (no system change) · **ADVISORY** (reads + advises) ·
**SESSION-SCOPED MUTATION** (changes, auto-restored) · all gated as noted below.

### F1 — Sentinel Gaming Mode  *(SESSION-SCOPED MUTATION — highest value, highest care)*
On game start: switch to a Sentinel gaming power profile, apply safe **AC-only** latency
settings, auto-start monitoring/overlay, show a pre-game health status. On game exit: restore
the previous power plan/settings, optionally stop overlay, log a session summary.
- **Reuses:** ETW presenter detection (game start/exit, no injection), the hardened power-plan
  apply/rollback (exact-GUID targeting), overlay, FPS capture.
- **Critical safety design:** a session change is an *apply with a guaranteed restore trigger*
  (game exit). It MUST be crash-safe: if the game or Sentinel dies mid-session, settings
  restore on next launch (treat an orphaned active session like a pending rollback — same
  heartbeat/ledger pattern the FPS helper already uses). No session may ever leave the machine
  in a modified state with no path back.
- **Gate:** the mutating part rides the **manual-mutation QA blocker** + the same rollback
  rigor. Build the *read-only* parts first (pre-game status, monitoring auto-start); add the
  power switch only after mutation QA is green and crash-safe restore is verified.
- **Open decisions:** game detection (auto via ETW presenter vs. user-listed executables vs.
  both); gaming profile (create a dedicated "Sentinel Gaming" plan vs. temporarily switch to an
  existing one); which AC-only settings are in-scope (start minimal).

### F2 — Per-game readiness check  *(READ-ONLY / ADVISORY — lowest risk, build first)*
Before launch, a plain-English checklist: monitor at max refresh (OK/mismatch), game on
NVMe/SSD vs slow drive (OK/warning), VRR status, power profile, Game Bar/overlays, FPS
monitoring ready, GPU driver age (OK/stale).
- **Reuses:** display/refresh detection, disk-type detection, DXGI VRR/HDR signals, power-plan
  read, driver date via WMI, monitoring capability check. Nearly all inputs already exist.
- **Gate:** none — read-only/advisory; safe to build before mutation QA closes.

### F3 — Session summary  *(READ-ONLY — local log)*
After a session: game name, average FPS, average frametime, **1%-low** estimate, peak GPU
temp/usage, RAM usage, detected stutters/frametime spikes, and which Sentinel settings were
active.
- **Reuses:** FPS capture already emits fps/frametime/1%-low and recent frametimes (spike =
  frametime-variance analysis); GPU/CPU/RAM sensors; the active-session record (from F1).
- **Gate:** none — read-only aggregation + local storage. This is what makes Sentinel useful
  *every day*, not only at setup.

### F4 — Hardware-aware "what matters most" ranking  *(ADVISORY)*
Instead of a flat rec list: "your biggest likely limiter is …" — e.g. GPU-bound this game,
monitor not at max refresh, driver old, game on slow drive, background startup load — plus
what's already fine and what isn't worth touching.
- **Reuses:** hardware detection + the recommendation engine + (optionally) F3 session data.
- **Gate:** none — advisory analysis layer; changes nothing.

### F5 — Exportable system/report snapshot  *(READ-ONLY)*
Export to a shareable report (Markdown/JSON/text): hardware summary, active recommendations,
applied changes + rollback status, monitoring capability, driver dates, and the F2 readiness
report. Useful for support, Discord, Reddit, before/after comparisons.
- **Reuses:** hardware, recommendations, Trust Ledger, monitoring results, F2.
- **Gate:** none — read-only aggregation. (Keep it local; "export" = write a file / copy to
  clipboard, never auto-upload — consistent with the zero-telemetry privacy policy.)

### F6 — Proof / benchmark layer  *(later)*
Start with **configuration proof** + session metrics + frametime history + before/after
snapshots (all read-only, from F3). Only later consider PresentMon-grade comparisons. This is
the path that graduates rec impact claims from "Expected impact" → "Verified" honestly.

## Risk-ordered build sequence (respects the mutation-QA gate)

1. **F2 readiness check** (read-only) — fastest visible value, no gate.
2. **F3 session summary** (read-only) — daily-use value, no gate.
3. **F5 export** (read-only) — leverages F2/F3.
4. **F4 priority ranking** (advisory) — analysis on top of F2/F3.
5. **F1 Gaming Mode** — read-only parts (pre-game status, monitoring auto-start) now; the
   power/settings switch **after** the manual-mutation QA blocker closes and crash-safe restore
   is proven.
6. **F6 proof layer** — incremental, after F3 has accrued real session data.

## Locks reaffirmed

- **Tweak catalog stays frozen** (~29 recs; no new risky tweaks; the blocklist above is hard).
- **Safety model is locked**: no kernel driver, no game injection, rollback-first, local-only /
  zero telemetry, signed-rules-off, GPU vendor honesty.
- **Any new feature must be READ-ONLY, REVERSIBLE, SESSION-SCOPED, or ADVISORY until proven
  safe.** Mutating features (only F1 so far) ride the manual-mutation QA gate and the full
  rollback contract.
- The manual-mutation QA blocker (`docs/RELEASE_QA.md`) remains open and gates beta/release.
