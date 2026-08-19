# Compy — Living Backlog Ledger

> **Why this file exists.** Persistent workflows (`/loop`, `/schedule`) kept declaring "genuinely
> finished, standing by for verification" while real product work remained. Root cause: there was no
> *machine-readable* checklist — completed work lived in CLAUDE.md victory-lap banners and scattered
> `*.REPORT.md` prose, so a waking session read "X landed, all green," found no open thread, and
> stopped. **This file is the canonical open/closed ledger.** Source of *priority* = the roadmap
> (`docs/superpowers/plans/2026-06-21-roadmap-sequencing.md`, Cowork's strategy lane). This file only
> tracks *status*, verified against code on `main` — not against banners.
>
> **Status anchored to `main` @ `47e93e6` (2026-06-23 audit).** Verified by a 5-agent read-only sweep of
> the actual source tree, not commit messages.

---

## 🎯 CURRENT PROGRAM CUTLINE — PRODUCT QUALITY STABILIZATION (owner request 2026-07-29)

> **This section wins on current product priority.** Full sequencing, dependencies, acceptance,
> conflict resolutions, and defer/reject rules:
> `docs/superpowers/specs/2026-07-29-product-quality-stabilization-program.md`.
> Live execution and claims remain in [Kuya Work Control](WORK_CONTROL.md); gate/release truth remains
> in [RELEASE_STATE.md](RELEASE_STATE.md). Historical priority sections below remain evidence, not the
> current pull order.

- [x] **PRODUCT-CONFORMANCE DRIFT — the class the owner caught on his own desk (2026-08-18).** Three
  defects in one screenshot: his removed "What are you here to do?" box back as the largest button
  (`compy_home_intake` consulted about the panel, not the question), nine user-facing Rust strings
  naming rooms retired 2026-08-12 (Monitor/Blackbook/Lab), and TWO tests actively defending both.
  Fixed + guarded in `8db70795`: `src/room-name-copy-guard.test.ts` (driven off `HOME_RAIL`, carries
  its own disarm proof) and self-review rubric item 10 (prior owner decisions; a git log -S is
  required evidence). **Root cause, recorded because it generalises:** all 167 guards check safety,
  release integrity or "nothing was deleted" — the affordance census CERTIFIED the regression
  because it rewards KEEPING affordances and his decision was to remove one. No audit in the repo
  asks "does the app still match what the owner decided". Codex's weekly automation is coordination-
  only (branches/claims/worktrees) and writes to `$CODEX_HOME`, outside the repo, where no lane
  reads it.
- [x] **Product-conformance audit — DELIVERED by Cowork 2026-08-18**, read-only, 469 lines:
  [`docs/CONFORMANCE_AUDIT_2026-08-18.md`](CONFORMANCE_AUDIT_2026-08-18.md). 26 recorded decisions
  graded against `main@e6feb861`'s committed blobs. **9 HONORED · 1 SILENTLY REVERSED · 9 NEVER
  BUILT · 4 PARTIAL · 1 DOC DRIFT · 1 never resolved · 1 not-yet-built-no-drift.** Its three top
  findings (C-01 intake flag, C-02 room renames, C-03 topbar taglines) are the three this train
  fixed, arrived at independently. **The unbuilt remainder is the queue below — that is what the
  audit bought.**
- [ ] **Extend the Codex weekly automation with product-conformance scope, and make it write INTO the
  repo.** Today it is coordination-only (branches/claims/worktrees) and writes to `$CODEX_HOME`,
  outside the repo, where no lane ever reads it — which is why six days of drift went unseen. The
  audit above is the template for what the weekly run should re-check. Still delegated; do not
  duplicate.
- [x] **Home front door restructure (UX-1 ② completion, owner-approved direction 2026-08-18).**
  Verdict → one action → hero. Shipped: topbar taglines gone (audit C-03, decided 2026-08-11, six
  days late) with a `ShellV2.test.tsx` case that fails if one grows back · the check strip stopped
  being a bordered card with an uppercase `CHECKS` tag and is now one plain sentence, which also
  closes audit §3's `16/16 clean` jargon finding · Home's Crash & Freeze row de-striped, with
  `src/side-stripe-guard.test.ts` failing the build on any NEW >1px coloured side border (three
  known offenders baselined and named, not fixed blind — they live on rooms this train did not open).
  **Found while rewriting the line:** `measured/total` rendered identically for "two checks failed"
  and "two checks were unreadable"; the sentence now distinguishes them and that is test-pinned.

### Conformance queue — the audit's unbuilt decisions, in owner-value order

- [ ] **C-04 · Rename the Home room to a question it answers** (Health / Diagnosis). UX-1 ① third
  clause; never built. Owner territory only for the *word* — the restructure is mine.
- [x] **C-05 + C-19 · SHIPPED 2026-08-18** (`d76f753f`). First run lands on the diagnosis: the tour
  no longer auto-opens, it is offered as a card on **all three** Home surfaces, and it has ONE name
  ("Compy tour") instead of "Guided setup"/"Hardware tour". CPU temperature is on the default Live
  face and on Home. Two durable corrections below (C-18, C-19) — **read them before trusting any
  older reachability claim in this file.** Guards: `src/first-run-front-door-guard.test.ts`,
  `src/cpu-temp-reachability-guard.test.ts`, both mutation-tested.
- [x] **C-06 + C-08 + C-09 · SHIPPED 2026-08-18.** Plain-English copy pass and the guard that holds
  it (`4c9e440e`); build identifiers out of consumer chrome (`6d047c2a`, `00d7020e`). Both carry a
  self-review PASS. The durable half: `plain-language-guard` scanned 199 `.tsx?` files and NONE of
  the 18 locale files holding the copy it exists to police — **when a decision silently reverts,
  check the guard's FILE FILTER before its rules.** Full record: `docs/RELEASE_STATE.md` installed row.
- [ ] **C-18 · Retire the classic `Monitor.tsx` shell — and ONLY that.** **This item was WRONG when
  first written and is corrected here; do not act on the earlier version.** A self-review reported
  `Play.tsx`, `monitor-panels.tsx`, `MonitorDomainCards.tsx` and `SessionDebrief.tsx` as unmounted,
  which would have licensed deleting live code. Traced by hand: `MonitorV2` imports `Play`
  (MonitorV2.tsx:4) for its ADVANCED face, `MonitoringTab` mounts `MonitorDomainCards`
  (App.tsx:1773), that card's detail renders `CpuMonitorPanel` from `monitor-panels.tsx`
  (MonitorDomainCards.tsx:146) — which is where `CpuTempOffer` lives — and `SessionDebrief` renders
  inside `Play` (Play.tsx:488). **CORRECTED AGAIN 2026-08-18 — "All reachable: Live → Advanced" was
  itself wrong.** `MonitorV2` mounts `Play` only when `!basic && !(segment === "live" &&
  monitorConsole)` (MonitorV2.tsx:231-240), and `compy_monitor_console` defaults ON, so on default
  flags Play mounts at advanced+**Sessions** alone — where `showLive` (`view !== "sessions"`,
  Play.tsx:264) is false and the `deepMonitoring` slot (Play.tsx:435) never renders. `Play` and
  `SessionDebrief` ARE live; `MonitorDomainCards` / `monitor-panels.tsx` reach the screen only on
  the `compy_monitor_console="0"` failsafe. Still do not delete them — that is the failsafe, not
  dead code. `MonitorConsole` replaced the BASIC face only. The one genuinely unreferenced surface is `src/surfaces/Monitor.tsx` (the classic
  shell), named only in comments. Precedent: [[audit-needs-completeness-critic-grep]] — grep the
  class yourself before believing a subagent's "nothing mounts this".
- [x] **C-19 · SHIPPED with C-05** (`d76f753f`). **The filed premise — "three clicks deep" — was
  wrong, and the truth was worse: on default flags the offer had NO path at all** (see the C-18
  correction above; `.mdc-root` and `.play-monitor` were both absent from the shipped build, checked
  live, not inferred from a green suite). Home also *asserted* "no CPU temp — needs a sensor app"
  with no probe behind it, so it printed that while HWiNFO was publishing — an unmeasured claim.
  Now: a CPU TEMP gauge on the default Live face in **both** modes, a graded reading on Home's CPU
  callout, and `CpuTempOffer` in a boxed Home tile that appears only while there is no reading. The
  offer is deliberately NOT on the annotation plane — the owner's 2026-08-06 call is that planes are
  labels, not controls, and `home-console-standard-readout-guard.test.tsx` caught the first cut that
  broke it. `cpu_temp.rs` gained a 900ms/15s hit-miss cache first, so the new caller costs less than
  the old one did.
- [x] **C-10 · SHIPPED** (`3eca4a9f`). Seven raw `<select>`s, four of them measured live on one Lab
  screen. Replaced by `src/design/Picker.tsx` — one portalled, token-drawn dropdown on the ARIA APG
  select-only-combobox pattern (focus stays on the trigger, so nothing can drop focus to `<body>`),
  with full keyboard + typeahead parity. `no-raw-select-guard.test.ts` bans `<select>` under `src/`
  with no escape hatch; mutation-tested.
- [x] **C-11 · SHIPPED** (`3eca4a9f`). The owner's ledger holds 64 applies, **37 of them the same
  tweak** — the 30-row tape was one sentence printed over and over. `buildLogbook` folds by `rec_id`
  into a row that sits at the latest apply and states "applied N times since <date>", and carries
  the genuinely LIVE apply's id (a stale id from a superseded apply is the dangerous kind of wrong).
  Live: 30 rows → 17.
- [x] **C-17 · SHIPPED** (`3eca4a9f`). `mono-law-guard.test.ts` + `mono-census.baseline.json`:
  resolves the mono **alias graph** as a fixed point (a two-token grep is dodged by the third alias),
  then requires every one of the 224 mono rules to be declared `value` / `chrome-tag` / `violation`.
  A **census with a ratchet, not a ban** — 61 of those rules pair mono with uppercase and are the
  Instrument-HUD micro-label idiom the owner approved over two rounds; banning them would delete the
  design language to enforce a comment. New mono rule ⇒ build fails until classified.
- [ ] **C-17b · Pay off the 12 recorded mono-on-prose violations** (`mono-census.baseline.json`,
  `violationCeiling: 12`). `.debrief-title` · `.debrief-head`/`-ctx-head` · `.cmp-head`/`-receipt-label`
  · `.wcp-head` · `.monitor-panel-sub` · `.strends-sub` · `.v2-update-title` · `.fct-skip-hint` ·
  `.ss-pin-label`. **Not restyled in the C-17 lane on purpose:** none of them was reachable on the
  screens that lane could verify live, and an unseen type change across six surfaces is exactly the
  kind of claim this repo's reachability law exists to stop. Each needs its screen reached, the mono
  dropped, and the ceiling lowered in the same commit.
- [ ] **C-14 · `GpuProfile.tsx` — wire in as advisory, or archive it.** Owner fork, never resolved,
  still parked by exemption.
- [ ] **C-12 · DOC DRIFT: `CommandPalette` is recorded as parked-then-dropped in UI backlog §D, but
  it is built and DEFAULT ON.** Doc-only fix; cheap.
- [ ] **C-13 · Foundation tooling gap: axe-core in vitest (rank 3) and Figma MCP (rank 2) never
  landed; only shadcn did.** axe-core is the one with a guard shape.
- [x] **PR #90 recovery + the quiet launch, rebuilt** — PR [#102](https://github.com/Pootytxng/sentinel/pull/102),
  #90 MERGED (its four unverified Codex claims re-proven + repaired), #100 closed measured-inert and
  rebuilt via `WebviewWindowBuilder` + `SW_SHOWNOACTIVATE`. Detail: `docs/CHANGELOG.md`.
- [ ] **`launch-focus-guard` RUNTIME tier is intermittent under the pre-push gate — NOT root-caused.**
  2026-08-18: the quiet-launch case rejected three consecutive pushes of the same tree
  (`Compy held the foreground for 33/55 samples (first at 2430ms)`), then PASSED the fourth with that
  identical tree. Ruled out by measurement, not guesswork: worker count (green at `--maxWorkers=4`
  AND full parallelism), the gate's own `npm test` (exit 0), the file alone (17/17 ×3), and the
  Windows foreground-lock timeout (`ForegroundLockTimeout` is INT_MAX on this desk, so it never
  expires). **Do not "fix" this with a skip.** First foreground at ~2.4s is a window being RAISED
  well after creation, and if that is real under load it is real while the owner games — the exact
  thing this guard exists to catch. Next step is instrumenting the probe to record WHAT raised the
  window, not silencing the reading.
  **2026-08-18 (later, this lane): a DIFFERENT signature, and it is now split from the one above.**
  Reproduced 3/3 against the 0.9.25 desk build with VS Code holding the foreground: `55/55 samples,
  first foreground 7ms, first window 12ms` — the foreground was taken 5ms BEFORE Compy had a window
  to raise, so nothing in-process can have done it. That is the system-level fronting the guard's own
  comments already record twice ("a fix that does not (and cannot) close it"; "the granted
  configuration is unpassable by ANY correct app"), and it had never been measured before because
  every earlier run SKIPPED — a compy was running each time. `classifyForegroundReading` now splits
  the two by the probe's own timings: an at-or-after-window raise (the 2430ms reading above) stays a
  hard failure, a before-window fronting is reported UNMEASURABLE by name and still fails under
  `COMPY_REQUIRE_FOREGROUND_RUNTIME_PROOF=1`. Five tests pin the classifier, including the 2430ms
  reading. **Still not root-caused** — the open question is why Windows fronts the launch at all when
  the probe refuses the foreground grant.
  **And the split immediately earned itself: under the FULL suite the same binary reads
  `50/54 samples, first foreground 132ms, window at 13ms` — a raise 119ms AFTER the window existed,
  which is the in-process class and fails.** So there really are two failures wearing one message:
  idle → the OS fronts the launch before Compy has a window (not ours); under load → something
  raises the window ~120ms after creation (ours, intermittent, reproduces only under full
  parallelism — 3/3 green standalone). The next step is unchanged and now better aimed: instrument
  WHAT raises the window at ~120ms, with the suite running.
  Shipped: installed build `3155c7a0`, self-review **PASS** on round 3 (round 2 caught that P2 was
  only half-fixed — a hand-added cooler still occluded the CPU — and that is now fixed and guarded).
- [x] **The "add a part" form is mounted nowhere** — CLOSED by Train 1 (2026-08-12): the form was
  extracted verbatim into `RigManualParts` and mounted in the Lab's own chrome
  (`LabConsole.tsx:480`), while the chromeless hologram keeps rendering; a guard block fails the
  build if it ever unmounts again (`lab-console.test.tsx:339`). Shipped desk v0.9.14, published
  v0.9.15 → v0.9.17. This row had sat un-ticked through the fix — closed on code evidence 2026-08-12.
- [ ] **Q8 / issue #91 — COMPY CARE: primary PC-doctor directive + Capability Exception Gate
  (OWNER-APPROVED 2026-08-09).** PR #102 merged 2026-08-12; #91 closed as a directive.
  **Policy rails are LANDED (issue #133, 2026-08-18):** tier-aware outbound guard, support-evidence
  tier separation, and the copy audit that caught the beta guide still promising "no updater" a month
  after it armed. **Next is the Tier 1 dark implementation**
  (`docs/superpowers/plans/2026-08-09-outbound-case-intelligence-tier1.md`); runtime stays hard-false.
  Do not compete with issue #49's Lab shell, revive draft PR #50, or adopt #55's
  stale Project Doctor claim. Rust-side Tier 1 keeps production CSP unchanged, so it does not trigger
  #64 Q2b; any proposal for webview fetch/remote content/CSP widening does.
  - **Primary product:** "Compy Care" umbrella; user-facing rescue entry is **Crash & Freeze Rescue**
    (retire "Black Box" from primary navigation). Diagnosis/recovery first; measured optimization is
    the second specialty.
  - **Care loop:** intake → triage → local case chart → bounded differential → one next plan →
    follow-up → prevention. The app must remember whether the symptom returned and whether the plan
    helped; it must not end at a one-time log explanation.
  - **Coverage ladder:** Train 1 crashes/hangs/restarts/BSOD; then measured performance regressions
    and slowdowns; thermals/noise; storage/startup/update trouble; network/peripheral/device trouble.
    Each later train needs its own evidence contract and must preserve honest unknown states.
  - **Discovery contract:** a compact Care entry is always visible on Home even while the broad
    `compy_home_intake` band stays default-OFF. A new local incident observer may persist one pending
    Home card, but the first version uses launch/foreground and monitored-session-end scans only—no
    background service and no assumed notification-click callback.
  - **Tier 1 — approved to build DARK:** separately signed public known-issue catalog, Rust-side
    pull only, local matching against existing crash incidents, zero machine-derived upload, separate
    key/schema/domain/cache from privileged remote rules. Runtime stays hard-false until exact
    endpoint, signing custody, disclosures, security review and canary evidence are approved.
  - **Tier 2 — NOT authorized by Tier 1:** scrubbed incident fingerprint — on by default once armed,
    disclosed at first run, real off switch, payload preview, no raw log/dump/path/serial (2026-08-18 §2).
  - **Tier 3 — NOT authorized by Tier 1:** explicit one-case evidence upload after preview/redaction,
    named recipient + retention/deletion receipt, no background queue or inherited consent.
  - **Driver posture:** no driver is needed for Tier 1. A Compy driver is policy-possible only through
    its own proven-need/security/anti-cheat/signing/rollback record. Borrowed vulnerable drivers,
    generic physical-memory/MSR/PCI/device-register access, and game/process injection remain barred.
  - Canonical spec: `docs/superpowers/specs/2026-08-09-compy-care-capability-exception-gate.md`.
    Plans: `docs/superpowers/plans/2026-08-09-capability-exception-policy-rails.md` then
    `docs/superpowers/plans/2026-08-09-outbound-case-intelligence-tier1.md`.

- [ ] **Q9 — OUTBOUND CAPABILITY EXPANSION (OWNER DECISION 2026-08-18).** Record:
  `docs/decisions/2026-08-18-outbound-capability-expansion.md`. The owner judged that building
  *around* the outbound restrictions cost more than the restrictions were worth. **Runs BEFORE Q8's
  Tier 1 build** — Q9a tells us what users actually do, which is the input Tier 1's catalog is
  guessing at today. Ordering is a lane decision, not an owner gate; say so if it should flip.
  - [ ] **Q9a — arm Tier 2 usage analytics, default-ON + disclosed.** *Bigger than a switch:*
    `receipts.rs` has the payload builder, the scrub, the preview command and a mounted consent
    surface, but **no send path exists at all** — no HTTP call, no endpoint, no queue, and the
    webview capability/CSP does not permit one. So the work is: a receiving endpoint ($0 tier), the
    Rust send path, the capability/CSP widening, the first-run disclosure, and the privacy/EULA text
    — one coherent change. `receipts_gate()` at `src-tauri/src/receipts.rs:18` is the last line of
    it, not the first. Payload preview, scrubbed allowlist and a real off switch stay mandatory —
    they are what makes the disclosure true. Amend
    `src/capability-exception-policy-guard.test.ts` (it currently asserts Tier 2 default-OFF) citing
    the decision record, never by weakening the invariant. **Destination decided (B_land, 2026-08-18):** the
    same-origin Pages-Function → D1 pattern `functions/api/waitlist.ts` already proves, writing to
    D1 `compy_reports` (`73f5e8a3-1827-42e3-8543-9fedc3750532`). Separate endpoint and separate
    table from Tier 3 — storage may be shared, consent and transport never. 🪪 **owner-gated
    sub-item:** EU/UK distribution needs a region check before default-ON ships there.
  - [ ] **Q9b — build Tier 3 in-app feedback + crash reports.** Own module
    (`src-tauri/src/case_evidence_upload.rs`), never inside `support_evidence.rs`. Tier 3's gate is
    unchanged and applies in full: per-case consent, preview/redaction, named recipient, retention,
    deletion receipt, no background queue, no inherited consent. **Destination decided (B_land, 2026-08-18):** D1 `compy_reports` on the
    owner's Cloudflare account, reached through its own `functions/api/` endpoint — no email inbox
    anywhere in the design. The consent screen names it: *"Compy's own store on compy.gg"*. Define
    the schema in this change (retention column + a ticket id the deletion receipt can quote); the
    database is empty on purpose. Residual: one `wrangler pages deploy` at ship time (B7).
  - [x] **Q9c — CPU temperature that feels native, with no driver.** *Shipped 2026-08-18 (PR pending):*
    `src/surfaces/CpuTempOffer.tsx` replaces the dead-end sentence with an offer that detects what is
    installed, starts it or links the download, and names HWiNFO's Shared Memory Support switch.
    Self-review PASS round 3 (6 fixture states). *Background:*
    `src-tauri/src/cpu_temp.rs` reads HWiNFO's `Global\HWiNFO_SENS_SM2` shared memory and the
    LibreHardware/OpenHardware WMI namespaces, driver-free, and Monitor shows the value attributed to
    its source. **The gap was purely UX** — with no sensor app running the user got one sentence telling
    them to go run one, a dead end under the name-it-AND-fix-it-inline law. The third-party-driver route is
    closed by Windows, not by us: every free option reads through WinRing0, which is on Microsoft's
    vulnerable-driver blocklist (default-enforced since Win11 22H2) and flagged by Defender as
    `VulnerableDriver:WinNT/Winring0` — our installer would trip Windows Security itself. A Compy-signed driver stays
    policy-possible but costs an EV certificate, so ZERO-BUDGET LAW parks it until revenue exists.

- [x] **Q0 — LabDeck glance-first presentation pilot: CLOSED, redirected 2026-08-02.** Issue
  [#14](https://github.com/Pootytxng/sentinel/issues/14) is not canonical and was never merged
  wholesale — closing verdict redirects into issue [#49](https://github.com/Pootytxng/sentinel/issues/49)'s
  Quiet Pit Wall Lab step (production order step 6). `feat/user-feedback-lab-recovery` @ `0599013`
  is preserved as selectively-portable source only: the real rig evidence map, measured gauges,
  comparison evidence, honest unavailable states, rollback, denial semantics, decision-journey
  behavior, and a11y/layout guards + tests port into #49's Lab surface only "when they earn parity,"
  never wholesale.
- [x] **P0 before the next release or wider beta — ALL THREE LANDED 2026-08-03** (Q1 privacy/
  storage/trust-copy truth as v0.9.12 · the other two with it). Full record archived:
  `docs/archive/BACKLOG_SHIPPED_P0_2026-08-03.md`.
- [ ] **P1 stabilization:** ~~reproducible local supply-chain/release gate~~ **Q4 DELIVERED** (issue
  [#35](https://github.com/Pootytxng/sentinel/issues/35)) — one command `powershell -NoProfile -File
  scripts/verify-release.ps1`, 14 checks, PASS/FAIL/BLOCKED/PENDING, reachability-classified npm +
  cargo audits with expiring acknowledgements, evidence pack JSON; see RELEASE_AUTONOMY.md → "The one
  local command". §11 property/fuzz coverage for persistence parsing + bounded IPC inputs also DELIVERED
  (issue [#37](https://github.com/Pootytxng/sentinel/issues/37)) — dependency-free fixed-seed generator,
  9 properties over the ledger, session file, elevated-command guards, mutation allowlists, batch
  receipts, and rollback-contract resolution. **Q5 BACKEND + POLICY DELIVERED 2026-08-04** — local-only
  redacted support evidence: `src-tauri/src/support_evidence.rs` (bounded rotating JSONL at
  `%APPDATA%\Compy\support\`, 400 records / ~250 KB, redaction at write *and* again at export, three
  projections, preview-gated export), 17 cargo tests, `src/support-evidence-outbound-guard.test.ts`
  turning the spec's "zero new outbound surface" acceptance line into a build-failing fact (proven
  load-bearing by injecting a real `reqwest` call and watching it fail), and the `docs/PRIVACY.md`
  disclosure + deletion consequences. **Q5 COMPLETE 2026-08-04** — the in-app preview/export UI
  (`08ad3b1`, `src/surfaces/SupportEvidence.tsx`, 9 tests, en/zh-CN parity) took its visual
  self-review on the installed `5ff6963` release build and PASSed 9/9; the first pass FAILed on a
  real user-facing defect and its fix is now guarded both sides (see the cycle entry below). **Q7 DELIVERED 2026-08-05** (issue
  [#73](https://github.com/Pootytxng/sentinel/issues/73)) — the accessibility sweep and the measured
  baselines, both recorded against the installed `dc4d55e · release` build on the owner's desk.
  A11y: the three `<Canvas>` mounts were checked in the live DOM, two were silent to a screen
  reader, and `src/canvas-a11y-guard.test.ts` now forces every canvas to answer *named picture* or
  *explicitly decorative* at its own call site. Perf: `scripts/q7-probe.mjs` wrote raw traces to
  `docs/perf/raw/`, `docs/perf/q7-baseline.json` transcribes 14 metrics, and
  `scripts/perf-budget-guard.test.mjs` re-derives every published number from those traces on each
  `npm test` — so a hand-edited baseline fails even though CI can never re-run the probe. One bad
  finding was on the record as an `open finding`, not a spec: **idle Compy cost ~50% of one core**
  with nothing moving and nobody present, reproduced on two bare runs. **CLOSED 2026-08-06** by the
  idle-cost teardown below — 50.165% → 23.348% of a core, re-measured on the shipped 0.9.13 build;
  `src/shell-idle-guard.test.ts` carries the third idle axis (*is anyone interacting?*) and its
  always-on record is now empty. *Still owner-blocked:* the lower-spec rig leg — every budget is proven on one fast
  machine and none is a claim about a slow one. **Q6 DELIVERED 2026-08-04**
  (issue [#65](https://github.com/Pootytxng/sentinel/issues/65), `9bf3bde`) — three stale live claims
  retired: `GAMING_MODE_PLAN.md` reconciled against the QA record (8 rows mapped, 3 left unchecked as
  *unproven, not failing*), the 2026-07-06 launch runway archived verbatim with its "no real UI gaps"
  sweep claim, and "every branch has a verified disposition" made true rather than retired — all 20
  origin branches dispositioned in `docs/BRANCH_DISPOSITIONS.md`, enforced by
  `scripts/branch-disposition-audit.mjs`.
- [ ] **P2 product completion:** owner-accepted canonical Lab + reversible generation pruning →
  first-win action/rollback/proof journey → Consumer/Technical/Support evidence exports.
  **Generation pruning DONE 2026-08-06** — 29 unreachable files / ~2,578 lines deleted (two Lab faces,
  three Optimize faces, `CompyHero`, `nav-flags.ts`, the `design/qpw` components, `Gallery`, a second
  `Sparkline`, vendored `MagicBento`); recurrence mechanised by `src/reachability-guard.test.ts`.
  Remaining under P2: the first-win journey and the evidence exports — the first-win journey is
  issue #49's Lab production-order step (see Q0 above for the #14-verdict porting checklist).
- [x] **Ledger-completeness honesty class — last known open instance CLOSED (found 2026-08-05 during
  the Home train's completeness-critic sweep, fixed the same day, issue #70).** The Lab Optimize
  station's "Applied & history — **every change, undoable**" summary vouched for a set Compy may
  never have enumerated: `get_applied_changes` degrades an unreadable `history.json` to `[]`.
  **One correction to how this was first written up:** the disclosure was *not* ungated — `Fix`
  already mounts `LedgerHealthNotice` for `view="ledger"` and already withholds its `.fix-empty`
  claim when the ledger is known-incomplete. The residual defect was narrower and worse: the vouch
  sat on the `<summary>`, *outside* the `<details>` holding its own caveat, and that `<details>` is
  collapsed unless expert view is on — so the caveat was sealed **behind** the claim it qualifies,
  one step past the "printed under it" failure `ledger-health-disclosure-guard.test.tsx` pins. Fix:
  under KNOWN-INCOMPLETE the summary swaps to `appliedHistorySummaryUnvouched` **and** the section
  opens itself; UNKNOWN (`null`) stays byte-identical to healthy. Guarded by
  `src/surfaces/lab/ledger-health-optimize-station-guard.test.tsx` (11 pins, falsified by reverting
  the fix: exactly the 6 defect pins go red, the 5 controls stay green).
- [ ] **LATER:** Intelligence Phase 4/5, vendor-awareness expansion, Receipts/crowd intelligence,
  remote rules, Pro/affiliate/B2B, and model-assisted explanation remain behind the blueprint's gates.

---

> **🧰 TOOLCHAIN — Fable-window persistence pack** (2026-07-06) — COMPLETE 2026-07-07: all 4 items shipped; living pointer = CLAUDE.md → PROJECT SKILLS INDEX. Moved verbatim to `BACKLOG_ARCHIVE.md` (2026-07-22 tier-1 board diet).

## 🚚 LIVE UPDATER — SHIPPED (owner directive 2026-07-22) + FIRST FIELD-QA WAVE (reviews 2026-07-22)

- [x] **Live in-app updater — SHIPPED + E2E-PROVEN** (`135d609` feat · `a6d1508` v0.9.2 · `90fc73e`
  v0.9.3): endpoint `Pootytxng/compy-releases` `releases/latest/download/latest.json`; consent-first
  topbar UpdatePill (offer → progress → passive NSIS → auto-relaunch; zero chrome when idle); footer
  honesty copy "Outbound: signed update check only" (test-pinned); minisign key OUTSIDE repo;
  `scripts/release.ps1` pipeline + `scripts/e2e-updater-probe.mjs` CDP probe. **Proven live on the
  owner's rig: 0.9.2 self-updated to 0.9.3 through the updater.** Full state: RELEASE_STATE 23a
  banner. Owner leftovers: key backup + first-link send (OWNER_ACTION_CHECKLIST §A0).

**Tester reviews 2026-07-22 (J + Matthew, on the 0.9.0 build) — each item rides normal triage; fixes
now SHIP through the updater.** J also praised: more organized, less overwhelming, loves controlled
experiments + logbook. Matthew praised: guided-setup rail line, simple home, Optimize clarity,
"What's this" on Telemetry Tasks.

- [x] **Default window too small (multiple testers + owner 2026-07-23)** — ✅ SHIPPED v0.9.4
  (`23ff847` feat · `419ec81` release), delivered to the owner's box THROUGH the updater: first-run
  default 800×600 → 1280×720 centered, plus `tauri-plugin-window-state` so the size/position the
  user sets persists (overlay denylisted). Restore path live-proven (state-file round-trip).
- [x] **J: bigger 3D PC window** — ✅ SHIPPED v0.9.6 (`5c74ba2`/`29e5217`, through the updater):
  Home stage 420→540, live canvas 362→482px; cards-band guard upgraded to DERIVE its bound from
  the stage css (drift-proof).
- [x] **J: cursor consistency** — ✅ FIX ALREADY SHIPPED (reticle.css `cursor: none !important` on
  a universal descendant selector, which is required because an explicit same-element
  `cursor: pointer` beats an inherited `cursor: none`). It had **no guard**; added
  `src/design/console/reticle-cursor-contract.test.ts` (`e2f1322`) pinning the selector, the
  `!important`, both escapes (text entry, `:disabled`) and the z-index band. Matthew's separate
  "square crosshair is a little weird" is about the reticle's SHAPE and stays OPEN — a taste call,
  which since 2026-08-07 is ours to make and show, not the owner's to adjudicate (CLAUDE.md, "TASTE
  IS MINE TO EXERCISE, HIS TO OVERRULE"). It was never the same defect as the two-cursor bug.
- [x] **J: "1 safe tweak not applied" is a dead end** — ✅ SHIPPED 2026-08-03 (`17d5f84`). The
  detail was never missing: `apply_recommendations_batch` already returns `{ title, reason }` per
  skip and HomeConsole discarded it one line after arrival, keeping only `.length`. The receipt now
  retains the items and offers a subordinate disclosure naming each skipped tweak with the reason
  the batch primitive gave (never synthesised here). Copy in en + zh-CN. bug→guard:
  `src/surfaces/fastpath-skipped-detail-guard.test.ts`, proven both directions. **NOT taken:**
  apply/ignore inline — a skip can come from a failed elevated step, so re-applying needs the
  elevation flow rather than a button; larger than the dead end it would close.
  **Visual self-review ✅ PASS 2026-08-04** (supersedes `17d5f84`'s "NOT RUN" note and the earlier
  OUTSTANDING line here): captured natively via a live-fixture mount of the real HomeConsole with a
  skip-bearing batch receipt — no machine mutation. 7/7 rubric PASS. One flag, not new to this diff:
  the skip-reason line inherits the muted caption token at 3.44:1 on 12.5px — sub-AA for body text,
  but it is the same token already shipping one line above and it clears the deliberate AA-large
  floor `src/theme-contrast.test.ts:100` pins for `--ix-text-3`. Raising that floor is ours to call
  (2026-08-07 taste decree) but it repaints every muted caption in the app — too wide for a T4
  review to absorb, so it stays logged here as its own scoped change, not deferred to the owner.
- [x] **J: post-check routing** — ✅ ALREADY SHIPPED (found 2026-08-03, stale entry). FirstCheck
  renders "Take me to the Lab" beside "Open the dashboard" and deep-links the Optimize station via
  the one-shot `compy_lab_open_station` handoff (App writes before `navHome("lab")`; LabConsole
  reads + clears on mount). It had **no guard** — added `src/surfaces/post-check-lab-route-guard.test.ts`
  (`06c047a`), which pins all three halves; the `removeItem` is load-bearing (without it every later
  Lab visit force-opens Optimize). 🔻 **NEW, logged not fixed:** FirstCheck's CTA copy and verdict
  prose are hardcoded English — that surface is un-i18n'd, so zh-CN users read English.
- [x] **J: "Needs your call" cards not interactive** — ✅ SHIPPED v0.9.6+v0.9.7: whole card head is
  a door (chevron, hover accent), opens the guided steps or an HONEST no-switch answer; What's-this
  + bordered Not-for-me in a visible actions row. Live-verified via CDP (6 doors, no-guide case).
  **Test-debt:** a DOM guard for the door behavior is NOT yet written (live-verified only) — add to
  `optimize-v2-ia.test.tsx` next pass. Apply-from-card stays absent BY DESIGN (no safe switch).
- [x] **J: per-room accents read as INCONSISTENCY** — ✅ RESOLVED per the owner's own 2026-07-23 pick
  ("apply to all"): SHIPPED v0.9.5 (`67541e4` feat · `ac518f1` release) through the updater — one-tap
  "Apply to all rooms" in the accent picker; per-room freedom intact. Live-proven + owner state
  restored. UI_VISION_BACKLOG NAV-1 (a) has the record.
- [x] **Matthew: Guided-Setup copy** — ✅ SHIPPED v0.9.6: the rail-orientation line now rides the
  FIRST step (mode-aware, 3 new setup-steps guards; recap still closes with it), and every lesson's
  tweak list reads "Settings Compy **can** tune here" + a nothing-changes-during-the-tour fine line.
- [x] **Matthew: Field Guide explanation placement** — ✅ SHIPPED v0.9.6: the guide introduces
  itself on its own tab (`bbv2-guide-lede`) and the intro's Blackbook blurb names it.
- [x] **Matthew: non-admin old-tweaks check "Couldn't check" lines** — ✅ SHIPPED v0.9.6: grouped
  in a calm bordered aside with an honest head ("N settings couldn't be read this pass — no guesses
  made") + the design-philosophy note ("Compy doesn't ask for admin rights just to look"). The
  guard-pinned per-item line format is preserved; the blanket run-as-admin recommendation was
  deliberately NOT taken (conflicts with the consent-first elevation doctrine).
- [x] **Matthew: bottom expandable rows too "quiet"** — ✅ SHIPPED v0.9.6: `.lab-optimize-more-summary`
  restyled from inline mono-caps links to full-width bordered door rows (matching the group-head
  grammar above); still subordinate to the enable-all hero. Deliberate revision of the earlier
  demote-spec, owner-backed.

## 🧠 INTELLIGENCE PLATFORM LANE (owner directive 2026-07-16 — supersedes priority ordering per its §0.12)

Owner-approved direction: evolve Compy into **evidence-based PC performance intelligence** — the
measurement layer that can say *what changed, what is consistent with the evidence, and what to
test next*. Machine evidence remains local by default; approved Tier 1 may download signed public
case knowledge and match it locally, with no incident upload. In-git anchor: `docs/superpowers/specs/2026-07-16-intelligence-foundation-train1.md`
(the Intelligence Phase 1 spec; the directive itself is a Cowork-lane review artifact, not committed).
**Namespace rule: phases in this lane are always written "Intelligence Phase N"** — never bare
"Phase N" (Optimization Cleanup owns a separate Phase 0–3 sequence; the two numbering schemes must
never be conflatable in any doc, commit message, or report).

- [x] **Intelligence Phase 1 — foundation + "What changed?" (read-only vertical slice)** — ✅ BUILT
  this cycle (hashes in Cycle 2026-07-17a): `intelligence.rs` canonical domain layer + local event
  timeline (from existing persisted data ONLY — never fabricates historical events) + deterministic
  two-session "What changed?" engine (fixed hypothesis catalog; enum confidence bands
  unknown/low/medium/high, never numerics; never causation-from-precedence) + first surfaces
  (Monitor SessionDebrief WhatChangedPanel · Blackbook logbook observed rows · Home last-session
  line) + expert view + anti-fabrication guards. Flag `compy_intelligence` DEFAULT ON ("0" failsafe
  test-pinned). Zero mutation, zero network, zero capability change.
- [x] **Intelligence Phase 2 — patterns, good-vs-bad, evidence graph** — ✅ BUILT + SHIPPED this
  cycle (`9c6af4b` backend · `094d834` frontend; installer SHA-256 `3EB0FAE5…C570D838`, live exe
  stamp-verified `094d834` clean). Spec `docs/superpowers/specs/2026-07-17-intelligence-phase2-train2.md`.
  Delivered: `intelligence_patterns.rs` six cross-session detectors (trend/thermal/memory/driver/mode/
  fade, passive-capped at Medium, §0.12 coverage reasons) · `what_changed_between` (§4D last-good-vs-
  first-bad) · EvidenceGraph re-projection (§4C, no new data, no causation language) · `drift.json`
  ingestion (external reverts as observed events) · `AppliedChange.rolled_back_at` (additive
  `#[serde(default)]` stamp, rollback logic unchanged). Surfaced Expert-view only (`compy_expert_view`
  default OFF): SessionInvestigator + evidence graph (Monitor), PatternsTile (Blackbook §5E, no fifth
  room); plain view unchanged. Read-only + one additive field — zero mutation/network/capability change.
  cargo 787/787 · clippy clean · vitest 1710/1710 · rust-tauri-reviewer PASS · self-reviewer PASS.
- [x] **Intelligence Phase 3 — experiment engine + optimization simulator** — ✅ **ARMED + SHIPPED**
  2026-07-17 (owner-signed "Ship it live now"). Groundwork built dark `7e00a06`; arming flips
  `experiment_gate() -> bool { true }` (`experiment.rs:55`) + wires `build_sim_context` to the REAL
  hardware-tailored catalog + converts the two dark tests to armed reality + interactive `ExperimentBench`
  FE (Lab room). Spec `docs/superpowers/specs/2026-07-17-intelligence-phase3-experiment-engine.md` §7.
  The engine ORCHESTRATES the existing mutation boundary (**no new apply/rollback primitive, no enum
  variant**; applies via `history::apply_recommendation`, restores via `history::rollback_change`, resolve
  stays history-only) · delta judged on the SAME 3% floor (`comparison::classify_with_guards`) · simulator
  reads the catalog READ-ONLY (unknown rec ⇒ honest insufficient-evidence, never a fabricated verdict).
  Mutation-gate 10/10 + rust-tauri-reviewer PASS + live apply→rollback round-trip on the rig + Cowork
  audit flagged. **The owner's first real gaming-session experiment IS the live FPS→verdict QA** (real
  frames are the owner's to produce — anti-fabrication law). Installer + stamp in RELEASE_STATE Snapshot.
- [x] **Intelligence Phase 3 fast-follow (W2 — UX staleness):** ✅ FIXED `f558d1d`. `ExperimentBench`
  now re-runs its simulator read on window/tab refocus, so a pick that became already-applied during the
  same Lab visit re-derives to the honest `already-configured` verdict card (Start withdrawn) and STAYS
  VISIBLE in the picker via the new `options` list rather than vanishing. Never a correctness bug —
  server-side `build_sim_context` already re-derived `already_active` from the ledger at start, so a stale
  pick could never double-apply; this closes the staleness window. Guard: `ExperimentBench.test.tsx`
  "re-derives the active pick from the live ledger on refocus" (6/6). (W1, the reselect race AT the apply
  boundary, was FIXED + guard-tested pre-ship: the picker locks during `simBusy` + request-id sequencing
  drops superseded reads + the sim card names its exact mutation target — `ExperimentBench.test.tsx`
  "locks the change picker while a simulation is in flight".)
- [x] **Measurement Platform 2.0 follow-up — treatment-side game-match check (additive, V1 limitation) — SHIPPED 2026-07-18.**
  The controlled experiment (`ExperimentBench`) captured a `GameStateFingerprint` at **baseline** but did
  NOT re-check the game/process on the **treatment** side, so a game-swap mid-run (quit the game, launch a
  different one between baseline and treatment) was **not provably excluded from stored data**. **Shipped
  fix (additive, safe-default, read-only advisory):** `conclude_experiment` now takes an optional
  `treatment_game: Option<String>` (the treatment session's `process_name`, which the FE already has via
  `treatmentFor`'s same-game filter — the game identity is the ONE axis that can realistically swap within a
  single sitting; rig/driver/res are held constant by construction, §1 of the decision doc). `conclude_outcome`
  runs a pure `game_match(baseline, treatment) → GameMatch` check at **top precedence, before crash + sample
  gates**: `Mismatch` ⇒ `not-comparable` verdict, restore (`keep=false`), **Unknown** confidence, plain-English
  "measured a different game … not enough comparable evidence"; `Unverified` (either side blank/absent) proceeds
  but drops the same-game claim; `Match` earns the "same rig and game" note. **Defense-in-depth** — the FE
  same-game filter stays, but the backend no longer trusts it (mirrors the `MAX_TEXT_LEN` webview-trust-boundary
  posture). No apply/rollback mutation, no network, no gate change. Guards: 5 new cargo tests +
  `not-comparable` added to `no_verdict_note_ever_carries_a_numeric_confidence` + an `ExperimentBench.test.tsx`
  render guard (the `not-comparable` verdict is unreachable in the live UI by design, so its label is vitest-proven).
  Decision doc `docs/decisions/2026-07-18-experiment-comparability.md` §3/§4 updated to CLOSED.
- [x] **Measurement Platform 2.0 follow-up — `next_test` structured rec-id (additive).** The deferral's own
  unlock condition is now met: the engine emits a real, OPTIONAL rec-id where a safe mapping provably exists.
  `EventRecord.rec_id` carries the catalog id **copied verbatim off the Trust-Ledger row**, so
  `Hypothesis.next_test_rec_id` / `WhatChangedReport.next_action_rec_id` are **READ, never matched from prose** —
  nothing parses a summary or maps free text onto the catalog. Emitted under three read conditions, all inside
  `compy-config-change` (the only hypothesis with a ledger row behind it): exactly ONE distinct rec in the
  window · it has an apply event · that apply is not `since_rolled_back`. Every other hypothesis, the
  confounded path, and the count-delta-only path emit `None` permanently. Deliberately NOT gated on
  `is_appliable` — LOCKED rule 3 resolves rollback from `history.json` alone, so a rec that has since left the
  apply allowlist is still undoable. **Routing correction (the deferral got the destination wrong):** the
  destination is the **Trust Ledger / Applied Changes**, NOT a pre-loaded `ExperimentBench` pick — the bench
  *applies* (`experiment.rs` `start_experiment` → `history::apply_recommendation`) while this next test
  prescribes a *rollback*, and feeding it a still-active rec hits `already_active` in `simulate`'s precedence
  chain and returns `already-configured` ("nothing left to change or test") — a dead end. Guard:
  `next_test_rec_id_is_read_from_the_ledger_never_matched_from_prose` (6 cases, mutation-verified to fail on a
  relaxed rule). Decision doc `docs/decisions/2026-07-18-prove-a-change-overlap.md` §5.
  No mutation / network / gate change.
  **Ledger half — ✅ LANDED, both halves now closed.** The "Next test" line in the What-changed report carries
  an inline `Roll back "<change>"` button whenever the engine's rec id still resolves to a live applied row.
  **Routing refinement of the line above** (the destination was right, the *location* wasn't): the affordance
  brings the Ledger action TO the report rather than sending the user to the Ledger surface —
  [[flags-name-it-and-fix-it-inline]] forbids a "go to another tab" dead-end and requires the flag to name the
  specific thing it found (hence the change's title in the label, never a bare "Roll back"). Resolution is
  against the **live** `changes` array (`App.tsx` `findActiveChangeForRec`), so the button self-hides the
  instant the rollback lands — which is exactly why the engine's prose still names the Trust Ledger itself and
  was left untouched: the sentence is the route, the button is only the shortcut. Props
  (`activeChangeFor`/`onRollback`/`busy`) are optional together, so every pre-existing mount renders unchanged.
  **Duplication caught by self-review and fixed in the same train:** in the primary flow (apply a fix from the
  debrief → `arm_comparison` for that rec → the next same-game session resolves it) the `ComparisonCard`'s rec
  and the engine's `next_action_rec_id` are the SAME still-active row, so an unguarded shortcut stacked TWO
  differently-worded buttons for ONE action in one card. `SessionDebrief` now wraps the host resolver
  (`rollbackShortcutFor`) and returns `undefined` for the card's own rec — for **every** verdict, not only the
  ones showing "Revert it", because a `Roll back "X"` hanging under an *improved* card that just said "Keep it"
  would contradict it outright. Wrapping the resolver rather than adding a prop leaves `WhatChangedPanel`'s
  contract untouched and gives `SessionInvestigator` the same protection for free.
  Guard: `src/surfaces/what-changed-rollback-guard.test.tsx` — 13 cases: 9 pinning the render condition, the
  handed-over row, the busy face and all six stand-down paths, plus 4 that mount the *composition*
  (`SessionDebrief`, not the isolated panel — which is exactly why the first 9 stayed green while the defect was
  live) covering both suppression paths and both must-still-render paths. Mutation-verified: reverting the memo
  to a bare `activeChangeFor(recId)` fails exactly the 2 suppression cases.
- [x] **Measurement Platform 2.0 follow-up — comparability vocabulary chrome convergence (cosmetic).** ✅ LANDED
  `921f49e`. `src/surfaces/measurement-chrome.tsx` + `.css` are now the ONE vocabulary both rooms wear —
  `<VerdictBand>` / `<SectionLabel>` / `<ComparabilityNote>`, fed per-room by a `--mc-*` palette block declared
  same-element on each room root (never `:root` — [[css-var-declaring-element-substitution]]). Pinned by
  `measurement-chrome-guard.test.ts` (11 tests, 3 positive controls). **Still open, deliberately:** the
  **surface-level reshape** (merging/renaming the "prove a change" rooms themselves) remains **owner territory**,
  not autonomous — this train unified chrome only, it did not touch room structure. Decision doc
  `2026-07-18-prove-a-change-overlap.md` §1/§5.
- [~] **Intelligence Phase 4 — hardware-twin intelligence integration (IN PROGRESS):**
  - [x] **Component-level evidence highlighting (slice 1)** — ✅ BUILT this cycle. `component_evidence.rs`
    is a READ-ONLY projection: it re-keys the existing Intelligence Phase 2 pattern findings
    (`intelligence_patterns::detect_patterns`) BY the hardware component each names (memory-trend → Memory;
    thermal-trend / driver-split → GPU), inventing no evidence and reaching no conclusion the Patterns tile
    doesn't. `HardwareGrid` lights a component card ONLY when a real pattern implicates it — accent border +
    label dot + an expandable evidence disclosure (band · non-causal headline · reasons · suggested next
    test) at that pattern's own confidence band (passive-capped at Medium, never High). Flag off or a fetch
    failure ⇒ fully neutral, never a fabricated glow. Command `get_component_evidence`; zero mutation /
    network / capability change. Guards: `HardwareGrid.test.tsx` (lit / neutral / fetch-fail / band-class) +
    `component_evidence.rs` 10 tests + the `.card.card-lit:hover` cascade guard in `border-hygiene-guard.test.ts`.
    cargo / clippy / vitest / tsc green · self-reviewer PASS (§4H, 9/9). Invisible on a rig with no qualifying
    session pattern yet (correctly neutral until evidence accrues) — that IS the design.
  - [x] **CPU thermal-peak tracking (hardware-health trends, slice 2)** — ✅ BUILT this cycle.
    `SessionAccumulator::record_thermals` (`sessions.rs`) tracks per-session `peak_cpu_temp_c` /
    `peak_gpu_hotspot_temp_c` as a running max-so-far — a tick with no reading holds the prior peak,
    never fabricates one — threaded through `SessionSummary` and `types.ts`. New `cpu-thermal-trend`
    cross-session detector (`intelligence_patterns.rs`, alongside the existing GPU thermal-trend)
    fires only once ≥`MIN_TREND_SESSIONS` sessions carry a real peak reading, silent otherwise;
    Medium confidence only on a sustained multi-session move, Low on a small/short one. cargo
    869/869 · tsc clean · vitest 1777/1777.
  - [ ] long-term personal knowledge graph (remaining Phase 4 slice).
- [ ] **Intelligence Phase 5:** evidence-based Upgrade Advisor 2.0 · "buy nothing" verdict ·
  technical prescription contract · consumer report and shop-report exports. (Subsumes the
  evidence-export-tiers item in PHASE A below and UI_VISION_BACKLOG §F upgrade-path engine —
  one lane, not two; both entries annotated at source.)
- [ ] **Intelligence Phase 6:** optional crowd intelligence · only after explicit security/privacy/
  owner gates · no work in the current train.
- [x] **Home HUD: rig-tier / corner-gauge text overlap (pre-existing defect, unrelated to the intelligence
  lane).** ✅ FIXED 2026-07-18. The self-reviewer (Intelligence Phase 4 §4H re-review) found `.hc-corner`
  ArcGauges overlapping `.hc-stage-cards` content on the Home HUD stage — intermittent because it only
  reproduces in 2D card view (`compy_home_rig_3d="0"`; the default 3D hologram leaves the corners clear)
  AND only when the HardwareGrid is tall enough to scroll rows into the gauge bands, so it was proven
  independent of the §4H diff (NOT a regression). Root cause: the four corner gauges are always-present
  (z-index:2, pinned 22px from each stage edge, ~56px tall) while `.hc-stage-cards` was a full-height
  (max-height:420px) scroll viewport, so a tall grid scrolled its rows UNDER the top/bottom gauges. Fix:
  confine `.hc-stage-cards` to the gauge-free MIDDLE band (max-height 420→240px) — `home-console.css`.
  bug→guard: two mechanized guards in `home-console.test.tsx` (a 2D-mode DOM coexistence check + a
  CSS-contract bound proving the viewport can never span the full stage again). Self-reviewer PASS:
  5.9–11px clear gaps measured top and bottom at both scroll extremes; 3D path unaffected.

**§0.12 demotion flags (owner reviews; nothing dropped without a trace):** open items below that
neither feed nor serve the intelligence platform are flagged 🔻 at their entries — five as of
2026-07-17 (curated safe-to-suspend data · debounce/Rapid-Trigger detection · sensor-ID DB · ISP
speed snapshot · DNS probe), each already blocked on its own gate, so demotion changes nothing
today. **NOT demoted:** Optimization Cleanup (separate lane per directive §0.11 AND a data source
for this platform — external drift + tweak-pack residue become timeline events) · pre-room intent
router + basic-mode simplification (complementary consumer-clarity work per directive §9 — stays
queued).

> **🔥 TOP PRIORITY LANE** (de-slop directive 2026-07-05) — CLOSED 2026-07-06: every item [x], Instrument-HUD reskin shipped (`394dd2f`/`96febda` live). Live UI truth = `UI_VISION_BACKLOG.md` + `RELEASE_STATE.md`. Moved verbatim to `BACKLOG_ARCHIVE.md` (2026-07-22).

> **🚀 LAUNCH RUNWAY** (Cowork consolidation, 2026-07-06) — ARCHIVED 2026-08-04 (Q6): a point-in-time consolidation whose sweep claims ("zero open code stubs", "no real UI gaps") and gate line numbers had drifted. Its still-live content is owner-gated and tracked where it belongs — RUNG 3 (private-beta send) and RUNG 4 (signing · legal · repo rename + `compy.gg`) in `OWNER_ACTION_CHECKLIST.md`; gate truth in `RELEASE_STATE.md`; UI truth in `UI_VISION_BACKLOG.md`. RUNG 2 closed 2026-07-08. Moved verbatim to `BACKLOG_ARCHIVE.md` (2026-08-04).

## 🛰️ HQ STEERING LOG — live lane board (newest on top)

> **Retention rule (2026-07-13):** this board keeps only the newest ~12 cycles. Older cycles live in
> `docs/BACKLOG_ARCHIVE.md` (same format — grep there for history). When appending a new cycle, move
> the oldest one(s) out if the board exceeds ~12 entries.

> ### 🛑 OWNER DECREE 2026-07-16 (via Cowork, owner at the console): AUTO-DEPLOY LANE DROPPED — do not resurface
>
> The GitHub-Actions auto-deploy errand (Cloudflare token + GitHub billing unblock, Cycle
> 2026-07-16e, archived 2026-08-06 to `docs/BACKLOG_ARCHIVE.md`) is **dead, permanently, by owner
> decision.** Facts established live in the
> owner's GitHub dashboard before the call: no failed payment, billed $0; Actions blocked since
> Jul 9 by the account's $0 Actions budget (stop-usage on); **$12 of ~$16 included free minutes
> already burned this month** — so "costs nothing" was not guaranteed, making this a zero-budget-law
> spend gate, and the owner declined. **Standing consequences:** ① the workflow file may stay in the
> repo (it fails politely) but do NOT ask the owner for the Cloudflare token, a billing change, or
> any budget raise again — the OWNER_ACTION_CHECKLIST item for the token paste is CANCELLED, remove
> it on next touch; ② manual `wrangler pages deploy` under the standing B3 deploy GO remains THE
> publishing path; ③ revisit ONLY if the owner raises it himself (the named trigger he accepted:
> multi-day absence where the site must update unattended).

### Cycle 2026-08-06a — ✅ IDLE COST TEARDOWN: HALF A CORE WAS DECORATION NOBODY WAS LOOKING AT (CC): `e12467f5` … `e34db6f7` (14 commits) on `claude/idle-cost-teardown-1f6a80` — PR [#76](https://github.com/Pootytxng/sentinel/pull/76), issue [#75](https://github.com/Pootytxng/sentinel/issues/75), **unmerged** (owner decides the merge)

Q7 left a measured but unattributed number: the app burned **50.165% of one core sitting still**. This
cycle attributed it. `scripts/q7-probe.mjs` gained a subtraction waterfall — disable one animation,
re-measure, name its cost — and the answer was one line of CSS: the title foil sweep in
`src/surfaces/ambient-hud.css` ran `background-clip: text` on an `infinite` loop, repainting the big
room titles every frame in every room, forever, for **29.793% of a core on its own**. The rest was the
Lenis rAF spine ticking with nobody scrolling, two aurora backdrops repainting instead of compositing,
and three 3D scenes rendering at full cadence while parked. Re-measured on the shipped 0.9.13 build:
**50.165% → 23.348% of one core**, a 54% cut, reproduced across two 10-minute bare runs.

Two defects the self-review caught, both in the new scroll-park path, both now guarded rather than
just fixed: the parked spine handed Lenis the entire idle gap on wake (`50e5edda` — scroll snapped),
and a second park overwrote the first one's interval so the accumulated offset was wrong
(`3ad6eb48` — the lane teleported). `src/design/jarvis/lenis-wake-guard.test.tsx` pins all five
wake paths, the monotonic clock across three parks, and overlapping parks counted once each.

- **Look substitution, surfaced not gated** (`OWNER_ACTION_CHECKLIST.md` §D): the foil now sweeps a bounded
  number of times and settles, instead of forever. One-word revert is `both` → `infinite`.
- **DISCLOSED GAP:** `TwoFuturesScene` could not be visually verified — it only mounts with a measured
  before/after pair this desk lacks; its diff is an `aria-hidden` label only.
- 0.9.13 declared and silently reinstalled; desk verified live at `3ad6eb48 · release`.

cargo 922/922 · vitest 308 files / 3994 tests · tsc clean · doc-truth 30/30 0 drift · doc-budget PASS ·
branch-disposition-audit 22/22 · self-reviewer **VERDICT: PASS** (round 3)

### Cycles 2026-08-04b … 2026-08-04g — ARCHIVED

Moved verbatim to [`docs/archive/BACKLOG_STEERING_LOG_2026-08-04b_TO_2026-08-04g.md`](archive/BACKLOG_STEERING_LOG_2026-08-04b_TO_2026-08-04g.md). Covers the
unreadable-ledger honesty run (Q7/Q9 acceptance, the sibling room, the rec-id read), all on
`claude/harness-context-cleanup-700535` and all awaiting the owner's merge decision.

### Cycles 2026-07-27a … 2026-08-04a — ARCHIVED

Moved verbatim to [`docs/archive/BACKLOG_STEERING_LOG_2026-07-27_TO_2026-08-04.md`](archive/BACKLOG_STEERING_LOG_2026-07-27_TO_2026-08-04.md) (TOKEN LAW: history leaves the
living ledger, nothing is deleted). Covers Q5/Q6 completion, the standing autonomy grant,
release autonomy → v0.9.11, and the forensic reconciliation.

## ⛔ Persistent-workflow protocol (read before declaring "done")

When running a `/loop` or scheduled session against "the checklist":

1. **Open THIS file. Pick the highest-priority `[ ]` item that is not owner-gated.** Do it (spec → TDD →
   build in an isolated worktree off `main` → `/check` + `/security` → `self-review` if visual →
   cargo/npm green → commit after branch+status check). Tick it `[x]` with the commit hash. Repeat.
2. **Never declare "done" without enumerating.** A valid stop is one of:
   - *"All `[ ]` items remaining are owner-gated — here they are: …"* (list them), OR
   - *"Phase A `[ ]` count is now 0; remaining work is Phase B/C/D which is gated — confirm before I cross a gate."*
   - A bare "I'm finished, standing by" with un-ticked `[ ]` items above is a **false finish** — keep going.
3. **A green test suite is NOT the stop signal.** The stop signal is "no un-ticked, non-gated item remains."
4. Owner-gated items (🔒 money/distribution, 🪪 mutation catalog-expansion, 📡 telemetry/outbound)
   are *blockers to surface*, never silently skipped or marked done. **Aesthetics are not on that
   list** (2026-08-07 decree) — decide it, ship it, hand him a before/after to veto on sight.
5. **Branch redundancy: judge by the TREE, not ahead/behind.** Lanes merge via PR (new hashes), so a branch can
   read "N ahead / `git cherry` all `+`" while its content is **already in main**. Before flagging a branch as
   "stranded/unmerged work," run `git merge-tree --write-tree main <branch>` — if it equals `git rev-parse main^{tree}`,
   the merge is a no-op → already shipped → prune, don't surface. Only a tree-changing merge is real unmerged work.
   And re-RUN cargo/vitest for counts each cycle — never carry an assumed number forward. ([[branch-redundancy-detect-by-mergetree]])

> **🌿 Branch-integration health** — the 2026-06-24e sweep (every branch dispositioned, `main` the single product truth) is a **point-in-time record**, moved verbatim to `BACKLOG_ARCHIVE.md` (2026-07-22). **Its standing claim was false when written and is now enforced instead of asserted (2026-08-04, Q6):** every one of the **20** origin branches carries a row in **`docs/BRANCH_DISPOSITIONS.md`**, and `scripts/branch-disposition-audit.mjs` fails the build when a ref has no row, a row names a dead ref, or a `MERGED` row stops being a no-op. Result: 6 MERGED · 6 SUPERSEDED (content reached `main` by another path) · 3 PRESERVE (the frozen beta ref + two failed v0.9.9 candidates `RELEASE_AUTONOMY.md` requires kept) · 1 CLAIMED by the Codex lane (`feat/console-project-doctor`, no automatic takeover) · **4 UNLANDED** carrying real work — `codex/tool-shed-hygiene` (partial), `feat/bklit-anime-design-system` (owner product-scope), `feat/user-feedback-lab-recovery` (owner review), `design/quiet-pit-wall` (deferred, needs a visual self-review). `main` remains the **release** truth — every shipped build is built from it — but that is not a claim that no work lives elsewhere; live lane ownership is governed by `docs/WORK_CONTROL.md`. The durable merge-tree law stays in protocol rule 5 above; re-run it before asserting a branch is stranded.

---

## PHASE A — Allowed-now (the 1.0 product-completeness lane)

Legend: `[x]` shipped on main · `[~]` partial/thin · `[ ]` not built · `[⛔]` excluded by feasibility/design.

### A0 · Repo hygiene
- [x] Reconcile + prune the stranded branches; confirm `main` is the single product truth — done 2026-06-24e: pruned `spike/backend-agent`, `benchmark`, and the two no-op-redundant safety branches (`qa/locale-drift-hardening`=#6, `gaming/honest-partial-undo`=#7, both already in main); the 3 remaining unmerged branches are deliberately-superseded archives. `main` IS the single product truth.
- [x] Adopt this ledger as the persistent-workflow target — the HQ STEERING LOG (top) is the live per-cycle target; `/loop` + scheduled HQ sessions drive off it.

### A1 · DETECTION layer — **effectively complete** (feasibility-bounded)
- [x] core-parking state (policy/registry + powercfg) — `hardware.rs`, `lib.rs:288`
- [x] XMP/EXPO active — ✅ DONE + GUARDED (audit 2026-08-03): honest "running below rated", never
  claims "profile active" — `mem_speed_status` `hardware.rs:511`, surfaced via `xmp_expo_status`;
  guards `hardware.rs:3176` `mem_speed_status_is_honest` + `HardwareGrid.test.tsx:92`.
- [⛔] Intel Speedshift/EPB — user-mode feasibility wall ([[detection-feasibility-walls-usermode]])
- [⛔] AMD PBO — feasibility wall (detect-only impossible without vendor SDK)
- [⛔] thermal-throttle (ACPI) — feasibility wall; only post-hoc noisy-run flag exists
- [~] power-draw — GPU via NVML/ADLX built; CPU package power not (no kernel/vendor path) — `monitoring.rs:365`
- [x] Hyper-V / VBS / SVM virtualization — `hardware.rs:1078`, `diagnostics.rs:126`
- [x] S.M.A.R.T. drive health — `hardware.rs:329`
- [x] USB device/lane tier — `hardware.rs:1148`
- [~] BIOS-tweak *availability* annotation — BIOS age detected; "which tweaks available" not probed
- [x] firmware/BIOS date check — `hardware.rs:1027`
- [x] driver-freshness all vendors + copyable URLs — `hardware.rs:1321`, `Check.tsx:49`
- [x] NIC driver freshness — `get_nic_driver_info`, `Check.tsx:262`

### A2 · MEASUREMENT spine — **mostly built**
- [x] benchmark before/after comparison (armed) — `comparison.rs:120`, `benchmark_trial.rs:238`
- [x] baseline set/clear — `benchmark.rs:940`
- [x] cross-session comparison — `comparison.rs`, `sessions.rs:212`
- [x] session history with hardware snapshot — `sessions.rs:35` (`hw_fingerprint`)
- [x] drift-regression advisory — `drift.rs`
- [x] local award/score ledger — drill-down UI: each award expands to its full certified receipt (rec_id handle + metric + 95% CI + points + timestamp) from the existing get_scoreboard data — `260f943`
- [x] persist a real DOWNSAMPLED fps-over-time series per session — `fps_series: Vec<(u32, f64)>` additive `#[serde(default)]` on `SessionSummary`: per-10s-bucket MEAN of the real ~1 Hz samples, real elapsed-secs x-axis (gaps in play stay gaps, never interpolated), capped 2160 points (6 h), kept for the most-recent 20 sessions and stripped on save for older; TS contract mirrored (`types.ts` `fps_series?: [number, number][]`). 5 guard tests pin bucketing math, gap honesty, the cap, pre-series serde-default parse, and the strip window. Unblocks the site ReplayHUD real trace + an honest in-app session chart (neither wired yet — no UI renders it in this train). Read-only/additive, no mutation boundary — `sessions.rs`, `monitoring.rs:984`
- [x] hardware-tier segmentation — LOCAL Entry/Mid/High band on the Benchmark surface from measured VRAM·cores·RAM (inputs named); reuses the canonical rig-tier bands via pure `benchRigTier`; like-to-like framing, no cohort/network — `372bde1`
- [x] percentile display — wired `percentile_rank` as a LOCAL display-only stub: each verified win ranked within the cohort of ALL the user's own wins (the scoreboard ledger), shown as "Top X% of your verified wins" in the award drill-down, labeled "local — no peer cohort yet"; gated below a 4-win floor; never persisted. Peer/cohort percentile stays Phase C gated — `0de96f0` (`benchmark_scoreboard.rs:63`)
- [x] CPU-runner flake fix (backend lane flagged) — `cpu_kernel` now guarantees ≥1 work chunk (do-while) so a starved tiny-run scheduled past its short deadline still measures real throughput instead of reading 0 and false-failing the shared green baseline; strong `> 0.0` shape assertion kept + a regression guard (`cpu_kernel_runs_at_least_one_chunk_past_deadline`) pins the contract; `benchmark.rs`, cargo 612
- [x] `normalize()` honesty fail-safe — a non-finite raw score now fails SAFE to 0 (no credit) instead of `Inf`→`.clamp(0,100)`→**100** (a fabricated "perfect" component score, the worst honesty failure). Currently unreachable (producers guard divisors via `.max(1e-6)`/`is_finite`) but guarded at the point-of-use so a future producer-guard regression can't invent a maxed score; invalid reference (non-finite/≤0) also → 0. Regression test pins Inf/NaN/-Inf + bad refs (was untested); real-path byte-identical — `2ee51aa` (`benchmark.rs:461`)
- [x] `completeness_pct()` honesty fail-safe (completeness-critic close-out of the above — the grep'd sibling) — its `ceiling <= 0.0` gate did NOT catch a non-finite input (`NaN <= 0.0` is false), so `+Inf current`→**100** (fabricated "fully optimized") and `NaN`→leaked through `.clamp()`. Now `is_finite` guards both inputs at the point of use, mirroring `normalize()`, so the boundary is uniform + safe-by-construction whenever this still-unwired primitive is wired. comparison::pct (guarded `base>0`, measured-FPS inputs, NaN-delta failure mode) + percentile_rank (u32-derived inputs) assessed safe — class now closed. Regression test pins Inf/NaN; finite-input behavior byte-identical — `dbc8358` (`benchmark_scoreboard.rs:75`)

- [x] **FPS presenter picker: desktop apps winning between matches — FIXED this cycle (0.9.1).**
  Live §6 evidence 2026-07-22 (40-min Marvel Rivals watch) showed the dominant-presenter pick
  wandering to Discord/RadeonSoftware/Code/claude while the game sat closed/loading. Fix is
  positive window evidence + sticky attachment (`fps.rs`): acquisition now requires the candidate
  to own a visible top-level window, be foreground, AND cover its monitor's full bounds (excludes
  the whole windowless-Electron-GPU-process class structurally, no per-app denylist entry needed)
  for `ATTACH_STREAK_TICKS` consecutive ticks; once attached, only that pid is ever reported and a
  silent tick (menu/loading) emits nothing rather than re-picking — never abandoned for a chattier
  presenter, released only when the process actually dies/recycles. `monitoring.rs`'s FPS recorder
  gets a matching freshness gate (<3s mtime) since `fps.json` can now legitimately sit frozen.
  9 new attachment-state-machine tests. cargo 869/869.
- [x] **fps.rs pid-recycle re-check on the "still presenting" path — ✅ FIXED (Q3 of the stabilization
  program).** 0.9.1 review Warning (rust-tauri reviewer, 2026-07-22): `Attachment::Attached`'s
  frames-present arm never re-verified that the pid still mapped to the attached image; only the
  silent-tick arm called `alive(pid, name)`. So the one case that produces a wrong measurement — a
  recycled pid that is actively PRESENTING — was the one case that never reached the check, and real
  frametimes were reported under the dead game's name into `sessions.json`, comparisons, the
  scoreboard and every export. The audit under-stated it: the arm also filtered candidates by pid
  ALONE and reported the STORED name, so a recycled pid arriving under its new ETW-resolved image
  name was still attributed to the old game. Fix: candidates must match pid AND name; `alive` is
  consulted on the frame path as well as the silent one; and a pid presenting under a foreign name is
  treated as a recycle (release) rather than a loading screen (stay attached). Three red-first guards
  in `fps::attachment_tests` — recycle-while-presenting, foreign-image-name, and replacement must
  re-earn the full streak — plus one pinning the ordinary live case. Mutation-proven in both
  directions: dropping the liveness clause fails 1, dropping name matching fails 2. `cargo test
  --lib` 874 passed · clippy `-D warnings` clean.
- [ ] vitest 4th flake class (low): under full-suite worker contention, a file can error at
  collection with "Vitest failed to find the current suite" (seen once 2026-07-22 on the two
  `src/surfaces/setup/` files; both pass isolated AND on full-suite re-run). Not one of the three
  878a3a9 classes. If it recurs, investigate pool/maxWorkers; a single re-run is the current answer.
- [ ] evidence-export tiers — audience-shaped renders of the SAME measured evidence pack (`export.rs`
  today: `export_report` markdown/JSON + Discord block = the technical-ish default): add **Consumer**
  ("what changed, in plain English"), **Technical** (full probe/CI detail), and **Support** ("help me,
  here's my rig + ledger") render tiers over the one data source — presentation-only, no new probes, no
  new claims, honesty invariants shared. The **Shop** tier is NOT this item — it belongs to the parked
  Shop Report Mode (Phase D), don't build ahead of it. Provenance: panel-review brief 2026-07-15 §4.4.
  **Audit confirmed, 2026-07-16 (Cowork):** `export.rs` (824 lines) has exactly ONE render path —
  `build_markdown_report` + `build_discord_block`, no struct/enum tiering at all. **Correction to the
  brief's assumption:** no share-card export exists either (grepped repo-wide) — `docs/BACKLOG.md`'s
  own "Real-wins strip" section already notes the share-card component is a forward-looking idea, "not
  queued as a train." So Consumer/Technical/Support are ALL genuinely new, not a light tiering pass
  over existing variants — size this task accordingly before scoping it as small.
  **→ 🧠 SUBSUMED by Intelligence Phase 5 (2026-07-17, intelligence directive §9):** consumer/
  technical/shop report exports ship as part of the evidence-based Upgrade Advisor 2.0 lane — do not
  build this separately; the audit finding above (one render path, no share-card exists) carries
  forward as Intelligence Phase 5 input.

### A3 · CONTENT reorg (Blackbook/Autopsy) — **half built; missing entry metadata**
- [x] entry dedup lint — `knowledge.lint.test.ts:78`
- [x] category + **hardware tags** on entries — **DONE**. Category: `knowledge-topics.ts` central id→topic map, 10 topics, required `BaseEntry.topic` + lint + Learn "Topic:" filter (`cf77e0b`). **Hardware tags DONE**: `Applicability` enum (AMD/NVIDIA/Intel/laptop/desktop) + central optional `APPLIES_BY_ID` map in `knowledge.ts` (absent = universal), `applies?` on entries, lint validity/completeness guards, Learn "Fits:" filter + per-card tag pills (read-only/advisory; self-reviewed). Topic + applicability labels flagged for owner taxonomy skim.
- [x] date-added / last-updated metadata — **DONE**. Optional central `DATES_BY_ID` map in `knowledge.ts` (id→`{added, updated?}`, ISO YYYY-MM-DD; absent = no date shown, never fabricated), `added?`/`updated?` on `BaseEntry` via a `withDates` pass, `formatEntryDate` TZ-safe "Mon YYYY", lint guards (real ids, well-formed dates, updated≥added), quiet Learn card footer line (read-only/advisory; self-reviewed).
- [x] filter-by-category + verdict UI — `Learn.tsx:578`
- [x] alias-collision lint + CI guard — `knowledge.lint.test.ts:98`
- [x] deprecated/superseded status field — `status` + `supersededBy` on BaseEntry + `lifecycle()` mapper + lint guard (real/different target) + honest Learn surfacing (`aedb3ab`)
- [x] orphaned-`related[]` lint — `knowledge.lint.test.ts:84`
- [x] Autopsy structured schema — versioning/migration added to the PERSISTED store: `autopsy-ledger.ts` now writes a versioned envelope `{ v, entries }` + `migrateLedger()` (forward-only, idempotent, lossless) carries the legacy bare-array form forward and seams in per-version upgrades for future field changes; +10 tests. The transient `AutopsyResult` (`knowledge-autopsy.ts:15`) is recomputed from re-graded text each session (never persisted) → nothing to migrate there (`3e16618`)
- [x] Autopsy "what did we learn?" rollup — `autopsy-ledger.ts`, `Learn.tsx:453`
- [x] local autopsy stats — `autopsy-ledger.ts`, `local-stats.ts`

### A4 · ADVISORY surfaces — **42 of 48 shipped; nothing here is ungated work** (recount 2026-08-05)

> The old "~24 of 33 not built" heading survived the whole lane being built out and read as the
> project's biggest hole. Actual state: **42 `[x]` · 1 `[~]` honesty-capped (NVIDIA/Intel vendor
> badges, withheld under LOCKED Rule 5 — not a to-do) · 5 `[ ]`, and every one of the five is gated**
> — three on owner-curated data that must not be LLM-generated (safe-to-suspend reference, keyboard
> debounce/Snap-Tap detection, sensor-ID known-issue DB) and two behind the outbound wall (ISP speed
> snapshot, DNS resolution-time probe). **Do not pick these up as "next" — none is unblocked.**

**Monitor/Display**
- [x] OSD detection — shipped the feasible+honest reading: `overlay_tools.rs` read-only probe detects third-party in-game overlay/OSD TOOLS running (RTSS · MSI Afterburner · Fraps · Bandicam — only tools whose running process reliably means an OSD is drawn), surfaced as an "On-screen overlays" Diagnostics section so a double-overlay with Compy's own overlay isn't a mystery. Informational only (no perf/FPS claim, no "close it"); curated labels only (live process names never surfaced/sent); honest coverage. Monitor-HARDWARE-OSD reading deliberately NOT attempted (DDC/CI is an unreliable per-monitor honesty-hazard). No new IPC; 8 tests + law guards — `bf0272f`
- [x] 3-mode preset GUIDED checklists (Visual Fidelity / Smooth / Clarity) advisory cards — read-only Monitor panel: 3 named presets bundle EXISTING guided walkthroughs; `src/surfaces/monitor-view.ts` (pure, 7 tests) + Monitor.tsx panel reusing chip/card/btn-small; no IPC/mutation
- [x] vendor-aware monitor walkthroughs — code-injected `vendor-monitor-tuning` display-topic Learn term names the per-brand VRR/HDR/refresh path (AMD FreeSync · NVIDIA G-SYNC · Intel Adaptive-Sync), cross-linked; Monitor presets help now surfaces the detected brand's VRR name; read-only/advisory, no FPS claim; guard `knowledge-vendor-monitor.test.ts`
- [x] FreeSync↔VRB exclusion **advisory** (content) — shipped the honest, feasible form: `freesync-vrb-exclusion` display-topic Learn term (code-injected like GRADING_ENTRY, no tweaks.json count touch) explaining VRR & blur-reduction strobing usually can't run together (pick one); cross-links vrr/gsync-freesync/backlight-strobing; read-only, no FPS claim; guard `knowledge-freesync-vrb.test.ts` (live OSD strobe *detection* stays WALLED per line 62)
- [x] Acer XFA253QZ (and family) model-hint cards — code-injected `monitor-hint-acer-xfa253q` display term (like FREESYNC_VRB_ENTRY, frozen tweaks.json count untouched) + pure `monitorHintsFor()` EDID-model matcher (folded `xfa253q` stem covers the family) cross-linking set-refresh-rate/vrr/freesync-vrb-exclusion; read-only/advisory, no per-SKU number; guard `knowledge-monitor-hints.test.ts` (8 tests). /check + /security clean
- [x] refresh-rate / sRGB / gamma-vs-HDR / chroma debunk Learn entries — added `srgb-clamp`, `gamma-vs-hdr`, `chroma-subsampling` term explainers (factual color-science, debunk woven in, adversarially fact-checked, lint-clean); refresh-rate covered by `set-refresh-rate` + `hz-vs-fps`. Flagged for owner brand-voice skim.
- [x] refresh-rate **myth debunk** Learn entry — `human-eye-fps-myth` ("Can your eye see past 60 fps?") term explainer fills the gap the line above left (set-refresh-rate is a *real* tweak, hz-vs-fps is mechanics — neither busts the "eye can't see past 60/30/24 fps" myth). Honest/balanced (returns-diminish nuance, no fabricated study, no hardware-specific claim), display-topic, cross-linked; guard test `knowledge-refresh-myth.test.ts`. Flagged for owner brand-voice skim. **[honesty audit 2026-06-25: CLEAN — every claim web-verified vs authoritative sources; no fabricated/unmeasured/Rule-5 claim.]**
- [x] **shader-cache-guide vendor-precision fix** (honesty audit 2026-06-25 nit) — the guide's steps were NVIDIA-Control-Panel-specific ("Shader Cache Size → Unlimited/10 GB"), but AMD Adrenalin (our dev-rig vendor) + Intel expose only an on/off Shader Cache, NOT a size knob — an AMD user couldn't find the named setting. Made the steps + undo vendor-aware (NVIDIA size knob vs AMD/Intel on/off + Reset/Clear; AMD path web-verified against AMD's own support docs). bug→guard: `knowledge-shader-cache-guide.test.ts` pins the vendor-awareness so it can't regress to single-vendor
- [x] **driver-update-guide Intel-vendor fix** (completeness-critic pass over guides.json after the shader-cache fix — same defect class) — step 1 said "AMD's or NVIDIA's own site or app", stranding Intel GPU owners (Arc discrete + iGPU); now "AMD's, NVIDIA's, or Intel's". The other 6 guides surveyed clean (vrr names Reflex+Anti-Lag 2, xmp names XMP/EXPO/DOCP, fan-curve/fps-cap/startup vendor-neutral). bug→guard: `knowledge-driver-update-guide.test.ts` pins all-three-vendor coverage
- [x] **Autopsy truncation-note single-source fix** (fresh Learn.tsx read, stop-hook deeper pass) — the over-cap note hardcoded `(100000)` instead of the exported `AUTOPSY_MAX_CHARS` that drives the actual truncation (a "one source, can't drift" violation: a future cap change would make the note lie about how much was graded). Values coincide today (no user-visible bug) → latent-drift hardening. Now uses the constant. bug→guard: render test in `Learn.test.tsx` pins the displayed char count to `AUTOPSY_MAX_CHARS`
- [x] monitor model detection (EDID / WmiMonitorID, read-only) — `hardware.rs:1879`

**GPU**
- [~] vendor profile detection + advisory badges — **AMD half DONE + guarded** (`vendorProfileInsights`,
  GpuProfile — Adrenalin-named HAGS/power-mode/thermal insights, no perf promise; guard
  `src/data/gpu-sensor.test.ts`). **NVIDIA/Intel deliberately WITHHELD under LOCKED Rule 5**, not
  unfinished — this `[~]` means "as complete as the honesty rule permits", never a to-do.
- [x] GPU-temp honesty gate consolidated to ONE source (`gradeGpuTempForVendor`, gpu-sensor.ts) — fixed a LIVE Rule-#5 violation (SessionDebrief graded NVIDIA temp bare); Play + DashboardV2 dedup'd onto it so it can't drift again (found by the 2026-06-24 workable-now audit; guard test added)
- [x] **[honesty]** tweak-debunk corpus fact-check (`tweaks.json`, all 84 entries) — **COMPLETE** (8 adversarial web-verified sub-agents): zero false-`real`/`risky` verdicts, zero surviving fabricated numbers. Three factual fixes landed by honesty (sysmain GB-number · fTPM misattribution · defrag-SSD "not a defrag" falsehood); verdict/voice handoff (timer-resolution re-grade + wording nits) processed by content. Regression guard `tweak-honesty-guard.test.ts` pins the three corpus fixes. Ledger: `docs/HONESTY_AUDIT_TWEAKS.md`
- [x] **[honesty]** new-Learn-entry audit + terms-corpus regression guard — audited all 8 net-new term explainers (human-eye-fps-myth · powerline/MoCA · keyboard×3 · amd-undervolting · eDPI) + the driver-update-guide Intel fix = CLEAN; caught + fixed one falsehood (`rapid-trigger` claimed Snap Tap/SOCD "banned in CS2 & Valorant" — Valorant actually PERMITS it, VCT §2.3.5). bug→guard: new `terms-honesty-guard.test.ts` pins that Valorant is framed as currently allowing it (the content keyboard guard only pins the generic ban/restrict/rules property, so the false game-list could have regressed green) — `terms-honesty-guard.test.ts`
- [x] **[honesty]** full metric-grading sweep for the NVIDIA-sensor Rule-5 gate — every authoritative GPU-temp grade routes through `gradeGpuTempForVendor` (Overlay/LiveCharts/DashboardV2/Play/SessionDebrief); the tuning path (TuningDebrief/Instrument/Verdict + `gpuRunningHot` nudge) is AMD-walled via `tuningGuideForVendor`; no live gap. Closed a COVERAGE hole in the guard: `gpu-temp-gate-guard.test.ts` now scans production `.ts` too (was `.tsx`-only), allowing only metric-grade.ts + gpu-sensor.ts — a `.ts` helper can no longer bypass the gate (`755f931`)
- [x] per-game / global scope picker (UI only) — `GpuProfile.tsx` scope pills (Global / Per-game) bound to `useGpuProfileScope` over a guarded `GPU_SCOPE_KEY` localStorage value (`profile-store.ts`); advisory viewing lens only (frames which slice you look at — no Windows setting / tweak / IPC), cross-window storage relay, accent-ink on-fill legibility, 18 tests
- [x] before/after delta display (for profiles) — read-only/advisory: pure two-snapshot GPU-profile diff (vendor/model/driver/HAGS/power-mode/peak-temp) → same/changed/**unknown** (a missing read is never inflated into a change) + signed peak-temp delta (down=cooler, no FPS claim). `gpu_profile.rs` pure core (10 tests) + `gpu-profile-store.ts` engine/local-store (14 tests) + a `GpuProfileDelta` card added into `GpuProfile.tsx` beside the scope picker (10 surface tests total); zero mutation/IPC/network. NOT the gated Phase-B apply/rollback. Card renders in the surface; parent supplies the live snapshot + the Rust core is wired to a command later (dark, `#![allow(dead_code)]`).
- [x] GPU profile export (JSON) — read-only/advisory: `build_export` + `export_json` in `gpu_profile.rs` bundle the two (optional) snapshots + recomputed deltas + honest summary + `any_change` into a versioned (`schema_version`/`kind` discriminator) pretty-JSON shareable payload; recomputes via the live delta funcs so it can't drift, keeps the honesty invariants (unread=unknown, no FPS/perf claim), serializes cleanly with a missing side. 5 new tests (20 in module); pure — zero mutation/elevation/IPC/network. Dark (`#![allow(dead_code)]`), wired to a command/surface later.
- [x] version-pinned mismatch warning — read-only/advisory: when the two GPU snapshots weren't pinned to the same driver version AND a measurement (peak temp) also moved, an honest amber banner warns the before/after is confounded ("re-capture both on the same driver"), never a fabricated warning on a missing/unchanged driver read, no FPS/perf claim. `gpu_profile.rs` pure `version_mismatch`/`VersionMismatch` (5 tests) + `GpuProfile.tsx` `versionMismatch` derive + banner (3 surface tests, self-reviewed at native res); zero mutation/IPC/network
- [x] AMD undervolting guide (AMD-verified; NVIDIA/Intel withheld per Rule 5) — `amd-undervolting` power-topic term: splits the safe/reversible Radeon GPU path (Adrenalin, the one Compy guides) from the risky/advanced Ryzen CPU path (BIOS PBO/Curve Optimizer); cross-links amd-gpu-undervolt + pbo-curve-optimizer; no FPS promise, silicon-lottery caveat, NVIDIA/Intel explicitly withheld per Rule 5; guard test (`dd7e4e8`)

**Services**
- [x] read-only service inventory by category — `services.rs` (new): WMI enumerate-all → 9 plain-English gaming-relevant categories (vendor/launchers/anti-cheat/Xbox/perf/telemetry/updates/app-updaters/search), live state + factual descriptions, honest "<n> recognised of <m> total" coverage; folds into `get_diagnostics` (no new IPC, zero frontend change); pure-core unit-tested; inventory-not-advice (no safe-to-suspend judgement) — `b5b16b0`
  - [x] coverage expansion — added **Riot Vanguard** (`vgc`, the Valorant/LoL anti-cheat the category was missing), **GOG Galaxy** (`GalaxyClientService`), **NVIDIA Container** (`NvContainerLocalSystem`); faithful inventory-not-advice facts, exact-match (still never guessed), + no-duplicate-Name catalog guard — `32146bc`
- [ ] curated "safe-to-suspend" reference data (must be owner-curated, never LLM-generated) —
  🔻 **demotion-flagged 2026-07-17 (intelligence directive §0.12):** doesn't feed the intelligence
  platform; already blocked on owner curation, so nothing changes until he supplies the list.
- [x] use-case profile selector (Gaming/Streaming/Creation/General — localStorage) — `src/data/profile-store.ts` + `src/hooks/use-profile.ts`, surfaced as an advisory "What you mostly do" card on Benchmark; LOCAL label only (frames measurements; no Windows setting / tweak / service touched), guarded readers + cross-window storage relay; 17 tests; no new IPC
- [x] service-drift detection (extend Leftovers) — `services.rs`: closed curated catalog (Windows Audio · Audio Endpoint Builder · Themes) flagged when startup drifts from stock Automatic (Manual/Disabled only; Boot/System/Unknown never guessed; absent never flagged); receipts + origin-uncertainty + honest nothing-found; folds into Diagnostics, no new IPC; 10 pure tests incl. law guards (no boost/alarm; catalog can't target a Compy-endorsed disable) — `bd170ce`
- [x] recovery guide — `services.rs`: pure `build_recovery_guide` attaches by-hand, plain-English services.msc restore steps to drift findings (Automatic startup → Start); reference data, NO mutation (Compy performs none); names the exact affected services from the curated const catalog; honest origin-uncertainty + grammar/law guards; folds into Diagnostics as "Background services · How to restore", no new IPC; 5 tests — `a5d5cca`
- [x] recovery guide — **dependency ordering** (correctness fix): when a drifted service's curated prerequisite is ALSO drifted (Windows Audio → Audio Endpoint Builder), restore the prerequisite FIRST + one honest ordering step (else the user hits "a dependency service or group failed to start" following the guide top-to-bottom); note appears only when both are off (never lecture); closed curated fact, not a live WMI dependency read; read-only, `services.rs` only, +4 tests — `89488fb`

**Peripheral** (no Peripheral surface exists in the rail — whole section missing)
- [x] mouse DPI / genre audit — handed off to content (DPI isn't OS-readable → can't be a hardware-tailored peripheral card); shipped as the `effective-sensitivity` (eDPI) input-topic Learn entry: eDPI = DPI × in-game sensitivity is the number that decides aim feel, match it (not just DPI) to copy a setup; names the can't-read-DPI limit + the 400–800 (rarely >1600) rule-of-thumb; no FPS claim; guard test (`bcf7316`)
- [ ] debounce / Snap-Tap / Null-Bind / Rapid-Trigger detection — 🪪 **owner-curated-data-gated**
  (assessed 2026-07-05): whether the feature is *enabled* is firmware/vendor-software state — not
  user-mode readable (no standard HID report; same wall class as [[detection-feasibility-walls-usermode]]).
  The only honest buildable form is capability *inference*: match the connected keyboard's product name
  (already read — `latency.rs` PnP enumeration, real names + VID&PID) against a device→capability list —
  and that list is per-SKU claims about users' hardware, the owner-curated-never-LLM-generated class
  (same rule as safe-to-suspend above). Content half already shipped (`rapid-trigger`/`keyboard-actuation`
  Learn terms). Unblocks when the owner curates the device list. 🔻 **demotion-flagged 2026-07-17
  (intelligence directive §0.12):** doesn't feed the intelligence platform; already curation-gated.
- [ ] sensor ID + known-issue DB (bundled JSON) — 🪪 **owner-curated-data-gated** (assessed 2026-07-05):
  the sensor silicon inside a mouse is not exposed over USB/HID (only the mouse's own product name is —
  already read, `latency.rs`); model→sensor mapping + "known issues" are third-party teardown claims =
  the owner-curated-never-LLM-generated class. Unblocks when the owner curates the DB.
  🔻 **demotion-flagged 2026-07-17 (intelligence directive §0.12):** doesn't feed the intelligence
  platform; already curation-gated.
- [x] wired-vs-wireless latency model — honest conservative wireless-name advisory, read-only (`27f3651`)
- [x] keyboard actuation / NKRO / Rapid-Trigger guide — `keyboard-actuation` + `nkro` + `rapid-trigger` input-topic term explainers (pairs with peripheral's switch detection). Honest: actuation = a speed-vs-misfire feel preference (not skill/FPS); NKRO = inputs-not-dropped (not speed); Rapid Trigger needs HE/analog hardware and is **anti-cheat-aware** — flags that Snap Tap / SOCD is banned in CS2 (Valorant currently permits it — honesty fix), rules differ by game, and Compy enables/recommends nothing your game forbids. No fabricated specs. Guard test `knowledge-keyboard.test.ts`. Flagged for owner brand-voice skim.
- [x] USB-port recommendations — both halves shipped: SHARING (`shared_controller_advisory`) + TIER (`usb_tier_advisory`: honest 2.0-fine-for-input + 3.x/USB4 myth-buster, read-only, owns the tier dimension only — never re-issues the "move device X" call) (`9a045d9`)
- [x] **(backend signal)** per-rig USB top-spec exposed for the tier advisory — `hardware::detect_usb_top_spec() -> Option<String>` (capability tier only; `"Unknown"`→`None`); unblocks peripheral's USB-tier port half — `84a2af1`
- [x] polling-rate read — `latency.rs` (`latency_measure_mouse`)
- [x] interrupt-affinity suggestion — deepened into a NAMED read-only suggestion (multi-CCD + latency-sensitive devices named; never writes affinity) — `affinity_device_suggestion` (`e5d2356`)

**Network (detection only)**
- [x] connection-type classification (wired/Wi-Fi/other) — `hardware.rs:1788`
- [x] Wi-Fi link quality (band · signal% · link-rate) — enriches the network-connection advisory when on Wi-Fi (read-only `netsh wlan`; parser unit-tested; not verifiable on the wired dev rig)
- [x] wired-port-aware Wi-Fi nudge — on Wi-Fi AND a wired Ethernet port exists → names it ("plug it in") instead of the hedged "if you can run a cable" (read-only, reuses `has_wired_ethernet_port`; unit-tested)
- [x] wired link-speed detection — `hardware.rs`: negotiated wired Ethernet rate (MSFT_NetAdapter.Speed, reuses the existing adapter query — zero-outbound, NOT the 📡 ISP/DNS class); pure `active_wired_link_speed` + `format_link_rate`; readiness pill (neutral gigabit+, advisory ≤100 Mbps) + Diagnostics "Wired link speed" row with honest note (low link = old cable/port, still fine for gaming); 5 tests — `6f3f7dd`
- [ ] ISP speed snapshot (local) — 📡 outbound-gated (a real throughput test must download from a server = first outbound call, same wall as the DNS probe); only the zero-outbound NIC link-rate above is feasible without owner sign-off. 🔻 **demotion-flagged 2026-07-17 (intelligence directive §0.12):** doesn't feed the intelligence platform; already outbound-gated.
- [x] network-readiness pills (backend signal) — `hw.network_pills: [{label,tone}]` on HardwareInfo, derived read-only from adapters/Wi-Fi/QoS/wired-port (zero-outbound, no new probe/IPC); tones good/neutral/advisory/unknown mirror the network-connection readiness honesty; 6 pure tests; UI half = content/peripheral — `490e081`
- [x] network-readiness pills (**UI half**, peripheral) — calm color-coded chips in the Latency surface ("Network connection" card, the online-latency axis); renders the authoritative `hw.network_pills` signal via a narrow `get_hardware_info` read (Benchmark `RigSpecs` precedent — the surface has no `hw` in scope); honest tones (`advisory` = calm accent, never amber/alarm; unknown future tone → neutral), card hidden when unread, no FPS promise; pure `networkPillTone` + 4 tests; live self-reviewed — `b33fcd4`
- [x] Wi-Fi channel / interference — `channel` surfaced on 2.4 GHz + overlap advisory (only 1/6/11 don't overlap → switch router or to 5 GHz); read-only, parser already read it, unit-tested
- [ ] DNS resolution-time probe — 📡 outbound-gated (a resolution-time measurement IS a live DNS query = outbound call; held at the same wall as the ISP snapshot above — Cycle 2026-06-25d flagged it as gated). 🔻 **demotion-flagged 2026-07-17 (intelligence directive §0.12):** doesn't feed the intelligence platform; already outbound-gated.
- [x] powerline / MoCA Learn guides — `powerline-ethernet` + `moca-ethernet` term explainers (network topic): honest no-new-cable wired-grade options for rooms you can't run a cable to. Both name the real win (ping/stability over Wi-Fi, NOT FPS), the practical catches (powerline ← wall-not-surge-strip, circuit-dependent; MoCA ← coax both ends + PoE filter), and when to prefer each. Cross-linked to `wifi-vs-ethernet-fps`; no fabricated speeds. Guard test `knowledge-powerline-moca.test.ts`. Flagged for owner brand-voice skim.
- [x] QoS advisory — read-only Policy-based-QoS detection (HKLM+HKCU `…\Windows\QoS`); surfaces a named Advisory ONLY when a policy exists (no clutter when clean); honest "as-found, not a problem on its own" framing; unit-tested

### A5 · GUIDED SETUP & VERIFICATION + PARAMEDIC — **half built; clean finishable gaps**
- [x] Setup-Complete state machine — `FirstCheck.tsx`, `Onboarding.tsx`
- [x] post-apply verification gate (re-run probes) — `use-scan.ts`, `Check.tsx:293`
- [x] green/yellow/red confidence chips (color-coded) — `Check.tsx:298`
- [x] exportable setup summary — dedicated "Setup summary" card in Check (`buildSetupSummary` in `use-scan.ts`, copy-to-clipboard, read-only/advisory, zero IPC)
- [x] Re-Run Setup / re-baseline flow + overflow handling — `useHardwareChange` hook owns detect→acknowledge ("this is my rig now"); `summarizeHardwareChanges` caps change lines to "and N more" so a big multi-part swap never floods the card (`use-hardware-change.ts`, `Check.tsx`)
- [x] **hardware-change detection** — wired into Check (Optimize→Fixes): advisory card names what changed + inline acknowledge/re-baseline (`acknowledge_hardware_changes`) so it never nags; live-verified 2026-06-24
- [x] override toggle — "Restore all (N)" bulk control in the Dismissed strip (Fix.tsx, ≥2 dismissed, reversible, zero IPC)
- [x] drift-watch integration — `drift.rs`, `Check.tsx:325`
- [x] historical-ledger surfacing — `Fix.tsx:712`
- [x] applicability check + override — eligibility filter + A5 override: "My hardware supports this" on capability-gated recs in the Not-for-this-rig pile; rec rejoins the normal flow through the SAME audited apply path; reversible, decision kept on record ("overridden by you" + Compy's original read + "Set aside again"); localStorage pref (`eligibility-override.ts`), zero IPC — `c6c00a4`
- [x] obsolescence/superseded flags + supersession CHAIN — pure `supersessionChain()` (cycle-safe, missing-target-safe) resolves transitively; Learn's superseded note links the CURRENT end of the line + names multi-hop paths; corpus lint pins chain termination — `d060b07`
- [x] before/after delta display — full pair everywhere: TrustSnapshotLine appends " · set to <after>" ADDITIVELY (locked kernel-§6 sentence verbatim, test-pinned); Fix + CommandCenter pass the typed applied_label — `2f5b675`
- [x] "last seen working on" hardware tag — AppliedChange stamps `hw_fingerprint` at apply time (ONE receipt funnel covers all paths); `on_this_rig` computed driver-INsensitively (gpu·ram·display); history receipts + active cards show "Last seen working on <gpu · ram> — before your hardware changed"; legacy entries stay honest "rig unknown" — `2f5b675`
- [x] per-tweak audit trail — `Fix.tsx:423`
- [x] ledger filter "this rig only" — History checkbox, rendered only when some entry is KNOWN to be from other hardware; hides exactly those (legacy unstamped rows never hidden); hidden count named — `2f5b675`
- [x] measured-payoff linkage — per-tweak honest payoff meter: `payoff_label_from_action` (history.rs) names the KIND of gain (input latency / background CPU&RAM / network / power&thermal / …), never a fabricated number; rendered as a quiet advisory chip on active + history ledger rows (Fix.tsx)
- [x] pre-room intent router — the Lab's symptom router ("What are you here to do?", shipped 2026-07-05;
  its `compy_lab_guided` flag was retired in the 2026-08-06 generation prune — the router is now
  unconditional, `LabConsole.tsx:17` ← `lab-guided-data.ts`) covers IN-Lab wayfinding; the remaining gap is the **pre-room-selection entry
  point**: a first-class "what brought you here today?" entry on Home routing to Monitor / Blackbook / Lab by
  intent, so a non-technical user never has to know which room owns their problem. Scope ONLY that entry
  gap — don't rebuild the in-Lab router. Provenance: panel-review brief 2026-07-15 §4.2.
  *(2026-07-17, intelligence directive §9: complementary to the intelligence surfaces — stays
  queued, NOT demoted and NOT part of the intelligence trains.)*
  **BUILT 2026-07-18 behind DEFAULT-OFF flag `compy_home_intake`** (reversible; classic Home byte-identical
  when off). Owner greenlit A+C, declined B (2026-07-18): the intake band renders on HomeConsole as intent
  ROWS *above* the room doors (option A — problem-first: symptom → the room that owns it), PLUS an
  always-available one-tap "does-it-all" fast path (option C — applies every safe-and-ready fix through the
  audited applyBatch path, honest singular/plural counts, confirm-gated). **Gate 1b (door-level hints)
  DECLINED by me** — the intake band already carries the symptom→room mapping; duplicating it onto the doors
  is the "annoyance" the owner warned against, so the dock stays clean room-name doors. Taxonomy in
  `src/surfaces/home-intake-data.ts` (`HOME_INTAKE_ROWS`); one-owner stand-down so the play/"last session"
  row yields to the LAST SESSION verdict block when it renders (self-reviewer rubric-3 catch → bug→guard
  `home-intake.test.tsx`, 15/15). Self-reviewer **PASS** (both catches — session-question duplication +
  disabled-button hover leak — verified fixed with live-DOM/computed-style proof; full pass, no regressions).
  tsc clean. **The default-ON/ship call is MINE** (2026-08-07 taste decree) — was parked on the owner
  under the slim-down-flag precedent; now: ship it and hand him a before/after to veto on sight, don't
  wait. Symptom→ROOM map surfaced in the ship report.
- [x] basic-mode simplification — SCOPE-CHECK FIRST, build only what's missing: FirstCheck's one-verdict
  flow + verdict cards + the answer-first Home already cover most of "one screen, one verdict, one
  action"; audit that flow against the panel's basic-mode ask and close only genuine gaps (no parallel
  "simple mode" build). Provenance: panel-review brief 2026-07-15 §4.8. *(2026-07-17, intelligence
  directive §9: complementary consumer-clarity work — stays queued, NOT demoted.)*
  **Scope-check done, 2026-07-16 (Cowork), against `FirstCheck.tsx`, the persona's 5-point ask:**
  (1) one verdict — **covered** (`fc-verdict` headline). (2) one recommended action — **covered**
  (#1-limiter spotlight, single Apply button). (3) one visible explanation of *what changes* —
  **partial**: the spotlight shows `top.reason` (why it's a limiter) but nothing on this screen
  states the actual before→after value. (4) one visible explanation of *how it's restored* — **real
  gap**: "Compy snapshots the prior state so you can roll this back anytime" only appears inside the
  confirm-dialog you see AFTER clicking Apply, not as a standing line on the verdict card itself — a
  user who doesn't click Apply never sees it. (5) one next-step-after-playing — **covered** (footer:
  "Play something tonight; the session debrief will tell you..."). Net: this is a small, well-scoped
  copy/layout addition (surface the restore-guarantee line + a plain what-changes line on the
  existing verdict card), not a new flow.
  ✅ CLOSED 2026-07-18. Gap (4) FIXED: the restore-guarantee now renders as a **standing line**
  on the #1-limiter spotlight card (`.fc-spotlight-reversible`, `FirstCheck.tsx`), gated on
  `recFor(top)` (only when there's an applyable fix — a hands-on fix has nothing for Compy to roll
  back), with the ↺ mark in `--ready`. Same true promise as the confirm-dialog body (LOCKED rule 3
  makes it honest); appears before any Apply click. Gap (3) before→after value **intentionally NOT
  built** — `PriorityItem`/`ScanRecLite` carry no such value on this surface, so a stated value would
  be fabrication (no-fabrication law); the existing `top.reason` + "Expected impact · not yet measured
  on this rig" chip already give the honest what/why. bug→guard: `FirstCheck.test.tsx` "surfaces the
  restore-guarantee as a standing line" (4/4 green). Self-reviewer PASS (contrast 6.16:1 muted /
  10.22:1 mark, 12px gap no overlap, no duplication). tsc clean.

### A6 · UPGRADE-PATH advisory — **complete** (affiliate tags = Phase D)
- [x] hardware-limited verdict detection (GPU≥95% / HDD install drive) — `priorities.rs:95`
- [x] `build_upgrade_path` single source — `priorities.rs:106`
- [x] session-qualified copy — `priorities.rs:109`
- [x] copy-only buttons (no URL opener) — `Check.tsx:207`
- [x] plain retailer links (no tags) + disclosure — `priorities.rs:81`
- [x] markdown-export anchors — independently tested: anchor-format integrity for EVERY RetailLink (count parity, well-formed Markdown, https-only, export-layer tracking-marker ban mirroring the priorities guard) — `2f698e4`
- [x] test "no tags + disclosure always paired" — comprehensive affiliate/tracking guard over ALL retail links (const tables, 12 markers, https-only) + single-item disclosure pairing locked (`priorities.rs` tests)

---

> **UI SLIM-DOWN TRAIN** (council-approved 2026-07-01) — SHIPPED: P1–P3 + deep-cleans landed, all four flags default-ON since `733f132`; its P2 taste notes are point-in-time (pre-HUD Monitor, pre-rail-relabel). Moved verbatim to `BACKLOG_ARCHIVE.md` (2026-07-22).

---

## PHASE B — Gated mutations 🪪 (LOCKED rule 6: owner product decision + per-feature QA + welfare-check)
- [ARMED 2026-06-25] session service-suspend — `service_suspend_gate()`==**true** (QA passed: running-service
  exact-restore + UAC-cancel=no-partial + critical-blocked; owner sign-off) + selection UI in `GamingMode.tsx`.
  Boundary re-verified clean (no new IPC/capability; production elevation untouched). ✅ shipped in the 2026-06-26 rebuild
  (NSIS `512DAFF3…`) — NOTE (2026-06-27): installer superseded since; reinstall is Claude's job (silent-reinstall law), not an owner action. Current installer + live state → `docs/RELEASE_STATE.md`.
- [ARMED 2026-06-26] telemetry scheduled-task disable (debloat) — `bloat_removal_gate()`==**true** (QA passed:
  exact disable→enable restore + UAC-cancel=no-partial + off-list/Defender rejected; owner curated list = all 3 +
  sign-off "run all 3") + Fix-surface UI (`DebloatTasks`, reversible via Trust Ledger). ✅ shipped in the 2026-06-26 rebuild
  (NSIS `512DAFF3…`) — NOTE (2026-06-27): installer superseded since; reinstall is Claude's job (silent-reinstall law), not an owner action. Current installer + live state → `docs/RELEASE_STATE.md`.
- [⛔ WALLED 2026-07-01] GPU profile apply (AMD) — **blocked by rollback-first (LOCKED rule 3).** AMD GPU
  profile state (Anti-Lag/Enhanced-Sync/Tessellation/Sharpening) is NOT user-mode readable (lives in
  Adrenalin's private store; registry exposes only `*_component_na` capability flags — see
  [[detection-feasibility-walls-usermode]]). `amd_freesync.rs` ADLX FFI is read-only (FreeSync), no write path.
  Can't snapshot the true prior → must REFUSE per [[mutation-snapshot-failsafe-idiom]], not apply. Only `KMD_Chill*`
  is readable (low-value, driver-fragile). Excluded unless a full vendor-SDK write+read path is built (big project).
- [BUILT-DARK 2026-07-06] bloat removal → **preload-app removal** — owner nod given 2026-07-06 after a scope
  discussion (spec `docs/superpowers/specs/2026-07-06-preload-app-removal-dark.md`): the `HKCU\Run` DELETION half
  was **dropped** (the reversible startup disable already ships — `set_startup_entry_enabled`, same flag Task
  Manager flips; deleting the leftover line buys tidiness at real rollback cost) and the buildable half is
  **per-user UWP preload-app removal**, now built dark: `KnownPreloadApp` typed allowlist (4-app starter set,
  Store-published + no-user-data rules; Clipchamp/To Do excluded as data-adjacent; **Spotify cut by owner
  curation 2026-07-06** — same package id as a real install, no honest "stub" framing), `preload_removal_gate()`==false,
  snapshot-or-refuse apply (live PackageFullName/FamilyName/Version read, verified-gone re-read), two-tier honest
  undo (silent re-register verified by re-read, else Store-page hand-off returns Err so the ledger entry stays
  active), gated `remove_known_preload_app` + read-only `get_preload_apps`, dark-safe `PreloadApps` Fix card
  (renders nothing while dark, test-pinned). **Arming rides its own gate:** live QA harness
  (`qa_remove_then_reinstall_round_trip`, #[ignore]) + Store ProductId link-verification + owner curates the final
  list + explicit sign-off.
- [~] one-click re-apply — **SPLIT (audit 2026-08-03), because the single `[~]` read as one
  half-built thing and it is two separate states.** ① **batch-apply primitive: DONE + guarded** —
  `apply_recommendations_batch`, IPC-registered, invoked from App; parity guard
  `src/appliable-parity.test.ts` pins the FE/BE `APPLIABLE_REC_IDS` lists against drift.
  ② **a dedicated "re-apply everything that drifted" button: NOT BUILT** — only per-item re-apply
  exists. Original note: `apply_recommendations_batch` (`history.rs:528`,
  validates `APPLIABLE_REC_IDS`, single-consent + ONE UAC) wired at `App.tsx:772` on the QA-closed apply path.
  A dedicated "re-apply everything that drifted off in one click" button would be a small UI add on top if wanted.
- Gaming Mode (F1) — built, **gate still false**; needs physical-reboot QA + owner sign-off.
- [x] `--run-elevated` boundary-side guard (defense-in-depth, owner-approved 2026-07-14) — **SHIPPED
  2026-07-15.** Chosen lock: a ONE-TIME dispatch ticket over the HMAC option (no crypto dep, nothing
  secret to steal, stronger one-shot semantics). `run_elevated_powershell` mints a ticket file
  (`%APPDATA%\Compy\runtime\elev-<pid>-<seq>.ticket`, content = the exact command hex) and passes its
  path as a third argv (`mint_elevation_ticket` `actions.rs:1149`); the helper refuses any hex that
  doesn't byte-match the ticket (exit 3, runs ZERO PowerShell) and consumes it before running
  (`consume_elevation_ticket` `actions.rs:1171`, `run_elevated_helper` `lib.rs:69`, argv `main.rs:12`)
  — so a dispatch executes at most once and replay is dead. Exact-match against what the parent just
  minted ⇒ can never false-reject a legitimate apply (every builder passes by construction — the hard
  requirement). Honest attribution kept: mint failure = third pre-launch nothing-ran refusal
  (`elevation_error_nothing_ran`); exit 3 reads approved-but-failed; decline path cleans the ticket up.
  Guard tests both directions incl. end-to-end helper refuse/replay (cargo 724/0, clippy clean).
- [ ] **"Optimization Cleanup"** (name locked by the owner) — find + classify the residue OTHER tools/guides
  left behind (registry keys, services, scheduled tasks, orphaned tweak-pack artifacts) as
  useful / placebo / risky / outdated / unknown, and offer restore ONLY where the prior/default is
  unambiguous. **Own spec'd train: research → spec → scope-gate — never a same-session build.**
  Mutation-adjacent ⇒ full mutation-gate before any apply path exists. ~~restores ride a SEPARATE
  recovery-snapshot mechanism~~ — **fork RESOLVED by the owner 2026-07-16: restores REUSE the
  Trust Ledger** (provenance `leftover_adopted`, already built) — one rollback story, one audited
  persistence path; a second snapshot store would duplicate the H1/atomic-save machinery and
  fragment "undo everything" across two ledgers.
  Distinct from UI_VISION_BACKLOG §F (upgrade-path engine) — different feature, don't conflate.
  Provenance: panel-review brief 2026-07-15 §4.1 (`docs/reviews/2026-07-15-cc-brief-panel-review-execution.md`)
  + archived review (`docs/reviews/2026-07-15-consumer-panel-review.md`).
  **Research stage DONE, 2026-07-16 (Cowork):** spec at
  `docs/superpowers/specs/2026-07-16-optimization-cleanup-research-spec.md`. **Headline finding: this
  is mostly already built.** `leftovers.rs` (9 detectors) ships live read-only today; 7 of 9 already
  have typed rollback resolvers built + fixture-tested in `actions.rs`, dark only behind
  `restore_gate()==false` + no Tauri command registration (Leftovers v2, `docs/superpowers/specs/
  2026-06-11-leftovers-v2-dark-wave2.md`). Genuinely new: broader detection (registry/service/
  scheduled-task residue beyond the 9 curated settings), a formal 5-bucket taxonomy, and — the one
  real architectural fork — this BACKLOG entry said restores need a "SEPARATE recovery-snapshot
  mechanism," but the already-built dark path reuses the Trust Ledger with a `provenance` tag
  instead (fork RESOLVED to reuse — owner 2026-07-16, see above). Phasing per the spec:
  **Phase 0 SHIPPED 2026-07-16 (`55f68b6`)** — read-only audit live as a first-class Check section
  under the locked name. **Phase 1 SHIPPED 2026-07-16** — full mutation-gate run: owner-present
  live-UAC QA (W32PS/MPO/memcompress loops ALL PASS, memcompress scripts made state-aware),
  `restore_gate()` armed + `restore_leftover` registered, armed-world tests, QA receipts cleaned
  (owner call). Backend-only — no FE restore button yet; that UI is its own later train.
  **Remaining (still not scope-gated — not authorized to build):** Phase 2 (5-bucket taxonomy) →
  Phase 3 (net-new detection surface: registry/service/scheduled-task residue beyond the 9 curated
  settings; candidate detectors from Phase 1 QA: prefetch-sibling flags off, SysMain disabled).
  **Intelligence-platform relationship (2026-07-17, directive §0.11/§9):** Cleanup stays its OWN
  lane on its own mutation-gate discipline — never folded into intelligence trains — AND is a data
  source for the platform (external drift in Compy-managed settings + tweak-pack residue surface as
  timeline events); its Phase 2 taxonomy reuses the shipped real/placebo/risky vocabulary, which is
  the same grading language the intelligence layer must use. (These are Cleanup Phase numbers, not
  Intelligence Phase numbers — see the 🧠 lane's namespace rule.)

## PHASE C — Outbound capabilities 📡 (separate gates; each ships DARK before arming)
- [ ] **Tier 1 signed case knowledge** — owner-approved direction under #91; new Rust-side advisory
  module, separate trust domain, signed download only, local match, no machine-data upload.
- [BUILT-DARK] **Tier 2 precursor: Receipts** opt-in consent UI + payload preview —
  `receipts.rs`, `ReceiptsConsent.tsx` (gate off; no transport).
- [ ] **Tier 2 scrubbed incident fingerprint** — separate spec/consent/schema/retention gate; not
  authorized by Tier 1.
- [ ] **Tier 3 explicit case evidence upload** — separate per-case preview/redaction/recipient/
  retention/deletion gate; never background or inherited consent.
- [ ] bufferbloat/speed-test send · jitter/packet-loss · session network telemetry · A/B preset
  efficacy · ISP/ZIP lookup — each still needs its own exception record; no blanket Phase C unlock.

## PHASE D — Money / distribution 🔒 (owner territory — DEFERRED per current 1.0 focus)
- [BUILT-DARK] License / Pro gate scaffolding — `license.rs`, `ProGate.tsx`, `pro.ts`
- [ ] affiliate tag-swap · compy.gg waitlist funnel · Receipts arming · leaderboard · Pro multi-rig · B2B
- [PARKED] **Shop Report Mode** — B2B evidence workflow for repair/optimization shops (pilot scope when
  unparked: job name → before scan → approved changes → after scan → rollback availability → signed
  export). Logged for traceability ONLY — do NOT build ahead of B2B traction (MONETIZATION_PLAN Layer 4
  posture: "no page until you ask"); the Shop render tier of the A2 evidence-export item defers here.
  Provenance: panel-review brief 2026-07-15 §4.7.
- Funnel go-live mechanical steps parked in `docs/cowork-cc-relay/2026-06-15-funnel-golive-todo.cc.md` (owner-initiated).

---

> **✅ Phase-A closure (verified 2026-07-01):** no unchecked, non-gated, cleanly-buildable Phase-A `[ ]` item remains — the 5 open rows are all gated/walled: safe-to-suspend data (owner-curated) · peripheral debounce/Snap-Tap/Rapid-Trigger *detection* + sensor-ID DB (user-mode firmware-read wall, same class as DPI/line 355) · ISP-speed + DNS probes (📡 outbound-gated). Remaining VALUE is Phase B/C/D (gated). Supersedes the stale "Bottom line" below.

> **Bottom line (2026-06-23)** — superseded by the Phase-A closure note above; moved verbatim to `BACKLOG_ARCHIVE.md` (2026-07-22).
