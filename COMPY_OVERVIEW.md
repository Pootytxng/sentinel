# Compy — Project Overview

*A shareable snapshot of where the project is and where it's going. Written for outside eyes:
what's good, what's missing, what's a bad idea. Be blunt — "this part is dumb" is useful data.*

> **Last reconciled: 2026-08-09**, against `docs/RELEASE_STATE.md`,
> `docs/PRODUCT_DIRECTION.md`, `docs/RECEIPTS_DOCTRINE.md`, and the 2026-08-09 Compy Care
> decision/spec (the authoritative current-state and direction sources — if this snapshot disagrees,
> those win). The 2026-07-15 reconciliation had already corrected six weeks of drift; this pass adds
> the owner-approved PC-doctor hierarchy, Capability Exception Gate, outbound tiers, live-updater
> truth, and current module/state counts. Re-check this line before treating anything below as current.

---

## TL;DR (30 seconds)

**Compy is the PC doctor for everyday Windows gamers:** the first place to go after a game crash,
freeze, slowdown, or unexplained hiccup. It gathers the evidence already on the PC, explains what is
known versus only suspected, gives one safe next test or recovery step, and remembers the outcome.
Optimization is the second specialty: hardware-aware treatment that proves whether it worked and
can undo every change.

It is a real Tauri/Rust Windows app at private-beta quality. The current build needs no account;
hardware, sessions, crash evidence and history stay local. Its one automatic outbound use is the
signed updater, switchable off in Settings. A signed known-issue catalog is approved for a dark
Tier 1 build, but no case-intelligence endpoint or upload exists today. Future sharing is split into
separate opt-in tiers; none inherits consent from another. The wedge is not "boost" — it is diagnosis
and measured treatment without pretending certainty.

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
- **Boundaries are explicit.** Current build ships no kernel driver. A future Compy driver would
  need its own Capability Exception Gate record; vulnerable borrowed drivers and generic kernel
  read/write surfaces remain barred. Game/process injection remains prohibited — FPS is captured
  externally through ETW and sensors use documented vendor interfaces.
- **Local-first, one outbound call.** No account, no remote config, no telemetry. **The in-app
  updater (LIVE 2026-07-22, owner-directed) is the one thing that talks out:** a signed-update
  check against the public releases repo on launch + every 4h; nothing downloads until the user
  clicks Update now, and every package is signature-verified against the pinned public key before
  install (private key lives outside the repo). The Export report still leaves only by the user's
  hand. **Receipts telemetry** (anonymous, opt-in, default-off, kill-switched) remains a separate
  gated track requiring its own security review and owner sign-off before it can arm. The old
  "verified zero-outbound" absolute is RETIRED by the updater decision <!-- outbound-claim-allow --> — the in-app footer now
  states exactly what leaves the machine: "Outbound: signed update check only." Since 2026-08-03
  the automatic check is also switchable off (Settings → About → Automatic update checks), with a
  manual "Check now" beside it; the switch gates checking only and never weakens signature
  verification.

## Honesty about the project itself

The codebase is **weeks old, built at AI-assisted velocity** (~20k+ lines across 45 Rust modules,
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

- **Private beta: functionally complete, still unsent.** The full loop above, plus readiness
  checks, priority ranking, latency diagnostics, live monitoring + overlay, Gaming Mode (live),
  and local export. Remaining before invites go out: the beta smoke pass (24 checks, 0 run) and
  the owner's send GO. Distribution: unsigned, invite-only, direct download, fully local.
- **The compy.gg marketing site is already live and public** (`compy-bd6.pages.dev`, owner deploy
  GO 2026-07-15) — landing page, `/compare`, Blackbook content pages, waitlist funnel, SEO
  plumbing. This is ahead of the app beta send, not behind it: the site is a separate, lower-risk
  surface the owner has already greenlit independently.
- **Money: deliberately zero spend** until a phase proves it can pay for itself — domain purchase,
  code signing, legal, and a Pro entity/payments are all owner-gated. Signing and legal gate the
  *public app* release; the domain gates the site's canonical URLs; none of this blocks the beta.
- **Still dark on purpose:** remote rules (triple-gated off), Tier 1 case intelligence (approved
  design, no runtime module/endpoint yet), Receipts sharing (no send path), Compy Pro licensing
  (needs an entity + payments). Gaming Mode is **no longer on this list — it's live.**
- **The tweak catalog is open, not frozen** (owner decision 2026-07-09): a tweak earns inclusion
  by measurable benefit under the same permanent safety rails (reversible, no ungated kernel capability /
  no injection, non-security-weakening, stability-safe) — see CLAUDE.md LOCKED rule 6.
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
