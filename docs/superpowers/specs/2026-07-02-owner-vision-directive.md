# OWNER VISION DIRECTIVE — 2026-07-02 (CANONICAL for design direction)

> Owner statement, persisted verbatim in substance: he is **not satisfied with the current
> direction of the app so far**. His Linear/Geist/Raycast/shadcn product-UI-system brief
> (captured in `2026-07-02-design-direction-product-ui-system.md`) is **the actual vision to
> implement** — not a checklist to be mapped onto existing plans and declared mostly-done.
> He allows he may not have seen the final product yet (P4/P6 unlanded), but he needs to SEE
> the changes he's looking for. **The 3D rig hologram ("holo lens") is the single thing he's
> happiest with — and even it should be improved, not merely retained.**

## Ruling updates (supersedes where in conflict)

1. My earlier reconciliation framing ("tightens, does not replace") is **demoted** — it
   answered component existence, not owner experience. The brief's look-and-feel is the
   target; existing primitives are raw material, not evidence the target is met.
2. The 2026-06-19 "current-over-cinematic" verdict is **point-in-time, now partially stale**:
   the owner's taste has moved. Current preference: modern high-trust product shell
   (Linear clarity, Geist type/grid discipline, Raycast density, shadcn component
   discipline), dark-first, serious — with the hologram elevated as the app's centerpiece.
3. Taste decision vehicle: **mockup first** (same mechanism that correctly killed the
   cinematic direction). Cowork builds `docs/mockups/ui-v2-product-shell.html` — Home +
   Optimize in the brief's style with real app content — owner judges with his eyes before
   any build prompt is written.

## What "hologram improved" can mean (candidates for the mockup, honesty-law compliant)

- Bigger, cleaner hero stage (dedicated panel, not competing with cards).
- Status projected ONTO the model: measured sensor/verdict states mapped to rig parts
  (GPU glow = measured temp band; never fabricated values).
- Scan sweep animation during an active check (ties the hero to real activity).
- Part-tap → detail inspector for that component (hardware panel integration).

## Sequencing

- **P4 dedup: unchanged and still first** — deleting dead render paths is required under ANY
  visual direction; zero conflict.
- Mockup → owner verdict → then P6/P7 are RE-SCOPED to implement the chosen shell (the
  Journey/RoomShell mechanics survive; the skin they render is the owner's call).
- No build prompts for the new shell until the owner approves the mockup.

## Standing correction for future sessions

Do not counter an owner dissatisfaction signal with an inventory of existing work. When the
owner says the direction isn't landing, the direction isn't landing — the gap between "in
code" and "on screen" has a third term: "in the owner's hands and liked."
