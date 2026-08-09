# Capability Exception Policy Rails — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: use superpowers:executing-plans to implement this plan task by
> task. Use test-driven-development for every guard. PR #90 @ `c2868bc` now records exact
> current-head gates; do not begin until its missing independent review and merge/disposition are
> recorded, and rerun those gates if its head moves.
>
> **Handoff state:** the #91 preparation branch already contains the proposed canonical policy and a
> seeded `src/capability-exception-policy-guard.test.ts` with mutation-style positive controls. Do
> not recreate or defer that guard; rebase, run it first, and evolve it in the same policy commit if
> current main has changed.

**Goal:** Land the approved Capability Exception Gate as mechanically protected policy while keeping
runtime behavior unchanged.

**Architecture:** Canonical standing law lives in `CLAUDE.md` and
`docs/ARCHITECTURE_LOCKS.md`; `docs/RELEASE_STATE.md` records present runtime truth; BACKLOG owns
priority. Tests pin the law and prevent a blanket relaxation of outbound/support-evidence/driver
copy. Historical archives remain byte-preserved.

**Tech stack:** Markdown, TypeScript/Vitest structural guards, Node-based repository scanners.

---

## Preconditions and stop rules

- Work Control issue: #91.
- Required predecessor: confirm PR #90's `c2868bc` exact-gate receipt is still current, complete
  its independent review, then merge/dispose it; rerun exact gates if its head changed.
- PR #90 overlaps this train in `AGENTS.md`, `CLAUDE.md` and `docs/RELEASE_STATE.md`; rebase after
  disposition before editing.
- Use a dedicated branch/worktree. Do not write in PR #90/#49/#50/#55 worktrees.
- No runtime Rust, Tauri capability, CSP, endpoint, key, updater or Windows mutation in this plan.
- Preserve historical `docs/archive/**`, dated changelog entries and old audit evidence.
- Current claims may be time-scoped; do not rewrite history to pretend the old policy never existed.

### Task 1: Rebase and prove the queue is still safe

**Files:** no production edits.

**Step 1: Read current authority**

Read `CLAUDE.md`, `docs/RELEASE_STATE.md`, `docs/BACKLOG.md`,
`docs/WORK_CONTROL.md`, issue #91 and PR #90.

**Step 2: Verify predecessor/dispositions**

Record:

- PR #90's exact receipt is current, independent review is complete, and it is merged or explicitly
  disposed;
- #49 owner/claim and file scope;
- PR #50 remains draft/untouched;
- #55 claim remains separate;
- #64 trigger premises remain true.

**Step 3: Refresh claim**

Post branch/worktree/write-scope/expiry/next action on issue #91.

**Step 4: Verify base**

Run:

```powershell
git status --short --branch
git rev-parse HEAD origin/main
node scripts/verify-release-state.mjs --strict
node scripts/verify-module-map.mjs
```

Expected: clean worktree; synchronized intended base; module map green. Reconcile any current-state
drift before continuing. Do not bury a release-state failure inside the policy commit.

### Task 2: Pin and verify the policy decision in the law guard

**Files:**

- Verify/modify: `src/claude-md-laws-guard.test.ts`
- Verify/modify only for rebase drift: the canonical files named below

The handoff branch already contains these proposed markers. Treat them as a reviewable baseline, not
as work to recreate.

**Step 1: Run the focused guard immediately after rebase**

The guard must require all of these concepts from `CLAUDE.md`:

- named Capability Exception Gate and 2026-08-09 owner decision;
- current build ships no driver;
- no vulnerable third-party driver;
- no generic physical-memory/MSR/PCI/device-register surface;
- external-monitor-only CPU temperature until an approved capability ships;
- no third-party game/process injection;
- no DLL injection/game-memory access;
- Tier 1 download/no machine upload;
- Tier 2 opt-in scrubbed fingerprint;
- Tier 3 explicit per-case evidence upload;
- signed remote rules remain triple-gated OFF.

```powershell
npm test -- src/claude-md-laws-guard.test.ts
```

Expected on the handoff branch: PASS. If a rebase removes a marker, first preserve the failing test,
then reconcile the law; do not delete the marker to accept drift.

**Step 2: Reconcile canonical law and mirrors only if current main changed**

The prepared live set is:

- `CLAUDE.md`
- `AGENTS.md`
- `docs/ARCHITECTURE_LOCKS.md`
- `docs/RECEIPTS_DOCTRINE.md`
- `docs/PRODUCT_DIRECTION.md`
- `COMPY_OVERVIEW.md`
- `docs/PRIVACY.md`
- `docs/RELEASE_STATE.md`
- `docs/BACKLOG.md`
- `docs/decisions/2026-08-09-capability-exception-gate.md`

Preserve game/process injection as absolute. State current runtime separately from future policy.
Preserve historical evidence; add a supersession banner rather than rewriting old state.

**Step 3: Re-run the focused guard and budgets**

```powershell
npm test -- src/claude-md-laws-guard.test.ts
powershell -NoProfile -File scripts/doc-budget.ps1
```

**Step 4: Commit only rebase corrections**

```powershell
git add CLAUDE.md AGENTS.md COMPY_OVERVIEW.md docs/ARCHITECTURE_LOCKS.md docs/RECEIPTS_DOCTRINE.md docs/PRODUCT_DIRECTION.md docs/PRIVACY.md docs/RELEASE_STATE.md docs/BACKLOG.md docs/decisions/2026-08-09-capability-exception-gate.md src/claude-md-laws-guard.test.ts
git commit -m "docs(care): reconcile capability exception gate (#91)"
```

### Task 3: Verify and maintain the seeded policy-coherence guard

**Files:**

- Verify/modify: `src/capability-exception-policy-guard.test.ts`
- Modify only if required: `scripts/run-vitest.mjs`

The guard is part of the policy preparation itself, not a Monday follow-up.

**Step 1: Inspect the explicit live corpus**

The guard must read only named operative policy/current-state sources. It must exclude
`docs/archive/**`, dated changelog entries and historical audit evidence by construction.
`docs/GATE_DECISIONS.md` is the one explicit historical exception: inspect only its supersession
banner so its stale table cannot be mistaken for current state.

It must assert:

1. `CLAUDE.md`, `AGENTS.md`, Architecture Locks, Receipts Doctrine, Product Direction,
   Compy Overview, Privacy, Release State, BACKLOG and the decision record carry their applicable
   Capability Exception Gate markers.
2. Standing-law mirrors preserve no third-party game/process injection.
3. Driver-facing mirrors separate "current runtime ships no driver" from "future Compy driver is
   policy-possible only under its own gate."
4. Tier 1 says no machine-derived upload; Tier 2/3 are separate and cannot inherit authorization.
5. `docs/RELEASE_STATE.md` says Tier 1 is not built and has no runtime traffic.
6. `docs/PRIVACY.md` says it describes current behavior and must change before arming.
7. Tier 1's initial kill switch is local/deny-only; remote disable is a separate signed/gated trust
   surface that cannot enable/configure or ride in the catalog.
8. `CASE_SOURCE_ORIGINS` is compiled in `case_intelligence.rs`, app-release-reviewed, and catalog
   content cannot add transport origins.

Export a pure `auditCapabilityExceptionPolicy(snapshot)` function so positive controls mutate
in-memory snapshots rather than editing working files.

**Step 2: Run the seeded guard**

```powershell
npm test -- src/capability-exception-policy-guard.test.ts
```

Expected on the handoff branch: PASS. If rebased main changed a live mirror, correct the policy and
guard together; do not weaken an invariant to make stale copy pass.

**Step 3: Confirm positive controls**

The test must prove it rejects:

- blanket "any driver/network is allowed" language;
- removal of the game/process injection ban;
- Tier 1 machine/incident upload;
- a statement that Tier 1 authorizes Tier 2/3;
- a false claim that Tier 1 is live/has runtime traffic;
- a remote kill switch that can enable/configure behavior or rides in the catalog;
- a catalog-supplied source origin.

**Step 4: Commit only if rebase corrections were required**

```powershell
git add src/capability-exception-policy-guard.test.ts
git commit -m "test(care): preserve exception policy coherence (#91)"
```

### Task 4: Evolve the outbound claim guard without weakening it

**Files:**

- Modify: `src/outbound-claim-guard.test.ts`
- Test: `src/outbound-claim-guard.test.ts`

**Step 1: Add tier-aware failing tests**

Model the currently active surfaces separately:

- updater: live signed check/download;
- remote rules: dark privileged download;
- Tier 1 case knowledge: approved/not built, later signed GET/no upload;
- Tier 2: not armed;
- Tier 3: not armed.

Reject generic "no telemetry/no network/nothing leaves" copy while updater is live. Also reject generic
"uploads may occur" copy that hides tier/consent boundaries.

Positive controls must prove:

- Tier 1 fails if a POST/upload/incident payload is introduced;
- Tier 2 fails without default-OFF + preview + scrubbed allowlist;
- Tier 3 fails without explicit per-case consent + preview/redaction + recipient/retention/deletion;
- one tier cannot satisfy another tier's gate.

**Step 2: Run RED**

```powershell
npm test -- src/outbound-claim-guard.test.ts
```

**Step 3: Implement typed tier detection**

Do not delete existing updater/Receipts detection. Replace brittle global absolutes with per-surface
invariants. Keep the test able to fail in both directions.

**Step 4: Run GREEN**

```powershell
npm test -- src/outbound-claim-guard.test.ts
```

**Step 5: Commit**

```powershell
git add src/outbound-claim-guard.test.ts
git commit -m "test(privacy): enforce outbound tiers separately (#91)"
```

### Task 5: Preserve support-evidence local-only behavior

**Files:**

- Modify comments/assertions only if needed:
  `src/support-evidence-outbound-guard.test.ts`
- Do not modify: `src-tauri/src/support_evidence.rs`

**Step 1: Add a regression test for separation**

Assert the future Tier 1 module name/transport cannot make
`support_evidence.rs` network-capable and that no frontend file combining support-evidence commands
with network primitives exists.

Keep these current invariants:

- preview before export;
- export writes a user-selected local file;
- no endpoint/queue/background uploader/automatic attachment;
- the user remains the transport.

Tier 3, if ever built, must live in its own module and requires a later plan. Do not pre-allow it here.

**Step 2: Run**

```powershell
npm test -- src/support-evidence-outbound-guard.test.ts
```

Expected: PASS. Mutation-test the guard by temporarily adding a real URL/HTTP/upload token to
`support_evidence.rs`, confirm RED, then revert the temporary mutation and confirm GREEN.

**Step 3: Commit only if the test changed**

```powershell
git add src/support-evidence-outbound-guard.test.ts
git commit -m "test(support): preserve local evidence boundary (#91)"
```

### Task 6: Reconcile public/legal copy inventory without premature claims

**Exact live-copy inventory:**

- Legal/current state: `docs/EULA.md`, `docs/PRIVACY.md`,
  `docs/BETA_TESTER_README.md`, `_tester-message.md`
- Site sources: `site/generate.mjs`, `site-app/src/pages/index.astro`,
  `site-app/src/pages/compare.astro`
- Generated site outputs: `site/eula.html`, `site/privacy.html`, and every generated
  `site/*.html` footer/article touched by `site/generate.mjs` (regenerate; do not hand-edit)
- App metadata/data: `src-tauri/tauri.conf.json`, `src/data/terms.json`,
  `src/data/terms.zh-CN.json`
- English copy: `src/i18n/locales/en/home.json`, `src/i18n/locales/en/monitor.json`,
  `src/i18n/locales/en/settings.json`, `src/surfaces/setup/setup-steps.ts`,
  `src/Onboarding.tsx`
- Chinese mirrors: `src/i18n/locales/zh-CN/home.json`,
  `src/i18n/locales/zh-CN/monitor.json`, `src/i18n/locales/zh-CN/settings.json`
- Active indexes/snapshots: `.claude/skills/INDEX.md`, `docs/GATE_DECISIONS.md`
- Tests/snapshots: `scripts/site-landing.test.mjs`, `src/surfaces/Monitor.test.tsx`,
  `src/surfaces/home-hud-flag.test.tsx`, `src/surfaces/home-v2.test.tsx`,
  `src/surfaces/monitor-domain-cards.test.tsx`, onboarding snapshots discovered by the focused
  test, `src/outbound-claim-guard.test.ts`, `src/i18n/locale-parity-guard.test.ts`

**Step 1: Classify each categorical statement**

Classify as:

- current-build factual ("current build installs no driver");
- standing policy ("no game/process injection");
- stale current-state claim ("updater off", "zero outbound");
- future promise that must become tier-aware;
- dated historical evidence to preserve;
- active indexes that incorrectly call a future surface the "first" outbound boundary;
- historical gate briefs that need an explicit supersession banner, not rewritten tables.

**Step 2: Fix only present-tense drift**

Do not market a driver or upload capability that does not exist. Time-scope current factual claims.
Correct stale updater/zero-outbound claims. Preserve the injection ban.

If generator source changes, regenerate outputs; never hand-edit generated HTML. Treat
`docs/BETA_TESTER_README.md` and `_tester-message.md` as distribution-facing unless explicitly
marked as a frozen-version snapshot, and do not silently rewrite `docs/archive/**` or old changelog
evidence. `docs/GATE_DECISIONS.md` keeps its dated table and receives only the strong supersession
banner.

**Step 3: Update tests/snapshots with the source change**

Run:

```powershell
npm test -- scripts/site-landing.test.mjs src/outbound-claim-guard.test.ts src/i18n/locale-parity-guard.test.ts src/surfaces/Monitor.test.tsx src/surfaces/home-hud-flag.test.tsx src/surfaces/home-v2.test.tsx src/surfaces/monitor-domain-cards.test.tsx
npm run build
```

**Step 4: Commit**

```powershell
git add docs/EULA.md docs/PRIVACY.md docs/BETA_TESTER_README.md _tester-message.md site/generate.mjs site site-app/src/pages/index.astro site-app/src/pages/compare.astro src/i18n src/surfaces/setup/setup-steps.ts src/Onboarding.tsx src-tauri/tauri.conf.json src/data/terms.json src/data/terms.zh-CN.json .claude/skills/INDEX.md docs/GATE_DECISIONS.md scripts/site-landing.test.mjs src/surfaces/Monitor.test.tsx src/surfaces/home-hud-flag.test.tsx src/surfaces/home-v2.test.tsx src/surfaces/monitor-domain-cards.test.tsx src/outbound-claim-guard.test.ts
git commit -m "docs(trust): time-scope driver and outbound claims (#91)"
```

If no present-tense drift remains after the current branch, record the audit on issue #91 and make no
empty commit.

### Task 7: Full policy verification and handoff

**Step 1: Mechanical truth**

```powershell
node scripts/verify-release-state.mjs --strict
node scripts/verify-module-map.mjs
powershell -NoProfile -File scripts/doc-budget.ps1
powershell -NoProfile -File scripts/repo-hygiene.ps1
npm test -- src/claude-md-laws-guard.test.ts src/capability-exception-policy-guard.test.ts src/outbound-claim-guard.test.ts src/support-evidence-outbound-guard.test.ts src/q2b-deferral-tripwire.test.ts
npm run build
git diff --check
git status --short
```

Expected: all green; runtime code/capabilities/config unchanged except time-scoped metadata copy if
explicitly audited.

**Step 2: Independent reviews**

Request:

- policy-mirror review;
- Rust/Tauri security-boundary review even though runtime is unchanged;
- privacy/copy review.

Resolve every critical/high finding. If the first two reviews disagree on a boundary, run a third
review rather than averaging them.

**Step 3: Monday handoff comment**

Post to issue #91:

- exact branch/HEAD;
- predecessor disposition;
- files changed;
- verification commands/results;
- historical files deliberately preserved;
- exact next plan:
  `docs/superpowers/plans/2026-08-09-outbound-case-intelligence-tier1.md`;
- open stop points: endpoint, signing custody, disclosure, security review, runtime arming.

**Step 4: Open/update draft PR**

Title: `docs(care): establish capability exception gate (#91)`.

Do not merge while PR #90 is unresolved or if any canonical current-state check is red.
