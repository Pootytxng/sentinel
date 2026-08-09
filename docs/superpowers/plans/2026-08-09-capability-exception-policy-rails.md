# Capability Exception Policy Rails — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: use superpowers:executing-plans to implement this plan task by
> task. Use test-driven-development for every guard. Do not begin until PR #90 has completed its exact
> unfiltered verification and has a recorded merge/disposition.

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
- Required predecessor: PR #90 exact unfiltered test rerun + merge/disposition.
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

- PR #90 merged or explicitly disposed;
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

### Task 2: Pin the policy decision in the law guard

**Files:**

- Modify: `src/claude-md-laws-guard.test.ts`
- Test: `src/claude-md-laws-guard.test.ts`

**Step 1: Write failing markers**

Require all of these concepts from `CLAUDE.md`:

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

Run the focused guard before editing the law and prove it fails for the new markers:

```powershell
npm test -- src/claude-md-laws-guard.test.ts
```

Expected: FAIL because old law does not contain the new markers.

**Step 2: Update canonical law and mirrors**

Update only live policy/current-state sources:

- `CLAUDE.md`
- `AGENTS.md`
- `docs/ARCHITECTURE_LOCKS.md`
- `docs/RECEIPTS_DOCTRINE.md`
- `docs/PRODUCT_DIRECTION.md`
- `COMPY_OVERVIEW.md`
- `docs/PRIVACY.md` doctrine pointer
- `docs/RELEASE_STATE.md`
- `docs/BACKLOG.md`
- `docs/decisions/2026-08-09-capability-exception-gate.md`

Preserve game/process injection as absolute. State current runtime separately from future policy.

**Step 3: Run focused guard**

```powershell
npm test -- src/claude-md-laws-guard.test.ts
```

Expected: PASS, including byte/pointer budget.

**Step 4: Commit**

```powershell
git add CLAUDE.md AGENTS.md COMPY_OVERVIEW.md docs/ARCHITECTURE_LOCKS.md docs/RECEIPTS_DOCTRINE.md docs/PRODUCT_DIRECTION.md docs/PRIVACY.md docs/RELEASE_STATE.md docs/BACKLOG.md docs/decisions/2026-08-09-capability-exception-gate.md src/claude-md-laws-guard.test.ts
git commit -m "docs(care): establish capability exception gate (#91)"
```

### Task 3: Add a policy-coherence guard

**Files:**

- Create: `src/capability-exception-policy-guard.test.ts`
- Modify only if required: `scripts/run-vitest.mjs`

**Step 1: Write the failing guard**

The guard must scan live, non-historical policy sources and assert:

1. `CLAUDE.md`, `AGENTS.md`, Architecture Locks, Receipts Doctrine and Product Direction all name
   the Capability Exception Gate.
2. They all preserve no third-party game/process injection.
3. They all distinguish "current runtime ships no driver" from "driver policy-possible under gate."
4. Every tier is present and Tier 1 explicitly says no machine-derived upload.
5. `docs/RELEASE_STATE.md` says Tier 1 is not built/no runtime traffic.
6. `docs/PRIVACY.md` says it describes current behavior and must change before arming.
7. Historical paths are excluded rather than rewritten.

Add positive controls proving the scanner catches:

- a reintroduced blanket "any driver/network is allowed";
- removal of Tier 1's no-upload constraint;
- removal of the game-injection ban;
- a claim that Tier 1 authorizes Tier 2/3.

**Step 2: Run and see RED**

```powershell
npm test -- src/capability-exception-policy-guard.test.ts
```

Expected: FAIL until every canonical mirror is aligned.

**Step 3: Make the smallest policy corrections**

Correct only the failing live mirrors. Do not alter archives or dated evidence.

**Step 4: Run GREEN**

```powershell
npm test -- src/capability-exception-policy-guard.test.ts
```

Expected: PASS including positive controls.

**Step 5: Commit**

```powershell
git add src/capability-exception-policy-guard.test.ts
git commit -m "test(care): pin exception policy coherence (#91)"
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

**Files:**

- Audit only in this plan:
  `docs/EULA.md`, `site/generate.mjs`, `site-app/src/pages/**`,
  `src/i18n/locales/en/**`, `src/i18n/locales/zh-CN/**`,
  `src-tauri/tauri.conf.json`, `src/data/terms*.json`

**Step 1: Classify each categorical statement**

Classify as:

- current-build factual ("current build installs no driver");
- standing policy ("no game/process injection");
- stale current-state claim ("updater off", "zero outbound");
- future promise that must become tier-aware;
- dated historical evidence to preserve.

**Step 2: Fix only present-tense drift**

Do not market a driver or upload capability that does not exist. Time-scope current factual claims.
Correct stale updater/zero-outbound claims. Preserve the injection ban.

If generator source changes, regenerate outputs; never hand-edit generated HTML.

**Step 3: Update tests/snapshots with the source change**

Run:

```powershell
npm test -- scripts/site-landing.test.mjs src/outbound-claim-guard.test.ts src/i18n/locale-parity-guard.test.ts
npm run build
```

**Step 4: Commit**

```powershell
git add docs/EULA.md site/generate.mjs site site-app/src/pages src/i18n src-tauri/tauri.conf.json src/data
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
