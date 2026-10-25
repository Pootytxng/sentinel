//! Receipts telemetry — DARK groundwork (R3 Lane C2; Receipts Doctrine Phase 3).
//!
//! Spec: `docs/superpowers/specs/2026-06-12-receipts-telemetry-spec.md` (owner review pending).
//! This module is the gaming_mode/Ed25519 pattern applied to telemetry: the PAYLOAD logic is
//! wired and tested and the gate is HARD-FALSE (test-pinned). **As of 2026-08-25 (Q9a, #217) the
//! send path DOES exist** — see the marked section below — and it refuses before it reaches a
//! socket, so no shipped build has ever sent a byte. Flipping the gate is still its own
//! owner-signed commit per the spec's §5 ladder; until then `preview_receipt_payload` refuses too.
//!
//! **Sharing is OPT-IN and default OFF, and stays OFF after arming** — owner ruling 2026-08-24
//! (issue #207, `docs/RECEIPTS_DOCTRINE.md` §2). See `ConsentState::is_on` for why that outranks
//! the 2026-08-18 amendment it replaced.
//!
//! Anonymity is enforced by SCHEMA, not promise: the builder consumes an allowlist of fields and
//! sanitizes every string it touches — no hostname, username, path, serial, or exact byte count
//! can survive into a serialized payload (pinned by adversarial tests).

use serde::{Deserialize, Serialize};
use serde_json::Value;

// The three pure hardware-class helpers moved to the tier-neutral `hw_class` module (Q9b contract
// §4) so Tier 3 shares the exact vocabularies without importing this tier module. Same functions,
// same outputs — the adversarial tests below still pin them through this module's payload builder.
use crate::hw_class::{gpu_vendor_token, ram_gb_bucket, sanitize_token};

/// HARD-FALSE gate. Flips only per the spec §5 ladder: owner sign-off → endpoint security
/// review → consent-UI audit → its own commit with QA evidence. Mirrors `gaming_mode_gate`.
pub(crate) fn receipts_gate() -> bool {
    false
}

#[derive(Serialize, Debug, PartialEq)]
pub(crate) struct HwClass {
    gpu_vendor: String,
    /// Retail model name — a class shared by thousands of rigs, never a serial.
    gpu_model: String,
    cpu_family: String,
    ram_gb_bucket: String,
}

#[derive(Serialize, Debug, PartialEq)]
pub(crate) struct Outcome {
    kind: &'static str,
    game: String,
    avg_fps: f64,
    low1_fps_est: f64,
    duration_bucket: String,
    /// Catalog rec ids only — never values, paths, or registry data.
    active_change_ids: Vec<String>,
}

#[derive(Serialize, Debug, PartialEq)]
pub(crate) struct ReceiptPayload {
    schema_version: u32,
    hw_class: HwClass,
    outcome: Outcome,
}

fn duration_bucket(secs: Option<u64>) -> String {
    let Some(s) = secs else { return "unknown".into() };
    match s {
        0..=899 => "<15min",
        900..=1799 => "15-30min",
        1800..=3599 => "30-60min",
        3600..=10799 => "1-3h",
        _ => "3h+",
    }
    .into()
}

/// Pure: assemble a schema-v1 receipt from already-serialized signals. `None` when no monitored
/// session exists — a receipt without a measurement is not a receipt (receipts law).
pub(crate) fn build_receipt_payload(
    hardware: &Value,
    sessions: &Value,
    trust_ledger: &Value,
) -> Option<ReceiptPayload> {
    // The newest session that measured play: one behind another window the whole time has no
    // measurement to put in a receipt (P4-show-f1).
    let session = crate::sessions::newest_measured_row(sessions)?;
    let game_raw = session.get("process_name").and_then(Value::as_str)?;

    let gpu_model_raw = hardware
        .get("gpus")
        .and_then(Value::as_array)
        .and_then(|g| g.first())
        .and_then(|g| g.get("name"))
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let cpu_family = hardware
        .get("cpu_arch")
        .and_then(|a| a.get("family_label"))
        .and_then(Value::as_str)
        .unwrap_or("unknown");

    let active_change_ids = trust_ledger
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter(|c| {
                    c.get("status").and_then(Value::as_str) == Some("applied")
                        && c.get("is_still_active").and_then(Value::as_bool) != Some(false)
                })
                .filter_map(|c| c.get("rec_id").and_then(Value::as_str))
                .map(sanitize_token)
                .collect()
        })
        .unwrap_or_default();

    Some(ReceiptPayload {
        schema_version: 1,
        hw_class: HwClass {
            gpu_vendor: gpu_vendor_token(gpu_model_raw).into(),
            gpu_model: sanitize_token(gpu_model_raw),
            cpu_family: sanitize_token(cpu_family),
            ram_gb_bucket: ram_gb_bucket(hardware.get("ram_total_bytes").and_then(Value::as_u64)),
        },
        outcome: Outcome {
            kind: "session",
            game: sanitize_token(game_raw),
            avg_fps: session.get("avg_fps").and_then(Value::as_f64).unwrap_or(0.0),
            low1_fps_est: session.get("low1_fps_est").and_then(Value::as_f64).unwrap_or(0.0),
            duration_bucket: duration_bucket(session.get("duration_secs").and_then(Value::as_u64)),
            active_change_ids,
        },
    })
}

/// State probe: is the receipts surface available in this build? (It is not.)
#[tauri::command]
pub(crate) fn get_receipts_gate() -> bool {
    receipts_gate()
}

/// "Inspect your receipt" — returns the EXACT payload that would be shared. Refuses while the
/// gate is down (defense in depth: the surface is also hidden, gaming_mode pattern).
#[tauri::command]
pub(crate) fn preview_receipt_payload() -> Result<ReceiptPayload, String> {
    if !receipts_gate() {
        return Err("Receipts sharing isn't part of this build yet.".into());
    }
    // Same builder the send path uses (current_payload) — one receipt, not two.
    current_payload()
        .ok_or_else(|| "No monitored session yet — a receipt needs a measurement first.".into())
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// THE SEND PATH — built, and dark (Q9a, #217)
//
// The 2026-08-18 decision record's own correction is what this section answers: the send path did
// not exist anywhere in the app — no HTTP call, no endpoint, no queue — which quietly made arming
// an unbuildable one-line change. It exists now, and `receipts_gate()` above is still false, so
// every path below refuses before it reaches a socket. Building it first is the point: the arming
// commit should flip a gate in front of a transport that has already been reviewed, not write one
// in the same breath as the flip that makes it live.
//
// The send is deliberately NOT in the webview. The Capability Exception Gate asks whether the
// outcome can be reached by a lower-risk path; here it can. Sending from Rust means the frontend
// origin never gains network permission and `tauri.conf.json`'s CSP is untouched, so the widened
// surface is one function instead of a whole origin. It costs no new supply chain either: reqwest
// and rustls are already linked into every shipped build by `tauri-plugin-updater` (armed
// 2026-07-22).
// ══════════════════════════════════════════════════════════════════════════════════════════════

/// The ONE destination a receipt can reach, named exactly once so nothing else can name another.
///
/// It is `compy-bd6.pages.dev` and not `compy.gg` deliberately: `compy.gg` is not registered and no
/// custom domain is bound to the Pages project (#201 §1-2). Naming an aspirational host in the
/// disclosure would tell the user their data went somewhere it did not. The disclosure copy reads
/// this same constant back through `get_receipts_endpoint`, so the two cannot drift apart, and
/// re-pointing it at `compy.gg` is a pre-arming checklist item rather than a build item.
pub(crate) const RECEIPTS_ENDPOINT: &str = "https://compy-bd6.pages.dev/api/usage";

/// A receipt is worth ten seconds and never a retry. No queue, no backoff, no spool file: a send
/// that survives the moment it was refused is a send that can outlive an opt-out, and one lost
/// receipt is worth less than one sent against the user's wishes.
const SEND_TIMEOUT_SECS: u64 = 10;

/// The user's standing answer, persisted next to the rest of Compy's local state.
#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
pub(crate) struct ConsentState {
    /// When the first-run disclosure was actually shown and dismissed (RFC3339). `None` means the
    /// user has not been told yet — and not having been told is never consent, whatever the
    /// default is.
    pub(crate) disclosed_at: Option<String>,
    /// The user's explicit choice. `None` means they have not made one yet.
    pub(crate) enabled: Option<bool>,
}

impl ConsentState {
    /// **OPT-IN. Default OFF, and it stays OFF after arming** — owner ruling 2026-08-24, issue
    /// #207, recorded in `docs/RECEIPTS_DOCTRINE.md` §2 and §4 Phase 3.
    ///
    /// This is not the 2026-08-18 decision record's "on by default once armed". That amendment
    /// stood for six days and the owner overruled it, for a reason that binds code and not just
    /// copy: the shipped app description and the public download page already promise **"No
    /// telemetry"**, and the release repo's README says *"Outbound: signed update check only."* A
    /// default-ON sharing gate would contradict a promise users have already been given, so the
    /// promise wins and `unwrap_or` returns false. The doctrine is explicit that its ruling
    /// outranks the later amendment; the amendment's own text survives only as history.
    pub(crate) fn is_on(&self) -> bool {
        self.enabled.unwrap_or(false)
    }

    pub(crate) fn is_disclosed(&self) -> bool {
        self.disclosed_at.is_some()
    }
}

/// Why a send did not happen. Every variant is a REFUSAL, not a failure: nothing retries, nothing
/// is queued, and the caller has nothing to handle.
#[derive(Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum SendRefusal {
    /// `receipts_gate()` is false. That is every shipped build today.
    Dark,
    /// Armed, but the user has not seen the disclosure yet.
    NotYetDisclosed,
    /// Sharing is not on. Covers BOTH "never chose" and "chose off" deliberately: with an opt-in
    /// default those are the same answer, and a variant that distinguished them would invite code
    /// that treats silence as the softer of the two.
    NotOptedIn,
    /// No monitored session, so there is no measurement — and a receipt without one is not a
    /// receipt (receipts law).
    NoMeasurement,
}

/// A send either happened, was refused on our own terms, or the network failed. Three different
/// things, never collapsed into one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum SendError {
    Refused(SendRefusal),
    Transport(String),
}

impl From<SendRefusal> for SendError {
    fn from(r: SendRefusal) -> Self {
        SendError::Refused(r)
    }
}

/// The whole consent rule, as one pure function of (gate, consent) — no clock, no disk, no
/// network, so every branch is directly testable and arming changes exactly one input.
///
/// The order is load-bearing: the gate is asked first because a dark build must refuse without so
/// much as reading the user's file, and disclosure is asked before the switch because a user who
/// has never been told is refused for the honest reason rather than for a switch nobody showed them.
pub(crate) fn send_decision(gate: bool, consent: &ConsentState) -> Result<(), SendRefusal> {
    if !gate {
        return Err(SendRefusal::Dark);
    }
    if !consent.is_disclosed() {
        return Err(SendRefusal::NotYetDisclosed);
    }
    if !consent.is_on() {
        return Err(SendRefusal::NotOptedIn);
    }
    Ok(())
}

fn consent_path() -> std::path::PathBuf {
    crate::compy_data_dir().join("receipts-consent.json")
}

/// A missing or corrupt file reads as "never told, never chosen", which `send_decision` refuses.
/// Failing safe here means a damaged state file can silence sharing but can never start it.
fn load_consent_from(path: &std::path::Path) -> ConsentState {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub(crate) fn load_consent() -> ConsentState {
    load_consent_from(&consent_path())
}

/// Write-to-temp-then-rename, the idiom `history.rs` and `sessions.rs` already use: a half-written
/// consent file must never be readable, because a truncated one parses as `default` and would read
/// as "not disclosed" for a user who was.
fn save_consent_to(path: &std::path::Path, state: &ConsentState) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// The current receipt, or `None` when there is no measurement to report.
fn current_payload() -> Option<ReceiptPayload> {
    let hardware = serde_json::to_value(crate::hardware::get_hardware_info()).unwrap_or(Value::Null);
    let sessions =
        serde_json::to_value(crate::sessions::get_session_summaries()).unwrap_or(Value::Null);
    let ledger = serde_json::to_value(crate::history::get_applied_changes()).unwrap_or(Value::Null);
    build_receipt_payload(&hardware, &sessions, &ledger)
}

/// The transport, and nothing else — no consent logic lives here, so none of it can be reached
/// around by calling this directly.
///
/// The User-Agent is a constant product name with no version, OS build or machine id in it. A
/// header is data too, and the payload is the only place data is allowed to be.
async fn post_receipt(payload: &ReceiptPayload) -> Result<u16, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(SEND_TIMEOUT_SECS))
        .user_agent("Compy")
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .post(RECEIPTS_ENDPOINT)
        .json(payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    Ok(response.status().as_u16())
}

/// May this build, right now, send anything at all?
pub(crate) fn may_send_now() -> Result<(), SendRefusal> {
    send_decision(receipts_gate(), &load_consent())
}

/// The whole path, in the only order it is ever allowed to run: consent, then measurement, then
/// network. The gate is re-read here rather than passed in, so no caller supplies its own answer.
pub(crate) async fn send_receipt_if_allowed() -> Result<u16, SendError> {
    may_send_now()?;
    let payload = current_payload().ok_or(SendRefusal::NoMeasurement)?;
    post_receipt(&payload).await.map_err(SendError::Transport)
}

/// The ONLY trigger: a finalized monitored session, from `sessions::save_session`.
///
/// It exists in this dark commit on purpose. If the call site landed with the arming flip instead,
/// arming would stop being a one-line owner-signed change and start being a behavioural diff nobody
/// had reviewed. Here it is inert — the first line returns in every shipped build today.
pub(crate) fn on_session_finalized() {
    // Fail dark before anything else: no disk read, no runtime handle, no allocation.
    if !receipts_gate() {
        return;
    }
    if may_send_now().is_err() {
        return;
    }
    // Fire and forget. A finalized session must not wait on a network round trip, and a failed
    // send is not an error the user has to see or the caller has to handle.
    tauri::async_runtime::spawn(async {
        let _ = send_receipt_if_allowed().await;
    });
}

/// State probe: the user's standing answer, for the consent surface.
#[tauri::command]
pub(crate) fn get_receipts_consent() -> ConsentState {
    load_consent()
}

/// The real off switch. Deliberately works whether or not the gate is up: a preference you can only
/// set while the feature is already running is a preference you have to set under pressure.
#[tauri::command]
pub(crate) fn set_receipts_sharing_enabled(enabled: bool) -> Result<ConsentState, String> {
    let mut state = load_consent();
    state.enabled = Some(enabled);
    save_consent_to(&consent_path(), &state)?;
    Ok(state)
}

/// Records that the first-run disclosure was actually shown. Stamped ONCE — showing the text again
/// later must not rewrite the record of the first time, which is the thing being attested.
#[tauri::command]
pub(crate) fn acknowledge_receipts_disclosure() -> Result<ConsentState, String> {
    let mut state = load_consent();
    if state.disclosed_at.is_none() {
        state.disclosed_at = Some(chrono::Utc::now().to_rfc3339());
    }
    save_consent_to(&consent_path(), &state)?;
    Ok(state)
}

/// The destination, for the disclosure copy to name. The UI reads the constant instead of carrying
/// its own string, so the host a user is told about is the host the code would actually post to.
#[tauri::command]
pub(crate) fn get_receipts_endpoint() -> String {
    RECEIPTS_ENDPOINT.to_string()
}

#[cfg(test)]
mod receipts_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn gate_is_pinned_false_until_the_spec_ladder_completes() {
        // Flipping this is an owner-signed decision (spec §5), never a side effect of a refactor.
        assert!(!receipts_gate(), "receipts_gate must stay hard-false");
    }

    #[test]
    fn preview_command_refuses_while_dark() {
        let err = preview_receipt_payload().unwrap_err();
        assert!(err.contains("isn't part of this build"), "honest refusal, not a fake payload");
    }

    #[test]
    fn no_session_means_no_receipt() {
        assert_eq!(build_receipt_payload(&json!({}), &json!([]), &json!([])), None);
        assert_eq!(build_receipt_payload(&Value::Null, &Value::Null, &Value::Null), None);
    }

    #[test]
    fn adversarial_strings_cannot_leak_paths_or_usernames() {
        // Every consumed string field carries a path + username; the serialized payload must
        // contain none of it (anonymous by schema, not promise).
        let hardware = json!({
            "gpus": [{ "name": "C:\\Users\\kuya\\Radeon RX 9070 XT" }],
            "cpu_arch": { "family_label": "C:/Users/kuya/Ryzen X3D" },
            "ram_total_bytes": 31550000000u64
        });
        let sessions = json!([{
            "process_name": "C:\\Users\\kuya\\AppData\\game.exe",
            "avg_fps": 141.2, "low1_fps_est": 118.0, "duration_secs": 2400
        }]);
        let ledger = json!([{ "rec_id": "C:\\Users\\kuya\\game-dvr-off", "status": "applied", "is_still_active": true }]);
        let p = build_receipt_payload(&hardware, &sessions, &ledger).expect("session present");
        let serialized = serde_json::to_string(&p).expect("serializes");
        assert!(!serialized.contains("kuya"), "username leaked: {serialized}");
        assert!(!serialized.to_lowercase().contains("users"), "path leaked: {serialized}");
        assert!(!serialized.contains('\\') && !serialized.contains('/'), "separator leaked: {serialized}");
        assert!(serialized.contains("\"game\":\"game\""), "basename survives sanitization");
        assert!(serialized.contains("radeon rx 9070 xt"), "model class survives");
    }

    #[test]
    fn payload_buckets_never_carry_exact_values() {
        let hardware = json!({ "gpus": [{ "name": "GeForce RTX 3060 Ti" }], "cpu_arch": { "family_label": "Core i7" }, "ram_total_bytes": 17110000000u64 });
        let sessions = json!([{ "process_name": "game.exe", "avg_fps": 100.0, "low1_fps_est": 80.0, "duration_secs": 2400 }]);
        let p = build_receipt_payload(&hardware, &sessions, &json!([])).expect("present");
        let s = serde_json::to_string(&p).expect("serializes");
        assert!(s.contains("\"ram_gb_bucket\":\"9-16\""));
        assert!(s.contains("\"duration_bucket\":\"30-60min\""));
        assert!(!s.contains("17110000000"), "exact bytes must never serialize");
        assert!(!s.contains("2400"), "exact seconds must never serialize");
        assert!(s.contains("\"gpu_vendor\":\"nvidia\""));
    }

    #[test]
    fn only_active_applied_changes_contribute_ids() {
        let sessions = json!([{ "process_name": "g.exe", "avg_fps": 1.0, "low1_fps_est": 1.0, "duration_secs": 60 }]);
        let ledger = json!([
            { "rec_id": "hags", "status": "applied", "is_still_active": true },
            { "rec_id": "game-dvr-off", "status": "rolled_back", "is_still_active": false },
            { "rec_id": "power-plan", "status": "applied", "is_still_active": false }
        ]);
        let p = build_receipt_payload(&json!({}), &sessions, &ledger).expect("present");
        assert_eq!(p.outcome.active_change_ids, vec!["hags"]);
    }

    // ---- Appended boundary coverage (TEST-ONLY) ----
    // The sanitize_token / ram_gb_bucket / gpu_vendor_token unit tests moved to `hw_class.rs`
    // with their functions (Q9b contract §4). duration_bucket is Tier-2-specific and stays.

    #[test]
    fn duration_bucket_none_is_unknown() {
        assert_eq!(duration_bucket(None), "unknown");
    }

    #[test]
    fn duration_bucket_boundaries_are_labels_never_exact_seconds() {
        // Cutoffs (secs): 0..=899 | 900..=1799 | 1800..=3599 | 3600..=10799 | 10800+.
        assert_eq!(duration_bucket(Some(0)), "<15min");
        assert_eq!(duration_bucket(Some(899)), "<15min"); // just below 15min
        assert_eq!(duration_bucket(Some(900)), "15-30min"); // exactly 15min
        assert_eq!(duration_bucket(Some(1799)), "15-30min");
        assert_eq!(duration_bucket(Some(1800)), "30-60min"); // exactly 30min
        assert_eq!(duration_bucket(Some(3599)), "30-60min");
        assert_eq!(duration_bucket(Some(3600)), "1-3h"); // exactly 60min
        assert_eq!(duration_bucket(Some(10799)), "1-3h");
        assert_eq!(duration_bucket(Some(10800)), "3h+"); // exactly 3h
        assert_eq!(duration_bucket(Some(36000)), "3h+");
    }

    #[test]
    fn duration_bucket_returns_a_label_never_raw_seconds() {
        const LABELS: &[&str] = &["unknown", "<15min", "15-30min", "30-60min", "1-3h", "3h+"];
        for secs in [None, Some(120u64), Some(2400), Some(7200), Some(99999)] {
            let label = duration_bucket(secs);
            assert!(LABELS.contains(&label.as_str()), "unexpected duration label: {label}");
            if let Some(s) = secs {
                assert!(!label.contains(&s.to_string()), "exact seconds leaked: {label}");
            }
        }
    }

    // ---- The send path (Q9a): consent, refusal order, persistence ----

    /// Told, and said yes. Both halves are needed for a send, which is the point of the type.
    fn opted_in() -> ConsentState {
        ConsentState { disclosed_at: Some("2026-08-25T00:00:00Z".into()), enabled: Some(true) }
    }

    #[test]
    fn a_dark_build_refuses_before_it_reads_anything_about_the_user() {
        // The gate is asked first and answers alone. Even a fully disclosed, explicitly enabled
        // user gets Dark, because in a dark build there is nothing for consent to consent TO.
        let keen = ConsentState { disclosed_at: Some("2026-08-25T00:00:00Z".into()), enabled: Some(true) };
        assert_eq!(send_decision(false, &keen), Err(SendRefusal::Dark));
        assert_eq!(send_decision(false, &ConsentState::default()), Err(SendRefusal::Dark));
    }

    #[test]
    fn sharing_is_opt_in_and_a_fresh_install_shares_nothing() {
        // The owner's 2026-08-24 ruling (#207), as an assertion rather than a paragraph: default
        // OFF, and it stays OFF after arming, because the shipped description and the public
        // download page already promise "No telemetry". A fresh install has made no choice, and
        // no-choice is a NO.
        let fresh = ConsentState::default();
        assert!(!fresh.is_on(), "silence is not consent");
        assert!(!fresh.is_disclosed());
        // Even fully disclosed and armed, an unanswered prompt still shares nothing.
        let told_but_undecided =
            ConsentState { disclosed_at: Some("2026-08-25T00:00:00Z".into()), enabled: None };
        assert_eq!(send_decision(true, &told_but_undecided), Err(SendRefusal::NotOptedIn));
    }

    #[test]
    fn the_off_switch_is_real_and_is_not_a_one_way_door() {
        assert_eq!(send_decision(true, &opted_in()), Ok(()), "told, and said yes");
        let off = ConsentState { enabled: Some(false), ..opted_in() };
        assert_eq!(send_decision(true, &off), Err(SendRefusal::NotOptedIn));
        // Back on again — a switch the user can only ever flip once is not an off switch.
        let on_again = ConsentState { enabled: Some(true), ..off };
        assert_eq!(send_decision(true, &on_again), Ok(()));
    }

    #[test]
    fn refusal_order_is_gate_then_disclosure_then_switch() {
        // Each earlier reason MASKS the later ones. That ordering is the thing being tested: it is
        // why a dark build never touches the consent file, and why an undisclosed user is refused
        // for the honest reason rather than for the switch they were never shown.
        let undisclosed_and_off = ConsentState { disclosed_at: None, enabled: Some(false) };
        assert_eq!(send_decision(false, &undisclosed_and_off), Err(SendRefusal::Dark));
        assert_eq!(send_decision(true, &undisclosed_and_off), Err(SendRefusal::NotYetDisclosed));
    }

    #[test]
    fn may_send_now_refuses_in_this_build() {
        // The live wiring, not the pure function: whatever is on this machine's disk right now, a
        // build with the gate down refuses. This is the assertion that would fail the day somebody
        // flips receipts_gate() without doing the arming work.
        assert_eq!(may_send_now(), Err(SendRefusal::Dark));
    }

    #[test]
    fn the_session_finalize_hook_is_inert_while_dark() {
        // sessions::save_session calls this on every finalized session. It must be safe to call
        // with no tauri async runtime present at all -- which is exactly what a unit test is. If
        // this ever spawns, this test panics rather than the owner's app.
        on_session_finalized();
        on_session_finalized();
    }

    #[test]
    fn a_corrupt_or_missing_consent_file_can_silence_sharing_but_never_start_it() {
        let dir = std::env::temp_dir().join(format!("compy-consent-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();

        let missing = dir.join("nope.json");
        assert_eq!(load_consent_from(&missing), ConsentState::default());
        assert_eq!(send_decision(true, &load_consent_from(&missing)), Err(SendRefusal::NotYetDisclosed));

        let corrupt = dir.join("corrupt.json");
        std::fs::write(&corrupt, "{ this is not json").unwrap();
        assert_eq!(load_consent_from(&corrupt), ConsentState::default());
        assert_eq!(send_decision(true, &load_consent_from(&corrupt)), Err(SendRefusal::NotYetDisclosed));

        // A file that parses but was truncated mid-write reads as default too -- which is why the
        // save below is temp-then-rename and never an in-place write.
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn consent_round_trips_and_leaves_no_temp_file_behind() {
        let dir = std::env::temp_dir().join(format!("compy-consent-rt-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("receipts-consent.json");

        let state = ConsentState { disclosed_at: Some("2026-08-25T12:00:00Z".into()), enabled: Some(false) };
        save_consent_to(&path, &state).expect("saves");
        assert_eq!(load_consent_from(&path), state);
        assert!(!path.with_extension("json.tmp").exists(), "the temp file is renamed, not left");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_endpoint_is_one_https_constant_and_the_ui_reads_that_same_one() {
        // The disclosure names a host. This pins that it is the host the code would actually post
        // to, not a second string that can drift away from it.
        assert_eq!(get_receipts_endpoint(), RECEIPTS_ENDPOINT);
        assert!(RECEIPTS_ENDPOINT.starts_with("https://"), "never plaintext");
        assert!(RECEIPTS_ENDPOINT.ends_with("/api/usage"), "the Tier 2 receiver, not some other one");
        // Tier 3 is a separate endpoint with separate consent; sharing one would merge them.
        assert!(!RECEIPTS_ENDPOINT.contains("evidence"));
        assert!(!RECEIPTS_ENDPOINT.contains("waitlist"), "Tier 2 never touches the identified table");
    }

    #[test]
    fn the_payload_that_would_be_sent_is_the_payload_the_user_can_preview() {
        // One builder feeds both `preview_receipt_payload` and `send_receipt_if_allowed`. If they
        // were two, "inspect your receipt" would be showing a receipt nobody sends.
        let hardware = json!({ "gpus": [{ "name": "Radeon RX 9070 XT" }], "cpu_arch": { "family_label": "Ryzen X3D" }, "ram_total_bytes": 31_550_000_000u64 });
        let sessions = json!([{ "process_name": "game.exe", "avg_fps": 141.2, "low1_fps_est": 118.0, "duration_secs": 2400 }]);
        let built = build_receipt_payload(&hardware, &sessions, &json!([])).expect("session present");
        let wire = serde_json::to_string(&built).expect("serializes");
        // Every field the receiver validates is present, and nothing else is.
        let as_map: serde_json::Value = serde_json::from_str(&wire).unwrap();
        // serde_json parses objects into a BTreeMap, so the keys come back sorted rather than in
        // declaration order — sort the expectation too instead of asserting an ordering the wire
        // format does not actually have.
        let mut top: Vec<&str> = as_map.as_object().unwrap().keys().map(String::as_str).collect();
        top.sort_unstable();
        assert_eq!(top, vec!["hw_class", "outcome", "schema_version"], "no field creeps onto the wire");
    }

    #[test]
    fn a_refusal_is_never_a_transport_failure() {
        // They are different outcomes and the type keeps them different: a refusal is our own
        // decision and is final; a transport failure is the network's and is simply dropped.
        let refused: SendError = SendRefusal::NotOptedIn.into();
        assert_eq!(refused, SendError::Refused(SendRefusal::NotOptedIn));
        assert_ne!(refused, SendError::Transport("connection reset".into()));
    }
}
