# STATE OF COMPY — full overview + council (marathon mandate, 2026-06-14)

> **Owner directive (2026-06-14):** "do a full overview of Compy in its current state… continue with
> your work, the goal is self-sufficiency and self-reliance amongst you and the council. Any new
> suggestions you guys come up with are green-lit by me following the dictation of the council. Begin a
> marathon autonomous sport mode."
>
> The council's greenlight now pre-approves NEW reversible suggestions. **The hard floor still stands**
> (reiterated by the harness every turn): no secrets, no force-push/moving frozen refs, no shipping
> mutation/features to other machines (installer/send), nothing irreversible+outward. And the LOCKED
> gates that ARE the moat stay owner-only: `blackbox_v2_gate` / `gaming_mode_gate` / `receipts_gate` /
> `remote_fetch_enabled` / leftovers `restore_gate` all stay default-OFF; catalog frozen; no
> security/system-setting flips; honest-measurement law absolute. The council advises within those.

## 1. Where Compy actually is (ground-truth, this session)

- **App:** Tauri 2, **24 Rust modules / ~23.6k LOC** + a full React/TS surface set. Mature, not a
  prototype. Suite green: **cargo 389 · npm 318 · clippy -D warnings clean · tsc + vite clean.**
- **Safety substrate (locked + proven):** typed apply→verify→rollback, exact-GUID power restore, Trust
  Ledger; manual-mutation QA signed off (2026-05-31). No kernel driver, no injection, local-only.
- **Upward-growth features SHIPPED (read-only/advisory):** F2 Readiness · F3 Sessions · F5 Export · F4
  Priorities · Monitoring/overlay · Benchmark + Latency lab · **Black Box v1 (evidence) + v2 (triage,
  gated) + v2.1 (measured payoff, gated)** · Tuning instrument. De-gamified Experience Pass UI.
- **Built but DARK behind gates (owner-only to flip):** F1 Gaming Mode (`gaming_mode_gate`), Leftovers
  v2 restore (`restore_gate`), Receipts telemetry scaffold (`receipts_gate`), Black Box v2/v2.1
  (`blackbox_v2_gate`), remote signed-rules (`remote_fetch_enabled`).
- **Content engine / site:** the Compy Blackbook — **159 graded, all-original entries** — live at
  `compy-bd6.pages.dev` (dark, zero third-party, waitlist Function proven). The Library doubles as the
  in-app knowledge base AND the web content engine (one shared render core; can't drift).
- **Money plan:** the Receipts Doctrine (content engine → opt-in telemetry → affiliate → Pro → B2B),
  zero-budget, one KPI per phase. Phase 1 (content engine) is the live, advanceable one; everything
  downstream is gated.

## 2. The one honest finding (Roadmap + Director agree)

**The build is AHEAD of the funnel. The gap to public 1.0 is almost entirely OWNER-GATED — business,
legal, your QA, code-signing $, and SENDING the link — not more core code.** The Roadmap's 🔒 list
(signing cert, monetization model, distribution, closed beta, gate flips, NVIDIA-rig verify) is the real
bottleneck, and none of it is mine to do. The 🤖 list I *can* drive is narrow by design: test/coverage
hardening, polish, content. **So the marathon's honest job is to make a finished product sharper and
safer while you hold the business gates — NOT to manufacture feature #20** (the Director, the Roadmap,
and PRODUCT_DIRECTION all explicitly warn against that).

## 3. COUNCIL — full three-stage, on "what is the marathon FOR"

**Stage 1 — advisors:**
- **Contrarian 🔴:** the real risk of an open-ended "build marathon" on a finished, gated product is
  *manufacturing motion* — feature bloat, test-for-tests'-sake, or gate-creep "because it's greenlit."
  The greenlight is for *reversible* suggestions; it does NOT dissolve the locked gates or the hard
  floor. Every lane must answer "does this protect the moat or feed the funnel, reversibly?" — if not,
  don't do it.
- **First-Principles:** "self-sufficiency" doesn't mean "do everything"; it means *don't idle waiting on
  me for the reversible, verifiable work*. The frame is: advance the ONE live money phase (content
  engine) + harden the moat (the gates ARE the moat; one brand-damage thread kills the funnel) +
  keep teeing up my decisions — and stop where only I can act.
- **Expansionist:** the compounding asset is the Blackbook content engine (Library→SEO→waitlist at
  announce) and the honesty moat (machine-enforced, a durable trust differentiator no snake-oil rival
  has). Depth there beats breadth elsewhere.
- **Outsider:** to a smart stranger, the product already looks *more* trustworthy than the category;
  the weird part is it's invisible (dark, unsent). Nothing I build fixes that — only the owner sending
  the link does. So don't gold-plate a site no one visits yet; keep it announce-ready, not ornate.
- **Executor:** concrete reversible lanes: (1) content — more confident Blackbook entries (the live
  money phase); (2) moat — fix a GENUINE quality/coverage/a11y gap, not busywork; (3) keep the owner
  decision packet + board current. Deploy content; council-strip each; log owner items; stop at the
  gate line.

**Stage 2 — peer review:** Contrarian's "manufacturing motion" warning is the load-bearing one;
everyone ratifies the test: *moat or funnel, reversibly, or don't.* Expansionist + Outsider converge:
content DEPTH (confident entries) yes, dark-site SEO gold-plating no (premature until announce).
First-Principles checks Executor: cap content on confidence (drop shaky calls), and only harden where a
real gap exists. Executor concedes both caps.

**Stage 3 — Chairman:** Marathon is **GO** as a *finish-and-harden* run, not a *build-more* run. Lanes,
in priority: **(A) content engine** — confident Blackbook entries only, ≥1 [real], deploy; **(B) moat
hardening** — a genuine quality gap (the council picks per-lane, no busywork); **(C) keep the owner's
decisions teed up.** Every lane: automated suite + council judgment; owner-gated items LOGGED not done;
stop at the gate line. Next move: Lane A content.

## 4. Greenlit backlog (reversible; council-approved; owner-gated items excluded)
- **A. Content engine** — confident Blackbook entries (FPS-myth gaps still genuinely open: e.g.
  iGPU-disable, motherboard-FPS, BIOS-update-FPS, Win11-vs-10, CPU-OC, SSD-FPS). ≥1 [real]. Deploy.
- **B. Moat/quality** — targeted hardening only where a real gap exists (a11y on new surfaces, a thin
  contract test, an honesty guard). No busywork.
- **C. Owner-decision hygiene** — keep the gate-flip decision packet + the board accurate.
- **EXCLUDED (owner-gated, logged not done):** any gate flip, installer, send, spend, security-setting,
  signing, telemetry arming, NVIDIA-rig verify, final taste/naming, anything irreversible+outward.

## 5. Owner Review Queue (standing — the real levers, all yours)
1. **SEND the waitlist link** — the single highest-leverage move; the build is ahead of the funnel.
2. **Black Box gate flip** — preview the v2 copy, then flip (decision packet in `AUTONOMOUS_SPRINT_2026-06-14.md`).
3. **Business/legal/signing** — monetization model · EV cert ($) · legal final sign-off · `[STATE]`/name.
4. **Gaming Mode QA → flip** (needs your UAC rig) · NVIDIA sensor verify (needs an NVIDIA rig).

---

## Marathon work log (appended per lane)

### Lane A — content engine — ✅ `22e4521` (159 → 165) · deploy `3d848fac`
6 confident debunks: `lower-graphics-settings` [real, the most reliable lever after resolution] +
`integrated-graphics-disable-fps` / `motherboard-fps` / `bios-update-fps` / `ssd-fps` [placebo] +
`cpu-overclock-fps` [risky]. lint/jargon/collision green (fixed: linked the `pbo` term where the copy uses
"PBO"); pin 75→81; regen 165; zero third-party (live-verified). All distinct from the uefi-bios /
nvme-ssd-hdd TERMS.

COUNCIL STRIP — Lane A, 2026-06-14
Contrarian: the risk on a thinning well is a forced shaky call — held: all 6 are confident + common +
distinct, and `cpu-overclock-fps` is honestly graded [risky] (loses boost / instability) rather than
hyped as a tweak.
First-Principles: this is the ONE live money phase (content engine) — right work; everything downstream is
owner-gated.
Expansionist: `lower-graphics-settings` [real] + `ssd-fps` (honest "real for stutter, not avg FPS") are
high-search-intent trust-builders.
Outsider: a library that says [placebo] to motherboard/BIOS/SSD "FPS" upsells reads as the honest broker,
not a parts-shop shill.
Executor: 6 shipped, regenerated, deployed, live-verified.
Chairman: GO — content lane clean; next Lane B (close a genuine quality gap).

### Lane B — moat/quality hardening — ✅ `d53c3d0` (test-only, frontend)
Closed a GENUINE gap (not busywork): the Black Box v2/v2.1 UI the owner is about to ship had no component
test. New `BlackBox.test.tsx` (invoke-mocked) pins the on-screen honesty — consistent-with framing + a
strength WORD + no percentage + no causal claim + flag-OFF renders v1 + "you marked this helped" never
"fixed/solved" + the clean empty state. npm 318→323. No behavior change, gate untouched + default-OFF.

COUNCIL STRIP — Lane B, 2026-06-14
Contrarian: "test coverage" is the classic busywork trap — this isn't: the UI honesty layer (the thing a
tester actually SEES) was unpinned, and it's exactly what must not regress before the gate flip.
First-Principles: the moat is honesty; pin it where it renders, not just where it computes.
Expansionist: a machine-checked honest UI is a durable trust asset competitors can't fake.
Outsider: "the AI's crash-advice screen can't say a percentage or a cause" is now provable, not a promise.
Executor: one test file, zero behavior change, committed + pushed.
Chairman: GO — the about-to-ship UI is now honesty-pinned end to end (Rust logic + TS resolution + React
render).

### Lane C — content engine round-2 — ✅ `ec05b8a` (165 → 168) · deploy `878e8bdb`
3 confident debunks: `laptop-plugged-in-fps` [real — one of the biggest free FPS swings on a laptop;
battery throttles hard] + `windows-11-vs-10-fps` / `gaming-mouse-dpi-fps` [placebo]. lint/jargon/collision
green (fixed a banned-word "basically"); pin 81→84; regen 168; zero third-party (live-verified).

COUNCIL STRIP — Lane C, 2026-06-14
Contrarian: the well is genuinely thinning — this is the last confident batch; the next candidates
(disable-vsync framing) are borderline and were HELD to the ORQ, not forced.
First-Principles: `laptop-plugged-in-fps` is the highest-impact missing entry for a huge segment (laptop
gamers) — real content value, not filler.
Expansionist: laptop/OS/peripheral myths are high-search-intent; the corpus now spans desktop, laptop,
display, network, storage, and CPU/GPU myths.
Outsider: telling a laptop gamer "plug in, here's a third of your frames back" is the kind of free, honest
win that earns word-of-mouth.
Executor: 3 shipped, deployed, live-verified; content lane is now at its confident ceiling.
Chairman: GO — content engine at its honest ceiling (168); further entries would thin quality. Marathon
reaching its reversible boundary.

---

## MARATHON CLOSE — suite totals + the honest boundary

**Delivered (all reversible, verified, pushed):** the full state-of-Compy overview + 3-stage council ·
**content 159 → 168** (9 confident entries across 3 lanes: 2 [real] trust-builders — `lower-graphics-
settings`, `laptop-plugged-in-fps` — + 6 [placebo] + 1 [risky]) · **Black Box v2/v2.1 UI honesty pinned on
screen** (`BlackBox.test.tsx`, the genuine coverage gap) · 2 site deploys (latest **`878e8bdb`**, live 168,
zero third-party).

**Suite:** cargo **389** · npm **323** (64 files) · clippy `-D warnings` clean · tsc + vite clean ·
knowledge + jargon + alias-collision lint green.

**Gates / floor — all held:** every locked gate UNTOUCHED + default-OFF (`blackbox_v2_gate` /
`gaming_mode_gate` / `receipts_gate` / `remote_fetch_enabled` / `restore_gate`) · **NO installer cut** ·
**no send / no spend / no security-setting / no irreversible-outward** · frozen refs `16069fa` /
`beta/private-beta-001` UNTOUCHED · appliable catalog frozen (all additions are Library explainers) · zero
third-party (app + site).

## CLOSING COUNCIL STRIP — marathon 2026-06-14
Contrarian 🔴: the only real danger of an open-ended "build marathon" on a finished product is manufacturing
motion — held it: every lane was moat (UI honesty pin) or funnel (content engine), reversibly; NOTHING
owner-gated was touched, and content stopped at its confident ceiling instead of padding a number.
First-Principles: "self-sufficiency" meant don't idle on the verifiable reversible work — done; it never
meant cross the gate line, and it didn't.
Expansionist: +9 high-intent content-engine entries + a machine-pinned honest UI = compounding distribution
+ a durable trust moat, not feature bloat.
Outsider: the product now reads, end to end, as the honest broker in a snake-oil category — and that's
test-enforced, not claimed.
Executor: the next concrete move is the OWNER's — send the waitlist link (the build is ahead of the funnel)
and/or preview+flip the Black Box gate. Everything I can do reversibly is done and green.
Chairman: marathon COMPLETE at its honest boundary. The build is finished-and-hardened; all remaining
leverage is owner territory. Standing by — no further reversible value without you.

### Lane D — Compy Pro license-verify FOUNDATION (the money-stack's first real code) — ✅ `19af35b`
Triggered by the owner's "so there's no work to be done, the app is done?!" — the honest answer was *no*,
and the highest-leverage *buildable-solo* item was sitting in MONETIZATION.md §5: the offline Ed25519
license verify. Built `src-tauri/src/license.rs` — pure `verify_license` (verify-before-trust,
model-agnostic expiry so the one-time-vs-subscription decision needs no code change, every bad case →
clean free), `LicenseStatus`, app-local key storage, 2 read-only IPC, 8 tests. DARK + triple-gated OFF
(placeholder pubkey + `licensing_armed()` false + explicit zero-key reject → a shipped build validates
NOTHING). Private signing key never in the repo. **`/security` + `/check` both CLEAN.** cargo 389→397.
Owner territory (NOT encoded): model/price/processor/split.

COUNCIL STRIP — Lane D (Pro license foundation), 2026-06-14
Contrarian 🔴: building monetization code could read as "deciding to charge" — it does NOT: the model,
price, processor, and free/Pro split are untouched owner territory, and the whole thing ships DARK
(validates nothing) until the owner arms it; the private key is provably absent from shipped builds.
First-Principles: the owner asked "is there nothing to build?" — the honest answer is the money stack's
foundation was unbuilt; this is the one piece buildable without their pricing decision (per their own doc).
Expansionist: this is the keystone of money-stack phase 4 (Pro) — built honestly now (offline, no account,
preserves the privacy brand), it unblocks the revenue path the moment the owner picks a model.
Outsider: an offline, account-less, no-phone-home license check is itself a trust differentiator — it
proves "we charge without spying," which fits the brand a snake-oil rival can't copy.
Executor: real module + 8 tests + both audits clean + committed/pushed — tangible, not a doc.
Chairman: GO — the money stack now has a verified, dark foundation; arming it stays the owner's deliberate,
gated step. This is the substantive answer to "is the app done?" — no, and here's proof of what's left to build.

### Lane E — Compy Pro license SURFACE (dark) — ✅ `129108e` (frontend-only)
Completed the license foundation's surface per the owner's "continue all solo work": `LicensePanel` in
Settings → "License" + the `LicenseStatus` TS type (the /check-noted missing contract). DARK-aware — in
the disarmed state it shows ONLY the honest free message + NO entry form (no dead-end); when the owner
arms licensing, a "Have a license key?" entry appears → `set_license_key` → friendly status. Never
paywalls safety. 3 component tests. npm 323→326. **Owner-via-council:** the free-vs-Pro split + model/
price/processor remain your call — this surface gates no features, only reports a tier.

### Lane F — content engine: educational terms — ✅ `7d3ca64` (168→171) · deploy `8fce28ce`
The FPS-myth DEBUNK well is at its confident ceiling, but the educational-TERMS well has real
search-intent room: `anti-aliasing` (AA types + cost), `power-limit-tdp` (wattage ceiling vs heat),
`gpu-boost-clock` (dynamic clocks; why "lock max clocks" misses). Confident, in-scope, distinct.
lint/jargon green; regen 171; zero third-party (live-verified).

COUNCIL STRIP — Lanes E+F, 2026-06-14
Contrarian: building Pro UI risks pre-deciding monetization — held: the surface gates NOTHING, ships dark
(no entry form until armed), and the split/model stay owner-queued; the terms are educational, not padding
(real queries: "what is anti-aliasing / TDP").
First-Principles: "continue all solo work" = finish the buildable parts (license surface, content) and
queue the decision-shaped parts (the split) — exactly what happened.
Expansionist: the license foundation (backend + dark UI) is the money stack's keystone, ready the instant
the owner picks a model; the terms widen the content engine's search surface.
Outsider: a "License" panel that says "everything safety-critical is free, always" reads as the honest
broker, not an upsell funnel.
Executor: real UI + 3 tests + 3 terms + deploy, all committed/pushed.
Chairman: GO — money-stack foundation + content both advanced; the owner-shaped pieces are queued, not
guessed. Continuing solo until genuinely dry.

<!-- lanes appended below -->
