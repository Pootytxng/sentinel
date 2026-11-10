# Compy Reborn Roadmap

**Derived authority:** `../PRODUCT_CONSTITUTION.md`<br>
**Current-state authority:** `../RELEASE_STATE.md`<br>
**Safety authority:** `../ARCHITECTURE_LOCKS.md`<br>
**Execution authority:** `../WORK_CONTROL.md`

This roadmap does not redefine the product. It converts the Constitution into build order.

If this roadmap conflicts with the Constitution, the Constitution wins. If it assumes a capability is built when `RELEASE_STATE.md` says otherwise, Release State wins on current truth. If it proposes an implementation that violates Architecture Locks, the implementation is invalid until the lock is explicitly and safely amended through its own process.

---

## North star

Compy must make two journeys excellent:

1. **MAKE THIS PC BETTER**
2. **FIGURE OUT WHAT WENT WRONG**

Both must converge on the same machine model, evidence, history, Trial system, rollback machinery, explanation system, and confidence vocabulary.

The project should not optimize for feature count. It should optimize for the quality of these two journeys.

Phase numbering below is dependency order, not product ranking. The optimization phases precede Care
convergence only because Care's "what changed since it worked?" path consumes the Machine Model, Trial,
history, and rollback machinery those phases build. **FIGURE OUT WHAT WENT WRONG** is never subordinate
to **MAKE THIS PC BETTER**, and no phase may ship Performance value by weakening the shared machinery
Care depends on.

---

## First product train — done when

*Derived, not new direction (#663): every line below comes from a phase's own **Exit:** line or from
`../PRODUCT_CONSTITUTION.md`; it adds no product direction, price or date. The owner may amend it.*

A phase is done when its Exit holds on the **installed build** on the owner's rig, never because one PR
merged (`../BACKLOG.md` "False-done rule"). The train as a whole is done when the §35 product success
condition is true for a normal user: told Compy what they wanted (Phases 4–5), it understood the PC
(Phase 2), tested what actually mattered (Phases 3–4), explained what changed (Phase 7), kept what helped
and put back what didn't (Phases 3, 5), and when something later went wrong helped them understand why
(Phase 6).

| Phase | Done when (source) | Current status (evidence) |
|---|---|---|
| 0 | Phase 0 Exit | Exited: `BACKLOG.md` P0 "COMPLETE 2026-09-05" (PR #371) |
| 1 | Phase 1 Exit | Exited: `BACKLOG.md` P1 "Phase 1 exit holds" (re-derived at `901f090c`) |
| 2 | Phase 2 Exit; §16 | Exited: `BACKLOG.md` P2 "Phase 2 owner-rig exit: met" (desk build `2afd7471`, 2026-10-24) |
| 3 | Phase 3 Exit; §7 | Exited: `BACKLOG.md` P3 "Phase 3 owner-rig exit: met" (2026-10-23; `d1a5204d`, `39b591d6`) |
| 4 | Phase 4 Exit; §8, §35 "tested what actually mattered" | Code landed (`WORK_TRAIN.md` P4-exit `e3d0420e`); exit walkthrough open (P4-exit-proof) |
| 5 | Phase 5 Exit; §10, §36 | Code landed (P5-guided `2f33cc6b` to P5-outcomes-f1 `19c70a50`); exit walkthrough open (P5-exit-proof) |
| 6 | Phase 6 Exit; §17, §18, §26 | Code landed (P6-changed `3216a6b2` to P6-timeline `02a00f5f`); exit walkthrough open (P6-exit-proof) |
| 7 | Phase 7 Exit; §13, §14, §25 | Code landed (P7-route `9fefbf6d` to P7-rig-care `9f60e291`); exit walkthrough open (P7-exit-proof) |
| 8 | Phase 8 Exit; §20 | Risk-choice slices landed (P8-posture-a `1eeef838` on); first Advanced candidate waits on P4-exit-proof and the owner's sign-off (P8-first-advanced) |
| 9 | Phase 9 Exit (below); §23 | In progress: P9-hz `f1bfbb26`, P9-target `97ebbf7f`, P9-settings-done `25feba43` (its live case waits on P4-exit-proof), P9-bottleneck-sustained `14d39b5`, P9-software-first `023da7d`, P9-hint-shown `4a4265d4` |
| 10 | Phase 10 Exit (below); §31 | Not started: no slice in `WORK_TRAIN.md` or `BACKLOG.md` |
| 11 | Phase 11 Exit (below); §32 | Not started: no slice in `WORK_TRAIN.md` or `BACKLOG.md` |

**What v1.0 means** (derived; owner may amend). Compy v1.0 is the first build a stranger can install from
the public release path and for which the §35 sentence is true: Phases 0–7 exited on the installed build,
so both flagship journeys work end to end on the same machine model, Trial and rollback. It also clears
the `../ARCHITECTURE_LOCKS.md` §4 release/security checklist as it applies (code signing in the release
pipeline, final license/EULA/privacy disclosures, permission/elevation explanation, rollback across
upgrades, installer trust testing, security/privacy claims matching the binary), which today leaves the
`../RELEASE_STATE.md` gates OPEN for code signing and legal. Those gates are the owner's; no executor or
automated workflow closes them. Nothing in §35 needs Phases 8–11, so v1.0 does not wait on them.

---

## Phase 0 — Constitutional migration and drift elimination

**Goal:** prevent pre-rebirth product doctrine from steering future implementation.

Required:

- install `PRODUCT_CONSTITUTION.md` as product authority;
- rewire `CLAUDE.md`, `AGENTS.md`, docs index, README, and other bootstrap paths;
- create the `docs/product/` derived architecture;
- classify/supersede all pre-rebirth product-direction documents;
- remove current-product hierarchy statements from safety docs while preserving actual safety laws;
- add a product-authority/drift guard;
- rebuild `BACKLOG.md` so it is execution-only and points to this roadmap;
- independently review the migration against the owner-ratified Constitution.

**Exit:** a fresh agent cannot legitimately derive “Care primary / optimization secondary,” universal-preset thinking, tweak-count thinking, or another historical thesis from active authority.

---

## Phase 1 — Safe current-build stabilization

**Goal:** reach a trustworthy development base before expanding behavior.

Only work that materially protects real users, reliable measurement, or safe iteration outranks product development here.

Examples:

- release-state truth and build/install integrity;
- unresolved control-plane blockers that can corrupt parallel work or proof;
- mutation/rollback correctness;
- measurement defects that would invalidate Trials;
- installer/signing/trust blockers required for safe external testing;
- severe product defects that prevent a first-time user completing either flagship journey.

Do not let open-ended repo hygiene, cosmetic cleanup, or new coordination machinery become an indefinite precondition for product learning.

**Exit:** product experiments can be built, shipped to controlled testers, measured, and rolled back without known critical integrity failures.

---

## Phase 2 — Shared Machine Model v1

**Goal:** establish one coherent representation consumed by Performance and Care.

Build/reconcile the minimum useful model of:

- detected hardware/topology;
- Windows/build/driver facts;
- display characteristics;
- relevant power/security/configuration state;
- active Compy changes and exact prior-state history;
- recent sessions and benchmark baselines;
- observed incidents;
- known configuration drift where safely detectable;
- relevant startup/background activity;
- evidence confidence/provenance.

No separate “Performance machine state” and “Care machine state” unless the underlying facts are truly different.

**Exit:** both flagship journeys can ask the same local model what the machine is, what recently changed, what Compy changed, and what evidence is available.

---

## Phase 3 — Trial Protocol v1

**Goal:** make the Trial the canonical unit of optimization and bounded troubleshooting.

Implement the schema/logic for:

- purpose/outcome;
- eligibility;
- mechanism;
- current state;
- risk class;
- rollback contract;
- measurement strategy;
- interactions/dependencies;
- result classification;
- keep/restore/defer/retest decision.

The first version does not need to cover every existing tweak. It must prove the model on a small set of high-confidence, reversible candidates.

**Exit:** one candidate can move through baseline → apply → verify → measure → classify → keep/restore with a durable receipt and no hidden state.

---

## Phase 4 — Optimization Engine v1

**Goal:** replace universal-preset logic with outcome-oriented candidate search.

First supported user outcomes:

- **Recommended / Best Overall Experience**
- **Maximum FPS**
- **Smoothest frame pacing**

Latency and visual-quality constrained optimization enter only when measurement/controls are credible enough to avoid pseudo-precision.

Required engine behavior:

- derive relevant candidates from machine/workload facts;
- remove inapplicable/already-correct candidates;
- rank by expected usefulness, risk, evidence, and measurement cost;
- understand interaction groups;
- stop chasing effects below measurable noise;
- keep only validated benefit or explicit user-chosen tradeoffs;
- preserve exact rollback paths.

**Exit:** Compy can honestly say “we tested what mattered on this PC” for at least one supported workload path.

---

## Phase 5 — Guided Optimization Journey

**Goal:** make serious benchmarking usable by a normal person.

User flow:

1. Compy proposes or defaults the outcome.
2. Compy explains the approximate test plan/time.
3. It establishes a repeatable baseline.
4. It guides the user through the minimum necessary workload repetition.
5. It tests candidates/bundles according to the Trial Protocol.
6. It presents understandable configuration outcomes such as Safe / Recommended / Push when evidence supports multiple tradeoffs.
7. It keeps/restores according to the user decision.
8. It explains what was learned.

The user never needs to know which internal setting should be tried next.

**Real-play mode (Constitution §36, 2026-10-29).** Step 4 must not depend on disciplined repetition. When a
user just plays normally, Compy keeps the change on across several ordinary sessions and compares them
with several ordinary sessions without it (like-with-like where it can tell scenes apart), and reports the
confidence that earned ("Likely", "No clear difference", "Unknown") instead of stopping at "too noisy".

**Exit:** a first-time gamer can complete an optimization journey without outside benchmarking knowledge or manual Windows-tweak research, playing the way they normally play.

---

## Phase 6 — Care Journey convergence

**Goal:** make diagnosis the reverse traversal of the same machine/evidence history.

Prioritize:

- **What changed since it worked?**
- incident chronology;
- recent driver/Windows/configuration/Compy changes;
- known-good baseline comparison;
- evidence vs inference separation;
- one safe next experiment at a time;
- restoration to known-good state where justified;
- clear “unknown / beyond Compy / needs outside support” outcomes.

Black Box and case intelligence should feed this journey rather than remain isolated specialist instruments.

**Exit:** a user can move from “my game started crashing/stuttering” to a bounded next action or honest unknown without manually hunting through rooms.

---

## Phase 7 — Contextual UX and education convergence

**Goal:** make the whole product feel like one understandable conversation.

Implement consistently:

- intent/context routing instead of requiring room knowledge;
- Answer → Explanation → Technical Receipt progressive disclosure;
- notification rules based on meaningful decisions/state changes;
- 3D rig as reasoning visualization rather than decoration;
- contextual teaching after relevant personal evidence;
- consistent confidence vocabulary;
- no scareware severity inflation;
- no arbitrary score treated as truth unless it has a defensible model.

**Exit:** normal users are not blocked by technical vocabulary; enthusiasts can still inspect exact mechanisms/evidence.

---

## Phase 8 — Advanced tuning envelope

**Goal:** extend capability without abandoning responsibility.

Only after the foundational Trial/risk/stability systems are proven should Compy broaden into areas such as:

- advanced scheduling;
- deeper power behavior;
- supported undervolting/overclocking interfaces;
- more aggressive debloat/startup choices;
- other higher-risk performance controls.

Every capability must enter through `RISK_MODEL.md` and Architecture Locks.

No “advanced mode” becomes a dumping ground for unsupported controls.

**Exit:** advanced users gain more agency while every Compy-automated operation still has a defensible support boundary.

---

## Phase 9 — Hardware decision intelligence

**Goal:** help users decide whether software optimization has reached the machine's practical limit.

Build system-level upgrade assessment around:

- measured bottleneck;
- target workload;
- display target;
- CPU/GPU balance;
- PSU capacity/connectors where knowable;
- motherboard compatibility;
- physical/thermal constraints where knowable;
- cheaper software/configuration alternatives first;
- “no upgrade recommended” as a valid result.

Affiliate economics, if ever enabled, are firewalled from the technical recommendation.

**Exit:** (derived from the Goal above and Constitution §23; owner may amend) for a measured workload, Compy can say whether software settings have reached what it can test, then name the measured limiter in system context or say "no upgrade recommended", never naming a part in isolation and never letting retail economics shape the answer.

---

## Phase 10 — Evidence network / public knowledge moat

**Goal:** convert trustworthy individual evidence into trustworthy collective knowledge without compromising consent.

Before any outbound expansion:

- local value must stand alone;
- consent must be explicit and reviewable;
- uploaded evidence must be scoped/scrubbed;
- methodology and schema must be stable enough for comparison;
- sample size/confidence must be shown honestly.

Potential outputs:

- hardware/workload-specific optimization evidence;
- known-issue correlations;
- Blackbook empirical updates;
- null-result publication;
- compatibility intelligence;
- upgrade evidence.

**Exit:** (derived from the preconditions above and Constitution §31; owner may amend) at least one collective output ships from explicitly consented, scoped evidence, shows its sample size and confidence honestly, and leaves every local feature working without it.

---

## Phase 11 — Monetization and distribution scale

**Goal:** charge for demonstrated durable value, not for a predetermined pricing story.

Before broad monetization:

- validate user activation and repeat value;
- test real willingness to pay;
- confirm what users consider Pro rather than core trust/safety;
- code-sign and establish public trust/distribution hygiene;
- make the official site/release path reliable.

Consumer recurring subscriptions are not assumed. Lifetime, perpetual + maintenance, annual, or other structures remain hypotheses until evidence selects among them.

**Exit:** (derived from the list above and Constitution §32; owner may amend) any charge Compy makes rests on measured activation, repeat value and willingness to pay, keeps safety fundamentals and undo outside it, and is sold through a code-signed, reliable public release path.

---

## Permanent deprioritization rules

The following do not outrank flagship-journey work merely because competitors have them:

- raw tweak count;
- generic junk cleaning;
- broad driver updating;
- sensor-count expansion;
- exposed registry/service/process controls;
- UI complexity for expert credibility;
- speculative kernel capability;
- engagement mechanics;
- additional internal governance that does not materially protect users or development truth.

---

## Product-development pull rule

For every proposed item, ask in order:

1. Which flagship journey does this improve?
2. What user decision becomes better?
3. What evidence will tell us it worked?
4. What machine-model facts does it require?
5. What Trial/risk/rollback contract applies?
6. Can the user understand the result without knowing the Windows primitive?
7. Does a safer/smaller implementation provide most of the value?
8. Does real user evidence justify building it now?

If those questions cannot be answered, the item is not ready to outrank proven work.
