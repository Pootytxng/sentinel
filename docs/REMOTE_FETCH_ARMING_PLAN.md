# Compy — Remote-Fetch Arming Plan (signed remote rules)

**PLANNING ONLY.** This document defines the exact gated sequence required before signed
remote recommendation rules can ship. Writing this changes **no** behavior: remote fetch stays
disabled, no CDN URL is added to active config, no production key is generated in the repo, the
all-zero placeholder key is never treated as valid, and the embedded baseline remains the
source of truth. **Unsigned remote rules must never ship — including in beta.**

Grounded in `src-tauri/src/remote_rules.rs` as of 2026-05-31. Legend: ✅ built + tested ·
🔶 partial / stubbed · ⬜ not built yet.

## What already exists vs. what must be built

| Capability | State |
|---|---|
| Manifest schema (`RulesManifest`, `deny_unknown_fields`) | ✅ |
| Ed25519 signature verify (`verify_manifest_with_key`) | ✅ |
| SHA-256 rules binding, expiry, version-regression, app-range, size caps | ✅ (`verify_chain_with_key`) |
| `RulesSource` = Embedded / Cached / Remote | ✅ |
| Last-known-good cache + embedded fallback (`load_rules`) | ✅ |
| 11 signed-manifest unit tests (ephemeral keys) | ✅ |
| Remote fetch gate `remote_fetch_enabled()` | ✅ hard-`false` |
| Production public key | ⬜ placeholder all-zeros (`RULES_SIGNING_PUBKEY_BYTES`) |
| Actual HTTP fetch (`fetch_remote_rules`) | 🔶 stub returns `None`; no network crate, no manifest URL, no real timeout |
| SemVer-correct app-version compare | 🔶 lexicographic (`version_in_range`) — fine for `0.x` only |
| Trust Ledger records ruleset **source/version** | 🔶 `ruleset_version_at_apply` is the static string `"1.0.0-baseline"` |
| Rules-source pill shows all 3 states live | 🔶 only Embedded reachable today |
| Staged rollout (%), dev channel | ⬜ |
| Remote failure-path tests (network/CDN) | ⬜ (no fetch to test yet) |

---

## 1. Current locked state (do not change while planning)

- `remote_fetch_enabled()` returns **`false`** (hard-coded; `remote_rules.rs:96`). The real
  check would be `RULES_SIGNING_PUBKEY_BYTES != [0u8;32] && <ENABLE_REMOTE_FETCH cfg gate>` —
  both intentionally absent so private beta cannot accidentally ship with fetch on.
- `RULES_SIGNING_PUBKEY_BYTES` is **all-zeros** (`remote_rules.rs:84`); `verify_chain` rejects
  the all-zeros key, so even if fetch were forced on, verification fails closed.
- **No CDN/manifest URL is configured anywhere.** `fetch_remote_rules()` is a stub returning
  `None`.
- The **embedded baseline** (`load_baseline_rules_embedded`) is the source of truth; `load_rules`
  returns it whenever remote is off or every remote attempt fails.
- **Unsigned remote rules must not ship, including beta.** This is the line not to cross.

## 2. Required production assets (generated/managed OUTSIDE this repo)

- An **offline-generated Ed25519 keypair** (use `cargo run --example sign_manifest -- --gen-key`).
- **Private key stored outside the repo, CI, `.env*`, and any plaintext** (hardware token /
  secrets manager / offline media). It signs manifests on an air-gapped/offline step. It is
  **never** committed, never in CI secrets, never in the developer's home dir unencrypted.
- **Public key** embedded into the app by replacing `RULES_SIGNING_PUBKEY_BYTES`.
- A **CDN / R2 bucket** path hosting: the **signed manifest** and the **rules JSON**, served
  over HTTPS. (Add the manifest URL constant + the network fetch only at Stage 1+, never to the
  beta config.)
- The **SHA-256 digest of the rules JSON lives inside the signed manifest** (`rules_sha256`),
  so the rules file is bound to the signature transitively (signature covers the manifest;
  manifest pins the rules hash).

## 3. Manifest requirements (schema is ALREADY defined + enforced)

`RulesManifest` (`deny_unknown_fields`) requires every field below; all are parsed today and
the signed ones are verified:

- `schema_version` (u32)
- `ruleset_version` (u64, monotonic)
- `created_at` (RFC3339)
- `expires_at` (RFC3339)
- `min_app_version` / `max_app_version` (strings)
- `rules_sha256` (hex SHA-256 of the rules JSON)
- `rules_url` (HTTPS URL of the rules JSON)
- `signature` (hex Ed25519 over the canonical manifest bytes — the manifest JSON with
  `signature` removed, re-serialized canonically)

> **Before arming:** decide and document the canonicalization precisely (field ordering, whitespace)
> so the offline signer and the client agree byte-for-byte. The signer (`examples/sign_manifest.rs`)
> and `canonical_manifest_payload` must stay in lockstep.

## 4. Client validation gates (mostly built — verify against `verify_chain_with_key`)

For every fetched (manifest, rules) pair, in order:

1. ✅ **Size caps:** manifest ≤ `MANIFEST_MAX_BYTES` (4 KiB), rules ≤ `RULES_MAX_BYTES` (1 MiB).
   ⬜ When the real fetch lands, the cap MUST also be enforced on the HTTP response stream
   (bounded read), not just post-download, to prevent a hung/huge-response DoS.
2. ✅ **Ed25519 signature** verifies against the embedded production key (fails closed on the
   placeholder key).
3. ✅ **SHA-256** of the rules bytes equals `manifest.rules_sha256`.
4. ✅ **Reject expired** manifest (`expires_at` < now).
5. ✅ **Reject version regression** (`ruleset_version` < last-seen) — anti-rollback.
6. ✅ **Reject incompatible app version** (`current` outside `[min,max]`).
   🔶 Currently lexicographic; swap to the `semver` crate before versions reach `0.10+`/`1.x`.
7. ✅ **Reject unknown schema/manifest fields** (`deny_unknown_fields` on `RulesManifest`;
   unknown rule fields rejected by the rules deserializer).
8. ✅ **Reject unknown typed actions** — enforced at the **actions layer**, not here: a remote
   rule can only carry recommendation *data* keyed by `rec_id`. Apply dispatches `rec_id` →
   a fixed set of `apply_*` functions; an unrecognized `rec_id` yields "not yet supported".
   Remote rules **cannot introduce executable actions** (see §8).
9. ✅ **Fallback to last-known-good** cached rules if the remote pair fails any gate.
10. ✅ **Fallback to embedded baseline** if there is no valid cache. `load_rules` never panics.

## 5. Rollout stages

- **Stage 0 — embedded-only private beta (CURRENT).** Remote fetch off, placeholder key,
  embedded baseline only. The manual-mutation QA blocker is being worked here.
- **Stage 1 — internal remote fetch, TEST key/build only.** A `cfg`-gated dev build with a
  **test** key + test bucket. Implements the real HTTP fetch (`fetch_remote_rules`) with bounded
  reads + timeouts. Never shipped to users. Production `RULES_SIGNING_PUBKEY_BYTES` untouched.
- **Stage 2 — production key embedded, remote fetch STILL disabled.** Replace the placeholder
  pubkey with the real one; `remote_fetch_enabled()` still returns false. Ships safely; arms the
  verification side without fetching.
- **Stage 3 — remote fetch enabled for the DEV channel only.** Flip the gate behind a channel
  check so only opt-in dev users fetch. Watch failure-path telemetry-free logs locally.
- **Stage 4 — staged % rollout.** Enable for an increasing fraction (e.g., 1% → 10% → 50%).
  Requires a deterministic local bucketing mechanism (⬜ not built).
- **Stage 5 — stable rollout.** Enabled for all on stable.
- **Stage 6 — emergency rollback / freeze.** Publish a higher-`ruleset_version` manifest that
  points back to known-good rules, OR ship an app update that flips `remote_fetch_enabled()`
  off. Anti-rollback means clients won't *downgrade* ruleset version, so "rollback" = roll
  *forward* to a corrected ruleset. Document the exact freeze runbook before Stage 4.

## 6. Failure behavior (must degrade safely — most already covered)

| Failure | Behavior |
|---|---|
| CDN down / no network / timeout | fetch returns `None` → cached → embedded; UI shows Cached/Built-in |
| Invalid signature | ✅ rejected → cached → embedded |
| Hash mismatch | ✅ rejected → cached → embedded |
| Expired manifest | ✅ rejected → cached → embedded |
| Rollback attack (older version) | ✅ rejected (anti-rollback) |
| App-version mismatch | ✅ rejected → cached → embedded |
| Corrupt cached rules | falls through to embedded (⬜ confirm cache parse failure is caught, not panicking) |
| Malformed JSON (manifest or rules) | ✅ parse error → rejected/fallback |
| Oversized manifest/rules | ✅ size-cap rejected |

The invariant: **any** remote failure can only ever leave the user on **cached or embedded**
rules — never on unverified/partial data, never crashed.

## 7. Release gates — ALL required before enabling remote fetch (Stage 3+)

- [ ] **Manual-mutation QA blocker CLOSED** (apply/rollback verified for all safe appliable recs —
      see `docs/RELEASE_QA.md`). Remote rules change *which* recs appear; they must not ship
      before the apply/rollback engine is human-verified.
- [ ] Signed-manifest unit tests pass (the 11 in `manifest_tests`).
- [ ] **Remote failure-path tests** written + passing (⬜ — need the real fetch first: CDN down,
      timeout, truncated/oversized response, corrupt cache).
- [ ] **Production key handling reviewed** — confirmed offline-only, not in repo/CI/.env/plaintext;
      signing runbook documented; key rotation plan exists.
- [ ] **Privacy policy still accurate** — `docs/PRIVACY.md` must be updated to state that enabling
      fetch performs a download-only request (no upload of user/PC data) before it ships.
- [ ] **Rules-source pill** displays **Built-in / Cached / Remote** correctly for all three states
      (🔶 only Embedded is reachable today — verify Cached/Remote once Stage 1 exists).
- [ ] **Trust Ledger records ruleset source + version** (🔶 today it stores the static
      `"1.0.0-baseline"`; wire it to the actual loaded `RulesSource` + `ruleset_version` so an
      applied change is auditable to the exact rules that produced it).
- [ ] **Staged rollout plan approved** by the owner.

## 8. Explicit non-goals (hard limits, not deferrals)

- **No AI-generated rules.** Rules are human-authored, reviewed, and signed offline.
- **No arbitrary registry / service / PowerShell actions from rules.** Rules are recommendation
  *data*; execution is restricted to the fixed typed `AppliedAction`/`RollbackAction` allowlist
  in `actions.rs`. A rule cannot define a new mutation.
- **No unsigned rules**, ever, in any channel.
- **No remote code** — only signed JSON data is fetched, never executable content.
- **No telemetry requirement** — remote fetch is download-only; Compy still sends no usage
  data. Fetching rules must not become a tracking channel. *(Doctrine pointer 2026-06-12: per
  `docs/RECEIPTS_DOCTRINE.md` an opt-in Receipts telemetry phase is planned as its OWN gated
  channel — rules-fetch itself stays tracking-free regardless.)*
- **No remote fetch before the manual-mutation QA gates are closed.**
