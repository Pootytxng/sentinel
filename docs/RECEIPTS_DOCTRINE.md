# THE RECEIPTS DOCTRINE — Compy's new core (owner decree, 2026-06-12)

> **This is canonical product law.** Every session — CC or Cowork — reads this with CLAUDE.md.
> Where ANY older product-direction text (PRODUCT_DIRECTION.md, old banners, specs) conflicts
> with this doc, **this doc wins.** Background: `docs/superpowers/specs/2026-06-12-monetization-council.md`
> + `2026-06-12-monetization-transformation-plan.md` (the council that produced this).

## 0. The mission (new)

**Compy exists to generate real income for the owner.** Not as a side effect — as a design goal,
filtered through every spec, feature, and review: *does this move money, or trust-at-scale that
converts to money?* If neither, it queues behind things that do.

This is the grand re-opening. We were never open; now we are, and the door says so.

## 1. Identity shift

- FROM: "an optimizer that promises nothing" (honesty as a vow of silence).
- TO: **"the measurement brand that proves everything — and gets paid when the proof says 'buy a GPU.'"**
- The free app is the **trust engine + funnel**. Money lives in the layers around it.
- **SHARPENED (owner decree 2026-07-21): Compy is NOT a free product.** The end-state is a
  **free tier vs. paid monthly** split — the free tier exists as the funnel option, but the goal
  is **complete monetization**. Never brand/describe Compy as "a free app" in outward copy
  (site, bios, store text); say "free tier" / "free version" when the split must be named.
  The earlier "free forever" phrasing on this line is superseded.
- We do not enter the snake-oil lane (fake promises, fear UX, scareware counters). Not as morals —
  as strategy: it's the most crowded lane, it torches our only differentiator, and one Reddit
  thread of brand damage kills every funnel below. **The gates ARE the moat.**

## 2. Law changes — retired · reframed · untouchable

### RETIRED (these were self-gags, not virtues)
- **No-telemetry absolutism.** Replaced by **Receipts telemetry**: opt-in, anonymous, default-OFF
  results sharing + install counting. Purpose: aggregate real measured outcomes → marketing claims
  that are exciting AND true ("RX 6600 rigs measured +X% 1%-lows after these 3 fixes — N=412").
  Constraints (non-negotiable): consent-first UI, default OFF, anonymous (no PII, no rig serials),
  kill-switch, no third-party trackers, payload inspectable by the user before send. It is a NEW
  outbound-network boundary → rides its own spec + security review + **owner sign-off before ship**
  (CLAUDE.md stop-rule 3). The live signed updater is already Compy's one narrow outbound surface;
  Receipts would add a materially different telemetry boundary and remains separately gated.
- **"Your PC is probably fine" defensive copy.** Retired app-wide and site-wide. Replacement voice:
  "Measured on rigs like yours." Celebrate measured wins loudly.
- **The refusal to market.** Retired. Attack marketing is sanctioned: the debunk IS the ad; pick the
  fight with the $/mo promise-sellers — with receipts, never with fabrication.

### REFRAMED (kept, sharpened)
- **Honest-measurement law → Receipts law:** never fabricate, never claim what we haven't measured —
  AND amplify what we HAVE measured as loudly as the data allows (share cards, before/afters,
  aggregate stats, time-and-sample-qualified). Silence about real wins is now a violation too.
  + **Aggregate-stack measured gain is now a first-class marketing engine (2026-07-09, catalog
    opened — CLAUDE.md rule 6 / ★ PRIMARY BLUEPRINT Directive 1):** the honest vehicle for the
    now-open catalog is the whole enabled stack's real before/after A/B delta (not per-tweak claims
    below the noise floor). "Measured X% faster on YOUR rig" — cumulative, per-rig, true — is exactly
    the loud-but-honest Receipts story, and the aggregate delta is what the opt-in telemetry
    aggregates into "RX 6600 rigs measured +X% after the safe stack — N=412."
- **Risky-tweak catalog:** the FREEZE is LIFTED (measurable-benefit-under-rails, 2026-07-09) but the
  **liability shield stands** — the shield is now the RAILS + the mutation-gate + measured proof, not
  the freeze. A tweak joins only by measurable benefit AND every safety rail; unmeasured snake-oil is
  still barred. Advisory/read-only growth continues upward as before, now beside measured additions.

### UNTOUCHABLE (now business-critical, not just safety)
- Rollback-first integrity (the moat; B2B's entire purchase reason).
- No fabricated claims (owner's integrity line + legal survival).
- No kernel driver · no game injection (anti-cheat safety = market access).
- Signed-remote-rules triple gate, consent-first signed updater, secrets/signing-key rules, frozen beta refs,
  security/system-settings owner gate — ALL CLAUDE.md LOCKED rules stand. A monetized Compy makes
  these MORE important: we will be charging strangers; the blast radius of sloppiness is the brand.

## 3. The money stack (ranked by passivity)

1. **Affiliate upgrade engine** — Priorities/limiter verdicts already write the prescription
   ("your GPU is the limiter"); stop letting the pharmacy keep the money. Affiliate links on
   limiter verdicts + web reports (Amazon/Newegg-class). Plain retailer links until owner has
   affiliate accounts; tags swap in later. Most passive once built.
2. **Content engine** — the 130+-entry (and growing) Blackbook corpus published to compy.gg as debunk/SEO
   pages + share-card virality + build-in-public. 6–12 mo ramp, near-passive after; feeds #1.
3. **Compy Pro** ($3–4/mo or ~$25/yr) — sell the RECURRING surfaces already built: session history
   depth, comparisons, multi-rig, overlay customization, deep monitoring. Built dark behind a flag
   (gaming_mode gate pattern) until entity + payments exist.
4. **B2B licensing** (repair shops / boutique builders, $10–30/seat/mo) — rollback + receipts =
   liability reduction. Not passive (sales labor); post-traction.
5. **"Carfax for used PCs" report** — optionality; parked.

## 4. Build phases + gates

- **Phase 0 — Doc alignment** (this commit): doctrine canonical, CLAUDE.md + COWORK_HANDOFF.md
  aligned, conflicting forward-looking absolutes pointered.
- **Phase 1 — Library→web exporter** (build tooling, zero risk): static HTML pages from the
  Learn/Library data for compy.gg. Gate: none (read-only tooling). KPI: pages render, count matches.
- **Phase 2 — compy.gg one-pager + waitlist** (owner hosts; Cowork drafts copy; assets may live in
  repo `site/`). KPI: **waitlist signups in 14 days** — the first real market signal.
- **Phase 3 — Receipts telemetry** (opt-in results sharing + install counting). Gate: own spec,
  security-grade review, default OFF, owner sign-off (new outbound boundary). KPI: opt-in rate.
- **Phase 4 — Affiliate surface** (Priorities + web reports). Gate: copy review (advisory framing,
  disclosure line). KPI: click-through. Owner errand: affiliate accounts.
- **Phase 5 — Compy Pro dark scaffolding** (license gate + Pro surfaces). Gate: stays dark until
  entity + merchant-of-record (Paddle-class) exist (owner errands). KPI: conversion once live.
- **Phase 6 — B2B kit.** Post-traction.

**KPI discipline:** every phase defines ONE metric before build; the next phase is funded by the
previous one's measured signal, not vibes. **The money plan runs on receipts too.**

## 5. Marketing voice (binding on all copy)

Receipts, not vibes · loud about measured wins, silent about nothing real · attack the snake-oil
lane by name-of-pattern (never libel a named product without receipts) · every share card and
export is an ad · disclosure lines on anything affiliate · no fabricated numbers, ever, anywhere —
one invented stat poisons the entire doctrine.

## 6. ZERO-BUDGET BOOTSTRAP LAW (owner constraint, standing — 2026-06-12)

**The owner is bootstrapping on $0.** Binding on every phase, spec, and suggestion:

- **Default budget is zero.** Every phase ships on free tiers first: Cloudflare Pages / GitHub
  Pages subdomain (Phase 2 runs on a free `*.pages.dev`/`github.io` URL — the `compy.gg` domain
  purchase is the FIRST sanctioned spend, triggered only by real waitlist signal), free-tier
  forms/email (Tally / Buttondown / MailerLite free), Cloudflare Workers free tier (telemetry
  endpoint), Amazon Associates ($0 to join), Ko-fi/BuyMeACoffee ($0 bridge monetization —
  donations link goes up with Phase 2; income is loggable in the business ledger).
- **Any spend is owner-gated** and must arrive with: the expected payback, the KPI that justifies
  it, and the free alternative it beats. No spending on guesses — the money plan runs on receipts.
- **Known future spends + their triggers:** `compy.gg` domain (~$50/yr) ← waitlist proves demand ·
  code signing ← first paid surface (budget route: Azure Trusted Signing ~$10/mo, NOT a $400 EV
  cert) · legal entity + merchant-of-record ← Compy Pro launch · **paid ads ← NOT BEFORE 1.0**, and
  only if organic numbers prove the math.
- **Organic-first distribution:** friends + the owner's Discord community are the named seed
  channel — first testers, first telemetry opt-ins, first supporters, first referrals. Then
  build-in-public posts + SEO. Referral energy is free; we spend that before we spend dollars.

## 7. Session onboarding (CC + Cowork)

A fresh session adopts this mindset: Compy is a business now. Reviews add one question to every
audit: *"does this serve the money stack or the trust that feeds it?"* Sport-mode, minimal gates,
token discipline, and ALL security rules are unchanged. The owner's integrity constraint is hard:
aggressive is sanctioned, dirty is not — anything that would brand him a scammer is rejected on
ROI grounds before ethics even enters the room.
