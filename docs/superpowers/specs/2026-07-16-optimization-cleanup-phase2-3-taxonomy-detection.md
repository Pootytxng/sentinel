# Optimization Cleanup — Phase 2 (taxonomy) + Phase 3 (detection scope) design spec

**Provenance:** extends `2026-07-16-optimization-cleanup-research-spec.md` (stage-1 research, same
train). Owner GO for this prep stage given 2026-07-16 ("you have my go if it's what you recommend"),
explicitly scoped to spec/doc work that cannot conflict with the concurrent Phase 1 lane (gate flip +
owner-present UAC QA — CC's lane, untouched here). **This document authorizes no build.** Phase 2/3
implementation still rides scope-gate, and anything mutation-adjacent rides mutation-gate.

**Grounding:** all claims below verified against current code 2026-07-16 (`leftovers.rs`,
`actions.rs:3645+`, `src/data/knowledge.ts`, `src/data/verdict-glossary.ts`, `src/data/tweaks.json`,
`scripts/lib/library-render.mjs`). File:line cites are point-in-time; re-verify before building.

---

## Phase 2 — the taxonomy

### The design problem the panel phrasing hides

The review asks for **useful / placebo / risky / outdated / unknown**. But Compy already ships a
grading vocabulary with public definitions the brand is built on:

- `TweakVerdict = "real" | "placebo" | "risky"` (`knowledge.ts:100`), defined for users in
  `verdict-glossary.ts` and used verbatim across the app, the Blackbook, and every public site page
  ("— real, placebo, or risky?" is literally in the site's page titles).
- An orthogonal **lifecycle** axis: `status?: "deprecated" | "superseded"` on library entries —
  explicitly freshness metadata, never a verdict.

Adopting the panel's five buckets as a new enum would create a second, conflicting grading language
("useful" vs "real"; "outdated" as a verdict when the app treats staleness as lifecycle). One Reddit
thread noticing that Compy grades the same tweak "placebo" in the Blackbook and "outdated" in
Cleanup is exactly the brand damage the gates exist to prevent.

### Recommended design: reuse the verdict axis, add two orthogonal fields

A cleanup **finding classification** is three orthogonal facts, not one five-way enum:

```
verdict:    TweakVerdict          — real | placebo | risky   (REUSED, same glossary, same chips)
freshness:  Fresh | Stale         — Stale = the problem this tweak solved no longer exists on
                                     current Windows (maps to the panel's "outdated"; rendering
                                     mirrors the library's deprecated/superseded treatment)
confidence: Identified | Unknown  — Unknown = the artifact is present but matches no catalog
                                     entry, or its probe was unreadable (maps to the panel's
                                     "unknown"; leftovers.rs already reports unreadable probes
                                     honestly rather than silently-clean — same law)
```

Panel-bucket mapping: useful→`real`, placebo→`placebo`, risky→`risky`, outdated→`Stale` (on any
verdict), unknown→`Unknown` (no verdict asserted at all — a verdict without identification would be
a guess wearing a claim's clothes). Every one of the panel's five words survives; none of them
forks the public vocabulary.

**Consequence worth stating plainly:** a finding can be *risky AND stale* (bcdedit timer flags: they
fight the modern scheduler AND the guides predate it). The single five-bucket enum can't express
that; three axes can, and the UI can render it in one plain sentence.

### The wiring gap that makes Phase 2 cheap: `matched_tweak` → library id

Today `matched_tweak` is a hand-written string, not a reference (`leftovers.rs:24-42`). But **5 of
the 9 detectors already have a 1:1 graded library entry** sitting unlinked in `tweaks.json`:

| detector | existing library id | library verdict |
|---|---|---|
| `pagefile-fixed` | `pagefile-disable` | risky |
| `bcdedit-timer-flags` | `useplatformclock` | risky |
| `defender-policy-off` | `disable-defender` | risky |
| `tcp-autotuning-off` | `tcp-mega-packs` | placebo |
| `core-parking-forced` | `core-unparking` | placebo |

Phase 2's core build is therefore: add an optional `library_id` field to the detector table (or a
central map, matching the `APPLIES_BY_ID` pattern already used for hardware tags), inherit
`TweakVerdict` from the library entry, add a lint that every `library_id` resolves (the repo already
has this lint pattern for topics/dates), and author the 4 missing library entries
(`memory-compression-off`, `mmcss-tampering`, `mpo-disabled`, `win32-priority-separation` have no
library twin yet — a small content task with existing schema). This makes the Blackbook and Cleanup
provably incapable of disagreeing, because they'd share one source.

`freshness` starts as a per-catalog-entry static field (each of the 9 is easily judged from its own
existing verdict text — e.g. tcp-autotuning "solved a Vista-era problem" is Stale on its face).
`confidence` falls out of existing behavior: catalog match = Identified, unreadable probe or
(Phase 3) unmatched artifact = Unknown.

**Kept as-is, deliberately:** `uncertain_source: true` on every finding (origin is unprovable — "if
you set this on purpose, keep it" stays law, guarded by the existing
`law_every_finding_admits_origin_uncertainty` test) and the unused `endorsed_by` gate (rule #7).
The taxonomy classifies the *artifact*, never the *user's intent*.

### Phase 2 non-goals

No mutation surface, no new probes, no restore logic — classification/presentation only, over the
existing 9 detectors. Backward-compat: `Leftover.verdict` (the free-text hardware-aware sentence)
stays; the typed classification is additive alongside it, not a replacement for the plain-English
verdict the panel praised.

---

## Phase 3 — broader detection, scoped as a closed catalog

### The rule that keeps this safe

`leftovers.rs`'s own charter is the whole design: **closed catalog only, no heuristics, "nothing
found" is first-class, unreadable is reported not guessed.** Phase 3 adds named, individually
reviewed detectors — it is NOT a scanner. A generic "find suspicious registry keys" heuristic is
how this feature becomes the snake oil it audits; that direction should be refused at scope-gate if
it ever comes up.

### Candidate detector waves (each detector = its own review, like the original 9)

**Wave 1 — same probe machinery as today (registry/powercfg/netsh reads), highest confidence:**
1. Win32 `TimerResolution` persistent-forcing services (guide-era 0.5ms timer tools that install a
   service; detectable by known service names — closed list).
2. `SystemProfile` "gaming tweaks" registry packs beyond MMCSS (e.g. `GPU Priority`/`Priority`
   values under the Games task key — stock values documented).
3. Power-plan residue: imported "ultimate gaming" custom plans left active with pathological
   settings (min processor state 100% on battery, USB selective suspend forced off) — detect only
   named, documented-stock deviations.
4. `Win32PrioritySeparation` exotic values beyond the current !=2 check already covered — no new
   detector needed, noted for completeness.

**Wave 2 — new probe machinery (scheduled tasks / services), medium effort:**
5. Known tweak-tool scheduled tasks left behind (closed list of task names/paths from named tools).
6. Services set to Disabled that stock Windows ships Manual/Automatic — ONLY from a curated list of
   services debloat packs commonly kill (SysMain, DiagTrack is deliberate-tradeoff territory —
   each entry needs the endorsed-by/deliberate-choice treatment; several are legitimate choices,
   which is what `uncertain_source` and a `real`-verdict classification exist for).
7. Hosts-file telemetry-blocklist residue (breaks store/update flows; detectable by known block
   patterns; restore = "here's the file, here's what stock looks like" — likely advisory-only
   forever given user-content risk).

**Wave 3 — attribution to named tools (the INTAKE.md list: WinUtil, Win11Debloat, O&O ShutUp,
Razer Cortex, etc.):** currently ZERO named-tool wiring exists anywhere in detection (verified —
names appear only in positioning docs). Attribution by name is high brand-risk (the doctrine's own
rule: never libel a named product without receipts) and should be a separate owner decision.
Default recommendation: detect the *artifact*, name the *pattern* ("a debloat-script residue"),
skip the brand name. Wave 3 may never ship, and that's fine.

### Restore posture for Phase 3 findings (constraint, not design)

Every Wave 1-2 candidate defaults to **advisory-only** (the generalized refusal pattern from the
stage-1 spec: "here's the real Windows location"). A Phase 3 detector earns an auto-restore path
only individually, only where the documented-stock state is unambiguous, only through mutation-gate
— same bar the original 7 resolvers cleared. Defender/bcdedit-class exclusions (security rail,
boot-store blast radius) apply to Phase 3 exactly as they do today; a scheduled-task or service
restore that touches the security surface inherits the same owner-gate.

### Dependency note

Phase 3 detection lands findings with `confidence: Unknown` or thin catalog matches unless Phase 2's
classification fields exist first — build order is 2 then 3, as the stage-1 spec already proposed.

---

## Open items for scope-gate (the decisions this spec does NOT make)

1. Phase 2 field names/rendering (`freshness`/`confidence` naming is proposal, not decree — owner
   taste applies to user-facing words; the glossary would gain two entries).
2. The 4 missing library entries' content (small, but they're public Blackbook material → normal
   content review).
3. Wave ordering within Phase 3, and whether Wave 3 (named-tool attribution) is ever in scope.
4. Unchanged from stage-1: the Trust-Ledger-vs-separate-mechanism fork — owned by the Phase 1
   lane; nothing in this doc depends on its outcome.
