# Intelligence Phase 2 — patterns, good-vs-bad, evidence graph (decision record)

**Status:** BUILT 2026-07-17 (`9c6af4b` backend · `094d834` frontend). **Provenance:** owner directive
`docs/reviews/2026-07-16-owner-directive-intelligence-platform.md` §6 (Cowork-lane artifact — executed
from, never committed). Continues [[2026-07-16-intelligence-foundation-train1]]. **Namespace law (§6):**
this lane is "Intelligence Phase N" in every doc/commit/report — bare "Phase N" belongs to Optimization
Cleanup (§0.11: that lane is untouched by this train).

**Scope (§6, verbatim):** richer root-cause graph · cross-session pattern detection · "good session vs
bad session" investigation workflow · external drift/change detection · hardware and software event
persistence improvements. **Still read-only:** no mutation-path change, no network/telemetry/capability
change, no ML, no numeric confidence (bands only: unknown/low/medium/high). Presentation stays plain
for the normal user; the detailed graph + investigator are Expert-view only (§4C).

## Architecture decisions

1. **Cross-session patterns live in a new `src-tauri/src/intelligence_patterns.rs`** — a pure evaluator
   over the sessions the machine already recorded (`sessions.json`), never a network or ML source. Six
   deterministic detectors: **trend** (1%-low drift across the game's session history) · **thermal**
   (recurring GPU-temp peaks) · **memory** (recurring RAM-pressure peaks) · **driver** (a GPU-driver
   change that lines up with a metric shift) · **mode** (Gaming-Mode-on vs -off outcome split) · **fade**
   (within-run degradation, e.g. late-session stutter). Each emits a plain-language finding + a confidence
   BAND + supporting evidence + "what would raise confidence". **Passive-observation cap at Medium** — a
   pattern read off records the user didn't design as an experiment never claims High (that band is
   reserved for Phase 3's controlled runs). New command `get_intelligence_patterns → PatternReport`.

2. **§0.12 coverage — silent detectors say WHY, never vanish.** `PatternReport` carries a coverage list:
   a detector that found nothing reports the reason (too few sessions, no thermal headroom data, single
   Gaming-Mode state, etc.). A detector never silently drops out of the report. Surfaced in the Expert
   view (`.bpt-coverage`).

3. **`what_changed_between` (the §4D workflow) added to `intelligence.rs`.** The Phase 1 engine compared
   a session against *its predecessor*; §4D's core question is "what changed between the last GOOD and
   the first BAD session", so the user must pick the two endpoints. New command takes
   `{baselineStartedAt, currentStartedAt}` and reuses the exact Phase 1 `WhatChangedReport` pipeline
   (same noise floor, same hypothesis catalog, same confounded-refusal) — no new measurement semantics,
   so no METHODOLOGY.md edit. Same-game, same-rig-preferred; mismatches are stated, never hidden.

4. **EvidenceGraph derivation (§4C) on `WhatChangedReport`.** An **inspectable re-projection** of the
   report the engine already produced — it adds **no new data**. Nodes are typed (symptom / metric /
   event / driver / os-update / compy-change / external-change / hypothesis / experiment / conclusion),
   each carrying its reliability band + a `source_reference` back to the record it came from. Edges are
   typed relations that **never assert causation**: `supports` · `correlates-with` (rendered "lines up
   with") · `occurred-before` · `requires-verification` · `ruled-out-by`. Empty graph ⇒ the block renders
   nothing (honest empty state). Expert-view only.

5. **External drift/change detection — `drift.rs` ingestion.** `drift.json`'s first-seen timestamps
   (readiness settings that reverted OUTSIDE Compy) become **observed** timeline events + a setting-drift
   hypothesis feeding the What-Changed engine. External changes are always tagged as external — never
   presented as Compy-applied (Phase 1 anti-fabrication guard extended to this source).

6. **Event-persistence honesty improvement — `AppliedChange.rolled_back_at`** (`history.rs`,
   `#[serde(default)]`, additive-only). Phase 1 recorded rollback only as a *status flip* with no date,
   so the timeline could not date an undo. This field is stamped at rollback-dispatch time and **NEVER
   retro-dated**: entries rolled back before the field existed stay `None` forever, and the timeline emits
   a dated rollback event ONLY when the stamp genuinely exists (otherwise the apply event keeps its
   "(since rolled back)" summary from Phase 1). Rollback LOGIC is unchanged — `resolve_rollback` still
   resolves from `history.json` alone; this is the ONLY mutation-boundary touch and it is a passive stamp.

## Mutation-gate posture

Read-only intelligence + one additive `#[serde(default)]` field. **No new mutating capability, no
elevation change, no `AppliedAction`/`RollbackAction`/`Snapshot` change, no capability/CSP diff.** The
rollback contract (apply-time capture · history-only resolution · dispatch totality · typed allowlist)
is untouched. `rust-tauri-reviewer` PASS on the full backend diff; the additive field was the reviewer's
only note (a types.ts mirror Nit), applied.

## UI (§4C / §5E — room ownership held)

- **Monitor owns "what happened":** `SessionDebrief` gains the **SessionInvestigator** (§4D) — pick two
  same-game sessions, Compare → `what_changed_between`, rendered through the existing
  `WhatChangedReportView`. Expert-view only (`compy_expert_view`); the plain view is unchanged.
- **Blackbook owns the historical record:** `PatternsTile` mounts above the record tape in the logbook
  face (self-contained fetch keeps the console zero-IPC). Renders nothing until there is an honest
  pattern to show. §5E: no fifth room — patterns are history, so they live here.
- **Evidence graph** renders inside the What-Changed panel's existing "Show the working" disclosure,
  Expert-view only. Normal users never see the graph (§4C: "The normal user view must remain plain-language").
- **Language (§7):** relation labels avoid causation ("lines up with", "Windows update"); unknown renders
  as unknown, never zero; confidence is always a word, never a score.

## Guards

Rust — `what_changed_between` guard tests (same-game requirement · confounded refusal · identical
sessions ⇒ no invented cause) · EvidenceGraph derivation tests (empty-report ⇒ empty graph · relation
typing · no fabricated nodes) · pattern-detector tests (passive cap at Medium · coverage-reason emission
· too-few-sessions honesty). TS — `evidence_graph` in the flag-off byte-identity fixture · patterns-tile
registered in the V2-CSS flag-off guard · confidence-pill (no side-stripe, border-hygiene-guard) ·
Expert-gating boundary. **cargo 787/787 · clippy clean · tsc exit 0 · vitest 1710/1710** (both counts UP).

## Cross-refs

Phase 3 (next train, FRESH session) = the user-started experiment engine (§4F): single-variable
attribution, baseline/treatment controls, keep/restore verdict workflow over the EXISTING mutation
contracts — that is where a confidence band may earn High. Optimization Cleanup stays a separate lane
(§0.11), untouched. No METHODOLOGY.md edit — this train reuses Phase 1's measurement rails verbatim.
