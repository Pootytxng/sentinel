# Compy — Project Overview

*A shareable snapshot of where the project is and where it's going. Written for outside eyes:
what's good, what's missing, what's a bad idea. Be blunt — "this part is dumb" is useful data.*

> **Last reconciled: 2026-07-22**, against `docs/RELEASE_STATE.md`, `docs/RECEIPTS_DOCTRINE.md`,
> and `docs/MONETIZATION_PLAN.md` (the authoritative current-state docs — if this file and any of
> those three ever disagree again, those three win). This file had gone six weeks stale (last
> touched 2026-06-05) before a 2026-07-15 consumer panel review caught it describing a product
> that no longer existed: it said Gaming Mode was dark, the catalog was frozen, and monetization
> was undecided — all wrong by the time of the fix. Re-check this line before trusting anything
> below it as current.

---

## TL;DR (30 seconds)

**Compy finds what's actually slowing your gaming PC down — fixes the fixable, proves whether it
worked, and undoes anything, anytime.** It reads your real hardware and speaks plain English:
what's worth changing on *your* rig, what's already fine, and — the soul of the product — **when a
tweak did nothing, it says so.**

It's a real, working Windows app (Tauri: Rust core, web UI), at private-beta quality. **Core
promise: optimize + rollback stay free forever, no account required.** The app has no telemetry or
hardware/session upload. Its only outbound network feature is the signed, consent-first updater:
checks happen automatically, while an installer downloads only after the user clicks Update now. A future opt-in **Receipts telemetry** feature
(anonymous, default-off, kill-switched) is planned but **not yet built** — there is no toggle to
turn on yet, and it won't ship without its own security review and owner sign-off. The wedge isn't
"boost" — it's being the only tool in a snake-oil category that **measures instead of promises.**

---

## The loop (what using it feels like)

1. **It reads your machine** — the first onboarding screen names your actual GPU, CPU, and RAM.
2. **First check** — a fast, honest scan ending in a verdict: "Ready to play — 2 things worth
   fixing." The rest: "already perfect — nothing to sell you here." A clean rig is a *win state*,
   not a missed upsell.
3. **You apply a fix** (one click) — it lands in the **Trust Ledger** with its before-state.
   Undoable today, undoable in six months, even if the recommendation is later removed from the
   catalog.
4. **You play.** Afterward, a **session debrief**: a plain-English verdict, real numbers (1% lows
   labeled as the estimates they are), and at most one insight — "your GPU loafed during the dips;
   prime suspect: the power plan."
5. **The verdict.** Next same-game session, Compy compares against a noise floor and answers
   honestly: **Improved / No measurable change / Regressed.** It never claims a win inside the
   noise — a null result is the instrument working, and the UI says exactly that. There's a
   running tally: honest answers vs fake wins sold. The second number stays zero forever.

Detect → diagnose → debrief → prove. That loop is built and running today — it's code, not pitch.

---

## Why it's different (the hard lines)

- **Honesty laws, enforced in code.** Impact claims are tiered — *Verified / Measured / Expected*
  — and never silently upgraded. Credit requires an armed, measured comparison that clears the
  noise floor. "No measurable change" ships as a first-class verdict card, styled as information,
  not failure.
- **Everything reversible.** Snapshot before every change; rollback resolves from local history
  alone, so your undo never depends on the app's current opinion. It will never apply something it
  can't put back.
- **The autopsy, not the buffet.** The catalog is ~29 recommendations *because the popular tweaks
  were audited and most were refused*: HPET/timer hacks, Defender disable, core parking, TCP
  mega-packs, fixed pagefile — permanently blocklisted. The category competes on tweak count;
  Compy competes on what it leaves out, on purpose, with receipts.
- **No risky internals.** No Compy kernel driver. CPU temperature is shown only when an external
  monitor the user already runs publishes it read-only; otherwise it stays unknown. No game
  injection — FPS is captured externally via Windows' own event tracing, so it's anti-cheat safe by
  design. GPU sensors use official vendor SDKs.
- **Local-first, one outbound feature.** No account, no remote config, no telemetry. **The in-app
  updater (LIVE 2026-07-22, owner-directed) is the only network surface:** a signed-update
  check against the public releases repo on launch + every 4h; nothing downloads until the user
  clicks Update now, and every package is signature-verified against the pinned public key before
  install (private key lives outside the repo). The Export report still leaves only by the user's
  hand. **Receipts telemetry** (anonymous, opt-in, default-off, kill-switched) remains a separate
  gated track requiring its own security review and owner sign-off before it can arm. The old
  "verified zero-outbound" absolute is RETIRED by the updater decision — the in-app footer now
  states exactly what happens: "Network: signed update checks; downloads only when you click."

## Honesty about the project itself

The codebase is **weeks old, built at AI-assisted velocity** (~20k+ lines across 35 Rust modules,
1000+ frontend tests). We treat that fact the way Compy treats your PC: small blast radius,
everything reversible, verification never skipped. **Gaming Mode is live** — the one feature with
a real mutation surface passed its own crash-safety QA (10/10 field cases) and the owner signed
off 2026-07-14. The private beta exists to *earn* the trust the design claims: real testers, real
ledgers, real rollbacks, before a single public promise.

**Hardware truth:** AMD is hardware-verified (developed on an RX 9070 XT rig). NVIDIA is
implemented but **not yet verified on real hardware** — and the app says so instead of guessing.

---

## Who it's for

**"Casual Competitive Caleb"** — mid-20s, Valorant/Apex/Rivals, decent rig, knows how to install a
game but not how to safely edit a registry. Has tried YouTube "fixes" and either broke something
or felt nothing. The emotional target: *"If Compy says I'm good, I don't need to chase sketchy
tweak packs."*

Not for: sysadmins, power users, or one-click-tune-everything seekers. Windows only. The future
angle for story-gamers is **system-level per-game profiles** ("Valorant launched → latency profile
on, restored on exit") — the layer vendor apps won't touch, because no vendor app will ever tell
you to turn off its own telemetry.

---

## Status & what gates what

- **Private beta: active, replacement send on hold.** Six invitees received the verified 0.9.0
  link; what they installed is unknown. A signed-updater feed now exists through v0.9.4, but the next
  tester baseline waits for a clean candidate produced by the hardened release pipeline and the
  owner's explicit send GO. The Windows publisher remains unsigned.
- **The compy.gg marketing site is already live and public** (`compy-bd6.pages.dev`, owner deploy
  GO 2026-07-15) — landing page, `/compare`, Blackbook content pages, waitlist funnel, SEO
  plumbing. This is ahead of the app beta send, not behind it: the site is a separate, lower-risk
  surface the owner has already greenlit independently.
- **Money: deliberately zero spend** until a phase proves it can pay for itself — domain purchase,
  code signing, legal, and a Pro entity/payments are all owner-gated. Signing and legal gate the
  *public app* release; the domain gates the site's canonical URLs; none of this blocks the beta.
- **Still dark on purpose:** remote rules (triple-gated off), Receipts
  telemetry (no send path, needs its own security review + owner sign-off), Compy Pro licensing
  (needs an entity + payments). Gaming Mode is **no longer on this list — it's live.**
- **The tweak catalog is open, not frozen** (owner decision 2026-07-09): a tweak earns inclusion
  by measurable benefit under the same permanent safety rails (reversible, no kernel driver/
  injection, non-security-weakening, stability-safe) — see CLAUDE.md LOCKED rule 6.
- **Monetization has a real build order**, not an open question: `docs/RECEIPTS_DOCTRINE.md` (the
  law) + `docs/MONETIZATION_PLAN.md` (the sequencing, 2026-07-15). Four layers ranked by
  passivity — affiliate upgrade links (hold, needs accounts + data) → content/SEO (live today,
  $0) → Compy Pro subscription (built dark, ~$3–4/mo or ~$25/yr, needs entity + payments) → B2B
  licensing (parked, post-traction). **The one durable promise: optimize + rollback stay free
  forever; Pro sells new value, never gates the free promise.**

## Open questions (where outside opinions help most)

1. **The win-drought problem.** An honest tool on a healthy rig accumulates "honest answers: 9 ·
   wins: 0." Is absolution — "you're good, stop tweaking" — enough product on its own, or does
   Compy need more win *sources* that aren't toggles: driver-update detection, naming the exact
   device causing input lag, cleaning up tweak-pack damage?
2. **The flagship bet — DECIDED 2026-07-15.** The rescue-moment surface (undo what a YouTube tweak
   pack did to your PC) is real product, not a future maybe: it ships publicly as
   **"Optimization Cleanup"** — a read-only audit that identifies known tweak-pack artifacts,
   grades them (useful/placebo/risky/outdated/unknown), shows the documented-default Windows
   state, and only offers automatic restoration where the correct prior state is unambiguous
   (separate recovery snapshot before any remediation). Not publicly called "Paramedic Mode."
3. **Does "measures instead of promises" land** with a 20-something gamer, or does it sound like
   homework next to "BOOST FPS NOW"?
4. **Pricing shape — mostly decided.** Compy Pro is scoped at ~$3–4/mo or ~$25/yr in the doctrine,
   gated on a legal entity + merchant-of-record + real shipped Pro value. Still genuinely open:
   the exact price, and what value beyond history/multi-rig/deep-monitoring justifies it.

*Thanks for reading — tear it apart.*
