# compy.gg FULL MAKEOVER — research digest + spitball (2026-07-14)

> Owner rejected the shipped two-strip hero (`2eda4eb`) outright and commissioned a complete site
> makeover: research-first, spitball, decide together. This doc is the durable record of the
> 5-lane research sweep (workflow `wf_294fe87f-8bc`, 5× sonnet researchers, ~358k tokens) and the
> resulting proposal. Directive verbatim: `docs/UI_VISION_BACKLOG.md` §G.
> Constraints carried into any build: honest-measurement law (real-provenance only, no gain
> claims — `scripts/site-landing.test.mjs` guards survive in spirit) · zero-budget ($0 free-tier,
> Cloudflare Pages) · dark default · site PRE-PUBLISH until owner deploy GO.

## 1 · Design-trend research (what's winning 2025–26)

- **Bento grids held up** (Linear/Ramp/Apple lane; Awwwards has a dedicated "Bento – Linearity"
  collection; one audit measured +23% scroll depth vs 12-col). Natural container for spec cards +
  receipt stats.
- **Dark-default + ONE saturated accent** is the design-led-SaaS norm (~¾ of design-led sites).
  Near-black `#0f172a`-family, NOT pure `#000`; off-white text, NOT pure `#fff`.
- **Technical-mono / engineering aesthetic** (monospace, terminal restraint) is the credibility
  register — matches Compy's in-app HUD 1:1 and reads "engineering rigor," not "marketing hype."
- **SpaceX correction:** the real aerospace-premium move is FLAT high-contrast telemetry readouts
  (webcast overlays, Crew Dragon's flat touchscreen) — NOT skeuomorphic analog gauges.
- **Evil Martians 100-site dev-tool study:** premium = restraint (one big headline, breathing
  room, non-salesy copy). Cheap = animation on everything, cramped layouts. Astro's real
  performance-comparison table = "data as proof" — maps 1:1 onto the Receipts Doctrine.
- **Full cinematic WebGL scroll heroes** (Pendragon Cycle / Hubtown SOTDs) are agency-built and
  GPU-heavy — borrow the *principle* (scroll reveals data in sequence) with GSAP ScrollTrigger,
  skip full 3D scenes.
- **Anti-pattern checklist** (audit gate for the build): animation on every scroll element ·
  hover effects on non-interactive elements · glassmorphism everywhere (≤1 element if at all) ·
  organic blobs · broken brutalist grids · Razer/Corsair RGB-spectacle language (wrong reference
  class — we're Linear/Raycast-lane credibility, not gamer-spectacle).
- Cheap non-visual add: `llms.txt` + schema markup (AI-mediated-search visibility) for the funnel.

## 2 · Competitor teardown (the comparison-page ammunition)

| Competitor | Hero claim | Evidence offered | Notes |
|---|---|---|---|
| Razer Cortex | "Unlock your pc's full potential" | none (qualitative) | kitchen-sink platform; per-game REVERT only |
| Hone (hone.gg) | "Up to 45% FPS increase in Fortnite" | a user testimonial dressed as a stat | closest direct competitor; Trustpilot mining shows freezes/crashes/data-loss with no clean revert |
| CCleaner | "Makes Your Computer Faster" | none | reviewers: "dated… no real innovation in years"; Gen Digital |
| IObit ASC | "Improve 35%" / "Save 35s" | ONE 2015 HP notebook | + "95% of visitors claimed the gift" urgency dark-pattern; reviewer-documented upsell fatigue. The category's what-NOT-to-do exhibit |
| Outbyte | "Speed Up, Repair & Protect" | none | historical scan-scare/AppEsteem-flag lineage |
| Smart Game Booster | (owned domain expired/parked) | — | brand instability; distribution-only presence |
| Wise Game Booster | "Free Game Speedup Tool" | none | legacy utility site |
| AVG TuneUp | "faster performance" | none | Gen Digital again; Sleep Mode = session trick, not tracked mutation |
| Norton Game Optimizer | core-dedication (patented, named mechanism) | plausible but unmeasured-to-user | the one claim to be FAIR to in a comparison |
| ExitLag / WTFast | ping −30–70% / "AI-Powered GPN" | route ping is at least testable | network-adjacent, not direct; direct fetches 403'd (secondary-sourced) |

**The axis nobody else can claim:** every competitor is either (a) pure adjectives, or (b) one
cherry-picked device / testimonial-as-headline. **Nobody publishes per-rig before/after receipts
including nulls, and NOBODY makes rollback a marketing claim at all.** Comparison table should
lead with **"Can you undo it?"**, not "does it boost FPS?" — and concede Norton/ExitLag's
relatively-honest claims (self-aware comparisons convert 13.8% vs ~7.5% attack-only pages).
Reviewer pull-quotes usable as-is: "hasn't been redesigned since 2015," "Windows Vista-era,"
"any product promising 300% is marketing theater, not engineering."

## 3 · Conversion architecture (the buy-and-go path)

- **Page map (5):** `/` home · `/pricing` · `/compare` (or per-competitor `/vs/*`) · Blackbook/
  Library (the existing content engine) · FAQ folded into home + pricing (standalone page only if
  it outgrows them).
- **Nav: 4–5 items max + sticky CTA pair** (Download Free / Get Pro) — the CleanMyMac pattern
  (2 info items + 2 CTAs), not Raycast's platform nav.
- **Home order:** hero (value prop legible ≤3s, ONE primary CTA + ambient muted HUD loop w/ pause
  control) → trust bar → feature sections built around the HUD visuals → receipts/proof section
  (real before/after data > testimonials) → compact pricing teaser (2 cards) → 6–8-item accordion
  FAQ (FAQPage JSON-LD) → final CTA.
- **/pricing:** FAQ accordion ABOVE the table (Raycast pattern), stripped nav (logo + CTA only —
  removing nav on decision pages can ~double conversion; optimized pricing pages hit 8–12% vs
  3.8% median), sticky Get Pro.
- **Free tier labeled "Free Forever"** — not a trial; differentiates from the trial-gated
  category (CCleaner/CleanMyMac) and matches the doctrine's trust-engine funnel.
- **Video (LATER phase per owner):** ambient muted hero loop is safe now; the 60–90s click-to-play
  tour goes after features, never autoplay-with-sound. WCAG 2.2: pause control for >5s motion.
- **Kill-list:** multiple competing CTAs per viewport (13.5% single vs 10.5% multi), hidden
  pricing, open-ended decorative animation.

## 4 · Stack (the $0 build platform)

- **Astro + React islands** over plain Vite-React SPA: static HTML by default (SEO/LCP), only the
  animated components hydrate (`client:visible`/`client:idle`). Deploys to Cloudflare Pages free
  tier (unlimited bandwidth/requests, 500 builds/mo, 20k files — ample).
- **React Bits** (MIT + Commons Clause — free for our commercial use; only reselling components is
  barred): 110–140+ components, copy-paste/shadcn-CLI, CSS-first. Shortlist for us: CountUp
  (receipt numbers), SplitText/BlurText, ShinyText (CTA), SpotlightCard/MagicBento (spec cards),
  ONE OGL background (Aurora/Threads/Dither class — OGL ~30-50kb, prefer over three.js).
  DecryptedText only mount-once (re-scramble was a past defect class). React Bits Pro
  ($99–299) = owner-gated later spend, default no.
- **GSAP is now 100% free incl. all plugins** (Webflow acquisition; ScrollTrigger/SplitText, no
  license key) · **Motion** (ex-Framer Motion, MIT irrevocable) for component transitions ·
  **Lenis** (MIT, ~3-4kb) smooth scroll — the exact JARVIS stack named in UI_VISION_BACKLOG.
- **Zero third-party runtime requests is fully achievable:** everything above is build-time
  bundled; fonts self-hosted via Fontsource (also sidesteps the Google-Fonts GDPR issue).
- **LCP law:** hero headline/CTA paints as static HTML immediately; the shader background mounts
  lazily after first paint. Never lazy-load the LCP element itself.

## 5 · Mini playable demo

- **Arcade/Navattic/Storylane/Supademo are the wrong tool class** — they record existing web SaaS
  and serve the player from THEIR domain (iframe/script = third-party runtime calls; Navattic
  starts at $500/mo). Fails zero-budget + zero-third-party outright.
- **The precedent that fits: NVIDIA's DLSS before/after comparison sliders** — self-contained
  static pages, pre-baked real captures, one gesture → one big reveal. Zero backend.
- **PRIMARY candidate: Monitor session replay** — press play, the owner's REAL recorded Diablo IV
  session (237 avg / 214 1% low / 3h / 10,776 samples — `site/src/session-receipt.json`) replays
  through the actual Monitor UI components fed static JSON instead of live IPC. Real data =
  strongest honesty story, lowest build cost (components exist), visually identical to the app.
  In-HUD label chip: `[REPLAY · real recorded session]` + one caption line.
- **Secondary/phase-2: simulated readiness-scan reveal** (canned sample rig → verdict sweep) —
  flashier but necessarily fabricated data; needs `[SIMULATED · sample rig]` framing and must
  never imply it read the visitor's PC.
- **Engagement research:** in-page demos lift engagement ~55% vs linked-out; single-gesture +
  immediate rich payoff beats multi-step tours (which read gimmicky).

## 6 · THE SPITBALL — direction options put to the owner (decide-together)

**Direction A — "Mission Control" (my recommendation):** the site IS the instrument. Extend the
app's dark monospace-telemetry HUD identity to the web: near-black panels, one theme accent,
flat SpaceX-webcast telemetry readouts, bento receipt/spec cards, ONE restrained aurora glow
behind the hero, the Monitor-replay demo as the hero's living centerpiece. Premium via restraint +
token discipline. Nobody else in the category can wear this suit — it's what the app already looks
like.

**Direction B — "Linear-lane dark SaaS":** the polished bento/gradient dark-SaaS look
(Linear/Raycast register). Safest, provenly premium — but generic-adjacent; we'd look like a
well-funded SaaS, not like Compy.

**Direction C — "Cinematic WebGL":** full 3D scroll-dolly hero (SOTD lane). Maximum spectacle,
highest cost, Core-Web-Vitals + "laggy site from a PC-optimizer" irony risk. Not recommended as
the base; elements can be borrowed later.

**Phasing proposal (any direction):**
1. **P1 — Home + hero** on the new Astro stack (hero, trust bar, features, receipts section,
   pricing teaser, FAQ accordion, dark default) + Monitor-replay demo if chosen.
2. **P2 — /pricing + /compare** (honest matrix, "Can you undo it?" lead column, concede-the-wins
   framing) + FAQ JSON-LD + llms.txt/schema.
3. **P3 (owner-flagged LATER)** — walkthrough videos + 60–90s app-tour video, simulated-scan demo.

**Decision record (owner answers):** _pending — filled in after the decide-together._
