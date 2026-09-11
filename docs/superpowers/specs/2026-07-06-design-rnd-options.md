# Design R&D options — Stark-HUD component sourcing (Cowork lane, 2026-07-06)

> **PRODUCT DIRECTION SUPERSEDED 2026-09-04 (#369).** The instruction that picked options become
> build tasks and the pre-rebirth design direction below are historical. Current experience law
> comes from `docs/PRODUCT_CONSTITUTION.md`; research and license facts remain reference evidence,
> not implementation authority.
>
> Owner directive: source WIDE, beyond React Bits. Two web-research agents surveyed the
> 2025–26 landscape on 2026-07-06 (trending component libraries + the sci-fi/HUD/3D specialist
> end), licenses verified where possible. Direction stays LOCKED (operator-console Stark-HUD,
> never gamer-RGB/neon). Rails on every pick: vendor law (in-repo copy, THIRD_PARTY.md,
> vendor-brand colors can never paint — test-pinned) · theme-token accent only · zero runtime
> network · reduced-motion gate · GPU-cheap on monitoring surfaces.
> **Each picked option becomes a scoped CC build task (T4.x on the 2026-07-06 train).**

## The menu — pick any combination

### Option 1 — Hologram bay v2 (Home) — RECOMMENDED
The literal JARVIS move, on infrastructure we already own. Vendor
`ektogamat/threejs-holographic-material` (MIT, ~small shader + wrapper — copy source in per the
vendor law): fresnel edge-glow + scanlines + signal-flicker hologram shader with a `hologramColor`
prop that wires straight to the theme accent. Pair with `@react-three/postprocessing` Bloom
(+ event-triggered Glitch on state changes). **Perf lever: `frameloop="demand"`** — the canvas
renders only on interaction/data change, idle GPU ~0. Deps: rides the existing three.js; drei/
postprocessing are incremental (note: postprocessing pins three <0.185 — check at pin time).
Size: M.

### Option 2 — Instrument gauges (Monitor — rides T3)
Literal instrument-panel language for the T3 summary cards. Animata (MIT, copy-paste,
motion-optional): `Gauge Chart` / `Donut` / `Battery` widgets. Sliding-number live values
(Motion Primitives — **license UNVERIFIED**, vet or reimplement the ~40-line primitive).
Magic UI (MIT): `Flickering Grid` / `Animated Grid Pattern` as low-opacity card-face backdrops.
Size: S–M on top of T3.

### Option 3 — Boot & readout theater (FirstCheck — rides T2)
Check-run as a measurement ceremony: split-flap `Text Flipping Board` (Aceternity free tier —
their own open license, vet the specific component) or the already-vendored `DecryptedText`;
Magic UI `Terminal` (MIT) readout idiom; GSAP `ScrambleText` garble-in on measured values +
`DrawSVG` HUD-bracket draw-on. **GSAP verified 2026-07-06 against the live license page: 100%
free for commercial use incl. ALL former Club plugins since 2025-04-30** (Webflow "Standard
No-Charge License"; sole restriction: can't build a competing no-code animation builder). It IS
a new ~25–30KB runtime dep — added only if this option is picked. Size: M.

### Option 4 — Ambient HUD skin (app-wide chrome)
No library at all. CSS-only layered pass: `repeating-linear-gradient` scanlines · SVG
`feTurbulence` grain (procedural, no asset) · `backdrop-filter` glass · holo-foil gradient on
verdict headlines (OKLCH, accent-driven, `background-clip:text` + blend modes). Zero new deps,
near-zero GPU (single composited layer), reduced-motion fallback is the static version by
construction. Highest value-per-token on the menu; the app already has scanline DNA (HUD rooms)
— this systematizes it. Size: S.

### Option 5 — Depth & parallax interaction layer (cards/bento)
Pointer-driven 3D tilt + layered depth on bento/summary cards — extends the vendored
SpotlightCard/GlareHover precedent; 21st.dev's 87-entry Shaders tag as a per-component-vetted
source for card-face treatments. Rails: strictly event-driven (no continuous rAF), hard-off on
reduced-motion, idle cost zero. The most "interactive premium" option and the one to police for
gimmick-creep — recommended AFTER T0–T3 land so it decorates a settled layout. Size: M.

## Source shelf (vetted 2026-07-06)

| Source | License | Styling | New runtime dep | Fit | Note |
|---|---|---|---|---|---|
| Magic UI | **MIT** (confirmed, 21.2k★) | Tailwind+Motion → port to token CSS | none | 5/5 | Border Beam, Glyph Matrix, Flickering Grid, Terminal, Light Rays |
| Aceternity UI | free tier open (their license page — not MIT) | Tailwind+Motion → port | none | 5/5 | Text Flipping Board, Dither Shader, Encrypted Text, Glowing Effect |
| Animata | **MIT** (confirmed, active releases) | Tailwind, motion-optional | none | 4/5 | THE gauge/dial/battery widget source |
| pmndrs stack (R3F/drei/postprocessing) | MIT | n/a | rides existing three.js | 5/5 | Bloom · Glitch · ScanlineEffect · `frameloop="demand"` |
| threejs-holographic-material | **MIT** | n/a | vendor as source | 5/5 | purpose-built hologram shader, accent-wireable |
| GSAP | free comm. license (verified) | n/a | +25–30KB if picked | 4/5 | ScrambleText/SplitText/DrawSVG boot choreography |
| 21st.dev | **per-component** — vet each | mixed | varies | 4/5 | discovery engine; 87-item Shaders tag |
| Uiverse | MIT site-wide | plain CSS | none | 3/5 | zero-JS micro-interactions; heavy neon-filtering needed |
| KokonutUI | free tier OSS (repo) | Tailwind+Motion | none | 4/5 | glass/HUD widgets, SaaS-polish skew |
| Cult UI | MIT free core | Tailwind | none | 4/5 | the Circuit Board/Gateway HUD pieces are paid Pro — skip those (zero-budget) |
| Motion Primitives / Skiper / Eldora | **UNVERIFIED** | Tailwind+Motion | none | 3–4/5 | vet license before vendoring, or reimplement |

Porting note: most sources are Tailwind-authored; Compy is token-CSS — every vendored component
gets the same port treatment the 13 React Bits pieces got (precedent exists, cost already known).

## Ruled OUT — hard findings, don't relitigate

Spline (**runtime `fetch()` is mandatory** even self-hosted, per their own docs — hard
zero-network conflict) · unicorn.studio (CDN embed; true self-host paywalled at $168/yr) ·
Vanta.js (npm dead ~4yr, Snyk-flagged discontinued, unresolved high-CPU issue #32 —
disqualifying for a monitoring app) · Theatre.js (main branch silent since 2024-04) · Arwes as
a dependency (pre-1.0 alpha, ~360 wkly downloads — **study** its FrameCorners/typing patterns,
reimplement narrowly) · Hover.dev (copyright-protected, not redistributable — fails vendor law)
· 0-star "jarvis-ui"-type npm micro-libs.

## Standing facts

Zero-budget law holds: every option above is $0 (GSAP's paid era ended 2025-04-30; Cult Pro /
Skiper premium / v0-Figma credits stay owner-gated and are NOT required by any pick). Licenses
marked UNVERIFIED must be confirmed before vendoring. Owner picks → T4.x build prompts same day
to ride the Fable window.
