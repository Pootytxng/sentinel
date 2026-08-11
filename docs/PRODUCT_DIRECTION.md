# Compy — Product Direction & Feature Plan

> **⚠ DOCTRINE POINTER (2026-06-12):** product direction now EXTENDS per `docs/RECEIPTS_DOCTRINE.md`
> (monetization-first core — the Receipts Doctrine). The upward-growth thesis below is unchanged;
> where any text here conflicts with the doctrine, **the doctrine wins.**

> **⚠ CATALOG OPENED (owner decision 2026-07-09):** the frozen-catalog language below is
> SUPERSEDED by the **measurable-benefit-under-rails** policy (CLAUDE.md LOCKED rule 6, ★ PRIMARY
> BLUEPRINT `docs/superpowers/specs/2026-07-08-lab-proving-ground.md` Directive 1). The catalog now
> grows **both** upward (below) AND by **measured additions**: a tweak earns inclusion by measurable
> benefit — even individually-negligible; the cumulative measured stack is the point — **on top of**
> the permanent safety rails (reversible · no ungated kernel capability · no injection /
> anti-cheat-safe · non-security-weakening · stability-safe), each riding the full mutation-gate.
> "Sideways into more switches" is
> **re-permitted when measured + safe**. Where any text below says the catalog is frozen, this
> pointer wins.

**Thesis (owner decision 2026-08-09):** Compy grows first into the **PC doctor users open after a
crash, freeze, slowdown or unexplained hiccup**: detect → explain → test → recover → remember. Its
second specialty is measured performance treatment: readiness, monitoring, rollback and safe
optimization. The recommendation catalog is supporting treatment, not the product. Boundary
expansion is possible only through the Capability Exception Gate; game/process injection remains
prohibited.

> **Catalog quality bar ≠ feature freeze.** The catalog is OPEN (measurable-benefit-under-rails),
> but the bar is **proof**: no low-quality tweak-stuffing, no unmeasured snake-oil. What is locked is
> the **safety model**; a tweak joins only by clearing measurable benefit AND every safety rail.

## Hard anti-goals — the blocklist, now SPLIT (measurable benefit does NOT override safety)

The old "optimizer rot" blocklist splits in two under the opened-catalog policy:

- **Stays barred regardless of measured fps** (excluded for SAFETY/STABILITY/SECURITY/ANTI-CHEAT):
  timer hacks, HPET toggles, `bcdedit` edits, MMCSS registry abuse, **core-parking writes**, Defender
  disable, MPO disable, fixed pagefile forcing, any kernel-level tweak outside its own Capability
  Exception record, anything that trips
  EAC/BattlEye, and any unsigned/AI-generated/arbitrary registry-service-PowerShell action.
  **Measurement does not make these safe** — Compy is not a registry clown car.
- **Becomes a candidate** once it proves measurable benefit AND clears the safety rails: anything
  previously excluded merely as unmeasured "snake-oil." It still rides the per-tweak mutation-gate
  (rollback contract + apply/rollback QA + welfare-check) before shipping.

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

### F1 — Compy Gaming Mode  *(SESSION-SCOPED MUTATION — highest value, highest care)*
On game start: switch to a Compy gaming power profile, apply safe **AC-only** latency
settings, auto-start monitoring/overlay, show a pre-game health status. On game exit: restore
the previous power plan/settings, optionally stop overlay, log a session summary.
- **Reuses:** ETW presenter detection (game start/exit, no injection), the hardened power-plan
  apply/rollback (exact-GUID targeting), overlay, FPS capture.
- **Critical safety design:** a session change is an *apply with a guaranteed restore trigger*
  (game exit). It MUST be crash-safe: if the game or Compy dies mid-session, settings
  restore on next launch (treat an orphaned active session like a pending rollback — same
  heartbeat/ledger pattern the FPS helper already uses). No session may ever leave the machine
  in a modified state with no path back.
- **Gate:** the mutating part rides the **manual-mutation QA blocker** + the same rollback
  rigor. Build the *read-only* parts first (pre-game status, monitoring auto-start); add the
  power switch only after mutation QA is green and crash-safe restore is verified.
- **Open decisions:** game detection (auto via ETW presenter vs. user-listed executables vs.
  both); gaming profile (create a dedicated "Compy Gaming" plan vs. temporarily switch to an
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
temp/usage, RAM usage, detected stutters/frametime spikes, and which Compy settings were
active.
- **Reuses:** FPS capture already emits fps/frametime/1%-low and recent frametimes (spike =
  frametime-variance analysis); GPU/CPU/RAM sensors; the active-session record (from F1).
- **Gate:** none — read-only aggregation + local storage. This is what makes Compy useful
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
  clipboard, never auto-upload — consistent with the local-by-default privacy policy.)

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

## Experience direction — the premium command-center layer

**Set by Kuya, 2026-05-31. This is the next product priority *after* private-beta feedback — NOT
more catalog expansion.** It refines the thesis above: growing "upward" means a **premium experience
layer**, not just read-only features stacked plainly.

**The concern is not "Compy needs more features."** Compy is technically strong, verified,
rollback-safe, and private-beta ready. The risk is how it *feels* — that an average user experiences it
as *"here are some light switches; flip them, trust us, performance is better."* That is emotionally too
close to the generic-optimizer category, even though Compy is architecturally far safer. A user who
flips a few safe switches once and never returns has not received the real value.

**Desired feeling.** Opening Compy should feel like stepping into a **serious performance command
center** — a place that actively helps you *understand, verify, and maximize* your system around what
*you* care about (FPS, latency, smoothness, quality, stability, thermals, readiness, overall gaming
confidence). Emotional target: **"This is the place. If Compy says I'm good, I don't need to chase
sketchy Reddit/YouTube tweak packs."** Analogy: a **Ferrari lounge** (offered a glass of wine while
professionals handle the car), not a **Toyota dealership** where the user feels pressured, confused, and
unsure whether they got scammed.

**The honesty boundary (non-negotiable).** The feeling of "maximized / dialed-in" must come from
**clarity, proof, monitoring, and safe recommendations — never from false claims.** Do NOT promise
"maximum FPS," fabricate guarantees, invent percentages, or show an "optimized score" unless it is
**transparent and defensible.** Confidence without lying. What Compy legitimately delivers: hardware
checked · obvious misconfigurations surfaced · safe optimizations applied **or intentionally skipped** ·
system monitored · session results visible · rollback history clear · readiness understandable — so the
user has **no need to hunt random external tweak guides to feel "fully optimized."**

**Seven questions Compy should answer (the home-base test):**
1. Am I ready to play? 2. What is holding this PC back? 3. What has Compy safely improved?
4. What should I not touch? 5. How did the last session perform? 6. What can I share if I need help?
7. Am I chasing real performance, or snake oil?

**Make each surface feel *alive without being noisy*:**
- **Readiness** → a live system check, not a static checklist.
- **Sessions** → a post-game performance debrief, not a log.
- **Priorities** → a personal technician ranking what matters for *this* rig, not a flat list.
- **Export** → a professional diagnostic report, not a text dump.
- **Trust Ledger** → *proof* you're protected and can undo, not a log dump.
- **Monitoring** → an instrument cluster, not raw numbers stapled to a window.

**Aesthetic / design language:** futuristic but not childish; high-class performance cockpit, **not RGB
clownware**; dark/premium — graphite / black / metallic; clean hierarchy; strong cards & panels; clear
visual grouping; subtle animation + polished transitions + tactile feedback; confident status
indicators; meaningful empty states; less "settings page," more "performance command center"; readable
for non-technical gamers; **no fake gamer hype, no scammy boost language, no fake percentages, no opaque
"optimized score."**

**Intent framing / "modes" (future, guidance-only — must NOT blindly mutate):** Competitive Performance
· Balanced Gaming · Visual Quality · Stability/Safety. A mode shapes **readiness emphasis, priority
ranking, explanations, and which safe actions are surfaced** — it does **not** silently flip settings.
Any actual mutation still rides the rollback contract + Gaming Mode's gate.

**The user-aims a mode is a lens over (added 2026-06-01):** a gamer opens Compy with a *goal*, not just
a toggle list. The aims to recognize and frame around: **maximum competitive performance · smoother
frametimes · lower latency · better visual quality · safer / more stable configuration · a cleaner system
state · confidence before launching a game.** A mode is a lens that re-weights readiness, priorities, and
explanations toward the chosen aim — it never silently mutates to chase it. (The four modes above are the
coarse grouping; these aims are the finer "what the user actually wants" the experience should speak to.)

**The "Experience / Design System Pass" (next priority after beta feedback):**
1. Stronger visual identity. 2. Better dashboard landing view. 3. More premium card styling.
4. Clearer status language. 5. Better animations/transitions *where useful*. 6. More satisfying
interaction states. 7. Better visual grouping of readiness / monitoring / sessions / priorities /
rollback. 8. Stronger "you are protected / rollback available" trust cues. 9. A genuinely good
**"system is dialed in"** state when nothing needs action. 10. A clear **"attention needed"** state when
something is actually worth fixing.

**Scoped + decided 2026-06-01:** the architecture for this pass is designed and the key calls are
locked — see `docs/superpowers/specs/2026-06-01-experience-design-system-pass-design.md` (spec +
mockups) and `docs/superpowers/plans/2026-06-01-experience-pass-design-system-foundation.md` (the
decision-independent foundation plan). Locked decisions: the gamified "Tune tier / Garage /
unlock-gated themes / Surprise" is **reframed to a transparent `SystemPosture`** (Dialed-in /
Attention — honest, click-through, no opaque score); themes **curated to a premium set** (keep
Graphite/Frost/Aurora/Ember, drop neon Synthwave/Viper); intent **modes deferred** to a later pass;
brand accent kept. **Implementation is HELD** until owner green-light, ideally informed by first
private-beta feel-feedback. (This refines, not relaxes, the locks below.)

**Core product rule (2026-08-09 correction):** Do not solve perceived lightness by adding more
tweak buttons. Make Compy the **first place a gamer goes when the PC hiccups**: it notices or accepts
the symptom, opens the right rescue path, shows the evidence in plain English, separates known facts
from hypotheses, recommends one safe next step, and verifies the outcome. Optimization remains the
prescription/conditioning wing, not the front door.

## Locks reaffirmed

- **Tweak catalog is open under measurable-benefit-under-rails;** no tweak-count stuffing.
- **Default posture is locked:** local, user-mode, least-privilege, non-invasive and rollback-first.
  Exceptions require the named Capability Exception Gate in `docs/ARCHITECTURE_LOCKS.md` §1.8.
- **No third-party game/process injection.** Current build ships no Compy driver. Any driver proposal
  needs its own proven-need/security/anti-cheat/signing/rollback record and later arming decision.
- **Outbound is tiered, never globally unlocked:** updater live; Tier 1 signed advisory download/no
  machine upload; Tier 2 opt-in scrubbed fingerprint; Tier 3 explicit per-case evidence upload.
  Remote mutation rules remain signed and OFF.
- **New features stay read-only, reversible, session-scoped or advisory by default.** Mutations still
  ride the one `actions.rs` boundary, mutation-gate QA and full rollback contract.
- Canonical directive: `docs/superpowers/specs/2026-08-09-compy-care-capability-exception-gate.md`.
