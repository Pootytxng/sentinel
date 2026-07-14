//! Signed remote-rules track: Ed25519 manifest verification, the integrity
//! chain, the last-known-good cache, and the single `load_rules()` entry point
//! (remote -> cached -> embedded). This is the ONLY module allowed to introduce
//! rules from outside the binary. Remote fetch stays disabled until a
//! production key + URL are wired; see ARCHITECTURE_LOCKS §1.4 / §5.

use std::cmp::Ordering;
use std::fs;
use std::path::PathBuf;

use chrono::Utc;
use serde::{Deserialize, Serialize};

use crate::recommendations::{load_baseline_rules_embedded, RulesFile};
use crate::compy_data_dir;

// Small inline hex codec to avoid pulling the hex crate (which has a known
// compat issue with the current core::error::Error trait bound on stable).
fn hex_decode(s: &str) -> Option<Vec<u8>> {
    if !s.len().is_multiple_of(2) {
        return None;
    }
    let mut out = Vec::with_capacity(s.len() / 2);
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let high = hex_nybble(bytes[i])?;
        let low = hex_nybble(bytes[i + 1])?;
        out.push((high << 4) | low);
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

#[allow(dead_code)]
fn hex_encode(bytes: &[u8]) -> String {
    const TABLE: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        out.push(TABLE[(b >> 4) as usize] as char);
        out.push(TABLE[(b & 0x0f) as usize] as char);
    }
    out
}

// ─── Signed manifest verification (ARCHITECTURE_LOCKS §1.4) ──────────────
//
// Remote rules are PRIVILEGED POLICY. SHA-256 alone is not enough — a CDN
// compromise can replace both the rules JSON and its checksum simultaneously.
// The integrity chain is:
//
//   embedded public key (this binary)  →  verifies signature on  →
//   manifest (small, signed)           →  whose rules_sha256 must equal
//   SHA-256(rules JSON)                →  parsed into RulesFile
//
// Hard rules (see ARCHITECTURE_LOCKS §1.4):
//   - Manifest signature MUST verify against the embedded public key
//   - ruleset_version MUST be monotonic (no rollback attacks: serving an
//     older valid ruleset is rejected)
//   - expires_at MUST be in the future (no freeze attacks: serving a stale
//     valid ruleset past its expiry is rejected)
//   - min_app_version / max_app_version MUST bracket the current app version
//   - Rules file size MUST be under a cap (reject oversized DOS)
//   - Network timeouts MUST be enforced (no hung-fetch DOS)
//
// Until `RULES_SIGNING_PUBKEY_BYTES` is replaced with a real production
// public key, `remote_fetch_enabled()` returns false and `load_rules()`
// always uses the embedded baseline. This is intentional: shipping a
// development public key would let a casual binary inspection bypass the
// integrity chain.

/// 32-byte Ed25519 public key. The current value is all-zeros — a known
/// invalid key — so signature verification always fails. Replace with the
/// real production public key (kept in HSM / offline machine, NEVER in this
/// repo) immediately before enabling remote fetch.
const RULES_SIGNING_PUBKEY_BYTES: [u8; 32] = [0u8; 32];

/// Hard cap on manifest size. Manifests are a few hundred bytes; 4 KB is
/// generous.
const MANIFEST_MAX_BYTES: usize = 4096;

/// Hard cap on rules JSON size. The current baseline is < 20 KB; 1 MB
/// accommodates growth and any reasonable expansion.
const RULES_MAX_BYTES: usize = 1024 * 1024;

/// Until the embedded pubkey is replaced with a real production key and a
/// CDN URL is configured, no remote fetch happens. Hard-coded false.
fn remote_fetch_enabled() -> bool {
    // Real production check would be:
    //   RULES_SIGNING_PUBKEY_BYTES != [0u8; 32]  &&  ENABLE_REMOTE_FETCH cfg gate
    // Both are intentionally absent so private beta cannot accidentally ship
    // with remote fetch enabled.
    false
}

// All fields are part of the schema contract published in
// docs/ARCHITECTURE_LOCKS §1.4. Signature, rules_sha256, ruleset_version,
// expires_at, and min/max_app_version are consumed by the (now real)
// verification chain; created_at, schema_version, and rules_url are only
// consumed once remote fetch is enabled, so we keep #[allow(dead_code)]
// rather than gate the schema behind cfg flags — the schema is the published
// interface, not a private implementation detail.
#[derive(Deserialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
#[allow(dead_code)]
struct RulesManifest {
    schema_version: u32,
    ruleset_version: u64,
    created_at: String,
    expires_at: String,
    min_app_version: String,
    max_app_version: String,
    /// Hex-encoded SHA-256 of the rules JSON file.
    rules_sha256: String,
    /// URL to fetch the rules JSON from. Compy will SHA-256 the response
    /// and verify it matches `rules_sha256`.
    rules_url: String,
    /// Hex-encoded Ed25519 signature over the manifest's canonical bytes
    /// (currently: the bytes of the JSON manifest with this `signature` field
    /// removed and the resulting object re-serialized in a canonical form).
    signature: String,
}

#[derive(Debug, Clone)]
enum ManifestError {
    SizeCap,
    Parse(String),
    BadSignatureFormat,
    SignatureInvalid,
    RulesetVersionRegression { latest: u64, attempted: u64 },
    Expired,
    AppVersionOutOfRange,
    BadKey,
}

impl std::fmt::Display for ManifestError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::SizeCap => write!(f, "manifest exceeds {} byte cap", MANIFEST_MAX_BYTES),
            Self::Parse(e) => write!(f, "manifest parse: {}", e),
            Self::BadSignatureFormat => write!(f, "manifest signature hex is malformed"),
            Self::SignatureInvalid => write!(f, "manifest signature did not verify"),
            Self::RulesetVersionRegression { latest, attempted } => write!(
                f,
                "manifest ruleset_version {} is older than last-seen {} (rollback attack rejected)",
                attempted, latest
            ),
            Self::Expired => write!(f, "manifest expires_at is in the past (freeze attack rejected)"),
            Self::AppVersionOutOfRange => {
                write!(f, "manifest does not cover the current Compy app version")
            }
            Self::BadKey => write!(f, "embedded public key is the placeholder all-zeros"),
        }
    }
}

/// Build the bytes that were signed by computing a canonical serialization of
/// the manifest with the `signature` field removed. The signer must produce
/// the same canonical form at sign time, so this is the contract that
/// determines what "the manifest" means cryptographically.
fn canonical_manifest_payload(raw_json: &[u8]) -> Result<Vec<u8>, ManifestError> {
    let mut value: serde_json::Value =
        serde_json::from_slice(raw_json).map_err(|e| ManifestError::Parse(e.to_string()))?;
    if let Some(obj) = value.as_object_mut() {
        obj.remove("signature");
    }
    // serde_json's `to_writer` is not RFC 8785 canonical, but it is
    // deterministic given the same `serde_json::Value` (BTreeMap-backed
    // for objects when the `preserve_order` feature is OFF, which is the
    // default). That's good enough for our contract — the signer uses the
    // same serializer.
    serde_json::to_vec(&value).map_err(|e| ManifestError::Parse(e.to_string()))
}

/// Real Ed25519 verification against an explicit public key. The production
/// flow reaches this through `verify_chain` (which applies the all-zeros
/// placeholder guard first); tests call it directly with an ephemeral key, so
/// the cryptographic path is exercised without ever embedding a key in the repo.
///
/// Steps: enforce the size cap, parse the manifest, decode the hex signature,
/// build the canonical signed payload (manifest minus `signature`), and run
/// the curve25519 verify. Any failure yields a specific ManifestError; only a
/// cryptographically valid signature over the exact canonical bytes returns Ok.
fn verify_manifest_with_key(
    raw_json: &[u8],
    pubkey_bytes: &[u8; 32],
) -> Result<RulesManifest, ManifestError> {
    use ed25519_compact::{PublicKey, Signature};

    if raw_json.len() > MANIFEST_MAX_BYTES {
        return Err(ManifestError::SizeCap);
    }

    let manifest: RulesManifest =
        serde_json::from_slice(raw_json).map_err(|e| ManifestError::Parse(e.to_string()))?;

    let sig_bytes = hex_decode(&manifest.signature).ok_or(ManifestError::BadSignatureFormat)?;
    let signature =
        Signature::from_slice(&sig_bytes).map_err(|_| ManifestError::BadSignatureFormat)?;
    let public_key = PublicKey::from_slice(pubkey_bytes).map_err(|_| ManifestError::BadKey)?;

    let payload = canonical_manifest_payload(raw_json)?;

    public_key
        .verify(&payload, &signature)
        .map_err(|_| ManifestError::SignatureInvalid)?;

    Ok(manifest)
}

/// Verify the integrity chain on a fetched (manifest, rules) pair:
///   1. manifest signature valid
///   2. rules SHA-256 matches the manifest's `rules_sha256`
///   3. manifest's ruleset_version is monotonic against the persisted
///      last-seen version
///   4. expires_at is in the future
///   5. app version sits inside [min_app_version, max_app_version]
///   6. rules JSON fits the size cap and parses
///
/// On success, returns the parsed RulesFile and the new last-seen version
/// (caller should persist it).
fn verify_chain(
    raw_manifest: &[u8],
    raw_rules: &[u8],
    last_seen_ruleset_version: u64,
) -> Result<(RulesManifest, RulesFile), ManifestError> {
    if RULES_SIGNING_PUBKEY_BYTES == [0u8; 32] {
        return Err(ManifestError::BadKey);
    }
    verify_chain_with_key(
        raw_manifest,
        raw_rules,
        last_seen_ruleset_version,
        &RULES_SIGNING_PUBKEY_BYTES,
    )
}

/// Full integrity chain against an explicit public key (testable variant of
/// `verify_chain`). All the non-signature gates (SHA-256 binding, monotonic
/// ruleset_version, expiry, app-version range, size cap, parse) live here so
/// they can be exercised end-to-end in tests with a valid ephemeral signature.
fn verify_chain_with_key(
    raw_manifest: &[u8],
    raw_rules: &[u8],
    last_seen_ruleset_version: u64,
    pubkey_bytes: &[u8; 32],
) -> Result<(RulesManifest, RulesFile), ManifestError> {
    use sha2::{Digest, Sha256};

    if raw_rules.len() > RULES_MAX_BYTES {
        return Err(ManifestError::SizeCap);
    }

    let manifest = verify_manifest_with_key(raw_manifest, pubkey_bytes)?;

    let mut hasher = Sha256::new();
    hasher.update(raw_rules);
    let computed = hasher.finalize();
    let expected = hex_decode(&manifest.rules_sha256)
        .ok_or_else(|| ManifestError::Parse("rules_sha256 hex".into()))?;
    if computed.as_slice() != expected.as_slice() {
        return Err(ManifestError::Parse(
            "rules SHA-256 mismatch against manifest".into(),
        ));
    }

    if manifest.ruleset_version < last_seen_ruleset_version {
        return Err(ManifestError::RulesetVersionRegression {
            latest: last_seen_ruleset_version,
            attempted: manifest.ruleset_version,
        });
    }

    let now = Utc::now();
    let expires = chrono::DateTime::parse_from_rfc3339(&manifest.expires_at)
        .map_err(|e| ManifestError::Parse(format!("expires_at: {}", e)))?;
    if expires < now {
        return Err(ManifestError::Expired);
    }

    let current = env!("CARGO_PKG_VERSION");
    if !version_in_range(current, &manifest.min_app_version, &manifest.max_app_version) {
        return Err(ManifestError::AppVersionOutOfRange);
    }

    let rules: RulesFile = serde_json::from_slice(raw_rules)
        .map_err(|e| ManifestError::Parse(format!("rules JSON: {}", e)))?;
    Ok((manifest, rules))
}

fn version_in_range(current: &str, min: &str, max: &str) -> bool {
    // Compare dotted versions NUMERICALLY, component by component — a raw string compare is
    // lexicographic and wrong at the boundary this actually gates (e.g. "0.10.0" < "0.9.0" as
    // strings, so a genuinely-newer build would be rejected as below min). No `semver` dep needed
    // for the "MAJOR.MINOR.PATCH" shape the manifest uses.
    cmp_version(current, min) != Ordering::Less && cmp_version(current, max) != Ordering::Greater
}

/// Numeric dotted-version compare. Each '.'-separated segment is parsed as a number (leading digits
/// only, so a "1.2.3-rc1" pre-release tail is ignored — a non-numeric segment reads as 0); the
/// shorter version is zero-padded so "1.2" == "1.2.0". Never panics on malformed input.
fn cmp_version(a: &str, b: &str) -> Ordering {
    let parse = |s: &str| -> Vec<u64> {
        s.split('.')
            .map(|seg| {
                let digits: String = seg.chars().take_while(|c| c.is_ascii_digit()).collect();
                digits.parse::<u64>().unwrap_or(0)
            })
            .collect()
    };
    let (va, vb) = (parse(a), parse(b));
    let n = va.len().max(vb.len());
    for i in 0..n {
        let x = va.get(i).copied().unwrap_or(0);
        let y = vb.get(i).copied().unwrap_or(0);
        match x.cmp(&y) {
            Ordering::Equal => continue,
            other => return other,
        }
    }
    Ordering::Equal
}

// ─── Rules source tracking + last-known-good cache ───────────────────────

#[derive(Serialize, Clone, Copy, Debug)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum RulesSource {
    /// Loaded from the binary's embedded baseline (cold start, no network,
    /// remote fetch disabled, or all remote attempts failed).
    Embedded,
    /// Loaded from %APPDATA%\Compy\cached-rules.json (a prior successful
    /// remote fetch survived a restart).
    Cached,
    /// Just fetched from the configured remote URL and passed every gate.
    Remote,
}

fn cached_manifest_path() -> PathBuf {
    compy_data_dir().join("cached-manifest.json")
}
fn cached_rules_path() -> PathBuf {
    compy_data_dir().join("cached-rules.json")
}
fn last_seen_version_path() -> PathBuf {
    compy_data_dir().join("last-seen-ruleset-version.txt")
}

fn load_last_seen_ruleset_version() -> u64 {
    fs::read_to_string(last_seen_version_path())
        .ok()
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(0)
}

fn save_last_seen_ruleset_version(v: u64) {
    let _ = fs::create_dir_all(compy_data_dir());
    let _ = fs::write(last_seen_version_path(), v.to_string());
}

fn load_cached_rules() -> Option<(RulesManifest, RulesFile)> {
    if !remote_fetch_enabled() {
        return None;
    }
    let raw_manifest = fs::read(cached_manifest_path()).ok()?;
    let raw_rules = fs::read(cached_rules_path()).ok()?;
    let last_seen = load_last_seen_ruleset_version();
    verify_chain(&raw_manifest, &raw_rules, last_seen).ok()
}

fn save_cached_rules(raw_manifest: &[u8], raw_rules: &[u8]) -> Result<(), String> {
    fs::create_dir_all(compy_data_dir()).map_err(|e| e.to_string())?;
    fs::write(cached_manifest_path(), raw_manifest).map_err(|e| e.to_string())?;
    fs::write(cached_rules_path(), raw_rules).map_err(|e| e.to_string())?;
    Ok(())
}

/// Stub for the eventual HTTP fetch. Intentionally returns None — no remote
/// fetch happens until `remote_fetch_enabled()` is true AND a real CDN URL
/// is configured. See ARCHITECTURE_LOCKS §1.4 — unsigned remote rules MUST
/// NOT ship, including in private beta.
fn fetch_remote_rules() -> Option<(Vec<u8>, Vec<u8>)> {
    if !remote_fetch_enabled() {
        return None;
    }
    // Future: HTTP GET <manifest_url>, then HTTP GET manifest.rules_url,
    // both with 5 s timeout and the size caps enforced by reqwest::Response::
    // bytes_with_limit (or equivalent).
    None
}

/// Single entry point for loading rules. Tries remote → cached → embedded
/// in order, returns whichever succeeded plus a source tag. Never panics;
/// the embedded baseline is always a valid fallback.
pub(crate) fn load_rules() -> (RulesFile, RulesSource) {
    // Remote path (currently a no-op until production key + URL are wired).
    if remote_fetch_enabled() {
        if let Some((raw_manifest, raw_rules)) = fetch_remote_rules() {
            let last_seen = load_last_seen_ruleset_version();
            match verify_chain(&raw_manifest, &raw_rules, last_seen) {
                Ok((manifest, rules)) => {
                    let _ = save_cached_rules(&raw_manifest, &raw_rules);
                    save_last_seen_ruleset_version(manifest.ruleset_version);
                    return (rules, RulesSource::Remote);
                }
                Err(_e) => {
                    // Fall through to cached / embedded. Production would log
                    // the verification failure for support.
                }
            }
        }
    }

    // Cached path (only meaningful once remote has succeeded at least once).
    if let Some((_manifest, rules)) = load_cached_rules() {
        return (rules, RulesSource::Cached);
    }

    // Embedded baseline — always works, no network required.
    (load_baseline_rules_embedded(), RulesSource::Embedded)
}

// ─── Signed-manifest verification tests ──────────────────────────────────
//
// These exercise the real Ed25519 path using EPHEMERAL keypairs generated at
// test time. No private (or public) key is ever embedded or committed — the
// production `RULES_SIGNING_PUBKEY_BYTES` placeholder is untouched. The tests
// prove: a correctly-signed manifest verifies; any tampering, wrong key, or
// malformed signature is rejected; and the full chain enforces SHA-256
// binding, monotonic versioning, expiry, and app-version range.
#[cfg(test)]
mod manifest_tests {
    use super::*;
    use chrono::Utc;
    use ed25519_compact::KeyPair;
    use sha2::{Digest, Sha256};

    const VALID_RULES: &[u8] = br#"{"schema_version":1,"rules":[]}"#;

    fn sha256_hex(bytes: &[u8]) -> String {
        let mut h = Sha256::new();
        h.update(bytes);
        hex_encode(&h.finalize())
    }

    /// Build a fully-signed manifest JSON, signed by `kp` over the canonical
    /// payload (manifest minus `signature`), exactly as the verifier expects.
    fn signed_manifest(
        kp: &KeyPair,
        ruleset_version: u64,
        expires_at: &str,
        min_app: &str,
        max_app: &str,
        rules_sha256: &str,
    ) -> Vec<u8> {
        let mut obj = serde_json::json!({
            "schema_version": 1,
            "ruleset_version": ruleset_version,
            "created_at": "2026-01-01T00:00:00Z",
            "expires_at": expires_at,
            "min_app_version": min_app,
            "max_app_version": max_app,
            "rules_sha256": rules_sha256,
            "rules_url": "https://example.invalid/rules.json",
            "signature": ""
        });
        let raw = serde_json::to_vec(&obj).unwrap();
        // canonical_manifest_payload strips `signature`, so signing this (with
        // an empty signature) produces the exact bytes the verifier rebuilds.
        let payload = canonical_manifest_payload(&raw).unwrap();
        let sig = kp.sk.sign(&payload, None);
        obj["signature"] = serde_json::Value::String(hex_encode(&sig[..]));
        serde_json::to_vec(&obj).unwrap()
    }

    fn future() -> String {
        (Utc::now() + chrono::Duration::days(30)).to_rfc3339()
    }

    #[test]
    fn valid_manifest_verifies() {
        let kp = KeyPair::generate();
        let pk: [u8; 32] = *kp.pk;
        let m = signed_manifest(&kp, 5, &future(), "0.0.0", "99.0.0", &sha256_hex(VALID_RULES));
        let manifest = verify_manifest_with_key(&m, &pk).expect("should verify");
        assert_eq!(manifest.ruleset_version, 5);
    }

    #[test]
    fn tampered_payload_is_rejected() {
        let kp = KeyPair::generate();
        let pk: [u8; 32] = *kp.pk;
        let m = signed_manifest(&kp, 5, &future(), "0.0.0", "99.0.0", &sha256_hex(VALID_RULES));
        // Flip a field AFTER signing — signature no longer matches the payload.
        let s = String::from_utf8(m).unwrap().replace(
            "https://example.invalid/rules.json",
            "https://evil.invalid/rules.json",
        );
        let err = verify_manifest_with_key(s.as_bytes(), &pk).unwrap_err();
        assert!(matches!(err, ManifestError::SignatureInvalid));
    }

    #[test]
    fn wrong_key_is_rejected() {
        let signer = KeyPair::generate();
        let other = KeyPair::generate();
        let m = signed_manifest(&signer, 5, &future(), "0.0.0", "99.0.0", &sha256_hex(VALID_RULES));
        let err = verify_manifest_with_key(&m, &other.pk).unwrap_err();
        assert!(matches!(err, ManifestError::SignatureInvalid));
    }

    #[test]
    fn malformed_signature_is_rejected() {
        let kp = KeyPair::generate();
        let pk: [u8; 32] = *kp.pk;
        let m = signed_manifest(&kp, 5, &future(), "0.0.0", "99.0.0", &sha256_hex(VALID_RULES));
        // Replace the signature with non-hex / wrong length.
        let s = serde_json::to_string(&{
            let mut v: serde_json::Value = serde_json::from_slice(&m).unwrap();
            v["signature"] = serde_json::Value::String("zzzz".into());
            v
        })
        .unwrap();
        let err = verify_manifest_with_key(s.as_bytes(), &pk).unwrap_err();
        assert!(matches!(err, ManifestError::BadSignatureFormat));
    }

    #[test]
    fn oversized_manifest_is_rejected() {
        let kp = KeyPair::generate();
        let pk: [u8; 32] = *kp.pk;
        // Pad rules_url so the raw manifest exceeds MANIFEST_MAX_BYTES.
        let big = "x".repeat(MANIFEST_MAX_BYTES + 100);
        let m = signed_manifest(&kp, 5, &future(), "0.0.0", "99.0.0", &big);
        let err = verify_manifest_with_key(&m, &pk).unwrap_err();
        assert!(matches!(err, ManifestError::SizeCap));
    }

    #[test]
    fn placeholder_key_hard_fails() {
        // The production entry point (verify_chain, with the embedded key) must
        // reject everything while that key is the all-zeros placeholder.
        let kp = KeyPair::generate();
        let m = signed_manifest(&kp, 5, &future(), "0.0.0", "99.0.0", &sha256_hex(VALID_RULES));
        assert!(matches!(
            verify_chain(&m, VALID_RULES, 0),
            Err(ManifestError::BadKey)
        ));
    }

    #[test]
    fn full_chain_accepts_valid() {
        let kp = KeyPair::generate();
        let pk: [u8; 32] = *kp.pk;
        let m = signed_manifest(&kp, 10, &future(), "0.0.0", "99.0.0", &sha256_hex(VALID_RULES));
        let (manifest, rules) = verify_chain_with_key(&m, VALID_RULES, 9, &pk).expect("chain ok");
        assert_eq!(manifest.ruleset_version, 10);
        assert!(rules.rules.is_empty());
    }

    #[test]
    fn chain_rejects_sha256_mismatch() {
        let kp = KeyPair::generate();
        let pk: [u8; 32] = *kp.pk;
        // Manifest commits to the hash of VALID_RULES, but we serve different bytes.
        let m = signed_manifest(&kp, 10, &future(), "0.0.0", "99.0.0", &sha256_hex(VALID_RULES));
        let tampered = br#"{"schema_version":1,"rules":[],"x":1}"#;
        assert!(matches!(
            verify_chain_with_key(&m, tampered, 9, &pk),
            Err(ManifestError::Parse(_))
        ));
    }

    #[test]
    fn chain_rejects_version_rollback() {
        let kp = KeyPair::generate();
        let pk: [u8; 32] = *kp.pk;
        let m = signed_manifest(&kp, 3, &future(), "0.0.0", "99.0.0", &sha256_hex(VALID_RULES));
        // last_seen is 7 — serving version 3 is a rollback.
        assert!(matches!(
            verify_chain_with_key(&m, VALID_RULES, 7, &pk),
            Err(ManifestError::RulesetVersionRegression { .. })
        ));
    }

    #[test]
    fn chain_rejects_expired() {
        let kp = KeyPair::generate();
        let pk: [u8; 32] = *kp.pk;
        let past = (Utc::now() - chrono::Duration::days(1)).to_rfc3339();
        let m = signed_manifest(&kp, 10, &past, "0.0.0", "99.0.0", &sha256_hex(VALID_RULES));
        assert!(matches!(
            verify_chain_with_key(&m, VALID_RULES, 0, &pk),
            Err(ManifestError::Expired)
        ));
    }

    #[test]
    fn version_compare_is_numeric_not_lexicographic() {
        // The bug this guards: a raw string compare orders "0.10.0" BELOW "0.9.0" (because '1' < '9'
        // char-wise), so a genuinely-newer build would be rejected as under min_app_version.
        assert_eq!(cmp_version("0.10.0", "0.9.0"), Ordering::Greater);
        assert_eq!(cmp_version("1.2.0", "1.2"), Ordering::Equal); // zero-padded tail
        assert_eq!(cmp_version("1.2.3-rc1", "1.2.3"), Ordering::Equal); // pre-release tail ignored
        assert_eq!(cmp_version("2.0.0", "10.0.0"), Ordering::Less);
        // In-range check uses it end to end: 0.10.0 IS within [0.9.0, 1.0.0].
        assert!(version_in_range("0.10.0", "0.9.0", "1.0.0"));
        assert!(!version_in_range("0.8.0", "0.9.0", "1.0.0"));
    }

    #[test]
    fn chain_rejects_app_version_out_of_range() {
        let kp = KeyPair::generate();
        let pk: [u8; 32] = *kp.pk;
        // Require an app version far above the current one.
        let m = signed_manifest(&kp, 10, &future(), "99.0.0", "100.0.0", &sha256_hex(VALID_RULES));
        assert!(matches!(
            verify_chain_with_key(&m, VALID_RULES, 0, &pk),
            Err(ManifestError::AppVersionOutOfRange)
        ));
    }
}
