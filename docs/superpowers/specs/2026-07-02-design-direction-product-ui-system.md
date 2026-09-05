# Design direction — the product UI system (owner brief 2026-07-02, reconciled)

> **PRODUCT DIRECTION SUPERSEDED 2026-09-04 (#369).** The governing design precedents, owner verdicts,
> and build direction below are historical rather than current authority. Current product and
> experience direction comes from `docs/PRODUCT_CONSTITUTION.md`; useful implementation and
> accessibility evidence remains bounded provenance.

> Owner supplied a Linear / Vercel Geist / Raycast / shadcn-principles brief ("specify it as a
> product UI system, not as a vibe"). This spec extracts its enforceable rules and maps them onto
> the EXISTING system — it does not start a parallel redesign. Governing precedents:
> `UI_SLIMDOWN_PLAN.md` (visual language is mature; the problem is element quantity + duplicate
> render paths), `2026-07-02-full-tidy-directive.md` (no ground-up rewrite), owner verdicts:
> cinematic-cockpit REJECTED (06-19), default-ON look KEEPS (07-02), rig hologram RETAINED (law).

## Anchor sentence (owner's, adopted verbatim)

*"Design this as a premium, dark-first Windows trust/readiness dashboard with the clarity of
Linear, the developer polish of Vercel Geist, the speed/command ergonomics of Raycast, and the
component discipline of shadcn/ui — without copying any brand or adding new features."*

## Fact-check of the brief (stale references, corrected)

- Page names "Overview / Readiness / Sessions / Trust Ledger / Export" → actual rooms are
  **Home / Optimize / Monitor / Blackbook / Lab** (rail order = journey order, P6).
- "BetaGateNotice / no fake active controls for gated features" → already law: gates render
  honestly (dark features render nothing; armed features render their real QA'd UI).
- "Audit the current UI structure" → done: `UI_SLIMDOWN_PLAN.md` §1 (2026-07-01 code audit).
  Its findings drove P1–P5.5; the un-landed remainder is P4 (dedup) + P6 (Journey).
- The brief's 10-stage sequence duplicates the existing pipeline; see "Where each stage lands."

## The enforceable principles (extracted, per reference — principles, never cloning)

| Source | Principle | Enforcement in Compy |
|---|---|---|
| Linear | Low-noise nav: one rail, no sub-nav sprawl; speed reads as quality | Rail stays the ONLY top-level nav (5 rooms). Guard: no new top-level nav entries without owner call. |
| Linear | Every screen answers one question first | RoomShell `verdict` slot (P6) — ONE plain-English verdict line above everything. |
| Geist | Type discipline: one UI face + mono ONLY for machine values | Already law (P5.5 item 5). Guard exists; extend to new components. |
| Geist | Spacing/grid rhythm: fixed scale, no ad-hoc margins | Tokens in `tokens.css` are the only spacing source. Guard: `theme-literal-guard` pattern extended to px-literal margins in new CSS. |
| Geist | Monochrome-first; color is information, never decoration | Accent = status/action only. Ambient motion stays barely-there (§8b caps). Hologram is the ONE sanctioned hero visual (owner law). |
| Raycast | Density without clutter: compact rows, detail on tap | P2 Basic/Advanced contract + SlimRecRow. Density budget: a settled screen shows ≤3 heterogeneous card types (UI_SLIMDOWN_PLAN culprit #3). |
| Raycast | Keyboard-first command flow | **PARKED** — CommandPalette is a NEW feature (brief's own "no new features" rule). Backlog candidate post-P6, owner call. |
| shadcn | Component discipline: one primitive per pattern, composed not forked | P4 deletes forked render paths; guard: new surfaces must compose `src/design` primitives (review rubric item). |

## Component map — brief's names → what exists (build NOTHING new here except RoomShell)

| Brief asks for | Compy has | Delta |
|---|---|---|
| AppShell | `WindowChrome` + rail + room container | None — P4 removes the duplicate shells. |
| SidebarNav | The rail (`NavGlyph`, `homeRail.ts`) | None. |
| TopBar / PageHeader | RoomShell `verdict` + `primaryAction` slots | **P6 builds RoomShell** — this IS the consistent page structure the brief wants. |
| StatusBadge | `StatusPill` | None. |
| MetricCard | `Stat`, `Gauge`, `Sparkline`, `Card` | None. |
| FindingCard | `SlimRecRow` (+ Basic/Advanced layers) | None. |
| DataTable | Ledger table (Applied/History, P5.5 item 4) | None. |
| DetailInspector | Detail-on-tap layer (P2 contract) | None. |
| EmptyState | `EmptyState` (honest empty states, P5.5) | None. |
| SafetyBanner | `TrustSwitch` + `TrustCue` + honesty surfaces | None — LOCKED territory, never touched by UI passes. |
| BetaGateNotice | Gate-honest rendering (dark = absent) | None — absence IS the notice; fake-disabled controls are banned already. |
| CommandPalette | — | Parked (new feature; owner call post-P6). |

## Where each brief stage lands

1. UI audit → DONE (`UI_SLIMDOWN_PLAN` §1).
2. Design-system plan → THIS DOC + existing tokens/primitives.
3. App-shell foundation → **P4** (delete duplicate shells/paths) — in flight.
4–9. Page-by-page migration, one room per commit → **P6** (RoomShell migration order:
   Home → Optimize → Monitor → Blackbook → Lab), per `2026-07-02-p6-journey-spec.md`.
10. Final consistency pass → **P7 polish pass** (NEW, small): after P6, one sweep commit per
   room applying the density budget + spacing-literal guard + type-discipline check to any
   surface RoomShell migration exposed. Flag-free (it's lint-level polish, not layout change).

## Hard goals from the brief, restated as testable rules

- One rail, five rooms, no sub-nav — guard on nav entries.
- One verdict line per room, above the fold — RoomShell slot order test (P6).
- ≤3 heterogeneous card types per settled screen — rubric item now, vitest guard when P6 lands.
- Mono only on machine values — existing guard, extended.
- No spacing/color literals outside tokens — `theme-literal-guard` pattern, extended.
- WCAG-AA contrast on all new surfaces — existing `theme-contrast.test.ts`.
- Gated = absent or honestly inert, never fake-active — existing law + A6-style guards.
- Hologram + ambient motion retained within §8b caps — owner law, not negotiable by polish passes.

## Explicitly NOT doing

- No shadcn/Tailwind adoption, no library swap — principles only; the primitive set is ours.
- No rebrand, no new visual identity — the premium-instrument language the owner kept 07-02 stays;
  this spec tightens it toward Linear/Geist restraint, it does not replace it.
- No CommandPalette / new features until owner green-lights post-P6.
- No screenshot-driven cloning of reference products (all-original law).
