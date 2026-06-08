# Feature brief — "Leftovers": detecting pre-existing optimizer rot

**Status:** brief only — not scheduled. Written 2026-06-06 from a real find on the owner's rig.
**Class:** v1 = read-only/advisory (allowed under current product rules) · v2 = mutation (rides its own QA gate, Gaming-Mode class).
**One-liner:** Compy already promises rollback-first safety for changes *it* makes. Leftovers extends that promise backward in time: find the tweaks some guide talked you into years ago, explain them with receipts, and offer a safe road back to stock.

---

## Origin story (the receipt)

During a 2026-06-06 host audit of the owner's own rig, a **manually fixed 30,000 MB pagefile** (`AutomaticManagedPagefile = False`) was found — a classic optimizer-guide tweak, spending ~29 GB of NVMe for zero benefit on a 31 GB-RAM machine (observed peak usage: 7.8 GB). Fixed pagefiles are *literally on Compy's own optimizer-rot blocklist* — yet Compy today would never notice one, because Compy only audits changes it made. The doctor's own house had the mold. Real user, real artifact, real 20+ GB recovered.

**Update 2026-06-08 — second find, same house.** Triaging a gaming-while-coding RAM squeeze on the same rig surfaced **memory compression disabled** (`Get-MMAgent → MemoryCompression: False`; Windows-default is ON) — a second optimizer-guide relic from the same era, actively *worsening* the user's exact pain (paging cold pages to disk instead of compressing them in RAM). Two independent rot artifacts on one machine, neither of which Compy could see today, is the strongest possible argument that pre-existing rot is a real and common blind spot — not a one-off. (Detector #9 below.)

## Problem

Users don't arrive at Compy factory-fresh. They arrive **pre-rotted**: years of YouTube/Reddit "best tweaks" left fixed pagefiles, HPET/timer hacks, bcdedit flags, disabled services, and TCP "mega-packs" baked into Windows. Compy's Trust Ledger covers its own changes; the damage done *before* Compy installed is invisible. That's a blind spot in a product whose whole identity is "a rollback-first Windows configuration safety layer."

## Why this is Compy-shaped (and not a new direction)

- The **blocklist is already the wanted-poster list.** We maintain a curated list of tweaks we refuse to apply because they break things. Detection = checking whether someone *else* already applied them. No new tweak catalog, no catalog-freeze violation — this adds **detectors, not tweaks**.
- **Rollback-first symmetry.** Restoring to Windows default uses the same audited `apply_*`/typed-rollback machinery; the "rotted" value is snapshotted, so even the *restore is reversible* — you can get your rot back. That's the honesty flex no cleaner app can make.
- **Hardware-aware framing.** Same per-rig logic as recs: a fixed 8 GB pagefile on an 8 GB-RAM machine is a different conversation than 30 GB on 31 GB. Verdicts are for YOUR hardware, in plain English.
- **Product value grows upward** (advisory, informative), not sideways into more switches — consistent with PRODUCT_DIRECTION.

## The anti-snake-oil charter (design constraints, non-negotiable)

The owner's stated fear: building an honest tool that gets mistaken for a junk-cleaner. These rules are the moat — each one is something CCleaner-style products *cannot* copy without ceasing to be what they are:

1. **Closed, curated catalog only.** Leftovers flags ONLY patterns on the maintained rot list. No heuristic scanning, no "registry junk," no file cleaning, no third-party app meddling, no AI-generated findings. If it's not in the catalog, Compy says nothing.
2. **"Nothing found" is a first-class result.** The empty state is a feature: *"No leftover tweaks found — your Windows config matches stock where it matters."* A scanner confident enough to find zero issues is the loudest possible anti-snake-oil signal. (Junk cleaners structurally cannot ship this screen.)
3. **Receipts, not adjectives.** Every finding shows: the exact current value → the Windows default → which guide-era tweak it matches → the mechanism of what it actually costs (disk, latency, stability), in one plain sentence. Direct proof over inference — the user can verify every claim themselves.
4. **No scores, no scares, no boosts.** No "327 issues!", no red gauges, no "Speed up your PC." Counting is allowed; alarm is not. Findings that cost nothing right now say so ("this is harmless but nonstandard").
5. **Honest uncertainty.** If we can't tell whether a deviation came from a guide, an OEM, or the user's deliberate choice, the card says that — and defaults to "leave it."
6. **Never auto-fix.** Detection is silent and read-only. Resolution is per-item, user-initiated, fully explained before the click, and lands in the Trust Ledger like any other change (deduped card + ghost rollback).
7. **Respect endorsed states.** A deviation Compy itself would recommend for this rig (e.g., Game DVR off — part of Gaming Mode's core bundle; SysMain off where appropriate) is NOT rot. The detector must consult the rec engine's hardware gates before calling anything a leftover. Asymmetry matters: rot = "a tweak Compy would never apply on this hardware."

## v1 scope — detection + explanation (read-only)

- New pure module (suggested: `src-tauri/src/leftovers.rs`): `evaluate_leftovers()` over serialized probe data, same shape discipline as `readiness.rs`/`priorities.rs`. Unit-testable with fixture values, mutates nothing.
- Seed detectors (all from the existing blocklist, each with a documented stock-default and read probe):
  1. Fixed pagefile (`AutomaticManagedPagefile=False` + `Win32_PageFileSetting`) — the origin-story detector; ships first.
  2. bcdedit timer flags (`useplatformclock`, `disabledynamictick`) — probe via `bcdedit /enum` (elevation-aware: degrade to "needs admin to check" honestly).
  3. MMCSS / `SystemResponsiveness` / `NetworkThrottlingIndex` tampering.
  4. Core parking forced via power-plan overrides.
  5. Defender real-time disabled via policy key.
  6. MPO disabled (`OverlayTestMode`).
  7. NIC offload mass-disable / TCP autotuning off (`netsh int tcp show global` deviations).
  8. `Win32PrioritySeparation` exotic values.
  9. **Memory compression disabled** (`(Get-MMAgent).MemoryCompression=False`) — Windows-default is ON; guides that run `Disable-MMAgent -mc` to "cut CPU overhead" leave RAM-tight machines paging to disk instead of compressing in-RAM. **Second origin-story detector — found live on the owner's own rig 2026-06-08, alongside the fixed pagefile.** Read via `Get-MMAgent`; restore via `Enable-MMAgent -MemoryCompression` (reversible, reboot to take effect). Hardware-aware verdict: only flag when physical RAM is modest / under observed pressure — on a 128 GB workstation the user may have chosen this deliberately, so say so.
- Surface: a quiet section in **Check** (it's an advisory limiter by nature) with detail expanding in place per the navigation law; optionally cross-linked from Fix. Each finding gets a Learn entry (the "What's this?" wiring already exists).
- Copy tone: museum placard, not siren. *"Found: pagefile manually fixed at 30,000 MB. Windows default: automatic. On your 31 GB-RAM machine this spends ~29 GB of disk and changes nothing about game performance. Likely source: optimization guides circa 2018–2023. Safe to restore; fully reversible; needs one reboot."*

## v2 scope — guided restore (mutation; gated)

- Per-item "Restore Windows default" through the existing typed `AppliedAction`/`RollbackAction` + snapshot contract; entry recorded in the Trust Ledger with provenance `leftover_adopted`.
- Each resolver ships only after its own apply/rollback QA (normal / cancel / reboot-persistence / external-change), same bar as the manual-mutation QA that gated the original catalog. Elevation-aware, fail-loud, write-before-mutate.
- Items needing a reboot to take effect say so up front (pagefile). No silent reboots, ever.

## Non-goals (the line we will not cross)

No temp/file cleaning, no browser-cache wiping, no startup-app "optimization," no duplicate finders, no registry "defrag," no scheduled background scanning, no telemetry about findings, no monetized urgency. The moment Leftovers deletes a *file* instead of restoring a *setting*, it has become the thing it was built to oppose.

## Open questions for the owner

1. Name: "Leftovers" vs "Found settings" vs "Past tweaks" (taste call — owner territory).
2. Home: Check section (recommended above) vs its own Fix subsection.
3. v1 trigger: on-demand button vs automatic on launch (recommendation: on-demand in v1 — quieter, cheaper, zero perceived scanning).
4. Does the wave-2 timeline want this brief parked until invites ship? (Build work does not fit the current HQ train; see queueing note.)

## Queueing note (HQ alignment, per owner's standing rule)

- **This brief as a doc:** additive, zero code, zero train interference — safe to hand HQ anytime for `docs/superpowers/specs/`.
- **The build work:** does NOT align with HQ's current train (wave-2 installer rebuild + live verifies are the open items; this is a new advisory surface plus, in v2, gated mutation work). Recommendation: park until wave-2 ships, **or** open a new window/worktree lane scoped to read-only v1 (`leftovers.rs` + new surface component = naturally disjoint file domain), with HQ owning the merge per PARALLEL_WORKTREE_OPS.
