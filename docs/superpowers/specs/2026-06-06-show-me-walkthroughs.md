# "Show me the way" — animated schematic walkthroughs (advisory recs + Learn)

*2026-06-06, Cowork, owner-blessed from the live concept demo. For advisory recommendations
that require action OUTSIDE Compy (GPU panel, BIOS, Windows Settings), give Sarah a visual
"simple as 1·2·3": an animated schematic — NOT screenshots — of the path, drawn in Compy's own
design language, with a cursor that glides click → click → done.*

---

## 1. Why schematic, not screen recordings (locked rationale)

Real GIFs/screenshots: megabytes (installer is ~2.6 MB total), stale every Windows/driver
update, wrong for half the rigs (Win10/11, AMD/NVIDIA), and a near-match screenshot that isn't
THEIR screen burns trust. Schematics are the IKEA principle: clearer because abstracted,
honest by design (never pretends to be the user's exact screen), kilobytes, theme-aware.

## 2. The component

- `Walkthrough` (one component, data-driven): a schematic stage (abstracted window: titlebar
  dots, sidebar, rows — tokens only) + an animated cursor dot with click-pulse rings + a
  synced numbered step list (1·2·3, captions). Loops with a pause; hover/focus pauses.
- **Data, not code:** each walkthrough is a JSON definition — id, title, steps[] (caption +
  highlight target), stage layout, cursor waypoints, optional per-vendor variants, optional
  `ms-settings:` deep-link id. Adding a walkthrough = adding data (the knowledge-layer
  pattern; same lint-test discipline as tweaks.json).
- **Reduced-motion:** static storyboard (the three frames side by side) — same data, no loop.
- **Hardware-aware variants:** where paths differ by vendor (AMD vs NVIDIA panel), render the
  variant matching the detected GPU; others reachable via a quiet tab. BIOS walkthroughs stay
  generic + honest caption ("menus vary by motherboard — look for XMP / EXPO / DOCP").
- **Deep-link pairing:** where an allowlisted `ms-settings:` link exists, the walkthrough
  pairs with the existing Open button — show the path, then open the door. NO new allowlist
  entries this pass.

## 3. Placement (nav-law compliant)

- Advisory cards (Check/Fix): a quiet **"Show me the way"** affordance expands the walkthrough
  IN PLACE.
- Matching Learn entries embed the same walkthrough by id.
- Landing page reuse (later, free): the same component is the storefront demo. Not this train.

## 4. v1 walkthrough set (five)

1. **VRR / FreeSync / G-SYNC enable** — AMD + NVIDIA variants (the readiness check that says
   "verify in your GPU control panel" finally shows the way).
2. **XMP / EXPO** — BIOS schematic, generic + honest caption; pairs with the Library entry.
3. **Windows Game Mode** — pairs with the existing settings deep link.
4. **Storage Sense** — pairs with the existing `storagesense` deep link.
5. **HDR / Auto HDR** — pairs with the existing display deep link.

## 5. Constraints + acceptance

Frontend-only · zero new IPC · zero new deps · zero new capability/allowlist entries · tokens
only · honesty: schematic always labeled ("schematic — menus vary slightly"), never vendor
logos/trademark dress, never fake OS chrome that could be mistaken for real.

- [ ] Component renders from JSON; lint test validates every definition (ids unique, steps
      1–5, captions plain-English, variant ids match known vendors).
- [ ] All five v1 walkthroughs live: advisory cards + Learn embeds; expand-in-place; loop +
      pause; reduced-motion storyboard.
- [ ] GPU-variant selection follows detected hardware; deep-link pairing uses ONLY existing
      allowlisted links.
- [ ] Owner eyeballs one loop (VRR) live: "any conscious creature could follow it."
