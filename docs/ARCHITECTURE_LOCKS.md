# Architecture Locks

**Status:** SUPREME SAFETY / ARCHITECTURE AUTHORITY  
**Product direction:** [`PRODUCT_CONSTITUTION.md`](PRODUCT_CONSTITUTION.md)  
**Current implementation/release truth:** [`RELEASE_STATE.md`](RELEASE_STATE.md)

This document defines safety, rollback, privilege, persistence, trust-root, network/capability, and
immutability contracts that are deliberately hard to change once users are in the wild.

It does **not** define whether Care or Performance is primary, product positioning, monetization,
roadmap order, or UX hierarchy. Those belong to the Product Constitution and its derived documents.

Breaking these locks silently is a users-can't-update-or-rollback class incident — or worse, a
remote-control-plane / privilege-escalation incident.

Point-in-time statements such as “built,” “armed,” “installed,” or “verified” belong in
`RELEASE_STATE.md`; this file states the durable contract.

---

## 1. Operating policies

### 1.1 Remote rules are privileged policy, not ordinary data

Any remotely supplied rule capable of selecting a privileged Windows action is treated as privileged
policy metadata with the same seriousness as executable update policy.

Required invariants:

- **No generic mutation dispatcher.** No remote `registry-set`, `service-set`, arbitrary PowerShell,
  command string, path string, or equivalent generic write primitive.
- Apply behavior is represented by typed, source-auditable enums and allowlisted parameters.
- A maintainer must be able to enumerate every privileged operation Compy can perform by reading the
  shipped source.
- Remote policy may select only among actions the shipped binary already knows.
- Unknown enum variants, fields, services, identifiers, or parameters fail closed.
- The privileged action allowlist changes only through an app release.

Remote knowledge/advisory data and remote mutation policy are separate trust surfaces and must never
be conflated.

### 1.2 AI explains and assists; it does not own mutation authority

An LLM or other probabilistic system may:

- explain a supported recommendation or Trial;
- summarize detected hardware/state;
- summarize logs/history/evidence;
- help classify or communicate evidence;
- suggest advisories for **human review** before any apply path runs.

It may not, with no exceptions:

- decide what to apply;
- invent a new mutation primitive or tweak action;
- choose arbitrary registry paths, services, commands, drivers, or parameters;
- write or alter apply or rollback logic;
- write or modify the privileged action allowlist at runtime;
- bypass the deterministic eligibility, Trial, Risk, rollback, or verification machinery;
- turn a probabilistic suggestion directly into an elevated mutation.

**The AI narrates the chainsaw. It does not hold it.**

No product doctrine, including the Product Constitution, changes this mutation-authority boundary.

### 1.3 Offline-capable cold start

Compy must be useful on first launch with no network access, indefinitely.

For signed remote rule/advisory systems:

- the embedded baseline is the starting catalog. Always;
- remote validation runs in the background, only after the UI is interactive;
- the catalog is replaced only if the remote bundle passes every gate in §1.4;
- failure, expiry, timeout, or signature rejection keeps the embedded or last-known-good catalog active;
- absence of network is at most a small, non-alarming status line ("Using built-in recommendations.
  Online rule updates unavailable.") — no modal, no panic, no upsell, no false failure;
- support evidence must be able to identify which source was active (embedded / cached / remote).

The exact online capabilities currently armed are Release State truth.

### 1.4 Signed remote mutation policy is fail-closed

No remote **mutation rules** capability may ship armed until all of the following are true:

- production Ed25519 public key embedded in the binary;
- signed manifest with at least `schema_version`, `ruleset_version`, `created_at`, `expires_at`,
  `min_app_version`, `max_app_version`, `rules_sha256`, and `rules_url`;
- manifest signature verification before any rules JSON is downloaded;
- rules bytes are SHA-256 bound to the signed manifest;
- monotonic ruleset version blocks rollback attacks;
- expiry blocks freeze attacks;
- app-version range is enforced;
- last-known-good cache exists;
- oversized payloads are rejected;
- network operations have bounded timeouts;
- active source/provenance is observable for support;
- the action set remains source-allowlisted under §1.1.

**Unsigned remote rules must never ship, even in beta.**

Remote fetch stays disabled behind three independent gates: a placeholder public key that fails closed
before any cryptographic verification runs, a hard-false runtime enable gate that is independent of the
key check, and no configured production URL. Both code guards must be removed together to arm remote
fetch; there is no shipped path where one is on and the other is off. Arming is a deliberate, reviewed
change; one changed constant must never accidentally enable the entire control plane. Private beta with
the embedded baseline only is fine; private beta with unsigned remote fetch is not, and the control plane
is never smuggled in under "we'll add signing later."

### 1.5 Rollback is independent of the current catalog

A user must be able to roll back a Compy-applied change even when:

- the network is unavailable;
- the rule is removed, renamed in presentation, or no longer recommended;
- the remote catalog changes;
- the user is on a different compatible app version;
- implementation details are refactored.

Therefore the complete rollback contract is captured **at apply time** and persisted locally.
Rollback consults local history, not the current recommendation catalog.

**Never apply a change you can't roll back.** An operation whose prior state cannot be captured
restorably is structurally unavailable to automated apply (see "Structural impossibility" in §3). A
user's risk preference, including any "Push" tier, never unlocks it, and no product ambition infers an
exception; the only route to change this rule is an explicit owner-approved amendment under §6.

### 1.6 Remote/UI text is untrusted input

Remote advisory/rule strings rendered by the UI are treated as untrusted plain text.

No remote HTML execution, no `dangerouslySetInnerHTML`, no markup path that can become script or
privileged command execution. Rendering must escape content at the presentation boundary.

### 1.7 Measurement claims remain evidence-scoped

Compy may describe a deterministic state change as verified only when it verified that state.

Compy may describe a performance/latency/stability effect as measured only when actual measurement
supports it on the relevant machine/workload.

Keep these categories distinct:

- **Known/verified state** — deterministic observation/configuration verification.
- **Measured result** — observed benchmark/session/Trial effect.
- **Supported inference** — evidence points toward an interpretation but does not prove cause.
- **Expected mechanism** — engineering rationale, not measured outcome.
- **Unknown** — insufficient evidence.

Synthetic microbenchmarks may be health signals; they are not automatically proof that a game
improved. Real before/after gaming claims require comparable game/workload evidence and the Trial
Protocol's noise rules.

A delta that does not clear credible run-to-run noise is reported as **no measurable change**, not a
win rounded up for marketing.

### 1.8 Capability Exception Gate + outbound case intelligence

**Owner decision (2026-08-09, issue #91):** the blanket "no Compy driver / no new outbound surface"
prohibitions were replaced by this challengeable gate. It is not a general unlock. Directive:
`docs/superpowers/specs/2026-08-09-compy-care-capability-exception-gate.md`; execution plans:
`docs/superpowers/plans/2026-08-09-capability-exception-policy-rails.md` and
`docs/superpowers/plans/2026-08-09-outbound-case-intelligence-tier1.md`.

Every new capability starts local, user-mode, least-privilege, non-invasive, offline-usable where
reasonable, and fail-closed.

Before requesting a stronger boundary, the proposer must first evaluate documented Windows APIs,
ETW, vendor-supported SDKs/interfaces, local files, WMI/CIM, or another lower-risk user-mode route.

A valid exception record names:

1. user-visible failure and measurable success criterion;
2. evidence lower-risk routes cannot deliver the outcome;
3. exact target, caller, privilege level, data read/written, persistence, and performance budget;
4. anti-cheat, security, privacy, and stability threat model;
5. consent, disclosure, retention/deletion, and revocation behavior;
6. rollback/uninstall, update/signing, kill switch, and bad-release recovery;
7. dark/canary/staged proof, independent review, abort metrics, and review expiry;
8. explicit owner decision to implement and, separately where needed, to arm/release.

Approval applies only to the named capability. It cannot be cited to justify an adjacent driver
IOCTL, endpoint, payload field, telemetry field, CSP widening, permission, or mutation.

#### Boundaries that remain absolute

- **No third-party game/process injection:** no DLL injection, game-memory read/write, runtime hooks,
  or executing Compy code inside a game or anti-cheat process.
- No vulnerable/borrowed third-party kernel driver (BYOVD).
- No generic physical-memory, arbitrary MSR, PCI configuration, I/O-port, device-register, or
  kernel read/write primitive.
- No silent evidence upload, raw dump auto-upload, or hidden background evidence queue.
- Remote/advisory content never creates a mutation primitive or bypasses `actions.rs`.

#### Compy-shipped driver exception

A Compy driver is policy-possible only through its own approved Capability Exception record; the
current runtime remains driver-free and no driver may be built before that record exists. The mere fact that a sensor, optimizer, or competitor uses a driver is not sufficient justification.

Any driver proposal additionally requires:

- proof the desired outcome cannot be reached with a safer supported interface;
- minimal WDF-style design and narrowly constrained IOCTL/caller surface;
- HVCI/Memory Integrity compatibility;
- Driver Verifier and appropriate compatibility/HLK testing;
- signed distribution and clean uninstall/rollback;
- anti-cheat compatibility analysis;
- independent driver-security review;
- explicit staged-release abort criteria.

A driver must never be justified only to fill an otherwise honest “unavailable” sensor tile.

#### Outbound tiers

These are distinct capabilities and never inherit consent from one another:

| Tier | Purpose | Consent | Data leaving Compy | Independent gate |
| --- | --- | --- | --- | --- |
| **1 — signed case knowledge** | keep public advisory knowledge current | disclosed request + global off switch | catalog request metadata only; **no machine-derived incident payload** | separate advisory signing trust, domain, cache, caps, timeouts; local deny-only kill switch |
| **2 — scrubbed incident fingerprint** | learn recurring issue shapes | opt-in, default OFF **and it stays OFF after arming**, disclosed at first run, real off switch, previewable (owner ruling 2026-08-24 #207, retiring the 2026-08-18 "on by default once armed" <!-- retired-claim-allow --> amendment) | allowlisted coarse fields only; no raw dump/log/path/serial/user identity | payload schema, redaction proof, retention/deletion, revocation, abuse review |
| **3 — per-case evidence upload** | user intentionally sends one support case | explicit per-incident consent after preview/redaction | exactly the displayed bundle to the named recipient | one-case receipt, endpoint policy, retention/deletion response, no background queue |

Each tier requires its own schema, retention/deletion, abuse, and security review appropriate to the
data it handles. Tier 1 does not authorize Tier 2 or 3; each later tier needs its own Capability
Exception record, consent copy, and arming decision.

#### Kill-switch and source-origin authority

Tier 1's initial kill switch is **local and deny-only**. It may keep the production gate false or stop
refresh/use of case intelligence; it cannot enable the feature, change endpoints, add payload fields,
alter matching, or weaken the hard-false gate. Any remotely delivered disable signal is a new inbound
trust surface and needs its own Capability Exception record, distinct signing key/schema, and owner
arming decision; it may disable only, never enable or configure, and it cannot travel inside the
advisory catalog.

Public case-source origins use a compile-time `CASE_SOURCE_ORIGINS` allowlist owned in
`src-tauri/src/case_intelligence.rs`. That list changes only through an app release with Rust/security
review. A signed catalog may select a URL under an existing allowed HTTPS origin; it cannot add an origin,
redirect Compy's transport, mutate the machine, or trigger an in-app arbitrary fetch. Opening a
source is an explicit user click into the system browser.

#### Tier 1 implementation lock

The first outbound case-intelligence build is a separate Rust-side advisory module, not
`remote_rules.rs`, `receipts.rs`, or `support_evidence.rs`, and not a webview fetch. It uses a
separate public key, manifest schema, catalog-endpoint allowlist, compiled source-link allowlist, cache
namespace, and monotonic version. It verifies signature, hash, expiry, app-version range, and size
before caching; preserves an embedded/last-known-good fallback; matches the downloaded public catalog
against the existing local incident on-device; and returns advisory wording only. It does not widen
CSP, upload incident data, add a mutation variant, or alter support-evidence transport. The runtime
gate stays hard-false until endpoint, signing custody, privacy copy, security review, and arming
evidence are exact.

---

## 2. Immutability tiers

These are durable compatibility contracts. Current implementation details are verified against source
and Release State; the compatibility rule survives refactors.

### Tier 1 — immutable once shipped to users

#### Recommendation / Trial action identifiers

Every shipped stable recommendation/action identifier that can appear in persisted history is a
permanent compatibility contract. Retired items keep their historical identifier. Presentation names
may change; persisted IDs do not.

#### `AppliedChange` rollback schema

Persisted rollback history under `%APPDATA%\Compy\history.json` is additive-only once shipped.
Existing serialized fields may not be renamed or removed without a backwards-compatible migration
that preserves rollback for existing users.

The durable minimum contract includes the semantic equivalents of:

```rust
struct AppliedChange {
    id: String,
    rec_id: String,
    rec_title_at_apply: String,
    applied_at: String,
    status: String,
    applied_action: AppliedAction,
    rollback_action: RollbackAction,
    snapshot: Snapshot,
    app_version_at_apply: String,
    ruleset_version_at_apply: String,
    elevation_used: bool,
}
```

Fields may be added with backwards-compatible defaults where appropriate. Removing the ability to
read an older persisted change is a rollback-breaking migration and is forbidden without an explicit
compatibility plan.

`AppliedAction`, `RollbackAction`, and `Snapshot` are additive compatibility enums: new variants may
be added; shipped serialized variants are not casually renamed/removed.

#### Snapshot contract

A Snapshot stores the prior machine state necessary to restore one bounded mutation shape.
Examples include service state/start type, registry prior values, prior power plan, NIC-state sets,
or another typed prior-state structure.

`Snapshot::None` is not permission to apply an otherwise irreversible optimization. It is valid only
for action shapes whose rollback contract legitimately requires no captured machine value.

#### Bundle identifier

`gg.compy.app` is the current durable application identifier established by the Sentinel→Compy
migration. Changing it after distribution can break installed-app identity and data/rollback paths;
any future change requires an explicit migration plan and owner release decision.

#### AppData root

`%APPDATA%\Compy` is the durable user-data root for persisted history. Renaming/moving it requires
migration code that preserves existing data and rollback.

### Tier 2 — schema-versioned contracts

#### Remote rule/advisory schemas

Remote schemas use explicit schema versions and versioned compatibility. Older supported clients must
remain able to fetch/validate the schema version they understand until that client version reaches a
deliberate EOL.

A schema mismatch is a loud failure, not silent best-effort parsing of privileged data.

#### Typed privileged action allowlist

Applied and rollback actions remain separate typed contracts: what was done is distinct from how the
stored snapshot restores it.

Privileged enums use strict deserialization. No free-form registry/service/command strings from a
remote source, no permissive `serde(other)` catch-all on enums that drive privileged behavior, and no
unknown-field acceptance that can silently reinterpret policy. Concretely: `deny_unknown_fields` on
every persisted/privileged struct, exhaustive enum tag matching, and unknown variants → loud parse
failure, never silent reinterpretation.

Allowlisted identifiers are additive and source-reviewed.

#### Recommendation/category taxonomy

Serialized or externally consumed category/taxonomy values are changed only with coordinated schema
migration. UI labels may evolve without rewriting persisted compatibility identifiers.

### Tier 3 — changeable with deliberate migration/testing

Examples:

- additive history metadata with safe defaults;
- implementation dependency used for elevation, when behavior/security remain equivalent;
- WMI/DXGI/SMBIOS detection source changes with validated fallbacks;
- internal module decomposition that does not change persisted or privilege contracts.

---

## 3. Performance-tuning exclusions and entry conditions

The old “baseline v1” framing is retired. Current product risk/Trial policy lives in
`product/RISK_MODEL.md`, `product/TRIAL_PROTOCOL.md`, and `product/OPTIMIZATION_ENGINE.md`.

### Permanently barred from Compy's normal automated optimization catalog

These stay barred regardless of an attractive benchmark delta unless a future explicit architecture
amendment proves the underlying safety premise itself has changed:

- HPET/timer hacks;
- BCDEdit timer/boot-parameter hacks;
- global MMCSS abuse;
- forced core-parking writes / numproc boot manipulation;
- disabling Defender or equivalent security protections for performance;
- disabling Windows Update as a gaming optimization;
- disabling hardware security/mitigation patches for performance;
- fixed-size pagefile forcing that creates preventable crash/data-risk conditions;
- universal MPO (Multi-Plane Overlay) disable as a blanket optimization;
- ungated kernel-level mutation capability;
- vulnerable-driver techniques;
- game/anti-cheat injection;
- any technique known to trip or bypass EAC/BattlEye or equivalent anti-cheat in an unsupported way.

**Measurement does not make an unsafe mechanism safe.**

### Candidate only after constitutional Trial + Risk proof

The following classes are not automatically good or bad; they become candidates only when relevant
to the actual machine/workload, reversible, supportable, measurable, and inside the Risk Model:

- NIC offload/interrupt-moderation changes;
- fullscreen-optimization policy changes;
- bounded network-stack changes;
- advanced supported scheduling/power behavior;
- supported vendor tuning interfaces;
- other previously fashionable “optimizer” settings whose value must be proven per machine rather
  than assumed universally.

A candidate is not kept merely because it exists in another optimizer. Applicability + Trial evidence
+ rollback + risk determine inclusion.

### Conditions for any future inclusion of a barred or candidate-class item

Barred items are excluded from Compy's normal automated optimization catalog; they are not forever
banned from every diagnostic path. If any barred item, or any candidate-class item above, is ever
surfaced, it must be:

- advanced/diagnostic surface only (separate, opt-in UI; never the default journey);
- problem-specific (gated on a detected issue on this machine, not "more performance");
- user-initiated (never recommended by default; the user opens the surface and explicitly selects);
- behind strong warnings that name the specific risk, on top of the engineering controls, never
  instead of them;
- fully rollback-capable, with a snapshot that survives driver/Windows updates;
- documented with reproducible measurement methodology, not theoretical impact.

### Structural impossibility

If Compy cannot read or reconstruct the prior state reliably enough to satisfy rollback, automatic
apply remains structurally unavailable regardless of expected benefit. GPU-profile mutation remains
in this category while the relevant prior state cannot be read reliably through a supported interface.

---

## 4. Release/security checklist gates

This is a durable category checklist; exact completed/pending state belongs in `RELEASE_STATE.md` and
`OWNER_ACTION_CHECKLIST.md`.

Before broad public distribution, verify as applicable:

- public product name/trademark clearance;
- bundle identifier and migration plan;
- code signing integrated into the release pipeline;
- updater signing and owner-controlled publication path;
- final software license/EULA/privacy disclosures;
- permission/elevation explanation;
- rollback and data migration across supported upgrade paths;
- remote-rule production key/URL only when that capability is explicitly armed;
- last-known-good remote fallback behavior;
- AV/SmartScreen/installer trust testing appropriate to distribution channel;
- user-visible security/privacy claims match the actual binary.

Checklist completion is never inferred from this document; verify Release State.

---

## 5. Rules-signing key management

The privileged remote-rules signing key is a trust root for every remote-selected privileged action.
Treat compromise as a fleet security incident.

### Hard rules

- **The Ed25519 private key NEVER lives in this repository.** Not in commits, `.env*`, CI secrets of
  any kind, or unencrypted anywhere in a developer's home directory.
- Placeholder public keys and hard-false runtime gates fail closed.
- Public-key rotation occurs through an app update, not through the same CDN whose content the key is
  meant to authenticate.
- Manifest signature canonicalization is versioned and signer/verifier must agree exactly.
- The production key and release procedure are owner/security territory.

### Preferred private-key custody

1. Hardware security module / hardware-backed signing requiring operator action — preferred.
2. Dedicated offline/air-gapped signing system — acceptable when HSM custody is impractical.

The production private key MUST NOT live on any developer workstation, any cloud CI environment with
broad access, or any environment that has internet access during signing.

### Signing flow invariants

The release signer must:

1. hash the exact rules payload;
2. construct the exact versioned manifest;
3. sign the canonical manifest payload with the private key;
4. embed the signature;
5. self-verify against the intended public key before publication;
6. preserve monotonic ruleset versioning and bounded expiry.

The existing offline signer may implement this flow while it remains verified; specific command lines
and current source locations are implementation truth, not architecture law.

### Key compromise

On suspected compromise:

- stop/disable remote refresh through the safest available deny path;
- immediately prepare, and publish under the owner's release gate, an app update that embeds a new
  public key/trust root;
- do not use the compromised key to “announce” its own replacement;
- preserve safe last-known-good/offline behavior for old clients;
- document incident scope and rotate according to the release/security process.

A compromised privileged-policy key is not a routine content-operations event.

---

## 6. Architecture amendment rule

A material change to this document requires:

1. explicit statement of which lock changes and why;
2. product need tied to the Product Constitution;
3. threat/rollback/compatibility analysis;
4. migration impact on existing users and persisted data;
5. tests/guards capable of detecting accidental regression where mechanizable;
6. independent review appropriate to the risk;
7. owner approval for security, secrets, capability, irreversible, or fleet-visible boundaries;
8. same-change reconciliation of dependent docs/tests.

Product ambition is allowed to grow. It must grow **through** these constraints rather than silently
around them.
