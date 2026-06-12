# 2026-06-12 — Doctrine voice baptism (§A now) + staged design refresh (§B/§C queued)

> Owner directives: (1) full wording/labeling sweep — "baptize all previous copy with the new
> directive"; tab labels (e.g. "Fix") reviewed for appeal; (2) queue a complete design overhaul.
> Staged to protect the live beta: words → paint → (only if needed) demolition. Doctrine voice
> (`RECEIPTS_DOCTRINE.md` §5) + zero-budget law govern. Trigger example caught live: Check's
> "8 already fine — nothing to sell you here" = retired defensive voice.

## §A COPY BAPTISM (execute now)

1. **Inventory every user-facing string** (rail labels, headers, verdict/empty/limiter lines,
   buttons, tooltips, consent sheets, export text) → three buckets:
   - **B1 violates doctrine voice** (defensive/self-gag/apologetic: "nothing to sell you here",
     "your PC is probably fine"-class, promise-shy phrasing that hides real measured wins) →
     FIX NOW. Replacement voice: confident, measured, tailored — "measured and confirmed right",
     "earned by your rig's receipts". Never fabricates, never promises unmeasured.
   - **B2 fine** — leave.
   - **B3 naming/taste** (room names, feature titles) → PROPOSAL TABLE, not changed: for each, the
     current name, 2–3 candidates + one recommended default + one-line rationale, written to
     `docs/superpowers/specs/2026-06-12-naming-proposals.md` for the owner taste-gate.
     Known candidate: **Fix → "Tune"** (Cowork-recommended default: "Fix" frames the PC as broken
     — a fear frame the doctrine retired; "Tune" is aspiration + matches the tailoring prestige
     line; sublabel keeps honesty: "measured changes for YOUR rig"). Rail renames land ONLY after
     owner picks (shared homeRail module + parity guard makes the eventual swap one-line safe).
2. **Law-guard extension** (cheap): add the worst retired phrases to the existing CI charter
   guards so defensive voice can't regrow.
3. Hard lines: copy/labels only — zero behavior/logic/IPC/mutation change; rail labels themselves
   unchanged until owner picks (proposals only); doorknob/bathroom/foam-pit laws intact; receipts
   law on every new string; frozen refs untouched.

## §B0 SITE OVERHAUL FIRST — R4a (owner taste verdict 2026-06-12: landing "mediocre at best")

The R3 landing was scaffold-grade (structure + swap-point plumbing), not publish-grade. The SITE
is where the full design-overhaul energy runs FIRST: zero beta blast radius (not live, no users),
pure greenfield, and it's the money funnel's front door — every dollar path (SEO debunk → trust →
waitlist/download; share-card → home; affiliate web reports) crosses this page. Requirements:
**mobile-first** (Discord referrals open on phones), Instrument-adjacent identity (dark,
schematic, teal accent — app and site must feel like one brand), doctrine voice throughout,
static/no-framework (zero-budget, fast, no trackers), Lighthouse-clean. Sections: hero (identity:
"Measured, not promised."), three receipts-style value cards, debunk-library showcase, waitlist +
Ko-fi slots (still placeholders), future-download placeholder, honesty-creed footer. Division of
labor: CC = structure/CSS/copy draft; Cowork = hero/OG imagery via Higgsfield (§D) curated into
`site/assets/`; owner = final taste gate. Site stays DARK until the publish ladder.

## §B0b GLOW DIRECTION — R4b (owner taste decree 2026-06-12: "artistic glow", end the "bleak dark vibe")

Owner verdict on the R4a cut: structurally right, emotionally flat. New art direction for the
LANDING (site leads; the app's §B refresh later borrows what works):

- **Glow, not gloom:** dark base STAYS (it's the brand + gamer-native) but becomes luminous —
  aurora/gradient-mesh background washes (teal `--ix-accent` flowing into violet/magenta),
  soft radial glows behind hero + cards, subtle film grain so flats aren't flat.
- **Showpiece moves (TikTok-landing genre, tastefully):** oversized display type with an
  animated gradient sweep on the hero line; glassmorphism cards (blur + translucency + 1px
  luminous borders); glow-on-hover CTAs; scroll-reveal sections; floating receipt-chip motifs.
- **Ambient motion (owner motif, 2026-06-12):** a slow, continuous, SUBTLE background ambience —
  e.g. one or two "silk light streaks" (soft ribbon gradients) drifting diagonally on a long
  loop (~20–40s), barely-there parallax on the aurora wash. Smoothness law: GPU-cheap transforms
  only (translate/opacity), no layout thrash, imperceptible loop seams, fully static under
  `prefers-reduced-motion`. Ambience whispers; it never competes with the copy.
- **Discipline:** CSS-only (zero libraries, zero JS beyond the existing waitlist interceptor +
  IntersectionObserver for reveals), `prefers-reduced-motion` honored (reveals/sweeps become
  static), page budget ≤ ~60KB before images, Lighthouse-clean, 380px-first. Copy unchanged —
  receipts voice + Sarah & Caleb bar; glow is paint, never promises.
- Higgsfield lane unchanged: OG card 1200×630 raster (social embeds need raster); hero may stay
  pure CSS if the mesh outshines a static image (Cowork judges after R4b lands).

## §B VISUAL REFINEMENT MARATHON (app polish — queued after B0/B0b, Fable 5 lane)

Polish the EXISTING Instrument system for appeal without structural reversal: typography scale +
hierarchy, spacing rhythm, color/contrast warmth within theme law (owner taste-gates any new hex),
card/density polish, iconography consistency, micro-interaction restraint (single-shimmer law),
empty states that sell the next action. Scope doc + before/after screenshots per surface; owner
eyeballs each. NOT in scope: IA changes, rail restructure, theme replacement.

## §C FULL OVERHAUL (gated)

Only if §B underwhelms the owner. Starts as MOCKUPS (HTML mock pages or Figma — never live app
code) + a migration plan; rides its own spec + owner sign-off. Blast radius: mid-beta testers —
which is why it's last.

## §D GENERATED-ASSET LANE (Higgsfield, connected 2026-06-12)

Use for SITE + MARKETING imagery only: landing hero art, OG/share-card images, Discord
announcement visuals, future store/banner art. All-original law: generated-by-us = ours; style
must match the schematic/instrument identity (no stock-photo look). In-app UI stays CSS/tokens —
no raster art in the app. Asset requests flow through Cowork (prompting + curation), owner
taste-gates final picks. $0 within Higgsfield's existing plan limits.

## Sequence

§A CC prompt now → owner taste-gate on naming proposals → §B marathon (R4) → owner verdict →
§C only if called. §D runs parallel whenever site/marketing needs art.
