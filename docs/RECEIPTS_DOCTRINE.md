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
  (CLAUDE.md stop-rule 3). Until it ships, the verified zero-outbound property still holds.
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
- Signed-remote-rules triple gate, updater off, secrets/signing-key rules, frozen beta refs,
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

## 8. North Star Metric + KPI hierarchy (owner-provided startup-term analysis, 2026-08-04)

Full analysis: `docs/superpowers/specs/2026-08-04-startup-term-analysis-review.md`. Its core
finding: **Compy's engineering maturity has outrun its market validation.** The codebase is not the
main uncertainty anymore — user dependence is. PMF/retention is the #1 business risk, ahead of any
remaining feature work; a technically finished 1.0 does not by itself prove PMF, only creates a
stable object PMF can finally be tested against.

- **North Star Metric:** **Weekly Active Rigs Completing a Verified Evidence Loop.** A verified
  evidence loop = diagnosis/recommendation → informed decision → apply/reject/rollback → recorded
  outcome or receipt. Deliberately counts honest no-change and regression findings as loop
  completions too, so the metric never rewards recommending more aggressive changes just to move
  the number. Supporting quality measure: verified evidence loops per retained rig.
- **The one conversion that matters most pre-revenue:** successful install → first verified
  evidence loop. Not website conversion, not download count.
- **KPI hierarchy (product / retention / business / trust)** — full lists in the spec §39. Track
  these, not vanity metrics: total commits, test count, feature count, repo size, downloads without
  activation, waitlist size without conversion, AI-generated TAM/valuation estimates.
- **Positioning discipline:** never reframe Compy as an "AI operating system" — it dilutes the
  actual differentiator and produces meaningless market-size numbers. The defensible position stays
  narrow: cross-vendor performance diagnosis with reversible actions and proof of what changed on
  *this* rig — something no single vendor (Microsoft PC Manager, Razer Cortex, AMD Adrenalin,
  NVIDIA App) has a reason to build, because each is scoped to its own surface.
- **Unit-economics reality check:** at ~$25/yr Pro pricing, even moderate human support cost
  destroys the economics. This is the business case for the support-evidence/inspect-before-export
  design already built — it's not just a privacy feature, it's a margin feature.
- **Until Compy has real distribution, A/B testing and NPS are statistically premature** (a beta
  cohort of ~6–10 personally-connected testers cannot support either). Direct interviews using the
  spec's suggested question set are the honest substitute for retention signal right now.

This section does not change the money-stack build order (§3) or phase gates (§4) — Receipts
telemetry (§4 Phase 3) is already the infrastructure this North Star needs to measure at scale
beyond manual tester interviews.
