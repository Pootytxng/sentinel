# Decision — the "Prove a change" overlap: two surfaces, one vocabulary, no merge

- **Date:** 2026-07-18
- **Status:** ACCEPTED (safe-additive consolidation shipped this train; reshapes deferred to BACKLOG /
  owner)
- **Scope:** Measurement Platform 2.0, Task B. Compy now has **two** places a user can "prove a change
  helped." This records the surface inventory, the verdict that they are **complementary layers, not a
  redundancy to merge**, the preferred consumer model, and the split between what was safe to
  consolidate now vs. what is a reshape that needs the owner.
- **Related:** `src-tauri/src/experiment.rs` · `src-tauri/src/comparability.rs` ·
  `src-tauri/src/intelligence.rs` · `src/surfaces/ExperimentBench.tsx` ·
  `src/surfaces/WhatChangedPanel.tsx` · `docs/decisions/2026-07-18-experiment-comparability.md`
  (the two-gate split this builds on) · `docs/METHODOLOGY.md` §5.

---

## 0. The overlap, stated plainly

Two surfaces answer a question that *sounds* like the same question:

| | **Controlled experiment** — `ExperimentBench` (Lab) | **What Changed** — `WhatChangedPanel` / SessionInvestigator |
|---|---|---|
| Consumer verb | **"Prove a change"** — actively test one thing | **"What changed?"** — explain a difference after the fact |
| Direction | *Prospective*: apply the change, measure baseline→treatment in one sitting | *Retrospective*: two sessions already happened; what moved and why |
| Evidence basis | Two capture windows, single sitting, single variable held by construction | Two saved sessions whose context may have drifted |
| Honesty gate | `experiment::verdict_confidence` band (sample sufficiency + confound) | `comparability::derive → SessionComparability` |
| Failure this guards | Too few frames / a confound mid-run | Drifted context mis-read as "the same" |

The literal phrase "Prove a change" already lives on the experiment funnel copy
(`src/surfaces/lab-guided-data.ts:61` — *"Prove a change actually helped — not a placebo."*). The
retrospective surface deliberately keeps the **"What changed?"** verb. That vocabulary split is the
product's way of telling the two apart, and it is correct.

## 1. Verdict — complementary layers, do NOT merge

The temptation is to fold the retrospective "What changed?" into the experiment as one "prove a change"
room. That would be wrong:

- **Different inputs.** The experiment owns its sitting; What-Changed reads sessions it never
  controlled. A merge would either force the experiment to accept drifted two-session inputs (breaking
  its single-variable guarantee) or force What-Changed to demand a controlled sitting it can't produce
  from history.
- **Different gates for different failure modes** (§0 table, and the two-gate decision in
  `2026-07-18-experiment-comparability.md`). Collapsing the surfaces would pressure the two gates toward
  one, and the one gate would be wrong for one of them.
- **Complementary, not duplicative, in the UI.** They now share the *render* (`WhatChangedReportView`)
  and the *comparability vocabulary*, but stay distinct rooms: the Lab's active bench vs. the passive
  for-this-session / investigator panels.

So: **keep both surfaces; unify their language and shared plumbing; do not merge the flows.** This is the
Task G routing conclusion too (no fifth room — unambiguous routing over shared domain plumbing).

## 2. Preferred consumer model

- **"Prove a change"** = the *active* verb, reserved for the controlled experiment (you do a thing, it
  measures). This is the headline funnel for a user who wants a yes/no on one tweak.
- **"What changed?"** = the *passive* verb, for the retrospective comparison (something already differs;
  here's the honest read on whether the two are even comparable, and the leading explanation).
- Both speak the **same comparability vocabulary** now that Task G surfaced `SessionComparability` in the
  shared render: *Directly comparable / Direct comparison is limited / Not directly comparable / Not
  enough comparable evidence*, bands never numbers, missing stays unknown. A user who learns the words in
  one surface reads the other for free.

## 3. Safe-additive consolidation — DONE this train

- **`MIN_COMPARE_SAMPLES` de-duplicated.** The minimum-samples-to-compare threshold was declared in two
  places. It is now a single `pub(crate) const MIN_COMPARE_SAMPLES: u32 = 60` in `intelligence.rs:992`,
  **imported** (not re-declared) by `intelligence_patterns.rs:25`. Same value, one source; a future
  change can't drift the two. Purely additive, no behavior change — verified `cargo test` (849 passed) +
  `clippy` clean.

## 4. Deliberately NOT consolidated (would be wrong)

- **The three noise-floor checks stay independent** (`METHODOLOGY.md` §5): component/hardware (flat 3%,
  widening to 8% on low-confidence), live in-game trial (self-calibrating to the rig's own variance,
  never below 3%, plus a 2,000-resample bootstrap CI excluding zero), and cross-session (flat 3% on the
  1%-low). They *look* like "three 3% constants to merge," but they answer three different questions on
  three different data shapes. Collapsing them to one constant would silently change the bar on two
  surfaces. Left separate on purpose; recorded so a future audit doesn't re-flag them as duplication.

## 5. Reshapes deferred — BACKLOG / owner territory (no welfare check triggered)

None of the below was needed to ship the surfacing, so no reshape of a core element occurred → no
welfare check. They are logged in `docs/BACKLOG.md` as additive follow-ups:

1. **`next_test` → experiment structured routing.** A hypothesis's suggested next test is **free prose**
   (`next_action` / `next_test` strings) with no machine-readable rec-id. Auto-routing "the supported
   next test" into a pre-loaded `ExperimentBench` pick would require *fabricating* a mapping from prose
   to a catalog rec — a no-fabrication violation. Deferred until the hypothesis engine can emit a real,
   optional rec-id where (and only where) a safe mapping provably exists. Until then the connection stays
   a plain-language instruction, not a wired button.
2. **Vocabulary *display* convergence.** The two surfaces now share the comparability words at the domain
   level; a later pass could unify their visual chrome (badges, section labels) into one shared component
   vocabulary. Cosmetic, deferred.
3. **Any "prove a change" room reshape** (merging/renaming the surfaces themselves) is a core-element
   reshape and therefore **owner territory** — not to be done autonomously. Recorded here so the option
   is visible, not silently dropped.

## 6. Decision

1. **Keep both surfaces**, complementary not redundant; unify vocabulary + shared render, never the flow.
2. **"Prove a change"** stays the active experiment verb; **"What changed?"** the retrospective one.
3. **Ship** the `MIN_COMPARE_SAMPLES` de-dup (done); **keep** the three noise floors independent (§5).
4. **Defer** the `next_test`→experiment wiring (no-fabrication), vocabulary chrome convergence, and any
   surface-level reshape (owner territory) — all logged in `docs/BACKLOG.md`.
