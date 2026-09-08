# Design — Merge Check + Tune → "Optimize" (the restructure pattern-setter)

> **PRODUCT DIRECTION SUPERSEDED 2026-09-04.** This is a historical design record, not current
> product authority, priority, approval, or work authorization. Current product direction is
> [`docs/PRODUCT_CONSTITUTION.md`](../../PRODUCT_CONSTITUTION.md), with sequence derived in
> [`docs/product/ROADMAP.md`](../../product/ROADMAP.md). Conforming honesty, accessibility, and safety
> provenance remains useful under [`docs/ARCHITECTURE_LOCKS.md`](../../ARCHITECTURE_LOCKS.md).

**Date:** 2026-06-21 · **Status:** approved design (owner) + council-reviewed · **Next:** writing-plans

## Context

Owner directive (+ a user's feedback): begin an **app-wide UI restructure** toward *condensing* and
keeping related things together — each tab's face showing **simplified, meaningful context up front**
while **rich detail stays accessible, never buried or diluted**. The trigger: the "past tweaks" tool
(the Trust Ledger — `Active on this PC` + `Full history`, today at the *bottom of Tune*) reads as
tucked-away. **Check** (diagnose) and **Tune** (apply/manage) are two halves of one job — "fix what's
holding your games back" — so they merge. This merge is the **pattern-setter**: the proven template we
then roll to the other tabs (each its own spec → plan → build). Styling leans into a **bold V0-driven
hololens reinvention**, but every doctrine guard (honesty, WCAG contrast, plain voice, no-jargon)
stays — those are the brand moat, not negotiable.

## Decisions (owner-approved, council-refined)

- **One tab: "Optimize"** — rail shrinks **6 → 5** (Home · **Optimize** · Monitor · Blackbook · Advanced).
- **Three segmented peers:** **Fixes** (default) · **Applied** · **History** — the ledger is a
  top-level peer, not a bottom-of-page afterthought.
- **Persistent active-changes affordance** (council 🔴 First-Principles fix): an always-visible
  **`N active · undo` chip** in the Optimize header, present across all three segments — one glance to
  rollback from anywhere. **After applying a change, the tab lands on `Applied`** (council Contrarian:
  the panic-user must see undo, not "apply more").
- **Mutations stay confirm-gated** — bold V0 toggles must read as *deliberate, consequential actions*
  (they fire elevated, rollback-logged system changes), never as casual instant on/off switches. Reuse
  the existing `useConfirm` gate + the snapshot-before-mutate apply path. No change to the rollback
  contract.
- **Build the working shell FIRST** (council Executor), THEN V0 polish. No fan-out / styling /
  pattern-abstraction before a working flag-gated merged tab exists.
- **Flag-gated** `compy_optimize` (default OFF until verified) — old Check + Tune stay one toggle away;
  reversible + A/B-able. Flip ON only after the review stack + owner sign-off.

## Information architecture — what maps where

**Fixes** (default segment — the diagnose-and-act core, prioritized; the simplified forefront):
- Re-run check (the scan) · Gaming Mode (featured action) · the ranked **fixes** (today's Check
  limiters + Tune recommendations, unified — "worth doing for your rig", apply inline) · the named
  **drift card** ("turn it back on").
- *Below / collapsed (rich-but-not-cluttering):* driver + NIC freshness (advisory, copy-only URL),
  startup-load (with inline disable), upgrade-path advisory, "already fine" (collapsed).

**Applied** (Trust Ledger Layer 1): what Compy is doing right now — deduped, "active since",
confirm-gated one-tap rollback. The surfaced "past tweaks." Byte-identical rollback path.

**History** (Trust Ledger Layer 2): the full audit trail, rows expand for detail. **Designed to grow**
into a receipts surface (council Expansionist): each row reserves space for a future measured
before/after delta → shareable proof card. *Not built now; the layout accommodates it.*

## Styling — bold V0 reinvention, inside the guards

V0 drives the visual swing for this tab: a hololens **segmented control**, lively apply/undo controls
+ state transitions, a living background, animated segment switches. Process: generate candidates via
V0 → adapt to Compy's `--ix-*` tokens → pass ALL doctrine guards (contrast/voice/jargon/border) →
**self-review live (the law) + show the owner before commit**. Bold ≠ illegible or dishonest.

## Build sequence (flag-gated, reversible)

1. **Shell (no restyle):** `Optimize` tab behind `compy_optimize`, a segmented control rendering the
   EXISTING Check + Fix content verbatim under Fixes / Applied / History + the persistent `N active ·
   undo` chip + land-on-Applied-after-apply. **Verify:** flag flips the tab in/out; scan, apply,
   rollback, startup, gaming, drift all still work; rail shows 5 when on. Tests + tsc + cargo green.
2. **V0 styling:** the bold hololens reskin of the shell (segmented control, toggles, bg), adapted to
   tokens + guards, self-reviewed live.
3. **Integrate + repoint:** rail 6→5; repoint copy referencing the old tabs to "Optimize" (e.g. the
   readiness applied-changes reason now says "in Tune" → "in Optimize"; the `stale-reference-guard`
   list updates: "Optimize" is a CURRENT room again, drop it from the retired list); update setup-tour
   tab blurbs/ties; tests, doctrine guards, /check, /security, council review.

## Orchestration (how it's built)

In-session sub-agent fan-out via the **Workflow tool** (worktree-isolated where parallel), **CC as
manager/integrator** — owner stays in one session, approves at gates, makes taste calls. Crews:
shell-build, V0-styling, references/tests. **Review stack per phase:** self-review (hook-enforced) →
/check → /security → doctrine guards → council critic → full suite. **Council** reviews the build
before the flag flips.

## Reversibility & safety

`compy_optimize` default OFF; old Check + Tune untouched until flip. Rollback contract, elevation
boundary, locked gates (frozen beta refs, remote-fetch/updater, gaming gate), and beta-kit all
untouched. The merge is additive + flag-guarded — revert = flip the flag / drop the branch.

## Out of scope (future phases)

The other tabs' restructure (Home, Monitor, Blackbook, Advanced) — each gets its own spec → plan,
applying THIS proven pattern. The receipts/proof-card build on History. Any rail/IA change beyond the
6→5 shrink.

## Verification

Shell: toggle `compy_optimize` on/off → tab appears/disappears, rail 5↔6, both old surfaces still
reachable when off. On: each segment renders its content; apply a fix → lands on Applied + the chip
increments; undo → chip decrements; the drift card / startup / gaming all function; re-run check
scans. Styling: self-review at the owner's resolution + the contrast/voice guards green. Full
`tsc` + `vitest` + `cargo test` + `clippy` + `/check` + `/security`.

## Council strip — Optimize merge · 2026-06-21

- 🔴 First-Principles: buried ledger is IA, not layout → **persistent active-changes affordance**, not a
  deeper tab. *(Adopted: the chip + land-on-Applied.)*
- 🔴 Outsider: "Optimize" over-promises + "Active"="is it on?" → **segments renamed Fixes/Applied/History**,
  tab name kept (owner). *(Adopted.)*
- Contrarian: panic-user must hit undo → **land on Applied after apply + confirm-gate mutations.** *(Adopted.)*
- Expansionist: Applied/History → **receipts surface** (per-row deltas → proof cards). *(Accommodated in History layout; build later.)*
- Executor: **working shell first, then polish; don't pre-abstract.** *(Adopted as the build sequence.)*
- Chairman: structurally sound + reversible; the two flags are resolved by the chip + the renames + the
  shell-first sequence. Next move → writing-plans for the shell.
