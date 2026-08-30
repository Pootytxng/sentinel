//! Tier-neutral pure hardware-class helpers — the §4 extraction the Q9b Tier 3 contract names
//! (`docs/superpowers/specs/2026-08-29-q9b-tier3-case-evidence-contract.md` §4, "Hardware-class
//! alignment"). These three functions began life in `receipts.rs` (Tier 2) and moved here verbatim
//! so Tier 3 can share the exact same closed vocabularies without ever importing a tier module —
//! alignment by construction instead of by parity test. Tier 3 is named by TIER and never by module
//! path, here and below: the separation guard reads every byte of this file, comments included, so
//! spelling that module's name in a comment would read as a reach into it (#266).
//!
//! THE RULE THIS MODULE LIVES UNDER: it imports NO tier module (`support_evidence`, `receipts`,
//! `case_intelligence`, Tier 3, `remote_rules`) and carries no consent, gate,
//! transport, or payload state — pure string/number classification only. Pinned by
//! `src/case-evidence-tier-separation-guard.test.ts`.

/// Path-impossible by construction: keep only the final path component, strip a trailing
/// `.exe`, lowercase. A username embedded in `C:\Users\<name>\game.exe` cannot survive.
pub(crate) fn sanitize_token(s: &str) -> String {
    let base = s.rsplit(['\\', '/']).next().unwrap_or(s);
    let base = base.strip_suffix(".exe").or_else(|| base.strip_suffix(".EXE")).unwrap_or(base);
    base.trim().to_lowercase()
}

/// Bucketed, never exact — exact byte counts could fingerprint unusual rigs.
pub(crate) fn ram_gb_bucket(bytes: Option<u64>) -> String {
    let Some(b) = bytes else { return "unknown".into() };
    let gb = (b as f64 / 1024f64.powi(3)).round() as u64;
    match gb {
        0..=8 => "0-8",
        9..=16 => "9-16",
        17..=24 => "17-24",
        25..=32 => "25-32",
        33..=64 => "33-64",
        _ => "64+",
    }
    .into()
}

/// Vendor token from the GPU retail name — same heuristic family the UI uses.
pub(crate) fn gpu_vendor_token(name: &str) -> &'static str {
    let n = name.to_lowercase();
    if n.contains("radeon") || n.contains("amd") {
        "amd"
    } else if n.contains("nvidia") || n.contains("geforce") || n.contains("rtx") || n.contains("gtx") {
        "nvidia"
    } else if n.contains("intel") || n.contains("arc") {
        "intel"
    } else {
        "other"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Helper: exact whole-GiB byte count so the internal `.round()` is unambiguous.
    fn gib(n: u64) -> Option<u64> {
        Some(n * 1024 * 1024 * 1024)
    }

    #[test]
    fn ram_gb_bucket_none_is_unknown() {
        assert_eq!(ram_gb_bucket(None), "unknown");
    }

    #[test]
    fn ram_gb_bucket_boundaries_round_to_labels_never_exact_gb() {
        // Cutoffs (rounded GB): 0..=8 | 9..=16 | 17..=24 | 25..=32 | 33..=64 | 64+.
        // Probe just-below / just-above each whole-GiB cutoff.
        assert_eq!(ram_gb_bucket(gib(0)), "0-8");
        assert_eq!(ram_gb_bucket(gib(8)), "0-8"); // top of first band
        assert_eq!(ram_gb_bucket(gib(9)), "9-16"); // just above
        assert_eq!(ram_gb_bucket(gib(16)), "9-16");
        assert_eq!(ram_gb_bucket(gib(17)), "17-24");
        assert_eq!(ram_gb_bucket(gib(24)), "17-24");
        assert_eq!(ram_gb_bucket(gib(25)), "25-32");
        assert_eq!(ram_gb_bucket(gib(32)), "25-32");
        assert_eq!(ram_gb_bucket(gib(33)), "33-64");
        assert_eq!(ram_gb_bucket(gib(64)), "33-64");
        assert_eq!(ram_gb_bucket(gib(65)), "64+");
        assert_eq!(ram_gb_bucket(gib(128)), "64+");
    }

    #[test]
    fn ram_gb_bucket_returns_a_label_never_a_raw_byte_or_gb_number() {
        // Privacy contract: the bucket string must be one of the fixed labels, never
        // an exact GB count (e.g. "31") or the raw byte count.
        const LABELS: &[&str] = &["unknown", "0-8", "9-16", "17-24", "25-32", "33-64", "64+"];
        for bytes in [None, gib(4), gib(15), gib(31), Some(31_550_000_000u64), gib(200)] {
            let label = ram_gb_bucket(bytes);
            assert!(LABELS.contains(&label.as_str()), "unexpected ram label: {label}");
            if let Some(b) = bytes {
                assert!(!label.contains(&b.to_string()), "exact byte count leaked: {label}");
            }
        }
    }

    #[test]
    fn ram_gb_bucket_rounds_half_gib_at_band_edge() {
        // FINDING: the band match is on `.round()`ed GiB, so a ~8.5 GiB rig rounds UP into
        // the "9-16" band rather than staying in "0-8". Assert the rounding reality.
        let eight_point_six = Some((8.6f64 * 1024f64 * 1024f64 * 1024f64) as u64);
        assert_eq!(ram_gb_bucket(eight_point_six), "9-16");
        let eight_point_four = Some((8.4f64 * 1024f64 * 1024f64 * 1024f64) as u64);
        assert_eq!(ram_gb_bucket(eight_point_four), "0-8");
    }

    #[test]
    fn gpu_vendor_token_recognizes_each_vendor_and_unknowns() {
        assert_eq!(gpu_vendor_token("NVIDIA GeForce RTX 4090"), "nvidia");
        assert_eq!(gpu_vendor_token("GeForce GTX 1660"), "nvidia");
        assert_eq!(gpu_vendor_token("AMD Radeon RX 9070 XT"), "amd");
        assert_eq!(gpu_vendor_token("Radeon Pro W6800"), "amd");
        assert_eq!(gpu_vendor_token("Intel Arc A770"), "intel");
        assert_eq!(gpu_vendor_token("Intel UHD Graphics 770"), "intel");
        assert_eq!(gpu_vendor_token("Matrox Millennium G550"), "other");
        assert_eq!(gpu_vendor_token(""), "other");
    }

    #[test]
    fn gpu_vendor_token_is_case_insensitive() {
        assert_eq!(gpu_vendor_token("radeon rx 9070 xt"), "amd");
        assert_eq!(gpu_vendor_token("nvidia geforce"), "nvidia");
        assert_eq!(gpu_vendor_token("INTEL ARC"), "intel");
    }

    #[test]
    fn gpu_vendor_token_amd_wins_when_multiple_vendors_appear() {
        // FINDING: the amd/radeon arm is checked FIRST, so a name carrying both vendor
        // words resolves to "amd" by precedence (not a tie / not "other").
        assert_eq!(gpu_vendor_token("Radeon paired with NVIDIA bridge"), "amd");
        assert_eq!(gpu_vendor_token("AMD + Intel hybrid"), "amd");
    }

    #[test]
    fn gpu_vendor_token_arc_substring_is_a_broad_match() {
        // FINDING: "arc" is a substring test, so unrelated names containing the letters
        // "arc" classify as Intel. Asserting reality, not endorsing it.
        assert_eq!(gpu_vendor_token("Sun Sparc Framebuffer"), "intel");
    }

    #[test]
    fn sanitize_token_strips_windows_path_keeping_basename() {
        assert_eq!(sanitize_token("C:\\Users\\kuya\\AppData\\game.exe"), "game");
        assert_eq!(sanitize_token("C:/Users/kuya/game.exe"), "game");
    }

    #[test]
    fn sanitize_token_strips_exe_suffix_either_case() {
        assert_eq!(sanitize_token("Game.EXE"), "game");
        assert_eq!(sanitize_token("GAME.exe"), "game");
        // Only a single trailing .exe/.EXE is stripped; an interior extension is kept.
        assert_eq!(sanitize_token("foo.exe.exe"), "foo.exe");
    }

    #[test]
    fn sanitize_token_trims_and_lowercases() {
        assert_eq!(sanitize_token("  Counter-Strike  "), "counter-strike");
        // Leading/trailing whitespace (incl. tab/newline) is trimmed by trim().
        assert_eq!(sanitize_token("\tDoom\n"), "doom");
    }

    #[test]
    fn sanitize_token_neutralizes_username_segment() {
        // The username only ever appears as an interior path segment; keeping the basename
        // drops it entirely.
        assert_eq!(sanitize_token("C:\\Users\\SomeRealName\\valorant.exe"), "valorant");
        let out = sanitize_token("/home/realuser/.local/share/Steam/game.exe");
        assert!(!out.contains("realuser"), "username leaked: {out}");
        assert_eq!(out, "game");
    }

    #[test]
    fn sanitize_token_empty_and_separator_only_inputs() {
        assert_eq!(sanitize_token(""), "");
        // Trailing-separator input: rsplit yields an empty final component.
        assert_eq!(sanitize_token("C:\\Users\\kuya\\"), "");
    }

    #[test]
    fn sanitize_token_does_not_strip_interior_control_chars() {
        // FINDING: sanitize_token keeps the basename, strips a trailing .exe, trims edges,
        // and lowercases — but it does NOT remove INTERIOR control characters. A NUL or
        // other control byte embedded mid-token survives. This is not a path/username leak
        // (those are handled), but the token is not guaranteed control-char-clean. Reported,
        // not fixed (TEST-ONLY).
        //
        // Tier 3's `family_token` adds that hardening on top **for Group B family tokens only**
        // (`app_family` / `module_family`). Group C's `gpu_model` / `cpu_family` call this
        // function directly through `hw_context_from`, with no such refusal — narrowed here
        // after the 2026-08-29 security review (finding S4) caught this comment implying it
        // covered every caller. What actually reaches the wire from Group C is pinned by
        // `adversarial_hardware_probe_strings_reach_the_wire_safely` in the Tier 3 module.
        assert_eq!(sanitize_token("ga\u{0}me"), "ga\u{0}me");
        assert_eq!(sanitize_token("a\u{7}b"), "a\u{7}b");
    }
}
