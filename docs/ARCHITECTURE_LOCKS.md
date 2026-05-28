# Architecture Locks

> Sentinel is not an optimizer that happens to have rollback. Sentinel is a rollback-first Windows configuration safety layer that happens to optimize.

This document captures decisions that are hard to change once users are in the wild, plus the operating policies that govern how new features get added. Future contributors (including future Claude sessions) must respect these. Breaking them silently is a "users-can't-update-or-rollback" class incident — or worse, a "remote control plane shipped without signed verification" class incident.

The doc has three sections:

1. **Operating Policies** — how Sentinel behaves and what it is allowed to do. Apply to all current and future work.
2. **Immutability Tiers** — concrete data and identifier decisions, ranked by how locked-in they become.
3. **Baseline Exclusions** — tweaks deliberately not in baseline v1, with the conditions under which they could appear later as advanced/diagnostic features.

---

## 1. Operating Policies

These are policies, not data formats. They govern judgment calls across the codebase.

### 1.1 Remote rules are privileged policy, not data

Any rule served from a CDN is treated as **privileged Windows policy metadata**, with the same care as code-signing-protected app updates. The fact that the JSON cannot contain Rust code is necessary but not sufficient — the JSON can still select elevated actions on a user's machine.

Implications, all of which must be true before any remote fetch ships:

- **No generic mutation dispatchers.** No `apply_kind: "registry-set"`, no `apply_kind: "service-set"`, no `apply_kind: "powershell-run"`. Apply behavior is dispatched through typed Rust enums (see §2.4) with allowlisted variants and parameters.
- **All apply / rollback variants are auditable in source.** A maintainer can read the Rust source and enumerate every possible privileged operation Sentinel can perform. Remote JSON only *selects* among them.
- **Unknown enum variants, unknown fields, unknown services, and unknown parameter values are rejected.** Loud parse failure, no silent skip-and-continue.
- **The action allowlist is updated only through app releases**, never through remote rules.

### 1.2 AI explains, never mutates

If and when an LLM is integrated, the allowed surface is strictly:

- Explaining what a recommendation does in plain English
- Summarizing detected hardware
- Classifying logs or applied-change history
- Suggesting advisories for **human review** before any apply path runs

The disallowed surface, with no exceptions:

- Deciding what to apply
- Inventing new tweak actions
- Choosing registry paths, services, or parameters
- Writing or altering apply or rollback logic
- Modifying the typed action allowlist

**The AI narrates the chainsaw. It does not hold it.**

### 1.3 Cold-start behavior

Sentinel must be useful on first launch with no network access, indefinitely.

- The embedded baseline is the starting catalog. Always.
- Remote validation runs in the background after the UI is interactive.
- The catalog is replaced only if the remote bundle passes every gate in §1.4.
- If the fetch fails, expires, or fails verification, the embedded or last-known-good cached catalog stays active.
- The user sees a small, non-alarming status indicator ("Using built-in recommendations. Online rule updates unavailable.") — no modal, no panic, no upsell.

### 1.4 Remote fetch is gated behind signed manifest validation

No remote fetch ships, **including in private or closed beta**, until all of the following are in place:

- Ed25519 public key embedded in the binary
- Signed manifest format with `schema_version`, `ruleset_version`, `created_at`, `expires_at`, `min_app_version`, `max_app_version`, `rules_sha256`, `rules_url`
- Manifest signature verification before any rules JSON is downloaded
- Rules JSON SHA-256 verified against the signed manifest
- Monotonic `ruleset_version` enforcement (rollback-attack protection — never accept an older ruleset than last-known-good)
- `expires_at` enforcement (freeze-attack protection)
- `min_app_version` / `max_app_version` enforcement
- Last-known-good cache
- Oversized-file rejection (cap on JSON size)
- Network timeouts
- Logging of which source is active (embedded / cached / remote) so support can answer "where did this rule come from?"

Private beta with the embedded baseline only is fine and recommended for feedback velocity. Private beta with unsigned remote fetch is not. The remote control plane does not get smuggled in under "we'll add signing later."

### 1.5 Rollback is independent of the live catalog

A user must always be able to roll back any applied change, even if:

- The CDN is down
- The rule has been removed from the catalog
- The rule has been renamed or its conditions changed
- The user has downgraded the app to an older version
- Sentinel itself has changed how the rule dispatches internally

This is achieved by storing the complete rollback contract inside `AppliedChange` at apply time (see §2.1). Rollback never consults the live `Vec<Recommendation>`; it consults local history.

### 1.6 UI strings from remote rules are sanitized

Rule text rendered in the UI is treated as untrusted. No HTML, no Markdown injection, no `dangerouslySetInnerHTML`. Plain text only, with character escaping at the React render boundary.

### 1.7 No fake performance claims

Sentinel does not promise FPS gains, latency reductions, or other measured improvements unless and until they are produced by actual measurements on the user's machine. The three labels are kept strictly separate in the UI:

- **Verified** — a configuration value was deterministically changed (e.g. Fast Startup now off; checked via registry).
- **Measured signal** — a probe was run (memory latency, network jitter, storage random-read latency). This is a signal, not proof of gaming improvement.
- **Expected impact** — theoretical impact described in the rule's text. Never displayed as a measured number.

Synthetic microbenchmarks may be exposed as health signals. They may not be presented as "this tweak improved your FPS by X%." Real before/after gaming proof requires PresentMon/ETW frame-pacing capture and stays out of v1.

---

## 2. Immutability Tiers

### Tier 1 — Immutable forever (changing breaks already-installed users)

#### Rec IDs

Every `Recommendation.id` shipped in a release is a permanent contract. No renames, ever. Retired recs keep their id; remove the rule but keep dispatch handlers for any historical apply.

#### `AppliedChange` schema (the full rollback contract)

Persisted in `%APPDATA%\Sentinel\history.json`. Fields can be added (with `#[serde(default)]`) but never renamed or removed. The minimum fields required for rollback independence (per §1.5):

```rust
struct AppliedChange {
    id: String,                  // unique per applied change
    rec_id: String,              // the recommendation's stable id
    rec_title_at_apply: String,  // human-readable label snapshot
    applied_at: String,          // ISO 8601
    status: String,              // "applied" | "rolled_back"

    // Rollback independence: store the contract at apply time
    applied_action: AppliedAction,
    rollback_action: RollbackAction,
    snapshot: Snapshot,

    // Provenance
    app_version_at_apply: String,
    ruleset_version_at_apply: String,  // matches the signed manifest version, or "embedded-baseline"
    elevation_used: bool,
}
```

Once shipped, this struct's fields are additive-only forever. The `AppliedAction`, `RollbackAction`, and `Snapshot` enums are also additive — new variants only, never rename or remove.

#### Snapshot variants

Each snapshot variant stores the **prior machine state** for one shape of mutation. Examples:

```rust
enum Snapshot {
    Service { name: KnownService, prior_state: ServiceState, prior_start_type: ServiceStartType },
    RegistryDword { target: KnownDwordTarget, prior: Option<u32> },
    RegistryBinary { target: KnownBinaryTarget, prior: Option<Vec<u8>> },
    PowerPlan { prior_guid: String },
    NagleNicSet { entries: Vec<NagleNicSnapshot> },
    None,
}
```

Adding a new variant is fine. Renaming or removing existing ones permanently breaks rollback of older history entries.

#### Bundle identifier

Currently `com.sentinel.app`. Confirmable pre-launch; immutable once shipped to users. See pre-launch checklist.

#### AppData directory `%APPDATA%\Sentinel`

History persistence lives here. Renaming requires migration code.

---

### Tier 2 — Schema-versioned (changing requires a new schema version)

#### Remote rules JSON schema

Versioned URLs: `rules-v1.json`, `rules-v2.json`. Embedded constant `RULES_SCHEMA_VERSION` selects which URL the client fetches. Inside each file: `schema_version` field as a belt-and-suspenders mismatch check.

Migration path: ship a v2 schema → v1 stays alive at its URL for older clients → newer clients use v2 → eventually older app versions reach EOL.

#### Typed action allowlist (`AppliedAction`, `RollbackAction`)

The two enums separate **what was done** from **how to undo it using the stored snapshot**. They are independent contracts — a future refactor of apply behavior cannot reach back and break rollback of historical entries.

```rust
// What was done at apply time
enum AppliedAction {
    DisableKnownService { service: KnownService },
    EnableHardwareGpuScheduling,
    SetUltimatePerformancePlan,
    DisableNagleOnActiveNics,
    SetGameModeEnabled,
    SetVisualEffectsBestPerformance,
    DisableMouseAcceleration,
    DisableGameBarAndDvr,
    DisableFastStartup,
    DisableReservedStorage,
    // Additive only. New variants require an app release.
}

// How to undo it, given the stored Snapshot
enum RollbackAction {
    RestoreServiceFromSnapshot { service: KnownService },
    RestoreHwSchModeFromSnapshot,
    RestorePowerPlanFromSnapshot,
    RestoreNagleNicsFromSnapshot,
    RestoreGameModeFromSnapshot,
    RestoreVisualEffectsFromSnapshot,
    RestoreMouseAccelFromSnapshot,
    RestoreGameBarFromSnapshot,
    RestoreFastStartupFromSnapshot,
    RestoreReservedStorageFromSnapshot,
}

// Allowlisted identifiers — no free-form strings
enum KnownService {
    SysMain,
    DiagTrack,
    WSearch,
    NvTelemetryContainer,
    // Additive only.
}
```

Strict serde rules apply: `deny_unknown_fields` on every struct, exhaustive enum tag matching, no `#[serde(other)]` catch-alls on enums that drive privileged behavior. Unknown variants → loud parse failure.

#### Rec category strings

`Windows | Power | GPU | Display | Storage | Network`. Adding new categories is additive. Renames are coordinated across Rust + TS + CSS plus a schema version bump.

---

### Tier 3 — Worth being careful about, but recoverable

- History file format additions (use `#[serde(default)]`)
- The `runas` crate dependency (swappable for a custom helper)
- WMI / DXGI / SMBIOS detection sources (already use fallbacks)

---

## 3. Baseline Exclusions

These tweaks are **explicitly excluded from baseline safe recommendations** in v1. They may only appear later as **advanced, diagnostic, user-initiated, problem-specific advisories** — with strong warnings, no default apply, and full rollback where possible. They are not forever-banned from every possible diagnostic path; they are barred from the safe baseline.

### Excluded from baseline

- HPET enable / disable toggles
- BCDEdit timer-resolution and `useplatformtick` tweaks
- Global MMCSS / SystemResponsiveness registry edits
- Disabling Windows Defender, real-time protection, or scheduled scans
- Disabling Windows Update or its scheduled tasks
- Disabling Spectre / Meltdown / hardware-mitigation patches
- Forced core parking / `bcdedit` numproc overrides
- Generic NIC offload disable packs (LSO, RSS, RSC, etc.)
- Generic interrupt-moderation changes
- Global fullscreen-optimizations disable (Microsoft has reversed their own guidance multiple times; not safe to ship as default)
- Fixed-size pagefile "optimization" (causes crashes when undersized)
- "Registry TCP mega-pack" style bulk network parameter writes
- Universal MPO (Multi-Plane Overlay) disable

### Conditions for any future inclusion

If any of the above is later added to Sentinel, it must be:

- Advanced mode only (separate UI surface, opt-in)
- Problem-specific (gated on a detected issue, not "more performance")
- User-initiated (never recommended as default; user opens advanced mode and explicitly selects)
- Behind strong warnings that name the specific risk
- Fully rollback-capable, with a snapshot that can survive driver / Windows updates
- Documented with reproducible measurement methodology, not theoretical impact

---

## 4. Pre-launch Checklist

Tracked here so the right decisions are made at the right time, not skipped:

- [ ] Trademark check on the public name (currently "Sentinel" is a code name; SentinelOne is an established holder in adjacent space)
- [ ] Final bundle identifier confirmed
- [ ] Final public product name confirmed
- [ ] EV code-signing certificate purchased and integrated into the build pipeline
- [ ] Tauri 2 built-in updater configured (`tauri.conf.json` `updater` section + Ed25519 signing key)
- [ ] LICENSE replaced from the placeholder with the final commercial license
- [ ] Privacy policy + EULA + clear disclaimers about reboot-required tweaks
- [ ] Signed remote rules manifest pipeline live (see §1.4)
- [ ] Last-known-good rules cache verified across cold-start scenarios
- [ ] Trust Ledger UI surface implemented (per §1.5)
