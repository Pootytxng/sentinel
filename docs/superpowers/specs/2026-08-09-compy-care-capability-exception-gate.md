# Compy Care + Capability Exception Gate — Product and Architecture Specification

> **Status:** owner-approved direction; implementation-ready plan; runtime unchanged
> **Date:** 2026-08-09
> **Owner:** Kuya
> **Work Control:** [issue #91](https://github.com/Pootytxng/sentinel/issues/91)
> **Predecessor:** PR #90 @ `c2868bc` records exact current-head gates; its independent review and
> merge/disposition must finish first, with a rerun if that head moves
> **Plans:** [policy rails](../plans/2026-08-09-capability-exception-policy-rails.md) ·
> [Tier 1 build](../plans/2026-08-09-outbound-case-intelligence-tier1.md)

## 1. Decision in one sentence

Compy becomes the first place a non-technical Windows gamer goes after any crash, freeze, slowdown or
unexplained hiccup; it explains local evidence, offers one safe next step, and may cross a stronger
capability boundary only through a named exception that proves the benefit justifies the exact risk.

## 2. The user failure this must fix

A tester's game crashed after they tabbed out to play a song in Discord. They opened Event Viewer
because that was familiar, saw that Windows recorded a problem, still did not understand the root
cause, and accepted that dead end. When asked to use Compy's recent-crash analysis, they could not
find it while actively navigating and abandoned the search.

That is not primarily an analysis-engine failure. It is a product failure in three consecutive
moments:

1. **Recognition:** Compy did not meet the user at the moment or next launch with "a crash happened."
2. **Discovery:** the useful workflow was named/placed like an internal tool ("Black Box"), not a
   user intent.
3. **Closure:** the product did not own the complete question: what happened, what evidence supports
   that explanation, what should I do now, and did that help?

A technically functional tool that a user cannot find under stress has zero practical capability.

## 3. Product hierarchy and naming

### 3.1 Primary product

**Compy Care** is the umbrella: the PC doctor for everyday Windows gamers.

The interaction promise is:

> Something went wrong → Compy finds the relevant evidence → explains what is known and uncertain →
> recommends one safe next test/recovery → remembers the outcome.

### 3.2 First user-facing rescue surface

Rename the primary navigation label **Black Box** to **Crash & Freeze Rescue**.

- "Black Box" may remain an internal module/file name during migration.
- "Paramedic" may remain an internal initiative name, not the user label.
- The visible verb is **Scan recent crashes**.
- The entry must be reachable from Home and from a plain-language symptom router.
- A crash deep-link must open the rescue station, never the Optimize station.

### 3.3 Secondary specialty

Optimization becomes Compy's treatment/conditioning wing:

- readiness checks;
- safe/reversible fixes;
- before/after measurement;
- rollback and Trust Ledger;
- performance experiments and prescriptions.

It is still premium value, but no longer the only recurring reason to open the app.

### 3.4 Care loop and coverage ladder

Compy Care is a continuing case relationship, not a one-shot scanner:

1. **Intake** — the user names a symptom in ordinary language or Compy surfaces a recent incident.
2. **Triage** — distinguish urgent recovery, degraded-but-usable, and informational states without
   scare language.
3. **Local case chart** — retain the incident, relevant measured context, steps tried and outcomes on
   this PC; no account is required.
4. **Bounded differential** — show Windows facts, plausible contributors and known-issue matches as
   separate evidence classes.
5. **One plan** — give the safest useful next test/recovery first; alternatives stay behind detail.
6. **Follow-up** — ask whether the symptom returned and whether the step helped; compare only what was
   actually measured.
7. **Prevention** — turn proven recurrence patterns into calm maintenance or rollback advice.

Coverage expands in evidence-earned trains:

- **Train 1:** application/game crashes, hangs, GPU timeouts, unexpected restarts and BSOD/WHEA.
- **Train 2:** measured performance regressions, stutter and unexplained slowdowns.
- **Train 3:** thermal/noise/clock-limit symptoms using available honest sensors.
- **Train 4:** storage pressure, startup failure and Windows/driver update trouble.
- **Train 5:** network, peripheral and device problems.

Optimization lives inside this loop as treatment/conditioning. No later train inherits authority from
Tier 1 case intelligence or from the medical metaphor; each needs its own evidence, safety and privacy
contract.

## 4. Five-second information architecture

A user who just experienced a crash must not need to understand Compy's room names.

### Persistent paths

- **Home:** "Something crashed recently" card when a new incident exists; primary action
  **Find out why**.
- **Home, always:** one compact **PC help** entry with symptom choices:
  "A game closed or froze" · "The PC restarted/blue-screened" · "It feels slow" · "Something else."
  This entry is rendered independently of `compy_home_intake`; the broader intake/optimization band
  remains default-OFF.
- **Lab/diagnostics:** visible station label **Crash & Freeze Rescue**.
- **Search/command routing:** "crash", "freeze", "game closed", "blue screen", "restart", "error",
  "Event Viewer" and "Discord tab-out" route to the same station.

### Result hierarchy

The first screen after a scan answers four things in this order:

1. **What happened** — event kind, app, time, plain language.
2. **What the evidence points to** — facts first, then bounded hypotheses.
3. **What to do next** — one safe action; alternatives behind detail.
4. **How to prove it** — retry condition and what Compy will compare/observe.

Raw Event Viewer receipts, WER fields and expert context remain available behind "Show evidence."

### Honest language

Allowed:

- "Windows recorded an application crash."
- "The faulting module was …"
- "This incident is consistent with …"
- "This crash matches the recorded shape of a known issue."
- "We do not have enough evidence to identify a likely contributor."

Not allowed without direct proof:

- "Discord caused the crash."
- "Driver X definitely caused it."
- "Compy fixed it."
- numeric confidence percentages invented from heuristics.

## 5. Existing architecture to reuse

The current code already owns most of the local spine:

- `src-tauri/src/blackbox.rs`: reads Event Log, WER and Reliability history; normalizes/deduplicates
  app crashes, hangs, GPU timeouts, WHEA, BSOD and unexpected restart evidence.
- `Incident` in `blackbox.rs`: structured time/kind/app/module/code/receipt/vitals/assessment.
- `src/surfaces/BlackBox.tsx`: existing scan/results/evidence/local feedback workflow.
- `src-tauri/src/intelligence.rs`: local machine/session changes with non-causal wording.
- `src-tauri/src/support_evidence.rs`: bounded, redacted local record with preview/export.
- `src-tauri/src/remote_rules.rs`: a proven signed-manifest verification pattern, but a privileged
  trust domain that Tier 1 must not reuse.
- `src-tauri/src/lib.rs`: native notification capability already registered for a simple
  `show()` nudge; there is no proven notification action/click callback contract.
- `blackbox::get_crash_blackbox()`: current collection is on-demand; there is no durable incident
  cursor/dedupe observer yet.
- `src/q2b-deferral-tripwire.test.ts`: production webviews and CSP are local-only.

The new work is a signed advisory-knowledge seam, an always-visible route and a small persisted local
observer around the existing incident collector—not a second evidence or diagnosis system.

## 6. Capability Exception Gate

### 6.1 Default

Every proposed capability begins:

- local;
- user-mode;
- least-privilege;
- non-invasive;
- offline-usable;
- fail-closed;
- bounded in CPU, memory, disk, network and startup cost.

Use documented Windows APIs, ETW, vendor SDKs, local evidence, WMI/CIM or a user-mode service first.

### 6.2 Required exception record

A proposal cannot leave the default posture until its record contains all of the following:

| Field | Required answer |
|---|---|
| User failure | Exact user-visible problem, not a technology wish |
| Success | Measurable outcome and acceptance test |
| Lower-risk proof | What was tried/ruled out and why it cannot meet success |
| Capability | Exact executable/module/driver/service/endpoint/caller |
| Authority | User/admin/SYSTEM/kernel; install/start/stop behavior |
| Data | Exact reads/writes/payload fields; purpose; destination |
| Performance | CPU/RAM/disk/network/startup budgets and measurement method |
| Security | Threat model, abuse paths, dependency/supply-chain controls |
| Anti-cheat | Processes touched, APIs used, compatibility evidence |
| Privacy | Consent, preview, retention/deletion, revocation, off switch |
| Recovery | Rollback/uninstall, last-known-good, failed-update recovery |
| Trust | Signing keys, rotation, update channel, custody |
| Rollout | hard-false → dark → canary → staged → general |
| Kill switch | Initial mechanism is local and deny-only; any remote disable signal is a separately gated inbound trust surface |
| Abort | Quantified safety/reliability/value conditions that stop rollout |
| Review | Independent reviewers, owner decision, expiry/re-review date |

Approval is capability-specific. It does not authorize adjacent endpoints, payload fields, IOCTLs,
CSP changes, Tauri permissions, telemetry, mutations or background scheduling.

### 6.3 Absolute boundaries

Even after this policy change:

- no third-party game/process DLL injection, runtime hooks or game-memory read/write;
- no execution inside an anti-cheat process;
- no vulnerable/borrowed third-party kernel driver;
- no generic physical-memory, arbitrary MSR, PCI configuration, I/O-port, device-register or kernel
  read/write primitive;
- no silent/background evidence upload;
- no automatic raw dump upload;
- no remotely supplied mutation primitive;
- no bypass around `actions.rs`, typed rollback or history-only undo;
- no fabricated measurement or causal claim.

## 7. Driver exception

No driver is needed or approved for Tier 1.

A future Compy-shipped driver may be proposed only when the record above also proves:

- a kernel driver is genuinely required and a user-mode app/service/UMDF path is inadequate;
- scope is one named outcome, not a general hardware-access library;
- WDF is used and every device object/caller/IOCTL is least-privilege;
- IOCTL values and buffers are constrained; METHOD_NEITHER is avoided;
- HVCI/Memory Integrity compatibility is designed and tested;
- Driver Verifier, static analysis, HLK/compatibility, signing, install/update/uninstall and rollback
  all pass;
- anti-cheat compatibility is documented across the target matrix;
- an independent driver-security review finds no critical/high issues;
- there is a staged kill switch and a recovery path if the driver prevents boot/app launch.

A sensor tile is not enough justification. Until a driver actually clears this gate, CPU temperature
remains external-monitor-only and unavailable remains honest.

This follows Microsoft's first driver-security question: confirm a kernel driver is necessary and a
lower-risk app/service is not better. Microsoft also requires least-privilege access, HVCI
compatibility, threat analysis, peer review, Driver Verifier and proper signing:
https://learn.microsoft.com/en-us/windows-hardware/drivers/driversecurity/driver-security-checklist

## 8. Outbound tiers

### Tier 1 — signed public case knowledge

Purpose: keep known-issue guidance current.

- Trigger: explicit rescue scan/refresh when the cache is stale; no startup polling in the first
  implementation.
- Request: fixed HTTPS GET to an allowlisted endpoint; no query containing machine/incident data.
- Disclosure: network request plus unavoidable IP/TLS/server metadata; global off switch.
- Response: signed public catalog.
- Processing: catalog verified/cached, then matched locally.
- Upload: none.
- Gate: hard-false until endpoint, key custody, privacy copy, review and canary evidence are exact.

### Tier 2 — scrubbed incident fingerprint

Purpose: learn which issue shapes recur across rigs.

Not authorized by Tier 1. Requires a separate spec and owner decision. Minimum posture:

- explicit opt-in, default OFF;
- payload preview before enabling and any time schema changes;
- allowlisted coarse fields only;
- no raw Event Viewer text, dump, path, user name, serial, IP stored as identity, free-form text or
  support bundle;
- retention/deletion and revocation;
- rate limits, abuse controls and kill switch.

### Tier 3 — explicit per-case evidence upload

Purpose: send one incident to Compy support.

Not authorized by Tier 1 or Tier 2. Minimum posture:

- explicit consent for that incident after preview and redaction;
- exact recipient, purpose and retention/deletion response shown;
- user can remove fields before send;
- one-case receipt records what was sent and when;
- no inherited consent, no background queue, no automatic retry after consent expires;
- raw dumps remain excluded from automatic upload and require a separately explicit flow if ever
  proposed.

Windows notes that crash dumps may contain memory state and unintended file content. That is why raw
dumps are treated as high-sensitivity evidence:
https://support.microsoft.com/en-us/windows/diagnostics-feedback-and-privacy-in-windows-28808a2b-a31b-dd73-dcd3-4559a5199319

## 9. Tier 1 signed catalog architecture

### 9.1 Trust separation

Create `src-tauri/src/case_intelligence.rs`. Do not implement inside:

- `remote_rules.rs` — privileged mutation-policy trust domain;
- `receipts.rs` — future opt-in aggregate-result sharing;
- `support_evidence.rs` — local support record;
- frontend/webview code — would widen CSP and trigger issue #64.

Tier 1 has its own:

- Ed25519 public key and offline private-key custody;
- manifest/canonicalization version;
- endpoint/domain allowlist;
- cache directory and files;
- monotonic catalog version;
- runtime gate and local deny-only kill switch;
- source/provenance label.

The compiled source-link authority is `CASE_SOURCE_ORIGINS` in
`src-tauri/src/case_intelligence.rs`. It is owned by the Rust/security review lane and changes only
through an app release. A catalog entry may select a signed HTTPS URL whose exact origin is already in
that list; the catalog cannot extend the list, introduce a transport origin, redirect the catalog
download, or trigger an in-app fetch. Sources open in the system browser only after a user click.
Catalog endpoint origins are a separate compiled allowlist in the same module.

The first Tier 1 kill switch is local and deny-only: it can keep the hard-false gate closed or disable
refresh/use. It cannot enable or configure case intelligence. Any remote disable signal requires a
new Capability Exception record, a signing trust distinct from both case intelligence and remote
rules, and a separate owner arming decision; it may disable only and cannot be carried in the catalog.

Cryptographic primitives may be extracted and reused only if the type system keeps trust roots,
manifest types and cache namespaces distinct.

### 9.2 Manifest

```rust
struct CaseCatalogManifest {
    schema_version: u32,
    catalog_version: u64,
    created_at: String,
    expires_at: String,
    min_app_version: String,
    max_app_version: String,
    catalog_sha256: String,
    catalog_url: String,
    signature: String,
}
```

Required validation order:

1. reject placeholder/unknown key;
2. parse with unknown fields rejected;
3. canonicalize and verify signature;
4. validate app-version range;
5. enforce expiry;
6. enforce monotonic version;
7. enforce allowlisted HTTPS origin and redirect policy;
8. enforce manifest/catalog size and timeout;
9. download catalog;
10. verify SHA-256;
11. parse strict catalog schema and bounded entries;
12. atomically replace last-known-good cache.

On any failure, keep embedded/previous verified knowledge and report a calm source state. Never cache
before full verification.

### 9.3 Catalog

```rust
struct CaseCatalog {
    schema_version: u32,
    entries: Vec<CaseEntry>,
}

struct CaseEntry {
    id: String,
    revision: u32,
    incident_kinds: Vec<IncidentKind>,
    matchers: Vec<PublicMatcher>,
    required_evidence: Vec<EvidenceRequirement>,
    title: String,
    summary: String,
    next_steps: Vec<AdvisoryStep>,
    contraindications: Vec<String>,
    source_url: String,
    source_updated_at: String,
}
```

The schema permits only bounded public advisory data. It cannot contain scripts, HTML/Markdown,
registry paths, service/task names, mutation/action IDs, executable commands, arbitrary regex,
frontend components or endpoint overrides.

Match primitives are normalized exact/prefix/version-range checks over already-available local
fields: incident kind, app executable family, faulting module family, public error/bugcheck code,
GPU vendor/driver version range, Windows build range and required evidence presence.

### 9.4 Match result

```rust
enum CaseMatchLevel {
    NoCatalog,
    CatalogUnavailable,
    NoKnownMatch,
    PossibleKnownIssue,
    MatchedKnownIssue,
}

struct CaseIntelligenceMatch {
    case_id: String,
    catalog_version: u64,
    level: CaseMatchLevel,
    title: String,
    summary: String,
    evidence_refs: Vec<String>,
    next_steps: Vec<AdvisoryStep>,
    source_url: String,
    source_updated_at: String,
}
```

No numeric confidence. A matched known issue still says "matches the recorded shape," not "caused."

### 9.5 Network contract

- Rust-side only.
- GET/HEAD only; no POST/PUT/PATCH/DELETE.
- No incident serialized into URL, query, header or body.
- No cookies, account token or stable installation ID.
- Fixed User-Agent may contain Compy version only if disclosed.
- Redirects off or same-origin only.
- strict response sizes and timeouts;
- cache freshness avoids repeated requests;
- global off switch;
- no webview `fetch`, CSP change or remote content.

## 10. Local incident observation and notifications

Notifications are a secondary nudge, not the discovery system. The persisted Home card is the
authoritative route and remains available when notifications are disabled.

### 10.1 Dedicated observer and durable state

Create `src-tauri/src/incident_observer.rs`. It consumes normalized incidents from `blackbox.rs`;
it does not reread Windows sources independently and does not create a service or scheduled task.
`blackbox.rs` derives a stable, path-free `incident_id` from canonical incident facts.

State lives at `%APPDATA%\Compy\care\incident-observer.json`:

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

Writes are temp-file + flush + atomic replace. Corrupt state is quarantined and fails safe to manual
rescue with no notification spam. Keep at most 128 observations and 30 days; a pending card expires
after 7 days. A same-app/incident-family notification has a 30-minute cooldown while the newest exact
incident may still become the pending Home card. These are lifecycle caps, not confidence claims.

### 10.2 Observation lifecycle

- **First ever observer run:** seed the watermark and current incident IDs; do not alert on historical
  backlog.
- **Every later app launch and main-window foreground:** scan only since the saved watermark.
- **After a monitored game/session ends:** run one targeted scan after existing session finalization.
- **While running:** no periodic polling in the first release. A bounded cadence may be proposed only
  after collector cost and notification value are measured.
- **While Compy is closed:** nothing runs. On next launch, the saved watermark lets Compy find
  qualifying incidents that occurred during downtime and persist the newest Home card.
- **High-signal predicate:** a real Event Log/WER/Reliability incident of application crash/hang, GPU
  timeout, BSOD/WHEA or unexpected restart. Assessment heuristics alone never trigger a nudge.
- **Dedupe:** exact `incident_id` is notified at most once; cooldown reduces same-family bursts.

### 10.3 IPC, routing and notification contract

Add main-window-only commands:

- `get_pending_care_incident() -> Option<PendingCareIncident>`;
- `mark_care_incident_opened(incident_id: String)`;
- `dismiss_care_incident(incident_id: String)`.

The pending DTO contains the stable ID, occurred-at time, incident kind, app/display label and calm
summary—no raw receipt, path or dump. Home's **Find out why** writes the one-shot Lab station
`blackbox` plus the selected incident ID, then marks it opened only after Crash & Freeze Rescue
actually consumes that selection. Dismissal is explicit; expiry is automatic.

The current official desktop notification plugin exposes a simple show operation, not a supported
action/click callback carrying an incident payload:
https://docs.rs/tauri-plugin-notification/latest/src/tauri_plugin_notification/desktop.rs.html

Therefore the initial toast says: **"A game appears to have closed unexpectedly. Open Compy to review
the evidence."** It carries no promise that clicking the toast opens a selected case. If Windows'
default click merely foregrounds Compy, the frontend reads the persisted pending state and shows the
card; that behavior must be empirically proved before it is described as click-through. Direct
notification-action routing is a later capability only if the notification API and installed-build
test support it.

Microsoft's notification guidance says notifications should be timely, actionable, concise and
valuable enough to justify interruption:
https://learn.microsoft.com/en-us/windows/apps/develop/notifications/app-notifications/app-notifications-ux-guidance

## 11. Competitive/product research translated into decisions

- **Windows Security Device performance & health** succeeds by opening to a current health scan,
  showing whether attention is needed, and attaching actionable recommendations. Compy should copy
  that glance hierarchy, then go deeper on game/application incidents:
  https://support.microsoft.com/en-US/Windows/Security/Windows-Security/device-performance-and-health-in-the-windows-security-app
- **WhoCrashed** succeeds with one Analyze action and a comprehensible report with suggestions and
  source links. Its own FAQ says it handles system crashes, not ordinary application crashes. Compy
  can own the broader game/application case while retaining honest uncertainty:
  https://www.resplendence.com/whocrashed_help
- **Apple's app-crash support flow** gives direct next actions—reopen, restart, update, remove recent
  peripherals/plugins—rather than leading with raw logs. Compy's result should likewise lead with
  one safe next step and place evidence behind it:
  https://support.apple.com/en-euro/guide/mac-help/mchlp2579/mac
- **Windows Error Reporting LocalDumps** provides a supported local dump-collection mechanism. It is
  a future explicit diagnostic option, not a reason to upload dumps:
  https://learn.microsoft.com/en-us/windows/win32/wer/collecting-user-mode-dumps
- **PresentMon** demonstrates the existing anti-cheat-safe external ETW pattern for performance
  capture. Tier 1 needs no injection:
  https://github.com/GameTechDev/PresentMon

The product principle is: **glance first, one next action, proof on demand.**

## 12. Privacy/data map

| Data | Current/Tier 1 location | Leaves device? | Retention/control |
|---|---|---|---|
| Event Log/WER/Reliability incident | local memory/result | no | existing local behavior |
| Black Box incident/assessment | local | no | existing behavior |
| Support evidence JSONL/export | local Compy data dir/user-selected file | no automatic transport | bounded caps, clear/export controls |
| Signed public case catalog | endpoint → local verified cache | downloaded only | expiry, LKG replacement, clear with app data |
| Local catalog match | local | no | incident lifecycle |
| Raw dump | local Windows path if separately enabled | no in Tier 1 | never auto-upload |
| Tier 2 fingerprint | not built | not authorized | separate future gate |
| Tier 3 case bundle | not built | not authorized | separate future gate |

## 13. Threat model and failure behavior

| Threat/failure | Required control |
|---|---|
| Catalog server compromise | Ed25519 signature + pinned separate public key |
| Signing-key compromise | offline custody, documented rotation via app update, local deny-only kill switch |
| Rollback/freeze attack | monotonic version + expiry + app compatibility |
| Cache tampering | full re-verification before use |
| Oversized/malicious catalog | byte/entry/string/depth caps, strict schema |
| XSS/copy injection | plain text only, normal React escaping, no Markdown/HTML |
| SSRF/redirect abuse | compiled allowlist, HTTPS, same-origin/no redirects |
| Privacy leak | no serialization of incident into any request; structural guard |
| Remote mutation escalation | catalog types cannot represent actions/commands; no actions.rs seam |
| UI overclaim | fixed match vocabulary and copy guards |
| Network unavailable | embedded/local analysis remains fully useful |
| Bad advisory | source + updated date, contraindications, feedback, catalog kill switch |
| Notification fatigue | high-signal only, bounded dedupe, persisted Home fallback, off control; no unproven click promise |

## 14. Rollout

1. **Policy/guards:** land #91 docs and law markers; runtime unchanged.
2. **Pure domain dark:** types, parser, verifier, matcher, cache tests; gate false; no endpoint.
3. **Transport dark:** fixed test endpoint in test harness only; production gate false.
4. **UI contract dark:** optional match field; absent path byte/behavior compatible.
5. **Discoverability:** always-visible Home Care entry plus Crash & Freeze Rescue deep-link;
   preserve the broad intake flag as default-OFF and coordinate with #49.
6. **Local observation:** persisted incident cursor/Home card, launch/foreground/session-end scans and
   a plain notification nudge; no service, polling cadence or assumed click callback.
7. **Security/privacy review:** exact endpoint, key custody, request trace, copy, guard mutation tests.
8. **Canary:** owner-approved endpoint/key; limited machines; abort on crash/perf/privacy/signature
   failure.
9. **Arming decision:** only after evidence pack. No automatic inheritance from this spec.
10. **Later Care trains and Tier 2/3:** new evidence contracts/specs/decisions, not continuation tasks.

## 15. Success measures

Before broader arming, prove:

- a fresh tester can reach Crash & Freeze Rescue from Home in five seconds without coaching;
- a recent app/game crash becomes a specific incident card rather than a log dump;
- every claim visibly distinguishes Windows fact, local hypothesis and signed-known-issue match;
- one safe next step is visible without expanding expert detail;
- disabled/unavailable/invalid catalog preserves today's local scan behavior;
- Tier 1 packet/request inspection shows no incident or machine-derived payload;
- no webview network surface, CSP widening, mutation variant or support-evidence transport appears;
- invalid/tampered/expired/rolled-back catalogs never render an advisory;
- the persisted Home card opens the exact incident; the toast remains a secondary nudge and direct
  click activation is not claimed unless an installed-build test proves a supported contract;
- repeated incidents do not produce notification spam and first-run history does not alert;
- owner can turn case-knowledge refresh off without affecting local diagnosis.

These are product/engineering acceptance criteria, not marketing claims.

## 16. Non-goals for the first train

- kernel driver;
- raw dump analysis/upload;
- debugger/symbol server integration;
- AI-generated root cause;
- Tier 2 fingerprints;
- Tier 3 support upload;
- remote mutation rules;
- webview/network/CSP changes;
- Lab shell redesign;
- a Windows service, scheduled task or unmeasured always-on polling loop;
- guaranteed notification-click payload routing with the current plugin;
- reviving Quiet Pit Wall draft PR #50;
- claiming every crash is diagnosable.

## 17. Queue and ownership

- PR #90 remains the predecessor. Its `c2868bc` exact-gate receipt is current as of 2026-08-09;
  complete the missing independent review and merge/disposition first, and rerun if its head moves.
  PR #90 overlaps #91 in `AGENTS.md`, `CLAUDE.md` and `docs/RELEASE_STATE.md`, so rebase after
  disposition is mandatory.
- #91 owns policy, spec, guards and the isolated Tier 1 domain/backend train.
- #49 owns the Lab production shell; #91 offers a narrow route/label contract, not a competing shell.
- #64 stays deferred while Rust-side transport keeps CSP/local webviews unchanged.
- #55's stale Project Doctor claim remains separate and unadopted.
- One active writer per file/worktree; claim updates live in Work Control issue comments.
