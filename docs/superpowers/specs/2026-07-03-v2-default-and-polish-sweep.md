# V2-default + polish/perf sweep — spec (2026-07-03)

Owner feedback dump after V2-9 (consistency pass, `fa684ca`). Four asks, resolved into a
3-prompt CC sequence. Design direction governed by the owner's product-UI vision brief
(Linear / Geist / Raycast / shadcn) — the V2 shell already IS that discipline; this refines it.

## The four asks (owner, verbatim intent)

1. **Ship V2 as default, remove the failsafe.** V2 product shell (`compy_v2` flag) becomes the
   build; drop the escape hatch to classic surfaces.
2. **Visual hierarchy / layering.** Sections read as "one blanket flat area, all matching
   templates, no visual appeal to distinguish highlights or information relative to one another."
   Use React/CSS layering to make discernible layers within each section.
3. **Hologram default-scales to fit** its viewable window when the window is minimized / small,
   and anywhere it renders.
4. **"What's this?" → hover tooltip.** Replace the clickable link (which pulls users out of the
   section) with an in-place hover affordance; don't yank context.
5. **Optimize-tab jank + nav-perf sweep.** Optimize tab occasionally hitches on enter/exit;
   sweep whole-app navigation for the same.

## Current-state anchors (verified 2026-07-03)

- Flag lives in `src/main.tsx:70-76` — `compy_v2 === "1"` sets `data-v2="on"`, default OFF.
  Sibling `compy_dash_v2` (`main.tsx:59-65`) is default ON with `"0"` as its failsafe — pattern
  to mirror, then tighten.
- Failsafe remnant referenced at `src/App.tsx:591` (classic FirstCheck kept "as a failsafe").
- `WhatsThis` component: `src/design/WhatsThis.tsx` — a `<button class="whats-this">` that calls
  `onOpen(id)` → Library quick-look overlay of the resolved Learn entry. CSS at `App.css:159`.
  Consumers: `Fix.tsx`, `Benchmark.tsx:427`, `GamingMode.tsx`. Guard test:
  `slim-row-proof-guard.test.tsx` asserts the "What's this?" TEXT reveals on tap — that guard
  must be updated, not deleted, when the affordance changes.
- Hologram: `src/surfaces/rig/RigHologram.tsx` — `@react-three/fiber` `<Canvas>`, already has
  `cameraDist` prop + reduced-motion + step-aside-while-capturing. Scaling is a
  responsive-container / camera-fit concern, NOT a rewrite.
- Optimize under V2: `OptimizeV2` (`src/surfaces/OptimizeV2.tsx`), statically imported
  (`App.tsx:19`), kept mounted after first visit (`App.tsx:962` keepalive). Jank is likely a
  heavy synchronous render / layout thrash on tab switch — profile before changing.

## Resolved design decisions (mine, recorded)

- **"What's this?" replacement = in-place tooltip/popover, full entry stays reachable.** A hover
  tooltip cannot hold a full Blackbook entry. Decision: hover reveals a SHORT plain-language
  blurb in place (no navigation); keep a secondary path to the full Library entry for depth
  (e.g. the tooltip itself is clickable/pinnable, OR a small "more" inside it). Do NOT delete
  access to the full entry — that content is doctrine (measured detail one tap away). This is a
  **taste call the owner can override** → flagged in the report.
- **Layering stays within V2 tokens.** No new color primitives, no new deps. Build hierarchy from
  existing `tokens-v2.css` surfaces/elevation + spacing + subtle borders/shadows already in
  `shell-v2.css`. Distinguish primary vs secondary info by elevation + weight, not new palette.
- **Sequence:** flag-flip alone first (clean, mechanical, high blast radius) → visual batch →
  perf sweep. Keeps commits verifiable and the flip revertable on its own.

## Hard lines (all prompts)

- Frozen risky-tweak catalog untouched; no mutation-boundary changes; rollback contract untouched.
- No new outbound network; no telemetry.
- Retain the 3D rig hologram as Home hero + its liveliness/idle motion (owner: beloved centerpiece).
- Reduced-motion + step-aside-while-capturing behavior on the hologram must survive.
- Tests/tsc/build never skipped. Update guard tests to match new behavior; never delete a guard.
