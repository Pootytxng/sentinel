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
| Radar | Backgrounds/Radar | Active-scan backdrop (one place) | LF-normalized, header added |
| DotField | Backgrounds/DotField | Quiet technical shell backdrop, barely-there opacity | LF-normalized, header added |
| Grainient | Backgrounds/Grainient | Texture pass — kills the flat-gradient look | LF-normalized, header added |
| Noise | Animations/Noise | Static grain texture overlay | LF-normalized, header added |
| ElectricBorder | Animations/ElectricBorder | ONE sanctioned use: hologram hero stage frame | LF-normalized, header added |
| SpotlightCard | Components/SpotlightCard | Hover treatment, priority/finding cards | LF-normalized, header added |
| GlareHover | Animations/GlareHover | Hover treatment (alternative — one of the two ships) | LF-normalized, header added |
| MagicBento | Components/MagicBento | Home stats bento rhythm; **Lab checkup bento** (`LabBento.tsx`, spec 2026-07-05-lab-bento-checkup) | LF-normalized, header added; **`ParticleCard` exported** so LabBento composes real station cards from the interaction primitive (theme-accent glow, tilt/magnetism off, reduced-motion gated) instead of duplicating it |
| GooeyNav | Components/GooeyNav | Rail active-state candidate (vs PillNav — dev-build eval, loser deleted) | LF-normalized, header added |
| PillNav | Components/PillNav | Rail active-state candidate (vs GooeyNav — dev-build eval, loser deleted) | LF-normalized, header added; **react-router-dom removed** — plain anchors + `onItemSelect` callback (Compy is router-less) |
| Stepper | Components/Stepper | Setup & Tour footer progress — numbered indicators + animated connectors + check marks (`compy_setup_stepper`, DEFAULT OFF; vendored 2026-07-05, round-2 pass) | LF-normalized, header added; **StepIndicator/StepConnector exported** (SetupTour composes the indicator row without the demo container); **status colors moved from the motion variants into token-driven CSS** (`data-status`; vendor purple can never paint, test-pinned); `reduced` prop zeroes every animation duration (reduced-motion gate) |

Adopt-list picks settled at vendor time (rationale in the V2-1 commit):

- **Radar over GridScan** — GridScan imports `face-api.js` (webcam face-detection ML) +
  `postprocessing`; unacceptable dependency surface for a scan backdrop.
- **DotField over DotGrid** — zero-dep vs gsap InertiaPlugin; same visual role.
- **Noise + Grainient over Dither** — Dither needs `@react-three/postprocessing` +
  `postprocessing` (two new deps for one texture).
- **ElectricBorder over BorderGlow** — the spec's named-first pick; zero-dep.

Runtime deps these components pull (all free, MIT-family, added in V2-1): `gsap`
(MagicBento, PillNav), `ogl` (Radar, Grainient), `motion` (DecryptedText, CountUp).

## threejs-holographic-material — github.com/ektogamat/threejs-holographic-material

Copyright (c) 2023 Anderson Mancini. **MIT License.** Vendored 2026-07-06 (T4d hologram bay
v2, owner-picked R1 option; spec `2026-07-06-firstcheck-monitor-mvp-train.md`).

| Component | Source | Use | Local modifications |
|---|---|---|---|
| HolographicMaterial | R3F gist referenced from the repo README (`gist.github.com/ektogamat/f33dce31ee3ab02ea68f7b7c18ecd016`) | The Home rig hologram's "bay glass" shell — `hologramColor` ALWAYS wired to the live theme accent (use-rig-colors), never the vendor default | Converted to TypeScript (typed props/ref); null-guarded the `useFrame` time tick (upstream crashed on the first demand-mode frame); `enableAdditive`/`side` dropped from the shader useMemo deps (mesh-level props — upstream recompiled the shader on toggle); reduced-motion contract documented (signalSpeed 0 + enableBlinking false ⇒ fully static render) |

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
