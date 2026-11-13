//! Compy Care Tier 3 (Q9b, #252) — explicit per-case evidence upload. **STAGE 1 ONLY.**
//!
//! Contract: `docs/superpowers/specs/2026-08-29-q9b-tier3-case-evidence-contract.md`. This module
//! is the §11 Stage 1 slice and nothing past it: payload/schema types (the §2 allowlist AS a
//! struct), pure producers/classifiers, Tier 3's own free-text redaction, ONE canonical
//! serializer, and a pure preview representation. It contains NO Tauri command, NO HTTP client,
//! NO endpoint constant, NO send/retry/queue state, NO consent state, and NO deletion client —
//! those live at later stages behind their own proof boundaries (a dark send command is Stage 4,
//! never Stage 1). `case_evidence_gate()` below is a hard-false constant nothing calls through.
//!
//! **The struct is the allowlist** (§2): `CasePayload` has exactly the fields the contract names,
//! serde refuses unknown fields on round-trip, and `case_payload_json` is the only path to bytes.
//! A field that is not in the struct cannot leave the machine, structurally.
//!
//! **Module separation** (§4): this file must never import `support_evidence` (local-only store),
//! `receipts` (Tier 2), `case_intelligence` (Tier 1), or `remote_rules` (privileged trust
//! domain). The one permitted sharing is `hw_class` — tier-neutral pure classification helpers
//! extracted from Tier 2 so the §2C vocabularies stay aligned by construction. The redactor below
//! is therefore a deliberate DUPLICATE of `support_evidence`'s classes (`<user>` `<host>` `<path>`
//! `<ip>` `<key>` `<serial>`), not an import of them. Pinned by
//! `src/case-evidence-tier-separation-guard.test.ts` and the tier block of
//! `src/support-evidence-outbound-guard.test.ts`.
#![allow(dead_code)] // Stage 1 is built dark: pure payload logic wired to nothing. The preview UI
                     // (Stage 2) and the gate-refusing send command (Stage 4) arrive as their own
                     // reviewed stages; until then only this module's tests call into it.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::blackbox::{Incident, IncidentKind};
use crate::hw_class::{gpu_vendor_token, ram_gb_bucket, sanitize_token};

/// The receiver refuses any other version (§5); bumping it is a schema change with its own review.
pub(crate) const CASE_SCHEMA_VERSION: u32 = 1;

/// §2A: the one free-text field is bounded at 2,000 bytes of UTF-8, post-redaction.
const MAX_COMMENT_BYTES: usize = 2000;
/// §2B: family tokens (app/module) are capped at 64 characters.
const MAX_FAMILY_TOKEN_CHARS: usize = 64;
/// §2B: an error/bugcheck code token is capped at 32 characters.
const MAX_ERROR_CODE_CHARS: usize = 32;
/// §2C: Windows build token ≤16 chars; GPU driver version token ≤32 chars.
const MAX_WINDOWS_BUILD_CHARS: usize = 16;
const MAX_DRIVER_VERSION_CHARS: usize = 32;

// ---------------------------------------------------------------------------
// Gate — hard-false, uncalled (Stage 1)
// ---------------------------------------------------------------------------

/// HARD-FALSE gate, the `receipts_gate`/`case_intelligence_gate` pattern. Flips only at Stage 9
/// (a separate owner arming decision in a later release, with the §10 disclosure inventory in the
/// same release). At Stage 1 NOTHING calls through this — the send command that must consult it
/// FIRST does not exist until Stage 4, and building that command is its own reviewed stage.
pub(crate) fn case_evidence_gate() -> bool {
    false
}

// ---------------------------------------------------------------------------
// The §2 allowlist, as a struct
// ---------------------------------------------------------------------------

/// §2B closed vocabulary — the five wire values a case may name as its failure class. Wire tokens
/// are pinned by serde renames; anything else fails deserialization, client and server alike.
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CaseIncidentKind {
    #[serde(rename = "app-crash")]
    AppCrash,
    #[serde(rename = "app-hang")]
    AppHang,
    #[serde(rename = "gpu-timeout")]
    GpuTimeout,
    /// BSOD and WHEA machine-check collapse to one class on the wire (§2B: "BSOD-WHEA") — the
    /// distinction support needs survives in `error_code`, not in a wider vocabulary.
    #[serde(rename = "bsod-whea")]
    BsodWhea,
    #[serde(rename = "unexpected-restart")]
    UnexpectedRestart,
}

/// Schema v1 — **exactly the §2 Group A–C fields and no others.** `deny_unknown_fields` makes an
/// extra key a parse error in both directions; the exhaustive-destructure test below makes a new
/// field a COMPILE error until it is added here and in the contract. Optional fields are omitted
/// from the wire entirely when absent (the preview shows exactly what will travel — no nulls).
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(deny_unknown_fields)]
pub(crate) struct CasePayload {
    // Group C required constants
    schema_version: u32,
    compy_version: String,
    // Group A — the ONLY free-text field in the schema, already redacted at construction
    #[serde(skip_serializing_if = "Option::is_none")]
    user_comment: Option<String>,
    // Group B — one incident's normalized evidence (journey B only)
    #[serde(skip_serializing_if = "Option::is_none")]
    incident_kind: Option<CaseIncidentKind>,
    #[serde(skip_serializing_if = "Option::is_none")]
    occurred_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    app_family: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    module_family: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error_code: Option<String>,
    // Group C — optional support context (hardware block removable as one unit)
    #[serde(skip_serializing_if = "Option::is_none")]
    gpu_vendor: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    gpu_model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cpu_family: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    ram_gb_bucket: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    windows_build: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    gpu_driver_version: Option<String>,
}

// ---------------------------------------------------------------------------
// Free-text redaction (§2A) — Tier 3's own, same classes as Support Evidence's
// ---------------------------------------------------------------------------
// Deliberately DUPLICATED from support_evidence.rs rather than imported: §4 forbids this module
// from reaching the local evidence store in either direction, and a shared "redaction util" module
// would be a fresh corridor between them. Same mask vocabulary, same layering (exact literals +
// structural shapes), independently tested below. Honesty rule (§2A): free-text redaction is
// best-effort by nature and the consent copy must say so — the preview shows what survives.

const MASK_PATH: &str = "<path>";
const MASK_IP: &str = "<ip>";
const MASK_KEY: &str = "<key>";
const MASK_SERIAL: &str = "<serial>";
const MASK_USER: &str = "<user>";
const MASK_HOST: &str = "<host>";

/// §2A pipeline: control characters go first (newline/tab become a space so words don't fuse —
/// the wire carries NO control characters at all), then structural shapes, then this machine's
/// literal identity values, then the byte clamp. The clamp runs LAST on purpose: truncating
/// before redaction could cut a serial below its detector's length threshold and let the
/// remainder travel; truncating a mask's tail leaks nothing.
pub(crate) fn redact_comment(raw: &str) -> String {
    redact_comment_with(raw, &sensitive_literals())
}

/// The same pipeline with the identity literals injected, so tests never mutate process env.
fn redact_comment_with(raw: &str, literals: &[(String, &'static str)]) -> String {
    let flat = flatten_input(raw);
    let mut out = mask_paths(&flat);
    out = mask_ips(&out);
    out = mask_keys(&out);
    out = mask_serials(&out);
    for (value, mask) in literals {
        out = replace_ignore_case(&out, value, mask);
    }
    clamp_bytes(out.trim(), MAX_COMMENT_BYTES)
}

/// Values that identify *this* machine and *this* user, read from the environment.
fn sensitive_literals() -> Vec<(String, &'static str)> {
    let mut out = Vec::new();
    for (var, mask) in [("USERNAME", MASK_USER), ("USERDOMAIN", MASK_HOST), ("COMPUTERNAME", MASK_HOST)] {
        if let Ok(value) = std::env::var(var) {
            // A one- or two-character name would match half the alphabet inside ordinary words.
            if value.chars().count() >= 3 {
                out.push((value, mask));
            }
        }
    }
    out
}

/// Everything that reaches a detector goes through here first, so that what the detectors match
/// on is what a human actually SEES. Three passes, all of them about that one idea:
///
/// 1. **Control characters (Cc).** Newline/tab/return become a space so words don't fuse; every
///    other control character is dropped. The wire carries no control characters at all.
/// 2. **Invisible formatting (Cf + Default_Ignorable) — dropped outright.** This is the security
///    review's blocking finding S1 (2026-08-29). `char::is_control()` is Cc ONLY, so a single
///    U+200B ZERO WIDTH SPACE inside a username, hostname, IP octet, product key or serial used to
///    defeat every exact-match detector below — `replace_ignore_case` searches for an unbroken
///    substring, `is_ipv4` needs each octet to be <=3 ASCII digits, and the key/serial scanners
///    need every character to be `is_ascii_alphanumeric()`. The comment then rendered identically
///    to the un-obfuscated text while carrying the real value through unmasked. ZWSP is not
///    exotic: it survives an ordinary copy out of a browser, a chat client or a PDF. Dropping
///    (rather than spacing) is deliberate — the character is invisible, so the text either side of
///    it already reads as one word, and fusing is what a reader sees.
/// 3. **Full-width ASCII (U+FF01-U+FF5E) folded to ASCII.** Same class, visible variant: `１９２`
///    is not `is_ascii_digit`, and `ｋｕｙａ` does not match `kuya`. The block maps to ASCII by
///    subtraction, so this is a fold and not a normalization library.
///
/// **The known cosmetic cost, named rather than discovered later:** U+200D ZERO WIDTH JOINER sits
/// in that range and has to — it is Cf and exactly as invisible as ZWSP — but it is also what welds
/// an emoji sequence together, so a flag or a family emoji comes through this pass as its separate
/// glyphs. Nothing identifying leaks and no character is corrupted; the comment simply renders less
/// prettily than it was typed. Sequence-aware emoji parsing on a deliberately dependency-free
/// security path is not worth that, so the cost is pinned by test rather than paid.
///
/// **The residual limit, stated rather than hidden:** mixed-script homoglyphs (Cyrillic `а` for
/// Latin `a`) still defeat an exact match, and closing that needs a confusables table this module
/// deliberately does not carry. That is exactly why §2A calls free-text redaction best-effort and
/// why the consent copy must say so — the preview shows what actually survived.
fn flatten_input(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for c in input.chars() {
        if c == '\n' || c == '\r' || c == '\t' {
            out.push(' ');
        } else if c.is_control() || is_invisible_format(c) {
            // Dropped. Controls other than the three above carry no reader-visible text either.
        } else {
            out.push(fold_full_width(c));
        }
    }
    out
}

/// Unicode category **Cf** (format) plus the non-Cf members of **Default_Ignorable_Code_Point** —
/// characters a text renderer is entitled to draw as nothing. `std` exposes no general-category
/// API, and this module deliberately carries no dependency for a security-sensitive path, so the
/// ranges are written out. Assigned as of Unicode 15.1; an unassigned code point inside a
/// Default_Ignorable range is included on purpose, since a future assignment stays invisible.
///
/// **Independent review, 2026-08-29 (#259/#260):** the reviewer compiled these arms into a
/// predicate and swept all of 0..0x10FFFF against Unicode 16.0. Category Cf came back complete,
/// 0 missing. Default_Ignorable did NOT: `0x180E` was written as a single value, so the four
/// MONGOLIAN FREE VARIATION SELECTORs beside it — `180B`, `180C`, `180D`, `180F`, category Mn,
/// combining class 0, zero advance width — were dropped from neither pass. `ku\u{180B}ya` would
/// have walked a username past `replace_ignore_case` exactly the way U+200B did. Now the whole
/// `180B..=180F` range is covered. The sweep is the guard here, not a reading of this list: a
/// hand-written table is only as good as the last exhaustive check against real Unicode data.
///
/// **Documented residual, deliberately NOT stripped:** U+2800 BRAILLE PATTERN BLANK — and the
/// second review pass corrected the REASON, which is worth keeping straight. It is not the same
/// case as U+00A0 and the Zs spaces: those are `White_Space`, so `map_tokens` already breaks a
/// token on them and the code agrees with what the reader sees. U+2800 is category So and NOT
/// `White_Space`, so a value with one embedded stays ONE unrecognized token and escapes detection
/// by exactly the mechanism ZWSP used. It is still left alone, for a different reason than the one
/// written here before: ZWSP, ZWNJ, the bidi marks and the variation selectors ride in on an
/// ordinary copy-paste out of a browser, a chat client or a PDF, which is what makes the promise
/// "we screen your comment" fail INCIDENTALLY, to a user who did nothing wrong. U+2800 does not —
/// inside a username or an address it arrives only by deliberate self-obfuscation, and stripping a
/// character a renderer DRAWS would hand back text the user never typed. The reviewer recommended
/// stripping it anyway as a cheap one-line arm; that disagreement is recorded here rather than
/// settled quietly. Pinned by test with the homoglyph limit, so it can only change deliberately.
fn is_invisible_format(c: char) -> bool {
    matches!(
        c as u32,
        0x00AD                      // SOFT HYPHEN
            | 0x034F                // COMBINING GRAPHEME JOINER
            | 0x061C                // ARABIC LETTER MARK
            | 0x06DD                // ARABIC END OF AYAH
            | 0x070F                // SYRIAC ABBREVIATION MARK
            | 0x08E2                // ARABIC DISPUTED END OF AYAH
            | 0x3164                // HANGUL FILLER
            | 0xFEFF                // ZERO WIDTH NO-BREAK SPACE / BOM
            | 0xFFA0                // HALFWIDTH HANGUL FILLER
            | 0x0600..=0x0605       // Arabic number signs
            | 0x0890..=0x0891       // Arabic pound/piastre marks
            | 0x115F..=0x1160       // HANGUL CHOSEONG/JUNGSEONG FILLER
            | 0x17B4..=0x17B5       // KHMER VOWEL INHERENT AQ/AA
            | 0x180B..=0x180F       // MONGOLIAN free variation selectors + vowel separator
            | 0x200B..=0x200F       // ZWSP, ZWNJ, ZWJ, LRM, RLM
            | 0x202A..=0x202E       // bidi embedding / override
            | 0x2060..=0x206F       // word joiner, invisible operators, bidi isolates, deprecated
            | 0xFE00..=0xFE0F       // variation selectors
            | 0xFFF0..=0xFFF8       // unassigned Default_Ignorable
            | 0xFFF9..=0xFFFB       // interlinear annotation
            | 0x110BD               // KAITHI NUMBER SIGN
            | 0x110CD               // KAITHI NUMBER SIGN ABOVE
            | 0x13430..=0x1343F     // Egyptian hieroglyph format controls
            | 0x1BCA0..=0x1BCA3     // shorthand format controls
            | 0x1D173..=0x1D17A     // musical format controls
            | 0xE0000..=0xE0FFF     // language tag + tag characters + variation selectors suppl.
    )
}

/// `Ａ` -> `A`, `１` -> `1`, `．` -> `.`. The FULLWIDTH FORMS block is a straight +0xFEE0 offset
/// from printable ASCII, so the fold is subtraction rather than a normalization table.
fn fold_full_width(c: char) -> char {
    match c as u32 {
        code @ 0xFF01..=0xFF5E => char::from_u32(code - 0xFEE0).unwrap_or(c),
        _ => c,
    }
}

fn replace_ignore_case(haystack: &str, needle: &str, mask: &str) -> String {
    if needle.is_empty() {
        return haystack.to_string();
    }
    // Char-accurate case-insensitive search. Lowercasing can change a character's byte length
    // (İ, ẞ), so the lowered copy carries a byte-by-byte map back to the original offsets — an
    // earlier draft bailed out on any length change, which let ONE such character anywhere in the
    // comment disable identity masking for the whole message (review finding, 2026-08-29).
    let needle_lower: String = needle.chars().flat_map(char::to_lowercase).collect();
    let mut hay_lower = String::with_capacity(haystack.len());
    let mut back: Vec<usize> = Vec::with_capacity(haystack.len() + 1);
    for (orig_idx, c) in haystack.char_indices() {
        for lc in c.to_lowercase() {
            let start = hay_lower.len();
            hay_lower.push(lc);
            for _ in start..hay_lower.len() {
                back.push(orig_idx);
            }
        }
    }
    back.push(haystack.len());

    let mut out = String::with_capacity(haystack.len());
    let mut low_cursor = 0usize;
    let mut orig_cursor = 0usize;
    while let Some(hit) = hay_lower[low_cursor..].find(&needle_lower) {
        let low_at = low_cursor + hit;
        let low_end = low_at + needle_lower.len();
        let orig_at = back[low_at];
        let orig_end = back[low_end].max(orig_at);
        out.push_str(&haystack[orig_cursor..orig_at.max(orig_cursor)]);
        out.push_str(mask);
        low_cursor = low_end;
        orig_cursor = orig_end.max(orig_cursor);
    }
    out.push_str(&haystack[orig_cursor..]);
    out
}

fn mask_paths(input: &str) -> String {
    let chars: Vec<char> = input.chars().collect();
    let mut out = String::with_capacity(input.len());
    let mut i = 0;
    while i < chars.len() {
        match path_run(&chars, i) {
            Some(end) => {
                out.push_str(MASK_PATH);
                i = end;
            }
            None => {
                out.push(chars[i]);
                i += 1;
            }
        }
    }
    out
}

/// The index one past the end of a filesystem path starting at `i`, or `None` if none starts there.
fn path_run(chars: &[char], i: usize) -> Option<usize> {
    let root = path_root_len(chars, i)?;
    let mut j = i + root;
    loop {
        while j < chars.len() && !chars[j].is_whitespace() {
            j += 1;
        }
        // `C:\Program Files\Compy` — a single space belongs to the path only when the run after it
        // still carries a separator. That absorbs real spaced paths while stopping at prose.
        if j < chars.len() && chars[j] == ' ' {
            let start = j + 1;
            let mut end = start;
            while end < chars.len() && !chars[end].is_whitespace() {
                end += 1;
            }
            if end > start && chars[start..end].iter().any(|c| *c == '\\' || *c == '/') {
                j = end;
                continue;
            }
        }
        break;
    }
    Some(j)
}

/// How many characters the path *root* at `i` occupies: `C:\`, `\\server`, or `%APPDATA%\`.
fn path_root_len(chars: &[char], i: usize) -> Option<usize> {
    // Only start a path at a token boundary, so `foo C:\x` matches but `abcC:\x` does not.
    if i > 0 && chars[i - 1].is_alphanumeric() {
        return None;
    }
    let sep = |c: char| c == '\\' || c == '/';

    if i + 2 < chars.len() && chars[i].is_ascii_alphabetic() && chars[i + 1] == ':' && sep(chars[i + 2]) {
        return Some(3);
    }
    if i + 1 < chars.len() && chars[i] == '\\' && chars[i + 1] == '\\' {
        return Some(2);
    }
    if chars[i] == '%' {
        if let Some(offset) = chars[i + 1..].iter().position(|c| *c == '%') {
            let after = i + 1 + offset + 1;
            if after < chars.len() && sep(chars[after]) {
                return Some(after - i + 1);
            }
        }
    }
    // Unix-style absolute roots (review finding, 2026-08-29) — a WSL/git-bash/dev-tool path pasted
    // into a comment carries a username just as surely as a drive path does. A bare `/` only
    // counts when the run holds a SECOND slash (`/home/x`), so a command switch like `/v` stays
    // readable; `~/` counts on its own.
    if chars[i] == '~' && i + 1 < chars.len() && chars[i + 1] == '/' {
        return Some(2);
    }
    if chars[i] == '/' && i + 1 < chars.len() && !chars[i + 1].is_whitespace() && chars[i + 1] != '/' {
        let mut k = i + 1;
        while k < chars.len() && !chars[k].is_whitespace() {
            if chars[k] == '/' {
                return Some(1);
            }
            k += 1;
        }
    }
    None
}

/// Replace each whitespace-delimited token for which `matches` holds.
fn map_tokens(input: &str, mask: &str, matches: impl Fn(&str) -> bool) -> String {
    let mut out = String::with_capacity(input.len());
    let mut token = String::new();
    let flush = |out: &mut String, token: &mut String| {
        if !token.is_empty() {
            // Trailing punctuation must not stop a match: "at 10.0.0.4," is still an address.
            let trimmed = token.trim_end_matches(['.', ',', ';', ':', ')', ']', '"', '\'']);
            if !trimmed.is_empty() && matches(trimmed) {
                out.push_str(mask);
                out.push_str(&token[trimmed.len()..]);
            } else {
                out.push_str(token);
            }
            token.clear();
        }
    };
    for c in input.chars() {
        if c.is_whitespace() {
            flush(&mut out, &mut token);
            out.push(c);
        } else {
            token.push(c);
        }
    }
    flush(&mut out, &mut token);
    out
}

fn mask_ips(input: &str) -> String {
    map_tokens(input, MASK_IP, looks_like_address)
}

/// An address pasted from an error dialog rarely arrives bare (review finding, 2026-08-29): it
/// comes with a scheme, a port, a path, or RFC 3986 brackets. Peel those and test what is left;
/// on a hit the WHOLE token is masked, which errs toward hiding more, never less.
fn looks_like_address(token: &str) -> bool {
    let mut t = token;
    if let Some(pos) = t.find("://") {
        t = &t[pos + 3..];
    }
    let t = t.trim_start_matches(['[', '(', '"', '\'']);
    let t = t.split(['/', '?']).next().unwrap_or(t);
    let host = t.split(']').next().unwrap_or(t);
    if is_ipv4(host) || is_ipv6(host) {
        return true;
    }
    // host:port — only meaningful for ipv4; an unbracketed ipv6 IS colons and is handled above.
    if let Some((head, port)) = host.rsplit_once(':') {
        if !port.is_empty() && port.bytes().all(|b| b.is_ascii_digit()) && is_ipv4(head) {
            return true;
        }
    }
    false
}

fn is_ipv4(token: &str) -> bool {
    let parts: Vec<&str> = token.split('.').collect();
    parts.len() == 4
        && parts.iter().all(|p| {
            !p.is_empty() && p.len() <= 3 && p.bytes().all(|b| b.is_ascii_digit()) && p.parse::<u16>().is_ok_and(|n| n <= 255)
        })
}

fn is_ipv6(token: &str) -> bool {
    if !token.chars().all(|c| c.is_ascii_hexdigit() || c == ':') || !token.contains(':') {
        return false;
    }
    // `12:30:00` is a clock, not an address. Demand a `::` elision or at least four groups.
    token.contains("::") || token.split(':').filter(|g| !g.is_empty()).count() >= 4
}

fn mask_keys(input: &str) -> String {
    map_tokens(input, MASK_KEY, |t| {
        let groups: Vec<&str> = t.split('-').collect();
        groups.len() >= 3
            && t.len() >= 12
            && groups.iter().all(|g| g.len() >= 4 && !g.is_empty() && g.chars().all(|c| c.is_ascii_alphanumeric()))
    })
}

fn mask_serials(input: &str) -> String {
    map_tokens(input, MASK_SERIAL, |t| {
        t.len() >= 16
            && t.chars().all(|c| c.is_ascii_alphanumeric())
            && t.chars().any(|c| c.is_ascii_digit())
            && t.chars().any(|c| c.is_ascii_alphabetic())
    })
}

/// Clamp to a byte budget on a char boundary, marking the cut so a truncated comment never reads
/// as a complete one.
fn clamp_bytes(value: &str, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return value.to_string();
    }
    const MARK: &str = "\u{2026}";
    if max_bytes <= MARK.len() {
        // A budget with no room for the mark yields nothing rather than underflowing in release.
        return String::new();
    }
    let budget = max_bytes - MARK.len();
    let mut end = budget;
    while end > 0 && !value.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}{MARK}", &value[..end])
}

// ---------------------------------------------------------------------------
// Pure field producers / validators (§2B, §2C)
// ---------------------------------------------------------------------------

/// §2B family scrub: `hw_class::sanitize_token` (basename, `.exe` strip, lowercase — the Tier 2
/// class) plus the hardening the contract adds on top: no separators, no drive colon, no `@`, no
/// control characters, ≤64 chars. A token that still carries an identity-shaped character after
/// the basename pass is REFUSED, never edited — masking by surgery invites near-miss leaks.
/// Length is the one axis that truncates instead: a shortened family still classifies honestly,
/// where a token edited around an identity character would not.
fn family_token(raw: &str) -> Option<String> {
    let t = sanitize_token(raw);
    if t.is_empty() || t.chars().any(|c| c.is_control() || c == '@' || c == ':' || c == '\\' || c == '/') {
        return None;
    }
    Some(t.chars().take(MAX_FAMILY_TOKEN_CHARS).collect())
}

/// §2B error/bugcheck code: a single lowercase token of `[a-z0-9_-]`, ≤32 chars (covers both
/// `0x`-hex codes and short public names like `appcrash`). Anything else — spaces, paths,
/// overlong — is refused, never trimmed into shape.
fn error_code_token(raw: &str) -> Option<String> {
    let t = raw.trim().to_lowercase();
    if t.is_empty() || t.chars().count() > MAX_ERROR_CODE_CHARS {
        return None;
    }
    if t.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        Some(t)
    } else {
        None
    }
}

/// §2C numeric tokens: digits and dots only, digit at both ends, no empty groups.
fn dotted_numeric_token(raw: &str, max_chars: usize) -> Option<String> {
    let t = raw.trim();
    let count = t.chars().count();
    if count == 0 || count > max_chars {
        return None;
    }
    let all_valid = t.chars().all(|c| c.is_ascii_digit() || c == '.');
    let ends_ok = t.starts_with(|c: char| c.is_ascii_digit()) && t.ends_with(|c: char| c.is_ascii_digit());
    if all_valid && ends_ok && !t.contains("..") {
        Some(t.to_string())
    } else {
        None
    }
}

fn windows_build_token(raw: &str) -> Option<String> {
    dotted_numeric_token(raw, MAX_WINDOWS_BUILD_CHARS)
}

fn driver_version_token(raw: &str) -> Option<String> {
    dotted_numeric_token(raw, MAX_DRIVER_VERSION_CHARS)
}

/// §2B `occurred_at`: RFC3339 truncated to the minute — second precision adds identity, not
/// diagnosis. An unparseable timestamp refuses the field (never a fabricated time).
fn occurred_at_minute(when_rfc3339: &str) -> Option<String> {
    use chrono::{DateTime, SecondsFormat, Timelike};
    let dt = DateTime::parse_from_rfc3339(when_rfc3339).ok()?;
    let dt = dt.with_second(0)?.with_nanosecond(0)?;
    Some(dt.to_rfc3339_opts(SecondsFormat::Secs, false))
}

/// The 6-variant local `IncidentKind` collapses onto the 5-value §2B wire vocabulary.
fn case_incident_kind(kind: IncidentKind) -> CaseIncidentKind {
    match kind {
        IncidentKind::AppCrash => CaseIncidentKind::AppCrash,
        IncidentKind::AppHang => CaseIncidentKind::AppHang,
        IncidentKind::GpuTimeout => CaseIncidentKind::GpuTimeout,
        IncidentKind::BlueScreen | IncidentKind::HardwareError => CaseIncidentKind::BsodWhea,
        IncidentKind::UnexpectedShutdown => CaseIncidentKind::UnexpectedRestart,
    }
}

/// Group B, produced — always from the already-normalized `Incident`, never re-read raw from
/// Windows at send time (§2B).
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct IncidentEvidence {
    kind: CaseIncidentKind,
    occurred_at: String,
    app_family: Option<String>,
    module_family: Option<String>,
    error_code: Option<String>,
}

/// `None` when the incident cannot honestly anchor a case (no parseable time). Kind and time
/// define the case (§2B marks them required and non-removable); the app/module/code fields are
/// carried when the incident has a valid one — an unexpected restart records no faulting app, and
/// unavailable stays unknown, never fabricated.
pub(crate) fn incident_evidence_from(incident: &Incident) -> Option<IncidentEvidence> {
    let occurred_at = occurred_at_minute(&incident.when)?;
    Some(IncidentEvidence {
        kind: case_incident_kind(incident.kind),
        occurred_at,
        app_family: incident.receipt.faulting_app.as_deref().and_then(family_token),
        module_family: incident.receipt.faulting_module.as_deref().and_then(family_token),
        error_code: incident.receipt.code.as_deref().and_then(error_code_token),
    })
}

/// §2C hardware block — removable as ONE unit on the preview, so it is produced as one unit.
/// Extraction mirrors `receipts::build_receipt_payload`'s reads; the vocabularies ARE Tier 2's,
/// via the shared tier-neutral `hw_class` helpers (§4 alignment by construction).
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct HwContext {
    gpu_vendor: String,
    gpu_model: String,
    cpu_family: String,
    ram_gb_bucket: String,
}

pub(crate) fn hw_context_from(hardware: &Value) -> HwContext {
    // CR-gpu-first-elsewhere: the same card the Tier 2 receipt names (the most-VRAM GPU, not the
    // first adapter, an iGPU on a hybrid rig); unread or Windows' fallback adapter = "unknown".
    let gpu_now = crate::priorities::primary_gpu_of(hardware);
    let gpu_model_raw = gpu_now
        .as_deref()
        .filter(|g| crate::priorities::identifies_a_card(g))
        .unwrap_or("unknown");
    let cpu_family_raw = hardware
        .get("cpu_arch")
        .and_then(|a| a.get("family_label"))
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    HwContext {
        gpu_vendor: gpu_vendor_token(gpu_model_raw).into(),
        gpu_model: sanitize_token(gpu_model_raw),
        cpu_family: sanitize_token(cpu_family_raw),
        ram_gb_bucket: ram_gb_bucket(hardware.get("ram_total_bytes").and_then(Value::as_u64)),
    }
}

// ---------------------------------------------------------------------------
// Assembly + shape classification (§1)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CaseAssemblyError {
    /// Neither a comment nor incident evidence — there is no case to send.
    EmptyCase,
    /// The comment was this case's only content and nothing of it survived redaction.
    CommentEmptyAfterRedaction,
}

/// The one constructor. Redacts the comment, validates every optional token, and refuses a
/// shapeless case. Everything it returns serializes through `case_payload_json` alone.
pub(crate) fn assemble_case(
    comment: Option<&str>,
    evidence: Option<&IncidentEvidence>,
    hw: Option<&HwContext>,
    windows_build: Option<&str>,
    gpu_driver_version: Option<&str>,
) -> Result<CasePayload, CaseAssemblyError> {
    let comment_provided = comment.is_some();
    let user_comment = comment.map(redact_comment).filter(|c| !c.is_empty());
    if user_comment.is_none() && evidence.is_none() {
        return Err(if comment_provided {
            CaseAssemblyError::CommentEmptyAfterRedaction
        } else {
            CaseAssemblyError::EmptyCase
        });
    }
    Ok(CasePayload {
        schema_version: CASE_SCHEMA_VERSION,
        compy_version: env!("CARGO_PKG_VERSION").to_string(),
        user_comment,
        incident_kind: evidence.map(|e| e.kind),
        occurred_at: evidence.map(|e| e.occurred_at.clone()),
        app_family: evidence.and_then(|e| e.app_family.clone()),
        module_family: evidence.and_then(|e| e.module_family.clone()),
        error_code: evidence.and_then(|e| e.error_code.clone()),
        gpu_vendor: hw.map(|h| h.gpu_vendor.clone()),
        gpu_model: hw.map(|h| h.gpu_model.clone()),
        cpu_family: hw.map(|h| h.cpu_family.clone()),
        ram_gb_bucket: hw.map(|h| h.ram_gb_bucket.clone()),
        windows_build: windows_build.and_then(windows_build_token),
        gpu_driver_version: gpu_driver_version.and_then(driver_version_token),
    })
}

/// §1: the three shapes a case can take. Never a wire field — the server derives its own copy
/// from the validated payload; this one feeds the preview's one-line shape statement.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CaseKind {
    Comment,
    Incident,
    Both,
}

/// `None` only for a shapeless payload no assembler produced (both halves absent).
pub(crate) fn case_kind(payload: &CasePayload) -> Option<CaseKind> {
    match (payload.user_comment.is_some(), payload.incident_kind.is_some()) {
        (true, true) => Some(CaseKind::Both),
        (true, false) => Some(CaseKind::Comment),
        (false, true) => Some(CaseKind::Incident),
        (false, false) => None,
    }
}

/// The §1 one-line shape statement, verbatim from the contract.
pub(crate) fn shape_line(kind: CaseKind) -> &'static str {
    match kind {
        CaseKind::Comment => "comment only",
        CaseKind::Incident => "incident evidence only",
        CaseKind::Both => "comment + incident evidence",
    }
}

// ---------------------------------------------------------------------------
// ONE canonical serializer + the pure preview representation (§3)
// ---------------------------------------------------------------------------

/// Why the serializer can refuse. `Shapeless` is security review finding S3 (2026-08-29):
/// `assemble_case` is the only assembler and it refuses a case with neither a comment nor an
/// incident, but `CasePayload` also derives `Deserialize`, so a payload with both halves absent
/// can still be built by deserializing one. That payload used to serialize real bytes while
/// `case_preview` returned `None` — a state where the wire would carry something the preview
/// refuses to show, which is precisely what §3 forbids.
///
/// The fix is here rather than in a validating `Deserialize`, and the reasoning is worth pinning:
/// a `#[serde(try_from = "...")]` shadow struct would enforce the invariant in the type, but it
/// would also put a SECOND copy of the fourteen-field list into the one file under standing
/// security review, and two field lists that must be kept in sync is a fresh drift surface in
/// exchange for closing a hole that is already closed here. Refusing at the serializer makes the
/// divergence impossible instead: preview and wire now refuse the same payloads for the same
/// reason.
#[derive(Debug)]
pub(crate) enum CaseSerializeError {
    /// Neither a comment nor an incident — there is no case here to send.
    Shapeless,
    Encode(serde_json::Error),
}

/// The wire serializer: the payload as the bytes transport would carry (from Stage 4).
///
/// It is not literally the only `serde_json` call on a `CasePayload` — `case_preview` runs
/// `to_string_pretty` on the same struct rather than re-parsing this function's output, which is
/// what makes the two byte-identical modulo whitespace instead of merely equivalent. What §3's
/// "the preview is the payload" needs is that both paths refuse the same payloads and order the
/// same keys, and both are pinned by test. A THIRD `serde_json` call on this type would break
/// that quietly, so `src/case-evidence-tier-separation-guard.test.ts` fails the build on one.
pub(crate) fn case_payload_json(payload: &CasePayload) -> Result<String, CaseSerializeError> {
    if case_kind(payload).is_none() {
        return Err(CaseSerializeError::Shapeless);
    }
    serde_json::to_string(payload).map_err(CaseSerializeError::Encode)
}

/// What Stage 2's screen renders: the shape line and the payload bytes, pretty-printed.
///
/// The pretty text is serialized from the SAME struct as the wire bytes, so the two agree on every
/// key, every value, and — since security review finding S2 (2026-08-29) — key ORDER. It used to
/// round-trip the canonical string through `serde_json::Value` first; `serde_json` is pinned
/// without `preserve_order`, so `Value`'s map is a `BTreeMap` and that round trip silently
/// re-sorted the preview alphabetically while the wire kept field-declaration order. The data was
/// identical, so nothing leaked, but the doc comment here claimed the two differed only in
/// whitespace, and that was not true. Now it is: strip the pretty text's insignificant whitespace
/// and you get the canonical bytes back, byte for byte (§3, pinned by test).
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct CasePreview {
    pub(crate) shape: &'static str,
    pub(crate) payload_json: String,
}

pub(crate) fn case_preview(payload: &CasePayload) -> Option<CasePreview> {
    let shape = shape_line(case_kind(payload)?);
    let pretty = serde_json::to_string_pretty(payload).ok()?;
    Some(CasePreview { shape, payload_json: pretty })
}

// ---------------------------------------------------------------------------
// Tests — §12's Stage 1 rows: allowlist, unknown-field rejection, redaction
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::blackbox::{IncidentKind, Receipt};
    use serde_json::json;

    // No identity literals are read from the real environment in these tests.
    const LITERALS_FOR_TESTS: [(&str, &str); 2] = [("kuya", MASK_USER), ("DESKTOP-AB12", MASK_HOST)];

    fn test_literals() -> Vec<(String, &'static str)> {
        LITERALS_FOR_TESTS.iter().map(|(v, m)| (v.to_string(), *m)).collect()
    }

    fn full_evidence() -> IncidentEvidence {
        IncidentEvidence {
            kind: CaseIncidentKind::AppCrash,
            occurred_at: "2026-06-12T21:42:00+02:00".into(),
            app_family: Some("valorant".into()),
            module_family: Some("ntdll.dll".into()),
            error_code: Some("0xc0000005".into()),
        }
    }

    fn full_hw() -> HwContext {
        HwContext {
            gpu_vendor: "amd".into(),
            gpu_model: "radeon rx 9070 xt".into(),
            cpu_family: "ryzen x3d".into(),
            ram_gb_bucket: "25-32".into(),
        }
    }

    fn full_payload() -> CasePayload {
        assemble_case(Some("it crashed"), Some(&full_evidence()), Some(&full_hw()), Some("26100"), Some("24.10.1"))
            .expect("full case assembles")
    }

    // ---- The allowlist is the struct (§2, §12 row 1) ----

    #[test]
    fn serialized_payload_carries_exactly_the_contract_fields_and_no_others() {
        let value: Value = serde_json::from_str(&case_payload_json(&full_payload()).expect("serializes")).expect("parses");
        let mut keys: Vec<&str> = value.as_object().expect("object").keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            vec![
                "app_family",
                "compy_version",
                "cpu_family",
                "error_code",
                "gpu_driver_version",
                "gpu_model",
                "gpu_vendor",
                "incident_kind",
                "module_family",
                "occurred_at",
                "ram_gb_bucket",
                "schema_version",
                "user_comment",
                "windows_build",
            ],
            "the wire keys must be exactly the §2 Group A-C allowlist"
        );
    }

    #[test]
    fn a_new_field_fails_this_destructure_until_the_contract_names_it() {
        // Compile-time shape pin (§12): adding a field to CasePayload breaks this exhaustive
        // destructure, forcing the author to visit the allowlist test above AND the contract §2.
        let CasePayload {
            schema_version,
            compy_version,
            user_comment,
            incident_kind,
            occurred_at,
            app_family,
            module_family,
            error_code,
            gpu_vendor,
            gpu_model,
            cpu_family,
            ram_gb_bucket,
            windows_build,
            gpu_driver_version,
        } = full_payload();
        assert_eq!(schema_version, CASE_SCHEMA_VERSION);
        assert_eq!(compy_version, env!("CARGO_PKG_VERSION"));
        assert!(user_comment.is_some() && incident_kind.is_some() && occurred_at.is_some());
        assert!(app_family.is_some() && module_family.is_some() && error_code.is_some());
        assert!(gpu_vendor.is_some() && gpu_model.is_some() && cpu_family.is_some() && ram_gb_bucket.is_some());
        assert!(windows_build.is_some() && gpu_driver_version.is_some());
    }

    #[test]
    fn absent_optional_fields_leave_the_wire_entirely() {
        let payload = assemble_case(Some("just feedback"), None, None, None, None).expect("comment case");
        let s = case_payload_json(&payload).expect("serializes");
        let value: Value = serde_json::from_str(&s).expect("parses");
        let keys: Vec<&str> = value.as_object().expect("object").keys().map(String::as_str).collect();
        assert_eq!(keys.len(), 3, "comment-only case carries exactly comment + the two required constants: {s}");
        assert!(!s.contains("null"), "an absent field is omitted, never null: {s}");
    }

    // ---- Unknown-field rejection (§12 row 2) ----

    #[test]
    fn round_trip_accepts_the_canonical_shape_and_refuses_an_extra_key() {
        let canonical = case_payload_json(&full_payload()).expect("serializes");
        let back: CasePayload = serde_json::from_str(&canonical).expect("canonical round-trips");
        assert_eq!(back, full_payload());
        // Positive control: one unknown key makes the whole payload unparseable.
        let mut value: Value = serde_json::from_str(&canonical).expect("parses");
        value.as_object_mut().expect("object").insert("smuggled".into(), json!("data"));
        let poisoned = value.to_string();
        assert!(serde_json::from_str::<CasePayload>(&poisoned).is_err(), "unknown field must refuse: {poisoned}");
    }

    #[test]
    fn server_generated_group_d_fields_are_unknown_to_the_client_schema() {
        // §2D: a client that carries ticket_id / deletion_verifier / received_at / expires_at is
        // refused — here that refusal is structural (they are unknown fields).
        for field in ["ticket_id", "deletion_verifier", "received_at", "expires_at"] {
            let mut value: Value = serde_json::from_str(&case_payload_json(&full_payload()).expect("ser")).expect("parse");
            value.as_object_mut().expect("object").insert(field.into(), json!("x"));
            assert!(
                serde_json::from_str::<CasePayload>(&value.to_string()).is_err(),
                "group-D field `{field}` must never parse as part of a client payload"
            );
        }
    }

    #[test]
    fn incident_kind_vocabulary_is_closed_on_the_wire() {
        let ok = r#"{"schema_version":1,"compy_version":"0.0.0","incident_kind":"app-crash","occurred_at":"2026-06-12T21:42:00+02:00"}"#;
        assert!(serde_json::from_str::<CasePayload>(ok).is_ok());
        let bad = r#"{"schema_version":1,"compy_version":"0.0.0","incident_kind":"telemetry-dump","occurred_at":"2026-06-12T21:42:00+02:00"}"#;
        assert!(serde_json::from_str::<CasePayload>(bad).is_err(), "out-of-vocabulary kind must refuse");
    }

    // ---- Free-text redaction (§12 row 3): adversarial shapes cannot survive ----

    #[test]
    fn paths_cannot_survive_the_comment() {
        for hostile in [
            "crash after C:\\Users\\kuya\\AppData\\Local\\game.exe started",
            "log at %APPDATA%\\Compy\\history.json says so",
            "\\\\fileserver\\share\\clip.mp4 was playing",
            "installed under C:\\Program Files\\Some Game\\bin",
            "unix-style C:/Users/kuya/thing too",
        ] {
            let out = redact_comment_with(hostile, &test_literals());
            assert!(out.contains(MASK_PATH), "path not masked in: {out}");
            assert!(!out.to_lowercase().contains("users"), "path fragment leaked: {out}");
            assert!(!out.contains("kuya"), "username leaked: {out}");
        }
    }

    #[test]
    fn addresses_keys_and_serials_cannot_survive_the_comment() {
        let out = redact_comment_with("my ip is 192.168.1.44 and fe80::1ff:fe23:4567:890a too", &test_literals());
        assert!(!out.contains("192.168.1.44") && !out.contains("890a"), "address leaked: {out}");
        assert_eq!(out.matches(MASK_IP).count(), 2, "both address shapes masked: {out}");

        let out = redact_comment_with("key ABCD-EFGH-IJKL-MNOP got rejected", &test_literals());
        assert!(out.contains(MASK_KEY) && !out.contains("ABCD"), "key leaked: {out}");

        let out = redact_comment_with("serial 1A2B3C4D5E6F7G8H on the sticker", &test_literals());
        assert!(out.contains(MASK_SERIAL) && !out.contains("1A2B3C4D"), "serial leaked: {out}");
    }

    #[test]
    fn machine_identity_literals_cannot_survive_the_comment_case_insensitively() {
        let out = redact_comment_with("KUYA here, box is desktop-ab12", &test_literals());
        assert!(!out.to_lowercase().contains("kuya"), "username leaked: {out}");
        assert!(!out.to_lowercase().contains("desktop-ab12"), "hostname leaked: {out}");
        assert!(out.contains(MASK_USER) && out.contains(MASK_HOST));
    }

    #[test]
    fn identity_literals_are_masked_even_beside_length_changing_unicode() {
        // Review finding (2026-08-29): the old byte-parity bail-out meant ONE character whose
        // lowercase form has a different byte length (İ, ẞ) disabled literal masking for the
        // whole comment. Pinned: the literals mask, the unrelated Unicode survives.
        let out = redact_comment_with("İstanbul crash, ẞ appeared, my name is KUYA on desktop-ab12", &test_literals());
        assert!(!out.to_lowercase().contains("kuya"), "username leaked: {out}");
        assert!(!out.to_lowercase().contains("desktop-ab12"), "hostname leaked: {out}");
        assert!(out.contains("İstanbul") && out.contains('ẞ'), "unrelated text mangled: {out}");
    }

    #[test]
    fn addresses_with_ports_schemes_and_brackets_cannot_survive() {
        // Review finding (2026-08-29): addresses pasted from error dialogs arrive dressed.
        // The URL fixture is assembled at runtime — the outbound guard scans this file's whole
        // source (tests included) for URL literals, and a fixture must not be its one hit.
        let url_shaped = format!("server at http{}192.168.1.44/status died", "://");
        for hostile in [
            "connected to 192.168.1.44:8080 and failed",
            url_shaped.as_str(),
            "node at [fe80::1ff:fe23:4567:890a]:8080 down",
        ] {
            let out = redact_comment_with(hostile, &test_literals());
            assert!(!out.contains("192.168") && !out.contains("890a"), "address leaked: {out}");
        }
        // The clock/version negative controls still hold.
        let clean = "restarted at 12:30:00, driver 24.10.1, ratio 24/7 uptime";
        assert_eq!(redact_comment_with(clean, &test_literals()), clean);
    }

    #[test]
    fn unix_style_absolute_paths_cannot_survive() {
        // Review finding (2026-08-29): a WSL/dev-tool path carries a username the env-literal
        // scrub cannot know about (someone ELSE's machine, a quoted log line).
        let out = redact_comment_with("failed reading /home/otheruser/.ssh/id_rsa on the box", &test_literals());
        assert!(out.contains(MASK_PATH) && !out.contains("otheruser"), "unix path leaked: {out}");
        let out = redact_comment_with("my config is ~/compy/settings.json somehow", &test_literals());
        assert!(out.contains(MASK_PATH) && !out.contains("settings.json"), "home path leaked: {out}");
        // A lone command switch is not a path and stays readable.
        let clean = "launched with /v and it worked";
        assert_eq!(redact_comment_with(clean, &test_literals()), clean);
    }

    #[test]
    fn clean_comments_pass_unchanged() {
        // Negative control: the masks must not fire on ordinary feedback.
        let clean = "the fps counter froze after alt-tab, felt like 10.5 seconds";
        assert_eq!(redact_comment_with(clean, &test_literals()), clean);
    }

    #[test]
    fn redaction_is_idempotent() {
        let hostile = "C:\\Users\\kuya\\game.exe crashed at 10.0.0.4 with key ABCD-EFGH-IJKL";
        let once = redact_comment_with(hostile, &test_literals());
        let twice = redact_comment_with(&once, &test_literals());
        assert_eq!(once, twice, "re-running the pipeline must not mangle an already-redacted comment");
    }

    #[test]
    fn control_characters_never_reach_the_wire() {
        let out = redact_comment_with("line one\r\nline two\ttabbed\u{0}nul\u{7}bell", &test_literals());
        assert!(!out.chars().any(|c| c.is_control()), "control char survived: {out:?}");
        assert!(out.contains("line one") && out.contains("line two"), "text content lost: {out}");
        // Whitespace-class controls become spaces (words stay separated); every other control is
        // DROPPED, so the text around it fuses — that is the intended shape, pinned here.
        assert!(out.contains("tabbednulbell"), "non-whitespace controls are dropped, not spaced: {out}");
    }

    #[test]
    fn comment_is_clamped_to_the_byte_budget_on_a_char_boundary() {
        let long = "ü".repeat(3000); // 2 bytes each — 6000 bytes, boundary lands mid-char
        let out = redact_comment_with(&long, &test_literals());
        assert!(out.len() <= MAX_COMMENT_BYTES, "budget exceeded: {} bytes", out.len());
        assert!(out.ends_with('\u{2026}'), "a truncated comment must show its cut");
        assert!(out.chars().all(|c| c == 'ü' || c == '\u{2026}'), "clamp split a character");
    }

    #[test]
    fn redaction_runs_before_the_clamp_so_truncation_cannot_uncover_a_shape() {
        // A serial sitting right at the clamp boundary: redact-then-clamp masks it whole;
        // clamp-then-redact would cut it below the 16-char detector threshold and leak the head.
        let padding = "a ".repeat(996); // 1992 bytes, then the serial crosses the 2000 boundary
        let hostile = format!("{padding}1A2B3C4D5E6F7G8H");
        let out = redact_comment_with(&hostile, &test_literals());
        assert!(!out.contains("1A2B"), "serial head survived the clamp: …{}", &out[out.len().saturating_sub(40)..]);
    }

    // ---- Token producers (§2B, §2C) ----

    #[test]
    fn family_token_reduces_paths_to_basenames_and_refuses_identity_shapes() {
        assert_eq!(family_token("C:\\Users\\kuya\\valorant.exe").as_deref(), Some("valorant"));
        assert_eq!(family_token("NTDLL.DLL").as_deref(), Some("ntdll.dll"));
        // Refused, never edited-into-shape:
        assert_eq!(family_token(""), None);
        assert_eq!(family_token("C:\\Users\\kuya\\"), None, "separator-only input has no basename");
        assert_eq!(family_token("user@host"), None, "an @-shaped token is identity, not a family");
        assert_eq!(family_token("C:"), None, "a bare drive is not a family");
        assert_eq!(family_token("ga\u{0}me"), None, "interior control chars refuse the token");
        // Bounded:
        let long = "x".repeat(200);
        assert_eq!(family_token(&long).expect("valid").chars().count(), MAX_FAMILY_TOKEN_CHARS);
    }

    #[test]
    fn error_code_token_is_a_bounded_closed_charset() {
        assert_eq!(error_code_token("0xC0000005").as_deref(), Some("0xc0000005"));
        assert_eq!(error_code_token("APPCRASH").as_deref(), Some("appcrash"));
        assert_eq!(error_code_token("  0x124  ").as_deref(), Some("0x124"));
        assert_eq!(error_code_token("two words"), None);
        assert_eq!(error_code_token("C:\\path"), None);
        assert_eq!(error_code_token(&"f".repeat(33)), None, "overlong code refused");
        assert_eq!(error_code_token(""), None);
    }

    #[test]
    fn build_and_driver_tokens_are_dotted_numeric_only() {
        assert_eq!(windows_build_token("26100").as_deref(), Some("26100"));
        assert_eq!(windows_build_token("10.0.26100").as_deref(), Some("10.0.26100"));
        assert_eq!(driver_version_token("24.10.1").as_deref(), Some("24.10.1"));
        for bad in ["", "build 26100", "26100.", ".26100", "26..100", "v24.10", "26100-insider"] {
            assert_eq!(windows_build_token(bad), None, "must refuse: {bad:?}");
        }
        assert_eq!(windows_build_token("12345678901234567"), None, "17 chars exceeds the build budget");
    }

    #[test]
    fn occurred_at_is_truncated_to_the_minute_preserving_the_offset() {
        assert_eq!(occurred_at_minute("2026-06-12T21:42:37+02:00").as_deref(), Some("2026-06-12T21:42:00+02:00"));
        assert_eq!(occurred_at_minute("2026-06-12T21:42:37.891Z").as_deref(), Some("2026-06-12T21:42:00+00:00"));
        assert_eq!(occurred_at_minute("last tuesday"), None, "an unparseable time refuses, never fabricates");
    }

    #[test]
    fn every_local_incident_kind_lands_in_the_closed_wire_vocabulary() {
        assert_eq!(case_incident_kind(IncidentKind::AppCrash), CaseIncidentKind::AppCrash);
        assert_eq!(case_incident_kind(IncidentKind::AppHang), CaseIncidentKind::AppHang);
        assert_eq!(case_incident_kind(IncidentKind::GpuTimeout), CaseIncidentKind::GpuTimeout);
        assert_eq!(case_incident_kind(IncidentKind::BlueScreen), CaseIncidentKind::BsodWhea);
        assert_eq!(case_incident_kind(IncidentKind::HardwareError), CaseIncidentKind::BsodWhea);
        assert_eq!(case_incident_kind(IncidentKind::UnexpectedShutdown), CaseIncidentKind::UnexpectedRestart);
    }

    // ---- Producers over real structures ----

    fn incident(kind: IncidentKind, when: &str, app: Option<&str>, module: Option<&str>, code: Option<&str>) -> Incident {
        Incident {
            incident_id: "test-incident".into(),
            headline: "A game closed on its own".into(),
            tag: kind.tag().into(),
            when: when.into(),
            when_display: "Jun 12, 9:42 PM".into(),
            vitals: None,
            receipt: Receipt {
                source: "System log · test".into(),
                event_ids: vec![1000],
                faulting_app: app.map(Into::into),
                faulting_module: module.map(Into::into),
                code: code.map(Into::into),
                detail: "detail".into(),
            },
            assessment: None,
            case_intelligence: None,
            changed_before: None,
            kind,
        }
    }

    #[test]
    fn incident_evidence_normalizes_every_field_through_its_scrub() {
        let inc = incident(
            IncidentKind::AppCrash,
            "2026-06-12T21:42:37+02:00",
            Some("C:\\Users\\kuya\\VALORANT.exe"),
            Some("ntdll.dll"),
            Some("0xC0000005"),
        );
        let ev = incident_evidence_from(&inc).expect("evidence builds");
        assert_eq!(ev.kind, CaseIncidentKind::AppCrash);
        assert_eq!(ev.occurred_at, "2026-06-12T21:42:00+02:00");
        assert_eq!(ev.app_family.as_deref(), Some("valorant"));
        assert_eq!(ev.module_family.as_deref(), Some("ntdll.dll"));
        assert_eq!(ev.error_code.as_deref(), Some("0xc0000005"));
    }

    #[test]
    fn an_incident_without_a_parseable_time_cannot_anchor_a_case() {
        let inc = incident(IncidentKind::AppCrash, "not a time", Some("game.exe"), None, None);
        assert_eq!(incident_evidence_from(&inc), None);
    }

    #[test]
    fn an_unexpected_restart_carries_no_fabricated_app() {
        let inc = incident(IncidentKind::UnexpectedShutdown, "2026-06-12T03:00:59Z", None, None, None);
        let ev = incident_evidence_from(&inc).expect("kind + time are enough");
        assert_eq!(ev.kind, CaseIncidentKind::UnexpectedRestart);
        assert_eq!(ev.app_family, None, "unavailable stays unknown, never fabricated");
    }

    #[test]
    fn hw_context_shares_tier2_vocabularies_and_leaks_no_identity() {
        let hardware = json!({
            "gpus": [{ "name": "C:\\Users\\kuya\\AMD Radeon RX 9070 XT" }],
            "cpu_arch": { "family_label": "Ryzen X3D" },
            "ram_total_bytes": 31_550_000_000u64
        });
        let hw = hw_context_from(&hardware);
        assert_eq!(hw.gpu_vendor, "amd");
        assert_eq!(hw.gpu_model, "amd radeon rx 9070 xt", "basename class survives, path does not");
        assert_eq!(hw.cpu_family, "ryzen x3d");
        assert_eq!(hw.ram_gb_bucket, "25-32", "bucketed, never exact bytes");
        assert!(!format!("{hw:?}").contains("kuya"), "username leaked: {hw:?}");
    }

    // CR-gpu-first-elsewhere: the card games run on (most VRAM), not the first adapter (the iGPU on a
    // hybrid rig); Windows' fallback adapter is "unknown", as the Tier 2 receipt reads it.
    #[test]
    fn hw_context_names_the_most_vram_card_not_the_first_adapter() {
        let hybrid = json!({ "gpus": [
            { "name": "AMD Radeon(TM) Graphics", "vram_bytes": 536870912u64 },
            { "name": "NVIDIA GeForce RTX 4070", "vram_bytes": 12884901888u64 },
        ] });
        let hw = hw_context_from(&hybrid);
        assert_eq!((hw.gpu_vendor.as_str(), hw.gpu_model.as_str()), ("nvidia", "nvidia geforce rtx 4070"));
        let basic = json!({ "gpus": [{ "name": "Microsoft Basic Display Adapter", "vram_bytes": 0u64 }] });
        assert_eq!(hw_context_from(&basic).gpu_model, "unknown");
    }

    // ---- Assembly + shape (§1) ----

    #[test]
    fn a_shapeless_case_refuses_to_assemble() {
        assert_eq!(assemble_case(None, None, None, None, None), Err(CaseAssemblyError::EmptyCase));
        assert_eq!(
            assemble_case(Some("\u{0}\u{7}"), None, None, None, None),
            Err(CaseAssemblyError::CommentEmptyAfterRedaction),
            "a comment that redaction empties cannot be the whole case"
        );
    }

    #[test]
    fn the_three_shapes_classify_exactly_as_the_contract_states_them() {
        let comment_only = assemble_case(Some("feedback"), None, None, None, None).expect("assembles");
        assert_eq!(case_kind(&comment_only), Some(CaseKind::Comment));
        assert_eq!(shape_line(CaseKind::Comment), "comment only");

        let evidence = full_evidence();
        let incident_only = assemble_case(None, Some(&evidence), None, None, None).expect("assembles");
        assert_eq!(case_kind(&incident_only), Some(CaseKind::Incident));
        assert_eq!(shape_line(CaseKind::Incident), "incident evidence only");

        let both = assemble_case(Some("it happened again"), Some(&evidence), None, None, None).expect("assembles");
        assert_eq!(case_kind(&both), Some(CaseKind::Both));
        assert_eq!(shape_line(CaseKind::Both), "comment + incident evidence");
    }

    #[test]
    fn assembled_from_hostile_inputs_the_serialized_case_carries_no_identity() {
        let inc = incident(
            IncidentKind::AppCrash,
            "2026-06-12T21:42:37+02:00",
            Some("C:\\Users\\kuya\\game.exe"),
            Some("C:\\Users\\kuya\\bad.dll"),
            Some("0x1"),
        );
        let evidence = incident_evidence_from(&inc).expect("builds");
        let hardware = json!({
            "gpus": [{ "name": "C:/Users/kuya/Radeon RX 9070 XT" }],
            "cpu_arch": { "family_label": "C:/Users/kuya/Ryzen" },
            "ram_total_bytes": 31_550_000_000u64
        });
        let hw = hw_context_from(&hardware);
        let payload = assemble_case(
            Some("crashed while C:\\Users\\kuya\\clip.mp4 played"),
            Some(&evidence),
            Some(&hw),
            Some("26100"),
            Some("24.10.1"),
        )
        .expect("assembles");
        let s = case_payload_json(&payload).expect("serializes");
        assert!(!s.contains("kuya"), "username leaked: {s}");
        assert!(!s.to_lowercase().contains("users"), "path fragment leaked: {s}");
        assert!(!s.contains("\\\\") && !s.contains('/'), "separator leaked: {s}");
    }

    #[test]
    fn invalid_context_tokens_are_dropped_not_mangled() {
        let payload = assemble_case(Some("hi"), None, None, Some("build 26100!"), Some("not.a.version.x")).expect("assembles");
        assert_eq!(payload.windows_build, None);
        assert_eq!(payload.gpu_driver_version, None);
    }

    // ---- Preview == send-source (§3, §12) ----

    #[test]
    fn the_preview_is_the_payload_not_a_summary() {
        let payload = full_payload();
        let preview = case_preview(&payload).expect("previewable");
        let canonical: Value = serde_json::from_str(&case_payload_json(&payload).expect("ser")).expect("parse");
        let shown: Value = serde_json::from_str(&preview.payload_json).expect("preview text is JSON");
        assert_eq!(shown, canonical, "preview must render the same JSON the wire would carry");
        assert_eq!(preview.shape, "comment + incident evidence");
    }

    // ---- The gate (§12) ----

    #[test]
    fn the_gate_is_hard_false() {
        assert!(!case_evidence_gate(), "Tier 3 arming is Stage 9, a separate owner decision");
    }

    // ---- Security review 2026-08-29, finding S1: invisible characters (BLOCKING) ----
    //
    // Every test below carries a SEEDED NEGATIVE: `legacy_flatten` is the pre-fix input
    // boundary, verbatim, and each case first proves that the hostile input really does walk
    // straight past the detector under it. Without that half, a test asserting only that the
    // mask appears would pass just as happily against an input that was never dangerous.

    /// The input boundary exactly as it stood before the S1 fix: Cc only, nothing else.
    fn legacy_flatten(input: &str) -> String {
        let mut out = String::with_capacity(input.len());
        for c in input.chars() {
            if c == '\n' || c == '\r' || c == '\t' {
                out.push(' ');
            } else if !c.is_control() {
                out.push(c);
            }
        }
        out
    }

    fn user_literals() -> Vec<(String, &'static str)> {
        vec![("kuya".to_string(), MASK_USER)]
    }

    #[test]
    fn a_zero_width_space_can_no_longer_hide_an_identity_literal() {
        let hostile = "ku\u{200B}ya crashed the game";

        // NEGATIVE CONTROL: under the old boundary the username survives untouched.
        let legacy = legacy_flatten(hostile);
        assert_eq!(
            replace_ignore_case(&legacy, "kuya", MASK_USER),
            legacy,
            "the seeded input must actually defeat the pre-fix masker, or this test proves nothing"
        );

        let out = redact_comment_with(hostile, &user_literals());
        assert!(out.contains(MASK_USER), "identity literal not masked: {out}");
        assert!(!out.contains("kuya"), "identity literal survived: {out}");
        assert!(!out.contains('\u{200B}'), "the zero-width character reached the wire: {out:?}");
    }

    #[test]
    fn a_zero_width_space_can_no_longer_hide_an_ip_address() {
        let hostile = "crash at 192.168\u{200B}.1.1 today";

        let legacy = legacy_flatten(hostile);
        assert_eq!(mask_ips(&legacy), legacy, "seeded input must defeat the pre-fix ip masker");

        let out = redact_comment_with(hostile, &[]);
        assert!(out.contains(MASK_IP), "address not masked: {out}");
        assert!(!out.contains("192.168"), "address survived: {out}");
    }

    #[test]
    fn a_zero_width_space_can_no_longer_hide_a_product_key_or_a_serial() {
        let key = "key ABCD-1234\u{200B}-EFGH on the sticker";
        let serial = "serial 1A2B3C4D\u{200B}5E6F7G8H on the sticker";

        let legacy_key = legacy_flatten(key);
        assert_eq!(mask_keys(&legacy_key), legacy_key, "seeded key must defeat the pre-fix masker");
        let legacy_serial = legacy_flatten(serial);
        assert_eq!(
            mask_serials(&legacy_serial),
            legacy_serial,
            "seeded serial must defeat the pre-fix masker"
        );

        let out_key = redact_comment_with(key, &[]);
        assert!(out_key.contains(MASK_KEY), "key not masked: {out_key}");
        assert!(!out_key.contains("ABCD"), "key survived: {out_key}");

        let out_serial = redact_comment_with(serial, &[]);
        assert!(out_serial.contains(MASK_SERIAL), "serial not masked: {out_serial}");
        assert!(!out_serial.contains("1A2B"), "serial survived: {out_serial}");
    }

    #[test]
    fn every_invisible_class_is_covered_not_just_the_zero_width_space() {
        // One representative per family the fix claims: soft hyphen, ZWNJ, ZWJ, LRM, a bidi
        // override, word joiner, a bidi isolate, BOM, a variation selector, and a tag character.
        for probe in [
            '\u{00AD}', '\u{200C}', '\u{200D}', '\u{200E}', '\u{202E}', '\u{2060}', '\u{2066}',
            '\u{FEFF}', '\u{FE0F}', '\u{E0041}', '\u{034F}', '\u{180E}', '\u{180B}', '\u{180C}',
            '\u{180D}', '\u{180F}',
        ] {
            assert!(is_invisible_format(probe), "U+{:04X} not classified invisible", probe as u32);
            let hostile = format!("ku{probe}ya was here");
            let out = redact_comment_with(&hostile, &user_literals());
            assert!(out.contains(MASK_USER), "U+{:04X} hid the username: {out:?}", probe as u32);
            assert!(!out.contains(probe), "U+{:04X} reached the wire: {out:?}", probe as u32);
        }
    }

    #[test]
    fn ordinary_text_is_not_damaged_by_the_invisible_strip() {
        // The fix must not become a second bug. Accented Latin, CJK, emoji and punctuation are
        // none of them format characters, and a comment that contains no identity value at all
        // must come through exactly as typed.
        let plain = "Café crashed — 游戏崩溃了 🎮 after ~10 min, twice.";
        for c in plain.chars() {
            assert!(!is_invisible_format(c), "{c:?} wrongly classified as invisible");
        }
        assert_eq!(redact_comment_with(plain, &[]), plain, "ordinary prose was altered");
    }

    #[test]
    fn a_zwj_emoji_sequence_splits_and_that_cost_is_named_not_hidden() {
        // The honest bound on the test above: "ordinary text is not damaged" was only ever proven
        // for a SINGLE emoji, and the second review pass caught the gap between that and how it
        // reads. U+200D is the joiner that welds a sequence together and it MUST be stripped — it
        // is Cf, as invisible as ZWSP, and leaving it in reopens the hole. The cost is that a
        // compound emoji comes back as its parts. Cosmetic, never a leak, and now pinned.
        let sequence = "\u{1F3F3}\u{FE0F}\u{200D}\u{1F308} nice";
        let out = redact_comment_with(sequence, &[]);
        assert_eq!(out, "\u{1F3F3}\u{1F308} nice", "the ZWJ cost changed shape — re-check the doc");
        assert!(!out.contains('\u{200D}'), "the joiner survived — the invisible strip regressed");
    }

    #[test]
    fn full_width_forms_can_no_longer_hide_an_identity_literal_or_an_address() {
        let hostile_user = "ｋｕｙａ crashed the game";
        let legacy = legacy_flatten(hostile_user);
        assert_eq!(
            replace_ignore_case(&legacy, "kuya", MASK_USER),
            legacy,
            "seeded full-width name must defeat the pre-fix masker"
        );
        let out = redact_comment_with(hostile_user, &user_literals());
        assert!(out.contains(MASK_USER), "full-width username not masked: {out}");

        let hostile_ip = "box at １９２．１６８．１．１ now";
        let legacy_ip = legacy_flatten(hostile_ip);
        assert_eq!(mask_ips(&legacy_ip), legacy_ip, "seeded full-width ip must defeat the pre-fix masker");
        let out_ip = redact_comment_with(hostile_ip, &[]);
        assert!(out_ip.contains(MASK_IP), "full-width address not masked: {out_ip}");
    }

    #[test]
    fn the_mongolian_selectors_beside_the_vowel_separator_are_covered_too() {
        // Independent review of this repair (#259/#260) swept every code point 0..0x10FFFF against
        // Unicode 16.0 and caught what reading the list did not: `0x180E` had been written as a
        // single value, so the four MONGOLIAN FREE VARIATION SELECTORs beside it were dropped by
        // NEITHER pass — category Mn, so `char::is_control()` says no, and absent from the table,
        // so `is_invisible_format` said no. Zero advance width, combining class 0: the same
        // token-splitting mechanism as U+200B, against every detector at once.
        for probe in ['\u{180B}', '\u{180C}', '\u{180D}', '\u{180F}'] {
            assert!(!probe.is_control(), "U+{:04X} is Cc after all — this test's premise is wrong", probe as u32);

            let hostile_user = format!("ku{probe}ya was here");
            let legacy = legacy_flatten(&hostile_user);
            assert_eq!(
                replace_ignore_case(&legacy, "kuya", MASK_USER),
                legacy,
                "U+{:04X} must defeat the pre-fix masker, or this proves nothing",
                probe as u32
            );
            let out = redact_comment_with(&hostile_user, &user_literals());
            assert!(out.contains(MASK_USER), "U+{:04X} hid the username: {out:?}", probe as u32);

            let hostile_ip = format!("box at 192.16{probe}8.1.1 now");
            let legacy_ip = legacy_flatten(&hostile_ip);
            assert_eq!(mask_ips(&legacy_ip), legacy_ip, "U+{:04X} must defeat the pre-fix ip scan", probe as u32);
            assert!(
                redact_comment_with(&hostile_ip, &[]).contains(MASK_IP),
                "U+{:04X} hid an address",
                probe as u32
            );
        }
    }

    #[test]
    fn the_braille_blank_is_a_visible_gap_and_stays_documented_as_one() {
        // Second honesty pin. The second review pass showed the first version of this comment was
        // reasoning from the wrong property: U+2800 is NOT `White_Space`, so `map_tokens` does not
        // break a token on it and a fused value escapes by the same mechanism ZWSP used — it is not
        // the Zs-space case at all. What still separates it from the stripped set is HOW it arrives:
        // the format characters ride in on an ordinary copy-paste and fail the promise incidentally,
        // while U+2800 inside a username or an address is deliberate self-obfuscation, and stripping
        // a character a renderer DRAWS hands back text the user never typed.
        //
        // The consequence is real and belongs in the open: a username split by one is NOT masked,
        // and the reviewer would have stripped it. If that trade is revisited, THIS test is what
        // must be updated deliberately, together with §2A and the Stage 2 consent copy.
        assert!(!is_invisible_format('\u{2800}'), "U+2800 is now stripped — update §2A and the consent copy");
        let out = redact_comment_with("ku\u{2800}ya was here", &user_literals());
        assert!(!out.contains(MASK_USER), "U+2800 is now folded — this pin must be updated deliberately");
    }

    #[test]
    fn the_documented_residual_limit_is_real_and_stays_documented() {
        // Honesty pin, not a defect: a mixed-script homoglyph still defeats an exact match, and
        // §2A's "best-effort" wording plus the consent copy is what covers it. If a future change
        // closes this, THIS test is the one that must be updated deliberately — a silently
        // upgraded redaction claim is exactly what the honest-measurement law forbids.
        let cyrillic_a = "kuy\u{0430} was here"; // U+0430 CYRILLIC SMALL LETTER A
        let out = redact_comment_with(cyrillic_a, &user_literals());
        assert!(
            !out.contains(MASK_USER),
            "a confusables table now exists — update §2A, the consent copy and this test together"
        );
    }

    // ---- Security review 2026-08-29, finding S2: preview == wire, byte for byte ----

    /// Remove JSON's insignificant whitespace, leaving string literals untouched. Small enough to
    /// read, and self-tested below so it cannot quietly become the reason the parity test passes.
    fn strip_json_whitespace(text: &str) -> String {
        let mut out = String::with_capacity(text.len());
        let mut in_string = false;
        let mut escaped = false;
        for c in text.chars() {
            if in_string {
                out.push(c);
                if escaped {
                    escaped = false;
                } else if c == '\\' {
                    escaped = true;
                } else if c == '"' {
                    in_string = false;
                }
            } else if c == '"' {
                in_string = true;
                out.push(c);
            } else if !c.is_whitespace() {
                out.push(c);
            }
        }
        out
    }

    #[test]
    fn the_whitespace_stripper_keeps_whitespace_inside_strings() {
        assert_eq!(strip_json_whitespace("{\n  \"a\": \"x y\"\n}"), "{\"a\":\"x y\"}");
        assert_eq!(strip_json_whitespace("{\"a\":\"he said \\\" ok\"}"), "{\"a\":\"he said \\\" ok\"}");
        assert_eq!(strip_json_whitespace("{\"a\":\"back\\\\\"}"), "{\"a\":\"back\\\\\"}");
    }

    #[test]
    fn the_preview_is_the_payload_byte_for_byte_including_key_order() {
        let payload = full_payload();
        let canonical = case_payload_json(&payload).expect("serializes");
        let preview = case_preview(&payload).expect("previewable");

        assert_eq!(
            strip_json_whitespace(&preview.payload_json),
            canonical,
            "the preview must be the canonical bytes plus whitespace, and nothing else"
        );

        // NEGATIVE CONTROL: the pre-fix implementation round-tripped through serde_json::Value,
        // whose map is a BTreeMap here (no `preserve_order` feature), so it re-sorted the keys
        // alphabetically. If this assertion ever fails, `preserve_order` was switched on and the
        // divergence S2 named is gone for a different reason — check before deleting this.
        let value: Value = serde_json::from_str(&canonical).expect("parses");
        let legacy_pretty = serde_json::to_string_pretty(&value).expect("pretty");
        assert_ne!(
            strip_json_whitespace(&legacy_pretty),
            canonical,
            "the seeded pre-fix preview must actually differ, or this test proves nothing"
        );
    }

    // ---- Security review 2026-08-29, finding S3: no bytes the preview would refuse to show ----

    #[test]
    fn a_shapeless_payload_is_refused_by_the_serializer_and_the_preview_alike() {
        // `assemble_case` cannot build this, but `Deserialize` can — that was the hole.
        let shapeless: CasePayload =
            serde_json::from_str(r#"{"schema_version":1,"compy_version":"9.9.9"}"#)
                .expect("the wire shape still deserializes");
        assert!(case_kind(&shapeless).is_none(), "the probe must really be shapeless");
        assert!(
            matches!(case_payload_json(&shapeless), Err(CaseSerializeError::Shapeless)),
            "the serializer must refuse a payload the preview cannot show"
        );
        assert!(case_preview(&shapeless).is_none(), "the preview must refuse it too");

        // And the refusal is specific to shapelessness — a real payload still serializes.
        assert!(case_payload_json(&full_payload()).is_ok(), "a shaped payload must still serialize");
    }

    // ---- Security review 2026-08-29, finding S4: Group C hardware tokens, end to end ----

    #[test]
    fn adversarial_hardware_probe_strings_reach_the_wire_safely() {
        // hw_class::sanitize_token is Group C's only scrub — `family_token`'s extra refusal is
        // Group B only (the hw_class.rs comment now says so). This pins what actually arrives.
        let hardware = json!({
            "gpus": [{ "name": "C:\\Users\\kuya\\drivers\\Radeon\u{7} RX 9070 XT.EXE" }],
            "cpu_arch": { "family_label": "  Ryzen\u{0} X3D  " },
            "ram_total_bytes": 31_500_000_000u64,
        });
        let hw = hw_context_from(&hardware);
        let payload = assemble_case(Some("hi"), None, Some(&hw), None, None).expect("assembles");
        let text = case_payload_json(&payload).expect("serializes");

        // The scrub's actual job — no path, no separator, no username — is done.
        assert!(!text.contains("kuya"), "username leaked through a hardware token: {text}");
        assert!(!text.to_lowercase().contains("users"), "path fragment leaked: {text}");
        assert!(!text.contains("\\\\") && !text.contains(".exe"), "path shape leaked: {text}");

        // Characterization, deliberately not a fix: an interior control character survives the
        // token (serde escapes it, so the JSON stays valid and round-trips), and the token is not
        // length-capped the way every Group A/B token is. Both are recorded on #259 as follow-up
        // candidates rather than changed here, because contract §2 scopes Group C as Tier 2 parity
        // and narrowing it is a contract decision, not a repair.
        let back: Value = serde_json::from_str(&text).expect("the payload round-trips");
        assert_eq!(back["gpu_model"], json!("radeon\u{7} rx 9070 xt"));
        assert_eq!(back["cpu_family"], json!("ryzen\u{0} x3d"));
        assert!(text.contains("\\u0007"), "a control byte must be JSON-escaped, never raw: {text}");
    }
    // ---- Stage 2 (#258): the preview corpus the consent UI renders ----

    // WHY A COMMITTED CORPUS, rather than the obvious thing.
    //
    // Stage 2's screen must render "the exact serialized payload, never a reconstructed summary"
    // (contract §3), and removing an optional field must re-render it. The obvious way to do that
    // in a frontend with no backend command is a TypeScript serializer mirroring this module's —
    // which is a SECOND implementation of the canonical bytes, in another language, free to drift
    // the day someone adds a field. That is the exact failure §3 exists to prevent, and no guard
    // written in TypeScript could prove the two agree on a payload nobody thought to test.
    //
    // So the frontend gets no serializer at all. Every removal state a user can reach is
    // enumerated HERE, run through the real `case_preview`, and committed; the UI looks the bytes
    // up. The corpus is the contract, this test is what keeps it true, and a drifted corpus fails
    // in Rust where the authority lives.
    //
    // The enumeration is exhaustive on purpose — sampling leaves the untested combination as the
    // one a user finds. Two bases cover all three §1 shapes: "both" collapses to "incident
    // evidence only" when the comment is removed, and journey A's comment-only case cannot be
    // reached from it because `incident_kind` is not removable (§2B: it defines the case).
    //
    // Regenerate:  COMPY_UPDATE_CASE_PREVIEW_CORPUS=1 cargo test case_preview_corpus

    const CORPUS_PATH: &str = "../src/case-preview-corpus.json";

    /// Pinned instead of `CARGO_PKG_VERSION`: binding the corpus to the crate version would break
    /// this pin on every release cut, and a version bump is not a preview defect. It is the ONE
    /// value in the corpus the real assembler did not produce, and it is irrelevant to what the
    /// corpus proves — key order, omission of absent optionals, escaping, pretty-print shape.
    const FIXTURE_VERSION: &str = "0.0.0-fixture";

    /// The removable units of §2, in the order the consent screen lists them. The hardware block
    /// is ONE unit: §2C makes its four fields removable "as one block", never individually.
    const REMOVABLE_BOTH: [&str; 7] = [
        "user_comment",
        "app_family",
        "module_family",
        "error_code",
        "hardware",
        "windows_build",
        "gpu_driver_version",
    ];
    /// Journey A: the comment IS the case, so it is not removable; only §2C context is.
    const REMOVABLE_COMMENT: [&str; 3] = ["hardware", "windows_build", "gpu_driver_version"];

    fn without(base: &CasePayload, removed: &[&str]) -> CasePayload {
        let mut p = base.clone();
        for unit in removed {
            match *unit {
                "user_comment" => p.user_comment = None,
                "app_family" => p.app_family = None,
                "module_family" => p.module_family = None,
                "error_code" => p.error_code = None,
                "hardware" => {
                    p.gpu_vendor = None;
                    p.gpu_model = None;
                    p.cpu_family = None;
                    p.ram_gb_bucket = None;
                }
                "windows_build" => p.windows_build = None,
                "gpu_driver_version" => p.gpu_driver_version = None,
                other => panic!("unknown removable unit {other}"),
            }
        }
        p
    }

    /// The base a reviewer sees first. The comment carries a path and an IP **on purpose**: the
    /// preview must show what SURVIVES redaction, and a reviewer judging the best-effort honesty
    /// copy needs the masks on screen rather than described.
    fn corpus_base(comment: Option<&str>, evidence: Option<&IncidentEvidence>) -> CasePayload {
        let mut p = assemble_case(comment, evidence, Some(&full_hw()), Some("26100"), Some("24.10.1"))
            .expect("corpus base assembles");
        p.compy_version = FIXTURE_VERSION.into();
        p
    }

    fn corpus_entries(base_name: &str, base: &CasePayload, units: &[&str]) -> Vec<Value> {
        let mut out = Vec::new();
        for mask in 0..(1u32 << units.len()) {
            let removed: Vec<&str> =
                units.iter().enumerate().filter(|(i, _)| mask & (1 << i) != 0).map(|(_, u)| *u).collect();
            let payload = without(base, &removed);
            let preview = case_preview(&payload).expect("no reachable removal set is shapeless");
            out.push(json!({
                "base": base_name,
                "removed": removed,
                "shape": preview.shape,
                "payload_json": preview.payload_json,
            }));
        }
        out
    }

    #[test]
    fn case_preview_corpus_matches_what_this_module_produces() {
        let comment = "it crashed while I was in C:\\Users\\kuya\\Games\\valorant, my ip is 192.168.1.14";
        let mut entries =
            corpus_entries("both", &corpus_base(Some(comment), Some(&full_evidence())), &REMOVABLE_BOTH);
        entries.extend(corpus_entries("comment-only", &corpus_base(Some(comment), None), &REMOVABLE_COMMENT));

        let corpus = json!({
            "note": "GENERATED by case_preview_corpus_matches_what_this_module_produces in \
                     src-tauri/src/case_evidence_upload.rs. Do not hand-edit: regenerate with \
                     COMPY_UPDATE_CASE_PREVIEW_CORPUS=1 cargo test case_preview_corpus. Every \
                     payload_json below is real output of case_preview(), which is why the Tier 3 \
                     consent UI needs no serializer of its own.",
            "fixture_compy_version": FIXTURE_VERSION,
            "shapes": [shape_line(CaseKind::Comment), shape_line(CaseKind::Incident), shape_line(CaseKind::Both)],
            "removable_units": { "both": REMOVABLE_BOTH, "comment-only": REMOVABLE_COMMENT },
            "entries": entries,
        });

        let generated = serde_json::to_string_pretty(&corpus).expect("corpus serializes") + "\n";
        if std::env::var_os("COMPY_UPDATE_CASE_PREVIEW_CORPUS").is_some() {
            std::fs::write(CORPUS_PATH, &generated).expect("corpus writes");
        }
        let committed = std::fs::read_to_string(CORPUS_PATH)
            .unwrap_or_else(|e| panic!("{CORPUS_PATH} is missing or unreadable ({e}) — regenerate it"));
        assert_eq!(
            committed.replace("\r\n", "\n"),
            generated,
            "the committed preview corpus no longer matches case_preview() — the Tier 3 consent UI \
             would render bytes this module does not produce. Regenerate it, then LOOK at the diff: \
             a changed field order or a new key is a contract change, not a snapshot refresh."
        );
    }

    /// The corpus is only worth its bytes if a reachable state is really in it. This pins the
    /// count from both directions — an empty or truncated corpus can no longer read as green.
    #[test]
    fn case_preview_corpus_covers_every_reachable_removal_state() {
        let text = std::fs::read_to_string(CORPUS_PATH).expect("corpus is committed");
        let corpus: Value = serde_json::from_str(&text).expect("corpus parses");
        let entries = corpus["entries"].as_array().expect("entries is an array");
        assert_eq!(entries.len(), 128 + 8, "2^7 removal sets for `both` plus 2^3 for `comment-only`");

        let mut seen: Vec<String> = entries
            .iter()
            .map(|e| format!("{}|{}", e["base"].as_str().expect("base"), e["removed"]))
            .collect();
        seen.sort();
        let before = seen.len();
        seen.dedup();
        assert_eq!(seen.len(), before, "a removal set appears twice — the enumeration is wrong");

        // Every shape §1 names is really reachable in the corpus, and nothing else is.
        let mut shapes: Vec<&str> = entries.iter().map(|e| e["shape"].as_str().expect("shape")).collect();
        shapes.sort_unstable();
        shapes.dedup();
        assert_eq!(shapes, vec!["comment + incident evidence", "comment only", "incident evidence only"]);
    }
}
