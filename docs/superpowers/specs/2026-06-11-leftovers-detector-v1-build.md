# Build spec — Leftovers detector v1 (read-only) — 2026-06-11

**Greenlit by owner 2026-06-11** (picked the "paramedic / damage detector" from the overview's
open-questions). Promotes `docs/superpowers/specs/2026-06-06-leftovers-rot-detection-brief.md`
from *brief* → *scheduled v1*. Read that brief for the full anti-snake-oil charter (7
non-negotiable rules) + the 9-detector roadmap + the origin story. This doc pins the **v1 build
scope** and records the **resolved open questions**.

## Resolved forks (Cowork calls — engineering/design)
- **Home:** a quiet section in **Check** (it's an advisory limiter by nature; Check is the
  honest-scan room). Detail expands in place (navigation law). Fix cross-link is optional, not v1.
- **Trigger:** **on-demand** button — *"Check for leftover tweaks."* No scan on launch, no
  background scanning (charter non-goal). Zero perceived scanning.
- **Timeline:** build **now** on `main`. Beta is already sending, this is additive read-only with a
  naturally disjoint file domain — the 2026-06-06 "park until invites ship" note is stale.
- **v1 detector set:** the framework **+ the two origin-story detectors proven on real hardware** —
  fixed pagefile and memory-compression-disabled. Both were observed live on the owner's own rig, so
  v1 is instantly demoable/dogfoodable. Detectors 2–8 (bcdedit timer flags, MMCSS/SystemResponsiveness,
  core parking, Defender-policy-off, MPO, NIC/TCP autotuning, Win32PrioritySeparation) are fast-follows
  once the frame + first two are green.

## Owner decision still open (taste — NON-blocking)
- **User-facing name:** recommend **"Leftovers."** Alternatives: "Found settings," "Past tweaks."
  Build uses "Leftovers" (module `leftovers.rs`); the display string swaps trivially when you call it.

## v1 architecture (mirror `readiness.rs` / `priorities.rs`)
- New **pure** module `src-tauri/src/leftovers.rs`: `evaluate_leftovers(serialized_probes) -> Vec<Leftover>`
  — pure, fixture-unit-testable, mutates nothing.
- Read probes gather raw state → serialize → hand to the pure evaluator (so tests need zero system access):
  - Pagefile: `AutomaticManagedPagefile` + `Win32_PageFileSetting` (current fixed size).
  - Memory compression: `(Get-MMAgent).MemoryCompression` (read-only PowerShell).
  - RAM total (already gathered in the hardware probe) for the hardware-aware verdict.
- **One** new read-only IPC command `get_leftovers` (mirror `get_readiness` / `get_priorities`). No other new IPC.
- Each `Leftover` carries: id · current value · Windows stock default · matched guide-era tweak ·
  one-sentence mechanism-cost (disk/latency/stability) · hardware-aware verdict · source-uncertainty
  flag · an informational "safe to restore, reversible, reboot?" note. **No restore action wired** (v2).
- **Charter rule #7 (endorsed states):** before flagging, consult the rec engine's hardware gates —
  never flag a state Compy itself would endorse for this rig (e.g. Game DVR off). Rot = "a tweak Compy
  would never apply on this hardware."

## Surface (Check)
- On-demand *"Check for leftover tweaks"* → advisory cards, **museum-placard tone** (brief's copy
  example), each with a "What's this?" Learn entry (wiring already exists).
- **Empty state is first-class:** *"No leftover tweaks found — your Windows config matches stock where
  it matters."* (charter rule #2 — the loudest anti-snake-oil signal).
- No scores, no gauges, no boosts, counting-not-alarm (charter rule #4).

## HARD LINES (v1 — do not cross)
- **Zero mutation.** Reads only — no `apply_*`, no registry/system writes, no state-changing
  PowerShell (`Get-MMAgent`, `bcdedit /enum`, WMI queries are reads). **No auto-fix.** v2 guided-restore
  is OUT of this build (rides its own apply/rollback QA gate, Gaming-Mode class).
- **Catalog frozen.** Adds **detectors, not appliable tweaks.** `APPLIABLE_REC_IDS` + the ~29-rec
  catalog untouched; `actions.rs` untouched; no new mutation primitive.
- **One new IPC only** (`get_leftovers`, read-only). Capabilities / CSP / updater / remote-fetch untouched.
- **Honesty:** receipts not adjectives; hardware-aware verdicts; honest uncertainty → default "leave it";
  **no FPS-gain promise anywhere.**
- Frozen refs (`16069fa` / `beta/private-beta-001`) + all locked gates untouched.

## Verify
- `cargo test --manifest-path src-tauri/Cargo.toml` incl. new `leftovers` fixture tests:
  rotted-fixture → finding with full receipt · clean-fixture → empty "nothing found" · endorsed-state
  fixture (a state a rec would set) → NOT flagged · hardware-aware (small-RAM fixed pagefile vs large-RAM)
  → verdict differs.
- `cargo clippy --all-targets -- -D warnings` · `npx tsc --noEmit` · `npx vite build` clean.
- `/security`: zero new mutation, one read-only IPC, no capability/CSP change.
