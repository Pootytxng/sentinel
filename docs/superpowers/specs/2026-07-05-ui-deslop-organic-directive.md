# TOP-PRIORITY DIRECTIVE — de-slop the UI, make it organic + unique (owner, 2026-07-05)

> **Owner directive (verbatim intent, persisted per PERSIST-TO-DISK).** After living with the
> shipped V2 shell + guided Lab, the owner's verdict: the UI — though theme-consistent — reads as
> **generic "AI-slop" template design**. He wants something **organic and unique**, concise, not
> stock. Specific points he raised:
>
> 1. **"Walk the bench" is redundant** — it just repeats the description text already on each Lab
>    station. Replace it with a guided option that, **in simpler terms**, asks what the user is
>    here to do and **redirects them straight to the best-suited tool** (a plain-language router
>    experience, not a narrated repeat of the station copy).
> 2. **The templates/UI are recognizable AI-default slop** — matching the theme isn't enough; the
>    component language (uniform card grids, stock stat blocks, default toggles, predictable
>    layout) is generic. Make it organic + unique.
> 3. **The text is very bland** — copy needs voice/craft, not filler.
> 4. **Home last-session numbers render plain white** — they should follow the red/yellow/green
>    graded color indicator like the rest of the measured values.
> 5. **Home rig hologram now has a blank cut-off area at the bottom** — a sizing/layout regression
>    to fix.
> 6. **Bring in trending design tooling** — use tools / MCP servers / connectors from trending
>    partners capable of working with Claude, and apply them anywhere the UI currently uses
>    recognizable AI-slop defaults.
>
> **Process instruction:** first confirm we're at a clean point so this doesn't strand in-flight
> work (✅ confirmed 2026-07-05 — HEAD `b413204`, main in sync with origin, zero unpushed commits,
> Lab guided-bench train complete; only the owner's default-ON eyeball is pending, which is
> non-blocking). THEN elevate this directive to **highest priority**. Done — see BACKLOG top lane.

## CREATIVE AUTHORITY — Fable 5 (in CC) executes; this doc STEERS, it does not blueprint (owner, 2026-07-05)

**Owner decision:** the final artistic/output calls belong to **Fable 5 in the CC build lane**, not to
Cowork. This document is *direction + references + hard rails*, deliberately NOT a pixel spec. Fable has
**full creative latitude** on: exact type scale + families, spacing/layout system, component forms, the
gauge/telemetry treatments, motion choreography, how far to push each effect, color accenting within the
theme. The mockups + interactive demo Cowork produced (`compy_home_editorial_instrument_blend`,
`compy_home_interactive_jarvis_demo`) are **mood/intent references, not targets to copy** — Fable should
better them. Cowork's role from here is to steer direction and audit against the HARD RAILS below, not to
dictate execution. Where this doc and Fable's judgment differ on *taste*, Fable wins; where they differ on
a HARD RAIL, the rail wins.

**HARD RAILS (the only non-negotiables — everything else is Fable's call):**
- Honest-measurement: every number graded/measured or honestly absent; motion visualizes REAL data, never fakes it.
- Performance: frontend-only, GPU-cheap, pause the WebGL/rAF loop on window-blur / while a game runs / on battery — Compy must never hog the GPU it exists to free. Zero `src-tauri`/IPC diff.
- Reduced-motion: a calm still version always available (`useReducedMotion`).
- Reversibility: flag-gated, DEFAULT OFF, flag-off byte-identical (P-series pattern); rollback/TrustSwitch/mutation paths untouched.
- All-original; plain-language honesty voice preserved.

## Split: aesthetic-independent bug fixes (ship now) vs. the redesign (Fable's creative lane)

Two of the six points are objective bugs that shouldn't wait on the redesign's aesthetic
direction — fix them immediately in a small CC train:

- **#4 Home session-number grading** — the grading infra ALREADY exists (`src/data/metric-grade.ts`:
  `gradeFps`, `gradeLow1`, `gradeColor`). HomeV2's "Last session" card just renders the numbers
  plain instead of calling it. Wire `gradeFps(avg, ctx)` + `gradeLow1(low, avg, ctx)` → `gradeColor`
  on the fps-avg and 1%-low values (honest reference already in `RigContext` — monitor Hz / session
  ratio, no fabricated threshold). bug→guard: pin that the graded value carries a tone class.
- **#5 hologram blank cut-off** — the RigHologram stage on Home has dead space at the bottom
  (likely a canvas/stage height mismatch after the stat-column fill changed the row height). Fix
  the stage sizing so the model fills its frame; self-review with native-res shots.

Points **#1, #2, #3, #6** are the **redesign lane** — taste-laden, so they need the owner's
aesthetic direction before build (see the open question below). The "Walk the bench" rework (#1)
folds into this lane rather than a throwaway quick-fix, since its final form depends on the new
design language.

## The redesign lane — approach (pending owner's aesthetic pick)

**Why not hand-roll more components:** hand-rolling is exactly what produced the generic feel.
The escape is real design tooling:

- **Figma MCP** (available) — design a bespoke visual system + signature components in Figma, pull
  `get_design_context` / `get_variable_defs` / `create_design_system_rules` to generate code that
  matches a *designed* artifact, not a template guess.
- **Vercel / v0 MCP** (available — `import-claude-design-from-url`, `get_design_context`, deploy) —
  generate distinctive, non-stock components from a design intent.

**Sequencing (once the aesthetic direction is set):**
1. Pick ONE flagship surface as the pilot — **Home** (the first impression) — and redesign it end
   to end in the chosen direction using the design tool, not stock primitives.
2. Owner reacts to the pilot (flag-gated, DEFAULT OFF — same reversibility contract as P-series).
3. Roll the proven language to Optimize → Monitor → Blackbook → Lab (Lab absorbs the #1 walk-the-
   bench rework here).
4. Copy pass for voice (#3) rides each surface — plain but crafted, honesty laws intact.

**Hard lines (unchanged):** every redesign stays frontend-only (zero `src-tauri`/IPC), read-only,
honest-measurement (graded, never fabricated), rollback/TrustSwitch untouched, flag-gated + flag-off
byte-identical, all-original. "Organic/unique" never buys a loosened gate or a fabricated number.

## LOCKED — aesthetic direction: **Editorial-Instrument** (owner, 2026-07-05)

Editorial owns the *story* (serif verdict headline, crafted voice, whitespace, intentional rules);
Instrument owns the *data* (mono numerals, gauges, signal traces, HUD precision). Unified by
letterspaced mono labels, hairline rules, and green reserved strictly for a graded-good value.
Chat mockups approved (`compy_home_editorial_instrument_blend`). Pilot = Home, built full-fidelity
in Figma/v0, flag-gated DEFAULT OFF, then rolled to all five rooms.

## Interaction / motion layer — "JARVIS-grade" (owner, 2026-07-05)

Owner wants the app to *feel* like Tony-Stark-level precision tech — rich interactive effects
(referenced a panoramic drag-and-scroll gallery on a site he built for his sister; wants effects
**of that nature**, not that exact one). This reinforces the measurement brand: feeling like an
instrument = proof, not decoration. Sanctioned by the Receipts doctrine (amplify real wins loudly).

**Reference reviewed (2026-07-05): `sister-site-tau.vercel.app` (Prickly Creations Co.).** Next.js
site; the effect the owner loves is `/experience` — *"an immersive 3D gallery — drag to explore our
work in a warm desert space; click a piece to see it closer"* (a draggable WebGL 3D *space*, almost
certainly React-Three-Fiber, with a "prefer the classic grid" fallback), plus horizontal panoramic
image tracks on the home page. **Key insight: Compy already owns this primitive** — the rig hologram
IS a "drag to explore a 3D object, click a part for its specs" interaction. The sister site is the
*product-gallery* version of what Compy can be for *data* (rigs, benchmarks, receipts as pieces in a
draggable telemetry space, each honest and clickable-for-detail).

## Research synthesis — my input (grounded in 2025–26 state of the art, not priors)

Sources: Awwwards Sites of the Year 2025 (Messenger/abeto, Lando Norris/OFF+BRAND), Codrops 2025–26
tutorial run, Figma/TheeDigital 2026 trend reports, GSAP-now-free (Webflow, Apr 2025), Motion,
MDN/web.dev perf + a11y. What's actually winning: **real-time WebGL as the experience itself**,
**kinetic editorial typography as interface**, **spatial "places not pages"**, cursor/scroll-driven
depth. That validates Editorial-Instrument + the drag-3D reference directly.

**Chosen stack (maturity + cost-checked):** GSAP + ScrollTrigger (now 100% free, ~30KB, cheap,
drives gauge sweeps + shader uniforms *from live data*) · Lenis (tiny smooth-scroll spine) · Motion
(`motion/react`, declarative UI + magnetic `<Cursor>`) · keep the existing Three.js for the rig
(it's the ONE always-on WebGL surface) · OGL or Curtains.js only if/when we build the panoramic
telemetry gallery (heaviest item — lazy-load + gate). Scanline/CRT HUD skin = CSS-only (near-zero
GPU) for the JARVIS read.

**Ranked effect plan for Compy (wow-per-effort):**
1. **CSS scanline/chromatic-aberration HUD skin** (opacity ~0.07, "felt not seen") — the whole JARVIS
   read for near-zero GPU.
2. **GSAP data-reactivity** — gauge sweeps, count-ups, shader uniforms animated *from real metrics*
   (honesty win: motion serves data).
3. **Magnetic cursor + mouse-tilt parallax** on the rig panel (compositor-cheap; off under reduced-motion).
4. **Rig hologram: drag-orbit (exists) + click-a-component-for-live-specs + boot/scan sweep on load.**
5. **Panoramic inertia-drag telemetry gallery** (the sister-site feel, pointed at benchmarks/sessions/
   receipts) — highest wow, HEAVIEST; lazy-load, cap dpr, gate behind the FPS check.
6. **Lenis smooth-scroll spine** tying rooms together.

**Guardrails baked in (from the perf/a11y research):** animate only transform/opacity/filter; cap
`devicePixelRatio` ~1.5–2; pause the rAF/WebGL loop on `visibilitychange` (never compete with the game
being optimized); adaptive tiers via `hardwareConcurrency`/`deviceMemory`/battery; `prefers-reduced-
motion` → still versions (durations 0.01ms, not 0); one global "reduce effects" toggle. These ARE
guardrail #1 (performance) + #3 (reduced-motion) made concrete.

**Feasible in-stack:** Compy is already a real WebGL app (the drag-to-orbit rig hologram is genuine
Three.js) — panoramic drag, parallax depth, scan-sweeps, magnetic hover, signal-trace animation are
all achievable in the existing React/Tauri stack.

**THREE HARD GUARDRAILS (non-negotiable — the suit is powerful AND efficient):**
1. **Performance:** Compy makes *games* faster — it must not hog the GPU. Effects stay GPU-cheap;
   auto-quiet when a game is running / on battery / low power. A measurable frame/CPU budget per
   surface.
2. **Honesty:** every effect visualizes REAL data — signal traces pulse with actual fps, the
   scan-sweep animates only during a real check (the existing HomeV2 ethos: motion tied to real
   activity). No motion that implies data that isn't there.
3. **Reduced-motion:** a still, calm version for anyone who wants it (already honored via
   `useReducedMotion`).

Candidate effects mapped to surfaces (to detail after the reference review): Home rig — panoramic
drag-orbit + parallax depth + a boot/scan sweep on load; telemetry column — live signal traces +
count-up on real values + magnetic hover reveals; room transitions — an instrument "retune" wipe;
Monitor — the meters as living oscilloscope traces. All flag-gated, all honest, all reduced-motion-safe.

## PILOT DESIGN RECORD — Home shipped (Fable, 2026-07-05, creative-authority lane)

Flag `compy_editorial` (DEFAULT OFF, Settings → Appearance "Editorial look (preview)"); flag-off
byte-identity test-pinned (`home-editorial-flag.test.tsx`). The executed design, recorded so the
rollout to the other four rooms stays coherent:

- **Type roles:** Instrument Serif 400 (OFL, bundled latin regular+italic, 43KB total,
  `fonts-editorial.css`) for DISPLAY VERDICTS ONLY — single weight = restraint by construction.
  Geist Sans stays the body/label voice; Geist Mono stays machine-values-only, plus letterspaced
  uppercase 10px eyebrows as the section-label register. Token: `--v2-font-serif`
  (`tokens-editorial.css`, scoped `[data-v2="on"][data-editorial="on"]`).
- **No new hues.** Editorial adds only hairline/scanline alphas (`--ed-hairline`, `--ed-scanline`).
  Color remains information: graded ink, status LEDs, violet for interaction.
- **Geometry voice:** edh chrome is 4px/3px radii (sharper than the v2 10px default) — instrument
  edges, part of the de-slop.
- **Home layout:** masthead (eyebrow `RIG REPORT · date` → serif verdict → dek → folio-ruled
  measured line) · instrument bay (real hologram, HUD corner brackets, static whisper scanline,
  callout part-tags on hairline leaders, event-driven pointer parallax on the ANNOTATION plane
  only — never the canvas, so it can't fight drag-orbit; no rAF loop, nothing runs on blur) ·
  telemetry ledger (hairline measurement log — replaced the four identical SpotlightCards) ·
  ranked docket (mono rank numerals = real priority order).
- **Dropped from the template read (editorial path only):** SpotlightCard, ElectricBorder,
  DecryptedText scramble — a serif verdict lands composed. HomeV2 keeps them flag-off.
- **Voice fixes found in self-review:** the dek no longer restates the headline; in the clean
  state the docket's clear line is the ONE owner of "measured clean" on the screen.
- **Deps:** none added. GSAP/Lenis deferred — CSS + existing components covered the pilot;
  revisit only if a later room's choreography demands it. v0/Figma MCPs not spent (owner-gated
  credits); fonts bundled locally, zero network.
- **Follow-ups for the rollout:** SetupLauncherCard still wears the app-template look inside the
  editorial page (restyle when Home's language is approved); room transitions ("retune" wipe) and
  Monitor oscilloscope traces are rollout-phase candidates.
