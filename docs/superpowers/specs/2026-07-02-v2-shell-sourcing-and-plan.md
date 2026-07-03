# V2 shell — originality sourcing + build plan (2026-07-02)

> Owner approved the V2 mockup direction (`docs/mockups/ui-v2-product-shell.html`) with a
> standing amendment: **no default-AI-template look** ("AI slop") — source distinctive assets
> from outside (he named React Bits + Awwwards-realm). Memory: `anti-ai-slop-originality-mandate`.
> Governing vision: `2026-07-02-owner-vision-directive.md`.

## Sourcing rules (laws applied)

- **React Bits** (reactbits.dev, MIT + Commons Clause): free for commercial use in a product;
  the clause only bars reselling the components themselves — we ship an app, compliant. Use
  the **TS-CSS variants** (no Tailwind in our stack). Vendor code into `src/design/vendor/`
  with license header retained + `THIRD_PARTY.md` credit line. Its Texture Lab (noise/dither)
  may generate texture assets — exports are ours to use.
- **Awwwards-realm sites: principles + inspiration ONLY** — all-original law: never clone
  proprietary visuals; extract technique, redraw ours.
- **Fonts (the fastest slop-killer):** bundle **Geist Sans + Geist Mono** (OFL 1.1, free to
  embed) — the literal type system of the owner's cited Vercel reference, and instantly
  distinct from default system/Inter builds. Mono-only-for-machine-values law unchanged.
- Zero-budget: everything above is $0. Any paid asset (e.g. a display face) = owner gate.

## Curated pick list (from the actual React Bits catalog, ~110 scanned)

**Adopt (serious, restrained, matches trust identity):**

| Component | Where it lands in Compy |
|---|---|
| `DecryptedText` | Verdict lines resolve character-by-character when a scan completes — the "measurement arriving" moment. Sparingly: verdicts only. |
| `CountUp` / `Counter` | Stat values (fps avg, ledger count, wins) land with weight. Replaces AnimatedNumber where better. |
| `GridScan` / `Radar` | Scan-in-progress backdrop — literally our semantics (checks sweeping the system). One place: active-scan state. |
| `DotGrid` / `DotField` | Quiet technical backdrop for the shell (replaces flat panels behind the hologram stage). Barely-there opacity, §8b motion caps. |
| `Dither` / `Noise` / `Grainient` | Texture pass — the handcrafted feel; kills the flat-gradient AI look. Static or near-static. |
| `ElectricBorder` or `BorderGlow` | ONE sanctioned use: the hologram hero stage frame. Nowhere else. |
| `SpotlightCard` / `GlareHover` | Hover treatment for priority/finding cards — tactile, not flashy. |
| `MagicBento` | Home stats layout treatment (bento rhythm for the Stat column). |
| `GooeyNav` or `PillNav` | Rail active-state treatment — evaluate both on the dev build, pick one, delete the other. |

**Rejected (gaming-RGB / novelty — violates the brief):** Ballpit, Balatro, Hyperspeed,
Galaxy, Lightning, LiquidChrome/LiquidEther, Plasma, PrismaticBurst, LetterGlitch,
GlitchText, EvilEye, Crosshair, BlobCursor/GhostCursor/ImageTrail (custom cursors), Lanyard,
FlyingPosters, MetallicPaint, Iridescence, FaultyTerminal.

**Not needed:** ModelViewer (our hologram is custom WebGL and stays ours — it's the one
asset the owner singled out as best-in-app; improve per the vision directive, never replace
with a stock viewer).

Deps note: preferred picks are CSS/canvas-light; anything pulling gsap (free) or three
(already bundled) is fine; no new paid or heavyweight deps without flagging.

## Stage tracker (one stage = one session = its own commit; tick when live-verified)

- [x] **V2-1 Foundation** — 2026-07-02: Geist bundled (variable woff2 + OFL) · tokens-v2.css
      (mockup palette, faint nudged #5c6478→#626a80 for the 3.0 floor) · 12 components vendored
      (Radar over GridScan — face-api.js dep; DotField over DotGrid; Noise+Grainient over Dither;
      ElectricBorder; both nav candidates) · deps gsap/ogl/motion · compy_v2 flag default-OFF +
      Settings preview toggle · 22 guards (scoping=byte-identity, contrast, Geist-via-tokens-only,
      vendor license hygiene).
- [ ] **V2-2 Shell** — rail + topbar + RoomShell v2 skin
- [ ] **V2-3 Home** — hologram hero stage + bento stats + priorities + door
- [ ] **V2-4 Optimize**
- [ ] **V2-5 Monitor**
- [ ] **V2-6 Blackbook**
- [ ] **V2-7 Lab**
- [ ] **V2-8 Journey doors + tour alignment**
- [ ] **V2-9 Consistency pass**

## Build plan (re-scopes P6; P4 dedup still lands FIRST)

Flag: `compy_v2` — DEFAULT OFF, Settings preview toggle, flag-off byte-identical, the proven
P1–P5 pattern. Owner sees every commit live via `npm run tauri dev`.

1. **V2-1 Foundation:** bundle Geist fonts · tokens-v2 (mockup palette: bg #0a0c10, panel
   #10131a, hairlines, accent #a78bfa family) · vendor kit (`src/design/vendor/` with the
   adopt-list, license headers, THIRD_PARTY.md) · guards (contrast, literal, mono-usage
   extended to v2 tokens).
2. **V2-2 Shell:** rail + topbar per mockup (kbd hints, zero-outbound footer, stamp) +
   RoomShell primitive carrying the v2 skin (verdict → primary action → body → quiet →
   forward door).
3. **V2-3 Home:** hologram hero stage (bigger, ElectricBorder frame, measured part-tags,
   scan sweep tied to real check activity) + bento stats + priorities card + door.
4. **V2-4 Optimize** · **V2-5 Monitor** · **V2-6 Blackbook** · **V2-7 Lab** — one room per
   commit, mockup as contract.
5. **V2-8 Journey doors + tour alignment** (absorbs old P6 §2/§4) · **V2-9 consistency pass**
   (old P7).

Hard lines every commit: zero src-tauri diff · TrustSwitch + audited handlers untouched ·
honesty law (DecryptedText/CountUp render measured values only, never invented) · §8b motion
caps + reduced-motion freezes · hologram retained and improved, never demoted.

## Hologram improvement track (the owner's favorite thing — first-class, not a footnote)

Owner: "the coolest single thing in the app, and even that could probably be improved."
V2-3 carries: bigger dedicated stage · measured statuses projected onto parts · scan sweep
during live checks · part-tap → detail inspector. Further ideas (V2-10 candidates, owner
taste): subtle parallax on mouse, thermal-tint mode from real sensor bands, session-replay
"ghost" overlay from Monitor data. All honesty-gated: the model never displays a value that
wasn't measured.
