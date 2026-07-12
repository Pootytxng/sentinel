# Consumer-Panel Overhaul — Master Build Plan (CC/Fable execution)

> **🔄 RESUME STATE (CC session refresh, 2026-07-11 ~20:55):** ALL build work for this train is DONE
> in the working tree on `main`, **UNCOMMITTED** (deliberately — a self-reviewer pass was in flight
> at session end; its verdict never landed, so re-dispatch it). Verified: tsc 0 · full vitest
> **1319/1319** (166 files) · `node site/generate.mjs` re-run · site-landing tests 15/15 (new
> contract pinned). What landed (see the annotated answers/sections below): Q1-Q4 owner answers
> recorded under each question · Phase 0 verified (`currently_applied` = live probe,
> recommendations.rs:315 — "fully applied" reachable with zero user action) · Phase 1 copy
> (OptimizeStation caption + aria, lab-guided-data.ts, friendly-labels VBS headline) + Term glosses
> (HomeConsole/LabConsole "1% low" via ArcGauge ReactNode label + note prop, TuningInstrument ETW,
> TuningVerdict, Benchmark) — Monitor jargon bucket DEFERRED (scope record under Phase 1 item 1) ·
> Phase 2 (ArcGauge `note` "= N of M checks passed" on both consoles; NEW TrustMoment.tsx /
> trust-moment.css / trust-moment-data.ts + .test.ts, mounted in App.tsx Overview branch, offered
> only when ledger empty, HKCU-only whitelist) · Phase 3 site (kicker↔h1 swap, hero-note free line,
> accessible proof-loop hero, start-here split via START_CARDS/MORE_CARDS in generate.mjs, card-why
> teasers; scripts/site-landing.test.mjs re-pinned) · Phase 4: Q2 Settings sweep (11 toggle rows
> removed, Monitor console kept — audit rationale in the removal comment), Q4 protection-first
> banner reframe (App.tsx banner + App.css tone + GamingMode card; GamingMode.test re-pinned), Q3 =
> proposal doc `docs/superpowers/specs/2026-07-11-expert-layer-middle-ground.md` (awaiting owner
> GO — do NOT build). Impeccable-hook findings in untouched regions were classified pre-existing
> owner-approved design; do not "fix" them. `docs/COWORK_AUDIT_2026-07-11.md` is Cowork's
> uncommitted work — EXCLUDE from this train's commit; the three COWORK_*_2026-07-11 evidence docs
> + this plan + the spec DO belong in it.
> **UPDATE (~21:20):** self-review ROUND 1 ran = **FAIL, 4 real catches**, all FIXED: (a) `.kl-term`
> now `text-transform/letter-spacing: inherit` (Term inside ArcGauge's uppercase label rendered
> mixed-case) · (b) `.kl-tip` now `text-transform:none; letter-spacing:normal` (tooltip shouted
> all-caps) · (c) Term gained `align="end"` → `.kl-tip-end` right-anchor; LabConsole's bottom-right
> 1%-low uses it (tooltip clipped 126px off-window) · (d) site `.hero h1` clamp → `(28px, 3.4vw,
> 44px)` + regenerated (h1 wrapped 3 lines at 1400px, ask said 2). bug→guard: NEW
> `src/design/term-style-guard.test.ts` pins (a)(b)(c). Re-verified: tsc 0 · vitest **1322/1322**
> (167 files). **Self-review ROUND 2 dispatched** (scoped to the 4 fixes).
> **NEXT STEPS, in order:** (1) await round-2 verdict; fix any FAILs (round-1 evidence also noted
> Home's h1 "N thing(s) need your attention" as a possible title-header-law violation — PRE-EXISTING,
> not this train's diff; flag for a separate pass, don't fix here) → (2) feature commit on `main`
> (branch-check first; EXCLUDE docs/COWORK_AUDIT_2026-07-11.md) + push → (3) check the boxes in
> this file citing that hash → (4) `npm run tauri build` → `scripts/ship-reinstall.ps1` → verify
> live==build via the STAMP → (5) same-train docs commit: RELEASE_STATE new UPDATE block (note: the
> Home-console + Lab-ground "Settings row is the failsafe" lines in older banners are superseded —
> failsafe is now localStorage/devtools-only) + BACKLOG rows → (6) terse report incl. the Q3 GO ask
> + deferred Monitor-jargon follow-up.

> **Supersedes `docs/COWORK_MARATHON_ROADMAP_2026-07-11.md`** — that doc is now a pointer to this one.
> Source evidence (full persona quotes, per-item tags) lives in
> `docs/COWORK_PERSONA_CRITIQUE_CHECKLIST_2026-07-11.md` and `docs/COWORK_CONSUMER_PANEL_2026-07-11.md`
> — this plan doesn't re-paste that evidence, it's the executable distillation of it. Read those two
> only if you want the raw quotes behind a line item; everything you need to START building is here.

## What this is

Five real, independently-run AI personas (zero project context, real evidence pack of the live app +
site) gave first-contact critiques of Compy. This plan converts every one of their critical points into
either a buildable task or an explicit taste-call question — nothing from the panel is dropped or
silently ignored. It is scoped for a single CC/Fable marathon session, or split across a few.

## How to work this plan (read before starting)

1. **Ask every question in "Upfront taste calls" (below) before writing any code**, in one batch, using
   the exact Question/Options format given — this is a normal Cowork-style multiple-choice prompt, not
   open-ended. Wait for real answers before starting any 🎨-tagged phase item. 🟢 items don't need to
   wait.
2. **This plan feeds the existing toolchain, it doesn't replace it.** Every UI change still goes through
   `self-review` before being claimed done; every caught defect still gets bug→guard'd; ship still means
   `docs/RELEASE_STATE.md` + `BACKLOG.md` update in the same commit, silent reinstall after every build.
   Standard SPORT MODE stops (secrets, shared/irreversible git, ships-to-other-machines, security/system
   settings) are unchanged and still apply.
3. **If you hit a taste call this plan didn't anticipate, stop that item and ask** — same Question/
   Options format, don't guess, don't stall the rest of the marathon waiting on an answer to one item.
   Move to the next unblocked item while the owner answers.
4. **When you finish an item, check its box in this file and cite the commit** — this file is now the
   tracking surface for this train, same discipline as everything else in this repo.

## Prioritization rule (what "optimal" means here)

Not a literal optimization — five simulated readers is signal, not proof. Order work by: **(a)** how
many of the five independently hit the same friction (signal strength) **(b)** whether the fix serves
the panel's own identified target — the "recovering skeptic" (see `COWORK_CONSUMER_PANEL_2026-07-11.md`)
— over a niche the panel itself said isn't the primary audience **(c)** cost and reversibility, cheapest
clean wins first **(d)** never, under any framing, cross a 🔒 LOCKED rule because a persona didn't like
it. The real optimization step this project already has queued is sending the beta to actual humans
(`OWNER_ACTION_CHECKLIST.md` §A2/§B2) — this plan should make that send land better, not substitute for
it.

---

## Upfront taste calls — ask ALL four before starting Phase 4, in one batch

**Q1 — The hologram / Instrument-HUD visual direction.**
Grinder and Skeptic called it "theater over substance"; Budget Teen wanted to screenshot and clip it,
called it "sick." Polarized, not unanimous — and this is a direction the owner has personally steered
through multiple approved rounds (`UI_VISION_BACKLOG.md`).
- A) Keep it exactly as-is — it's core identity, and the Teen's reaction suggests it lands with the
  actual target audience. **(Recommended — the recovering-skeptic target skews closer to the Teen/
  casual end than the Grinder/Tinkerer end who disliked it.)**
- B) Tone it down specifically for first-time/non-technical users (simpler Home by default, full
  hologram available but not the cold-open), keep it full for returning users.
- C) Something else — describe it.

> **OWNER ANSWER (2026-07-11): A — keep exactly as-is.** No Phase 4 work for Q1.

**Q2 — The 12 "(preview)" Settings toggles.**
Three of five personas independently read this screen as an internal QA panel. Several toggles describe
features already DEFAULT ON per `RELEASE_STATE.md` — meaning the toggle itself may just be leftover
flag debt, not a deliberate choice.
- A) Remove the toggle for any feature already graduated to permanent default-ON; keep the feature,
  delete the now-pointless switch. **(Recommended — this reads as debt, not taste, on inspection.)**
- B) Keep all toggles but move them behind a real "Advanced/Developer" settings sub-page, hidden by
  default.
- C) Leave as-is.

> **OWNER ANSWER (2026-07-11): A — remove the toggle for any feature already graduated to permanent
> default-ON; keep the feature, delete the now-pointless switch.**

**Q3 — Build a genuine expert/power-user layer (raw values, true percentiles, export, per-tweak
overrides on non-LOCKED items)?**
Only the Tinkerer wanted this. The panel's own target-consumer finding says the primary audience is the
recovering skeptic, not the enthusiast — building this could dilute the simplicity that's actually
converting the target the panel identified.
- A) Explicitly do NOT build this now — commit to the simplicity identity, accept enthusiast
  dissatisfaction as a known, deliberate tradeoff. **(Recommended, based on the panel's own
  target-consumer finding.)**
- B) Build a minimal version (true percentiles + raw values behind one "Advanced" toggle, no export
  yet) as a low-cost partial concession.
- C) Build the full expert layer — actively compete for the enthusiast segment too.

> **OWNER ANSWER (2026-07-11): custom — "research into this to find the best middle ground to appease
> the largest consumer interest range. definitely finding a way to allow for the tinkerer to have
> their full panel of tweaks to fuel their junky cravings if they so choose."** → CC deliverable:
> researched proposal + build of the agreed middle ground. Hard boundary unchanged: the tinkerer's
> "full panel" spans non-LOCKED items only — no barred-refusal overrides (Reopened section stands).

**Q4 — Gaming Mode recovery banner: first-impression timing.**
Unanimous across all five personas as an anxiety-inducing first thing seen. The underlying mechanism
(never hide an unresolved session) is NOT in question — only the tone/timing of first encounter.
- A) Keep exactly as-is — the safety signal matters more than first-impression polish.
- B) Soften color/copy specifically on the FIRST encounter (calmer tone, "this is safe, tap to learn
  why" instead of leading with alarm-amber), keep full urgency on repeat encounters. **(Recommended —
  costs little, fixes the actual finding, doesn't touch the honesty mechanism.)**
- C) Delay showing it until after the first Home-screen view loads. Flag: owner should confirm this
  doesn't conflict with the existing "never silently hide an unresolved state" law before picking this.

> **OWNER ANSWER (2026-07-11): custom — "explore more options to better satisfy this complaint, look
> into all possible options and deduce which option is all around most optimal to appeasing the
> majority."** → CC deliverable: option exploration, pick + implement the all-around optimal (the
> never-hide mechanism itself stays untouched).
>
> **CC EXPLORATION + VERDICT (2026-07-11):** options weighed — (A) keep as-is: fails all five
> personas. (B) first-encounter-only softening: needs new persisted "seen" state; shows the SOFT
> version at the exact moment clarity matters most (right after a crash) and MORE alarm on repeats
> when the user already knows — inverted urgency; extra state, extra bugs. (C) delay past first
> Home paint: brushes the never-hide law, adds timing complexity, and the tone problem survives the
> delay. (D) shrink to a status chip: reduces visibility of an unresolved state — against the law's
> spirit. (E) **permanent protection-first reframe (chosen):** the honest truth is nothing is at
> risk — the restore receipt is intact — so alarm-amber overstated the stakes; copy now leads with
> "Nothing's lost … Compy kept the full restore receipt", styling drops alarm-amber for the calm
> neutral panel tone with the key phrase in accent. Zero new state, calm on every encounter,
> banner/actions/role and the never-hide mechanism untouched. Applied to BOTH surfaces (App-level
> banner + the Gaming pane's recovery card — sweep-the-class law).

---

## Phase 1 — Language & framing fixes (app-side, live product — highest stakes, all 🟢, start immediately)

- [ ] Plain-language pass on Monitor/Lab jargon (frametime, 1% low, VRR, VBS, ETW, "anti-cheat safe") —
  inline glosses at first exposure, or gate behind an already-existing Advanced surface. Closes a gap
  against CLAUDE.md's own no-jargon promise, not new scope.
  > **Scope record (2026-07-11):** a full sonnet inventory of every user-visible jargon hit ran; the
  > existing `<Term>`/`<WhatsThis>` glossary mechanism was reused (no new component). Landed: Term
  > glosses at first exposure on the Home + Lab console "1% low" gauges (ArcGauge label is now
  > ReactNode), TuningInstrument ETW, TuningVerdict 1% low, Benchmark "frametimes". Already glossed
  > (verified, no change needed): Play/SessionDebrief/MonitorBasic 1% low + ETW, VBS + VRR + Nagle
  > via WhatsThis on Fix rows; "anti-cheat safe" self-explains inline everywhere it renders.
  > **DEFERRED per this plan's own sequencing note: the MONITOR-surface bucket** (monitor-panels,
  > MonitorConsole delta row, DeckScope trace label, SessionStack, monitor-v2-data — enumerated in
  > the inventory) waits until the Monitor v5 eyeball settles, then lands as a small follow-up.
- [ ] Rewrite "Safe Stack — Fully applied" and "a security feature may be costing you frames" copy so
  neither reads as unconsented action or a request to weaken security. Confirm the fresh-install vs.
  dev-rig question (Phase 0 below) before finalizing exact wording.
- [ ] Surface Blackbook grading reasoning next to the chip (even one line), not only behind "Autopsy a
  guide" — closes the "tier list, not an argument" gap.

## Phase 0 — Verify before Phase 1 lands (❓, quick, do first)

- [ ] Confirm whether a fresh consumer install can reach a "Safe Stack — X/X fully applied" state
  without an explicit user action, or whether that's specific to this heavily-used dev/test rig
  (ledger: 51 real entries). Changes how strongly Phase 1's copy fix needs to disclaim "you approved
  these."

## Phase 2 — First-run trust sequence (🟢)

- [ ] Guided "watch it work" moment for brand-new users: apply one trivial, reversible setting, show
  before/after, show the rollback complete — live, once, before asking for further trust. Named
  directly by the Burned Skeptic; it's the exact loop the marketing site already promises but never
  demonstrates to a first-time user.
- [ ] Add a one-line "how we calculate this" under "READINESS 100 · SCORED" — closes the Tinkerer's
  "made-up number" read cheaply.

## Phase 3 — Marketing site (🟢, site is explicitly not live yet — sequence whenever, cheap now)

- [ ] Promote the kicker ("Know which PC tweaks actually help your rig") over/above the current headline
  ("Measured, not promised"), or A/B them — Budget Teen named the kicker as the stronger hook already
  sitting unused.
- [ ] Move "it's free" up near the top of the page — currently requires scrolling to footer/Settings.
- [ ] Make the proof-loop strip (applied → measured → rolled back) the hero visual, not a decorative
  aside — three personas cited it unprompted as the most convincing element on the page.
- [ ] Re-balance the Blackbook section to lead with "START HERE" bite-sized entries over the raw
  "174 tweaks / 85 terms" counts, which read as homework to two personas.

## Phase 4 — Taste-gated items (do not start until all four Upfront questions are answered)

- [ ] **If Q1 = B:** build a simplified first-run Home variant, hologram deferred past cold-open.
- [ ] **If Q2 = A:** flag-debt sweep of `src/design/theme.ts` reads — remove toggles for already-
  graduated features, keep the shipped behavior. **If Q2 = B:** build the Advanced/Developer sub-page
  and relocate the toggles there instead of removing them.
- [ ] **If Q3 = B or C:** scope and build the expert-layer surface at the agreed depth.
- [ ] **Apply Q4's answer** to the recovery banner's first-encounter presentation.

## Reopened for owner consideration (owner directive 2026-07-11 — don't auto-exclude a LOCKED critique from the conversation)

Two persona critiques touched genuinely LOCKED CLAUDE.md rules. Per owner directive, these don't get
silently filtered out just because they're currently locked — but "open for consideration" and "build
it now" are different things, and both of these carry stakes well beyond one persona's taste. **Neither
is in Phase 1–4 above. CC should not write code toward either without a separate, explicit owner
go-ahead outside this marathon** — flag them, don't bundle them into the Upfront batch, don't guess.

- **No CPU temperature / no kernel driver (rule 1).** The Tinkerer wants this — HWiNFO already gives it
  to him. This isn't really a policy switch: CLAUDE.md states it was "proven impossible in user-mode on
  this machine" after prior investigation, and the deeper reason kernel-mode access is avoided at all is
  rule 2 (anti-cheat safety) — a kernel driver risks real users getting flagged by EAC/BattlEye, which
  outweighs one enthusiast's convenience by a wide margin. Worth a real conversation; not worth a
  multiple-choice pick mid-marathon.
- **No override on "Deliberately refused" barred items (Defender-disable, CPU-mitigation-disable, etc.
  — rule 6's "stays barred regardless of measured fps" tier).** The Tinkerer wants an override switch,
  and the verdict key's own copy ("lets you decide with eyes open") arguably half-promises it already —
  genuine tension, worth having out loud. But this category is barred for user-security/liability
  reasons a single frustrated enthusiast doesn't offset, and CLAUDE.md's separate SECURITY/SYSTEM
  SETTINGS rule requires a welfare-check before touching anything adjacent to this regardless of
  tweak-catalog policy. Same treatment: real discussion, not a bundled marathon answer.

**Not reopened** (nothing here was actually critiqued by any persona): rollback-first integrity, the
typed mutation allowlist, signed-remote-rules triple-gate, GPU-vendor-honesty grading. No reason to
touch any of these.

## Scope reconciliation — what this overhaul does NOT include, and why

Cross-checked against the current `OWNER_ACTION_CHECKLIST.md` (2026-07-11) so nothing in the existing
CC workflow gets silently dropped or silently swallowed into this new plan:

**Explicitly excluded — continue on their own existing track, unaffected by this plan:**
- §A1 Gaming Mode QA (8/10 cases remain) — owner-run QA, not a build item.
- §A2 Beta smoke pass (0/24) — owner-run QA, not a build item.
- §A5 Monitor v5 "Flight Deck + Session Stack" eyeball — **already in flight on its own plan doc**
  (`2026-07-11-monitor-v5-deck-stack.md`), already shipped (`960734c`), already awaiting the owner's
  live verdict. **Sequencing note: let v5 get its eyeball verdict FIRST.** Phase 1's Monitor jargon pass
  should land only after v5 settles, so CC isn't editing Monitor copy mid-eyeball-cycle on two different
  threads at once.
- §B1 Two Futures hologram (Lab-specific, "hologram has no visible purpose or information integrated")
  — this is a DIFFERENT hologram item than this plan's Q1 (which is about the Home/general
  Instrument-HUD direction). Don't conflate them; B1 continues on its own Lab-phase track.
- §B2 Beta send go/no-go — an owner decision, not a build task. This plan's whole point is to make that
  send land better; Phase 1–2 (live-product, highest-stakes items) are worth finishing before the send,
  but the send itself isn't gated on this plan finishing.
- §B3 Funnel go-live (Ko-fi URL + deploy GO) — pure owner inputs, no build work involved.
- §B4 Two substituted asks (design tooling, upgrade-path engine) — separate open owner decisions,
  unrelated to the consumer panel.
- §B5 UI-vision 🔴 open items (CommandPalette, site-glow/full-overhaul gate, magnetic-cursor slice,
  GSAP data-reactivity, room-transition wipe) — pre-existing owner-championed direction the panel never
  touched. Continues as-is. **Coordination note only:** if Q1 below lands on "tone down the hologram for
  first-time users," check whether that interacts with the in-progress magnetic-cursor/GSAP-reactivity
  work before building either — don't let the two trains collide silently.
- §C (code signing, legal, repo rename, Receipts arming) — money/legal-gated, unrelated to this panel.

**Confirmed included, nothing missing:** every 🟢/🎨/❓ item from
`COWORK_PERSONA_CRITIQUE_CHECKLIST_2026-07-11.md` maps to a Phase 0–4 line item or the Reopened section
above. Nothing from the five persona critiques was left unmapped.

## Definition of done

Every Phase 1–4 box checked with a commit citation, `RELEASE_STATE.md` and `BACKLOG.md` updated same-
commit per usual law, self-reviewer PASS on every UI-touching item, and the four Upfront questions
answered and recorded in this file (paste the owner's actual choice under each Q, don't just check the
box). Then: this plan is done, and the real next optimization step is the beta send this unblocks.
