# OWNER DIRECTIVE — Compy Intelligence Platform (approved direction, begin implementing)

> **PRODUCT DIRECTION SUPERSEDED 2026-09-04 (#369).** The “begin implementing” instruction and
> priority override below are historical and no longer executable. Current product identity and
> direction come from `docs/PRODUCT_CONSTITUTION.md`; product sequence derives through
> `docs/product/ROADMAP.md`, and implementation ownership comes only from `docs/WORK_CONTROL.md`.
> The original owner reasoning is preserved as history, not as a route around the Constitution.
>
> **Provenance:** owner-authored directive, 2026-07-16, reviewed and finalized with Cowork the same
> day. Cowork's edits vs. the owner's draft (all owner-approved): fixed one wrong filename in the
> read order, added the lane-separation rule (§0.11), namespaced the phase numbering (§6), added
> the priority-override clause (§0.12), and added §9 (cross-references to already-tracked work so
> nothing gets double-tracked or silently dropped). Everything else is the owner's text, verbatim
> in substance.
>
> **To the executing session:** this is not an exploratory brainstorm. Treat the direction below as
> approved and begin implementing the foundation immediately. Do not spend the session restating
> the concept, generating options, or producing a theoretical roadmap.

You are beginning a major, owner-approved product direction for Compy.

The objective is to evolve Compy from a "safe PC optimizer" into the first consumer-facing Windows
gaming performance intelligence platform: a PC flight recorder, diagnostic doctor, controlled
proving ground, and exact rollback system that determines what changed, identifies the most likely
cause of a problem, recommends the next test or action, proves whether it helped, and remembers the
machine's history.

Compy should stop competing primarily on tweak count. Its defensible category is:
**"Evidence-based PC performance intelligence."**

Its consumer-facing promise is: **"Compy finds what is actually affecting your gaming PC, safely
tests what can be changed, proves whether it helped, and can always put things back."**

────────────────────────────────────────────────────────
## 0. CURRENT SOURCE OF TRUTH
────────────────────────────────────────────────────────

Before changing anything:

1. Verify the current branch, HEAD, worktree status, and current date.
2. Read, in this order:
   - `CLAUDE.md`
   - `docs/RELEASE_STATE.md`
   - `docs/BACKLOG.md`
   - `docs/RECEIPTS_DOCTRINE.md`
   - `docs/ARCHITECTURE_LOCKS.md`
   - `docs/OWNER_ACTION_CHECKLIST.md`
   - `docs/UI_VISION_BACKLOG.md` (this train adds UI surfaces — the 🔴 OPEN section applies)
   - `PRODUCT.md`
   - `DESIGN.md`
3. Treat `docs/RELEASE_STATE.md` as authoritative wherever older documentation conflicts.
4. Inspect the current implementation rather than relying on stale banners, old plans, or the
   previously shared external review.
5. Verify the current default UI and current feature gates from source.
6. Do not restart completed work.
7. Do not alter frozen beta references.
8. Do not modify or weaken any security, UAC, Defender, firewall, CSP, signing, remote-fetch,
   telemetry, updater, or release gate.
9. Do not ship anything to another person's machine.
10. Do not modify public website claims during this first implementation train unless a directly
    introduced contradiction makes a correction unavoidable.
11. **LANE SEPARATION — Optimization Cleanup is a different train.** The Optimization Cleanup lane
    (Phase 0 shipped `55f68b6`; Phase 1 = restore-gate flip + owner-present live-UAC QA, owner-
    greenlit; Phase 2/3 spec'd at `docs/superpowers/specs/2026-07-16-optimization-cleanup-*.md`)
    runs on its own mutation-gate discipline and its own session(s). Do NOT fold it into this
    train, and do NOT let this train's "no mutation changes" rule stall or reinterpret that lane —
    they are separate mandates. If Cleanup Phase 1 is incomplete when this train starts, leave it
    exactly where it is and note it in the report.
12. **PRIORITY OVERRIDE.** This direction supersedes backlog priority ordering. Anything queued in
    `docs/BACKLOG.md` that neither feeds nor serves the intelligence platform gets FLAGGED for
    demotion in the backlog (with one line of reasoning), not silently worked on and not silently
    deleted. The owner reviews demotion flags; nothing is dropped without a trace.

Current expected product structure, to verify rather than blindly assume: Tauri 2 application ·
Rust backend · React/TypeScript frontend · Home · Monitor · Blackbook · Lab · Gaming Mode live and
field-QA complete · Trust Ledger and rollback contracts · session summaries and persisted FPS
series · benchmark/comparison infrastructure · latency diagnostics · Black Box/crash diagnostics ·
hardware detection · local-first current operation · zero outbound behavior until separately
approved gates are crossed.

────────────────────────────────────────────────────────
## 1. NON-NEGOTIABLE PRODUCT LAWS
────────────────────────────────────────────────────────

The following remain mandatory:

- No kernel driver.
- No game injection.
- No fabricated measurements.
- No fake confidence percentages.
- No invented cause-and-effect claims.
- No generic "AI optimizer" language.
- No chatbot pretending to understand evidence it does not possess.
- No mutation without a complete rollback contract.
- No mutation changes in the first intelligence-foundation train unless strictly necessary and
  separately justified.
- No telemetry, network request, account, remote rule, cloud processing, or external API.
- No silent background experimentation.
- No unattended system changes.
- No weakening Windows security.
- No raw registry-key dumping in the normal consumer view.
- No universal "optimization score."
- No meaningless 0–100 health score.
- No recommendation merely because a setting can be changed.
- No affiliate or upgrade recommendation without evidence.
- Missing evidence must render as unknown, not zero.
- Correlation must not be presented as proven causation.
- Every conclusion must show why Compy believes it.
- Every conclusion must show what evidence is missing.
- Every conclusion must provide a next verification step where uncertainty remains.

Initial intelligence must be deterministic, inspectable, testable, and local. Do not market basic
heuristics as machine learning. Use statistical or rule-based reasoning first. Machine learning may
be considered later only when enough real, consented, labeled data exists.

────────────────────────────────────────────────────────
## 2. THE PRODUCT CATEGORY
────────────────────────────────────────────────────────

Compy is no longer primarily: a Windows tweak menu · a game booster · a cleanup utility · a
hardware monitor · a benchmark viewer · a process manager.

It combines pieces of those products, but the category to establish is:
**"Performance intelligence for gaming PCs."**

The model is closer to a doctor:

SYMPTOM → OBSERVATIONS → POSSIBLE CAUSES → SUPPORTING EVIDENCE → CONTRADICTING EVIDENCE →
CONFIDENCE → NEXT TEST → PRESCRIPTION → BEFORE/AFTER RESULT → RESTORE OR KEEP → LONG-TERM MEMORY

The system should answer questions such as:

- Why did my FPS drop?
- Why are my 1% lows getting worse?
- Why does the game degrade after forty minutes?
- What changed since the last good session?
- Is this a GPU, CPU, RAM, storage, driver, background-process, thermal, or network issue?
- Did this Windows update or driver update correlate with the regression?
- Did Gaming Mode help?
- Did a tweak help beyond normal run-to-run variation?
- Is my hardware degrading?
- Do I actually need an upgrade?
- Which upgrade would address the measured limiter?
- Should I buy nothing?

────────────────────────────────────────────────────────
## 3. COMPETITIVE POSITIONING TO BEAT
────────────────────────────────────────────────────────

Do not copy competitor interfaces or marketing. Understand the capability gaps Compy must close.

**Microsoft PC Manager** — Advantage: Microsoft trust and simplicity. Weakness: shallow gaming
diagnosis. Compy must remain understandable while going substantially deeper.

**Razer Cortex and similar game boosters** — Advantage: recognizable brand and one-click game
preparation. Weakness: limited evidence, limited attribution, little proof. Compy must show exactly
what changed and whether it mattered.

**Process Lasso** — Advantage: deep scheduling and process control. Weakness: technical complexity
and weak consumer interpretation. Compy must convert complex system behavior into clear user
decisions.

**CapFrameX and PresentMon-based tools** — Advantage: strong measurement and benchmark analysis.
Weakness: they generally stop at charts. Compy must translate measurements into evidence-backed
diagnosis and action.

**HWiNFO** — Advantage: extensive telemetry. Weakness: overwhelming, primarily descriptive rather
than prescriptive. Compy must show only the data that affects a decision.

**LatencyMon** — Advantage: DPC/ISR and latency visibility. Weakness: expert-oriented conclusions
and high false-interpretation risk. Compy must translate latency evidence cautiously and explain
uncertainty.

**WinUtil, Wintoys, and Windows tweak utilities** — Advantage: breadth and accessibility. Weakness:
settings collections are not controlled experiments. Compy must recommend fewer things and prove
them.

**Hone and competitive-tuning products** — Advantage: aggressive gaming positioning and preset
convenience. Weakness: generic or weakly attributable gains. Compy must own per-rig proof.

**AtlasOS and modified-Windows projects** — Advantage: radical system transformation. Weakness:
high blast radius and difficult restoration. Compy must provide meaningful gains without replacing
or destabilizing Windows.

Compy wins through the combination no competitor currently owns: per-rig hardware understanding ·
real session history · before/after measurement · explicit uncertainty · root-cause reasoning ·
exact rollback · local-first operation · evidence-backed upgrade advice · public debunking through
the Blackbook.

────────────────────────────────────────────────────────
## 4. COMPLETE PRODUCT VISION
────────────────────────────────────────────────────────

The complete direction contains the following systems. Do not attempt to blindly build all of them
in one unbounded commit. Establish one coherent architecture, implement the first useful vertical
slice immediately, and convert later systems into explicit sequenced work.

### A. COMPY INTELLIGENCE

This is the central reasoning layer. It is not a conversational AI wrapper. It is a local evidence
engine that combines: hardware identity · hardware changes · Windows version and updates · GPU
driver identity and date · BIOS/firmware identity where safely readable · active power state ·
Compy Trust Ledger history · Gaming Mode sessions · benchmark results · comparison results ·
persisted FPS series · frametime behavior · GPU telemetry · memory pressure · latency diagnostics ·
Black Box findings · process events · startup changes · game identity · crash/interruption history ·
external drift in Compy-managed settings · prior diagnoses · prior experiments · restore results.

It should produce: likely causes · confidence level · supporting evidence · contradicting evidence ·
unknowns · recommended next test · safe action where justified · evidence after action · final
conclusion.

Example: *"Marvel Rivals performance declined after the GPU driver changed. Average FPS is similar,
but the 1% low fell across three sessions. GPU utilization remained near the previous range while
CPU frametime variance increased. Driver regression is the leading hypothesis. Confidence: medium.
Recommended next step: run one controlled comparison before changing anything."*

### B. CONFIDENCE ENGINE

Every diagnosis must carry calibrated uncertainty. Initial version: **Unknown · Low confidence ·
Medium confidence · High confidence.**

A numerical percentage may only be shown when the score has a documented, calibrated meaning. Do
not display arbitrary values such as "92% GPU bottleneck" because a heuristic happened to add up
to 92.

Internally, confidence may be derived from: number of independent supporting signals · signal
reliability · sample count · repeatability · temporal proximity · comparison quality ·
contradictory evidence · missing evidence · whether one or multiple variables changed · whether the
result cleared the measured noise floor · whether the same pattern occurred across multiple
sessions.

Every result should expose: why this confidence level was assigned · what would increase
confidence · what evidence argues against the conclusion.

### C. ROOT CAUSE GRAPH

Represent diagnosis as an inspectable evidence graph.

Possible node types: symptom · metric · event · hardware component · process · driver ·
operating-system update · Compy change · external change · hypothesis · experiment · conclusion ·
prescription.

Possible edge types: occurred before · correlates with · supports · contradicts · affects ·
measured during · changed after · restored by · requires verification · ruled out by.

Example: FPS instability → observed during Marvel Rivals → began after GPU driver update →
supported by three lower 1% low sessions → contradicted by stable GPU utilization → alternative
hypothesis: CPU scheduling variance → next test: controlled driver or Gaming Mode comparison.

The normal user view must remain plain-language. An Expert view may expose the detailed graph.

### D. TIMELINE INTELLIGENCE / "WHAT CHANGED?"

Build a canonical local timeline.

Potential read-only events: Compy applied a change · Compy restored a change · Gaming Mode
started · Gaming Mode stopped · Gaming Mode recovered after interruption · game session started and
ended · benchmark recorded · comparison completed · crash or abnormal termination detected · GPU
driver changed · Windows build changed · Windows update installed · BIOS version changed · detected
hardware changed · display refresh rate changed · startup configuration changed · power plan
changed · Compy-managed value changed outside Compy · application or overlay environment materially
changed where safely detectable.

The core user-facing question: **"What changed between the last good session and the first bad
session?"**

Output: 1. Ranked changes · 2. Temporal relationship · 3. Supporting evidence · 4. Confidence ·
5. Next test.

### E. PATTERN DETECTION

Analyze repeated local sessions for patterns such as: performance degradation over time · GPU
memory growth · memory pressure growth · thermal drift · periodic stutters · recurring process
spikes · driver-version regressions · Windows-update regressions · frame-pacing instability ·
session-length-dependent problems · first-session versus later-session differences · performance
recovery after restart · background-process correlation · crash recurrence · changes isolated to
one game · changes affecting multiple games.

Examples:
*"Frame pacing becomes unstable after approximately 38–45 minutes in four of five sessions."*
*"GPU memory usage rises throughout the session and does not stabilize."*
*"Stutter events cluster shortly after a new area or asset set loads. Shader or traversal behavior
is more likely than a system-wide bottleneck."*

Use transparent deterministic detection first: slopes · rolling averages · change points ·
variance · periodicity · event co-occurrence · confidence intervals · noise-floor comparison ·
minimum sample and session thresholds.

### F. AUTOMATIC EXPERIMENT ENGINE

The Lab should eventually support a user-started controlled experiment.

Workflow: 1. Capture baseline. 2. Confirm the exact variable to test. 3. Snapshot the current
state. 4. Apply one reversible change. 5. Run or record the treatment session. 6. Compare against
the noise floor. 7. Restore automatically if the result regressed or remained unsupported, subject
to existing owner-approved product law. 8. Keep only when the evidence justifies it. 9. Record the
full experiment in the Trust Ledger and knowledge graph.

Safety requirements: one attributable variable at a time by default · explicitly warn when multiple
changes are active · never imply attribution when variables are combined · stop on failed snapshot ·
stop on failed apply · stop on failed telemetry · stop on insufficient samples · stop on crash ·
stop on restore failure · never hide partial success · never continue unattended after an error ·
never start without explicit user action · use existing audited mutation boundaries rather than
inventing a new path.

Example output — for this rig and this game: Gaming Mode: improved 1% low beyond noise · Game Bar
setting: no measurable change · Power-plan change: likely contributor, attribution incomplete · USB
sleep setting: insufficient evidence · unsafe internet timer tweak: refused.

### G. OPTIMIZATION SIMULATOR

Before applying a change, estimate whether it is worth testing. This is not a promise of gain.

Possible outputs: Unlikely to matter on this rig · Plausible, but unproven · Worth a controlled
test · Already configured · Not applicable · Risk exceeds likely value · Insufficient evidence.

The simulator should explain: why the setting is or is not relevant · which detected hardware or
state affects the decision · what metric should move if the theory is correct · what result would
disprove it.

### H. HARDWARE TWIN

Expand the current hardware hologram into a meaningful digital twin. Every visible component should
eventually act as an index into: detected identity · current telemetry · historical telemetry ·
known issues · related sessions · active hypotheses · health trends · relevant actions · upgrade
relevance.

Potential components: GPU · CPU · RAM · storage · motherboard · network adapter · display ·
cooling · power delivery where safely inferable.

Every highlight or animation must communicate real state. No decorative component glow without
meaning.

Examples: RAM highlights because memory pressure correlates with the issue · GPU highlights because
it is saturated during the measured dips · storage highlights because I/O events align with stutter
clusters · network adapter highlights because latency spikes correlate with packet events · a
component stays neutral when evidence is absent.

### I. HARDWARE HEALTH TRENDS

Use only safely available evidence. Possible signals: storage health and SMART data where
accessible through supported Windows interfaces · storage throughput trends · GPU temperature
trends · GPU hotspot delta where the vendor SDK exposes it · fan behavior where exposed · memory
pressure trends · clock stability · throttling indicators · crash frequency · driver-related
instability · sensor availability changes.

Example: *"GPU temperature is stable, but hotspot delta has increased across recent comparable
sessions. This is an observation, not proof of hardware degradation."*

Never diagnose failing hardware from one noisy reading.

### J. PERSONAL PC KNOWLEDGE GRAPH

Compy should remember the machine over time. It should be able to answer from local history: What
happened after the BIOS update? · Which driver produced the best results in this game? · When did
the stutter begin? · What changes are currently active? · What was restored? · Which tweaks
repeatedly did nothing? · Which games are CPU-limited versus GPU-limited? · Did a hardware change
solve the issue? · Which conclusions remain uncertain?

This knowledge must remain local in the initial implementation.

### K. UPGRADE ADVISOR 2.0

Do not build a generic "buy a better GPU" block. An upgrade prescription must contain: detected
limiter · affected games or workloads · supporting measurements · confidence · cheaper software or
configuration alternatives first · what the upgrade is expected to improve · what it will not
improve · whether the display or another component limits the benefit · evidence expiration
conditions · affiliate disclosure if monetization is later enabled · **"No upgrade recommended" as
a first-class outcome.**

Example: *"Your GPU is the measured limiter in two of three tested games at your current
resolution. A faster GPU would likely improve average FPS, but your current 1% low problem also
contains CPU-side variance, so the upgrade would not necessarily remove the stutter.
Recommendation: do not purchase yet; isolate the CPU-side issue first."*

### L. CROWD INTELLIGENCE — FUTURE, NOT NOW

Long-term opportunity: anonymous, opt-in, inspectable aggregate intelligence across hardware
combination · game · driver · Windows build · session metrics · crash incidence · successful
experiments · null results · regressions.

Possible future output: *"Users with this GPU and game version show fewer regressions on driver X
than driver Y."*

This is not part of the first implementation. It remains gated behind: its own specification ·
explicit consent UI · payload inspection · privacy review · security review · owner approval ·
outbound-network gate · minimum sample thresholds · anti-reidentification safeguards.

**Do not add any network plumbing during this train.**

────────────────────────────────────────────────────────
## 5. FIRST IMPLEMENTATION TRAIN — BEGIN NOW
────────────────────────────────────────────────────────

Do not attempt to build the entire vision at once. The immediate build should establish a useful,
read-only, end-to-end vertical slice: **"Compy Intelligence Foundation + What Changed?"**

This first train should create the architecture that all later intelligence features can reuse.

Required first-train outcomes:

### A. DATA INVENTORY

Map every relevant existing data source: hardware information · session summaries · FPS series ·
benchmark state · armed comparisons · comparison results · latency diagnostics · Black Box
results · Trust Ledger changes · Gaming Mode sessions and recovery records · driver information ·
Windows build/update information already available · process events · startup information · power
state · existing exports.

Document: where each source lives · whether it is persisted · reliability · timestamp quality ·
missing fields · whether collecting it requires new IPC · whether collecting it could cross a
safety boundary.

### B. CANONICAL INTELLIGENCE TYPES

Create a clean domain layer rather than embedding heuristics directly in React components.

Suggested types, adjusted to project conventions:

**EventRecord** — id · timestamp · eventType · source · scope · game · hardwareFingerprint ·
summary · evidenceReferences · confidence/reliability · metadata

**Observation** — metric or event · value · unit · time range · source · quality · sample count

**Hypothesis** — id · title · plainLanguageSummary · category · supportingEvidence ·
contradictingEvidence · missingEvidence · confidenceBand · nextVerificationStep · affectedScope

**EvidenceNode** — id · nodeType · label · sourceReference · reliability

**EvidenceEdge** — from · to · relation · weight/reliability · explanation

**InvestigationResult** — symptom · time range · leadingHypotheses · meaningfulChanges · ruledOut ·
unknowns · nextAction

Use Rust for persistent/canonical logic where appropriate and TypeScript for presentation
derivations where appropriate. Avoid duplicating truth across both.

### C. EVENT TIMELINE

Build or derive a local chronological timeline from existing persisted data. Initial scope should
prefer data already available and reliable. At minimum include: Compy applies · Compy restores ·
Gaming Mode starts/stops/recovery · game sessions · benchmarks · comparisons · detected driver
identity · detected Windows build · hardware fingerprint changes · crash/Black Box events where
currently persisted.

If a source is not currently persisted, do not fabricate historical events. Represent it as
available only from the point persistence begins.

### D. "WHAT CHANGED?" ENGINE

Implement a deterministic first version that compares two points or sessions.

Inputs: selected good session or baseline · selected degraded session or latest session · local
events between them · metric changes · hardware and software identity changes.

Output: meaningful metric changes · system/configuration events between sessions · ranked
hypotheses · confidence band · evidence · contradictions · unknowns · recommended next test.

Initial hypotheses may include: GPU driver change · Windows build/update change · Compy
configuration change · Gaming Mode state difference · power-plan difference · hardware fingerprint
change · increasing memory pressure · increasing thermal behavior · game-specific performance
variance · insufficient comparable evidence.

Do not imply causation solely because an event occurred first.

### E. FIRST UI SURFACE

Add the first intelligence surface in the most coherent existing location.

Preferred product behavior: **Monitor owns "what happened." Blackbook owns historical record and
evidence. Lab owns "test the theory." Home may show only the highest-level current conclusion. Do
not create a fifth primary room.**

A reasonable first implementation is —

Monitor session detail: "What changed since this comparison?" · leading hypothesis · confidence ·
supporting evidence · contradicting evidence · next test · link/door into the appropriate Lab
station.

Blackbook: canonical event timeline entries.

Home: at most one concise "Compy is investigating…" or leading finding when enough evidence exists.

Use existing design language: instrument console · sentence-case plain English · real values ·
honest empty states · no card-grid slop · no fake HUD metrics · reduced-motion compliance ·
keyboard accessibility · no new decorative motion without state meaning.

### F. EXPERT VIEW

Normal view: *"Performance dropped after the driver changed. The driver is a plausible cause, but
there is not enough evidence yet. Run one controlled comparison."*

Expert view: exact sessions · metric deltas · event timestamps · evidence graph · supporting and
contradicting observations · sample counts · confidence derivation.

### G. TESTS AND GUARDS

Add tests for:

- no historical event fabricated without a source timestamp
- unknown values remain unknown
- no numeric confidence exposed without calibration
- correlation does not become causation
- contradictory evidence lowers confidence
- multiple simultaneous changes prevent isolated attribution
- insufficient sample count produces an honest inconclusive result
- identical sessions do not generate a fake cause
- missing sessions produce an honest empty state
- timeline order is deterministic
- external/unowned changes are not presented as Compy-applied
- all new UI remains keyboard-accessible
- reduced-motion behavior
- no outbound request or capability introduced
- current mutation paths remain untouched
- existing feature-flag failsafes remain valid

────────────────────────────────────────────────────────
## 6. PHASE SEQUENCE AFTER THE FIRST TRAIN
────────────────────────────────────────────────────────

> **Namespace rule:** these phases are recorded in all docs as **"Intelligence Phase N"** — never
> bare "Phase N." The Optimization Cleanup lane already owns a "Phase 0–3" sequence in
> `docs/BACKLOG.md`; the two numbering schemes must never be conflatable in any doc, commit
> message, or report.

After the first vertical slice is implemented and verified, update the canonical backlog with this
sequence:

**Intelligence Phase 2:** richer root-cause graph · cross-session pattern detection · "good session
vs bad session" investigation workflow · external drift/change detection · hardware and software
event persistence improvements.

**Intelligence Phase 3:** user-started automatic experiment engine · single-variable attribution ·
stronger baseline/treatment controls · simulator recommendations · automatic keep/restore verdict
workflow using existing mutation contracts.

**Intelligence Phase 4:** hardware-twin intelligence integration · component-level evidence
highlighting · hardware-health trends · long-term personal knowledge graph.

**Intelligence Phase 5:** evidence-based Upgrade Advisor 2.0 · "buy nothing" verdict · technical
prescription contract · consumer report and shop-report exports.

**Intelligence Phase 6:** optional crowd intelligence · only after explicit security/privacy/owner
gates · no work in the current train.

────────────────────────────────────────────────────────
## 7. PRODUCT LANGUAGE
────────────────────────────────────────────────────────

Preferred terms: What changed? · Most likely cause · Evidence · What argues against it · What we
still do not know · Next test · Improved · No meaningful difference · Performed worse · Ready to
test · Not enough evidence · Worth testing · Not relevant to this rig · No upgrade recommended.

Avoid: AI-powered · magical · ultimate boost · guaranteed FPS · one-click miracle · perfect
optimization · 100% healthy · optimization score · your PC is broken · alarming scareware
language · arbitrary probability theater · smug "other tools lie" copy inside the product.

The brand can be adversarial in public comparisons, but the application itself should remain calm,
precise, and useful.

────────────────────────────────────────────────────────
## 8. DEFINITION OF DONE FOR THIS SESSION/TRAIN
────────────────────────────────────────────────────────

This session is not complete if it only creates a concept document. A successful result must
include:

1. Current-state verification.
2. Data-source inventory.
3. One concise implementation spec or decision record.
4. Canonical intelligence domain types.
5. A deterministic first "What changed?" analysis path.
6. A real UI surface using current local data.
7. Honest empty and insufficient-evidence states.
8. Tests and anti-fabrication guards.
9. Existing test suites passing.
10. TypeScript build passing.
11. Rust tests/clippy/check passing where Rust changed.
12. Tauri/frontend production build passing where applicable.
13. No network or capability expansion.
14. No mutation-boundary changes unless explicitly documented and unavoidable.
15. A small reversible commit or commit train.
16. Push to the correct branch according to current HQ/worktree law.
17. Update only the canonical current-state/backlog documents that genuinely changed.
18. Report (terse, per standing token discipline): commit hash · what was implemented ·
    verification result · any remaining uncertainty · exact next implementation action.

Do not ask the owner to choose among superficial implementation options. Resolve normal engineering
decisions yourself. Pause only if the work reaches: a security boundary · a new outbound-network
boundary · an irreversible action · a paid service · an external distribution action · a genuine
owner taste decision · a core architecture change whose blast radius exceeds this approved
intelligence direction.

────────────────────────────────────────────────────────
## 9. RELATIONSHIP TO ALREADY-TRACKED WORK (cross-reference, never double-track)
────────────────────────────────────────────────────────

This direction subsumes or feeds several items already live in the repo's docs. Cross-reference
them — do not create duplicate tracking, and do not silently close them either:

- **Evidence-export tiers** (BACKLOG, panel-review brief §4.4 — Consumer/Technical/Support renders
  over `export.rs`) → subsumed by **Intelligence Phase 5** (consumer report / shop-report exports).
  Annotate the existing BACKLOG entry to point here; the 2026-07-16 audit finding stands (all tiers
  are genuinely new — `export.rs` has one render path and no share-card exists).
- **Upgrade-path advisory + the panel's "Upgrade Prescription Contract"** (persona 5;
  `priorities.rs` limiter detection, UI_VISION_BACKLOG §F upgrade-path engine) → subsumed by
  **Intelligence Phase 5 / Upgrade Advisor 2.0**. The panel's contract terms (confidence shown,
  cheaper alternatives first, affiliate disclosure adjacent, evidence expiration, "no upgrade" as
  success) are already restated in §4K above — one lane, not two.
- **Pre-room intent router + basic-mode gaps** (BACKLOG, brief §4.2/§4.8, both gap-checked
  2026-07-16) → complementary to this train's First UI Surface work (§5E), not part of it. If §5E
  work naturally lands near them, close them with citations; otherwise leave them queued.
- **Optimization Cleanup** (all phases) → a *data source* for this platform ("external drift in
  Compy-managed settings," tweak-pack residue as timeline events) and a separate lane per §0.11.
  Its Phase 2 taxonomy spec (`2026-07-16-optimization-cleanup-phase2-3-taxonomy-detection.md`)
  deliberately reuses the shipped real/placebo/risky vocabulary — the intelligence layer must do
  the same wherever it grades a tweak (one grading language everywhere, per that spec's argument).
- **`docs/METHODOLOGY.md`** (drafted 2026-07-16, site wiring pending) → this train's confidence/
  noise-floor language must stay consistent with it; if the intelligence layer changes any
  measurement definition, that doc updates in the same train.
- **Non-competitive consumer story** (persona 7 draft in `docs/content-drafts/`) → §4E pattern
  detection ("degrades after forty minutes") is the product-side answer to the same persona;
  content lane stays separate.
- **Cold-start testing protocol** (OWNER_ACTION_CHECKLIST §B2) → the first intelligence surface
  should be in the build that beta testers eventually receive; no separate action now.

Begin by verifying current main and inspecting the real data models. Then implement the first
working "Compy Intelligence Foundation + What Changed?" vertical slice.
