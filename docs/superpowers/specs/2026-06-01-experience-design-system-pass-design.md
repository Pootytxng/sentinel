# Experience / Design System Pass — Architecture & Scope

**Status:** Design scope (brainstorm output). **Decisions A–F locked by owner 2026-06-01 (§8).**
No implementation yet — owner chose to HOLD code until green-light (Decision E), ideally informed by
first private-beta feel-feedback.
**Date:** 2026-06-01 · **Owner:** Kuya · **Author:** Claude (persistent work state)
**Source of truth this serves:** `docs/PRODUCT_DIRECTION.md` → *"Experience direction — the premium
command-center layer"* (the 7 home-base questions, the 6 surface "feel" metaphors, the aesthetic
language, the 10 Experience-Pass items, the honesty boundary).

> This is an **architecture/scope** document, not a pixel spec. It defines the system, the
> component model, the state model, the honesty guardrails, and a buildable decomposition. Visual
> intent is shown in the committed mockups (`mockups/experience-pass.html`). Per-piece
> implementation detail lives in the implementation plan that follows this spec.

---

## 1. Goal

Make opening Sentinel *feel* like a **serious performance command center** — understand, verify,
maximize — without ever lying. The product risk is **not** "too few features"; it is that an
average user reads it as "a settings page with a few switches." This pass closes that gap through
**clarity, proof, monitoring, and confident-but-honest presentation**, not new tweaks.

The bar (from `PRODUCT_DIRECTION.md`): futuristic but not childish; high-class performance cockpit,
not RGB clownware; dark/premium graphite-black-metallic; clean hierarchy; strong cards/panels;
subtle motion + polished transitions + tactile feedback; confident status; meaningful empty
states; **no fake gamer hype, no scammy boost language, no fake percentages, no opaque "optimized
score."**

---

## 2. Current state (honest assessment)

**Already good — keep and formalize:**
- A real, premium token system in `App.css :root`: palette (`--bg #07080b`, `--panel` ladder,
  `--accent #6aa9ff`), **semantic status colors** (`--ready #46d98a`, `--attention #f5b740`,
  `--danger #f3716f`), offline type (`Segoe UI Variable` / `Cascadia Mono`), geometry radii,
  elevation (`--edge`, `--shadow-1/2/pop`), and motion (`--ease`, `--dur 160ms`, `--dur-slow`).
- A clean **theme architecture**: `[data-theme]` overrides *only* color tokens; structure/motion
  shared. Default Graphite + 5 alternates.
- A **command rail** with 9 surfaces and an inline stroke-icon set (no icon font → offline,
  zero-outbound). Sections: Dashboard, Readiness, Priorities, Optimize, Monitoring, Sessions,
  Garage, Diagnostics, Ledger.
- A **status triad** already in the data model: `ready | attention | unknown` (Readiness &
  Priorities), with `attention_count`. This is the seed of the app-level posture state.

**Problems this pass must address:**
- **Monolith.** `App.tsx` (2767 lines) and `App.css` (2423 lines) do everything. You cannot
  standardize cards, states, and motion cleanly while every surface is inlined in one file. A
  primitives layer + per-surface modules is a prerequisite, not a nicety.
- **No shared component vocabulary.** Cards, pills, metrics, empty states are bespoke per surface,
  so "premium card styling" and "consistent status language" can't be applied in one place.
- **The gamification layer conflicts with the honesty boundary** (see §4). `computeTuneState`
  produces an app-wide "Tune tier" (Stock→Apex) that escalates every surface's "presence" and
  **gates theme unlocks**, plus a `🎲 Surprise` randomizer and 🔒 lock emoji. This is an
  *optimized-score-as-game-progression*, which the direction explicitly forbids unless transparent
  and defensible.
- **Emoji in a premium surface** (`🎲`, `🔒`) read as the "childish" register the direction rejects;
  the app already has a coherent inline-icon system to use instead.
- **No first-class app posture.** "Am I dialed in?" vs "something needs attention" is implied by
  per-surface pills but never expressed as one confident, glanceable home-base state.

**Out of scope for this pass (locked, do not touch):** any Rust/backend change, the recommendation
catalog, mutation/rollback logic, installer/packaging, remote-fetch, the updater, Gaming Mode, and
the frozen `private-beta-001` refs. This pass is **frontend-only, read-only, reversible** — it
re-presents existing data; it does not change what the app *does* to the system.

---

## 3. Architecture

### 3.1 Design-system foundation (`src/design/`)
Formalize what's implicit today into a small, documented layer:
- **Tokens** (`tokens.css`): promote the existing `:root` set as the canonical token contract;
  add explicit **motion tokens** (durations/eases already exist — name the interaction set:
  `--dur-tap`, `--ease-out`, hover/press elevation deltas) and a **status-token map**
  (`--status-ready/attention/danger/scanning/unknown` → color + soft + line) so every status
  surface reads from one place. Add `@media (prefers-reduced-motion: reduce)` global dampening.
- **Primitives** (small, single-purpose, independently testable React components):
  `Card`, `Panel`, `SectionHeader`, `StatusPill`, `Stat`/`Metric` (label + value + unit + trend),
  `Gauge` (radial/linear instrument readout), `Sparkline`, `TrustCue` (protected/rollback chip),
  `EmptyState` (icon + headline + one honest line + optional action), `Skeleton` (scanning),
  `Disclosure` (progressive-disclosure card body). Each answers: what it does, how you pass data
  in, what it depends on. No business logic inside primitives.
- **Icon set**: keep the inline stroke icons; extend to cover statuses and replace all emoji.

### 3.2 App-level posture state — `SystemPosture` (the home-base answer)
A single derived, **read-only, transparent** state that the dashboard hero, rail badges, and trust
cues all read from. States: `Scanning` (loading) · `Dialed-in` (no attention items) ·
`Attention` (≥1 real attention item) · `Unknown` (signals unavailable). Derived honestly from
**already-existing signals**: readiness `attention_count`, active applied-changes count, and
monitoring availability — **no new score, no magic number**. The hero always exposes *why*
(itemized, click-through to the exact readiness/priority rows). This is the honest replacement for
"what tier am I" — posture is a *summary of explainable facts*, never a number to chase.

### 3.3 Information architecture — the Dashboard as home base
Redesign `Overview` into a landing view that answers the 7 questions at a glance, each linking to
its surface:
1. *Am I ready to play?* → posture hero + readiness summary.
2. *What's holding this PC back?* → top 1–3 priorities.
3. *What has Sentinel safely improved?* → active-changes + Trust Ledger trust cue.
4. *What should I not touch?* → "already fine / not worth touching" callout.
5. *How did the last session perform?* → last-session debrief card.
6. *What can I share if I need help?* → Export entry point.
7. *Real performance or snake oil?* → honesty/provenance note + "no fake claims" stance.

The rail stays; grouping gets clearer visual separation (status surfaces vs tools vs ledger).

### 3.4 Per-surface "feel" treatments (map to the 6 metaphors)
- **Readiness → a live system check**: sequential check reveal on scan, confident pass/attention
  rows, "re-run check" affordance. Not a static list.
- **Sessions → a post-game debrief**: headline verdict + key metrics (avg FPS, frametime, 1%-low
  *labeled estimate*), small frametime sparkline, which Sentinel settings were active.
- **Priorities → a personal technician's ranking**: "biggest limiter for *this* rig" framed as
  advice, with reason + confidence; "already fine" and "not worth touching" buckets.
- **Export → a professional diagnostic report**: report-styled preview, clear "local file only"
  framing.
- **Trust Ledger → proof, not a log dump**: "you're protected / N changes, all reversible" trust
  banner; each entry reads as evidence (what, when, reversible: yes), rollback always offered.
- **Monitoring → an instrument cluster**: gauges/readouts (temp, usage, clocks, fan, power, VRAM,
  FPS/frametime) grouped like a cockpit, not raw stapled numbers; honest "—" when a sensor is
  unavailable (e.g., no CPU temp by design — say so).

### 3.5 Motion & interaction system
Subtle and purposeful only ("where useful"): card hover/press elevation, status transitions,
sequential reveal on first scan, number tweening for live sensors, polished tab transitions. Hard
rules: respect `prefers-reduced-motion`; never animate purely decoratively in a way that delays
information; tactile press feedback on all interactive elements.

### 3.6 Status-language system
A small honest vocabulary used everywhere: **Ready · Attention · Protected · Scanning ·
Unavailable**. Rules baked in: estimates labeled "estimate" (1%-low), unavailable sensors say why
(no CPU temp = no kernel driver), no "boost/turbo/maximize FPS" verbs, no fabricated percentages,
no opaque score. Confidence comes from clarity and proof.

### 3.7 Intent framing / modes (design the lens; do NOT wire mutation) — DEFERRED (Decision D)
> Deferred to its own later pass (post-beta). Retained here as forward context.
Design a guidance-only mode selector (Competitive / Balanced / Visual Quality / Stability) that
**re-weights readiness emphasis, priority ordering, and explanations** — purely presentational.
It must not flip any setting. (Scope decision in §8 — may be deferred to its own pass.)

### 3.8 Component decomposition (enabling refactor)
Carve `App.tsx`/`App.css` into the `design/` primitives + per-surface modules
(`surfaces/Dashboard`, `Readiness`, `Priorities`, `Optimize`, `Monitoring`, `Sessions`, `Ledger`,
`Diagnostics`, and the Garage/posture module). This mirrors the backend's safety-boundary module
discipline and is what makes consistent card/state styling possible. Scope of the carve is a §8
decision (full vs. primitives+dashboard-first).

---

## 4. The honesty reconciliation (the gamification layer)

The post-freeze experimental layer added a **Tune tier (Stock→Apex)** computed from readiness +
applied changes, set app-wide (`data-tune`) so every surface "gains cylinders," with **theme
unlocks gated** on peak tier, a `🎲 Surprise` theme randomizer, and a **Garage** tab that unlocks
past Stock. The commit framed `computeTuneState` as an *"honest"* score, and it *is* derived from
real signals — but **rendering it as a Stock→Apex evolution ladder that gates UI rewards is, in
effect, an "optimized score" the user is invited to grind up.** That collides head-on with the
direction's non-negotiable: *no opaque "optimized score" unless transparent and defensible; no fake
gamer hype.* Locking **functional polish (themes) behind a progress grind** also fights "premium /
not childish."

This is the single biggest design decision. **Decision A (owner, 2026-06-01): reframe to honest
posture** — the approach below is now the plan, not a suggestion:
- **Reframe, don't delete the intent.** Replace the "tier/evolution/cylinders" framing with the
  transparent **`SystemPosture`** (§3.2): Dialed-in / Attention, always click-through to the exact
  facts. Keep the *satisfaction* of "my system is dialed in" — earned honestly from explainable
  state, not a points ladder.
- **Ungate the core experience.** Themes/looks shouldn't be locked behind a grind in a trust-first
  premium tool; offer them freely (optionally keep a subtle "earned" accent as delight, not a
  gate).
- **Drop** the `🎲 Surprise` randomizer and emoji (off-register for premium-cockpit).
- **Garage tab → fold** its genuinely useful parts (appearance/theme + system-identity) into a
  calm **"Appearance / Cockpit"** settings area; retire the game-progression scaffolding.

Because beta "feel" feedback is incoming (testers are literally asked "premium or plain? childish?"),
holding the *final* call until that signal is reasonable — but the spec is written so either choice
slots in cleanly.

---

## 5. The 10 Experience-Pass items → where addressed

| # | Item | Addressed by |
|---|---|---|
| 1 | Stronger visual identity | §3.1 tokens/primitives, §6 guardrails, mockups |
| 2 | Better dashboard landing | §3.3 home-base + §3.2 posture hero |
| 3 | More premium card styling | §3.1 `Card`/`Panel` primitives |
| 4 | Clearer status language | §3.6 status-language system |
| 5 | Better animations/transitions | §3.5 motion system |
| 6 | More satisfying interaction states | §3.5 + primitives' hover/press/tactile |
| 7 | Better grouping of surfaces | §3.3 rail grouping + §3.4 per-surface |
| 8 | Stronger "protected / rollback" cues | §3.1 `TrustCue` + §3.4 Ledger |
| 9 | A real "system is dialed in" state | §3.2 `SystemPosture: Dialed-in` |
| 10 | A real "attention needed" state | §3.2 `SystemPosture: Attention` |

---

## 6. Honesty guardrails (baked into the system, non-negotiable)
- No fabricated percentages; no opaque "optimized score"; posture is always explainable to its
  source rows.
- Estimates labeled as estimates (1%-low). Unavailable data says *why* ("no CPU temp — no kernel
  driver, by design").
- No "boost/turbo/maximize FPS" marketing verbs. Provenance pills (Verified / Measured / Expected)
  preserved.
- GPU vendor honesty preserved (AMD verified; NVIDIA "implemented, not hardware-verified").
- Offline only: no remote fonts/assets/telemetry; inline icons; zero new outbound.
- Accessibility: WCAG-AA contrast on text; `prefers-reduced-motion`; focus-visible states.

---

## 7. Buildable decomposition & risk-ordered sequence
Each sub-project is its own implementation plan; all are **frontend-only, read-only, reversible**,
touch `src/` only, and keep `npm run build` clean (no Rust → `cargo test` unaffected).

1. **Design-system foundation** (`src/design/`: tokens + primitives + icons). No visible behavior
   change; pure substrate. *Lowest risk, build first.*
2. **Component decomposition** of `App.tsx`/`App.css` onto the primitives (scope per §8-B).
3. **`SystemPosture` state + Dashboard home-base** (§3.2–3.3) — the headline of the pass.
4. **Per-surface feel passes** (§3.4), one surface per plan, in user-value order:
   Monitoring → Readiness → Sessions → Priorities → Ledger → Export → Diagnostics.
5. **Motion & interaction polish** (§3.5) layered across surfaces.
6. **Gamification reconciliation** (§4) — applied per Decision A.
7. **Intent-framing/modes lens** (§3.7) — only if §8-D says "in this pass."

---

## 8. Decisions — RESOLVED (owner, 2026-06-01)
- **A. Gamification fate → REFRAME TO HONEST POSTURE.** Replace the Tune tier (Stock→Apex) / Garage
  / unlock-gated themes / Surprise randomizer with the transparent `SystemPosture` state (§3.2).
  Ungate themes; drop the dice + emoji. (Detail in §4 — now the plan, not a suggestion.)
- **B. Decomposition scope → PRIMITIVES + DASHBOARD FIRST.** Build the design-system foundation
  (sub-project #1), then redo the Dashboard onto it (#3); carve remaining surfaces incrementally.
- **C. Theme set → CURATE TO A PREMIUM SET.** Keep Graphite (default) + Frost + Aurora Noir +
  Carbon Ember; **drop neon Synthwave + Viper** as off-thesis. (Removal lands in the relevant
  sub-project, not the foundation.)
- **D. Modes UI → DEFER** to its own later pass (post-beta).
- **E. Timing → HOLD IMPLEMENTATION.** Scope + plan are done; no code until owner green-lights,
  ideally informed by first private-beta feel-feedback.
- **F. Accent → KEEP** the blue `--accent #6aa9ff` brand accent.

---

## 9. Assumptions made (documented, not asked — per persistent work state)
- This pass changes **presentation only**; no rec/mutation/gate/backend behavior changes. Verified
  against the locked constraints; any item that would cross them is excluded by construction.
- The existing token palette + Graphite default are the brand foundation (not restarting identity
  from scratch — refining what's there).
- Implementation will live under `src/design/` + `src/surfaces/` and keep the existing
  Tauri/React/TS toolchain and offline/zero-outbound rules.
- Verification for this pass = `npm run build` clean + manual visual review + (optional) the
  existing single-instance/export smoke; **no Rust tests affected** (no `src-tauri/` changes).
- Final visual decisions benefit from the incoming private-beta "feel" feedback; nothing here
  presumes shipping before that.

## 10. Non-goals
No backend/Rust changes · no catalog/mutation/rollback changes · no installer/packaging/signing ·
no remote-fetch/updater · no Gaming Mode · no moving `private-beta-001` refs · no new outbound
network · no telemetry.
