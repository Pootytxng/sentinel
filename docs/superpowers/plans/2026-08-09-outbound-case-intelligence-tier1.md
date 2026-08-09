# Outbound Case Intelligence Tier 1 — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: use superpowers:executing-plans to implement this plan task by
> task. Use test-driven-development. Start only after the policy-rails plan is green and merged or
> explicitly accepted as the current branch base.

**Goal:** Add a signed, Rust-side, pull-only advisory catalog that matches existing local crash
incidents on-device and makes Crash & Freeze Rescue discoverable—without machine-data upload,
webview networking, mutation, a driver or causal overclaim.

**Architecture:** A new `case_intelligence.rs` owns pure manifest/catalog/match/cache/transport
logic behind a hard-false gate. It uses a trust domain separate from privileged remote rules.
`blackbox.rs` consumes only an optional advisory match. The frontend renders absence exactly as
today and routes crash intent directly to the rescue station. Production CSP remains unchanged.

**Tech stack:** Rust/Tauri 2, serde, Ed25519 verification, SHA-256, Vitest/React Testing Library,
existing i18n and notification rails.

---

## Preconditions and immutable boundaries

- PR #90 is merged/dispositioned and #91 owns the active claim.
- Policy plan is green.
- Do not edit `actions.rs`; Tier 1 is advisory only.
- Do not add transport to `remote_rules.rs`, `receipts.rs` or `support_evidence.rs`.
- Do not widen `tauri.conf.json` production CSP or add frontend `fetch`.
- Do not add a driver, service, scheduled task, account, install ID, cookie or incident upload.
- Production endpoint/key remain absent and `case_intelligence_gate()` remains false until the later
  arming task.
- Use a test-only local HTTP fixture/server for transport tests; no real external traffic in tests.

### Task 1: Freeze the existing Black Box behavior

**Files:**

- Inspect: `src-tauri/src/blackbox.rs`
- Modify: `src/data/blackbox-resolution.test.ts`
- Modify: `src/surfaces/BlackBox.test.tsx` (or current exact Black Box test file)
- Do not change production behavior yet.

**Step 1: Add baseline tests**

Pin:

- incident kind/time/app/module/code/receipt shape;
- current local assessment wording;
- no-catalog path;
- raw receipts remain behind detail;
- feedback remains local;
- scan invokes `get_crash_blackbox`;
- current station renders with no optional case-intelligence field.

**Step 2: Run focused tests**

```powershell
npm test -- src/data/blackbox-resolution.test.ts src/surfaces/BlackBox.test.tsx
cargo test --manifest-path src-tauri/Cargo.toml blackbox
```

Expected: PASS. These are characterization tests; if an existing behavior is wrong, log it separately
rather than silently re-baselining.

**Step 3: Commit**

```powershell
git add src/data/blackbox-resolution.test.ts src/surfaces/BlackBox.test.tsx
git commit -m "test(care): freeze local crash-rescue behavior (#91)"
```

### Task 2: Create pure Tier 1 domain types with strict parsing

**Files:**

- Create: `src-tauri/src/case_intelligence.rs`
- Modify: `src-tauri/src/lib.rs` (module declaration only)
- Modify: `src-tauri/CLAUDE.md` module map
- Test: inline `#[cfg(test)]` in `case_intelligence.rs`

**Step 1: Write RED schema tests**

Test exact structs/enums from the spec:

- `CaseCatalogManifest`;
- `CaseCatalog`;
- `CaseEntry`;
- bounded `PublicMatcher`;
- `CaseMatchLevel`;
- `CaseIntelligenceMatch`;
- `AdvisoryStep`.

Tests must reject:

- unknown fields;
- unknown enum variants;
- duplicate case IDs;
- duplicate matchers;
- empty IDs/title/summary/source;
- overlong strings;
- too many entries/matchers/steps;
- arbitrary regex;
- HTML/Markdown/script/command/action fields;
- non-HTTPS source URL;
- source URL outside the public-source allowlist.

**Step 2: Run RED**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml case_intelligence::tests::catalog_schema
```

**Step 3: Implement the smallest strict types/parser**

Use `#[serde(deny_unknown_fields)]` where supported and explicit post-parse validation for caps and
cross-entry uniqueness. Catalog types cannot import or represent `AppliedAction`,
`RollbackAction`, `Recommendation` or command strings.

**Step 4: Run GREEN**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml case_intelligence::tests::catalog_schema
```

**Step 5: Verify module map**

```powershell
node scripts/verify-module-map.mjs
```

**Step 6: Commit**

```powershell
git add src-tauri/src/case_intelligence.rs src-tauri/src/lib.rs src-tauri/CLAUDE.md
git commit -m "feat(care): define strict advisory catalog domain (#91)"
```

### Task 3: Add a separate signing trust and verifier

**Files:**

- Modify: `src-tauri/src/case_intelligence.rs`
- Optionally create after review: `src-tauri/src/signed_content.rs`
- Test: `case_intelligence.rs`

**Step 1: Write RED verification tests**

Use fixed test key material stored only as test fixtures. Test:

- valid manifest + body accepted;
- wrong case-intelligence key rejected;
- remote-rules key rejected;
- altered signature/manifest/body/hash rejected;
- malformed base64/signature rejected;
- expired/not-yet-valid rejected;
- catalog-version rollback rejected;
- incompatible app version rejected;
- oversized manifest/body rejected;
- unallowlisted/cross-origin URL and redirect rejected;
- unknown schema rejected;
- placeholder all-zero production key keeps gate unusable.

**Step 2: Run RED**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml case_intelligence::tests::verification
```

**Step 3: Implement verifier**

Reuse the verified pattern from `remote_rules.rs`, not its key/types/cache/config. If shared crypto is
extracted, use distinct newtypes so a remote-rules manifest/key cannot be passed to case intelligence.

Validation order must match the spec. Never log signature or sensitive key material.

**Step 4: Run GREEN**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml case_intelligence::tests::verification
```

**Step 5: Commit**

```powershell
git add src-tauri/src/case_intelligence.rs src-tauri/src/signed_content.rs
git commit -m "feat(care): verify signed case catalogs separately (#91)"
```

Omit `signed_content.rs` from `git add` if extraction was not earned.

### Task 4: Add atomic last-known-good cache

**Files:**

- Modify: `src-tauri/src/case_intelligence.rs`
- Test: `case_intelligence.rs`

**Step 1: Write RED cache tests**

Using a temporary directory, prove:

- cache is namespaced away from remote rules and support evidence;
- only fully verified body+manifest are committed;
- temp write + flush + atomic rename behavior;
- interrupted write preserves previous LKG;
- corrupt/tampered cache is rejected;
- expired/rolled-back cache is rejected;
- cache re-verifies on every load;
- cache clear affects only case intelligence;
- unavailable cache falls back to embedded/local analysis.

**Step 2: Run RED**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml case_intelligence::tests::cache
```

**Step 3: Implement**

Use the existing Compy data-dir helper and a dedicated
`%APPDATA%\Compy\case-intelligence\` namespace. Cap file count and bytes. Do not store local
incident/match data in the catalog cache.

**Step 4: Run GREEN**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml case_intelligence::tests::cache
```

**Step 5: Commit**

```powershell
git add src-tauri/src/case_intelligence.rs
git commit -m "feat(care): add verified case-catalog cache (#91)"
```

### Task 5: Build the pure local matcher

**Files:**

- Modify: `src-tauri/src/case_intelligence.rs`
- Inspect/modify: `src-tauri/src/blackbox.rs` only for a stable input adapter
- Test: both modules

**Step 1: Write RED matcher tests**

Cover:

- deterministic exact matching;
- incident kind required;
- module/app/error/driver/Windows range checks;
- all `required_evidence` must be present;
- conflict/contraindication suppresses unsafe next step;
- no arbitrary substring/regex surprise;
- no catalog → `NoCatalog`;
- invalid/expired → `CatalogUnavailable`;
- valid no-match → `NoKnownMatch`;
- partial evidence → `PossibleKnownIssue`;
- full bounded evidence → `MatchedKnownIssue`;
- stable ordering/tie break;
- no numeric confidence;
- no "caused/definitely/fixed" wording;
- matcher accepts `&Incident` and creates no serializable request/payload.

**Step 2: Run RED**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml case_intelligence::tests::matcher
```

**Step 3: Implement smallest matcher**

Do not duplicate incident collection. Use normalized fields already produced by `blackbox.rs`.
Return evidence references that the UI can map to visible local facts.

**Step 4: Run GREEN**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml case_intelligence::tests::matcher
cargo test --manifest-path src-tauri/Cargo.toml blackbox
```

**Step 5: Commit**

```powershell
git add src-tauri/src/case_intelligence.rs src-tauri/src/blackbox.rs
git commit -m "feat(care): match signed knowledge to local incidents (#91)"
```

### Task 6: Add dark Rust-side pull transport with a zero-upload guard

**Files:**

- Modify: `src-tauri/src/case_intelligence.rs`
- Modify: `src-tauri/Cargo.toml` only for the reviewed HTTP client choice
- Modify: `src/outbound-claim-guard.test.ts`
- Create: `src/case-intelligence-outbound-guard.test.ts`
- Preserve: `src/support-evidence-outbound-guard.test.ts`
- Preserve: `src/q2b-deferral-tripwire.test.ts`

**Step 1: Write RED structural guard**

The new guard must assert:

- only the case-intelligence module owns its transport;
- GET/HEAD only;
- no POST/PUT/PATCH/DELETE;
- no upload/send-report/evidence/dump/support-bundle methods;
- no incident serialization into URL/query/header/body;
- no account/cookie/install ID;
- explicit compiled HTTPS allowlist;
- separate endpoint/key/cache names from updater/remote rules;
- `case_intelligence_gate()` hard-returns false;
- no frontend network primitive connected to case intelligence;
- production CSP unchanged;
- support evidence/Receipts remain transport-free.

Positive controls must inject plausible POST, query fingerprint, redirect, frontend fetch and support
evidence URL shapes and prove each fails.

**Step 2: Run RED**

```powershell
npm test -- src/case-intelligence-outbound-guard.test.ts src/outbound-claim-guard.test.ts src/support-evidence-outbound-guard.test.ts src/q2b-deferral-tripwire.test.ts
```

**Step 3: Add test-only transport seam**

Implement an injected HTTP interface and local fixture tests:

- request occurs only when gate is enabled in a test-specific constructor;
- production `case_intelligence_gate()` remains false;
- stale-cache explicit refresh only; no startup poll;
- timeouts/size caps/status handling;
- no/same-origin redirect policy;
- unavailable network keeps local analysis usable;
- no production endpoint configured.

Do not broaden Tauri capability files or CSP.

**Step 4: Run GREEN**

```powershell
npm test -- src/case-intelligence-outbound-guard.test.ts src/outbound-claim-guard.test.ts src/support-evidence-outbound-guard.test.ts src/q2b-deferral-tripwire.test.ts
cargo test --manifest-path src-tauri/Cargo.toml case_intelligence
```

**Step 5: Commit**

```powershell
git add src-tauri/src/case_intelligence.rs src-tauri/Cargo.toml src/case-intelligence-outbound-guard.test.ts src/outbound-claim-guard.test.ts
git commit -m "feat(care): build dark signed catalog pull path (#91)"
```

### Task 7: Add optional incident wire contract

**Files:**

- Modify: `src-tauri/src/blackbox.rs`
- Modify: matching TypeScript incident type
- Modify: `src/surfaces/BlackBox.tsx`
- Modify: Black Box tests
- Modify: en/zh-CN locale files for new copy

**Step 1: Write RED compatibility tests**

Prove:

- `case_intelligence` is optional/defaulted;
- absent field renders byte/DOM-equivalent current result;
- gate false makes no request and yields absent field;
- verified match displays match label, source, catalog version/date, local evidence and one next step;
- invalid/expired/unverified catalog never renders match;
- local assessment and signed match are separate sections;
- copy says "matches/consistent with," never "caused/fixed";
- source opens in the user's browser only after click;
- URL is the verified allowlisted source from the catalog.

**Step 2: Implement minimal optional field**

Do not make case intelligence required for `get_crash_blackbox`. A failed/unavailable catalog must not
fail the crash scan.

**Step 3: Run**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml blackbox
npm test -- src/surfaces/BlackBox.test.tsx src/data/blackbox-resolution.test.ts src/i18n/locale-parity-guard.test.ts
```

**Step 4: IPC contract review**

Spawn the frontend IPC contract auditor. Resolve every command/serde/TypeScript mismatch.

**Step 5: Commit**

```powershell
git add src-tauri/src/blackbox.rs src/surfaces/BlackBox.tsx src/i18n
git commit -m "feat(care): attach optional known-issue guidance (#91)"
```

Include the exact TypeScript type file in `git add` after discovery.

### Task 8: Make crash rescue discoverable without redesigning the Lab

**Files:**

- Modify: `src/surfaces/LabConsole.tsx`
- Modify: current Home/intake router files after exact discovery
- Modify: navigation/i18n files that expose "Black Box"
- Modify: focused UI tests
- Do not touch: draft PR #50 files or unrelated #49 shell work.

**Step 1: Coordinate with #49 owner**

Post the narrow contract: station ID stays stable; visible label becomes **Crash & Freeze Rescue**;
deep-link payload selects the rescue station. If #49 currently owns the same files, hand off the
contract rather than writing them concurrently.

**Step 2: Write RED routing tests**

Prove:

- "A game closed or froze" routes to rescue;
- "blue screen/restarted" routes to rescue;
- Home recent-crash card routes to the exact incident;
- deep-link does not open Optimize;
- visible navigation no longer relies on "Black Box";
- internal station/module ID remains backward-compatible;
- keyboard/focus semantics hold;
- en/zh-CN parity holds.

**Step 3: Implement smallest route/label change**

No Lab shell redesign. Keep glance-first hierarchy and existing rig/instrument styling.

**Step 4: Run focused UI tests**

```powershell
npm test -- src/surfaces/BlackBox.test.tsx src/surfaces/lab-console.test.tsx src/i18n/locale-parity-guard.test.ts
npm run build
```

Use the actual discovered test filenames if the repo names differ; record them in the issue comment.

**Step 5: Visual self-review**

Use the repo `self-review` skill at the owner's real resolution. Prove:

- rescue is visible within five seconds from Home;
- result hierarchy is What happened → evidence points to → next step → proof;
- raw receipts are subordinate;
- no layout collision at target resolutions;
- reduced motion and keyboard path work;
- no alarming/scareware visual language.

**Step 6: Commit**

```powershell
git add src/surfaces/LabConsole.tsx src/surfaces/BlackBox.tsx src/i18n
git commit -m "feat(care): route crash intent to rescue (#91)"
```

Add the exact Home/router/test files discovered; do not stage unrelated #49 work.

### Task 9: Add proactive local incident nudge

**Files:**

- Modify: existing tray/monitor/event polling seam after exact discovery
- Modify: `src-tauri/src/lib.rs` only for notification/deep-link wiring
- Modify: Home recent-incident surface
- Add focused Rust/UI tests

**Step 1: Write RED notification policy tests**

Prove:

- notification only for a newly observed high-signal incident;
- no low-confidence heuristic notification;
- one notification per incident ID;
- bounded dedupe for repeated same-app incidents;
- click opens selected rescue incident;
- Compy-not-running case becomes persistent Home card next launch;
- notification off does not hide the Home card;
- no network needed;
- wording says "appears to have closed unexpectedly," not a cause.

**Step 2: Implement using existing notification capability**

Do not add a background Windows service/scheduled task. First implementation works while Compy/tray is
running; next-launch Home card covers downtime.

**Step 3: Run focused tests**

Run the exact Rust module tests plus Home/notification UI tests discovered in Step 1.

**Step 4: Visual self-review**

Prove notification click routing and persistent fallback. Keep toast secondary to in-app discovery.

**Step 5: Commit**

```powershell
git add src-tauri/src/lib.rs src-tauri/src/tray.rs src
git commit -m "feat(care): surface new crash incidents locally (#91)"
```

Stage only exact changed files, not the broad paths shown if unrelated work exists.

### Task 10: Security/privacy review and dark acceptance

**Files:**

- Modify: `docs/PRIVACY.md` only to describe the exact dark/current behavior
- Modify: `docs/RELEASE_STATE.md`
- Modify: `docs/BACKLOG.md`
- Modify: guards/tests found above

**Step 1: Capture a packet/request proof**

With production gate false, prove zero case-intelligence requests. With a test-only enabled local
fixture, capture the exact request and prove it contains no incident/machine-derived fields.

**Step 2: Run full checks**

```powershell
npm test -- src/claude-md-laws-guard.test.ts src/capability-exception-policy-guard.test.ts src/outbound-claim-guard.test.ts src/case-intelligence-outbound-guard.test.ts src/support-evidence-outbound-guard.test.ts src/q2b-deferral-tripwire.test.ts src/command-authority-guard.test.ts
npm test -- src/surfaces/BlackBox.test.tsx src/data/blackbox-resolution.test.ts
cargo test --manifest-path src-tauri/Cargo.toml case_intelligence
cargo test --manifest-path src-tauri/Cargo.toml blackbox
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
npm run build
node scripts/verify-release-state.mjs --strict
node scripts/verify-module-map.mjs
powershell -NoProfile -File scripts/doc-budget.ps1
git diff --check
```

**Step 3: Independent audits**

Run:

- Rust/Tauri security reviewer;
- frontend IPC contract auditor;
- privacy/outbound guard review;
- UI self-review for every `.tsx/.css` change.

Resolve all critical/high findings. A disagreement about endpoint/CSP/upload requires a third review.

**Step 4: Update state truth**

Record exactly:

- domain/verifier/cache/matcher built;
- production gate false;
- production endpoint/key absent;
- zero machine-data upload;
- CSP unchanged;
- support evidence local-only;
- what UI/discoverability is on;
- exact tests and unverified owner/native steps.

**Step 5: Commit**

```powershell
git add docs/PRIVACY.md docs/RELEASE_STATE.md docs/BACKLOG.md
git commit -m "docs(care): record Tier 1 dark state (#91)"
```

### Task 11: Prepare—but do not cross—the arming gate

Create an issue #91 comment/evidence pack containing:

- proposed exact HTTPS endpoint and redirect policy;
- production public-key fingerprint and offline custody/rotation procedure;
- manifest/catalog schema versions;
- request trace showing no machine-derived data;
- dependency/security audit;
- cache and fail-closed proof;
- dark/canary rollout and abort thresholds;
- final privacy/app/site wording;
- notification/off-switch behavior;
- rollback/kill-switch procedure;
- independent review verdicts.

Stop. Do not insert a production key/endpoint or flip `case_intelligence_gate()` in this plan. That
arming change is a short, separately owner-reviewed mutation after the evidence pack is accepted.

## Completion definition

Tier 1 dark is complete only when:

- local crash scan still works with network disabled;
- signed advisory catalog is separately verified/cached/matched locally;
- production gate is false and no endpoint/key is armed;
- no machine incident data can leave through the Tier 1 module;
- support evidence and Receipts still have no transport;
- CSP/webviews are unchanged;
- no driver/mutation/injection exists;
- Crash & Freeze Rescue is discoverable and deep-links correctly;
- notification is secondary to persistent in-app discovery;
- every required test/review is green and current state docs tell the truth.
