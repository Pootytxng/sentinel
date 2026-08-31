//! Compy Pro — offline, account-less license verification (DARK foundation, model-agnostic).
//!
//! Built per the Receipts Doctrine ("Compy Pro, built dark, gaming_mode-gate pattern") +
//! `docs/MONETIZATION.md §5` (offline Ed25519 keys, "buildable solo… none of this mutates Windows →
//! no mutation-QA gate"). This module is the **verify** half only — the part that's safe + useful
//! regardless of the owner's still-open pricing/processor/free-vs-Pro decisions.
//!
//! HARD LINES held here (mirrors `remote_rules.rs`):
//! - **The private SIGNING key NEVER lives in this repo** — not in commits, `.env`, or CI. Only the
//!   PUBLIC key lives here, and it is currently an **all-zeros placeholder** → a known-invalid key, so
//!   EVERY license verifies as invalid and **Compy stays 100% free until the owner arms it** (drops the
//!   real public key in, keeping the private key offline).
//! - **Offline only** — verification is a local signature check against the embedded public key. **Zero
//!   outbound network, no account, no phone-home** — the privacy promise is preserved.
//! - **No Windows mutation** — verify is read-only; `set_license_key` writes only an app-local file in
//!   the Compy data dir (like `history.json`), never the registry/system. No mutation-QA gate needed.
//! - **Never paywall safety** — this module gates NOTHING yet; it only reports a tier. The free/Pro
//!   split (which features, if any, sit behind Pro) is OWNER TERRITORY and is deliberately NOT encoded
//!   here. The pricing, processor, and model are the owner's calls (`docs/MONETIZATION.md`).
//!
//! Shape: a **pure verify core** (`verify_license`) with unit tests proving the crypto against a test
//! keypair, plus a thin edge (local key read/write + two read-only IPC commands).

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Production Ed25519 public key (32 bytes). All-zeros placeholder = a known-invalid key, so the verify
/// path always fails and Compy is free for everyone until the owner generates a real keypair (private key
/// offline, NEVER in this repo), replaces this, and arms licensing. Mirrors
/// `remote_rules::RULES_SIGNING_PUBKEY_BYTES`.
const LICENSE_SIGNING_PUBKEY_BYTES: [u8; 32] = [0u8; 32];

/// A license token is a few hundred bytes; this caps the hex string we'll even look at (DoS guard).
const LICENSE_KEY_MAX_CHARS: usize = 8192;

/// Licensing is "armed" only when a real public key has replaced the placeholder. Until then no license
/// can be valid → free tier for everyone (the owner also keeps the private signing key offline). This is
/// the analogue of `remote_fetch_enabled()` — intentionally false so a build can't accidentally start
/// validating Pro licenses before the owner deliberately arms it.
pub(crate) fn licensing_armed() -> bool {
    LICENSE_SIGNING_PUBKEY_BYTES != [0u8; 32]
}

/// The signed payload inside a license key. **Model-agnostic by design:** `expires_at: None` is a
/// one-time / perpetual license; `Some(..)` is a subscription / time-limited one — verify treats both
/// the same way, so the owner's eventual one-time-vs-subscription choice needs no change here.
/// `#[allow(dead_code)]`: this is the published token SCHEMA (signed by the issuer); not every field is
/// consumed by the verify logic, but all are part of the contract — same stance as `RulesManifest`.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(deny_unknown_fields)]
#[allow(dead_code)]
struct LicensePayload {
    /// A one-way hash of the buyer's email — privacy: no raw PII in the token.
    email_hash: String,
    /// Tier name. "pro" today; room for future tiers without a schema change.
    tier: String,
    /// RFC3339 issue time (informational / audit).
    issued_at: String,
    /// RFC3339 expiry, or absent for a perpetual license.
    #[serde(default)]
    expires_at: Option<String>,
}

/// What the app/UI reads — a clean, never-panicking summary. An absent/invalid/expired key always
/// degrades to a tidy "free" status (we never lock the user out; Pro is additive).
#[derive(Serialize, Clone, Debug, PartialEq)]
pub(crate) struct LicenseStatus {
    pub(crate) tier: String, // "free" | "pro"
    pub(crate) valid: bool,
    /// Licensing is ARMED (a real signing key is embedded, replacing the placeholder). The frontend
    /// gates Pro on this flag DIRECTLY — do not make the UI infer it by string-matching `reason`
    /// (that couples the dark-vs-live gate to free-text copy: a reworded reason would silently arm
    /// Pro for everyone). `reason` stays human-facing only.
    pub(crate) armed: bool,
    pub(crate) reason: String, // plain-English: "no license", "active", "license expired …", …
    pub(crate) expires_at: Option<String>,
}

impl LicenseStatus {
    fn free(reason: &str) -> Self {
        LicenseStatus {
            tier: "free".into(),
            valid: false,
            armed: false, // stamped true by the armed entry points (get_license_status/set_license_key)
            reason: reason.into(),
            expires_at: None,
        }
    }
}

/// Pure: verify a license-key string against a public key + a "now" instant, returning the resulting
/// status. Token format: `<hex(payload_json)>.<hex(ed25519_sig)>`. The signature is checked over the
/// EXACT payload bytes **before** the payload is parsed or trusted at all. Any malformation, a bad
/// signature, the placeholder (all-zeros) key, or an expired token all degrade to a clean free status —
/// never a panic, never a lockout.
pub(crate) fn verify_license(key: &str, pubkey_bytes: &[u8; 32], now: DateTime<Utc>) -> LicenseStatus {
    use ed25519_compact::{PublicKey, Signature};

    let key = key.trim();
    if key.is_empty() {
        return LicenseStatus::free("no license");
    }
    if key.len() > LICENSE_KEY_MAX_CHARS {
        return LicenseStatus::free("license malformed");
    }
    // A valid (non-all-zeros) public key is required; the placeholder yields an Err here → free.
    let Ok(public_key) = PublicKey::from_slice(pubkey_bytes) else {
        return LicenseStatus::free("licensing not active");
    };
    if pubkey_bytes == &[0u8; 32] {
        return LicenseStatus::free("licensing not active");
    }
    let Some((payload_hex, sig_hex)) = key.split_once('.') else {
        return LicenseStatus::free("license malformed");
    };
    let (Some(payload_bytes), Some(sig_bytes)) = (hex_decode(payload_hex), hex_decode(sig_hex)) else {
        return LicenseStatus::free("license malformed");
    };
    let Ok(signature) = Signature::from_slice(&sig_bytes) else {
        return LicenseStatus::free("license malformed");
    };
    // Verify FIRST — never trust an unverified payload.
    if public_key.verify(&payload_bytes, &signature).is_err() {
        return LicenseStatus::free("license signature invalid");
    }
    let Ok(payload) = serde_json::from_slice::<LicensePayload>(&payload_bytes) else {
        return LicenseStatus::free("license malformed");
    };
    if let Some(exp) = &payload.expires_at {
        match DateTime::parse_from_rfc3339(exp) {
            Ok(t) if now > t.with_timezone(&Utc) => {
                return LicenseStatus::free(&format!("license expired {}", short_date(exp)));
            }
            Ok(_) => {} // still valid
            Err(_) => return LicenseStatus::free("license malformed"),
        }
    }
    LicenseStatus {
        tier: payload.tier,
        valid: true,
        armed: false, // stamped by get_license_status/set_license_key (this pure verify is armed-agnostic)
        reason: "active".into(),
        expires_at: payload.expires_at,
    }
}

/// "2026-06-14T…" → "2026-06-14" for a tidy reason line; falls back to the raw string.
fn short_date(rfc3339: &str) -> String {
    rfc3339.split('T').next().unwrap_or(rfc3339).to_string()
}

fn hex_decode(s: &str) -> Option<Vec<u8>> {
    let s = s.trim();
    if !s.len().is_multiple_of(2) {
        return None;
    }
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(s.len() / 2);
    let mut i = 0;
    while i < bytes.len() {
        let hi = hex_nybble(bytes[i])?;
        let lo = hex_nybble(bytes[i + 1])?;
        out.push((hi << 4) | lo);
        i += 2;
    }
    Some(out)
}

fn hex_nybble(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

// ─── Thin edge: local key storage + read-only IPC ──────────────────────────

/// The stored license key lives beside the Trust Ledger in the Compy data dir (Roaming `%APPDATA%`),
/// NOT beside the install binaries. App-local config, like `history.json` — never Windows system state.
fn license_key_path() -> std::path::PathBuf {
    crate::compy_data_dir().join("license.key")
}

fn read_stored_key() -> Option<String> {
    read_stored_key_from(&license_key_path())
}

/// The read half, lifted to a path so the storage contract can be proven against a synthetic fixture
/// instead of the owner's real key. Unreadable, empty and whitespace-only all mean "no license".
fn read_stored_key_from(path: &std::path::Path) -> Option<String> {
    std::fs::read_to_string(path)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// IPC (read-only): the current license status. Reads the locally-stored key (if any) and verifies it
/// against the PRODUCTION public key + the real clock. While the key is the all-zeros placeholder this
/// always returns free — Compy is free for everyone until the owner arms licensing.
#[tauri::command]
pub(crate) fn get_license_status() -> LicenseStatus {
    // While disarmed (placeholder key), Compy is free for everyone — short-circuit before touching disk.
    if !licensing_armed() {
        return LicenseStatus::free("licensing not active");
    }
    let mut status = match read_stored_key() {
        Some(key) => verify_license(&key, &LICENSE_SIGNING_PUBKEY_BYTES, Utc::now()),
        None => LicenseStatus::free("no license"),
    };
    status.armed = true; // reached only past the licensing_armed() gate above
    status
}

/// IPC: store a license key locally (app-data file) and return its verified status. Writing the file is
/// the only side effect — no system change, no network. A blank key clears the stored license.
#[tauri::command]
pub(crate) fn set_license_key(key: String) -> Result<LicenseStatus, String> {
    set_license_key_at(&license_key_path(), &key)
}

/// The body of [`set_license_key`], lifted to a path for the same reason as [`read_stored_key_from`].
///
/// A license key is a **signed plain-text token**, so it is stored as the exact trimmed bytes the user
/// gave us — never re-serialized, never wrapped in JSON: changing a byte invalidates the signature.
fn set_license_key_at(path: &std::path::Path, key: &str) -> Result<LicenseStatus, String> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        let _ = std::fs::remove_file(path); // clearing is fine whether or not it existed
        let mut cleared = LicenseStatus::free("no license");
        cleared.armed = licensing_armed();
        return Ok(cleared);
    }
    if trimmed.len() > LICENSE_KEY_MAX_CHARS {
        return Err("That doesn't look like a Compy license key.".into());
    }
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|_| "Couldn't save the license locally.".to_string())?;
    }
    // Whole-file replacement: a save interrupted partway leaves the PREVIOUS valid token, not a
    // truncated one that reads back as "license malformed" and silently drops a paying user to free.
    // The error stays generic and carries no part of the token — not the key, not even its length.
    crate::atomic_write::write_atomic(path, trimmed.as_bytes())
        .map_err(|_| "Couldn't save the license locally.".to_string())?;
    let mut status = verify_license(trimmed, &LICENSE_SIGNING_PUBKEY_BYTES, Utc::now());
    status.armed = licensing_armed();
    Ok(status)
}

// ─── Storage-edge tests ───────────────────────────────────────────────────────────────────────────
// Every token below is SYNTHETIC and signed by nothing. These prove how the key is STORED, never how
// it is validated, and no test here reads, writes or names the owner's real `license.key`.
#[cfg(test)]
mod license_storage_tests {
    use super::*;
    use crate::atomic_write::{force_next_failure, FailPoint};
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// A private directory per test — deliberately NOT `compy_data_dir()`.
    fn scratch(tag: &str) -> std::path::PathBuf {
        static N: AtomicUsize = AtomicUsize::new(0);
        let dir = std::env::temp_dir().join(format!(
            "compy-license-{tag}-{}-{}",
            std::process::id(),
            N.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// A token of the right SHAPE (`<hex>.<hex>`) and no authority whatsoever: the production public
    /// key is the all-zeros placeholder, so every one of these verifies as free.
    fn token(marker: &str) -> String {
        format!("{}.{}", "6b".repeat(24), marker.repeat(32))
    }

    #[test]
    fn the_exact_trimmed_bytes_round_trip_and_are_never_wrapped_in_json() {
        let path = scratch("roundtrip").join("license.key");
        let key = token("a1");

        let status = set_license_key_at(&path, &format!("  \n{key}\t ")).unwrap();
        assert!(!status.valid, "the placeholder key can never validate a license");

        let on_disk = std::fs::read(&path).unwrap();
        assert_eq!(on_disk, key.as_bytes(), "the stored bytes are the token verbatim");
        assert!(
            !on_disk.starts_with(b"\""),
            "a signed token re-serialized as JSON would no longer verify"
        );
        assert_eq!(read_stored_key_from(&path).as_deref(), Some(key.as_str()));
    }

    #[test]
    fn a_failed_save_leaves_the_previous_license_readable_and_spills_no_copy_of_the_new_one() {
        // Both named interruption points, because "the previous key survives" has to hold before the
        // temp has any bytes AND after it has all of them.
        for at in [FailPoint::AfterTempCreate, FailPoint::BeforeRename] {
            let dir = scratch("failed-save");
            let path = dir.join("license.key");
            let old = token("a1");
            let new = token("b2");
            set_license_key_at(&path, &old).unwrap();

            force_next_failure(at);
            let err = set_license_key_at(&path, &new).unwrap_err();

            assert_eq!(err, "Couldn't save the license locally.", "at {at:?}");
            assert_eq!(
                read_stored_key_from(&path).as_deref(),
                Some(old.as_str()),
                "the license that was already working must still be there, at {at:?}"
            );
            assert!(!err.contains(&new) && !err.contains(&old), "an error never carries a token");

            // A leftover temp would be the rejected token sitting in plaintext beside the real one.
            let left: Vec<_> = std::fs::read_dir(&dir)
                .unwrap()
                .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
                .collect();
            assert_eq!(left, vec!["license.key".to_string()], "at {at:?}");
        }
    }

    #[test]
    fn blank_input_still_clears_by_deleting_and_stays_harmless_when_nothing_is_stored() {
        let path = scratch("clear").join("license.key");
        set_license_key_at(&path, &token("a1")).unwrap();

        let cleared = set_license_key_at(&path, "   \n\t  ").unwrap();
        assert_eq!(cleared.reason, "no license");
        assert!(!path.exists(), "clearing DELETES; it never writes empty bytes over the key");
        assert_eq!(read_stored_key_from(&path), None);

        // Clearing again, with nothing there, is still a clean success.
        assert_eq!(set_license_key_at(&path, "").unwrap().reason, "no license");
    }

    #[test]
    fn an_oversize_key_is_refused_before_anything_is_written() {
        let path = scratch("oversize").join("license.key");
        let good = token("a1");
        set_license_key_at(&path, &good).unwrap();

        let huge = "a".repeat(LICENSE_KEY_MAX_CHARS + 1);
        let err = set_license_key_at(&path, &huge).unwrap_err();
        assert_eq!(err, "That doesn't look like a Compy license key.");
        assert_eq!(read_stored_key_from(&path).as_deref(), Some(good.as_str()));

        // …and with nothing stored it creates nothing — no empty file, no temp.
        let fresh_dir = scratch("oversize-fresh");
        let fresh = fresh_dir.join("license.key");
        assert!(set_license_key_at(&fresh, &huge).is_err());
        assert_eq!(std::fs::read_dir(&fresh_dir).unwrap().count(), 0);
    }

    #[test]
    fn a_save_into_an_unusable_location_says_only_that_it_failed() {
        let dir = scratch("blocked");
        let blocker = dir.join("not-a-dir");
        std::fs::write(&blocker, b"x").unwrap(); // a FILE where the parent directory would go
        let key = token("c3");

        let err = set_license_key_at(&blocker.join("license.key"), &key).unwrap_err();

        assert_eq!(err, "Couldn't save the license locally.");
        assert!(!err.contains(&key), "the user's key never appears in what they are shown");
    }
}

// ─── Pure-core tests (the crypto is proven against a test keypair; production key stays placeholder) ──
#[cfg(test)]
mod license_tests {
    use super::*;
    use ed25519_compact::KeyPair;

    fn hex_encode(bytes: &[u8]) -> String {
        let mut s = String::with_capacity(bytes.len() * 2);
        for b in bytes {
            s.push_str(&format!("{b:02x}"));
        }
        s
    }

    /// Build a signed license token string from a payload + a keypair (mirrors what a real issuance
    /// endpoint would do — but with a TEST key; the production private key never exists in this repo).
    fn sign_token(payload: &LicensePayload, kp: &KeyPair) -> String {
        let payload_bytes = serde_json::to_vec(payload).unwrap();
        let sig = kp.sk.sign(&payload_bytes, None);
        format!("{}.{}", hex_encode(&payload_bytes), hex_encode(&sig[..]))
    }

    fn payload(tier: &str, expires_at: Option<&str>) -> LicensePayload {
        LicensePayload {
            email_hash: "abc123".into(),
            tier: tier.into(),
            issued_at: "2026-06-14T00:00:00Z".into(),
            expires_at: expires_at.map(Into::into),
        }
    }

    fn now() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-06-14T12:00:00Z").unwrap().with_timezone(&Utc)
    }

    #[test]
    fn the_shipped_pubkey_is_the_all_zeros_placeholder_and_licensing_is_not_armed() {
        // The single most important invariant: a shipped build cannot validate any Pro license.
        assert_eq!(LICENSE_SIGNING_PUBKEY_BYTES, [0u8; 32]);
        assert!(!licensing_armed(), "licensing must stay disarmed until the owner replaces the key");
    }

    #[test]
    fn a_validly_signed_perpetual_license_verifies_as_pro() {
        let kp = KeyPair::generate();
        let token = sign_token(&payload("pro", None), &kp);
        let pk: [u8; 32] = kp.pk[..].try_into().unwrap();
        let s = verify_license(&token, &pk, now());
        assert!(s.valid && s.tier == "pro", "got {s:?}");
        assert_eq!(s.reason, "active");
        assert!(s.expires_at.is_none());
    }

    #[test]
    fn the_production_placeholder_key_rejects_even_a_validly_signed_token() {
        // A token signed by SOME key must NOT validate against the all-zeros production key → free.
        let kp = KeyPair::generate();
        let token = sign_token(&payload("pro", None), &kp);
        let s = verify_license(&token, &LICENSE_SIGNING_PUBKEY_BYTES, now());
        assert!(!s.valid && s.tier == "free", "placeholder key must reject everything: {s:?}");
        assert_eq!(s.reason, "licensing not active");
    }

    #[test]
    fn a_tampered_payload_fails_the_signature_check() {
        let kp = KeyPair::generate();
        let token = sign_token(&payload("pro", None), &kp);
        let pk: [u8; 32] = kp.pk[..].try_into().unwrap();
        // Flip the tier to "enterprise" in the payload hex without re-signing → signature must fail.
        let tampered = sign_token(&payload("pro", None), &kp);
        let (orig_payload_hex, sig_hex) = tampered.split_once('.').unwrap();
        let evil = serde_json::to_vec(&payload("enterprise", None)).unwrap();
        let forged = format!("{}.{}", hex_encode(&evil), sig_hex);
        assert_ne!(orig_payload_hex, hex_encode(&evil));
        let s = verify_license(&forged, &pk, now());
        assert!(!s.valid, "a re-written payload must not verify");
        assert_eq!(s.reason, "license signature invalid");
        // sanity: the untampered token still verifies under the same key
        assert!(verify_license(&token, &pk, now()).valid);
    }

    #[test]
    fn an_expired_subscription_token_is_free_a_future_one_is_pro() {
        let kp = KeyPair::generate();
        let pk: [u8; 32] = kp.pk[..].try_into().unwrap();
        let expired = sign_token(&payload("pro", Some("2026-06-01T00:00:00Z")), &kp);
        let s = verify_license(&expired, &pk, now());
        assert!(!s.valid && s.reason.contains("expired") && s.reason.contains("2026-06-01"), "{s:?}");
        let future = sign_token(&payload("pro", Some("2027-01-01T00:00:00Z")), &kp);
        let s2 = verify_license(&future, &pk, now());
        assert!(s2.valid && s2.tier == "pro" && s2.expires_at.as_deref() == Some("2027-01-01T00:00:00Z"));
    }

    #[test]
    fn malformed_keys_degrade_to_free_never_panic() {
        let pk = [7u8; 32]; // a syntactically-valid (non-zero) key
        for bad in ["", "   ", "not-a-token", "nodothere", "zz.zz", "abcd.", ".abcd", "ab.cd"] {
            let s = verify_license(bad, &pk, now());
            assert!(!s.valid && s.tier == "free", "bad key {bad:?} should be free, got {s:?}");
        }
    }

    #[test]
    fn status_serializes_to_the_expected_ts_shape() {
        let v = serde_json::to_value(LicenseStatus::free("no license")).unwrap();
        for k in ["tier", "valid", "armed", "reason", "expires_at"] {
            assert!(v.get(k).is_some(), "missing key {k}");
        }
        assert_eq!(v["tier"], "free");
        assert_eq!(v["valid"], false);
        assert_eq!(v["armed"], false);
    }

    #[test]
    fn get_license_status_reports_disarmed_while_placeholder_key_ships() {
        // The gate the frontend now reads DIRECTLY (proStateFrom → status.armed), instead of
        // string-matching `reason`. While the shipped key is the all-zeros placeholder, armed=false
        // so every Pro feature renders free — the dark default. This guards that copy tweaks to
        // `reason` can never silently flip the gate.
        let s = get_license_status();
        assert!(!s.armed, "must be disarmed while the placeholder key ships: {s:?}");
        assert_eq!(s.reason, "licensing not active");
    }

    #[test]
    fn hex_decode_is_robust() {
        assert_eq!(hex_decode("00ff10"), Some(vec![0, 255, 16]));
        assert_eq!(hex_decode("0"), None, "odd length");
        assert_eq!(hex_decode("zz"), None, "non-hex");
        assert_eq!(hex_decode(""), Some(vec![]));
    }

    #[test]
    fn a_token_minted_by_the_node_owner_tool_verifies_cross_tool() {
        // Fixture from `scripts/license-tool.mjs` (keygen + mint) — pins that the Node owner-side minting
        // tool produces tokens THIS Rust verify accepts (format compatibility can't silently drift). The
        // throwaway private key was discarded; only the PUBLIC key + the signed perpetual token live here,
        // and both are safe to commit (verify-only artifacts).
        let pubkey_hex = "ea98a081bf9309c31405cc5ee4803904a81a4db62e5675a729a61d1eb1f239c3";
        let token = "7b22656d61696c5f68617368223a2262343530383131323362316262303463623133383131386264383266353035646233326434383933306238386432613663376464663738366533396238666136222c2274696572223a2270726f222c226973737565645f6174223a22323032362d30362d31345431383a32323a32372e3938395a227d.1b2d0daaee179d1b26e5a6281a4d6adfc15be0e98359a0340cd1f7d0d4cf88472503514833341bd96d77aa466e521df9b8d106109baf3e81695a0467067dba0e";
        let pk: [u8; 32] = hex_decode(pubkey_hex).unwrap().try_into().unwrap();
        let s = verify_license(token, &pk, now());
        assert!(s.valid && s.tier == "pro", "node-minted token must verify cross-tool: {s:?}");
        // And it must NOT verify against a different (placeholder) key — the signature binds the key.
        assert!(!verify_license(token, &LICENSE_SIGNING_PUBKEY_BYTES, now()).valid);
    }
}
