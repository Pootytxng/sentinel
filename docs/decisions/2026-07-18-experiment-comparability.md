# Decision — Where session-comparability applies, and why the controlled experiment doesn't use it

- **Date:** 2026-07-18
- **Status:** ACCEPTED (foundation + verdict-confidence band shipped in the F train; the §3 treatment-side game-match follow-up shipped 2026-07-18)
- **Scope:** Measurement Platform 2.0, Task F. Records the two DIFFERENT comparability questions Compy
  answers, which surfaces use which, and — the item this note exists to settle — why the **controlled
  experiment** (`ExperimentBench`) is gated by a purpose-built **verdict-confidence band**, NOT by
  `SessionComparability::derive`. Also records the one honest limitation this leaves open.
- **Related:** `src-tauri/src/comparability.rs` · `src-tauri/src/experiment.rs` · `docs/METHODOLOGY.md`
  · the capture/fingerprint foundation in `docs/decisions/2026-07-18-capture-backend.md` · LOCKED rule 3
  (rollback-first) and the no-arbitrary-numeric-confidence law in `CLAUDE.md`.

---

## 0. Two comparability questions, not one

Compy asks "can these numbers honestly be compared?" in two structurally different places, and they
need two different answers:

| | **Cross-session comparison** (What Changed, good-vs-bad investigator, export) | **Controlled experiment** (`ExperimentBench`) |
|---|---|---|
| Inputs | **Two saved sessions** captured at different times, under conditions that may have drifted | **One sitting**: a baseline capture and a treatment capture, back-to-back |
| What can differ | Game, rig, GPU, driver, resolution, refresh, graphics API, game build, Windows build, capture backend — any of it, silently | **Nothing but the single change under test** — same rig, same game, same session, same capture path, same noise floor, seconds apart |
| The honesty risk | Treating drifted context as "the same" and mis-attributing a delta | Too few frames, or a **confound** applied mid-run, making the single-variable claim untrue |
| The gate | `comparability::derive(a, b) → SessionComparability` | `experiment::verdict_confidence(...) → Confidence` band (shipped `19f9c4d`) |

`SessionComparability::derive` is built for the FIRST column: it composes `process_name` +
`hw_fingerprint` + `capture_capabilities` + `game_state` across two independent sessions and refuses to
call unrecorded conditions "equal." One caller today — `intelligence.rs:1467` (What Changed) — and the
good-vs-bad investigator + export methodology reuse that one derived struct rather than re-deriving.

## 1. Why the experiment does NOT take a `SessionComparability`

The controlled experiment's baseline and treatment are **not two sessions**. They are two capture
windows inside ONE sitting, on the same machine, running the same game, through the same ETW-DXGI
backend, held apart only by the single change being applied. Every axis `derive` exists to check —
game, GPU, driver, resolution, capture method — is **held constant by construction**. Feeding two
copies of the same context into `derive` would return `Comparable`/`High` every time and prove nothing;
it would be comparability theater.

The experiment's real risks are different, so its gate is different. `conclude_outcome` already enforces
the precedence **crash → insufficient-samples → `comparison::classify_with_guards`**, and the
verdict-confidence band (this train) reads the honest EVIDENCE QUALITY off that same outcome:

- **crash → High** — an unambiguous stability failure on this rig; the verdict does not rely on the fps
  reading at all.
- **insufficient samples (< `MIN_TREATMENT_SAMPLES` = 600) → Unknown** — "not enough comparable
  evidence," left honestly unjudged, change restored.
- **confounded / expired → Low** — a second change entered the Trust Ledger mid-run (watermark moved) or
  the window aged out, so it is no longer a clean single-variable comparison.
- **clean → Medium**, upgrading to **High** only when treatment samples ≥ 2× the minimum.

That band **is** the experiment's comparability analog: it is exactly the "can this honestly be
compared?" question, scoped to the one thing that can go wrong intra-session (sample sufficiency +
confound state) instead of the cross-session drift `derive` guards. It is a band, never a number
(guard: `no_verdict_note_ever_carries_a_numeric_confidence`), same as `confidence_limit`.

## 2. Controlled-experiment ELIGIBILITY is the simulator, not comparability

"Which changes are even eligible to be tested?" is answered upstream of any comparability question, by
`experiment::simulate(&SimContext) → SimulatorReport` (safety-first precedence: **barred →
not-applicable → already-configured → estimate band**):

1. **barred** — on the permanent safety/anti-cheat blocklist (LOCKED rule 6) ⇒ never a testable
   candidate, regardless of measured benefit.
2. **not-applicable** — `!history::is_appliable` (advisory-only recs like an SSD upgrade) or the
   hardware doesn't match ⇒ nothing to apply, so nothing to test.
3. **already-configured** — active in the Trust Ledger ⇒ already in the target state.
4. otherwise an honest estimate band (`worth-testing` / `plausible-unproven` / `unlikely-to-matter`,
   never a number).

Eligibility is a property of the **change and the rig**, decided before a baseline is ever captured. It
is not a two-session comparison and correctly does not touch `comparability.rs`. The confound + sample
gate (§1) then governs whether the *result* of a run may be trusted. There is no third gate to add.

## 3. The limitation this train left open — now CLOSED (follow-up shipped 2026-07-18)

**V1 gap (as-shipped in the F train):** the experiment captured a `GameStateFingerprint` at **baseline**
but did not re-capture and diff the game/process on the **treatment** side. So if the user quit the game
and launched a *different* one between baseline and treatment, the stored record could not detect it —
the single-variable assumption would be violated in a way the data couldn't catch. In practice the
orchestrator keeps the run bound to one sitting and a confound there moves the ledger watermark (→
`confounded`/Low) far more often than not, but the game-swap case specifically was **not provably
excluded from stored data**.

**Follow-up (shipped this session, additive, read-only advisory):** `conclude_experiment` now accepts an
optional `treatment_game: Option<String>` — the process name the treatment session actually measured —
and `conclude_outcome` runs a pure `game_match(baseline, treatment) → GameMatch` equality check
(`trim` + `eq_ignore_ascii_case`; either side blank/absent ⇒ `Unverified`, two known-unequal ⇒
`Mismatch`) at **top precedence, before the crash and sample checks**. On a `Mismatch` the run concludes
`not-comparable`, restores the change (`keep = false`), and reports **Unknown** confidence with the
plain-English note that a different game was measured — "not enough comparable evidence to judge." On
`Match` the note earns the stronger "on the same rig and game" phrasing; on `Unverified` it holds at "on
the same rig" and makes no same-game claim. This is **defense-in-depth**: the frontend `treatmentFor()`
still filters treatment sessions to the baseline's game, but the backend no longer *trusts* that filter —
same posture as the existing `MAX_TEXT_LEN` webview-trust-boundary comment. It changes only what
confidence to REPORT (advisory), touches no apply/rollback mutation primitive, and adds no network or
gate surface. Guards: `game_match_classifies_conservatively`,
`a_different_treatment_game_is_not_comparable_and_restores`, `game_mismatch_takes_precedence_over_crash`,
`a_verified_same_game_keeps_the_normal_verdict_and_claims_same_game`,
`an_unverified_game_proceeds_but_drops_the_same_game_claim`, plus the `not-comparable` case added to
`no_verdict_note_ever_carries_a_numeric_confidence` and a frontend render guard in
`ExperimentBench.test.tsx`. Because the live UI's same-game filter makes the `not-comparable` verdict
unreachable in-app, that label's rendering is proven by the vitest render guard rather than a live
capture.

## 4. Decision

1. **Keep the two gates separate.** `SessionComparability::derive` governs cross-session surfaces; the
   experiment keeps its purpose-built verdict-confidence band. Do not force `derive` onto the experiment.
2. **Eligibility stays the simulator** (`simulate`/`SimContext`) — barred/not-applicable/already-
   configured/estimate — not a comparability check.
3. **Close the treatment-side game-match gap** with a backend equality check (shipped 2026-07-18, §3):
   the experiment now re-verifies the treatment game against the baseline and drops to `not-comparable`
   /Unknown + restore on mismatch — never a silent assumption of "same game."
