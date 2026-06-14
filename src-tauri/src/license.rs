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
    pub(crate) reason: String, // plain-English: "no license", "active", "license expired …", …
    pub(crate) expires_at: Option<String>,
}

impl LicenseStatus {
    fn free(reason: &str) -> Self {
        LicenseStatus {
            tier: "free".into(),
            valid: false,
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
    std::fs::read_to_string(license_key_path())
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
    match read_stored_key() {
        Some(key) => verify_license(&key, &LICENSE_SIGNING_PUBKEY_BYTES, Utc::now()),
        None => LicenseStatus::free("no license"),
    }
}

/// IPC: store a license key locally (app-data file) and return its verified status. Writing the file is
/// the only side effect — no system change, no network. A blank key clears the stored license.
#[tauri::command]
pub(crate) fn set_license_key(key: String) -> Result<LicenseStatus, String> {
    let trimmed = key.trim();
    let path = license_key_path();
    if trimmed.is_empty() {
        let _ = std::fs::remove_file(&path); // clearing is fine whether or not it existed
        return Ok(LicenseStatus::free("no license"));
    }
    if trimmed.len() > LICENSE_KEY_MAX_CHARS {
        return Err("That doesn't look like a Compy license key.".into());
    }
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|_| "Couldn't save the license locally.".to_string())?;
    }
    std::fs::write(&path, trimmed).map_err(|_| "Couldn't save the license locally.".to_string())?;
    Ok(verify_license(trimmed, &LICENSE_SIGNING_PUBKEY_BYTES, Utc::now()))
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
        for k in ["tier", "valid", "reason", "expires_at"] {
            assert!(v.get(k).is_some(), "missing key {k}");
        }
        assert_eq!(v["tier"], "free");
        assert_eq!(v["valid"], false);
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
