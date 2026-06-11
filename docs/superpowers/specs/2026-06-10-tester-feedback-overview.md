# Owner feedback + overview take — 2026-06-10 (captured from prior Cowork thread)

> Captured verbatim so a thread swap can't lose it again. Owner asked: take the overview
> "with a grain of salt — formulate your own opinion and suggest accordingly." My triage
> follows each item.

## Live FPS field test — CONFIRMED (owner, 2026-06-10)

Owner's live game test: overlay reads ≈ in-game/Steam counter. The msedgewebview2
self-measure bug (`af7cc02` + `c3c8300` swapchain keying) is dead in the field. ✅ recorded.

## The overview (owner's source list)

1. Verify NVML sensors on NVIDIA hw + add Intel GPU support (accuracy across vendors).
2. Separate developer notes from user guides; hide dark-gated features until QA done.
3. Acquire code-signing cert + finalize legal before public release.
4. Gather structured beta feedback to refine copy + feature priorities.
5. Expand catalog cautiously with **reversible diagnostics** (driver-update + latency tests).
6. Build remote rule delivery with strong signing, versioning, opt-in controls.
7. Read-only mobile companion; market around honesty + rollback safety.
8. Post-stabilization: paramedic mode, per-game profiles, long-term tracking.
9. Grab-bag: automated tests, first-run tutorials, community feedback channel, driver/OS
   update alerts, third-party tweak detection, optional OS restore points, resource-usage
   monitoring, localization + accessibility, incentivized beta recruitment.
10. Reword tabs — "Fix" framed as the exciting/fps-relevant tab; then prioritize "Lab"
    use-case, make it comprehensible + welcoming for newcomers.

## My triage — three lanes, do NOT treat as a flat to-do list

The overview is solid and on-brand, but it mixes three lanes with very different unblock
conditions. The trap is building top-to-bottom. Sorted:

**LANE A — gated by decisions we made on purpose (DON'T build now, park with reason):**
- #1 NVML/Intel → **vendor-honesty rule #5**: needs a real monitored NVIDIA session export
  to verify, Intel needs the hardware. Data/hardware-gated, not a code task we can finish.
- #3 signing + legal → **money-last + public-gate**: deferred to first stranger exposure.
- #6 remote rules → **rule #4 triple-gated OFF**. Stays off until prod signing + CDN exist.

**LANE B — post-beta scope (right idea, wrong time):**
- #7 mobile companion, #8 paramedic/per-game/long-term tracking, plus the heavy half of #9
  (community channel, localization, incentivized recruitment, OS-update alerts). All real,
  all after the 20-friend beta proves itself. Marketing (#7) = owner's lane.

**LANE C — buildable NOW, reversible + honest + catalog-safe (pull from here):**
- #10 Fix reword → ✅ **DONE this session** (`f1a1f27`). Note the honest reframe below.
- #10 Lab welcoming → ✅ **DONE this session** (`7d9f52a`).
- #5 **driver-update check** → read-only diagnostic, fits "expand catalog cautiously with
  REVERSIBLE diagnostics." Latency test already exists in Lab. **Best next real build.**
- #2 separate dev notes from user docs + hide dark-gated features until QA → reversible
  org/UX hygiene; lowers the "what's this half-finished thing?" tester confusion.
- From #9, the reversible-read subset: first-run tutorial (foam-pit law), resource-usage
  monitoring (read-only), accessibility pass, optional OS restore-point-before-apply (a
  safety layer — strengthens rollback-first, on-brand). Each its own small spec when we get there.

## My disagreement on #10 (the "grain of salt" the owner asked for)

Owner's instinct: frame **Fix** as "where fps gains are possible — make it exciting."
**I deliberately did NOT build it that way**, and recommend against it: "fps gains here"
is the exact over-promise we just killed on the site (no-snake-oil / honest-measurement
law). Promising frames we can't guarantee per-rig is the one move that torches the trust
the whole product is built on. Instead I framed Fix as **"the changes worth making for
YOUR rig — tailored, earned, reversible"** — inviting via *tailoring + confidence*, not
via a number we can't back. Same excitement, honest spine. If a tester later proves a
measured gain on their rig, the Benchmark/Lab instruments are where that truth gets shown
— earned, not promised. Owner's call to overrule, but this is the hill the brand stands on.

## Recommended near-term sequence (Lane C only)

1. ✅ Fix reword · 2. ✅ Lab welcoming · 3. Fix consent-note dedup (pending CC) ·
4. **Driver-update check** (next new build) · 5. Dev/user doc separation + dark-gate hiding ·
6. First-run tutorial. One spec + one CC prompt at a time, owner-paced.
