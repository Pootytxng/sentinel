# Third-party vendored components — src/design/vendor/

V2-1 foundation (spec `docs/superpowers/specs/2026-07-02-v2-shell-sourcing-and-plan.md`).
Vendored — not npm-installed — so the code is pinned, auditable, and adaptable to Compy's
token system. Every file carries a license header pointing here.

## React Bits — https://reactbits.dev (github.com/DavidHDev/react-bits)

Copyright (c) 2026 David Haz. **MIT + Commons Clause License Condition v1.0.**

Permission granted to use, copy, modify, merge, publish, and distribute the Software **as
part of an application, website, or product**. Commons Clause restriction: the components
may not be sold, sublicensed, or redistributed **as components** (alone, bundled, or
ported). Compy ships them inside an app — compliant. No warranty. Full text:
https://github.com/DavidHDev/react-bits/blob/main/LICENSE.md

All components below are the **TS-CSS (ts-default) variants**, vendored 2026-07-02 from
the `main` branch.

| Component | Source path (ts-default/) | Planned use (adopt list) | Local modifications |
|---|---|---|---|
| DecryptedText | TextAnimations/DecryptedText | Verdict lines resolve on scan completion — measured values only | LF-normalized, header added; **decode-once registry** (module-level `decodedTexts` set) so `animateOn="view"` scrambles a given text once per session and shows it resolved instantly on later re-mounts — stops the per-char scramble re-churning on every V2 room re-mount (the tab-switch "stick") |
| CountUp | TextAnimations/CountUp | Stat values land with weight — measured values only | LF-normalized, header added |
| ElectricBorder | Animations/ElectricBorder | ONE sanctioned use: hologram hero stage frame | LF-normalized, header added |
| SpotlightCard | Components/SpotlightCard | Hover treatment, priority/finding cards | LF-normalized, header added |
| Stepper | Components/Stepper | Setup & Tour footer progress — numbered indicators + animated connectors + check marks (`compy_setup_stepper`, DEFAULT OFF; vendored 2026-07-05, round-2 pass) | LF-normalized, header added; **StepIndicator/StepConnector exported** (SetupTour composes the indicator row without the demo container); **status colors moved from the motion variants into token-driven CSS** (`data-status`; vendor purple can never paint, test-pinned); `reduced` prop zeroes every animation duration (reduced-motion gate) |

> **Dead-code sweep 2026-07-13:** 7 never-adopted React Bits dirs removed (0 importers, grep-verified) —
> **Radar, DotField, Grainient, Noise, GlareHover, GooeyNav, PillNav**. Their table rows + the vendor-time
> rationale below are dropped with them. **Follow-up (not done here):** `ogl` was pulled ONLY by Radar +
> Grainient (both now gone) → it is likely an orphaned npm dependency; verify no other importer, then drop
> it from `package.json` in a dedicated dep-prune pass. `motion` (DecryptedText/CountUp) remains in use.

> **Generation prune 2026-08-06:** **MagicBento** removed — `LabBento.tsx` was its last importer and went
> with the dead Lab/Optimize generations (Optimize's live home is `lab/OptimizeStation` inside `LabGround`).
> Its table row is dropped with it. **`gsap` STAYS in `package.json`** — it is no longer a vendor dep at all
> but a first-party one: `design/console/ArcGauge.tsx` (the Lab console's corner arc gauges),
> `design/jarvis/MagneticLayer.tsx`, and `surfaces/lab/use-count-to.ts` all import it directly. A dep-prune
> that drops `gsap` on the strength of the older note above breaks the Lab console.

Runtime deps these components pull (all free, MIT-family, added in V2-1): `motion`
(DecryptedText, CountUp). (`gsap` and `ogl` — see the sweep notes above.)

## threejs-holographic-material — github.com/ektogamat/threejs-holographic-material

Copyright (c) 2023 Anderson Mancini. **MIT License.** Vendored 2026-07-06 (T4d hologram bay
v2, owner-picked R1 option; spec `2026-07-06-firstcheck-monitor-mvp-train.md`).

| Component | Source | Use | Local modifications |
|---|---|---|---|
| HolographicMaterial | R3F gist referenced from the repo README (`gist.github.com/ektogamat/f33dce31ee3ab02ea68f7b7c18ecd016`) | The Home rig hologram's "bay glass" shell — `hologramColor` ALWAYS wired to the live theme accent (use-rig-colors), never the vendor default; also the Two Futures "Now" shell | Converted to TypeScript (typed props/ref); null-guarded the `useFrame` time tick (upstream crashed on the first demand-mode frame); `enableAdditive`/`side` dropped from the shader useMemo deps (mesh-level props — upstream recompiled the shader on toggle); reduced-motion contract documented (signalSpeed 0 + enableBlinking false ⇒ fully static render); **`clearSpot` uniform added (2026-07-07, owner ask)** — soft viewer-facing transparency window so in-bay parts stay readable, 0 default = upstream-identical, view-dependent only (no new animation term) |

Runtime deps: `@react-three/postprocessing` (+ transitive `postprocessing`) added 2026-07-06
for the bay's Bloom + event-triggered Glitch. NOTE: V2-1 had rejected `postprocessing`-class
deps *for a flat texture effect* (Dither); T4d is the owner-approved exception where the dep
buys the actual hologram post stack on an existing three.js scene — scope stays the Home bay.

### Round-2 sourcing pass (2026-07-05, owner browsing reactbits index — pre-vetted shortlist)

Full catalog swept against the corrected pure-Instrument-HUD direction. **Candidates that pass
the rails** (deps already installed; vendor only when a concrete use lands): TextType (console
typing, needs the DecryptedText-style animate-once guard) · GradualBlur (scroll-edge fade on
queues/ledgers) · ClickSpark (tactile apply/toggle confirmation, tuned small) · Stepper
(setup/onboarding rework only — **vendored 2026-07-05**, row above) · LineWaves/Threads
(oscilloscope-adjacent; likely redundant vs our custom trace). **Rejected as off-law** (never-gamer-RGB/neon · garbled-text-reads-as-defect ·
glassmorphism ≠ instrument voice): Aurora, Galaxy, Plasma*, Prism*, Hyperspeed, Lightning,
LaserFlow, LiquidChrome, Iridescence, StarBorder, LetterGlitch, GlitchText, FaultyTerminal,
cursor gimmicks (Splash/Blob/Ghost/Crosshair), FluidGlass/GlassSurface/GlassIcons. Vetting rules
for any future pick: dep surface (reject `postprocessing`/`face-api` class) · honesty law ·
reduced-motion gate · re-mount churn guard · restraint rails.

### Sourcing channel — shadcn registry + MCP (wired 2026-07-05)

React Bits publishes a shadcn-compatible registry; it is now wired as the **fetch/browse
channel** for future sourcing rounds (replaces GitHub scraping):

- `components.json` (repo root) registers `@react-bits` → `https://reactbits.dev/r/{name}.json`.
  Item names carry the variant suffix — ours is always **`<Component>-TS-CSS`**
  (e.g. `TextType-TS-CSS`); suffixless/kebab names return the SPA HTML, not JSON.
- `.mcp.json` runs the shadcn MCP server for Claude Code sessions (catalog browse/search;
  loads on next fresh session). `shadcn` is pinned as a devDependency.
- Inspect without writing: `npx shadcn view @react-bits/<Name>-TS-CSS`.

**Vendoring law unchanged:** never `shadcn add` straight into the tree. Fetch via the
registry, then vendor by hand as before — license header, LF-normalize, token adaptation,
vetting rails (dep surface · honesty law · reduced-motion gate · re-mount churn guard ·
restraint rails), and a row in the table above.

## Geist Sans + Geist Mono — src/design/fonts/

Copyright (c) Vercel, Inc. **SIL Open Font License 1.1** — free to bundle/embed.
Full text: `src/design/fonts/OFL.txt`. Variable-weight woff2 (wght 100–900), vendored
2026-07-02 from github.com/vercel/geist-font `main`.

## Usage laws (bind every consumer of this directory)

- **Honesty law:** DecryptedText/CountUp render **measured values only** — never invented,
  never placeholder numbers presented as live.
- **§8b motion caps + reduced-motion:** every animated component is gated on the app's
  resolved motion preference (`:root[data-motion="reduced"]` freezes it).
- **Mono law:** Geist Mono on machine values only (numbers, hashes, timestamps, units).
- Components render only inside `compy_v2` surfaces until a stage ships default-ON.
