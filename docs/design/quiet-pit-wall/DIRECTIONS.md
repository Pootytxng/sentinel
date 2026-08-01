# Compy redesign — Phase A direction prototypes

Issue **#49** · branch `design/quiet-pit-wall` · worktree `C:\Users\Kuya\code\sentinel-quietpitwall`
Base: `e85d6ae` (main == origin/main, verified 2026-08-01). Nothing in `src/` was touched.

All four are single self-contained HTML files, native stage exactly **1280×720**, no CDN, no network,
work offline. Every one covers **Home · Lab · Monitor · Blackbook** plus a **continuity transition**
where the same subject (graphics card / hardware GPU scheduling) is visibly carried between rooms.
Room tabs, Monitor state chips (Idle · Recording · Result · Inconclusive) and a **Reduced motion**
toggle sit in the grey chrome *above* the stage — that chrome is not part of the design.

All data is clearly-marked fixture data. Nothing claims to be this PC.

---

## A — Quiet Pit Wall (pure)

Calm charcoal environment, one dominant scene per room, evidence illuminated instead of boxed.
Four-room rail. The rig sits beside the content as a static evidence map. A violet token flies
once from the old room's anchor to the new room's anchor when you move.

**Strength:** the most legible and the least fatiguing. Lowest implementation risk.
**Cost:** the least distinctive — a very good calm dashboard is still a dashboard. The rig is
decorative-adjacent; it explains state but does not carry the journey.

## B — Spatial Rig Console (pure)

No rail at all. The machine is full-bleed with a real camera; the four rooms are camera framings on
your own hardware, and a `YOUR PC › GRAPHICS CARD › THE DECISION · 1.9×` breadcrumb replaces the rail.
Panels dock to the selected component with a live leader line. Depth carries hierarchy.

**Strength:** by far the highest wow, and the most unmistakably "about my PC."
**Cost:** accessibility is the direction's core price. Spatial addressing is unusable by screen
reader, so the List-view fallback is a *required* second UI, built and maintained forever. Free
camera means "lost in space" is reachable. Camera moves cost the user ~640 ms on every room change.
Highest implementation cost of the four.

## C — Mission Deck (pure)

A physical card deck: the active mission forward, five more fanned behind it, and a five-stage track
(Recommendation → Decision → Capture → Result → Keep or roll back) across the bottom as the primary
orientation device. Rooms are consequences of the mission advancing. The rig shrinks to an evidence
badge. No XP, no streaks, no badges, no points — declining finishes the mission.

**Strength:** the easiest to understand cold. The proof loop is impossible to miss.
**Cost:** a five-dot track visibly *wants* to reach stage 5 — the exact nudge-to-apply we said we
would not build. Six stacked titles read as "your PC has six problems." Uniform cards leave dead
space on light rooms and squeeze the Monitor trace.

## D — The Hybrid ★ recommended

- **Quiet Pit Wall is the shell**: matte charcoal, negative space, one conclusion, one filled primary.
- **The rig is the signature *and* the navigation**: one SVG with an animated viewBox. Home shows the
  whole machine; Lab crops to the graphics card; Monitor crops tighter and the machine column
  narrows so the trace gets the width; Blackbook returns to the whole machine with the changed part
  marked. Clicking the mission's part goes to its decision. The crop is a true crop — the viewport
  aspect follows the viewBox, so nothing outside the frame leaks in.
- **The mission ribbon is the journey**: a thin line pinned under every room naming the subject and
  the stage. It is the carried-subject indicator and the progress reading in one, without a
  gamified progress bar.
- **Evidence and rollback are the payoff**: Measured / Expected / Unknown / Unavailable chips
  everywhere, before/current comparison, and a Blackbook receipt that reads
  action → evidence → result → present state, with outside changes fenced off and unrollbackable.
- **Advanced on demand**: the queue and advanced tools are two disclosures at the foot of Lab, and
  collapsed content is genuinely absent from focus and screen-reader order.

**Cost, honestly:** the reframing rig is real engineering (camera state per room, crop math, part
hit-targets) and it must stay silent when the room is idle. The ribbon is a persistent 52 px of
chrome. And a hybrid has to be authored as one thing — if the rig and the ribbon are built by
different hands it will read as three styles pasted together.

---

## Verified (headless Chromium, all four files, every room × every Monitor state)

- 0 external network requests, 0 absolute URLs in source, 0 JS errors, works offline.
- Reduced motion honored two ways — `prefers-reduced-motion` **and** the in-prototype toggle;
  measured transition durations collapse to ~0 s.
- Collapsed content uses `hidden`; no focusable element is reachable inside a collapsed panel or an
  inactive room.
- Every drag has a labeled keyboard/button alternative (spike stepping: ‹ › **and** arrow keys;
  B's camera: buttons **and** arrow keys; C's deck: drag, buttons **and** arrow keys).
- No interaction target under 24×24. Visible focus ring on everything focusable.
- No essential text under 13 px; monospace is used only for telemetry, timestamps and tabular values.
- One H1, one dominant scene, ≤3 peer choices, one filled primary per viewport.
- No continuous ambient motion anywhere: no orbit, sweeps, particles, count-ups, stagger reveals or
  fake processing delays. All motion is one-time and causal.
- Honest states present and reachable: Unavailable, Unknown, Expected, Inconclusive, declined,
  outside-change (no rollback), rolled-back (inactive).

## Not yet done (Phase B, after the gate)

Canonical UI-face and feature-flag inventory · token layer · Glance/Proof/Advanced component
contracts · global reduced-motion contract following Windows · then Home → Lab → Monitor →
Blackbook → Settings/onboarding → legacy-face retirement. Issue #14 stays a source of *portable
behavior and tests only*; it is never the base.
