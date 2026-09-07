# Compy Product Quality Stabilization Program

> **PRODUCT DIRECTION SUPERSEDED 2026-09-04 (#369).** This pre-rebirth program no longer controls
> product sequence, priority, completion, or product law. Those now come from
> `docs/PRODUCT_CONSTITUTION.md` and its derived `docs/product/ROADMAP.md`; `docs/BACKLOG.md` is an
> execution-status ledger only. The remaining train descriptions are historical or bounded
> implementation/safety provenance and may be reused only after revalidation against the current
> Constitution, `docs/ARCHITECTURE_LOCKS.md`, release truth, and Work Control.
>
> **Status:** owner-requested program blueprint, 2026-07-29. This document defines sequencing,
> dependencies, acceptance, and stop boundaries. It does not authorize implementation by itself.
> Live execution ownership remains in [Kuya Work Control](../../WORK_CONTROL.md); product priority and
> completion remain in [BACKLOG.md](../../BACKLOG.md); release and gate truth remain in
> [RELEASE_STATE.md](../../RELEASE_STATE.md).
>
> **Program issue:** [#17](https://github.com/Pootytxng/sentinel/issues/17)
>
> **Active first dependency:** [#14 — LabDeck recovery pilot](https://github.com/Pootytxng/sentinel/issues/14)

## 1. Outcome

Turn Compy's strong rollback, measurement, and release foundations into one coherent, supportable,
privacy-honest product before widening the beta or resuming speculative feature expansion.

The program succeeds when a non-technical gamer can:

1. understand what Compy found;
2. choose one safe next action;
3. see why it applies to this rig;
4. know what changes and how to undo it;
5. measure whether it helped;
6. obtain useful support evidence without automatic upload.

The governing presentation law is:

> **Glance first. Proof on demand. Full detail when requested.**

## 2. Authority and workflow

One source owns each kind of truth:

| Truth | Canonical source |
|---|---|
| Current executor, worktree, claim, status, next action | Kuya Work Control Project + linked issue |
| Product priority and completion | `docs/BACKLOG.md` + the named train spec |
| Gates, artifacts, installed build, publication | `docs/RELEASE_STATE.md` + release receipts |
| Active Lab recovery requirements | ARCHIVED — `docs/archive/USER_FEEDBACK_PRODUCT_RECOVERY.md`; the branch train is abandoned, see its disposition |
| Owner UI direction | `docs/UI_VISION_BACKLOG.md` + issue #14 owner verdict |
| Product and safety laws | `CLAUDE.md`, `docs/ARCHITECTURE_LOCKS.md`, `docs/RECEIPTS_DOCTRINE.md` |
| Implementation truth | Code, commits, tests, native captures, receipts |

Rules for every train:

- One issue, one active write owner, one exact worktree, one bounded scope.
- A program row is not permission to write. The child issue and ownership claim are the permission.
- Code wins over prose. A mismatch is reported before either side is changed.
- Bug becomes guard before the fix is considered complete.
- UI acceptance needs installed native evidence; jsdom and green unit tests are not visual proof.
- Security, capability, CSP, updater, network, telemetry, signing, distribution, system settings,
  secrets, money, and destructive Git retain their existing owner gates.
- Historical documents are archived or marked superseded, never rewritten as if they were always true.
- One implementation train integrates and verifies before the next begins. Parallel work is allowed
  only in separate worktrees with disjoint files and explicit Work Control claims.

## 3. Non-negotiable product boundaries

- No kernel driver and no game injection.
- No fabricated readings, scores, confidence percentages, or causal claims.
- No mutation without a complete typed rollback contract persisted before apply.
- No arbitrary registry, service, package, or PowerShell input from the webview or a model.
- No automatic user-data, crash, support-bundle, or receipt upload.
- Signed remote rules, Receipts, licensing enforcement, and removal features remain at their
  documented gates.
- The real RigViewer/RigHologram, essential measured gauges, and comparison evidence are preserved.
- Home owns whole-rig identity. Lab owns recommendation- and instrument-specific evidence navigation.
- A new visual model, component library, or generated asset is never accepted merely because it is
  newer. It must improve comprehension with real Compy data at the target Windows sizes.

## 4. Product position and presentation target

Compy does not win by matching vendor tools feature for feature. Razer already markets automatic
game boosting/restoration; AMD and NVIDIA own deep GPU tuning and overlays; Microsoft owns generic
cleanup/health; Intel owns supported CPU/game scheduling profiles.

Compy's product role is the **cross-vendor referee**:

- inspect the actual rig;
- abstain when a change is not justified;
- make only bounded, reversible changes;
- show the rollback contract;
- measure the result;
- say “no measurable change” or “buy nothing” as confidently as it reports a win.

Every proposed feature must strengthen at least one of those advantages. A feature that only adds a
switch, metric tile, visual effect, or AI answer without improving truth, action, rollback, proof, or
support is outside the current product cutline.

The presentation target is a calm precision cockpit: neutral depth, one meaningful accent, one
primary decision per viewport, real instrumentation, and three visible layers—answer, proof, advanced.
The existing real hologram is an evidence-navigation asset, not decoration. Avoid gamer-RGB noise,
tiny tracked labels, nested card walls, decorative telemetry, and generated art that competes with
the decision.

## 5. Feature disposition

| Class | Current treatment |
|---|---|
| Stabilize and clarify | hardware detection, recommendations, Trust Ledger, apply/undo, FPS/sessions, comparison, Gaming Mode, cleanup, export, signed updater |
| Active candidate | default-off LabDeck decision journey and presentation pilot |
| Built dark / keep gated | Receipts, remote rules, licensing enforcement, preload removal, aggregate stack trial |
| Defer | personal knowledge graph, Upgrade Advisor, crowd intelligence, broader vendor awareness, Pro/affiliate/B2B |
| Reject | kernel/injection, security weakening, arbitrary commands, unsupported overclocking, unmeasured boost claims |

“Implemented” does not mean “complete.” A feature is product-complete only when its user journey,
native evidence, failure/undo behavior, documentation, and support path are all accepted.

## 6. Program cutline

| ID | Train | Priority | Gate | Depends on | Blocks |
|---|---|---:|---|---|---|
| Q0 | Finish the LabDeck presentation pilot | Active | Owner installed review at completion | issue #14 claim | Lab acceptance, canonical Lab |
| Q1 | Correct privacy, storage, and trust copy | P0 | Legal wording review before public launch | current updater/storage truth | wider beta, next release |
| Q2 | Restrict Tauri custom commands by caller window | P0 | Owner GO for capability/security behavior | command/caller inventory | next release |
| Q3 | Close FPS PID-recycle attribution race | P0 | None for code; native proof required | current attachment state machine | measurement-backed claims |
| Q4 | Make the local release gate supply-chain complete | P1 | No hosted-CI spend | Q1–Q3 implementation settled | stabilization release |
| Q5 | Add privacy-preserving local support evidence | P1 | Privacy/data-retention review | Q1 truth vocabulary | support-ready beta |
| Q6 | Consolidate current product and document truth | P1 | None | Q0 disposition, Q1–Q3 status | reliable resumption |
| Q7 | Establish native accessibility and performance baselines | P1 | Owner/native machine review | stable canonical candidate | broad beta |
| Q8 | Bless one Lab and prune parallel generations | P2 | Owner acceptance | Q0, Q7 | app-wide design propagation |
| Q9 | Complete the first-win and proof/export journeys | P2 | Owner journey review | Q3, Q5, Q8 | intelligence expansion |
| Q10 | Resume strategic product bets | Later | Per-feature gates | Q1–Q9 | none |

The P0 set blocks the next release or wider beta. It does not establish evidence for recalling
v0.9.11. Public marketing/store distribution remains separately blocked by Authenticode signing
and finalized legal documents in `RELEASE_STATE.md`.

## 7. Q0 — active LabDeck presentation pilot

**Owner:** issue #14 / Claude Code in `C:\Users\Kuya\code\sentinel-feedback`.

**Allowed current scope:** the default-off LabDeck presentation hierarchy, functional Rig Evidence
Map using the real rig component, contextual real gauges, baseline/current comparison evidence,
Lab-scoped tests, copy, and documentation.

**Must remain unchanged in this train:**

- production-default Lab behavior;
- `compy_lab_deck` default OFF;
- `src-tauri`, IPC, capabilities, CSP, network, updater, mutation, and elevation;
- app-wide propagation;
- generation pruning, merge, release, install, and distribution.

**Acceptance:**

- the decision journey remains the primary organization;
- the headline move is glanceable at 1280×720 without hidden safety meaning;
- selecting a recommendation, problem, or instrument drives a deterministic logical subsystem;
- network, audio, and display resolve to an honest neutral/system-wide state when no rig part exists;
- every gauge and comparison value is real or explicitly unavailable;
- no decorative duplicate hologram is introduced;
- the five-person panel findings and corrections on issue #14 have guard coverage;
- the installed owner review accepts the presentation, not only the information architecture.

**Program handoff:** Q0 stops at issue #14's declared boundary. Its full branch—not only the latest
frontend diff—receives independent Rust, IPC, state, and integration review before any merge decision.

## 8. Q1 — privacy, storage, and trust truth

**Goal:** make policy, app copy, locale copy, storage paths, and tests describe the product that
actually ships: no telemetry or user-data upload, with one signed GitHub update-check/download
surface.

**Expected files:**

- `docs/PRIVACY.md`
- `src/receipts-copy-guard.test.ts`
- `src/Onboarding.tsx`
- `src/surfaces/setup/setup-steps.ts`
- `src/i18n/locales/en/home.json`
- `src/i18n/locales/en/settings.json`
- corresponding `zh-CN` locale files
- any production copy found by the required repository-wide absolute-claim sweep

**Implementation order:**

1. Inventory every claim containing “nothing leaves,” “no network,” “never change,” “local only,”
   “telemetry,” and storage/deletion instructions.
2. Bind the policy to the live updater endpoint, `%APPDATA%\Compy` data root,
   `%APPDATA%\Compy\runtime` FPS IPC path, and Trust Ledger behavior.
3. Use one stable vocabulary:
   - no account;
   - no telemetry, analytics, or automatic user-data upload;
   - signed update checks and user-approved downloads contact GitHub;
   - exports leave only by the user's explicit action.
4. State that deleting `history.json` removes rollback and audit history. Do not say it is harmless
   because Compy can recreate an empty file.
5. Replace the Receipts-only stale-copy guard with an outbound-truth guard that derives its expected
   wording from current updater and Receipts gates.
6. Keep website/waitlist policy separate from installed-app behavior.

**Acceptance:**

- no unqualified “no network connections” or “nothing leaves your PC” claim remains;
- updater enablement with stale absolute copy is a red test;
- Receipts enablement with stale no-telemetry copy remains a red test;
- data paths match `compy_data_dir()` and `fps_dir()`;
- ledger deletion consequences are explicit;
- English and Simplified Chinese carry the same meaning;
- updater, telemetry, network, CSP, and capability behavior are byte-for-byte unchanged.

## 9. Q2 — Tauri custom-command caller authority

**Goal:** make the overlay a genuinely lower-authority webview instead of inheriting every custom
command registered by the application.

**Gate:** this narrows capability/command behavior and therefore requires explicit owner GO before
implementation. Planning and inventory may remain read-only until then.

**Expected files after GO:**

- `src-tauri/build.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/capabilities/default.json`
- one or more narrowly named command-capability files if the inventory supports that design
- focused Rust/static contract tests

**Implementation order:**

1. Inventory every production `invoke()` by caller window.
2. Classify all registered commands as:
   - overlay-required read-only;
   - main-window read-only;
   - main-window state change;
   - mutation/elevation/update/restart;
   - internal/unneeded from the frontend.
3. Configure `tauri_build::AppManifest::commands` so registered commands no longer default to every
   window.
4. Grant the overlay only the exact read operations it invokes.
5. Add a main-window caller check to mutation, license-key, Gaming Mode lifecycle, tray/startup
   preference, update-barrier, and other state-changing commands as defense in depth.
6. Preserve the updater plugin's existing main-window-only capability.
7. Do not widen remote URL access, CSP, opener scope, filesystem scope, or network behavior.

**Acceptance:**

- an overlay call to every state-changing command is rejected before side effects;
- an overlay cannot begin or cancel the update restart barrier;
- main-window happy paths remain green;
- all overlay metrics still render from the documented minimal command set;
- a static guard fails when a new command is registered without a caller classification;
- Rust review finds no unguarded mutation or lifecycle command;
- native main/overlay smoke passes under the production CSP.

## 10. Q3 — FPS process identity

**Goal:** prevent a recycled Windows PID from carrying a previous game's name into real FPS,
frametime, 1%-low, comparison, or export evidence.

**Expected files:**

- `src-tauri/src/fps.rs`
- focused attachment-state-machine tests
- methodology/backlog text only where current behavior changes

**Implementation order:**

1. Add the failing recycle-while-presenting test to the attached-process state machine.
2. Revalidate the attached PID's executable identity on the frame-present path, not only the silent
   path.
3. On mismatch, drop the sample and reacquire through the existing positive-window/streak rules.
4. Keep “no fresh sample” distinct from zero FPS.
5. Verify every session consumer uses the corrected identity rather than a cached display label.

**Acceptance:**

- the new regression fails before the fix and passes after;
- PID death and PID reuse both detach cleanly;
- no recycled identity is persisted in `sessions.json`, comparisons, scoreboard, or export;
- a native game-close/process-churn probe records no desktop or replacement process as the old game;
- no denylist expansion substitutes for identity correctness.

## 11. Q4 — reproducible local release and supply-chain gate

**Goal:** make the standing local verification route equivalent to the checks the dormant hosted
workflow describes, without reopening the settled GitHub Actions spending decision.

**Requirements:**

- hosted CI remains OFF by owner decision;
- audits use current lockfiles and report current results, never inherited counts;
- a vulnerability finding is classified by reachability and shipped configuration before severity
  is declared;
- release identity remains bound to source, receipt, manifest, installer, and embedded stamp.

**Acceptance:**

- one documented local command covers encoding, doc budgets, release-state citations, hook tests,
  TypeScript, Vitest, frontend build, Rust tests, clippy, current npm audit, current Cargo audit,
  release-pipeline guards, and updater-signature verification;
- tool absence or audit-fetch failure is an explicit failure/blocked result, not a silent skip;
- a clean checkout reproduces the result;
- dependency inventory and versions are attached to the release evidence pack;
- property or fuzz-style tests cover persistence parsing and bounded IPC inputs where example tests
  cannot reasonably exercise the input space;
- no workflow, billing, or Actions-budget change is introduced.

## 12. Q5 — local support evidence

**Goal:** let a user produce useful support evidence while preserving Compy's local-first posture.

**Data contract:**

- bounded rotating local records;
- app version and embedded source stamp;
- structured error code and operation name;
- update/restart lifecycle;
- ledger recovery/corruption events without sensitive values;
- helper start/stop outcome without raw command payload;
- explicit redaction for usernames, full file paths, license keys, IPs, hardware serials, and
  arbitrary process command lines;
- export only after preview and user action;
- no endpoint, queue, background uploader, or automatic attachment.

**Acceptance:**

- retention and maximum size are fixed and documented from measured support needs;
- redaction tests cover every field before disk write and before export;
- malformed or corrupt local logs fail safely and never block rollback;
- Consumer, Technical, and Support exports are projections of the same evidence objects;
- the user can inspect the bundle before export;
- privacy policy and in-app copy describe the bundle and deletion consequences;
- network inspection confirms zero new outbound surface.

## 13. Q6 — architecture and current product truth

**Goal:** reduce change blast radius and let a fresh session resume without reading historical
strata as current fact.

**Actions:**

1. Keep `RELEASE_STATE.md` authoritative for gates/releases and `BACKLOG.md` authoritative for
   product priority/status; do not create another state board.
2. Keep Work Control authoritative for live ownership only.
3. Reconcile the active recovery branch with `main`'s Work Control commit during its later
   integration train, never during issue #14's active claim.
4. Move historical BACKLOG cycles and superseded launch-runway prose to `docs/archive/` while leaving
   short pointers.
5. Correct live contradictions, including “no real UI gaps,” “main is the only product truth,” and
   stale Gaming Mode gate language.
6. Extend mechanical guards only for facts that can be derived reliably from code.
7. Produce one typed inventory tying each frontend invocation to its Rust command, caller window,
   input/output type, error contract, and capability classification.
8. Extract large modules only when a scheduled train touches a coherent boundary. Start with command
   registration/caller policy, structured errors, and pure persistence/measurement helpers; reject a
   big-bang rewrite.
9. Keep new files focused by responsibility and make every extraction behavior-preserving with
   existing tests plus a boundary-specific guard.

**Acceptance:**

- the top of BACKLOG names one current program cutline;
- all active trains link to a Work Control issue and named spec;
- no current section contradicts `RELEASE_STATE.md`;
- product candidate, source main, installed build, tester build, and public release remain distinct;
- new frontend/backend IPC drift is mechanically detectable;
- every accepted module extraction is independently reviewable and carries no product behavior
  change unless its issue explicitly says otherwise;
- document budgets and citation verification pass;
- historical records remain accessible and are not retro-edited.

## 14. Q7 — native accessibility and performance baselines

### Accessibility

Target WCAG 2.2 AA as the forward-looking product policy while preserving existing stronger
project-specific rules.

Native matrix:

- complete keyboard-only first-win journey;
- visible and unobscured focus;
- Narrator or NVDA names, roles, states, error/status announcements, and reading order;
- 200% Windows scaling/text-size behavior;
- Windows High Contrast/forced colors;
- reduced motion and “step aside when I play”;
- 1280×720, long copy, hardware-unavailable, error, busy, disabled, and dialog states;
- non-text rig/hologram content has an equivalent semantic evidence path.

### Performance

Measure before setting budgets:

- cold start to usable Home;
- idle CPU/GPU and working set;
- active-room and hidden-room IPC frequency;
- continuous animation/RAF owners;
- 3D render cadence;
- tab-return latency;
- 10-minute idle and monitored-session traces on a named normal rig and a named lower-spec target.

**Acceptance:**

- budgets are derived from recorded baselines, not invented;
- inactive rooms perform no room-specific polling or continuous animation;
- one owner supplies each sensor stream to all consumers that need it;
- reduced-motion and step-aside modes eliminate continuous decorative work;
- keeping Optimize mounted has a measured benefit and no hidden polling cost, or the keepalive is
  removed;
- the native accessibility matrix has an evidence record, not a blanket compliance claim.

## 15. Q8 — one canonical Lab

**Goal:** convert the accepted LabDeck pilot into the single production Lab without losing unique
functionality or a recoverable integration path.

**Sequence:**

1. Owner accepts the installed Q0 presentation.
2. Rebase or merge current `main` into the recovery integration branch after its active claim is
   released; resolve Work Control and product-recovery doc differences explicitly.
3. Audit the full 100+ file recovery-branch delta, including Rust priority changes, rather than
   reviewing only the final Lab diff.
4. Migrate RigViewer, gauges, readiness, latest-session, comparison, and ExperimentBench behavior.
5. Re-point journey and console guards to the canonical implementation.
6. Make LabDeck unconditional only after parity.
7. Retire `compy_lab_deck`, then the older Lab flags/faces in reversible, reviewable commits.
8. Collapse the canonical face onto one semantic token/component-state vocabulary. Preserve theme
   choices, but remove layout/state differences that exist only because generations drifted.
9. Add native visual-regression fixtures for key data, empty, unavailable, error, busy, reduced
   motion, long-copy, and 1280×720 states.
10. Archive superseded specs and update BACKLOG/UI vision/state in the same integration commit.

**Acceptance:**

- one user-reachable Lab face and one navigation grammar remain;
- no unique real measurement, rollback, vendor-honesty, or unavailable-state behavior is lost;
- flag-off parity is preserved until the final retirement commit;
- full Rust/frontend/local release gates pass;
- installed owner review and the same class of non-technical users complete the journey;
- default-on, merge, build, install, release, and distribution each remain their own explicit step.

## 16. Q9 — first win, proof, and exports

**Goal:** make Compy's differentiator visible as a complete loop rather than a collection of tools.

**Journey:**

`Check → exact finding → safe action/guide/decline → Trust Ledger → proof tool → measured verdict → undo or keep`

**Requirements:**

- recommendation identity survives every handoff;
- structured optional proof IDs replace prose-to-tool inference;
- “no measurable change,” unavailable, confounded, stale, and not-comparable are first-class results;
- first-run setup teaches the action/rollback/proof loop without forcing a tour of every room;
- Consumer, Technical, and Support outputs render the same evidence contract;
- a formal consumer panel uses a fresh installed evidence pack and all five fixed personas.

**Acceptance:**

- a fresh user completes the loop without learning internal module names;
- each visible proof door opens a real supported instrument;
- unsupported mappings show no door;
- before/after attribution never credits one change when several changed;
- export language matches the in-app verdict and confidence band;
- task failures are recorded by journey stage and returned to the relevant child train.

## 17. Q10 — later strategic bets

Resume only after Q1–Q9 acceptance:

- Intelligence Phase 4 personal knowledge graph;
- Intelligence Phase 5 Upgrade Advisor with an equally strong “buy nothing” verdict;
- read-only NVIDIA/AMD/Intel feature-state awareness and vendor deep links;
- signed remote rules after production key, CDN, rollback, staged rollout, and emergency disable;
- opt-in Receipts/crowd intelligence after security/privacy/legal review, payload preview, retention,
  kill switch, and owner GO;
- model-assisted evidence explanation only from structured Compy facts.

Models may explain, summarize, compare, and prepare a user-controlled support/export artifact. They
must not generate mutation commands, eligibility, rollback contracts, or unsupported performance
claims.

## 18. Conflicts and resolutions

| Existing plan/setup | Conflict | Resolution |
|---|---|---|
| Issue #14 owns `sentinel-feedback` and is frontend-only | Q1–Q7 span docs, Rust, security, and tooling | Keep them as later child trains in separate worktrees; do not broaden #14 |
| Product-recovery ledger excludes legal, signing, release, Intelligence 4/5, telemetry, and capability work | A single mega-train would violate its own boundary | Q0 remains the recovery train; this program sequences independent trains |
| `docs/WORK_CONTROL.md` landed on `main` after the recovery branch point | The candidate branch lacks current claim-before-write law | Integrate current main only after #14 releases its claim; never rebase it mid-pilot |
| Updater is live while policy/copy says no network | Current trust text is false | Q1 corrects words/guards; updater behavior remains unchanged |
| Custom Tauri commands default to all app windows | Overlay capability intent is narrower than actual custom-command authority | Q2 narrows authority after explicit owner GO |
| Hosted CI is deliberately OFF | Recommending hosted audits would reopen a settled spend decision | Q4 makes current dependency and release audits reproducible locally |
| BACKLOG says “no real UI gaps” and `main` is the only product truth | Owner-accepted recovery work proves an active product gap/candidate exists | Q6 archives or supersedes stale live claims while preserving history |
| BACKLOG classifies the PID-recycle race as non-blocking for 0.9.1 | It can mislabel real measurement evidence | Q3 elevates it to a blocker for the next evidence-backed release, not a recall |
| LabDeck simplifies IA by replacing LabConsole | It currently drops core proof assets | Q0 restores/integrates those assets before acceptance |
| UI vision calls for broader motion/presentation work | App-wide propagation would outrun the Lab pilot | Q8 waits for Q0 installed acceptance |
| Intelligence Phase 4/5 was next | Platform depth does not fix the current user journey | Q10 resumes only after stabilization and first-win acceptance |
| Local support evidence stores new diagnostic data | “Local” does not remove retention/privacy responsibility | Q5 depends on Q1 and requires explicit retention/redaction policy |
| Public launch has signing/legal gates | Product stabilization cannot close owner/external obligations | Keep those gates in RELEASE_STATE and owner checklist; run in parallel only when owner chooses |

## 19. Defer and reject

Defer until the named dependency closes:

- app-wide presentation propagation until Q0/Q8;
- Intelligence Phase 4/5 until Q9;
- Receipts, crowd intelligence, remote rules, Pro, affiliate, and B2B;
- new catalog additions until Q3 and the first-win proof loop;
- public marketing/store release until signing and legal are closed.

Reject:

- another permanent Lab/Home/Monitor generation or default-on preview flag;
- deleting old Lab faces before parity and owner acceptance;
- generic “boost,” health-score, or confidence-number claims without measured support;
- arbitrary AI-generated system changes;
- cloud crash/support upload by default;
- kernel drivers, game injection, security weakening, anti-cheat-sensitive hooks, and unsupported
  overclocking;
- widening capability, CSP, opener, network, or telemetry scope as a shortcut;
- using historical green counts, download counts, dispatched reviewers, or one canary as broad
  product acceptance.

## 20. Program completion

The program is complete only when:

- every Q0–Q9 child issue is Done with named evidence or explicitly rejected by the owner;
- no required item is hidden in a deferred/gated bucket;
- BACKLOG, RELEASE_STATE, UI vision, owner checklist, Work Control, and code agree on their distinct
  kinds of truth;
- the canonical app completes the first-win journey in an installed native review;
- the next release passes the corrected privacy, command-authority, measurement, supply-chain,
  accessibility, performance, and rollback gates;
- remaining strategic bets are visibly deferred rather than implied complete.
