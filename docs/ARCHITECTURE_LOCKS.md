# Architecture Locks

> Compy is not an optimizer that happens to have rollback. Compy is a rollback-first Windows configuration safety layer that happens to optimize.

This document captures decisions that are hard to change once users are in the wild, plus the operating policies that govern how new features get added. Future contributors (including future Claude sessions) must respect these. Breaking them silently is a "users-can't-update-or-rollback" class incident — or worse, a "remote control plane shipped without signed verification" class incident.

The doc has three sections:

1. **Operating Policies** — how Compy behaves and what it is allowed to do. Apply to all current and future work.
2. **Immutability Tiers** — concrete data and identifier decisions, ranked by how locked-in they become.
3. **Baseline Exclusions** — tweaks deliberately not in baseline v1, with the conditions under which they could appear later as advanced/diagnostic features.

---

## 1. Operating Policies

These are policies, not data formats. They govern judgment calls across the codebase.

### 1.1 Remote rules are privileged policy, not data

Any rule served from a CDN is treated as **privileged Windows policy metadata**, with the same care as code-signing-protected app updates. The fact that the JSON cannot contain Rust code is necessary but not sufficient — the JSON can still select elevated actions on a user's machine.

Implications, all of which must be true before any remote fetch ships:

- **No generic mutation dispatchers.** No `apply_kind: "registry-set"`, no `apply_kind: "service-set"`, no `apply_kind: "powershell-run"`. Apply behavior is dispatched through typed Rust enums (see §2.4) with allowlisted variants and parameters.
- **All apply / rollback variants are auditable in source.** A maintainer can read the Rust source and enumerate every possible privileged operation Compy can perform. Remote JSON only *selects* among them.
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

Compy must be useful on first launch with no network access, indefinitely.

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

**Status (2026-05-30): the verification machinery is BUILT and tested, not stubbed.** Real Ed25519 verification is wired via `ed25519-compact` (`verify_manifest_with_key` / `verify_chain_with_key` in `lib.rs`), covering every gate above: signature, SHA-256 binding, monotonic `ruleset_version`, `expires_at`, app-version range, size caps. 11 unit tests (`manifest_tests`) prove valid bundles verify and that tampering, wrong-key, malformed-signature, rollback, freeze, and out-of-range app version are all rejected. The offline signer (`src-tauri/examples/sign_manifest.rs`) produces app-verifiable manifests. **Remote fetch remains disabled** — three independent things still gate it: (1) `RULES_SIGNING_PUBKEY_BYTES` is still the all-zeros placeholder, (2) `remote_fetch_enabled()` hard-returns `false`, (3) no CDN URL is configured. Arming remote fetch = generate a production keypair offline, embed its public key, configure the URL, and flip the flag — a deliberate, reviewable change, not an accident.

### 1.5 Rollback is independent of the live catalog

A user must always be able to roll back any applied change, even if:

- The CDN is down
- The rule has been removed from the catalog
- The rule has been renamed or its conditions changed
- The user has downgraded the app to an older version
- Compy itself has changed how the rule dispatches internally

This is achieved by storing the complete rollback contract inside `AppliedChange` at apply time (see §2.1). Rollback never consults the live `Vec<Recommendation>`; it consults local history.

### 1.6 UI strings from remote rules are sanitized

Rule text rendered in the UI is treated as untrusted. No HTML, no Markdown injection, no `dangerouslySetInnerHTML`. Plain text only, with character escaping at the React render boundary.

### 1.7 No fake performance claims

Compy does not promise FPS gains, latency reductions, or other measured improvements unless and until they are produced by actual measurements on the user's machine. The three labels are kept strictly separate in the UI:

- **Verified** — a configuration value was deterministically changed (e.g. Fast Startup now off; checked via registry).
- **Measured signal** — a probe was run (memory latency, network jitter, storage random-read latency). This is a signal, not proof of gaming improvement.
- **Expected impact** — theoretical impact described in the rule's text. Never displayed as a measured number.

Synthetic microbenchmarks may be exposed as health signals. They may not be presented as "this tweak improved your FPS by X%." Real before/after gaming proof requires PresentMon/ETW frame-pacing capture.

**Scope update (2026-06-03, owner-approved).** PresentMon/ETW frame-time capture is **promoted from "out of v1" to the core efficacy "Measure"** — real per-tweak before/after frame-pacing deltas (frame times, 1%/0.1% lows) are the ultimate proof the measured-efficacy direction is built on. This reuses the **already-shipping, read-only, anti-cheat-safe** elevated `fps.rs --fps-capture` ETW helper (no new capability, no mutation, no injection — the same mechanism the Monitoring tab already uses). **The honesty invariant above is unchanged and reinforced:** a measured delta must still clear the run-to-run **noise floor** (default 3%) or be reported as an explicit **"no measurable change"**; synthetic runners stay labeled health signals ("is-my-hardware-to-spec"), kept distinct from PresentMon's "did-this-help-my-game" proof. Building the PresentMon→`compute_efficacy` seam stays gated behind the dark `benchmark_enabled()` until it ships and is QA'd.

---

## 2. Immutability Tiers

### Tier 1 — Immutable forever (changing breaks already-installed users)

#### Rec IDs

Every `Recommendation.id` shipped in a release is a permanent contract. No renames, ever. Retired recs keep their id; remove the rule but keep dispatch handlers for any historical apply.

#### `AppliedChange` schema (the full rollback contract)

Persisted in `%APPDATA%\Compy\history.json`. Fields can be added (with `#[serde(default)]`) but never renamed or removed. The minimum fields required for rollback independence (per §1.5):

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

Currently `gg.compy.app` (set at the 2026-06-04 Sentinel→Compy rename; matches `src-tauri/tauri.conf.json`). Immutable once shipped to users — changing it breaks already-installed users' rollback/data paths.

#### AppData directory `%APPDATA%\Compy`

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

If any of the above is later added to Compy, it must be:

- Advanced mode only (separate UI surface, opt-in)
- Problem-specific (gated on a detected issue, not "more performance")
- User-initiated (never recommended as default; user opens advanced mode and explicitly selects)
- Behind strong warnings that name the specific risk
- Fully rollback-capable, with a snapshot that can survive driver / Windows updates
- Documented with reproducible measurement methodology, not theoretical impact

---

## 4. Pre-launch Checklist

Tracked here so the right decisions are made at the right time, not skipped:

- [ ] Trademark check on the public name (the Sentinel→Compy rename was executed 2026-06-04 — name committed at app level; CompyOne is an established holder in adjacent space, so clearance is still open)
- [ ] Final bundle identifier confirmed
- [ ] Final public product name confirmed
- [ ] EV code-signing certificate purchased and integrated into the build pipeline
- [ ] Tauri 2 built-in updater configured (`tauri.conf.json` `updater` section + Ed25519 signing key)
- [ ] LICENSE replaced from the placeholder with the final commercial license
- [ ] Privacy policy + EULA + clear disclaimers about reboot-required tweaks
- [ ] Signed remote rules manifest pipeline live (see §1.4) — verification code already landed; production key + URL gated by this checklist
- [ ] Last-known-good rules cache verified across cold-start scenarios
- [x] Trust Ledger UI surface implemented (per §1.5)

---

## 5. Rules Signing — Key Management

The rules-manifest signing key is treated like an updater signing key — it is the trust root for every privileged Windows change Compy performs in the field. Mishandling it equals mishandling root on every installed machine.

### Hard rules

- **The Ed25519 private key NEVER lives in this repository.** Not in commits, not in `.env*`, not in CI secrets, not in the developer's home directory unencrypted.
- **The current embedded public key (`RULES_SIGNING_PUBKEY_BYTES` in lib.rs) is the 32-zero-byte placeholder.** While that placeholder is in the binary, `remote_fetch_enabled()` hard-returns `false`. Replacing the placeholder with a real key and the URL is the single action that arms remote fetch.
- **Rotation is via app update only.** New public key → new app version that embeds it. The CDN cannot rotate the signing key — that would defeat the trust root.
- **Manifest signature is over a canonical form of the manifest with the `signature` field removed.** The signer and the verifier must agree on the canonicalization. We currently use `serde_json::to_vec(&value)` after removing the `signature` field; if we ever upgrade to RFC 8785, both sides update together with a schema version bump.

### Storage of the production private key

When the time comes (pre-launch), the production private key SHOULD live:

1. **In a hardware security module** (YubiKey, AWS KMS asymmetric key, or equivalent), with signing requiring physical or operator action. **Preferred**.
2. **On an offline / air-gapped machine** used only for signing the manifest at release time. **Acceptable** if HSM is impractical for the initial launch.

The production private key MUST NOT live on:

- Any developer workstation
- Any cloud CI environment with broad access
- Any environment that has internet access during signing

### Per-release signing flow

Use the offline signer `src-tauri/examples/sign_manifest.rs` on the HSM/air-gapped machine — it automates steps 1–4 and self-verifies its own output before writing:

```
# one-time, offline: generate the production keypair
cargo run --example sign_manifest -- --gen-key
#   → store the SEED on the HSM/offline machine; embed the PUBLIC KEY in
#     RULES_SIGNING_PUBKEY_BYTES (it prints a ready-to-paste array).

# each release, offline:
cargo run --example sign_manifest -- \
    --seed seed.hex --rules rules-v1.json \
    --rules-url https://cdn.example.com/rules/v1.json \
    --ruleset-version <strictly greater than last> \
    --expires-days <30..180> --min-app 0.1.0 --max-app 99.0.0 \
    --out rules-v1.manifest.json
```

The tool computes the rules SHA-256, builds the manifest, signs the canonical form (manifest with `signature` absent — identical to `canonical_manifest_payload` in lib.rs), embeds the hex signature, and aborts unless its output re-verifies against the public key. Then: upload `rules-v1.manifest.json` and `rules-v1.json` to the CDN.

The private seed is passed by path and is never stored in the repo. `--gen-key`'s seed output must go straight to the HSM/offline store.

### Compromise / suspected compromise of the private key

- IMMEDIATELY publish an app update that embeds a new public key.
- Continue serving the old `rules-v1.json` from the CDN unchanged — old clients keep working off their last-known-good cache.
- Old clients without an upgrade have no remote-fetch path until they update; this is the intended safety property.

### What `RULES_SIGNING_PUBKEY_BYTES = [0u8; 32]` guarantees

- `verify_chain` checks `RULES_SIGNING_PUBKEY_BYTES == [0u8; 32]` explicitly and returns `ManifestError::BadKey` before any cryptographic verification — defense in depth. (The real verify lives in `verify_chain_with_key` / `verify_manifest_with_key`, which the production path only reaches with the embedded key after that guard.)
- `remote_fetch_enabled()` hard-codes `false` independently of the placeholder, so the embedded baseline is the only rule source even if the verification logic itself is buggy.
- Both guards must be removed simultaneously to enable remote fetch. There is no path where one is on and the other is off in shipped code.
