# Compy UI Slim-Down Plan — "answer first, detail on tap"

> Created 2026-07-01 (Cowork). A research-backed, council-reviewed plan to cut Compy's
> sensory overload. Scope confirmed with owner: **plan + key mockups**, **re-architect the
> IA** (keep the current visual language), synthesizing four north-stars — Apple-minimal,
> power-user-minimal (Linear/Raycast), in-space-clean (NVIDIA App / NZXT CAM), console-simple
> (Steam Big Picture). Companion mockup: `docs/mockups/ui-slimdown-preview.html`.
> This is advisory design direction — it touches UI only, changes no LOCKED gate, and every
> move below is flag-gated and reversible.

---

## TL;DR — the thesis and the five moves

**The finding that reframes the whole task:** your *visual language is not the problem.* The
tokens, the instrument-cockpit look, the primitives are mature and good. The bulk comes from
**quantity of surfaced elements per screen**, not pixels. Three culprits, all in the code audit:

1. **Triple render-path duplication** — classic + `optimizeMerged`/`monitorMerged` + `dashV2`
   all live in the tree at once. Three ways to draw the same room.
2. **Multi-affordance rows** — every recommendation row carries ~8 controls (title, evidence
   chip, WhatsThis, Details, reason, AMD note, snapshot line, dismiss, TrustSwitch).
3. **Screens that stack ~10 card types on one scroll** — the Optimize "Fixes" segment renders
   Check + Gaming Mode + Fix together; Check alone stacks ~10 heterogeneous card types.

So the re-architecture is **not** "re-count the tabs" (5 rooms is already best-practice). It's a
**per-room contract** plus three enabling mechanisms. The thesis in one line:

> **One question per room. One primary action. Show the answer; put the detail one tap away.**

The five moves:

1. **Master-detail rows** — collapse every multi-affordance row to `title + one-line verdict +
   Recommended badge + one control`; everything else opens in a detail panel *in place*.
2. **A global Basic / Advanced switch** — Basic shows glanceable tiles and the top fixes;
   Advanced reveals sensors, per-core grids, expert instruments. Kills the "wall of gauges."
3. **Answer-first screens** — each room leads with a single verdict/number, then a short ranked
   list. The "measured fine / not worth touching / dismissed / past tweaks" piles collapse into
   one quiet "Nothing else needs attention" expander.
4. **Delete the dead render paths** — pick the winning screen for each room, remove the others.
   One canonical screen per room.
5. **Calm the chrome** — static (or barely-there) ambient backdrop; Export becomes a contextual
   action, not persistent header furniture; Settings is the only gear.

---

## 1. Diagnosis — where the bulk actually lives

From the read-only front-end audit (verify `file:line` before editing — point-in-time):

**Density ranking (bulkiest → lighter):**

1. **Optimize → "Fixes" segment** — Check + Gaming Mode + Fix on one scroll (`Optimize.tsx`).
2. **Fix / Tune** — 6+ collapsible sections + modal + drawer; every row multi-affordance (`Fix.tsx`).
3. **Check result stack** — ~10 card types + an inline-styled `<pre>` setup summary (`Check.tsx`).
4. **Monitoring GPU panel** — up to 8 label+value+sparkline rows *per GPU* + a 16-cell core grid (`App.tsx`).
5. **Play/Monitor "Live"** — live cards + ~9 overlay buttons + charts + an embedded MonitoringTab (`Play.tsx`).
6. **Blackbook / Learn** — the largest file in the app (~1005 lines), text-dense by nature (`Learn.tsx`).
7. **SessionDebrief** — a 435-line expansion inside each session row.
8. **History / Trust Ledger** — 11-field grid + raw `JSON.stringify` snapshot per entry.
9. **Home / CommandCenter** — dual render paths + gauge + hero + limiter + live strip + full
   hardware grid + animated backdrop.
10. **Settings** — long, but cleanly sectioned (least urgent).

**Cross-cutting overload sources:** flag-path triplication in the tree, the animated
`AmbientBackdrop` behind Home, and multi-affordance rows repeated dozens of times.

**What's already good (keep):** the token system, the primitives (`Card`, `Gauge`, `Stat`,
`StatusPill`, `Sparkline`, `SegmentedControl`, `TrustSwitch`), the guards (`theme-contrast`,
`homeRail` parity, `doorknob-guard`, `border-hygiene`), and **`Lab.tsx`** — five collapsible
instruments, closed by default. Lab is the cleanest screen in the app and the pattern the rest
should copy.

---

## 2. What the competitors teach

Two lanes exist in this category, and they map cleanly onto Compy's own doctrine.

**The snake-oil lane (avoid):** Outbyte (Malwarebytes-flagged scareware) and late CCleaner
(now flagged a **Potentially Unwanted Application by Microsoft Defender** for "exaggerated
claims about device health in an alarming manner"). Their pattern: fake urgency, inflated "247
issues found!!" counters, paywalled fixes, and the scan-results screen sold as ad space. This
is exactly the reputation "one Reddit thread of brand damage" that kills the Receipts funnel.

**The clean lane (emulate):** AVG TuneUp (four goal-named buckets, per-item deselect before you
Optimize), **NVIDIA App** (praised as ~50% faster and cleaner than GeForce Experience; live
metrics live in an *opt-in* overlay with a sane default set), and **NZXT CAM** (oversized
single-number tiles a non-technical user reads at a glance, with a Basic/Advanced toggle). The
cautionary in-space example is **Armoury Crate** — bloat, promo pop-ups, background services —
the app users flee to lightweight alternatives to escape.

Concrete lessons adopted here:

- **Cap top-level nav at ~5 goal-named destinations** (Compy already does — protect it).
- **Lead with one primary action; hide depth behind an "Advanced" affordance** (the single
  biggest clean-vs-cluttered differentiator across every app reviewed).
- **Never inflate counts or use alarming red counters** — honest plain counts, real severity.
  This is Compy's honesty doctrine expressed as a UI rule, and it's the moat.
- **Show what will change; let users deselect before applying** (AVG's trust pattern — and it
  dovetails perfectly with rollback-first).
- **Keep the results screen sacred — zero upsell at the moment of peak trust.** Affiliate/
  upgrade prompts belong on a verdict *after* honest proof (Receipts Doctrine), never dressed
  as a "detected issue."
- **Big single-number tiles beat graphs on the home surface;** reserve scrolling graphs for an
  opt-in details view (NZXT CAM).
- **Live metrics belong in an opt-in overlay with a minimal default set** (NVIDIA/AMD/Afterburner).

Sources: TechRadar (Cortex, CCleaner, iolo, AVG TuneUp reviews); BleepingComputer / Microsoft
(CCleaner PUA classification); Malwarebytes (Outbyte); NVIDIA App announcement + TechRadar;
NZXT CAM (pcgamer, nzxt.com); Armoury Crate (binaryfork, digitaltrends); Apple HIG; NN/g
(progressive disclosure, visual hierarchy / squint test); Steam Big Picture 10-foot UI.

---

## 3. Principles we're adopting (the ones that bite)

- **Squint test on every screen** — exactly one element (the verdict or primary action) should
  pop. Demote everything competing with it.
- **Lead with the answer, not the data** — "You're good" / "One thing to fix," then detail.
- **Replace paragraphs with a label + value + one plain-English line;** the rest behind "Learn
  more." (Directly attacks the "too much text" complaint.)
- **Progressive disclosure with strong information scent** — an "Advanced" affordance must say
  what's inside; a bare chevron isn't enough (NN/g).
- **Reduce decision load with smart defaults + a marked "Recommended"** — turn ten evaluations
  into one confirmation (Hick's Law).
- **Calm density, not empty screens** — Linear-style calm is lots of info on a strict grid with
  restrained color and generous spacing, not information removed.
- **Whitespace is a feature; motion is reserved for explaining state changes, never decoration.**

---

## 4. My opinion — the re-architecture

### 4.1 The contract (applies to every room)

Each room obeys the same shape, top to bottom:

```
[ ONE verdict / number — the answer ]      ← the only thing that "pops" (squint test)
[ ONE primary action ]                      ← filled/accent; everything else is ghost/text
[ a short ranked list (calm rows) ]         ← 3–5 items, master-detail
[ "Nothing else needs attention" ▸ ]        ← one quiet expander swallows all the side-piles
```

This is already half-blessed by your own `DESIGN.md`: *"one rail, never teleports — detail
expands in place."* The app drifted away from its own law; this restores it.

### 4.2 Three enabling mechanisms

**(a) The master-detail row — the highest-leverage single component.**
Today a rec row = title + evidence chip + WhatsThis + Details + reason + AMD note + snapshot +
dismiss + TrustSwitch (≈8 affordances). Redesigned row:

```
●  Disable 3 startup apps slowing boot          [ Recommended ]        ( ○ Apply )
   Measured: +7s to desktop  ·  reversible                              ⌄ details
```

Just `status dot + plain title + one measured proof line + Recommended badge + one toggle`.
Tapping the row (or "details") opens a **detail panel in place** with the evidence, AMD note,
snapshot, walkthrough, and rollback — the same information, revealed on demand instead of all
at once. One component, reused on Optimize, Home's limiter, and the session list. **Estimated
per-row affordance count: 8 → 3 visible.**

**(b) A global Basic / Advanced switch.**
Make "expert mode" a first-class, app-wide concept instead of ad-hoc per screen. **Basic**
(default) = glanceable tiles + top fixes + one proof line. **Advanced** = all GPU sensors,
per-core grid, frametime graphs, the Lab instruments, raw ledger fields. NZXT CAM, AMD
Adrenalin, and Intel XTU all physically separate monitoring from tuning so a novice *cannot*
stumble into overclocking sliders — Compy's whole audience is that novice (Sarah & Caleb).

**(c) Delete the dead render paths.**
Choose the winner for each room (recommend: keep `dashV2` Home, `optimizeMerged`, `monitorMerged`)
and remove classic + the losing paths. One canonical screen per room — less code, zero drift,
and the `homeRail` parity guard stays honest.

### 4.3 Room by room (Basic view)

| Room | One question | Answer-first hero | What moves to Advanced / on-tap |
|---|---|---|---|
| **Home** | "Is my PC ready, and what's the one thing to do?" | Posture verdict + the #1 limiter as the single hero action + 3 glanceable tiles | Full hardware grid → a "Rig" tap; live strip trimmed to 3; backdrop calmed |
| **Optimize** | "Make it better, safely." | "N recommended fixes" + reviewable master-detail list + one "Apply reviewed" bar | Applied/History → per-item done-state + a History link; side-piles → one expander |
| **Monitor** | "How is it running?" | 4 big glanceable tiles (FPS/frametime · GPU temp · CPU · RAM) + last-session summary | Graphs, per-core grid, all 8 GPU sensors, overlay builder → Advanced toggle |
| **Learn** | "Why — explain it plainly." | Search + top topics | (kept; see open decision on demoting it) |
| **Advanced (Lab)** | "Expert instruments." | 5 collapsed instruments (already clean) | — this *is* the Advanced home |

### 4.4 The honesty guardrail (do not cross)

Compy's differentiator is **visible proof**. The one risk in "hide the detail" is becoming the
black-box "Make it better" button we mock. So the rule: **every rec keeps exactly one measured
proof line visible in its collapsed row** (the "Measured: +7s to desktop" line). We hide
*redundancy*, never the *evidence*. A slimmer UI must still out-prove the snake-oil lane at a
glance — that calm, honest screen is itself the attack-marketing asset (see council: Expansionist).

---

## 5. Phased execution (reversible, flag-gated)

Don't boil the ocean. Each phase is a flag, ships behind green guards, and is independently
revertable. **Note:** a CC "Wave" build may be running on `main`; sequence these so they don't
collide, and land one screen at a time.

1. **P1 — the row.** Build the master-detail row component + detail-panel-in-place. Apply to
   **Optimize** only, behind `slimRows`. Capture before/after density. Highest leverage first.
2. **P2 — Monitor Basic/Advanced.** Introduce the global Basic/Advanced switch; Monitor Basic =
   4 tiles, Advanced = today's panels. Behind `basicAdvanced`.
3. **P3 — Home answer-first.** Trim to verdict + hero limiter + 3 tiles; hardware grid on tap;
   calm the backdrop. Behind `homeV3` (supersedes `dashV2`).
4. **P4 — dedup.** Once P1–P3 are proven, delete the classic/losing render paths. Pure removal,
   guards green.
5. **P5 — side-pile collapse + chrome.** One "Nothing else needs attention" expander; Export →
   contextual; final motion/backdrop pass.

Each phase: `cargo`/`vitest`/`tsc` green, the visual `self-review` rubric run, before/after
screenshot attached. No LOCKED gate touched; no new outbound network; catalog unchanged.

---

## 6. What we deliberately keep

The visual language (tokens, instrument cockpit, single-accent discipline), the evidence/proof
lines, rollback-first, the frozen tweak catalog, every guard, and the ~5-room nav count. This is
**subtraction and consolidation, not a redesign** — which is also why it respects the standing
"current design preferred over cinematic" decision.

**CORRECTION (2026-07-01, owner) — retain the 3D rig hologram + liveliness.** The slim-down must
keep Compy's signature 3D/lively character; that is character, not clutter. The 3D "holo lens"
rig lives in `src/surfaces/rig/` (`RigHologram.tsx` / `RigViewer.tsx`, WebGL/three.js) and is the
DEFAULT "tailored to your hardware" centerpiece on Home (`DashboardV2.tsx` / `HardwareSection.tsx`),
with a lighter Cards view one tap away; the "HoloLens" Setup & Tour (`SetupTour.tsx` /
`HardwareTourScene.tsx`) is the 3D guided first-run; `AmbientBackdrop` is the ambient motion.
**Minimalism ≠ sterile:** apply the slim-down to multi-affordance rows, flag-path duplication,
card walls, and excess text — NOT to the 3D/lively hero. The v1 mockup flattened the rig into a
spec tile; that was the over-correction. **Mockup v2 must put the 3D rig hologram back as the Home
centerpiece** while keeping the slim master-detail rows and Basic/Advanced split. Reconcile "clean
IA" WITH "alive."

---

## 7. COUNCIL STRIP — UI slim-down / 2026-07-01

**Contrarian:** The real risk is *over-hiding the proof.* 🔴 Compy's moat is visible evidence;
if master-detail buries the reason/measurement behind a tap, we start to look like the black-box
optimizers we attack. Guardrail: keep exactly one measured proof line visible per collapsed row.
Secondary: deleting render paths touches rollback/honesty-adjacent code — do it last, behind
green guards.
**First-Principles:** The ask was "re-architect nav," but the audit proves nav (5 rooms) is
already best-practice. The disease is per-screen density + triple-render duplication + multi-
affordance rows. Reframe the work as "one-answer-per-room contract + master-detail," not "re-tab
the app."
**Expansionist:** A calm, honest, "for-YOUR-rig" screen is not just less clutter — it's the
marketing weapon. It screenshots beautifully for share-cards/receipts and is the visual attack
on the snake-oil lane; and the Basic/Advanced contract is the scaffold the Pro surfaces
(history, multi-rig) bolt onto later.
**Outsider:** To a smart stranger, "Optimize = Check + Gaming Mode + Fix on one endless scroll"
plus five different words for the same fix state (Applied / History / Past Tweaks / measured
fine / not worth touching) is baffling — they can't tell what the app wants them to *do*. One
primary action per room fixes exactly this.
**Executor:** Monday move — build the master-detail row on **Optimize only**, behind `slimRows`,
and screenshot the before/after density drop. One component, one screen, proof in hand before
rolling it to Monitor and Home.
**Chairman:** Approved as **consolidation, not redesign.** Reframe from "re-tab" to "answer-first
+ master-detail + Basic/Advanced + dedup," hold the one-proof-line honesty guardrail, and start
with the Optimize row behind a flag.

---

## 8. Owner decisions — DECIDED 2026-07-01

1. **Blackbook / Learn:** ✅ **Keep top-level, visually demote.** Stays on the rail (content/SEO
   engine per Receipts Doctrine) but styled quieter — muted ink, below a separator — so it never
   competes with "what do I do."
2. **Ambient backdrop:** ✅ **Barely-there.** Faint slow drift behind the Home hologram; maps to
   defaulting Ambiance to "calm"; auto-off in Advanced mode. Off/Full remain user choices in
   Settings. (Unconditional reduced-motion/hidden freezes unchanged.)
3. **Recommended fixes:** ✅ **Pre-select Recommended** (AVG pattern) — rows arrive selected,
   the list always shows exactly what will change, one-tap deselect. **Selection ≠ application:**
   Apply stays an explicit user action; no auto-apply, rollback-first unchanged.

Decisions baked into mockup v2 (`docs/mockups/ui-slimdown-preview-v2.html`) and the P1 spec
(`docs/superpowers/specs/2026-07-01-p1-slimrows-optimize.md`).
