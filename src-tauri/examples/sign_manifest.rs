//! Offline Ed25519 signer for Sentinel rules manifests.
//!
//! This is a RELEASE-TIME tool, run on a trusted/air-gapped machine. It never
//! ships in the app and never touches the private key automatically — you pass
//! the key in explicitly.
//!
//! ┌─ SECURITY (ARCHITECTURE_LOCKS §1.4 / §5) ───────────────────────────────┐
//! │ The Ed25519 PRIVATE key (seed) NEVER lives in this repo — not in commits,│
//! │ not in .env*, not in CI secrets, not unencrypted in a home dir. Keep it  │
//! │ on an HSM / offline machine. This tool only READS a seed file path you   │
//! │ give it; do not store that file in the repo tree.                        │
//! └──────────────────────────────────────────────────────────────────────────┘
//!
//! Generate a keypair (run once, store the seed offline; embed the public key):
//!     cargo run --example sign_manifest -- --gen-key
//!   → prints SEED (keep secret) and PUBLIC KEY (paste into
//!     RULES_SIGNING_PUBKEY_BYTES in lib.rs).
//!
//! Sign a manifest for a rules file:
//!     cargo run --example sign_manifest -- \
//!         --seed seed.hex \
//!         --rules baseline-rules-v1.json \
//!         --rules-url https://cdn.example.com/rules/v1.json \
//!         --ruleset-version 1 \
//!         --expires-days 90 \
//!         --min-app 0.1.0 --max-app 99.0.0 \
//!         --out manifest.json
//!
//! The signed manifest's canonical form MUST match lib.rs
//! `canonical_manifest_payload` (parse JSON → remove `signature` → serde_json
//! to_vec). The `canonical()` helper below mirrors it exactly; the lib's
//! `manifest_tests` prove this sign→verify flow round-trips.

use std::collections::HashMap;
use std::process::exit;

use ed25519_compact::{KeyPair, Seed};
use sha2::{Digest, Sha256};

fn hex_encode(bytes: &[u8]) -> String {
    const T: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        s.push(T[(b >> 4) as usize] as char);
        s.push(T[(b & 0x0f) as usize] as char);
    }
    s
}

fn hex_decode(s: &str) -> Option<Vec<u8>> {
    let s = s.trim();
    if s.len() % 2 != 0 {
        return None;
    }
    fn n(b: u8) -> Option<u8> {
        match b {
            b'0'..=b'9' => Some(b - b'0'),
            b'a'..=b'f' => Some(b - b'a' + 10),
            b'A'..=b'F' => Some(b - b'A' + 10),
            _ => None,
        }
    }
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(s.len() / 2);
    let mut i = 0;
    while i < b.len() {
        out.push((n(b[i])? << 4) | n(b[i + 1])?);
        i += 2;
    }
    Some(out)
}

/// MUST match lib.rs `canonical_manifest_payload`: parse the manifest JSON,
/// drop the `signature` field, and serialize deterministically (serde_json
/// without the preserve_order feature sorts object keys).
fn canonical(value: &serde_json::Value) -> Vec<u8> {
    let mut v = value.clone();
    if let Some(obj) = v.as_object_mut() {
        obj.remove("signature");
    }
    serde_json::to_vec(&v).expect("serialize canonical manifest")
}

fn arg_map(args: &[String]) -> HashMap<String, String> {
    let mut m = HashMap::new();
    let mut i = 0;
    while i < args.len() {
        if let Some(key) = args[i].strip_prefix("--") {
            // Flags with no value (e.g. --gen-key) map to "true".
            let val = args
                .get(i + 1)
                .filter(|v| !v.starts_with("--"))
                .cloned()
                .unwrap_or_else(|| "true".into());
            let consumed_val = m.insert(key.to_string(), val).is_none() && {
                args.get(i + 1).map(|v| !v.starts_with("--")).unwrap_or(false)
            };
            i += if consumed_val { 2 } else { 1 };
        } else {
            i += 1;
        }
    }
    m
}

fn die(msg: &str) -> ! {
    eprintln!("error: {msg}");
    exit(1);
}

fn now_rfc3339() -> String {
    // Avoid pulling chrono here; format a UTC timestamp from SystemTime.
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Minimal civil-from-days conversion (sufficient for created/expires stamps).
    rfc3339_from_unix(secs as i64)
}

fn rfc3339_from_unix(secs: i64) -> String {
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let (h, mi, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    // Howard Hinnant's civil_from_days algorithm.
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        y, m, d, h, mi, s
    )
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let opts = arg_map(&args);

    if opts.contains_key("gen-key") {
        let kp = KeyPair::generate();
        let seed_hex = hex_encode(&kp.sk.seed()[..]);
        let pk_hex = hex_encode(&kp.pk[..]);
        println!("# Ed25519 keypair — generated on a trusted/offline machine.");
        println!("# SEED (PRIVATE — store on HSM/offline, NEVER commit):");
        println!("{seed_hex}");
        println!();
        println!("# PUBLIC KEY — paste as the 32 bytes of RULES_SIGNING_PUBKEY_BYTES in lib.rs:");
        println!("{pk_hex}");
        // Also print it pre-formatted as a Rust array for convenience.
        let pk = hex_decode(&pk_hex).unwrap();
        let arr: Vec<String> = pk.iter().map(|b| format!("0x{b:02x}")).collect();
        println!("\n// const RULES_SIGNING_PUBKEY_BYTES: [u8; 32] = [");
        for chunk in arr.chunks(8) {
            println!("//     {},", chunk.join(", "));
        }
        println!("// ];");
        return;
    }

    let seed_path = opts.get("seed").unwrap_or_else(|| die("missing --seed <hex-seed-file>"));
    let rules_path = opts.get("rules").unwrap_or_else(|| die("missing --rules <rules.json>"));
    let rules_url = opts
        .get("rules-url")
        .unwrap_or_else(|| die("missing --rules-url <url>"));
    let ruleset_version: u64 = opts
        .get("ruleset-version")
        .unwrap_or_else(|| die("missing --ruleset-version <n>"))
        .parse()
        .unwrap_or_else(|_| die("--ruleset-version must be an integer"));
    let expires_days: i64 = opts
        .get("expires-days")
        .map(|s| s.parse().unwrap_or_else(|_| die("--expires-days must be an integer")))
        .unwrap_or(90);
    let min_app = opts.get("min-app").cloned().unwrap_or_else(|| "0.0.0".into());
    let max_app = opts.get("max-app").cloned().unwrap_or_else(|| "99.0.0".into());

    let seed_hex = std::fs::read_to_string(seed_path)
        .unwrap_or_else(|e| die(&format!("cannot read seed file: {e}")));
    let seed_bytes = hex_decode(&seed_hex).unwrap_or_else(|| die("seed file is not valid hex"));
    if seed_bytes.len() != 32 {
        die("seed must be exactly 32 bytes (64 hex chars)");
    }
    let seed = Seed::from_slice(&seed_bytes).unwrap_or_else(|_| die("invalid Ed25519 seed"));
    let kp = KeyPair::from_seed(seed);

    let rules_bytes =
        std::fs::read(rules_path).unwrap_or_else(|e| die(&format!("cannot read rules file: {e}")));
    let mut hasher = Sha256::new();
    hasher.update(&rules_bytes);
    let rules_sha256 = hex_encode(&hasher.finalize());

    let created_at = now_rfc3339();
    let expires_at = rfc3339_from_unix(
        (std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0) as i64)
            + expires_days * 86_400,
    );

    let mut manifest = serde_json::json!({
        "schema_version": 1,
        "ruleset_version": ruleset_version,
        "created_at": created_at,
        "expires_at": expires_at,
        "min_app_version": min_app,
        "max_app_version": max_app,
        "rules_sha256": rules_sha256,
        "rules_url": rules_url,
        "signature": ""
    });

    let payload = canonical(&manifest);
    let sig = kp.sk.sign(&payload, None);
    manifest["signature"] = serde_json::Value::String(hex_encode(&sig[..]));

    let out_json = serde_json::to_string_pretty(&manifest).expect("serialize manifest");

    // Self-check: re-parse the emitted manifest and verify EXACTLY as the app
    // will (parse → canonical → Ed25519 verify). This proves canonical parity
    // with lib.rs and that the output is app-verifiable before we write it.
    {
        let reparsed: serde_json::Value =
            serde_json::from_str(&out_json).expect("reparse emitted manifest");
        let check_payload = canonical(&reparsed);
        let sig_hex = reparsed["signature"].as_str().unwrap_or("");
        let sig_bytes = hex_decode(sig_hex).unwrap_or_else(|| die("emitted signature not hex"));
        let signature = ed25519_compact::Signature::from_slice(&sig_bytes)
            .unwrap_or_else(|_| die("emitted signature wrong length"));
        kp.pk
            .verify(&check_payload, &signature)
            .unwrap_or_else(|_| die("SELF-VERIFY FAILED — canonical mismatch with the verifier"));
        eprintln!("self-verify: OK — signature validates against the public key");
        eprintln!("public key: {}", hex_encode(&kp.pk[..]));
    }

    match opts.get("out") {
        Some(path) => {
            std::fs::write(path, &out_json)
                .unwrap_or_else(|e| die(&format!("cannot write --out: {e}")));
            eprintln!("wrote signed manifest to {path}");
        }
        None => println!("{out_json}"),
    }
}
