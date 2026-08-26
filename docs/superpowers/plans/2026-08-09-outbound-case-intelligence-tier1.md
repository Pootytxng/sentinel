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

The allowlist is not an implementation-time choice: define
`const CASE_SOURCE_ORIGINS: &[&str]` in `src-tauri/src/case_intelligence.rs`. It is reviewed and
changed only through an app release; signed catalog content may select a URL under an existing HTTPS
origin but cannot add an origin or trigger an in-app fetch. Keep the catalog-download endpoint
allowlist separate from the source-click allowlist.

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
- explicit compiled `CASE_SOURCE_ORIGINS` and separate catalog-endpoint HTTPS allowlist;
- catalog content cannot add origins, redirect transport or cause an in-app fetch;
- separate endpoint/key/cache names from updater/remote rules;
- `case_intelligence_gate()` hard-returns false;
- initial kill switch is local and deny-only; no remote signal can enable/configure the feature or
  ride inside the advisory catalog;
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

Do not broaden Tauri capability files or CSP. Do not add a remote kill switch in Tier 1; any future
remote disable-only signal needs a separate exception record, signing trust and owner arming review.

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

### Task 8: Make crash rescue discoverable without enabling the broad intake band

**Production files:**

- Modify: `src/surfaces/HomeConsole.tsx`
- Modify: `src/surfaces/home-console.css`
- Modify: `src/surfaces/home-intake-data.ts`
- Modify: `src/App.tsx`
- Modify: `src/surfaces/LabConsole.tsx`
- Modify: `src/surfaces/lab-guided-data.ts`
- Inspect/preserve: `src/design/use-hud.ts`
- Inspect/preserve: `src/design/theme.ts`
- Modify: `src/i18n/locales/en/home.json`
- Modify: `src/i18n/locales/en/lab.json`
- Modify: `src/i18n/locales/zh-CN/home.json`
- Modify: `src/i18n/locales/zh-CN/lab.json`
- Do not touch: draft PR #50 files or unrelated #49 shell work.

**Focused tests:**

- Modify: `src/surfaces/home-console.test.tsx`
- Modify: `src/surfaces/home-intake.test.tsx`
- Modify: `src/surfaces/lab-console.test.tsx`
- Modify: `src/surfaces/post-check-lab-route-guard.test.ts`
- Create: `src/care-home-route-guard.test.ts`
- Preserve/run: `src/design/theme.test.ts`
- Preserve/run: `src/i18n/locale-parity-guard.test.ts`

**Locked product decision:** do not default the broad `compy_home_intake` optimization/intake band
on. Extract one compact Care entry and render it always on Home, independent of that flag. The
internal station ID remains `blackbox`; the user label becomes **Crash & Freeze Rescue**.

**Step 1: Coordinate with #49 owner**

Post the narrow contract before touching shared files. If #49 owns one of the exact files above,
hand off that file's small contract rather than writing concurrently. Do not redesign the Lab shell.

**Step 2: Write RED discovery/routing tests**

Prove all of the following:

- with `compy_home_intake` absent, the compact Care entry is visible;
- with `compy_home_intake = "0"`, the compact Care entry is still visible while the broad band stays
  hidden;
- `homeCareEntry` is exported from `home-intake-data.ts` and the optional band contains no duplicate
  crash row;
- "A game closed or froze" and "blue screen/restarted" route to `blackbox`;
- `App.tsx` owns one generic
  `openLabStation(station: "optimize" | "blackbox", incidentId?: string)` writer;
- that helper performs the only
  `localStorage.setItem("compy_lab_open_station", station)` before `navHome("lab")`;
- `openFixesInLab` calls the helper with `"optimize"`; Care calls it with `"blackbox"`;
- an optional exact incident ID uses the separate one-shot `compy_lab_open_incident` key;
- `LabConsole.tsx` accepts only `"optimize"` or `"blackbox"`, consumes both one-shot keys and
  clears them after use;
- the crash route never opens Optimize;
- visible copy does not require the words "Black Box";
- keyboard/focus semantics and en/zh-CN parity hold.

**Step 3: Implement the smallest route**

- Extract `homeCareEntry` from the existing intake data and remove the duplicate crash choice from
  the flag-gated collection.
- Render a compact Care control in `HomeConsole.tsx` outside the
  `useHomeIntakeEnabled()` branch.
- Pass an `onOpenCare(incidentId?)` prop from `App.tsx`.
- Generalize the current `openFixesInLab` writer into `openLabStation`; keep
  `openFixesInLab` as a thin `"optimize"` caller.
- Extend `LabConsole.tsx`'s existing one-shot station read to `blackbox` and optional incident ID.
- Keep `compy_home_intake` default-OFF in `use-hud.ts` / `theme.ts`.
- Change only visible labels/routes; retain internal `blackbox` module/station compatibility.

**Step 4: Run focused UI checks**

```powershell
npm test -- src/surfaces/home-console.test.tsx src/surfaces/home-intake.test.tsx src/surfaces/lab-console.test.tsx src/surfaces/post-check-lab-route-guard.test.ts src/care-home-route-guard.test.ts src/design/theme.test.ts src/i18n/locale-parity-guard.test.ts
npm run build
```

**Step 5: Visual self-review of the real default state**

Use the repo `self-review` skill at the owner's real resolution. The verdict cannot pass from a
flag-forced preview. Capture `compy_home_intake` absent and `"0"`, and prove:

- the Care route is visible within five seconds from Home in both default states;
- the broad intake band remains hidden;
- result hierarchy is What happened → evidence points to → next step → proof;
- raw receipts are subordinate;
- no layout collision at target resolutions;
- reduced motion and keyboard path work;
- no alarming/scareware visual language.

**Step 6: Commit**

```powershell
git add src/App.tsx src/surfaces/HomeConsole.tsx src/surfaces/home-console.css src/surfaces/home-intake-data.ts src/surfaces/LabConsole.tsx src/surfaces/lab-guided-data.ts src/surfaces/home-console.test.tsx src/surfaces/home-intake.test.tsx src/surfaces/lab-console.test.tsx src/surfaces/post-check-lab-route-guard.test.ts src/care-home-route-guard.test.ts src/i18n/locales/en/home.json src/i18n/locales/en/lab.json src/i18n/locales/zh-CN/home.json src/i18n/locales/zh-CN/lab.json
git commit -m "feat(care): make crash rescue always discoverable (#91)"
```

### Task 9: Add a persisted local incident observer and secondary nudge

**Production files:**

- Create: `src-tauri/src/incident_observer.rs`
- Modify: `src-tauri/src/blackbox.rs` (stable path-free `incident_id` only)
- Modify: `src-tauri/src/lib.rs` (module, lifecycle and three commands)
- Modify: `src-tauri/build.rs`
- Modify: `src-tauri/capabilities/default.json` only for main-window command authority
- Modify: `src-tauri/CLAUDE.md` module map
- Modify: `src/types.ts` (`incident_id` and `PendingCareIncident`)
- Modify: `src/App.tsx`
- Modify: `src/surfaces/HomeConsole.tsx`
- Modify: `src/surfaces/BlackBox.tsx`
- Modify: `src/surfaces/LabConsole.tsx`
- Modify: the same four en/zh-CN Home/Lab locale files from Task 8
- Do not add: a Windows service, scheduled task, periodic poll, network, webview capability or CSP
  change.

**Tests:**

- Inline Rust tests in `incident_observer.rs`
- Modify: `src/surfaces/home-console.test.tsx`
- Modify: `src/surfaces/lab-console.test.tsx`
- Modify: `src/surfaces/BlackBox.test.tsx`
- Create: `src/care-incident-observer-contract.test.ts`
- Run: `src/command-authority-guard.test.ts`

**Step 1: Write RED state/lifecycle tests**

Pin this schema in `%APPDATA%\Compy\care\incident-observer.json`:

```rust
struct IncidentObserverState {
    schema_version: u32,
    last_scan_at: Option<String>,
    seen: Vec<ObservedIncident>,
    pending_home_incident_id: Option<String>,
}

struct ObservedIncident {
    incident_id: String,
    first_seen_at: String,
    notified_at: Option<String>,
    opened_at: Option<String>,
    dismissed_at: Option<String>,
}
```

Prove:

- the first-ever run seeds current IDs/watermark and emits no historical card/toast;
- later launch and main-window foreground scans inspect only incidents since the watermark;
- monitored-session finalization triggers one targeted scan;
- no periodic timer, service or scheduled task exists;
- an incident while Compy is closed is detected on next launch from the persisted watermark;
- only real app crash/hang, GPU timeout, BSOD/WHEA or unexpected-restart records qualify;
- low-confidence assessment text alone never qualifies;
- exact `incident_id` notifies at most once;
- same app/family toast cooldown is 30 minutes while the newest exact incident can become pending;
- state keeps at most 128 observations/30 days; pending card expires after 7 days;
- temp write + flush + atomic replace preserves prior state on interruption;
- corrupt state is quarantined and fails safe with no spam.

**Step 2: Implement the observer as a consumer of Black Box**

Do not duplicate Event Log/WER/Reliability collection. Add a stable, path-free `incident_id` to the
normalized `Incident` contract and feed those incidents into `incident_observer.rs`. Wire:

- one scan after application setup/state initialization;
- one scan when the main window returns to the foreground;
- one targeted scan after monitored-session finalization.

No always-on cadence in this train. If later measurement earns one, change the plan and add explicit
CPU/IO budgets first.

**Step 3: Add main-window-only IPC and the persistent Home card**

Register:

- `get_pending_care_incident() -> Option<PendingCareIncident>`;
- `mark_care_incident_opened(incident_id: String)`;
- `dismiss_care_incident(incident_id: String)`.

Update the command manifest/capability using the repository's existing main-window authority pattern;
the overlay receives none of these commands. The DTO carries only stable ID, occurred-at, kind,
app/display label and calm summary. The Home card remains visible when notification permission is
off. **Find out why** calls `openLabStation("blackbox", incident_id)`; mark opened only after
`LabConsole`/Crash & Freeze Rescue consumes the exact selection. Dismiss/expiry clears the pending
pointer without deleting the underlying Windows evidence.

**Step 4: Add a toast without promising click activation**

The currently registered official desktop notification path provides simple `show()` only; it has
no supported action/click callback carrying an incident payload. Therefore:

- toast only for a newly observed high-signal incident while Compy/tray is running;
- copy: "A game appears to have closed unexpectedly. Open Compy to review the evidence.";
- notification off suppresses only the toast, never the Home card;
- the persisted pending state is authoritative;
- if an installed-build probe proves the default Windows click merely foregrounds Compy, Home reads
  the pending state—do not describe this as selected-incident click-through;
- direct action payload routing is out of scope until supported and separately tested.

**Step 5: Run focused verification**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml incident_observer
cargo test --manifest-path src-tauri/Cargo.toml blackbox
npm test -- src/surfaces/home-console.test.tsx src/surfaces/lab-console.test.tsx src/surfaces/BlackBox.test.tsx src/care-incident-observer-contract.test.ts src/command-authority-guard.test.ts src/i18n/locale-parity-guard.test.ts
node scripts/verify-module-map.mjs
npm run build
```

Then spawn the frontend IPC contract auditor and Rust/Tauri reviewer. Resolve every command,
serde/TypeScript, capability, persistence and panic/unwrap finding.

**Step 6: Installed-build/visual proof**

Use the repo `self-review` skill at the owner's real resolution. Prove the default-on Home card
route with notification permission both on and off. Use persisted-state fixtures for the
app-closed/next-launch path. Record notification display and foreground behavior as observed facts;
do not claim direct click routing unless the installed build proves it.

**Step 7: Commit**

```powershell
git add src-tauri/src/incident_observer.rs src-tauri/src/blackbox.rs src-tauri/src/lib.rs src-tauri/build.rs src-tauri/capabilities/default.json src-tauri/CLAUDE.md src/types.ts src/App.tsx src/surfaces/HomeConsole.tsx src/surfaces/BlackBox.tsx src/surfaces/LabConsole.tsx src/surfaces/home-console.test.tsx src/surfaces/lab-console.test.tsx src/surfaces/BlackBox.test.tsx src/care-incident-observer-contract.test.ts src/i18n/locales/en/home.json src/i18n/locales/en/lab.json src/i18n/locales/zh-CN/home.json src/i18n/locales/zh-CN/lab.json
git commit -m "feat(care): persist and surface new crash incidents (#91)"
```

### Task 10: Security/privacy review and dark acceptance

**Carried forward from the #221 pre-merge review (2026-08-25)** — two items this task must close,
recorded here because nothing else would carry them across the gap between building dark and arming:

1. `ReqwestCaseHttp::get` wraps `reqwest_get` in `tauri::async_runtime::block_on`
   (`src-tauri/src/case_intelligence.rs`, the `impl CaseHttp for ReqwestCaseHttp` block). It is safe
   from a sync command thread and **deadlocks if it is ever called from inside an async command
   body**. Nothing calls it in this build. Whoever arms Tier 1 must confirm the call site is sync, or
   make `refresh_case_catalog` async end to end.
2. `catalog_version` is a `u64` on the Rust side and a `number` in TypeScript. Beyond 2^53 the JS
   side loses precision silently. Harmless at real catalog versions; pin it if the wire type is ever
   used for anything but comparison.
3. The dead-`pub(crate)`-fn guard in `src/case-intelligence-outbound-guard.test.ts` builds its
   corpus with a NON-recursive `readdirSync` over `src-tauri/src`. Every `.rs` file in the crate sits
   flat in that directory today, so it is accurate now. The day anyone splits the crate into
   subdirectories the guard goes quiet rather than wrong — a false negative, which is the failure
   mode nobody notices. Add `{ recursive: true }` at that point, not before.

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

Tier 1 fixture-proven dark mechanics are complete only when:

- local crash scan still works with network disabled;
- catalog schema/signature/cache/match mechanics are proven with local fixtures; no production
  catalog, endpoint or key is implied by this state;
- production gate is false and no endpoint/key is armed;
- no machine incident data can leave through the Tier 1 module;
- support evidence and Receipts still have no transport;
- CSP/webviews are unchanged;
- no driver/mutation/injection exists;
- Crash & Freeze Rescue is discoverable and deep-links correctly;
- the persisted Home card is authoritative; notification is secondary and no unsupported direct
  click-routing claim ships;
- every required test/review is green and current state docs tell the truth.
