# Monetization model + free/Pro split — COUNCIL PROPOSAL (ratify-ready, 2026-06-15)

> **PRODUCT DIRECTION SUPERSEDED 2026-09-04 (#369).** This Receipts-era proposal and its former
> owner-directed analysis are historical evidence, not pricing or product authority. Current product
> direction is `docs/PRODUCT_CONSTITUTION.md`; current monetization hypotheses are in
> `docs/product/MONETIZATION.md`, and all money/external actions remain owner-gated.
>
> Owner directive: "DO … the monetization model + free/Pro split (I build the rest of licensing)."
> The council was asked to PROPOSE a concrete, ratify-ready model + split under the Receipts Doctrine +
> the zero-budget law. **This is a proposal for the owner to ratify (price + the exact split are owner
> territory) — it is not a unilateral business decision.** CC has built the licensing FOUNDATION (verify
> + dark UI + offline minting tool); this doc is the model that decides what Pro IS, so the gating can be
> wired. Nothing here paywalls anything yet.

## TL;DR recommendation
- **Model: a ONE-TIME purchase ("Compy Pro — buy once, own it"), NOT a subscription.**
- **Free forever (the trust moat):** the entire "make my PC ready, safe, and understood" job —
  rollback + Trust Ledger + all safe rec apply/undo, readiness, the full Blackbook/Library, **Black Box
  crash triage (v1 + v2)**, live monitoring + overlay, export, the latency/benchmark lab. **Safety is
  never paywalled.**
- **Pro (additive depth, never safety):** long-term **monitoring history + trends** (beyond the last-20
  sessions), **multi-rig** compare/manage, and (future, gated) the v3 fleet "known-crash" intelligence.
- **Price:** a LOW one-time number ($15–25 range, or pay-what-you-want via Ko-fi to seed) — the owner
  sets the exact figure. **Issuance starts $0/manual** (the `license-tool.mjs` mint path) → add a
  one-time processor (Gumroad / Lemon Squeezy / Paddle, $0 upfront, rev-share) at first real demand.

## COUNCIL — full three-stage

**Stage 1 — advisors:**
- **Contrarian 🔴:** the brand-killer is paywalling SAFETY. Compy's whole positioning is "the honest one
  in a snake-oil category" — the moment rollback, the recs, readiness, or the crash reader sit behind a
  paywall, one Reddit thread ("the safety tool charges you to be safe") torches the funnel. Also: a
  SUBSCRIPTION on a local, no-server desktop app reads as extractive — the exact vibe we're built against.
  Whatever we charge for must be genuinely-extra and feel fair to a fan.
- **First-Principles:** what is someone actually paying for? Not safety (that's the free trust engine).
  They'd pay for DEPTH over time — history, trends, managing several rigs — the "I'm invested / power
  user" surface. That's additive, honest, and doesn't touch the core promise.
- **Expansionist:** one-time + manual-mint means revenue can start THIS WEEK at $0 infra (Ko-fi + the
  mint tool) — no processor, no entity needed to take the first dollar. Subscription is the right model
  ONLY for a server-backed feature (cloud history sync, the fleet crash-brain) that has ongoing cost to
  justify recurring — and those are future + gated anyway.
- **Outsider:** "buy it once, own it, safety's always free" is a story a stranger trusts instantly; a
  monthly fee for a local optimizer is what the snake-oil apps do. The model itself is a trust signal.
- **Executor:** smallest path to a dollar: (1) ratify this split, (2) pick a number, (3) Ko-fi + mint a
  key by hand per buyer. The gating plumbing can be ready before any Pro feature even ships.

**Stage 2 — peer review:** Contrarian's "never paywall safety" is the load-bearing constraint — all seats
ratify it as the hard line of the split. First-Principles + Outsider converge: the model (one-time) is
itself part of the honest brand, not just a pricing choice. Expansionist tempers Executor: don't build
the Pro FEATURES speculatively to justify the tier — most named Pro features (multi-rig, long history) are
future; build the gating MECHANISM now, ship the features when they're real, gate them then. Executor
concedes: mechanism now, features + wrapping on ratify.

**Stage 3 — Chairman:** Recommend a **one-time Compy Pro**, **safety + the full core always free**, Pro =
**long-term history + multi-rig depth** (+ future fleet intelligence behind the telemetry gate). Price:
owner's call, low + honest, manual-mint to start. Build the **model-agnostic gating plumbing now** (inert
while licensing is disarmed); wire actual features to it once the owner ratifies the split AND those
features exist. Next move: owner ratifies the split + picks a number; CC ships the gating plumbing
(reversible, dark) alongside this doc.

## What CC builds now (reversible, dark — does nothing until armed + ratified)
- `usePro()` (reads `get_license_status`) → `{ isPro, armed, ready }`, and `<ProGate>` — renders the
  feature normally while licensing is **disarmed** (everything free today) OR when the user is Pro; shows
  a calm "Pro" locked state ONLY when armed + free. So it can't paywall anything by accident.
- Wiring specific features (e.g. extended monitoring history) waits on the owner's ratify + on those
  features existing — several named Pro features are future.

## 🔴 OWNER TO RATIFY (the business calls — yours, not the council's)
1. **The model:** one-time (recommended) vs subscription.
2. **The split:** confirm "safety + core free; Pro = history/multi-rig/fleet" — add or move any line.
3. **The price:** the number (or pay-what-you-want to start).
4. **Issuance:** start with $0 manual mint (Ko-fi + `license-tool.mjs`); pick a one-time processor later.
5. **Send the waitlist link** — still the standing #1 lever; this model is what converts that list.
