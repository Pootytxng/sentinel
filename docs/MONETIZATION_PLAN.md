# Monetization Plan — Compy, and how it sets up on compy.gg

> **Scope:** this is the *operational* companion to [`RECEIPTS_DOCTRINE.md`](RECEIPTS_DOCTRINE.md).
> The doctrine is the *law* (identity, marketing voice, the untouchable gates). This doc is the
> *build order* — each money layer, ranked by how passive it is, mapped to **exactly where it lives
> on the site today** and **what's still owner-gated before it can earn a cent.** Where this doc and
> the doctrine ever disagree, the doctrine wins.
>
> Created 2026-07-15 during the site-completion train, after the owner asked to "actually draw up a
> monetization plan for compy and how the best way to set it up is on the site." Nothing here is a
> new spend or a new outbound boundary — it documents and sequences what the site is *already built
> to do*, plus the handful of owner-only unlocks.

---

## The one-paragraph version

Compy makes money **without ever charging for the free promise** (optimize + roll back, forever
free). The free app is the trust engine and the top of the funnel. Revenue comes from four layers
stacked on top, ordered by passivity: **(1) affiliate upgrade links** on honest "your bottleneck is
the GPU" verdicts, **(2) the content engine** — the Blackbook corpus republished as SEO/debunk pages
on compy.gg that pull strangers in and feed layer 1, **(3) Compy Pro** (a real subscription for
history/multi-rig/deep-monitoring, built dark until an entity + payments exist), and **(4) B2B
licensing** to repair shops. The site is already wired for all of this: a pricing manifest that seeds
Pro, dormant Ko-fi tip slots, a native waitlist funnel, and the full library as content. **The near-
term lever that costs $0 and needs no owner unlock is layer 2 — publish more of the corpus as
searchable pages.** Everything with a price tag waits on an owner decision.

---

## The money stack — ranked by passivity, mapped to the site

Each layer below carries: **what it is · where it already lives on the site · the honesty rail it
rides · the owner-gated unlock that turns it on.**

### Layer 1 — Affiliate upgrade engine  ·  *most passive once built*

- **What it is:** when Compy's honest verdict is "no software tweak fixes this — your GPU/RAM/CPU is
  the real bottleneck," that verdict can carry a retailer link. This is the doctrine's flagship: we
  get paid *when the proof says buy hardware*, and only then. It monetizes the one moment we're most
  trustworthy — telling someone software *can't* help.
- **On the site today:** **not yet surfaced on compy.gg**, by design. The verdict engine lives in
  the app (Priorities / limiter). The web equivalent — a "your rig's real bottleneck" report page —
  is a **Director HOLD**: we have no Receipts aggregate data to show yet, so a web upgrade surface
  would be a scaffold with nothing real in it. Building the empty frame now = slop.
- **Honesty rail (doctrine §5, binding):** a visible disclosure line on *anything* affiliate ("this
  is an affiliate link — it costs you nothing and helps fund Compy"). Never fabricate a benchmark to
  justify an upgrade. The recommendation must stand on the measured limiter verdict alone; the link
  is a footnote to a true finding, never the reason for it.
- **Owner-gated unlock:** ① affiliate accounts (Amazon Associates / Newegg / retailer programs) —
  owner-only signup, an owner-territory money call. Until they exist, verdicts link to **plain
  retailer search URLs** (no tag, no revenue, still honest and useful). ② enough Receipts data to
  make a web bottleneck-report page say something true. **Status: HOLD until both.**

### Layer 2 — Content engine (Blackbook → compy.gg)  ·  *near-term lever, $0, no unlock*

- **What it is:** the ~191-entry Blackbook corpus (tweaks graded honestly, snake-oil patterns named,
  terms in plain English) republished as SEO pages. Someone googles "does disabling fullscreen
  optimizations increase FPS" → lands on Compy's honest verdict → discovers the app. This is the
  organic top-of-funnel that feeds Layer 1's affiliate clicks and Layer 3's Pro signups. Doctrine
  says it's a 6–12 month ramp — so **starting it early is the highest-leverage thing this session
  can do.**
- **On the site today — LIVE and the most complete layer:**
  - `site/generate.mjs` publishes **14 curated debunk "pick" pages** (full write-ups) + the **full
    library index** (~191 entries) off the real corpus via the shared render core
    (`scripts/lib/library-render.mjs`) — zero drift from the in-app library, zero invented content.
  - **Sample/teaser model** is already wired: picks render a `Sample` tag ("Published in full — the
    rest of the book ships in the app"). The 14 full pages are the SEO catch; the rest are teasers
    that pull the download. This is the doctrine's "samples, not free meals" content split, already
    built.
  - `/compare` (shipped 2026-07-15) is a content page in its own right — five construction axes,
    each with the tradeoff we accept. Ranks for "honest PC optimizer" style queries.
  - SEO plumbing done: `sitemap.xml`, `robots.txt`, `llms.txt`, canonical URLs, JSON-LD — all
    pointing at `https://compy.gg`, all real-provenance (no fake `lastmod`, no invented dates).
- **Honesty rail:** every published page is generated *from the app's own data module* — it is
  structurally impossible for a page to claim something the app doesn't. No invented ratings, no
  fabricated review counts, no `lastmod` we can't stand behind.
- **Owner-gated unlock: NONE to keep publishing.** The lever is **authoring more full "pick" pages**
  (promoting teasers to full write-ups) so more long-tail queries have a full landing page. That's
  content work, not a spend. The *one* content decision that touches honesty — the **teaser-excerpt
  data source** (Director craft #2: what sentence shows as the teaser) — needs an authored, honest
  verdict line per entry, never an auto-truncation that could mislead. Flagged as a content
  follow-up, not a blocker.
- **Queued content (panel-review brief 2026-07-15 §4.5 + §4.6, both $0 Layer-2 work):** a public
  **technical methodology page** (how Compy measures: ETW frametimes, noise floor, A/B trials,
  rollback contract — the "show your work" page that earns the enthusiast/skeptic audience) and a
  **stutter-story narrative** page (the diagnosis journey told plainly: symptom → capture → culprit →
  fix → measured after). Content-only, generated/authored under the same honesty rail — no new
  app surface, no new claims.
- **KPI (doctrine: one metric per phase):** organic sessions → app downloads. Measurable free via
  Cloudflare Pages analytics once the domain is live.

### Layer 3 — Compy Pro (subscription)  ·  *recurring, built dark*

- **What it is:** a real paid tier for value the free app deliberately doesn't include — long-term
  monitoring **history**, multi-rig **fleet** dashboards, deeper session analytics, overlay.
  **$4.99/mo · $39/yr · $89 one-time lifetime — DECIDED by the owner 2026-08-22** on the evidence in
  [`PRICING_RESEARCH.md`](PRICING_RESEARCH.md) (the old $3–4/mo · ~$25/yr was a placeholder below
  every comparable). **Priced, not published:** the site stays price-free until Pro ships.
  **Pro will never be required to optimize or roll back** — that's the
  untouchable line; Pro sells *new* value, never gates the free promise.
- **On the site today — the scaffolding is built and honest about being early:**
  - `index.astro` **#pricing "THE MANIFEST"** section: a free-forever manifest (TUNE / UNDO /
    MODULES / TERMS all ✓ INCLUDED) beside a **Compy Pro card stamped "in the works," "No price
    yet,"** listing HISTORY + FLEET as Pro items, with the explicit line *"Nothing to buy until it's
    real — and Pro will never be required to optimize or roll back."*
  - This is the correct posture per the doctrine + the honest-measurement law: **name the future
    product, promise nothing, quote no price we can't yet charge.** The card is a seed, not a store.
  - **No standalone `/pricing` page** — a **Director HOLD**: with no price and no purchasable Pro, a
    dedicated pricing route would be a page selling nothing. The on-home manifest block is the right
    surface until Pro is real.
- **Backend:** the Pro gate is **built dark** (`license.rs`, gate returns false, FE renders nothing)
  — same pattern as the gaming-mode gate. Arming is a deliberate, reviewed commit, never a side
  effect.
- **Owner-gated unlock (all owner territory):** ① a legal **entity** + **merchant-of-record**
  (Paddle is the doctrine's named route — handles VAT/tax so a solo owner doesn't) · ② a **price**
  (owner taste/money call) · ③ enough shipped Pro *value* to be worth $25/yr · ④ the dark gate armed
  behind a real payment webhook. **Status: correctly dark. The site says exactly the right thing
  about it today.**

### Layer 4 — B2B licensing (repair shops / builders)  ·  *highest $, least passive*

- **What it is:** per-seat licensing ($10–30/seat/mo) for PC repair shops and system builders who'd
  run Compy across many customer rigs — the honest-measurement angle is a real selling point in a
  trade full of snake oil ("here's the before/after receipt for your customer").
- **On the site today:** **nothing, correctly.** This is post-traction (doctrine) and needs
  human sales, not a web funnel. No page, no scaffold — building one now would be premature.
- **Owner-gated unlock:** traction first, then a direct-sales motion. Parked. **Do not build a B2B
  page until the owner asks.**

### Bridge — Ko-fi / tip jar  ·  *$0, dormant, one-input unlock*

- **What it is:** a voluntary tip/support link. Zero infrastructure, zero legal, no cut of anything —
  the doctrine's $0 bridge that can go live *today* the moment the owner has a profile URL. It funds
  nothing meaningful alone, but it's the honest "if this saved you, buy me a coffee" that costs us
  nothing to offer.
- **On the site today — dormant and waiting on exactly one string:**
  - `src/data/site.ts` → `KOFI_URL = ""` (empty = the site omits every support link; **no dead link
    ships** — that's the guard).
  - Two dormant slots ready to light up the instant that string is non-empty: **footer** support
    link (`Base.astro`, footer-links nav) and the **waitlist section** support slot
    (`index.astro:460`).
- **Owner-gated unlock:** **the owner's Ko-fi profile URL.** One line in `site.ts`, regenerate,
  deploy — the whole thing is a one-file edit by design. This is the single most-ready money surface;
  it's the top item on the owner checklist.

---

## The on-site funnel — how a stranger becomes revenue

```
   Google / Discord / friend
            │
            ▼
   compy.gg content page  ──────────────►  Layer 2 (Blackbook SEO / debunk / compare)
   (honest verdict, real provenance)         the corpus IS the catch
            │
            ▼
   Home #manifest + #receipts             ──►  proof it's real (Exhibit A null result,
   (free-forever, "in the works" Pro)          Exhibit B real Diablo IV numbers)
            │
            ├──► Download the app  ──► in-app limiter verdict ──► Layer 1 (affiliate, when armed)
            │
            ├──► Join the waitlist (native /api/waitlist → D1)  ──► the owned audience
            │
            └──► Tip (Ko-fi, when URL set)  ──► Bridge
                                                 │
                                                 ▼  (Pro, when entity+payments exist)
                                              Layer 3
```

Everything in that diagram **except the two dashed "when armed / when set" arrows already exists on
the site.** The funnel is built; the money surfaces at the bottom are gated on owner unlocks, and
that gating is *correct* — publishing a price or an affiliate link before we can honor it would break
the honesty law the whole brand rests on.

---

## Sequencing — what to do, in order

| # | Action | Cost | Who | Status |
|---|--------|------|-----|--------|
| 1 | **Keep publishing corpus content** (promote teasers → full pick pages; more long-tail landing pages) | $0 | Claude (build) | **DO NOW — the near-term lever** |
| 2 | Buy `compy.gg` + point at Pages project | ~$50/yr | **Owner** | In progress ("see what I can do today") |
| 3 | Drop Ko-fi URL into `site.ts` → footer + waitlist slots light up | $0 | **Owner** provides URL, Claude wires | **Waiting on the URL** |
| 4 | Author honest teaser-excerpt lines per entry (Director craft #2) | $0 | Claude (content) | Follow-up, not blocking |
| 5 | Affiliate accounts → swap plain retailer links for tagged; build web bottleneck-report page | $0 signup | **Owner** signs up | **HOLD** — needs accounts + Receipts data |
| 6 | Entity + Paddle + Pro price + arm the dark gate | legal/fees | **Owner** | **Gated** — Pro launch |
| 7 | B2B licensing / direct sales | — | **Owner** | **Parked** — post-traction |

**The line that matters:** items 1 and 4 are the only ones Claude can move without an owner unlock,
and item 1 is the highest-leverage $0 action available. Everything with a price or an outbound
account is owner territory and is correctly gated.

---

## The rails this plan never crosses (from the doctrine — non-negotiable)

- **Never charge for the free promise.** Optimize + roll back stay free forever. Pro sells new value
  only. The moment "the fix button needs a credit card," we've become the snake-oil lane we attack.
- **Never fabricate a number.** No invented benchmarks, no fake ratings/reviews, no `lastmod` we
  can't stand behind. Every published page is generated from the app's own data — drift is
  structurally impossible.
- **Disclosure on anything affiliate.** Always visible, always honest about the incentive.
- **Attack the *pattern*, never a named product.** We name snake-oil *tactics* ("a free scan that
  finds 200 critical issues and charges to fix them"); we never libel a named competitor.
- **Zero-budget law.** Every layer ships $0-first on free tiers. Every spend is owner-gated with a
  named trigger: domain ← waitlist signal (now) · signing ← first paid surface · entity+Paddle ← Pro
  launch · **paid ads ← never before 1.0.**
- **Receipts telemetry is a separate, gated outbound boundary** — dark until its own security review
  + consent UI + owner sign-off. This plan does not arm it; Layer 1's aggregate-data dependency waits
  on it.

---

*Maintained by Claude alongside [`RECEIPTS_DOCTRINE.md`](RECEIPTS_DOCTRINE.md) (the law) and
[`OWNER_ACTION_CHECKLIST.md`](OWNER_ACTION_CHECKLIST.md) (the owner-only unlocks). When a layer's gate
clears, update the sequencing table and the doctrine's phase KPIs in the same commit.*
