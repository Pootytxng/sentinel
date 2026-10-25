//! Compy Care **Tier 1** — the signed, pull-only advisory catalog. DARK.
//!
//! Spec: `docs/superpowers/specs/2026-08-09-compy-care-capability-exception-gate.md` §9.
//! Plan: `docs/superpowers/plans/2026-08-09-outbound-case-intelligence-tier1.md`.
//! Owner-approved 2026-08-09 through the Capability Exception Gate (`docs/ARCHITECTURE_LOCKS.md`
//! §1.8). This file is task 2 of that plan: the domain types and their strict parser, nothing else.
//!
//! **What Tier 1 is.** Compy downloads a signed catalog of *public advisory knowledge* — "this crash
//! shape has been seen and written up, here is the vendor's page" — and matches it against crash
//! incidents that were ALREADY read off the local machine. It is the download half of the outbound
//! model and nothing else: **Tier 1 uploads no machine data at all**. Tier 2 (a scrubbed usage
//! fingerprint, `receipts.rs`) and Tier 3 (explicit per-case evidence) are separate capabilities with
//! separate consent and separate transport, and this module must never become a path to either.
//!
//! **HARD LINES held here:**
//! - **Trust separation.** Tier 1 does NOT live in `remote_rules.rs` (privileged mutation policy),
//!   `receipts.rs` (Tier 2) or `support_evidence.rs` (local support record), and it does not run in
//!   the webview. It gets its own key, its own manifest/canonicalization version, its own endpoint
//!   allowlist, its own cache and its own gate. Sharing a crypto primitive is allowed only while the
//!   type system keeps the trust roots, manifest types and cache namespaces distinct.
//! - **No mutation, ever.** A catalog entry is text and a link. The schema is structurally incapable
//!   of carrying a registry path, a service or task name, a command, or an action id, and this module
//!   cannot import `AppliedAction`, `RollbackAction` or `Recommendation`. `actions.rs` remains the one
//!   Windows-mutation boundary and is untouched by Tier 1.
//! - **No arbitrary regex.** Matchers are a closed set of normalized exact / prefix / range checks
//!   over fields Compy already has locally. The token charset excludes every regex metacharacter, so
//!   a catalog cannot smuggle a matcher engine in as data.
//! - **No causal claim.** A match says "this matches the recorded shape", never "this caused it", and
//!   `CaseMatchLevel` carries no numeric confidence — there is no calibration data, so a percentage
//!   would be probability theater.
//! - **Dark.** `case_intelligence_gate()` is hard-false, `CASE_CATALOG_ORIGINS` is EMPTY, and there is
//!   no production key. An empty endpoint allowlist means no manifest can validate at all today; that
//!   is deliberate, and a test pins it.
//!
//! Shape: pure data + a pure parser. No IO, no clock, no network — the transport (task 6) arrives
//! behind the same gate, and every test here runs on strings.

#![allow(dead_code)] // Tier 1 is built dark: these types are wired to a command + the crash station
// in plan tasks 5-9. Until then the module is parsed, tested and unreachable.

use serde::{Deserialize, Serialize};

// ─── Compiled authorities ──────────────────────────────────────────────────
//
// Both lists are owned by the Rust/security review lane and change ONLY through an app release. A
// signed catalog may *select* a URL under an origin that is already here; it can never add one,
// redirect the download, or cause a fetch. They are deliberately two separate lists: where a user's
// click may land is a different question from where Compy may talk to, and merging them would let a
// content decision widen the transport surface.

/// Where a `source_url` may point — the page a user opens in their own browser, after their own
/// click. Public vendor and OS advisory publishers only.
pub(crate) const CASE_SOURCE_ORIGINS: &[&str] = &[
    "https://support.microsoft.com",
    "https://learn.microsoft.com",
    "https://www.amd.com",
    "https://www.nvidia.com",
    "https://www.intel.com",
];

/// Where the catalog itself may be downloaded from. **EMPTY on purpose while Tier 1 is dark** — the
/// production endpoint does not exist yet and arming it is a separate owner-signed decision (plan
/// task 11). While this is empty, no manifest can pass validation, which is the strongest possible
/// statement that the capability is off.
pub(crate) const CASE_CATALOG_ORIGINS: &[&str] = &[];

/// GPU vendors a matcher may name. A closed set, for the same reason the token charset is closed:
/// the catalog selects from what the app already understands, it does not teach the app new words.
const CASE_GPU_VENDORS: &[&str] = &["amd", "intel", "nvidia"];

/// The manifest/catalog schema this build speaks. Bumped only with an app release.
pub(crate) const CASE_SCHEMA_VERSION: u32 = 1;

// Caps. Every one of these is a DoS and blast-radius bound, not a product opinion: a signed catalog
// is still remote input, and remote input that can allocate without limit is a denial of service.
const MAX_ENTRIES: usize = 512;
const MAX_INCIDENT_KINDS: usize = 6;
const MAX_MATCHERS: usize = 16;
const MAX_EVIDENCE_REQS: usize = 8;
const MAX_STEPS: usize = 6;
const MAX_CONTRAINDICATIONS: usize = 6;
const MAX_ID_CHARS: usize = 64;
const MAX_TOKEN_CHARS: usize = 64;
const MAX_TITLE_CHARS: usize = 120;
const MAX_SUMMARY_CHARS: usize = 600;
const MAX_STEP_HEADLINE_CHARS: usize = 120;
const MAX_STEP_DETAIL_CHARS: usize = 600;
const MAX_CONTRAINDICATION_CHARS: usize = 240;
const MAX_URL_CHARS: usize = 300;
const MAX_VERSION_CHARS: usize = 32;
/// Ed25519 signature, hex-encoded — exactly 64 bytes.
const SIGNATURE_HEX_CHARS: usize = 128;
/// SHA-256, hex-encoded.
const SHA256_HEX_CHARS: usize = 64;

/// The Tier 1 runtime gate. Hard-false: no endpoint, no production key, no reachable surface. Mirrors
/// `remote_rules::remote_fetch_enabled()` and `receipts::receipts_gate()` — arming it is a separate
/// owner-signed commit behind an independent security review, never a side effect of a build lane.
pub(crate) fn case_intelligence_gate() -> bool {
    false
}

// ─── Errors ────────────────────────────────────────────────────────────────

/// Why a manifest or catalog was refused. Typed rather than stringly so tests assert on the RULE and
/// not on wording, and so a future UI can report a calm source state without parsing prose.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum CaseCatalogError {
    /// serde refused the document: unknown field, unknown variant, wrong type, malformed JSON.
    Malformed(String),
    /// `schema_version` is not the one this build speaks.
    SchemaVersion { found: u32, expected: u32 },
    /// A count exceeded its compiled cap.
    TooMany { field: &'static str, found: usize, max: usize },
    /// A collection was empty where at least one item is required.
    Empty { field: &'static str },
    /// A string exceeded its compiled cap.
    TooLong { field: &'static str, found: usize, max: usize },
    /// Prose carried markup, a link, or something that reads as an instruction to the machine.
    UnsafeText { field: &'static str, reason: &'static str },
    /// A matcher/id token used a character outside the closed charset (this is what forbids regex).
    BadToken { field: &'static str, value: String },
    /// A version string was not dotted-numeric, or a range was inverted.
    BadVersion { field: &'static str, value: String },
    /// A timestamp was not RFC3339, or a range was inverted.
    BadTimestamp { field: &'static str, value: String },
    /// A URL was not HTTPS, carried userinfo or a port, or was otherwise unusable.
    BadUrl { field: &'static str, value: String },
    /// A URL's origin is not on the compiled allowlist for that field.
    OriginNotAllowed { field: &'static str, origin: String },
    /// Two entries claimed the same id, or one entry repeated a matcher / kind / requirement.
    Duplicate { field: &'static str, value: String },
    /// A hex field was not the exact expected length, or was not lowercase hex.
    BadHex { field: &'static str, expected: usize },
    /// `catalog_version` must be positive AND exactly representable on the other side of the IPC
    /// boundary — see `MAX_JS_EXACT_INT`.
    BadCatalogVersion { found: u64 },
    /// A numeric range was inverted (min greater than max).
    InvertedRange { field: &'static str },
}

impl std::fmt::Display for CaseCatalogError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Malformed(m) => write!(f, "catalog document is malformed: {m}"),
            Self::SchemaVersion { found, expected } => {
                write!(f, "schema_version {found} is not the {expected} this build speaks")
            }
            Self::TooMany { field, found, max } => write!(f, "{field} has {found} items, cap is {max}"),
            Self::Empty { field } => write!(f, "{field} is empty"),
            Self::TooLong { field, found, max } => write!(f, "{field} is {found} chars, cap is {max}"),
            Self::UnsafeText { field, reason } => write!(f, "{field} is not plain advisory text: {reason}"),
            Self::BadToken { field, value } => write!(f, "{field} value {value:?} is not a plain token"),
            Self::BadVersion { field, value } => write!(f, "{field} value {value:?} is not a version"),
            Self::BadTimestamp { field, value } => write!(f, "{field} value {value:?} is not RFC3339"),
            Self::BadUrl { field, value } => write!(f, "{field} value {value:?} is not a usable HTTPS URL"),
            Self::OriginNotAllowed { field, origin } => {
                write!(f, "{field} origin {origin:?} is not on this build's compiled allowlist")
            }
            Self::Duplicate { field, value } => write!(f, "{field} repeats {value:?}"),
            Self::BadHex { field, expected } => write!(f, "{field} must be {expected} lowercase hex chars"),
            Self::BadCatalogVersion { found } => {
                write!(f, "catalog_version {found} is not in 1..={MAX_JS_EXACT_INT}")
            }
            Self::InvertedRange { field } => write!(f, "{field} range is inverted"),
        }
    }
}

type R<T> = Result<T, CaseCatalogError>;

/// `Number.MAX_SAFE_INTEGER` — the largest integer JavaScript represents exactly.
///
/// `catalog_version` is `u64` here and `number` in `src/types.ts`, and every integer past this one
/// silently rounds on the way across the IPC boundary. The frontend PRINTS this value (the Black Box
/// known-issue line names the catalog version), and monotonicity is what stops a stale catalog being
/// replayed — so a rounded copy is both a wrong thing shown to the user and a comparison against a
/// number nobody sent. Small monotonic versions never approach it; a timestamp-derived scheme
/// (nanoseconds, or any id built from a hash) walks straight into it. Refusing at the boundary makes
/// the crossing exact BY CONSTRUCTION instead of by the catalog author's restraint, which is the
/// same reason every other wire field here is bounded rather than trusted.
const MAX_JS_EXACT_INT: u64 = 9_007_199_254_740_991;

// ─── Wire types ────────────────────────────────────────────────────────────

/// The incident families a catalog entry may name.
///
/// **Deliberate deviation from spec §9.3**, which writes `incident_kinds: Vec<IncidentKind>` reusing
/// `blackbox::IncidentKind` directly. That enum is Black Box's INTERNAL classification; making it the
/// deserialization target of a signed remote document would put a private type into a wire contract
/// and couple Black Box's freedom to evolve to a published schema. Tier 1 owns its own wire enum and
/// a total mapping instead, which is the same trust-separation argument §9.1 makes for keys and
/// caches.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub(crate) enum CaseIncidentKind {
    GpuTimeout,
    AppCrash,
    AppHang,
    UnexpectedShutdown,
    BlueScreen,
    HardwareError,
}

impl CaseIncidentKind {
    /// Total, exhaustive mapping from Black Box's internal kind. Written as a `match` with no
    /// wildcard arm on purpose: adding a kind to `blackbox.rs` must fail this file to compile rather
    /// than silently become unmatchable by every catalog entry.
    pub(crate) fn from_incident(kind: crate::blackbox::IncidentKind) -> Self {
        use crate::blackbox::IncidentKind as K;
        match kind {
            K::GpuTimeout => Self::GpuTimeout,
            K::AppCrash => Self::AppCrash,
            K::AppHang => Self::AppHang,
            K::UnexpectedShutdown => Self::UnexpectedShutdown,
            K::BlueScreen => Self::BlueScreen,
            K::HardwareError => Self::HardwareError,
        }
    }
}

/// A local fact an entry requires to be PRESENT before it may match. This is how an entry says "do
/// not offer me unless you actually read the faulting module" — the refuse-to-guess rail, expressed
/// in data.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub(crate) enum EvidenceRequirement {
    FaultingApp,
    FaultingModule,
    ErrorCode,
    GpuVendor,
    GpuDriverVersion,
    WindowsBuild,
    Vitals,
}

/// The closed set of match primitives. **There is no regex variant and there never will be** — the
/// whole point of enumerating these is that a catalog selects from checks the app already implements
/// rather than shipping an expression the app has to run.
///
/// Externally tagged so an unknown variant name is a parse error, with `deny_unknown_fields` so an
/// extra key inside a variant is one too.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum PublicMatcher {
    AppFamilyEquals { value: String },
    AppFamilyPrefix { value: String },
    ModuleFamilyEquals { value: String },
    ModuleFamilyPrefix { value: String },
    ErrorCodeEquals { value: String },
    GpuVendorEquals { value: String },
    GpuDriverVersionRange { min: String, max: String },
    WindowsBuildRange { min: u32, max: u32 },
}

/// One advisory step. Text only — there is no command field, no action id, and no `apply` anything.
/// `research_only` mirrors `blackbox::NextStep::research`: it marks a step whose real-world fix is
/// irreversible (a PSU swap, a repaste, a BIOS flash) and which must therefore be framed as something
/// to look into, never as something to do.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(deny_unknown_fields)]
pub(crate) struct AdvisoryStep {
    pub(crate) headline: String,
    pub(crate) detail: String,
    pub(crate) research_only: bool,
}

/// One known-issue write-up.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub(crate) struct CaseEntry {
    pub(crate) id: String,
    pub(crate) revision: u32,
    pub(crate) incident_kinds: Vec<CaseIncidentKind>,
    pub(crate) matchers: Vec<PublicMatcher>,
    pub(crate) required_evidence: Vec<EvidenceRequirement>,
    pub(crate) title: String,
    pub(crate) summary: String,
    pub(crate) next_steps: Vec<AdvisoryStep>,
    pub(crate) contraindications: Vec<String>,
    pub(crate) source_url: String,
    pub(crate) source_updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub(crate) struct CaseCatalog {
    pub(crate) schema_version: u32,
    pub(crate) entries: Vec<CaseEntry>,
}

/// The small signed document that points at a catalog. Its `signature` covers the canonical bytes of
/// the manifest with `signature` removed (the scheme `remote_rules.rs` uses) but under a **separate
/// key and a separate canonicalization version** — task 3 owns the verifier; this type is only its
/// strictly-parsed input.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub(crate) struct CaseCatalogManifest {
    pub(crate) schema_version: u32,
    pub(crate) catalog_version: u64,
    pub(crate) created_at: String,
    pub(crate) expires_at: String,
    pub(crate) min_app_version: String,
    pub(crate) max_app_version: String,
    pub(crate) catalog_sha256: String,
    pub(crate) catalog_url: String,
    pub(crate) signature: String,
}

// ─── Match result ──────────────────────────────────────────────────────────

/// How much the local evidence lines up with a written-up case. **No numeric confidence, ever.**
/// `MatchedKnownIssue` is still only "matches the recorded shape", never "caused".
#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum CaseMatchLevel {
    /// No catalog has ever been verified on this machine.
    NoCatalog,
    /// A catalog exists but could not be used right now (stale, unreadable, refresh refused).
    CatalogUnavailable,
    /// The catalog was consulted and nothing matched. This is a real, useful answer.
    NoKnownMatch,
    /// Some matchers hit, but a required piece of evidence was missing.
    PossibleKnownIssue,
    /// Every matcher hit and every required piece of evidence was present.
    MatchedKnownIssue,
}

/// What the crash station may render. Built from a verified catalog entry plus the local incident;
/// carries no command, no action, and no percentage.
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub(crate) struct CaseIntelligenceMatch {
    pub(crate) case_id: String,
    pub(crate) catalog_version: u64,
    pub(crate) level: CaseMatchLevel,
    pub(crate) title: String,
    pub(crate) summary: String,
    /// Which local facts lined up, in plain words — the "why" a reader is owed.
    pub(crate) evidence_refs: Vec<String>,
    pub(crate) next_steps: Vec<AdvisoryStep>,
    /// The entry's own caveats, carried at EVERY level. Spec §9.4 does not list this field; showing
    /// advice while withholding the caveat that says when not to take it is exactly the kind of
    /// omission the honesty rules exist to prevent, so it is here deliberately.
    pub(crate) contraindications: Vec<String>,
    pub(crate) source_url: String,
    pub(crate) source_updated_at: String,
}

// ─── Parsing ───────────────────────────────────────────────────────────────

/// Parse and fully validate a catalog document. Strict parse first (serde rejects unknown fields and
/// unknown variants), then explicit post-parse validation for everything serde cannot express: caps,
/// charsets, allowlists and cross-entry uniqueness.
pub(crate) fn parse_catalog(json: &str) -> R<CaseCatalog> {
    let catalog: CaseCatalog =
        serde_json::from_str(json).map_err(|e| CaseCatalogError::Malformed(e.to_string()))?;
    catalog.validate()?;
    Ok(catalog)
}

// ─── Validation primitives ─────────────────────────────────────────────────

/// Substrings that disqualify a string from being plain advisory prose, each with the reason a
/// reviewer would give. Two families, and the second is the one that matters most:
///
/// 1. **Markup and links.** The crash station renders catalog text as text. Refusing `<`, backticks,
///    markdown links, entity escapes and interpolation means a catalog can never become a rendering
///    instruction even if a future surface renders rich text by mistake. Bare URLs are refused too:
///    the ONLY link an entry may carry is `source_url`, which goes through the origin allowlist, so
///    a URL smuggled into prose would be a link that skipped the check.
/// 2. **Anything that reads as an instruction to the machine.** Compy's mutation boundary is
///    `actions.rs` and a catalog can never reach it — but a step that says "paste this into
///    powershell" turns the USER into the mutation boundary, with no snapshot, no receipt and no
///    rollback. That is the rollback-first rail being routed around through a human, and it is
///    refused for exactly the same reason a command field is not in the schema.
const FORBIDDEN_PROSE: &[(&str, &str)] = &[
    ("<", "markup"),
    (">", "markup"),
    ("`", "code span"),
    ("\\", "escape or path separator"),
    ("](", "markdown link"),
    ("${", "interpolation"),
    ("&#", "html entity"),
    ("http://", "an inline link that would skip the source allowlist"),
    ("https://", "an inline link that would skip the source allowlist"),
    ("javascript:", "a script url"),
    ("data:", "an inline data url"),
    ("powershell", "a shell the reader would be told to run"),
    ("cmd.exe", "a shell the reader would be told to run"),
    ("reg add", "a registry write"), // mutation-boundary-allow: the BANNED substring, listed so no signed document can carry it
    ("reg delete", "a registry write"), // mutation-boundary-allow: same — this list refuses the command, it never runs one
    ("regedit", "a registry editor"),
    ("sc.exe", "a service change"),
    ("schtasks", "a scheduled-task change"),
    ("bcdedit", "a boot-configuration change"),
    ("netsh", "a network-stack change"),
    ("wmic", "a management command"),
    ("rundll32", "an executable invocation"),
    ("hkey_", "a registry path"),
    ("hklm", "a registry path"),
    ("hkcu", "a registry path"),
    (".bat", "an executable file"),
    (".cmd", "an executable file"),
    (".ps1", "an executable file"),
    (".reg", "a registry import file"),
    (".msi", "an installer"),
    (".vbs", "an executable file"),
    (".exe", "an executable file"),
];

/// Plain advisory prose: present, within its cap, free of control characters, and free of everything
/// in `FORBIDDEN_PROSE`. The order is deliberate — absence and size are cheaper and more specific
/// answers than "unsafe", so a reviewer reading a rejection learns the most useful thing first.
fn check_prose(field: &'static str, value: &str, max: usize) -> R<()> {
    if value.trim().is_empty() {
        return Err(CaseCatalogError::Empty { field });
    }
    let found = value.chars().count();
    if found > max {
        return Err(CaseCatalogError::TooLong { field, found, max });
    }
    if value.chars().any(char::is_control) {
        return Err(CaseCatalogError::UnsafeText { field, reason: "a control character" });
    }
    let lowered = value.to_ascii_lowercase();
    for (needle, reason) in FORBIDDEN_PROSE {
        if lowered.contains(needle) {
            return Err(CaseCatalogError::UnsafeText { field, reason });
        }
    }
    Ok(())
}

/// A plain token: lowercase ASCII alphanumerics plus `.`, `_` and `-`, starting alphanumeric, with no
/// `..` run. **This is the rule that makes an arbitrary regex unrepresentable** — every metacharacter
/// (`* + ? | ^ $ ( ) [ ] { } \`) is outside the charset, so a pattern cannot arrive disguised as a
/// value. It also happens to make every token path-safe and shell-safe, which is a second reason to
/// keep it this narrow. Lowercase is REQUIRED rather than normalized: the catalog ships normalized
/// values and the app normalizes the local field at match time, so there is exactly one place that
/// decides what "the same" means.
fn check_token(field: &'static str, value: &str, max: usize) -> R<()> {
    let bad = || CaseCatalogError::BadToken { field, value: value.to_string() };
    if value.is_empty() || value.chars().count() > max {
        return Err(bad());
    }
    if !value.starts_with(|c: char| c.is_ascii_lowercase() || c.is_ascii_digit()) {
        return Err(bad());
    }
    if value.contains("..") {
        return Err(bad());
    }
    if !value
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '_' | '-'))
    {
        return Err(bad());
    }
    Ok(())
}

/// Dotted-numeric version, one to four groups. Returned padded to four so two versions are comparable
/// by plain `Vec` ordering — `24.10` and `24.10.0.0` are the same release and must not sort apart.
fn parse_version(field: &'static str, value: &str) -> R<Vec<u32>> {
    let bad = || CaseCatalogError::BadVersion { field, value: value.to_string() };
    if value.is_empty() || value.chars().count() > MAX_VERSION_CHARS {
        return Err(bad());
    }
    let mut parts: Vec<u32> = Vec::new();
    for group in value.split('.') {
        if group.is_empty() || group.len() > 6 || !group.bytes().all(|b| b.is_ascii_digit()) {
            return Err(bad());
        }
        parts.push(group.parse::<u32>().map_err(|_| bad())?);
    }
    if parts.is_empty() || parts.len() > 4 {
        return Err(bad());
    }
    parts.resize(4, 0);
    Ok(parts)
}

fn parse_time(field: &'static str, value: &str) -> R<chrono::DateTime<chrono::FixedOffset>> {
    chrono::DateTime::parse_from_rfc3339(value)
        .map_err(|_| CaseCatalogError::BadTimestamp { field, value: value.to_string() })
}

/// Exactly `expected` lowercase hex characters. Uppercase is refused rather than folded so a digest
/// or signature has exactly one spelling — two spellings of the same bytes is how a cache key and a
/// comparison quietly disagree.
fn check_hex(field: &'static str, value: &str, expected: usize) -> R<()> {
    if value.len() != expected || !value.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) {
        return Err(CaseCatalogError::BadHex { field, expected });
    }
    Ok(())
}

/// An HTTPS URL whose EXACT origin is on the given compiled allowlist.
///
/// The origin is taken as the authority up to the first `/`, and userinfo or a port makes the URL
/// unusable rather than merely unlisted: `https://www.amd.com@evil.test/` and
/// `https://www.amd.com.evil.test/` are the two shapes that beat a substring or prefix check, and a
/// pinned port is a different endpoint than the one that was reviewed.
fn check_url(field: &'static str, url: &str, allowed: &[&str]) -> R<()> {
    let bad = || CaseCatalogError::BadUrl { field, value: url.to_string() };
    if url.is_empty() || url.chars().count() > MAX_URL_CHARS {
        return Err(bad());
    }
    if url.chars().any(|c| !c.is_ascii_graphic()) {
        return Err(bad());
    }
    let rest = url.strip_prefix("https://").ok_or_else(bad)?;
    let authority = match rest.find('/') {
        Some(at) => &rest[..at],
        None => rest,
    };
    if authority.is_empty() || authority.contains('@') || authority.contains(':') {
        return Err(bad());
    }
    let origin = format!("https://{authority}");
    if !allowed.contains(&origin.as_str()) {
        return Err(CaseCatalogError::OriginNotAllowed { field, origin });
    }
    Ok(())
}

/// Refuse a repeated item. Callers pass small vectors (capped in the low tens) so a linear scan is
/// both fine and easier to read than a hash set that would need `Hash` on every wire type.
fn check_unique<T: PartialEq + std::fmt::Debug>(field: &'static str, items: &[T]) -> R<()> {
    for (i, item) in items.iter().enumerate() {
        if items[..i].contains(item) {
            return Err(CaseCatalogError::Duplicate { field, value: format!("{item:?}") });
        }
    }
    Ok(())
}

fn check_count<T>(field: &'static str, items: &[T], max: usize, required: bool) -> R<()> {
    if required && items.is_empty() {
        return Err(CaseCatalogError::Empty { field });
    }
    if items.len() > max {
        return Err(CaseCatalogError::TooMany { field, found: items.len(), max });
    }
    Ok(())
}

// ─── Validation ────────────────────────────────────────────────────────────

impl PublicMatcher {
    fn validate(&self) -> R<()> {
        match self {
            Self::AppFamilyEquals { value } | Self::AppFamilyPrefix { value } => {
                check_token("matchers.app_family", value, MAX_TOKEN_CHARS)
            }
            Self::ModuleFamilyEquals { value } | Self::ModuleFamilyPrefix { value } => {
                check_token("matchers.module_family", value, MAX_TOKEN_CHARS)
            }
            Self::ErrorCodeEquals { value } => check_token("matchers.error_code", value, MAX_TOKEN_CHARS),
            Self::GpuVendorEquals { value } => {
                check_token("matchers.gpu_vendor", value, MAX_TOKEN_CHARS)?;
                if !CASE_GPU_VENDORS.contains(&value.as_str()) {
                    return Err(CaseCatalogError::BadToken {
                        field: "matchers.gpu_vendor",
                        value: value.clone(),
                    });
                }
                Ok(())
            }
            Self::GpuDriverVersionRange { min, max } => {
                let lo = parse_version("matchers.gpu_driver_version_range.min", min)?;
                let hi = parse_version("matchers.gpu_driver_version_range.max", max)?;
                if lo > hi {
                    return Err(CaseCatalogError::InvertedRange { field: "matchers.gpu_driver_version_range" });
                }
                Ok(())
            }
            Self::WindowsBuildRange { min, max } => {
                if min > max {
                    return Err(CaseCatalogError::InvertedRange { field: "matchers.windows_build_range" });
                }
                Ok(())
            }
        }
    }
}

impl CaseEntry {
    fn validate(&self) -> R<()> {
        check_token("id", &self.id, MAX_ID_CHARS)?;

        check_count("incident_kinds", &self.incident_kinds, MAX_INCIDENT_KINDS, true)?;
        check_unique("incident_kinds", &self.incident_kinds)?;

        check_count("matchers", &self.matchers, MAX_MATCHERS, true)?;
        for matcher in &self.matchers {
            matcher.validate()?;
        }
        check_unique("matchers", &self.matchers)?;

        check_count("required_evidence", &self.required_evidence, MAX_EVIDENCE_REQS, false)?;
        check_unique("required_evidence", &self.required_evidence)?;

        check_prose("title", &self.title, MAX_TITLE_CHARS)?;
        check_prose("summary", &self.summary, MAX_SUMMARY_CHARS)?;

        check_count("next_steps", &self.next_steps, MAX_STEPS, true)?;
        for step in &self.next_steps {
            check_prose("next_steps.headline", &step.headline, MAX_STEP_HEADLINE_CHARS)?;
            check_prose("next_steps.detail", &step.detail, MAX_STEP_DETAIL_CHARS)?;
        }

        check_count("contraindications", &self.contraindications, MAX_CONTRAINDICATIONS, false)?;
        for text in &self.contraindications {
            check_prose("contraindications", text, MAX_CONTRAINDICATION_CHARS)?;
        }

        check_url("source_url", &self.source_url, CASE_SOURCE_ORIGINS)?;
        parse_time("source_updated_at", &self.source_updated_at)?;
        Ok(())
    }
}

impl CaseCatalog {
    fn validate(&self) -> R<()> {
        if self.schema_version != CASE_SCHEMA_VERSION {
            return Err(CaseCatalogError::SchemaVersion {
                found: self.schema_version,
                expected: CASE_SCHEMA_VERSION,
            });
        }
        // The cap is enforced BEFORE the entries are walked: a document with a million entries is a
        // denial of service whether or not entry number seven is well formed.
        check_count("entries", &self.entries, MAX_ENTRIES, false)?;
        for entry in &self.entries {
            entry.validate()?;
        }
        let ids: Vec<&str> = self.entries.iter().map(|e| e.id.as_str()).collect();
        check_unique("entries.id", &ids)?;
        Ok(())
    }
}

impl CaseCatalogManifest {
    fn validate(&self) -> R<()> {
        self.validate_with(CASE_CATALOG_ORIGINS)
    }

    /// The allowlist is a parameter so the OTHER manifest rules stay reachable in tests while the
    /// production list is empty. `validate()` is the only production entry point and always passes
    /// the compiled list; a test that injects an origin is testing the rule, never the policy.
    ///
    /// This is validation only — steps 1-8 of spec §9.2's required order, minus the signature check,
    /// which belongs to the verifier in plan task 3 and must run on the canonical bytes rather than
    /// on a parsed struct. Nothing here downloads, caches or trusts anything.
    fn validate_with(&self, catalog_origins: &[&str]) -> R<()> {
        if self.schema_version != CASE_SCHEMA_VERSION {
            return Err(CaseCatalogError::SchemaVersion {
                found: self.schema_version,
                expected: CASE_SCHEMA_VERSION,
            });
        }
        if self.catalog_version == 0 || self.catalog_version > MAX_JS_EXACT_INT {
            return Err(CaseCatalogError::BadCatalogVersion { found: self.catalog_version });
        }

        let created = parse_time("created_at", &self.created_at)?;
        let expires = parse_time("expires_at", &self.expires_at)?;
        if expires <= created {
            return Err(CaseCatalogError::BadTimestamp {
                field: "expires_at",
                value: self.expires_at.clone(),
            });
        }

        let min = parse_version("min_app_version", &self.min_app_version)?;
        let max = parse_version("max_app_version", &self.max_app_version)?;
        if min > max {
            return Err(CaseCatalogError::InvertedRange { field: "app_version" });
        }

        check_hex("catalog_sha256", &self.catalog_sha256, SHA256_HEX_CHARS)?;
        check_hex("signature", &self.signature, SIGNATURE_HEX_CHARS)?;
        check_url("catalog_url", &self.catalog_url, catalog_origins)?;
        Ok(())
    }
}

// ─── Signing trust ─────────────────────────────────────────────────────────
//
// Plan task 3. Tier 1 downloads a document written by someone else, so the ONLY thing standing
// between a CDN compromise and the crash station's text is this chain:
//
//   compiled public key  →  verifies a signature over  →  the context-prefixed canonical manifest
//                        →  whose `catalog_sha256` must equal  →  SHA-256(catalog bytes)
//                        →  which then parse strictly under the task-2 rules
//
// SHA-256 alone is not enough: whoever can replace the catalog can replace its checksum in the same
// request. Only the signature is anchored in the binary.
//
// **Trust separation from `remote_rules.rs` is enforced three ways, not one.** A different key is
// the weakest of them, because keys get reused by accident:
//
//  1. **Domain separation in the signed bytes.** Tier 1 signs `CASE_MANIFEST_SIGNING_CONTEXT` ++
//     canonical JSON; remote rules sign the canonical JSON alone. Even if the same private key were
//     used for both by mistake, a remote-rules signature cannot verify here and a Tier 1 signature
//     cannot authorize privileged mutation policy there. This is the property that survives operator
//     error, so it is the one worth having.
//  2. **A distinct key newtype.** `CaseSigningKey` is not `[u8; 32]`, so handing this verifier the
//     remote-rules key is a visible, greppable wrapping and never an implicit coercion.
//  3. **Disjoint schemas.** A remote-rules manifest names `ruleset_version` / `rules_sha256`;
//     `CaseCatalogManifest` is `deny_unknown_fields`, so it is refused as malformed regardless.
//
// **Verification order deviates from `remote_rules.rs` deliberately.** That module parses the
// manifest into its typed struct and then checks the signature. This one checks the signature FIRST
// and runs the strict parse and the task-2 domain validation only on bytes that are already proven
// authentic. Nothing downstream of an unverified document should run, and the generic
// `serde_json::Value` needed to rebuild the signed payload is the smallest possible amount of
// reading to do before that proof exists.

/// Tier 1's Ed25519 trust root. A newtype rather than a bare `[u8; 32]` so the remote-rules key
/// cannot be passed to this verifier by a plain reference — see note 2 above.
///
/// The bytes are a PUBLIC key and are not secret; nothing is redacted here, because pretending a
/// public key is a secret would be security theater. What is genuinely kept out of the record is the
/// signature: `CaseTrustError` carries no signature bytes and no document content, so a failure can
/// be logged without logging the artifact that failed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct CaseSigningKey([u8; 32]);

impl CaseSigningKey {
    pub(crate) const fn new(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }

    /// All-zeros is not a usable Ed25519 public key, so this is a compile-time "there is no trust
    /// root yet" rather than a flag someone can flip in config.
    fn is_placeholder(&self) -> bool {
        self.0 == [0u8; 32]
    }
}

/// THE production trust root, and it is deliberately the all-zeros placeholder. Shipping a
/// development key would let anyone who reads the binary mint a catalog. The real key is generated
/// offline and its private half NEVER enters this repo, `.env*` or CI; replacing this constant is
/// part of the owner-signed arming commit (plan task 11), not of any build lane.
const CASE_SIGNING_PUBKEY: CaseSigningKey = CaseSigningKey::new([0u8; 32]);

/// The domain-separation prefix — Tier 1's own canonicalization version. Bump the trailing version
/// whenever the canonical form changes, so old signatures stop verifying instead of quietly meaning
/// something new.
const CASE_MANIFEST_SIGNING_CONTEXT: &[u8] = b"compy.case-intelligence.manifest.v1\n";

/// Manifests are a few hundred bytes; 4 KB is already generous.
const CASE_MANIFEST_MAX_BYTES: usize = 4096;

/// Transport cap on the catalog body. This is the OUTER bound and it binds before `MAX_ENTRIES`
/// does: 512 entries each near their per-field maxima would be several megabytes, so a catalog that
/// large is refused by bytes and never reaches the parser. That is the intended relationship — the
/// byte cap protects memory and the entry cap protects meaning, and the cheaper one runs first.
const CASE_CATALOG_MAX_BYTES: usize = 1024 * 1024;

/// Why a catalog download was not trusted. Kept separate from `CaseCatalogError` because these are
/// different questions: that type answers "is this document well formed", this one answers "did this
/// document really come from us, unaltered, and is it still current". A caller that conflates them
/// would report a tampered catalog as a typo.
///
/// No variant carries signature bytes, key bytes or document content — see `CaseSigningKey`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum CaseTrustError {
    /// A document exceeded its transport cap. Checked before anything parses it.
    Oversize { field: &'static str, found: usize, max: usize },
    /// The manifest was not even JSON, so there was nothing to verify.
    Malformed(String),
    /// The manifest carried no `signature`, or it was not a string.
    MissingSignature,
    /// `signature` was not exactly 128 lowercase hex characters, or did not decode to a signature.
    BadSignatureFormat,
    /// The compiled trust root is still the all-zeros placeholder: Tier 1 has no key, so nothing can
    /// be trusted. This is the state the shipped binary is in.
    PlaceholderKey,
    /// The signature did not verify over the context-prefixed canonical manifest bytes.
    SignatureInvalid,
    /// The catalog body's SHA-256 does not match the digest the signed manifest committed to.
    DigestMismatch,
    /// An older catalog was served in place of a newer one — the rollback attack.
    CatalogVersionRollback { latest: u64, attempted: u64 },
    /// `created_at` is in the future: a clock is wrong, or a document was published early.
    NotYetValid,
    /// `expires_at` has passed — the freeze attack, where a valid-but-stale document is replayed.
    Expired,
    /// This build is outside the manifest's `[min_app_version, max_app_version]` bracket.
    AppVersionOutOfRange { current: String },
    /// The document was authentic but did not satisfy the task-2 domain rules.
    Schema(CaseCatalogError),
}

impl std::fmt::Display for CaseTrustError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Oversize { field, found, max } => {
                write!(f, "{field} is {found} bytes, transport cap is {max}")
            }
            Self::Malformed(m) => write!(f, "manifest is not JSON: {m}"),
            Self::MissingSignature => write!(f, "manifest carries no signature"),
            Self::BadSignatureFormat => write!(f, "signature is not 128 lowercase hex characters"),
            Self::PlaceholderKey => {
                write!(f, "no case-intelligence trust root is compiled into this build")
            }
            Self::SignatureInvalid => write!(f, "signature does not verify against this build's key"),
            Self::DigestMismatch => write!(f, "catalog does not match the digest the manifest signed"),
            Self::CatalogVersionRollback { latest, attempted } => {
                write!(f, "catalog_version {attempted} is older than the {latest} already seen")
            }
            Self::NotYetValid => write!(f, "manifest is not valid yet"),
            Self::Expired => write!(f, "manifest has expired"),
            Self::AppVersionOutOfRange { current } => {
                write!(f, "app version {current} is outside the manifest's supported range")
            }
            Self::Schema(e) => write!(f, "{e}"),
        }
    }
}

impl From<CaseCatalogError> for CaseTrustError {
    fn from(e: CaseCatalogError) -> Self {
        Self::Schema(e)
    }
}

type T<X> = Result<X, CaseTrustError>;

/// Everything the chain needs that is not the documents themselves. Bundled so the production entry
/// point can build it from compiled constants and the clock while tests can build it from fixtures —
/// the same code path either way, which is the point: a test must not be able to take a shortcut a
/// download cannot.
#[derive(Clone)]
struct CaseTrustContext<'a> {
    key: &'a CaseSigningKey,
    catalog_origins: &'a [&'a str],
    now: chrono::DateTime<chrono::Utc>,
    app_version: &'a str,
    last_seen_catalog_version: u64,
}

/// Decode lowercase hex. Deliberately NOT shared with `remote_rules.rs`, which has its own copy.
/// Twenty lines of duplication is the cheaper mistake here: a shared crypto helper is a single place
/// where one edit silently changes both trust domains at once, which is exactly the coupling §9.1
/// tells Tier 1 not to have.
fn hex_to_bytes(value: &str) -> Option<Vec<u8>> {
    if !value.len().is_multiple_of(2) {
        return None;
    }
    let mut out = Vec::with_capacity(value.len() / 2);
    let bytes = value.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let nyb = |b: u8| match b {
            b'0'..=b'9' => Some(b - b'0'),
            b'a'..=b'f' => Some(b - b'a' + 10),
            _ => None,
        };
        out.push((nyb(bytes[i])? << 4) | nyb(bytes[i + 1])?);
        i += 2;
    }
    Some(out)
}

/// Rebuild the exact bytes the signer signed: the domain-separation context, then the canonical JSON
/// of the manifest with `signature` removed. Returns those bytes alongside the signature hex it
/// pulled out.
///
/// `serde_json` is not RFC 8785, but it is deterministic for a given `Value` (objects are
/// `BTreeMap`-backed while `preserve_order` is off, which is the default and what this crate builds
/// with), and the signer runs the same serializer. That equality IS the contract — if it ever stops
/// holding, every signature stops verifying, which is the safe direction to fail in.
fn canonical_signed_payload(raw_manifest: &[u8]) -> T<(Vec<u8>, String)> {
    let mut value: serde_json::Value =
        serde_json::from_slice(raw_manifest).map_err(|e| CaseTrustError::Malformed(e.to_string()))?;
    let obj = value.as_object_mut().ok_or(CaseTrustError::MissingSignature)?;
    let signature = match obj.remove("signature") {
        Some(serde_json::Value::String(s)) => s,
        _ => return Err(CaseTrustError::MissingSignature),
    };
    let mut payload = CASE_MANIFEST_SIGNING_CONTEXT.to_vec();
    payload.extend_from_slice(
        &serde_json::to_vec(&value).map_err(|e| CaseTrustError::Malformed(e.to_string()))?,
    );
    Ok((payload, signature))
}

/// Prove a manifest is authentic, then hold it to the task-2 domain rules.
///
/// Order: transport cap → rebuild the signed payload → signature format → Ed25519 verify → strict
/// typed parse → `validate_with`. Only the last two steps read the document as a manifest, and they
/// run only after the signature has already proven it is ours.
fn verify_manifest_with(raw_manifest: &[u8], cx: &CaseTrustContext<'_>) -> T<CaseCatalogManifest> {
    use ed25519_compact::{PublicKey, Signature};

    // The compiled trust root is checked HERE, at the funnel every path crosses — not only in the
    // `verify_catalog_chain` wrapper below. Found by the #221 pre-merge review: the cache store, the
    // cache read and the refresh all call this function directly, so a check living only in that
    // wrapper never ran on any real path.
    //
    // Without this line an all-zero key is not caught by `PublicKey::from_slice` (32 zero bytes are
    // a well-formed slice); it reaches `.verify()`, which rejects it as a WEAK key, and the whole
    // thing surfaces as `SignatureInvalid` — "they sent us a bad signature" when the truth is "this
    // build has no trust root and never accepts anything". Correct refusal, wrong diagnosis, and the
    // wrong one is what a future reader would act on.
    if cx.key.is_placeholder() {
        return Err(CaseTrustError::PlaceholderKey);
    }

    if raw_manifest.len() > CASE_MANIFEST_MAX_BYTES {
        return Err(CaseTrustError::Oversize {
            field: "manifest",
            found: raw_manifest.len(),
            max: CASE_MANIFEST_MAX_BYTES,
        });
    }

    let (payload, signature_hex) = canonical_signed_payload(raw_manifest)?;

    // The same lowercase-hex rule the schema applies, enforced here too — the strict parse has not
    // run yet at this point, and a signature is not something to be lenient about.
    check_hex("signature", &signature_hex, SIGNATURE_HEX_CHARS)
        .map_err(|_| CaseTrustError::BadSignatureFormat)?;
    let signature_bytes = hex_to_bytes(&signature_hex).ok_or(CaseTrustError::BadSignatureFormat)?;
    let signature =
        Signature::from_slice(&signature_bytes).map_err(|_| CaseTrustError::BadSignatureFormat)?;
    let public_key = PublicKey::from_slice(&cx.key.0).map_err(|_| CaseTrustError::PlaceholderKey)?;

    public_key
        .verify(&payload, &signature)
        .map_err(|_| CaseTrustError::SignatureInvalid)?;

    let manifest: CaseCatalogManifest = serde_json::from_slice(raw_manifest)
        .map_err(|e| CaseTrustError::Schema(CaseCatalogError::Malformed(e.to_string())))?;
    manifest.validate_with(cx.catalog_origins)?;
    Ok(manifest)
}

/// The full chain over a fetched (manifest, catalog) pair.
///
/// Freshness is checked against `cx.now` rather than the clock directly so expiry and
/// not-yet-valid are testable without a global, and so a future caller can verify a cached pair
/// against the moment it was cached rather than the moment it is read.
fn verify_chain_with(
    raw_manifest: &[u8],
    raw_catalog: &[u8],
    cx: &CaseTrustContext<'_>,
) -> T<(CaseCatalogManifest, CaseCatalog)> {
    use sha2::{Digest, Sha256};

    if raw_catalog.len() > CASE_CATALOG_MAX_BYTES {
        return Err(CaseTrustError::Oversize {
            field: "catalog",
            found: raw_catalog.len(),
            max: CASE_CATALOG_MAX_BYTES,
        });
    }

    let manifest = verify_manifest_with(raw_manifest, cx)?;

    // The digest binds the body to the signature. Compared as BYTES, not as hex strings: a string
    // compare would be a second place for a spelling to disagree, and the schema's lowercase rule
    // would be load-bearing for security instead of merely for tidiness.
    let mut hasher = Sha256::new();
    hasher.update(raw_catalog);
    let computed = hasher.finalize();
    let expected = hex_to_bytes(&manifest.catalog_sha256).ok_or(CaseTrustError::DigestMismatch)?;
    if computed.as_slice() != expected.as_slice() {
        return Err(CaseTrustError::DigestMismatch);
    }

    if manifest.catalog_version < cx.last_seen_catalog_version {
        return Err(CaseTrustError::CatalogVersionRollback {
            latest: cx.last_seen_catalog_version,
            attempted: manifest.catalog_version,
        });
    }

    // Both timestamps already parsed cleanly inside `validate_with`, so these cannot fail here; the
    // `?` is kept rather than unwrapped because a future reordering must not turn into a panic.
    let created = parse_time("created_at", &manifest.created_at)?;
    let expires = parse_time("expires_at", &manifest.expires_at)?;
    if created > cx.now {
        return Err(CaseTrustError::NotYetValid);
    }
    if expires <= cx.now {
        return Err(CaseTrustError::Expired);
    }

    let current = parse_version("app_version", cx.app_version)?;
    let min = parse_version("min_app_version", &manifest.min_app_version)?;
    let max = parse_version("max_app_version", &manifest.max_app_version)?;
    if current < min || current > max {
        return Err(CaseTrustError::AppVersionOutOfRange { current: cx.app_version.to_string() });
    }

    let catalog: CaseCatalog = parse_catalog(
        std::str::from_utf8(raw_catalog)
            .map_err(|e| CaseTrustError::Schema(CaseCatalogError::Malformed(e.to_string())))?,
    )?;

    // No manifest-vs-catalog schema cross-check, on purpose. Both `validate()` paths pin their
    // document to the SAME compiled `CASE_SCHEMA_VERSION`, so agreement here is structural and a
    // cross-check would be a branch no test could ever reach — and an unreachable branch in
    // security code is where a bug goes to hide. Two tests pin the pinning instead. The day this
    // build speaks more than one schema version, that is the day the cross-check earns its place.
    Ok((manifest, catalog))
}

/// The production-bound verification wrapper: `verify_chain_with` against the COMPILED trust root.
///
/// **Not the shipped entry point** — that is `advise`, which reaches verification through
/// `cache_load_verified`. This is the fourth of the module's production-binding wrappers
/// (`advise`, `cached_catalog`, `match_incident`, this) and, like its siblings, its callers today
/// are the tests that prove Tier 1 is dark; tasks 8–11 are what will call it for real.
///
/// It cannot succeed in this build. The placeholder-key refusal below is a fast path, not the only
/// one: `verify_manifest_with` makes the same check at the funnel every real path crosses, and
/// `CASE_CATALOG_ORIGINS` being empty would refuse a catalog a third time even if a key were
/// present. Independent reasons, any one of which alone keeps Tier 1 dark.
pub(crate) fn verify_catalog_chain(
    raw_manifest: &[u8],
    raw_catalog: &[u8],
    last_seen_catalog_version: u64,
) -> T<(CaseCatalogManifest, CaseCatalog)> {
    if CASE_SIGNING_PUBKEY.is_placeholder() {
        return Err(CaseTrustError::PlaceholderKey);
    }
    verify_chain_with(
        raw_manifest,
        raw_catalog,
        &CaseTrustContext {
            key: &CASE_SIGNING_PUBKEY,
            catalog_origins: CASE_CATALOG_ORIGINS,
            now: chrono::Utc::now(),
            app_version: env!("CARGO_PKG_VERSION"),
            last_seen_catalog_version,
        },
    )
}

// ─── Last-known-good cache ─────────────────────────────────────────────────
//
// Plan task 4. Compy is offline most of the time, so the useful question is not "can we fetch" but
// "what do we still hold that we can still prove". This cache answers that and nothing else.
//
// **One file, not two.** The obvious layout is `manifest.json` beside `catalog.json`, and it is
// wrong: two renames cannot be one atomic act, so an interruption between them leaves a manifest
// describing a catalog that is no longer there. Verification would catch the mismatch — but the
// cost is losing a perfectly good last-known-good copy to a power cut. Both documents go into ONE
// envelope written to one temp file and swapped in with one rename, so the pair is committed
// whole or not at all. The raw bytes are preserved exactly, because a re-serialized document is a
// different document to a signature.
//
// **Verified in, verified out.** `cache_store_verified` runs the full trust chain before it writes,
// and `cache_load_verified` runs it again on every read. The second pass is the one that matters:
// the cache lives in the user's own writable data directory, so anything that can be written there
// by anyone can be written there by anything. A cached catalog gets exactly as much trust as a
// freshly downloaded one — none, until it verifies.
//
// **There is no embedded fallback catalog, deliberately.** Remote *rules* ship an embedded baseline
// because Compy must still have a rule set with no network. Tier 1 is the opposite: it has nothing
// to say unless someone has written the case up, and an embedded catalog would be advisory text
// with a frozen expiry that no revocation could ever reach. No catalog is the honest state, and the
// crash station already renders it as today's behavior — nothing.
//
// **Namespacing.** Everything lives under `%APPDATA%\Compy\case-intelligence\`, which is not the
// Trust Ledger, not the remote-rules cache and not the support-evidence record. Nothing local ever
// goes in: the envelope holds the downloaded documents verbatim and no incident, match, machine
// fact or timestamp of our own.

/// The cache directory name. A dedicated namespace so "clear the advisory cache" can never be one
/// slipped path segment away from clearing the rollback history.
const CASE_CACHE_DIR_NAME: &str = "case-intelligence";

/// The single file the namespace holds. Anything else in that directory is debris.
const CASE_CACHE_FILE_NAME: &str = "last-known-good.json";

/// Envelope schema. Separate from `CASE_SCHEMA_VERSION` on purpose: how Compy stores a catalog on
/// disk is a local implementation detail, and bumping it must not look like the signed wire format
/// changed.
const CASE_CACHE_ENVELOPE_VERSION: u32 = 1;

/// Read cap for the envelope, enforced before it is parsed. The two documents plus JSON string
/// escaping and the wrapper — escaping can at worst double a document, so the slack is generous
/// rather than tight, and its job is only to stop an unbounded read.
const CASE_CACHE_MAX_BYTES: usize = 2 * (CASE_MANIFEST_MAX_BYTES + CASE_CATALOG_MAX_BYTES) + 4096;

/// Why the cache could not be used. `Missing` is the ordinary state, not a fault: a machine that has
/// never fetched a catalog is exactly as healthy as one that has.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum CaseCacheError {
    /// No cached catalog. The normal state, and the one this build always ships in.
    Missing,
    /// The filesystem refused. Never fatal — Tier 1 is advisory, so a broken cache means no advice.
    Io(String),
    /// The envelope exceeded its read cap, refused before parsing.
    Oversize { found: usize, max: usize },
    /// The envelope itself is not readable as an envelope.
    Corrupt(String),
    /// The envelope was intact but the documents inside it did not verify.
    Untrusted(CaseTrustError),
}

impl std::fmt::Display for CaseCacheError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Missing => write!(f, "no cached case catalog"),
            Self::Io(m) => write!(f, "case catalog cache is unreadable: {m}"),
            Self::Oversize { found, max } => {
                write!(f, "case catalog cache is {found} bytes, read cap is {max}")
            }
            Self::Corrupt(m) => write!(f, "case catalog cache is corrupt: {m}"),
            Self::Untrusted(e) => write!(f, "cached case catalog no longer verifies: {e}"),
        }
    }
}

/// The two downloaded documents, verbatim, and nothing else. `deny_unknown_fields` means a future
/// attempt to tuck a local fact in here fails to parse rather than quietly persisting it.
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct CaseCacheEnvelope {
    envelope_version: u32,
    manifest: String,
    catalog: String,
}

/// `%APPDATA%\Compy\case-intelligence\`. Built on `compy_data_dir()` — the READ root. Tier 1 never
/// needs `data_root::mutation_root()` and must never acquire it: a `MutationRoot` is authorization
/// to change Windows and file a receipt, and an advisory download has no business holding one.
pub(crate) fn case_cache_dir() -> std::path::PathBuf {
    crate::compy_data_dir().join(CASE_CACHE_DIR_NAME)
}

fn case_cache_file(dir: &std::path::Path) -> std::path::PathBuf {
    dir.join(CASE_CACHE_FILE_NAME)
}

/// Verify a freshly fetched pair and, only if it verifies, commit it as the new last-known-good.
///
/// Verification is INSIDE this function rather than a precondition on the caller, so there is no
/// version of the call that writes something unproven. The write is a temp file plus one rename —
/// on Windows `std::fs::rename` maps to `MoveFileEx` with `REPLACE_EXISTING`, so an interrupted
/// store can only ever leave the previous good envelope plus an ignorable `.tmp`.
fn cache_store_verified(
    dir: &std::path::Path,
    raw_manifest: &[u8],
    raw_catalog: &[u8],
    cx: &CaseTrustContext<'_>,
) -> Result<CaseCatalogManifest, CaseCacheError> {
    let (manifest, _) =
        verify_chain_with(raw_manifest, raw_catalog, cx).map_err(CaseCacheError::Untrusted)?;

    // Both documents parsed as JSON during verification, so both are valid UTF-8 by construction;
    // the error arm is unreachable and is written as an error rather than an unwrap anyway.
    let envelope = CaseCacheEnvelope {
        envelope_version: CASE_CACHE_ENVELOPE_VERSION,
        manifest: std::str::from_utf8(raw_manifest)
            .map_err(|e| CaseCacheError::Corrupt(e.to_string()))?
            .to_string(),
        catalog: std::str::from_utf8(raw_catalog)
            .map_err(|e| CaseCacheError::Corrupt(e.to_string()))?
            .to_string(),
    };
    let body = serde_json::to_vec(&envelope).map_err(|e| CaseCacheError::Corrupt(e.to_string()))?;

    std::fs::create_dir_all(dir).map_err(|e| CaseCacheError::Io(e.to_string()))?;
    let path = case_cache_file(dir);
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, &body).map_err(|e| CaseCacheError::Io(format!("write: {e}")))?;
    std::fs::rename(&tmp, &path).map_err(|e| CaseCacheError::Io(format!("swap: {e}")))?;
    Ok(manifest)
}

/// Read the last-known-good pair and put it through the full trust chain again.
///
/// Order: read cap → envelope parse → envelope version → trust chain. The cap runs on the file's
/// length before a byte of it is parsed, so a hostile or corrupt multi-megabyte file costs a stat
/// and nothing else.
fn cache_load_verified(
    dir: &std::path::Path,
    cx: &CaseTrustContext<'_>,
) -> Result<(CaseCatalogManifest, CaseCatalog), CaseCacheError> {
    let path = case_cache_file(dir);
    let meta = match std::fs::metadata(&path) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Err(CaseCacheError::Missing),
        Err(e) => return Err(CaseCacheError::Io(e.to_string())),
    };
    if meta.len() > CASE_CACHE_MAX_BYTES as u64 {
        return Err(CaseCacheError::Oversize {
            found: meta.len() as usize,
            max: CASE_CACHE_MAX_BYTES,
        });
    }

    let body = std::fs::read(&path).map_err(|e| CaseCacheError::Io(e.to_string()))?;
    let envelope: CaseCacheEnvelope =
        serde_json::from_slice(&body).map_err(|e| CaseCacheError::Corrupt(e.to_string()))?;
    if envelope.envelope_version != CASE_CACHE_ENVELOPE_VERSION {
        return Err(CaseCacheError::Corrupt(format!(
            "envelope_version {} is not {CASE_CACHE_ENVELOPE_VERSION}",
            envelope.envelope_version
        )));
    }

    verify_chain_with(envelope.manifest.as_bytes(), envelope.catalog.as_bytes(), cx)
        .map_err(CaseCacheError::Untrusted)
}

/// The monotonicity floor for a fresh download: the `catalog_version` of the copy that currently
/// VERIFIES, never a number read out of an unverified file.
///
/// Taken from a verified load with the floor itself set to zero — the cache cannot be its own
/// rollback evidence. If the cached copy no longer verifies (tampered, expired, key rotated) the
/// floor is zero, which is correct: a version nobody can prove is not evidence of anything.
///
/// Someone with write access to the user's data directory can therefore reset the floor. That is
/// not a hole this cache can close — the same access could delete the file outright — and it is why
/// the floor is a freshness heuristic layered on top of the signature, never a substitute for it.
fn cache_floor_version(dir: &std::path::Path, cx: &CaseTrustContext<'_>) -> u64 {
    let mut at_zero = cx.clone();
    at_zero.last_seen_catalog_version = 0;
    cache_load_verified(dir, &at_zero)
        .map(|(manifest, _)| manifest.catalog_version)
        .unwrap_or(0)
}

/// Remove the case-intelligence namespace and nothing else. Scoped to the directory this module
/// owns, so it can never reach the Trust Ledger, a session file or an export.
fn cache_clear(dir: &std::path::Path) -> Result<(), CaseCacheError> {
    match std::fs::remove_dir_all(dir) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(CaseCacheError::Io(e.to_string())),
    }
}

/// Delete anything in the namespace that is not the one file it is supposed to hold — an abandoned
/// `.tmp`, a rename left over from an older layout. This is the file-count cap: the directory holds
/// exactly one file, and everything else is debris rather than data.
fn cache_prune(dir: &std::path::Path) -> Result<usize, CaseCacheError> {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(e) => return Err(CaseCacheError::Io(e.to_string())),
    };
    let mut removed = 0;
    for entry in entries.flatten() {
        // The cache file is the data. The kill switch is not debris either: sweeping it away would
        // turn "off" quietly back into "on" at the next tidy-up.
        if entry.file_name() == CASE_CACHE_FILE_NAME
            || entry.file_name() == CASE_FETCH_DISABLE_FILE
        {
            continue;
        }
        let path = entry.path();
        let ok = if path.is_dir() {
            std::fs::remove_dir_all(&path).is_ok()
        } else {
            std::fs::remove_file(&path).is_ok()
        };
        if ok {
            removed += 1;
        }
    }
    Ok(removed)
}

/// The read every caller actually wants: the catalog if there is one that still proves itself, and
/// `None` otherwise — missing, corrupt, tampered, expired and unverifiable all collapse to the same
/// answer, because they lead to the same behavior. Tier 1 having nothing to say is a normal state,
/// not an error to surface.
///
/// In this build it is always `None`: the production trust root is the all-zeros placeholder, so the
/// verification inside a load cannot succeed no matter what is on disk.
pub(crate) fn cached_catalog() -> Option<(CaseCatalogManifest, CaseCatalog)> {
    if !case_intelligence_gate() {
        return None;
    }
    cache_load_verified(
        &case_cache_dir(),
        &CaseTrustContext {
            key: &CASE_SIGNING_PUBKEY,
            catalog_origins: CASE_CATALOG_ORIGINS,
            now: chrono::Utc::now(),
            app_version: env!("CARGO_PKG_VERSION"),
            last_seen_catalog_version: 0,
        },
    )
    .ok()
}

// ─── Tests ─────────────────────────────────────────────────────────────────
//
// Everything here is a schema test: given a document, is it accepted or refused, and for WHICH rule.
// They assert on typed `CaseCatalogError` variants rather than on message text, so a reworded error
// can never turn a security rule green by accident, and every rejection test mutates the SAME base
// document that a positive-control test proves valid — so a test cannot pass because the document
// was broken for some unrelated reason.

// ─── The local matcher ─────────────────────────────────────────────────────
//
// Plan task 5. Everything here is pure: two plain structs of facts Compy already read off this
// machine, a verified catalog, and a decision. No IO, no clock, no network, and nothing that can be
// serialized into a request — the matching happens entirely on the user's side of the wire, which is
// what makes Tier 1 a download rather than a lookup service.
//
// **The rule for every check is the same: a fact Compy cannot see never satisfies anything.** A
// matcher over an absent fact is false, not "probably". That is the difference between "this matches
// the recorded shape" and a horoscope.
//
// **The matcher writes no prose.** Every word in a result is copied from the catalog entry that was
// signed. Compy contributes the level and which local facts lined up, and nothing else — so the
// honest-language rules in spec §4 are enforced at the catalog's door, not patched up afterwards.

/// The machine facts a catalog may test against, as the caller already has them. Options because
/// "unknown" is a real state on a real machine and must stay distinguishable from a value.
///
/// This is deliberately NOT the hardware snapshot type: it is the smallest set of fields the closed
/// matcher set can reference, so widening what a catalog can see requires widening this struct in a
/// reviewed commit rather than falling out of an unrelated hardware change.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct CaseLocalFacts {
    pub(crate) gpu_vendor: Option<String>,
    pub(crate) gpu_driver_version: Option<String>,
    pub(crate) windows_build: Option<u32>,
}

/// The incident facts a catalog may test against — Black Box's normalized output, adapted.
///
/// `blackbox.rs` is NOT modified for this. The adapter lives on Tier 1's side of the boundary for
/// the same reason `CaseIncidentKind` does: Black Box owns the classification, Tier 1 owns what a
/// signed document is allowed to see, and the day those two want to change independently the seam is
/// already here. It also keeps task 1's characterization tests meaning what they said.
///
/// Neither this nor `CaseLocalFacts` derives `Serialize`, on purpose and with a test: matching is a
/// local decision, so there must be no type in this path that a future `send` could accept.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct CaseIncidentFacts {
    pub(crate) kind: CaseIncidentKind,
    pub(crate) faulting_app: Option<String>,
    pub(crate) faulting_module: Option<String>,
    pub(crate) error_code: Option<String>,
    pub(crate) has_vitals: bool,
}

impl CaseIncidentFacts {
    /// Read the facts off a Black Box incident. Reads, never collects: incident collection stays in
    /// `blackbox.rs` and is not duplicated here.
    pub(crate) fn from_incident(incident: &crate::blackbox::Incident) -> Self {
        Self {
            kind: CaseIncidentKind::from_incident(incident.kind),
            faulting_app: incident.receipt.faulting_app.clone(),
            faulting_module: incident.receipt.faulting_module.clone(),
            error_code: incident.receipt.code.clone(),
            has_vitals: incident.vitals.is_some(),
        }
    }
}

/// Read this machine's own facts out of the hardware snapshot Compy already collects.
///
/// Pure and total, and every field is an Option that stays `None` when the value is not honestly
/// readable. That is the same rule the matcher enforces from the other side — an absent fact never
/// satisfies a matcher — and it only holds if nothing upstream quietly invents a value first. So a
/// blank driver string is absent rather than `""`, an unparseable build is absent rather than `0`,
/// and an adapter Compy does not recognise has no vendor rather than a guess.
///
/// Reads, never collects: the hardware snapshot is `hardware.rs`'s job and is not duplicated here.
pub(crate) fn local_facts_from(hw: &crate::hardware::HardwareInfo) -> CaseLocalFacts {
    let gpu = hw.gpus.first();
    CaseLocalFacts {
        gpu_vendor: gpu.and_then(|g| vendor_token(&g.name)).map(str::to_string),
        gpu_driver_version: gpu
            .map(|g| g.driver_version.trim())
            .filter(|v| !v.is_empty())
            .map(str::to_string),
        windows_build: hw
            .windows_version
            .as_ref()
            .and_then(|w| w.build.trim().parse::<u32>().ok()),
    }
}

/// Fold an adapter name to one of the three tokens a catalog is allowed to name, or to nothing.
///
/// The closed set is the point. Adapter names carry marketing text that changes between driver
/// releases, so matching on the raw string would let a catalog entry be written against something
/// that silently stops being true; matching on the token means `gpu_vendor_equals` compares the same
/// three values forever.
fn vendor_token(name: &str) -> Option<&'static str> {
    let lower = name.to_lowercase();
    CASE_GPU_VENDORS.iter().copied().find(|v| lower.contains(v))
}

/// What the matcher concluded.
///
/// A refinement of spec §9.4, not a departure from it: the spec's struct carries a `level`, and it
/// still does. What this enum adds is that the three no-match levels cannot be dressed up as a
/// result — `NoCatalog` has no title, no summary and no source, and a struct that could hold those
/// as empty strings is a card the UI could render blank. `Found` always carries one of the two
/// levels that mean something matched, and a test pins that.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum CaseMatchOutcome {
    /// Nothing to show: `NoCatalog`, `CatalogUnavailable` or `NoKnownMatch`. The crash station renders
    /// all three exactly as it renders today — which is to say, without a known-issue section at all.
    Nothing(CaseMatchLevel),
    /// A written-up case whose recorded shape lines up with this incident.
    Found(Box<CaseIntelligenceMatch>),
}

impl CaseMatchOutcome {
    pub(crate) fn level(&self) -> CaseMatchLevel {
        match self {
            Self::Nothing(level) => *level,
            Self::Found(m) => m.level,
        }
    }
}

impl EvidenceRequirement {
    /// The stable key this requirement is known by. These are KEYS, never values: `evidence_refs`
    /// names which local facts lined up and must never carry the facts themselves, so that a match
    /// can be shown, logged or (in some later tier, with its own consent) transmitted without
    /// carrying an executable name or a driver string along with it.
    pub(crate) fn key(self) -> &'static str {
        match self {
            Self::FaultingApp => "faulting_app",
            Self::FaultingModule => "faulting_module",
            Self::ErrorCode => "error_code",
            Self::GpuVendor => "gpu_vendor",
            Self::GpuDriverVersion => "gpu_driver_version",
            Self::WindowsBuild => "windows_build",
            Self::Vitals => "vitals",
        }
    }

    /// Is this fact present at all? Presence, not agreement — a matcher decides agreement.
    fn present(self, incident: &CaseIncidentFacts, facts: &CaseLocalFacts) -> bool {
        match self {
            Self::FaultingApp => incident.faulting_app.is_some(),
            Self::FaultingModule => incident.faulting_module.is_some(),
            Self::ErrorCode => incident.error_code.is_some(),
            Self::GpuVendor => facts.gpu_vendor.is_some(),
            Self::GpuDriverVersion => facts.gpu_driver_version.is_some(),
            Self::WindowsBuild => facts.windows_build.is_some(),
            Self::Vitals => incident.has_vitals,
        }
    }
}

/// Reduce an executable or module path to the bare family name a catalog token can equal.
///
/// `C:\Windows\System32\DriverStore\amdkmdag.sys` → `amdkmdag`. Case-folded, path-stripped, and one
/// known extension removed. Nothing else is stripped: a name with a character outside the token
/// charset simply cannot equal any token, which is the safe outcome and needs no special case.
fn normalize_family(raw: &str) -> String {
    let base = raw.rsplit(['\\', '/']).next().unwrap_or(raw).trim().to_ascii_lowercase();
    for ext in [".exe", ".dll", ".sys"] {
        if let Some(stem) = base.strip_suffix(ext) {
            return stem.to_string();
        }
    }
    base
}

fn normalize_code(raw: &str) -> String {
    raw.trim().to_ascii_lowercase()
}

impl PublicMatcher {
    /// Which local fact this matcher reads. Used both to evaluate it and to report it.
    fn evidence(&self) -> EvidenceRequirement {
        match self {
            Self::AppFamilyEquals { .. } | Self::AppFamilyPrefix { .. } => {
                EvidenceRequirement::FaultingApp
            }
            Self::ModuleFamilyEquals { .. } | Self::ModuleFamilyPrefix { .. } => {
                EvidenceRequirement::FaultingModule
            }
            Self::ErrorCodeEquals { .. } => EvidenceRequirement::ErrorCode,
            Self::GpuVendorEquals { .. } => EvidenceRequirement::GpuVendor,
            Self::GpuDriverVersionRange { .. } => EvidenceRequirement::GpuDriverVersion,
            Self::WindowsBuildRange { .. } => EvidenceRequirement::WindowsBuild,
        }
    }

    /// Does this matcher hold against the local facts?
    ///
    /// Every arm reads a fact that may be absent, and every arm answers `false` when it is. A prefix
    /// is anchored at the start and nowhere else — there is no substring check here, and a catalog
    /// value like `amd` matches `amdkmdag` but never `xamdy`, because "contains" is how a matcher
    /// language grows into a pattern language.
    fn holds(&self, incident: &CaseIncidentFacts, facts: &CaseLocalFacts) -> bool {
        match self {
            Self::AppFamilyEquals { value } => incident
                .faulting_app
                .as_deref()
                .is_some_and(|app| normalize_family(app) == *value),
            Self::AppFamilyPrefix { value } => incident
                .faulting_app
                .as_deref()
                .is_some_and(|app| normalize_family(app).starts_with(value.as_str())),
            Self::ModuleFamilyEquals { value } => incident
                .faulting_module
                .as_deref()
                .is_some_and(|m| normalize_family(m) == *value),
            Self::ModuleFamilyPrefix { value } => incident
                .faulting_module
                .as_deref()
                .is_some_and(|m| normalize_family(m).starts_with(value.as_str())),
            Self::ErrorCodeEquals { value } => incident
                .error_code
                .as_deref()
                .is_some_and(|code| normalize_code(code) == *value),
            Self::GpuVendorEquals { value } => facts
                .gpu_vendor
                .as_deref()
                .is_some_and(|vendor| vendor.trim().to_ascii_lowercase() == *value),
            Self::GpuDriverVersionRange { min, max } => {
                // A driver string Compy cannot read as a version is not "probably in range".
                let Some(local) = facts.gpu_driver_version.as_deref() else { return false };
                let (Ok(local), Ok(min), Ok(max)) = (
                    parse_version("local", local),
                    parse_version("min", min),
                    parse_version("max", max),
                ) else {
                    return false;
                };
                local >= min && local <= max
            }
            Self::WindowsBuildRange { min, max } => {
                facts.windows_build.is_some_and(|b| b >= *min && b <= *max)
            }
        }
    }
}

/// One entry that survived matching, kept with everything the tie-break needs.
struct Candidate<'a> {
    entry: &'a CaseEntry,
    level: CaseMatchLevel,
    matchers_hit: usize,
    evidence_present: usize,
    refs: Vec<String>,
}

/// Match ONE incident against a verified catalog.
///
/// An entry qualifies only if all three hold:
///  1. the entry names this incident's kind — a write-up about GPU timeouts has nothing to say about
///     a hang, however well its other matchers line up;
///  2. EVERY matcher holds (they are an AND, never a best-of);
///  3. at least one matcher exists — the schema already requires that, and this is the second lock,
///     because an entry with no matchers would match every incident of its kind.
///
/// Then the level: every `required_evidence` present is `MatchedKnownIssue`, anything missing is
/// `PossibleKnownIssue`. Matchers ask whether the facts AGREE; required evidence asks whether Compy
/// can SEE enough to stand behind the answer, and those are different questions.
pub(crate) fn match_facts(
    catalog: &CaseCatalog,
    catalog_version: u64,
    incident: &CaseIncidentFacts,
    facts: &CaseLocalFacts,
) -> CaseMatchOutcome {
    let mut candidates: Vec<Candidate<'_>> = Vec::new();

    for entry in &catalog.entries {
        if !entry.incident_kinds.contains(&incident.kind) {
            continue;
        }
        if entry.matchers.is_empty() || !entry.matchers.iter().all(|m| m.holds(incident, facts)) {
            continue;
        }

        let present: Vec<EvidenceRequirement> = entry
            .required_evidence
            .iter()
            .copied()
            .filter(|r| r.present(incident, facts))
            .collect();
        let level = if present.len() == entry.required_evidence.len() {
            CaseMatchLevel::MatchedKnownIssue
        } else {
            CaseMatchLevel::PossibleKnownIssue
        };

        // What lined up: the facts the matchers actually read, plus the required evidence that was
        // there. Sorted and de-duplicated so the same match always reads the same way.
        let mut refs: Vec<String> = entry
            .matchers
            .iter()
            .map(|m| m.evidence().key().to_string())
            .chain(present.iter().map(|r| r.key().to_string()))
            .collect();
        refs.sort();
        refs.dedup();

        candidates.push(Candidate {
            entry,
            level,
            matchers_hit: entry.matchers.len(),
            evidence_present: present.len(),
            refs,
        });
    }

    // Deterministic, total order — two runs over the same catalog and the same incident must never
    // disagree, and `id` is unique per catalog so the last key breaks every remaining tie.
    candidates.sort_by(|a, b| {
        let rank = |level: CaseMatchLevel| match level {
            CaseMatchLevel::MatchedKnownIssue => 2u8,
            CaseMatchLevel::PossibleKnownIssue => 1,
            _ => 0,
        };
        rank(b.level)
            .cmp(&rank(a.level))
            .then(b.matchers_hit.cmp(&a.matchers_hit))
            .then(b.evidence_present.cmp(&a.evidence_present))
            .then(b.entry.revision.cmp(&a.entry.revision))
            .then(a.entry.id.cmp(&b.entry.id))
    });

    let Some(best) = candidates.first() else {
        return CaseMatchOutcome::Nothing(CaseMatchLevel::NoKnownMatch);
    };

    // The suppression rule. `research_only` marks a step whose real-world fix is irreversible — a PSU
    // swap, a repaste, a BIOS flash. On partial evidence those are withheld entirely: pointing
    // someone at an expensive, unrecoverable action on a maybe is the actual harm this level exists
    // to prevent. On a full match they are kept, still flagged, so the surface frames them as
    // something to look into rather than something to do.
    let next_steps: Vec<AdvisoryStep> = best
        .entry
        .next_steps
        .iter()
        .filter(|step| best.level == CaseMatchLevel::MatchedKnownIssue || !step.research_only)
        .cloned()
        .collect();

    CaseMatchOutcome::Found(Box::new(CaseIntelligenceMatch {
        case_id: best.entry.id.clone(),
        catalog_version,
        level: best.level,
        title: best.entry.title.clone(),
        summary: best.entry.summary.clone(),
        evidence_refs: best.refs.clone(),
        next_steps,
        // Always carried, at every level. A step without its caveat is worse than no step: the caveat
        // is what stops someone doing it in the one situation where it hurts. Spec §9.4 does not list
        // this field; showing advice while withholding its own contraindication would be the kind of
        // omission the honesty rules exist to prevent, so it is here deliberately.
        contraindications: best.entry.contraindications.clone(),
        source_url: best.entry.source_url.clone(),
        source_updated_at: best.entry.source_updated_at.clone(),
    }))
}

/// The `&Incident` entry point: adapt, then match. Kept separate from `match_facts` so the pure core
/// is testable without constructing a whole Black Box incident, and so the ONE place that reads Black
/// Box's internals is a single named function.
pub(crate) fn match_incident(
    catalog: &CaseCatalog,
    catalog_version: u64,
    incident: &crate::blackbox::Incident,
    facts: &CaseLocalFacts,
) -> CaseMatchOutcome {
    match_facts(catalog, catalog_version, &CaseIncidentFacts::from_incident(incident), facts)
}

/// The production trust context: the compiled key, the compiled (empty) origin allowlist, the real
/// clock and this build's version. Factored out so the cache read and the advisory path cannot drift
/// apart on what "trusted" means.
fn production_trust_context() -> CaseTrustContext<'static> {
    CaseTrustContext {
        key: &CASE_SIGNING_PUBKEY,
        catalog_origins: CASE_CATALOG_ORIGINS,
        now: chrono::Utc::now(),
        app_version: env!("CARGO_PKG_VERSION"),
        last_seen_catalog_version: 0,
    }
}

/// The whole path, from "what do we hold" to "what may this incident be told", against a given
/// cache directory and trust context.
///
/// The three empty answers stay DISTINCT here rather than collapsing into one, because they are
/// different facts about Compy and a reader deserves the difference: `NoCatalog` means nothing has
/// ever been fetched, `CatalogUnavailable` means something is held but no longer proves itself, and
/// `NoKnownMatch` means the catalog was consulted and had nothing on this. Only the first is the
/// state of a machine that has simply never been online for it.
fn advise_in(
    dir: &std::path::Path,
    cx: &CaseTrustContext<'_>,
    incident: &CaseIncidentFacts,
    facts: &CaseLocalFacts,
) -> CaseMatchOutcome {
    match cache_load_verified(dir, cx) {
        Err(CaseCacheError::Missing) => CaseMatchOutcome::Nothing(CaseMatchLevel::NoCatalog),
        // Corrupt, oversize, unreadable, tampered, expired, rolled back — all of them mean the same
        // thing to a user: we hold something we cannot stand behind, so we will not use it.
        Err(_) => CaseMatchOutcome::Nothing(CaseMatchLevel::CatalogUnavailable),
        Ok((manifest, catalog)) => {
            match_facts(&catalog, manifest.catalog_version, incident, facts)
        }
    }
}

/// The shipped entry point.
///
/// In this build it always returns `Nothing(NoCatalog)` and never touches the disk: the gate is
/// hard-false, and behind it the placeholder trust root would refuse whatever a load returned anyway.
pub(crate) fn advise(
    incident: &crate::blackbox::Incident,
    facts: &CaseLocalFacts,
) -> CaseMatchOutcome {
    if !case_intelligence_gate() {
        return CaseMatchOutcome::Nothing(CaseMatchLevel::NoCatalog);
    }
    advise_in(
        &case_cache_dir(),
        &production_trust_context(),
        &CaseIncidentFacts::from_incident(incident),
        facts,
    )
}

// ─── The pull path (dark) ──────────────────────────────────────────────────
//
// Plan task 6. Tier 1's transport, and the whole of it. One shape: ask a compiled URL for a file,
// read the answer, refuse everything else.
//
// **This code can only ask.** There is no body, no query string, no custom header, no cookie jar and
// no method other than GET — so there is no field in which a machine fact could travel even by
// accident. That is not a promise about intent; it is the reason `src/case-intelligence-outbound-
// guard.test.ts` can decide the question by reading the source, and why the section banner above is
// load-bearing: the guard slices the file at it and fails loudly if it moves.
//
// **The transport cannot see the facts.** `CaseIncidentFacts`, `CaseLocalFacts` and every match type
// live ABOVE this line and are never named below it. The incident does not travel; the catalog does.
//
// **Explicit refresh only.** No startup poll, no timer, no background thread. A refresh happens
// because something asked for one, and in this build nothing can: the gate is hard-false and the
// endpoint allowlist is empty, so a call refuses before a client is ever constructed.

/// The exact URLs a manifest may be requested from. **EMPTY in this build** — this is the third
/// independent reason no fetch can happen, after the gate and the placeholder trust root.
///
/// Exact URLs, not origins, and separate from `CASE_CATALOG_ORIGINS` (which says where the manifest
/// is then allowed to POINT). Two lists because they answer two questions, and collapsing them would
/// let whoever controls the manifest host nominate the next one.
const CASE_CATALOG_ENDPOINTS: &[&str] = &[];

/// Wall-clock cap on a single request.
const CASE_FETCH_TIMEOUT_SECS: u64 = 15;

/// A constant product name with no version, OS build or machine id in it — the same rule
/// `receipts.rs` follows. A header is data too.
const CASE_FETCH_USER_AGENT: &str = "Compy";

/// The local, DENY-ONLY kill switch: a file in the case-intelligence namespace whose PRESENCE
/// refuses every fetch.
///
/// Deny-only is the property that matters. Its absence enables nothing — the gate still governs — so
/// there is no state of the filesystem that turns Tier 1 on, and nothing in this module writes or
/// deletes it. A switch that can enable is a remote control with a friendly name.
const CASE_FETCH_DISABLE_FILE: &str = "fetch-disabled";

/// What a Tier 1 request may come back as. Deliberately not `reqwest::Response`: the seam hands back
/// a status and a bounded body and nothing else, so no caller can reach a header, a cookie or a
/// streaming handle through it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct CaseHttpResponse {
    pub(crate) status: u16,
    pub(crate) body: Vec<u8>,
}

/// Why a refresh did not happen. Every variant is a refusal Compy can explain in one line.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum CaseFetchError {
    /// The feature is dark. Every shipped build today.
    Gated,
    /// The local deny-only switch is engaged.
    KillSwitch,
    /// No endpoint is compiled in, so there is nowhere to ask.
    NoEndpoint,
    /// A URL that is not on the compiled list. Refused before any client is built.
    OffAllowlist(String),
    /// The network did not answer, or answered in a way the client could not read.
    Transport(String),
    /// A non-200 answer.
    Status(u16),
    /// A redirect. Refused rather than followed — see the policy note on the client.
    Redirected(u16),
    /// The answer was larger than its cap, refused without being kept.
    Oversize { found: usize, max: usize },
    /// It arrived, and it did not prove itself.
    Trust(CaseTrustError),
    /// It proved itself and the disk refused it.
    Cache(CaseCacheError),
}

impl std::fmt::Display for CaseFetchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Gated => write!(f, "case intelligence is off in this build"),
            Self::KillSwitch => write!(f, "case-intelligence downloads are switched off on this PC"),
            Self::NoEndpoint => write!(f, "no case-catalog endpoint is configured"),
            Self::OffAllowlist(url) => write!(f, "{url} is not an allowed case-catalog endpoint"),
            Self::Transport(m) => write!(f, "could not reach the case catalog: {m}"),
            Self::Status(code) => write!(f, "the case catalog answered with status {code}"),
            Self::Redirected(code) => write!(f, "the case catalog redirected ({code}); refused"),
            Self::Oversize { found, max } => {
                write!(f, "the case catalog answered with {found} bytes, cap is {max}")
            }
            Self::Trust(e) => write!(f, "{e}"),
            Self::Cache(e) => write!(f, "{e}"),
        }
    }
}

/// The injected transport seam.
///
/// One method, and look at what it takes: a `&str` and a cap. There is no argument through which a
/// caller could pass an incident, a machine fact or a match — the type signature is the smallest
/// honest statement of "this can only ask", and it is what lets the tests below drive a REAL local
/// HTTP server rather than a mock that agrees with whatever the code does.
pub(crate) trait CaseHttp {
    fn get(&self, url: &str, max_bytes: usize) -> Result<CaseHttpResponse, CaseFetchError>;
}

/// The production transport. Never constructed in a shipped build — every path into it refuses
/// first — but written as it would actually ship, because a seam whose production side is a stub
/// proves nothing about the code that would run.
pub(crate) struct ReqwestCaseHttp;

impl CaseHttp for ReqwestCaseHttp {
    fn get(&self, url: &str, max_bytes: usize) -> Result<CaseHttpResponse, CaseFetchError> {
        // Sync at the seam so the whole refusal chain above it stays sync and testable. Safe to call
        // from a Tauri command thread; it must not be called from inside the async runtime's own
        // worker, and nothing in this build calls it at all.
        tauri::async_runtime::block_on(reqwest_get(url, max_bytes))
    }
}

/// The one place in Tier 1 where a socket is opened.
///
/// Everything about this client is a refusal. No redirect policy means reqwest follows up to ten
/// hops by default and would walk straight off the allowlist, so the policy is `none()` and a 3xx
/// comes back as an error. There is no cookie store (the crate is built without one), no default
/// header beyond the constant user agent, and no way to attach anything to the request.
async fn reqwest_get(url: &str, max_bytes: usize) -> Result<CaseHttpResponse, CaseFetchError> {
    // Install the process-wide crypto provider before building anything. reqwest inherits rustls
    // from the updater plugin through feature unification, and that plugin installs the provider
    // only when an update check actually runs — so building a client first PANICS. Idempotent:
    // `install_default` returns Err when one is already set, which is not an error here.
    let _ = rustls::crypto::ring::default_provider().install_default();

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(CASE_FETCH_TIMEOUT_SECS))
        .user_agent(CASE_FETCH_USER_AGENT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| CaseFetchError::Transport(e.to_string()))?;

    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| CaseFetchError::Transport(e.to_string()))?;

    let status = response.status().as_u16();
    if response.status().is_redirection() {
        return Err(CaseFetchError::Redirected(status));
    }
    if status != 200 {
        return Err(CaseFetchError::Status(status));
    }

    // Refuse on the declared length before reading a byte of it, then refuse again on what actually
    // arrived — a declared length is a claim, and this one comes from the party being checked.
    if let Some(declared) = response.content_length() {
        if declared > max_bytes as u64 {
            return Err(CaseFetchError::Oversize { found: declared as usize, max: max_bytes });
        }
    }
    let body = response.bytes().await.map_err(|e| CaseFetchError::Transport(e.to_string()))?;
    if body.len() > max_bytes {
        return Err(CaseFetchError::Oversize { found: body.len(), max: max_bytes });
    }

    Ok(CaseHttpResponse { status, body: body.to_vec() })
}

/// Is the local deny-only switch engaged? Reads one path and answers; writes nothing, ever.
fn case_fetch_disabled(dir: &std::path::Path) -> bool {
    dir.join(CASE_FETCH_DISABLE_FILE).exists()
}

/// Fetch, verify and commit ONE manifest URL.
///
/// Order matters and is the point: allowlist, then kill switch, then the manifest, then the trust
/// chain, then the body, then the commit. Every refusal that can be made without a request is made
/// without a request — an unreachable endpoint should cost nothing, and a switched-off machine
/// should not be observable to anyone by the requests it stops making.
fn refresh_from<H: CaseHttp>(
    http: &H,
    dir: &std::path::Path,
    cx: &CaseTrustContext<'_>,
    manifest_url: &str,
    endpoints: &[&str],
) -> Result<CaseCatalogManifest, CaseFetchError> {
    if !endpoints.contains(&manifest_url) {
        return Err(CaseFetchError::OffAllowlist(manifest_url.to_string()));
    }
    if case_fetch_disabled(dir) {
        return Err(CaseFetchError::KillSwitch);
    }

    let raw_manifest = http.get(manifest_url, CASE_MANIFEST_MAX_BYTES)?.body;

    // Verify the manifest BEFORE asking for the body it names, against the version floor taken from
    // the copy already on disk. A manifest that fails here costs one small request and never gets to
    // choose what is downloaded next.
    let mut at_floor = cx.clone();
    at_floor.last_seen_catalog_version = cache_floor_version(dir, cx);
    let manifest =
        verify_manifest_with(&raw_manifest, &at_floor).map_err(CaseFetchError::Trust)?;

    // The rollback rule, applied one step early. `cache_store_verified` enforces it again at commit
    // time and would refuse the same document — but by then the body has been downloaded. Checking
    // here means an attempt to serve an older catalog costs one small request and stops.
    if manifest.catalog_version < at_floor.last_seen_catalog_version {
        return Err(CaseFetchError::Trust(CaseTrustError::CatalogVersionRollback {
            latest: at_floor.last_seen_catalog_version,
            attempted: manifest.catalog_version,
        }));
    }

    // `catalog_url` was checked against the compiled origin allowlist inside the verification above,
    // so this is a signed pointer to an approved origin — never an arbitrary URL from a document.
    let raw_catalog = http.get(&manifest.catalog_url, CASE_CATALOG_MAX_BYTES)?.body;

    // Store re-runs the whole chain, so the digest binding and every freshness rule are enforced by
    // the same code that guards a cached read. There is no path that commits something unproven.
    cache_store_verified(dir, &raw_manifest, &raw_catalog, &at_floor).map_err(CaseFetchError::Cache)
}

/// Try each compiled endpoint in order and keep the first that verifies and commits.
///
/// The endpoints are mirrors of one signed document, not different documents: the signature and the
/// version floor are identical for all of them, so a hostile mirror cannot win by answering fastest.
fn refresh_with<H: CaseHttp>(
    http: &H,
    dir: &std::path::Path,
    cx: &CaseTrustContext<'_>,
    endpoints: &[&str],
) -> Result<CaseCatalogManifest, CaseFetchError> {
    let mut last = CaseFetchError::NoEndpoint;
    for endpoint in endpoints {
        match refresh_from(http, dir, cx, endpoint, endpoints) {
            Ok(manifest) => return Ok(manifest),
            // A switched-off machine stops here rather than working through the list.
            Err(CaseFetchError::KillSwitch) => return Err(CaseFetchError::KillSwitch),
            Err(e) => last = e,
        }
    }
    Err(last)
}

/// The shipped entry point: an explicit, user-initiated refresh.
///
/// It returns `Gated` in every build today, before a directory is read or a client is built. It is
/// not registered as a command and nothing calls it — arming stays a reviewed, owner-signed change
/// rather than a behaviour diff that rides in with a call site.
pub(crate) fn refresh_case_catalog() -> Result<CaseCatalogManifest, CaseFetchError> {
    if !case_intelligence_gate() {
        return Err(CaseFetchError::Gated);
    }
    refresh_with(
        &ReqwestCaseHttp,
        &case_cache_dir(),
        &production_trust_context(),
        CASE_CATALOG_ENDPOINTS,
    )
}


#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_compact::KeyPair;
    use serde_json::{json, Value};
    use sha2::{Digest, Sha256};

    const HEX64: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    /// A test-only download origin, injected so the manifest rules OTHER than the allowlist stay
    /// reachable while the production list is deliberately empty.
    const TEST_CATALOG_ORIGINS: &[&str] = &["https://cases.example.test"];

    fn base_entry() -> Value {
        json!({
            "id": "amd-tdr-adrenalin-2026-q1",
            "revision": 3,
            "incident_kinds": ["gpu_timeout"],
            "matchers": [
                { "module_family_prefix": { "value": "amdkmdag" } },
                { "gpu_vendor_equals": { "value": "amd" } }
            ],
            "required_evidence": ["faulting_module", "gpu_vendor"],
            "title": "Display driver timeout on Adrenalin 26.1",
            "summary": "AMD recorded display driver timeouts on Adrenalin 26.1 with some RDNA cards. The recorded shape is a Display 4101 event naming amdkmdag.",
            "next_steps": [{
                "headline": "Install the newest Adrenalin driver",
                "detail": "AMD published a driver that changes this behaviour. Install it with the clean-install option.",
                "research_only": false
            }],
            "contraindications": ["Skip this if you already run a driver newer than the one named."],
            "source_url": "https://www.amd.com/en/support/kb/release-notes/rn-rad-win-26-1",
            "source_updated_at": "2026-02-04T00:00:00Z"
        })
    }

    fn base_catalog() -> Value {
        json!({ "schema_version": CASE_SCHEMA_VERSION, "entries": [base_entry()] })
    }

    fn base_manifest() -> Value {
        json!({
            "schema_version": CASE_SCHEMA_VERSION,
            "catalog_version": 42u64,
            "created_at": "2026-08-01T00:00:00Z",
            "expires_at": "2026-09-01T00:00:00Z",
            "min_app_version": "0.9.0",
            "max_app_version": "1.4.0",
            "catalog_sha256": HEX64,
            "catalog_url": "https://cases.example.test/v1/catalog.json",
            "signature": "a".repeat(SIGNATURE_HEX_CHARS)
        })
    }

    // ─── Signing fixtures, shared by the trust and cache modules below ──────
    //
    // These live in the parent so BOTH child modules can use them: a cache test needs a real
    // signed pair for exactly the same reason a verification test does. Every keypair is
    // generated inside the test — no key material, public or private, is committed.

    fn hex_of(bytes: &[u8]) -> String {
        const TABLE: &[u8; 16] = b"0123456789abcdef";
        let mut out = String::with_capacity(bytes.len() * 2);
        for &b in bytes {
            out.push(TABLE[(b >> 4) as usize] as char);
            out.push(TABLE[(b & 0x0f) as usize] as char);
        }
        out
    }

    fn sha256_hex(bytes: &[u8]) -> String {
        let mut h = Sha256::new();
        h.update(bytes);
        hex_of(&h.finalize())
    }

    /// A catalog body, as the bytes that actually travel — the digest has to be taken over the
    /// exact bytes, so the tests hold the serialized form rather than the `Value`.
    fn catalog_bytes() -> Vec<u8> {
        serde_json::to_vec(&base_catalog()).unwrap()
    }

    fn base_manifest_value(catalog: &[u8]) -> Value {
        json!({
            "schema_version": 1,
            "catalog_version": 7,
            "created_at": "2026-08-01T00:00:00Z",
            "expires_at": "2026-12-01T00:00:00Z",
            "min_app_version": "0.0.0",
            "max_app_version": "99.0.0",
            "catalog_sha256": sha256_hex(catalog),
            "catalog_url": "https://cases.example.test/catalog.json",
            "signature": ""
        })
    }

    /// Sign a manifest the way the real signer must: over the Tier 1 context prefix followed by
    /// the canonical JSON with `signature` removed.
    fn sign(kp: &KeyPair, mut manifest: Value) -> Vec<u8> {
        manifest["signature"] = Value::String(String::new());
        let raw = serde_json::to_vec(&manifest).unwrap();
        let (payload, _) = canonical_signed_payload(&raw).unwrap();
        let sig = kp.sk.sign(&payload, None);
        manifest["signature"] = Value::String(hex_of(&sig[..]));
        serde_json::to_vec(&manifest).unwrap()
    }

    /// The default fixture: a correctly signed manifest over a valid catalog.
    fn signed_pair(kp: &KeyPair) -> (Vec<u8>, Vec<u8>) {
        let catalog = catalog_bytes();
        let manifest = sign(kp, base_manifest_value(&catalog));
        (manifest, catalog)
    }

    fn key_of(kp: &KeyPair) -> CaseSigningKey {
        CaseSigningKey::new(*kp.pk)
    }

    /// A fixed instant inside the fixture's validity window, so expiry is a property of the
    /// document under test and never of the day the suite happens to run.
    fn at(instant: &str) -> chrono::DateTime<chrono::Utc> {
        chrono::DateTime::parse_from_rfc3339(instant)
            .unwrap()
            .with_timezone(&chrono::Utc)
    }

    fn cx<'a>(key: &'a CaseSigningKey) -> CaseTrustContext<'a> {
        CaseTrustContext {
            key,
            catalog_origins: TEST_CATALOG_ORIGINS,
            now: at("2026-09-01T00:00:00Z"),
            app_version: "1.0.0",
            last_seen_catalog_version: 0,
        }
    }

    fn refuse(v: &Value) -> CaseCatalogError {
        parse_catalog(&v.to_string()).expect_err("this document should have been refused")
    }

    fn refuse_manifest(v: &Value) -> CaseCatalogError {
        let m: CaseCatalogManifest = serde_json::from_str(&v.to_string())
            .expect("manifest should still PARSE; only validation refuses it");
        m.validate_with(TEST_CATALOG_ORIGINS).expect_err("this manifest should have been refused")
    }

    fn accept_manifest(v: &Value) -> CaseCatalogManifest {
        let m: CaseCatalogManifest = serde_json::from_str(&v.to_string()).expect("manifest should parse");
        m.validate_with(TEST_CATALOG_ORIGINS).expect("manifest should have been accepted");
        m
    }

    fn is_malformed(e: &CaseCatalogError) -> bool {
        matches!(e, CaseCatalogError::Malformed(_))
    }

    // ── Positive controls. Without these every rejection test could pass vacuously. ──

    #[test]
    fn catalog_schema_accepts_a_well_formed_catalog() {
        let catalog = parse_catalog(&base_catalog().to_string()).expect("the base document must be valid");
        assert_eq!(catalog.entries.len(), 1);
        assert_eq!(catalog.entries[0].id, "amd-tdr-adrenalin-2026-q1");
        assert_eq!(catalog.entries[0].incident_kinds, vec![CaseIncidentKind::GpuTimeout]);
    }

    #[test]
    fn catalog_schema_accepts_a_well_formed_manifest_against_an_injected_origin() {
        let m = accept_manifest(&base_manifest());
        assert_eq!(m.catalog_version, 42);
    }

    #[test]
    fn catalog_schema_accepts_every_matcher_variant() {
        let mut c = base_catalog();
        c["entries"][0]["matchers"] = json!([
            { "app_family_equals": { "value": "cyberpunk2077" } },
            { "app_family_prefix": { "value": "cyberpunk" } },
            { "module_family_equals": { "value": "amdkmdag" } },
            { "module_family_prefix": { "value": "amdkm" } },
            { "error_code_equals": { "value": "0xc0000005" } },
            { "gpu_vendor_equals": { "value": "amd" } },
            { "gpu_driver_version_range": { "min": "24.10.1", "max": "26.1.2" } },
            { "windows_build_range": { "min": 22000u32, "max": 27000u32 } }
        ]);
        let parsed = parse_catalog(&c.to_string()).expect("all eight primitives must be representable");
        assert_eq!(parsed.entries[0].matchers.len(), 8);
    }

    // ── serde-level strictness: unknown fields and unknown variants ──

    #[test]
    fn catalog_schema_rejects_unknown_fields_at_every_level() {
        let mutations: [fn(&mut Value); 4] = [
            |c: &mut Value| c["surprise"] = json!(1),
            |c: &mut Value| c["entries"][0]["surprise"] = json!(1),
            |c: &mut Value| c["entries"][0]["next_steps"][0]["surprise"] = json!(1),
            |c: &mut Value| c["entries"][0]["matchers"][0]["module_family_prefix"]["surprise"] = json!(1),
        ];
        for mutate in mutations {
            let mut c = base_catalog();
            mutate(&mut c);
            assert!(is_malformed(&refuse(&c)), "an unknown field must be refused, not ignored");
        }
    }

    #[test]
    fn catalog_schema_rejects_a_mutation_shaped_field_as_simply_unknown() {
        // The schema cannot CARRY an action, so these are not special-cased -- they are unknown
        // fields like any other. That is the structural argument: there is nothing to filter.
        for field in ["command", "registry_path", "service_name", "action_id", "apply", "powershell"] {
            let mut c = base_catalog();
            c["entries"][0][field] = json!("anything at all");
            assert!(is_malformed(&refuse(&c)), "{field} must not be representable in a case entry");
        }
    }

    #[test]
    fn catalog_schema_rejects_unknown_enum_variants() {
        let mut kind = base_catalog();
        kind["entries"][0]["incident_kinds"] = json!(["ransomware"]);
        assert!(is_malformed(&refuse(&kind)));

        let mut evidence = base_catalog();
        evidence["entries"][0]["required_evidence"] = json!(["bios_password"]);
        assert!(is_malformed(&refuse(&evidence)));

        let mut matcher = base_catalog();
        matcher["entries"][0]["matchers"] = json!([{ "process_memory_equals": { "value": "x" } }]);
        assert!(is_malformed(&refuse(&matcher)));
    }

    #[test]
    fn catalog_schema_has_no_regex_matcher_variant() {
        // The named primitive does not exist, and neither does a generic pattern carrier. This is the
        // "no arbitrary regex" rail expressed structurally rather than by filtering.
        for variant in ["regex", "pattern", "matches", "expression", "script"] {
            let mut c = base_catalog();
            c["entries"][0]["matchers"] = json!([{ variant: { "value": "amdkmdag.*" } }]);
            assert!(is_malformed(&refuse(&c)), "{variant} must not be a matcher");
        }
    }

    // ── Token charset: what actually forbids a regex from arriving as data ──

    #[test]
    fn catalog_schema_rejects_regex_metacharacters_in_matcher_values() {
        let poison = ["amdkmdag.*", "amd|nvidia", "amd(kmdag)", "^amdkmdag$", "amdkmdag?", "amd[kv]", "amd\\d"];
        for value in poison {
            let mut c = base_catalog();
            c["entries"][0]["matchers"] = json!([{ "module_family_prefix": { "value": value } }]);
            assert!(
                matches!(refuse(&c), CaseCatalogError::BadToken { .. }),
                "{value:?} must be refused as a token, which is what makes a regex unrepresentable"
            );
        }
    }

    #[test]
    fn catalog_schema_rejects_tokens_that_are_empty_uppercase_or_pathlike() {
        for value in ["", "AMDKMDAG", "amd kmdag", "..\\..\\windows", "c:/windows/system32", "-leading"] {
            let mut c = base_catalog();
            c["entries"][0]["matchers"] = json!([{ "module_family_equals": { "value": value } }]);
            assert!(matches!(refuse(&c), CaseCatalogError::BadToken { .. }), "{value:?} must be refused");
        }
    }

    #[test]
    fn catalog_schema_rejects_an_overlong_token() {
        let mut c = base_catalog();
        c["entries"][0]["matchers"] =
            json!([{ "module_family_equals": { "value": "a".repeat(MAX_TOKEN_CHARS + 1) } }]);
        assert!(matches!(refuse(&c), CaseCatalogError::BadToken { .. }));
    }

    #[test]
    fn catalog_schema_restricts_gpu_vendor_to_the_compiled_set() {
        let mut c = base_catalog();
        c["entries"][0]["matchers"] = json!([{ "gpu_vendor_equals": { "value": "matrox" } }]);
        assert!(matches!(refuse(&c), CaseCatalogError::BadToken { .. }));
    }

    #[test]
    fn catalog_schema_rejects_a_bad_or_inverted_driver_version_range() {
        let mut bad = base_catalog();
        bad["entries"][0]["matchers"] =
            json!([{ "gpu_driver_version_range": { "min": "twenty-four", "max": "26.1" } }]);
        assert!(matches!(refuse(&bad), CaseCatalogError::BadVersion { .. }));

        let mut inverted = base_catalog();
        inverted["entries"][0]["matchers"] =
            json!([{ "gpu_driver_version_range": { "min": "26.1", "max": "24.10" } }]);
        assert!(matches!(refuse(&inverted), CaseCatalogError::InvertedRange { .. }));
    }

    #[test]
    fn catalog_schema_rejects_an_inverted_windows_build_range() {
        let mut c = base_catalog();
        c["entries"][0]["matchers"] = json!([{ "windows_build_range": { "min": 27000u32, "max": 22000u32 } }]);
        assert!(matches!(refuse(&c), CaseCatalogError::InvertedRange { .. }));
    }

    // ── Prose safety ──

    #[test]
    fn catalog_schema_rejects_markup_links_and_interpolation_in_prose() {
        let poison = [
            "<script>alert(1)</script>",
            "Read <b>this</b> first",
            "See [the fix](https://evil.test/x)",
            "Run `something`",
            "Value ${env:PATH}",
            "Open https://evil.test now",
            "Look at &#60;",
        ];
        for text in poison {
            let mut c = base_catalog();
            c["entries"][0]["summary"] = json!(text);
            assert!(
                matches!(refuse(&c), CaseCatalogError::UnsafeText { .. }),
                "{text:?} must not be accepted as advisory prose"
            );
        }
    }

    #[test]
    fn catalog_schema_rejects_prose_that_reads_as_a_command_or_a_registry_path() {
        let poison = [
            "Open powershell and paste this",
            "Run cmd.exe as administrator",
            "reg add the following key",
            "Edit HKLM\\SYSTEM\\CurrentControlSet",
            "Double-click fix.bat",
            "Import the settings.reg file",
            "Run repair.ps1",
            "Use schtasks to disable it",
        ];
        for text in poison {
            let mut c = base_catalog();
            c["entries"][0]["next_steps"][0]["detail"] = json!(text);
            assert!(
                matches!(refuse(&c), CaseCatalogError::UnsafeText { .. }),
                "{text:?} must not be accepted as an advisory step"
            );
        }
    }

    #[test]
    fn catalog_schema_rejects_control_characters_in_prose() {
        let mut c = base_catalog();
        c["entries"][0]["title"] = json!("Driver timeout\u{0007}");
        assert!(matches!(refuse(&c), CaseCatalogError::UnsafeText { .. }));
    }

    #[test]
    fn catalog_schema_rejects_prose_that_is_empty_or_whitespace() {
        for field in ["title", "summary"] {
            for text in ["", "   "] {
                let mut c = base_catalog();
                c["entries"][0][field] = json!(text);
                assert!(matches!(refuse(&c), CaseCatalogError::Empty { .. }), "{field} {text:?}");
            }
        }
        let mut step = base_catalog();
        step["entries"][0]["next_steps"][0]["headline"] = json!("");
        assert!(matches!(refuse(&step), CaseCatalogError::Empty { .. }));
    }

    #[test]
    fn catalog_schema_rejects_overlong_prose() {
        let cases: [(&str, usize); 2] = [("title", MAX_TITLE_CHARS), ("summary", MAX_SUMMARY_CHARS)];
        for (field, max) in cases {
            let mut c = base_catalog();
            c["entries"][0][field] = json!("a".repeat(max + 1));
            assert!(matches!(refuse(&c), CaseCatalogError::TooLong { .. }), "{field}");
        }
        let mut step = base_catalog();
        step["entries"][0]["next_steps"][0]["detail"] = json!("a".repeat(MAX_STEP_DETAIL_CHARS + 1));
        assert!(matches!(refuse(&step), CaseCatalogError::TooLong { .. }));

        let mut contra = base_catalog();
        contra["entries"][0]["contraindications"] = json!(["a".repeat(MAX_CONTRAINDICATION_CHARS + 1)]);
        assert!(matches!(refuse(&contra), CaseCatalogError::TooLong { .. }));
    }

    // ── Ids, counts, uniqueness ──

    #[test]
    fn catalog_schema_rejects_an_empty_or_unsafe_id() {
        for id in ["", "Amd-Tdr", "amd tdr", "amd/tdr", "../amd"] {
            let mut c = base_catalog();
            c["entries"][0]["id"] = json!(id);
            let e = refuse(&c);
            assert!(
                matches!(e, CaseCatalogError::BadToken { .. } | CaseCatalogError::Empty { .. }),
                "{id:?} produced {e:?}"
            );
        }
        let mut long = base_catalog();
        long["entries"][0]["id"] = json!("a".repeat(MAX_ID_CHARS + 1));
        assert!(matches!(refuse(&long), CaseCatalogError::BadToken { .. }));
    }

    #[test]
    fn catalog_schema_rejects_duplicate_case_ids() {
        let mut c = base_catalog();
        c["entries"] = json!([base_entry(), base_entry()]);
        assert!(matches!(refuse(&c), CaseCatalogError::Duplicate { field: "entries.id", .. }));
    }

    #[test]
    fn catalog_schema_rejects_duplicate_matchers_kinds_and_requirements() {
        let mut matchers = base_catalog();
        matchers["entries"][0]["matchers"] =
            json!([{ "gpu_vendor_equals": { "value": "amd" } }, { "gpu_vendor_equals": { "value": "amd" } }]);
        assert!(matches!(refuse(&matchers), CaseCatalogError::Duplicate { .. }));

        let mut kinds = base_catalog();
        kinds["entries"][0]["incident_kinds"] = json!(["gpu_timeout", "gpu_timeout"]);
        assert!(matches!(refuse(&kinds), CaseCatalogError::Duplicate { .. }));

        let mut evidence = base_catalog();
        evidence["entries"][0]["required_evidence"] = json!(["faulting_module", "faulting_module"]);
        assert!(matches!(refuse(&evidence), CaseCatalogError::Duplicate { .. }));
    }

    #[test]
    fn catalog_schema_requires_at_least_one_kind_matcher_and_step() {
        for field in ["incident_kinds", "matchers", "next_steps"] {
            let mut c = base_catalog();
            c["entries"][0][field] = json!([]);
            assert!(matches!(refuse(&c), CaseCatalogError::Empty { .. }), "{field}");
        }
    }

    #[test]
    fn catalog_schema_rejects_too_many_items() {
        let mut entries = base_catalog();
        let many: Vec<Value> = (0..=MAX_ENTRIES)
            .map(|i| {
                let mut e = base_entry();
                e["id"] = json!(format!("case-{i}"));
                e
            })
            .collect();
        entries["entries"] = json!(many);
        assert!(matches!(refuse(&entries), CaseCatalogError::TooMany { field: "entries", .. }));

        let mut matchers = base_catalog();
        matchers["entries"][0]["matchers"] = json!((0..=MAX_MATCHERS)
            .map(|i| json!({ "app_family_equals": { "value": format!("game-{i}") } }))
            .collect::<Vec<_>>());
        assert!(matches!(refuse(&matchers), CaseCatalogError::TooMany { field: "matchers", .. }));

        let mut steps = base_catalog();
        steps["entries"][0]["next_steps"] = json!((0..=MAX_STEPS)
            .map(|i| json!({ "headline": format!("Step {i}"), "detail": "Read the vendor note.", "research_only": false }))
            .collect::<Vec<_>>());
        assert!(matches!(refuse(&steps), CaseCatalogError::TooMany { field: "next_steps", .. }));

        let mut contra = base_catalog();
        contra["entries"][0]["contraindications"] =
            json!((0..=MAX_CONTRAINDICATIONS).map(|i| json!(format!("Not for case {i}."))).collect::<Vec<_>>());
        assert!(matches!(refuse(&contra), CaseCatalogError::TooMany { .. }));
    }

    // ── Source URLs ──

    #[test]
    fn catalog_schema_rejects_a_non_https_source_url() {
        for url in [
            "http://www.amd.com/kb/1",
            "ftp://www.amd.com/kb/1",
            "file:///c:/windows/notes.txt",
            "javascript:alert(1)",
            "//www.amd.com/kb/1",
            "www.amd.com/kb/1",
        ] {
            let mut c = base_catalog();
            c["entries"][0]["source_url"] = json!(url);
            let e = refuse(&c);
            assert!(
                matches!(e, CaseCatalogError::BadUrl { .. } | CaseCatalogError::OriginNotAllowed { .. }),
                "{url:?} produced {e:?}"
            );
        }
    }

    #[test]
    fn catalog_schema_rejects_a_source_url_outside_the_compiled_allowlist() {
        let mut c = base_catalog();
        c["entries"][0]["source_url"] = json!("https://forums.example.test/thread/1");
        assert!(matches!(refuse(&c), CaseCatalogError::OriginNotAllowed { field: "source_url", .. }));
    }

    #[test]
    fn catalog_schema_rejects_a_source_url_that_only_looks_allowlisted() {
        // The check is on the exact ORIGIN, not on a prefix or a substring: a lookalike host, a
        // subdomain, userinfo pointing elsewhere and a pinned port are the classic ways past a
        // sloppy one.
        for url in [
            "https://www.amd.com.evil.test/kb/1",
            "https://evil.test/https://www.amd.com/kb/1",
            "https://user@evil.test/kb/1",
            "https://www.amd.com:8443/kb/1",
            "https://sub.www.amd.com/kb/1",
        ] {
            let mut c = base_catalog();
            c["entries"][0]["source_url"] = json!(url);
            let e = refuse(&c);
            assert!(
                matches!(e, CaseCatalogError::BadUrl { .. } | CaseCatalogError::OriginNotAllowed { .. }),
                "{url:?} produced {e:?}"
            );
        }
    }

    #[test]
    fn catalog_schema_rejects_an_overlong_source_url() {
        let mut c = base_catalog();
        c["entries"][0]["source_url"] = json!(format!("https://www.amd.com/{}", "a".repeat(MAX_URL_CHARS)));
        assert!(matches!(refuse(&c), CaseCatalogError::BadUrl { .. }));
    }

    #[test]
    fn catalog_schema_rejects_a_non_rfc3339_source_timestamp() {
        let mut c = base_catalog();
        c["entries"][0]["source_updated_at"] = json!("last tuesday");
        assert!(matches!(refuse(&c), CaseCatalogError::BadTimestamp { .. }));
    }

    #[test]
    fn catalog_schema_rejects_a_schema_version_this_build_does_not_speak() {
        let mut c = base_catalog();
        c["schema_version"] = json!(CASE_SCHEMA_VERSION + 1);
        assert!(matches!(refuse(&c), CaseCatalogError::SchemaVersion { .. }));
    }

    // ── Manifest ──

    #[test]
    fn catalog_schema_manifest_cannot_validate_while_the_endpoint_allowlist_is_empty() {
        // The darkness proof. `validate()` uses the COMPILED list, which ships empty, so a manifest
        // that is otherwise perfect still cannot authorize a download. If this ever fails, someone
        // armed Tier 1 without an owner decision.
        assert!(CASE_CATALOG_ORIGINS.is_empty(), "Tier 1 must ship with no download origin");
        let m: CaseCatalogManifest = serde_json::from_str(&base_manifest().to_string()).unwrap();
        assert!(matches!(m.validate(), Err(CaseCatalogError::OriginNotAllowed { .. })));
    }

    #[test]
    fn catalog_schema_manifest_rejects_a_non_https_or_off_allowlist_catalog_url() {
        for url in ["http://cases.example.test/v1/catalog.json", "https://cases.example.test.evil/v1/c.json"] {
            let mut m = base_manifest();
            m["catalog_url"] = json!(url);
            let e = refuse_manifest(&m);
            assert!(
                matches!(e, CaseCatalogError::BadUrl { .. } | CaseCatalogError::OriginNotAllowed { .. }),
                "{url:?} produced {e:?}"
            );
        }
    }

    #[test]
    fn catalog_schema_manifest_rejects_a_bad_digest_or_signature() {
        for (field, value) in [
            ("catalog_sha256", "not-hex"),
            ("catalog_sha256", "ABCDEF0123456789abcdef0123456789abcdef0123456789abcdef0123456789"),
            ("signature", "beef"),
        ] {
            let mut m = base_manifest();
            m[field] = json!(value);
            assert!(matches!(refuse_manifest(&m), CaseCatalogError::BadHex { .. }), "{field} {value:?}");
        }
    }

    #[test]
    fn catalog_schema_manifest_rejects_a_zero_catalog_version() {
        let mut m = base_manifest();
        m["catalog_version"] = json!(0u64);
        assert!(matches!(refuse_manifest(&m), CaseCatalogError::BadCatalogVersion { .. }));
    }

    /// The `u64` here is a `number` in `src/types.ts`, and the frontend prints it. Past
    /// `MAX_JS_EXACT_INT` the value the user reads is not the value that was signed, and the
    /// monotonicity floor compares against a number nobody sent. Both edges pinned: the largest
    /// exact integer is accepted, the first inexact one is refused.
    #[test]
    fn catalog_schema_manifest_rejects_a_version_javascript_cannot_represent_exactly() {
        let mut ok = base_manifest();
        ok["catalog_version"] = json!(MAX_JS_EXACT_INT);
        // `accept_manifest` panics if validation refuses, so reaching the assert IS the proof it
        // was accepted; the assert then pins that the value survived deserialization unrounded.
        assert_eq!(accept_manifest(&ok).catalog_version, MAX_JS_EXACT_INT);

        for over in [MAX_JS_EXACT_INT + 1, u64::MAX] {
            let mut m = base_manifest();
            m["catalog_version"] = json!(over);
            assert!(
                matches!(refuse_manifest(&m), CaseCatalogError::BadCatalogVersion { .. }),
                "catalog_version {over} rounds on the way to the frontend and must be refused"
            );
        }
    }

    #[test]
    fn catalog_schema_manifest_rejects_an_inverted_or_unparseable_validity_window() {
        let mut inverted = base_manifest();
        inverted["expires_at"] = json!("2026-07-01T00:00:00Z");
        assert!(matches!(refuse_manifest(&inverted), CaseCatalogError::BadTimestamp { .. }));

        let mut junk = base_manifest();
        junk["created_at"] = json!("whenever");
        assert!(matches!(refuse_manifest(&junk), CaseCatalogError::BadTimestamp { .. }));
    }

    #[test]
    fn catalog_schema_manifest_rejects_a_bad_or_inverted_app_version_range() {
        let mut junk = base_manifest();
        junk["min_app_version"] = json!("zero point nine");
        assert!(matches!(refuse_manifest(&junk), CaseCatalogError::BadVersion { .. }));

        let mut inverted = base_manifest();
        inverted["min_app_version"] = json!("2.0.0");
        assert!(matches!(refuse_manifest(&inverted), CaseCatalogError::InvertedRange { .. }));
    }

    #[test]
    fn catalog_schema_manifest_rejects_unknown_fields() {
        let mut m = base_manifest();
        m["kill_switch_url"] = json!("https://cases.example.test/off");
        assert!(serde_json::from_str::<CaseCatalogManifest>(&m.to_string()).is_err());
    }

    // ── Structural invariants of the compiled authorities ──

    #[test]
    fn catalog_schema_source_origins_are_bare_https_origins() {
        for origin in CASE_SOURCE_ORIGINS {
            assert!(origin.starts_with("https://"), "{origin} must be https");
            let authority = &origin["https://".len()..];
            assert!(!authority.is_empty(), "{origin} has no host");
            assert!(!authority.contains('/'), "{origin} must be an origin, not a URL with a path");
            assert!(!authority.contains(':'), "{origin} must not pin a port");
            assert!(!authority.contains('@'), "{origin} must not carry userinfo");
        }
    }

    #[test]
    fn catalog_schema_the_gate_is_hard_false() {
        assert!(!case_intelligence_gate(), "Tier 1 must be dark until an owner-signed arming commit");
    }

    #[test]
    fn catalog_schema_kind_mapping_covers_every_black_box_kind() {
        use crate::blackbox::IncidentKind as K;
        let all = [
            K::GpuTimeout,
            K::AppCrash,
            K::AppHang,
            K::UnexpectedShutdown,
            K::BlueScreen,
            K::HardwareError,
        ];
        let mut mapped: Vec<String> =
            all.iter().map(|k| format!("{:?}", CaseIncidentKind::from_incident(*k))).collect();
        mapped.sort();
        mapped.dedup();
        assert_eq!(mapped.len(), all.len(), "the mapping must be injective, not collapse two kinds into one");
    }

    #[test]
    fn catalog_schema_match_level_serializes_without_a_number() {
        let m = CaseIntelligenceMatch {
            case_id: "amd-tdr-adrenalin-2026-q1".into(),
            catalog_version: 42,
            level: CaseMatchLevel::MatchedKnownIssue,
            title: "Display driver timeout".into(),
            summary: "Matches the recorded shape.".into(),
            // Keys, not values — task 5 fixed the contract: a ref names which local fact lined up
            // and never carries the fact itself.
            evidence_refs: vec!["faulting_module".into()],
            next_steps: vec![AdvisoryStep {
                headline: "Install the newest driver".into(),
                detail: "The vendor published a newer driver.".into(),
                research_only: false,
            }],
            contraindications: vec!["Skip this if you already run a newer driver.".into()],
            source_url: "https://www.amd.com/kb/1".into(),
            source_updated_at: "2026-02-04T00:00:00Z".into(),
        };
        let wire = serde_json::to_string(&m).expect("serializes");
        assert!(wire.contains("matched_known_issue"));
        assert!(!wire.contains("confidence"), "a numeric confidence must never appear on the wire");
        assert!(!wire.contains("score"));
    }

    // ─── A throwaway data root, shared by the cache and matcher modules ────
    //
    // Lifted here so BOTH child modules can use it: the matcher's three cache-state tests
    // need a real directory for the same reason every cache test does.
    use std::path::PathBuf;

    /// A throwaway data root that cleans itself up even when a test panics, so a failing run
    /// never leaves the next one to inherit its debris.
    struct TempRoot(PathBuf);

    impl TempRoot {
        fn new(label: &str) -> Self {
            static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
            let n = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            let dir = std::env::temp_dir()
                .join(format!("compy-case-cache-{}-{label}-{n}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).expect("temp root");
            Self(dir)
        }

        /// The namespace under the root, exactly as production composes it.
        fn cache(&self) -> PathBuf {
            self.0.join(CASE_CACHE_DIR_NAME)
        }

        fn file(&self) -> PathBuf {
            case_cache_file(&self.cache())
        }
    }

    impl Drop for TempRoot {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    // ─── Trust chain (plan task 3) ─────────────────────────────────────────
    //
    // These are the SIGNING tests, and they are deliberately a separate module from the schema tests
    // above: those ask "is this document well formed", these ask "did it really come from us". Every
    // key here is generated inside the test — no key material, public or private, is committed.
    //
    // The one thing NOT tested here is redirect handling. A redirect is a property of the transport,
    // not of a document, so it has nowhere to live until plan task 6 builds the pull path; it is
    // listed there rather than faked here with a hand-written `Location` header.
    mod verification {
        use super::*;

        fn refuse(manifest: &[u8], catalog: &[u8], cx: &CaseTrustContext<'_>) -> CaseTrustError {
            verify_chain_with(manifest, catalog, cx).expect_err("should have been refused")
        }

        // ── The positive control ───────────────────────────────────────────

        #[test]
        fn a_correctly_signed_manifest_and_its_catalog_verify() {
            let kp = KeyPair::generate();
            let (manifest, catalog) = signed_pair(&kp);
            let (m, c) = verify_chain_with(&manifest, &catalog, &cx(&key_of(&kp)))
                .expect("the fixture must verify, or every rejection test below is vacuous");
            assert_eq!(m.catalog_version, 7);
            assert_eq!(c.schema_version, CASE_SCHEMA_VERSION);
        }

        // ── Trust separation from remote rules ─────────────────────────────

        #[test]
        fn a_signature_from_a_different_key_is_refused() {
            let signer = KeyPair::generate();
            let other = KeyPair::generate();
            let (manifest, catalog) = signed_pair(&signer);
            assert_eq!(
                refuse(&manifest, &catalog, &cx(&key_of(&other))),
                CaseTrustError::SignatureInvalid
            );
        }

        /// THE domain-separation proof, and the reason a separate key is not the whole story. This
        /// signs with the RIGHT key over the RIGHT canonical JSON — but without Tier 1's context
        /// prefix, which is exactly the payload `remote_rules.rs` signs. It must not verify, so a key
        /// accidentally shared between the two tiers still cannot carry a signature across.
        #[test]
        fn a_remote_rules_shaped_signature_over_the_same_json_does_not_verify_here() {
            let kp = KeyPair::generate();
            let catalog = catalog_bytes();
            let mut manifest = base_manifest_value(&catalog);
            manifest["signature"] = Value::String(String::new());
            let raw = serde_json::to_vec(&manifest).unwrap();

            // Sign the bare canonical bytes — no Tier 1 context. This is remote-rules' scheme.
            let mut bare: Value = serde_json::from_slice(&raw).unwrap();
            bare.as_object_mut().unwrap().remove("signature");
            let sig = kp.sk.sign(serde_json::to_vec(&bare).unwrap(), None);
            manifest["signature"] = Value::String(hex_of(&sig[..]));

            let signed = serde_json::to_vec(&manifest).unwrap();
            assert_eq!(
                refuse(&signed, &catalog, &cx(&key_of(&kp))),
                CaseTrustError::SignatureInvalid,
                "a signature over the un-prefixed payload must not verify as a Tier 1 manifest"
            );
        }

        /// The reverse direction of the same separation: a remote-rules manifest, signed perfectly
        /// under Tier 1's own scheme, is still refused — its fields are not this schema's fields.
        #[test]
        fn a_remote_rules_manifest_is_refused_even_when_signed_with_the_case_key() {
            let kp = KeyPair::generate();
            let catalog = catalog_bytes();
            let rules_manifest = json!({
                "schema_version": 1,
                "ruleset_version": 7,
                "created_at": "2026-08-01T00:00:00Z",
                "expires_at": "2026-12-01T00:00:00Z",
                "min_app_version": "0.0.0",
                "max_app_version": "99.0.0",
                "rules_sha256": sha256_hex(&catalog),
                "rules_url": "https://cases.example.test/rules.json",
                "signature": ""
            });
            let signed = sign(&kp, rules_manifest);
            assert!(
                matches!(
                    refuse(&signed, &catalog, &cx(&key_of(&kp))),
                    CaseTrustError::Schema(CaseCatalogError::Malformed(_))
                ),
                "privileged rules policy must never deserialize as an advisory catalog manifest"
            );
        }

        #[test]
        fn the_signing_context_names_tier_1_and_its_own_canonicalization_version() {
            let context = std::str::from_utf8(CASE_MANIFEST_SIGNING_CONTEXT).unwrap();
            assert!(context.starts_with("compy.case-intelligence."));
            assert!(context.contains(".v1"));
            assert!(
                !context.contains("rules"),
                "the context must not name the privileged remote-rules domain"
            );
        }

        // ── Tampering ──────────────────────────────────────────────────────

        /// Every signed field, one at a time. A signature that survives an edit to any of these is a
        /// signature that is not actually covering the document.
        #[test]
        fn altering_any_signed_field_invalidates_the_signature() {
            let kp = KeyPair::generate();
            let catalog = catalog_bytes();
            let edits: Vec<(&str, Value)> = vec![
                ("catalog_version", json!(8)),
                ("expires_at", json!("2027-12-01T00:00:00Z")),
                ("created_at", json!("2026-07-01T00:00:00Z")),
                ("min_app_version", json!("0.0.1")),
                ("max_app_version", json!("98.0.0")),
                ("catalog_url", json!("https://cases.example.test/other.json")),
                ("catalog_sha256", json!(HEX64)),
                ("schema_version", json!(1)),
            ];
            for (field, replacement) in edits {
                let signed = sign(&kp, base_manifest_value(&catalog));
                let mut tampered: Value = serde_json::from_slice(&signed).unwrap();
                if tampered[field] == replacement {
                    continue; // a no-op edit proves nothing; only schema_version can hit this
                }
                tampered[field] = replacement;
                let raw = serde_json::to_vec(&tampered).unwrap();
                assert_eq!(
                    refuse(&raw, &catalog, &cx(&key_of(&kp))),
                    CaseTrustError::SignatureInvalid,
                    "editing {field} after signing must break the signature"
                );
            }
        }

        /// A valid signature from a DIFFERENT document by the SAME signer. This is the attack a
        /// naive "is this a well-formed signature by our key" check would wave through.
        #[test]
        fn a_valid_signature_lifted_from_another_manifest_is_refused() {
            let kp = KeyPair::generate();
            let catalog = catalog_bytes();

            let mut older = base_manifest_value(&catalog);
            older["catalog_version"] = json!(6);
            let older_signed: Value = serde_json::from_slice(&sign(&kp, older)).unwrap();

            let mut target: Value = serde_json::from_slice(&sign(&kp, base_manifest_value(&catalog))).unwrap();
            target["signature"] = older_signed["signature"].clone();

            assert_eq!(
                refuse(&serde_json::to_vec(&target).unwrap(), &catalog, &cx(&key_of(&kp))),
                CaseTrustError::SignatureInvalid
            );
        }

        #[test]
        fn a_signature_that_is_not_128_lowercase_hex_characters_is_refused() {
            let kp = KeyPair::generate();
            let catalog = catalog_bytes();
            let good: Value = serde_json::from_slice(&sign(&kp, base_manifest_value(&catalog))).unwrap();
            let real = good["signature"].as_str().unwrap().to_string();

            let bad = vec![
                ("empty", String::new()),
                ("truncated", real[..126].to_string()),
                ("overlong", format!("{real}00")),
                ("uppercase", real.to_uppercase()),
                ("non-hex", format!("{}zz", &real[..126])),
                ("base64-ish", "not+a/hex=signature".to_string()),
            ];
            for (why, signature) in bad {
                let mut m = good.clone();
                m["signature"] = Value::String(signature);
                assert_eq!(
                    refuse(&serde_json::to_vec(&m).unwrap(), &catalog, &cx(&key_of(&kp))),
                    CaseTrustError::BadSignatureFormat,
                    "a {why} signature must be refused on format, before any curve work"
                );
            }
        }

        #[test]
        fn a_manifest_with_no_signature_or_a_non_string_one_is_refused() {
            let kp = KeyPair::generate();
            let catalog = catalog_bytes();
            let good: Value = serde_json::from_slice(&sign(&kp, base_manifest_value(&catalog))).unwrap();

            let mut missing = good.clone();
            missing.as_object_mut().unwrap().remove("signature");
            assert_eq!(
                refuse(&serde_json::to_vec(&missing).unwrap(), &catalog, &cx(&key_of(&kp))),
                CaseTrustError::MissingSignature
            );

            let mut wrong_type = good.clone();
            wrong_type["signature"] = json!(12345);
            assert_eq!(
                refuse(&serde_json::to_vec(&wrong_type).unwrap(), &catalog, &cx(&key_of(&kp))),
                CaseTrustError::MissingSignature
            );

            assert!(matches!(
                refuse(b"not json at all", &catalog, &cx(&key_of(&kp))),
                CaseTrustError::Malformed(_)
            ));
        }

        // ── The digest binding ─────────────────────────────────────────────

        #[test]
        fn a_catalog_body_that_does_not_match_the_signed_digest_is_refused() {
            let kp = KeyPair::generate();
            let (manifest, catalog) = signed_pair(&kp);
            let mut swapped: Value = serde_json::from_slice(&catalog).unwrap();
            swapped["entries"] = json!([]);
            assert_eq!(
                refuse(&manifest, &serde_json::to_vec(&swapped).unwrap(), &cx(&key_of(&kp))),
                CaseTrustError::DigestMismatch,
                "the signature is over the manifest; only the digest binds the body to it"
            );
        }

        /// A perfectly signed manifest committing to a digest that is simply not this catalog's. The
        /// signature is valid, so this is the check that has to catch it.
        #[test]
        fn a_signed_digest_for_a_different_catalog_is_refused() {
            let kp = KeyPair::generate();
            let catalog = catalog_bytes();
            let mut m = base_manifest_value(&catalog);
            m["catalog_sha256"] = json!(HEX64);
            let signed = sign(&kp, m);
            assert_eq!(
                refuse(&signed, &catalog, &cx(&key_of(&kp))),
                CaseTrustError::DigestMismatch
            );
        }

        // ── Freshness and rollback ─────────────────────────────────────────

        #[test]
        fn an_expired_manifest_is_refused() {
            let kp = KeyPair::generate();
            let (manifest, catalog) = signed_pair(&kp);
            let key = key_of(&kp);
            let mut context = cx(&key);
            context.now = at("2027-01-01T00:00:00Z");
            assert_eq!(refuse(&manifest, &catalog, &context), CaseTrustError::Expired);
        }

        #[test]
        fn a_manifest_that_is_not_valid_yet_is_refused() {
            let kp = KeyPair::generate();
            let (manifest, catalog) = signed_pair(&kp);
            let key = key_of(&kp);
            let mut context = cx(&key);
            context.now = at("2026-07-01T00:00:00Z");
            assert_eq!(refuse(&manifest, &catalog, &context), CaseTrustError::NotYetValid);
        }

        #[test]
        fn an_older_catalog_version_is_refused_as_a_rollback() {
            let kp = KeyPair::generate();
            let (manifest, catalog) = signed_pair(&kp); // catalog_version 7
            let key = key_of(&kp);
            let mut context = cx(&key);
            context.last_seen_catalog_version = 9;
            assert_eq!(
                refuse(&manifest, &catalog, &context),
                CaseTrustError::CatalogVersionRollback { latest: 9, attempted: 7 }
            );
        }

        /// Re-serving the version already held is normal, not an attack — a cache revalidation, a
        /// second launch. Only going BACKWARDS is refused.
        #[test]
        fn the_same_catalog_version_is_still_accepted() {
            let kp = KeyPair::generate();
            let (manifest, catalog) = signed_pair(&kp);
            let key = key_of(&kp);
            let mut context = cx(&key);
            context.last_seen_catalog_version = 7;
            assert!(verify_chain_with(&manifest, &catalog, &context).is_ok());
        }

        #[test]
        fn a_build_outside_the_manifests_app_version_bracket_is_refused() {
            let kp = KeyPair::generate();
            let catalog = catalog_bytes();
            let mut m = base_manifest_value(&catalog);
            m["min_app_version"] = json!("2.0.0");
            m["max_app_version"] = json!("3.0.0");
            let signed = sign(&kp, m);

            for version in ["1.9.9", "3.0.1"] {
                let key = key_of(&kp);
                let mut context = cx(&key);
                context.app_version = version;
                assert_eq!(
                    refuse(&signed, &catalog, &context),
                    CaseTrustError::AppVersionOutOfRange { current: version.to_string() }
                );
            }

            // And the boundaries are inclusive — a bracket that excludes its own endpoints would
            // strand the exact builds it names.
            for version in ["2.0.0", "2.5.1", "3.0.0"] {
                let key = key_of(&kp);
                let mut context = cx(&key);
                context.app_version = version;
                assert!(verify_chain_with(&signed, &catalog, &context).is_ok(), "{version}");
            }
        }

        // ── Transport caps ─────────────────────────────────────────────────

        #[test]
        fn an_oversized_manifest_is_refused_before_anything_parses_it() {
            let kp = KeyPair::generate();
            let catalog = catalog_bytes();
            let huge = vec![b'x'; CASE_MANIFEST_MAX_BYTES + 1];
            assert_eq!(
                refuse(&huge, &catalog, &cx(&key_of(&kp))),
                CaseTrustError::Oversize {
                    field: "manifest",
                    found: CASE_MANIFEST_MAX_BYTES + 1,
                    max: CASE_MANIFEST_MAX_BYTES,
                },
                "the cap must be a byte count, not a parse failure"
            );
        }

        #[test]
        fn an_oversized_catalog_is_refused_before_anything_parses_it() {
            let kp = KeyPair::generate();
            let (manifest, _) = signed_pair(&kp);
            let huge = vec![b'x'; CASE_CATALOG_MAX_BYTES + 1];
            assert_eq!(
                refuse(&manifest, &huge, &cx(&key_of(&kp))),
                CaseTrustError::Oversize {
                    field: "catalog",
                    found: CASE_CATALOG_MAX_BYTES + 1,
                    max: CASE_CATALOG_MAX_BYTES,
                },
                "a multi-megabyte body must not be verified, hashed or parsed"
            );
        }

        // ── The domain rules still apply to an authentic document ──────────

        #[test]
        fn an_authentic_manifest_with_an_unknown_schema_version_is_refused() {
            let kp = KeyPair::generate();
            let catalog = catalog_bytes();
            let mut m = base_manifest_value(&catalog);
            m["schema_version"] = json!(2);
            let signed = sign(&kp, m);
            assert_eq!(
                refuse(&signed, &catalog, &cx(&key_of(&kp))),
                CaseTrustError::Schema(CaseCatalogError::SchemaVersion { found: 2, expected: 1 })
            );
        }

        /// The manifest and the catalog agree on their schema because BOTH are pinned to the same
        /// compiled constant — there is no cross-check to get wrong, and no branch a test could not
        /// reach. These two halves prove the pinning from both sides.
        #[test]
        fn manifest_and_catalog_are_each_pinned_to_the_compiled_schema_version() {
            let kp = KeyPair::generate();
            let mut body: Value = base_catalog();
            body["schema_version"] = json!(2);
            let catalog = serde_json::to_vec(&body).unwrap();
            let signed = sign(&kp, base_manifest_value(&catalog));
            assert_eq!(
                refuse(&signed, &catalog, &cx(&key_of(&kp))),
                CaseTrustError::Schema(CaseCatalogError::SchemaVersion { found: 2, expected: 1 }),
                "an authentic, correctly-digested catalog is still refused if it speaks another schema"
            );
        }

        #[test]
        fn an_authentic_manifest_pointing_off_the_allowlist_is_refused() {
            let kp = KeyPair::generate();
            let catalog = catalog_bytes();
            let mut m = base_manifest_value(&catalog);
            m["catalog_url"] = json!("https://cases.example.test.evil.test/catalog.json");
            let signed = sign(&kp, m);
            assert!(
                matches!(
                    refuse(&signed, &catalog, &cx(&key_of(&kp))),
                    CaseTrustError::Schema(CaseCatalogError::OriginNotAllowed { .. })
                ),
                "a valid signature does not grant a new download origin"
            );
        }

        #[test]
        fn an_authentic_catalog_carrying_unsafe_prose_is_still_refused() {
            let kp = KeyPair::generate();
            let mut body: Value = base_catalog();
            body["entries"][0]["next_steps"][0]["detail"] =
                json!("Open PowerShell and run reg add on the display key.");
            let catalog = serde_json::to_vec(&body).unwrap();
            let signed = sign(&kp, base_manifest_value(&catalog));
            assert!(
                matches!(
                    refuse(&signed, &catalog, &cx(&key_of(&kp))),
                    CaseTrustError::Schema(CaseCatalogError::UnsafeText { .. })
                ),
                "signing something does not make it safe to show — the schema rules still run"
            );
        }

        // ── The darkness proof ─────────────────────────────────────────────

        #[test]
        fn the_compiled_trust_root_is_the_all_zeros_placeholder() {
            assert!(
                CASE_SIGNING_PUBKEY.is_placeholder(),
                "a real Tier 1 public key may only be compiled in by the owner-signed arming commit"
            );
        }

        /// The production entry point cannot succeed in this build no matter what it is handed, and
        /// it refuses BEFORE reading anything. Two independent reasons hold it: no trust root, and an
        /// empty `CASE_CATALOG_ORIGINS`. This test fails the moment either is quietly changed.
        #[test]
        fn the_production_entry_point_refuses_a_perfectly_valid_catalog() {
            let kp = KeyPair::generate();
            let (manifest, catalog) = signed_pair(&kp);
            assert!(verify_chain_with(&manifest, &catalog, &cx(&key_of(&kp))).is_ok());
            assert_eq!(
                verify_catalog_chain(&manifest, &catalog, 0).expect_err("Tier 1 is dark"),
                CaseTrustError::PlaceholderKey
            );
            assert!(CASE_CATALOG_ORIGINS.is_empty(), "the second, independent reason");
            assert!(!case_intelligence_gate(), "and the gate above both of them");
        }

        /// A dark build must say **no trust root** on the paths that actually run — not "your
        /// signature is bad".
        ///
        /// The regression this pins was found in the #221 pre-merge review. The wrapper above is
        /// not the funnel: the cache write, the cache read and the refresh all reach
        /// `verify_manifest_with` directly, so a placeholder check living only in the wrapper never
        /// ran on a real path. The all-zero key sails through `PublicKey::from_slice` (32 zero
        /// bytes ARE a well-formed slice), is rejected inside `.verify()` as a WEAK key, and
        /// surfaces as `SignatureInvalid`. The refusal is correct either way; the DIAGNOSIS is not,
        /// and the diagnosis is what a future reader acts on. Delete the check at the head of
        /// `verify_manifest_with` and this test fails.
        #[test]
        fn a_dark_build_reports_no_trust_root_on_the_paths_that_actually_run() {
            let kp = KeyPair::generate();
            let (manifest, catalog) = signed_pair(&kp);
            let dark = CaseSigningKey::new([0u8; 32]);
            assert!(dark.is_placeholder(), "the fixture is the shipped trust root's shape");

            // Not vacuous: these exact bytes verify against a real key.
            assert!(verify_chain_with(&manifest, &catalog, &cx(&key_of(&kp))).is_ok());

            assert_eq!(
                verify_manifest_with(&manifest, &cx(&dark)).expect_err("there is no trust root"),
                CaseTrustError::PlaceholderKey,
                "the funnel every real path crosses"
            );
            assert_eq!(
                refuse(&manifest, &catalog, &cx(&dark)),
                CaseTrustError::PlaceholderKey,
                "the full chain"
            );

            let root = TempRoot::new("dark-trust-root");
            assert_eq!(
                cache_store_verified(&root.cache(), &manifest, &catalog, &cx(&dark))
                    .expect_err("a dark build must not populate its cache either"),
                CaseCacheError::Untrusted(CaseTrustError::PlaceholderKey),
                "the cache write path"
            );
            assert!(!root.file().exists(), "and it wrote nothing on the way out");
            assert_eq!(
                cache_load_verified(&root.cache(), &cx(&dark)).expect_err("nor read one"),
                CaseCacheError::Missing,
                "nothing was ever stored, so the read is Missing rather than Untrusted"
            );
        }
    }

    // ─── Last-known-good cache (plan task 4) ───────────────────────────────
    //
    // Real files in a real temp directory. A cache is a filesystem behaviour — atomicity, debris,
    // partial writes, a neighbour's data one directory up — and none of that is observable through
    // a mock, so these tests pay for a few directories and get to assert the thing that actually
    // ships.
    mod cache {
        use super::*;

        fn stored(root: &TempRoot, kp: &ed25519_compact::KeyPair) -> (Vec<u8>, Vec<u8>) {
            let (manifest, catalog) = signed_pair(kp);
            let key = key_of(kp);
            cache_store_verified(&root.cache(), &manifest, &catalog, &cx(&key))
                .expect("the fixture must store, or every test below is vacuous");
            (manifest, catalog)
        }

        /// Rewrite the cache file with a hand-edited envelope — the shape of an attacker, or of a
        /// half-written disk, that a load has to survive.
        fn rewrite_envelope(root: &TempRoot, edit: impl FnOnce(&mut Value)) {
            let mut envelope: Value =
                serde_json::from_slice(&std::fs::read(root.file()).unwrap()).unwrap();
            edit(&mut envelope);
            std::fs::write(root.file(), serde_json::to_vec(&envelope).unwrap()).unwrap();
        }

        // ── The positive control ───────────────────────────────────────────

        #[test]
        fn a_verified_pair_round_trips_through_the_cache() {
            let root = TempRoot::new("roundtrip");
            let kp = ed25519_compact::KeyPair::generate();
            stored(&root, &kp);
            let key = key_of(&kp);
            let (manifest, catalog) =
                cache_load_verified(&root.cache(), &cx(&key)).expect("should load");
            assert_eq!(manifest.catalog_version, 7);
            assert_eq!(catalog.entries.len(), 1);
        }

        #[test]
        fn a_missing_cache_is_the_ordinary_state_not_a_fault() {
            let root = TempRoot::new("missing");
            let kp = ed25519_compact::KeyPair::generate();
            let key = key_of(&kp);
            assert_eq!(
                cache_load_verified(&root.cache(), &cx(&key)).unwrap_err(),
                CaseCacheError::Missing,
                "a machine that has never fetched a catalog is not broken"
            );
        }

        // ── Namespacing ────────────────────────────────────────────────────

        #[test]
        fn the_cache_lives_in_its_own_namespace_and_holds_exactly_one_file() {
            let root = TempRoot::new("namespace");
            let kp = ed25519_compact::KeyPair::generate();
            stored(&root, &kp);

            assert_eq!(CASE_CACHE_DIR_NAME, "case-intelligence");
            let files: Vec<String> = std::fs::read_dir(root.cache())
                .unwrap()
                .flatten()
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .collect();
            assert_eq!(files, vec![CASE_CACHE_FILE_NAME.to_string()]);
        }

        /// The neighbours that must never be in reach: the Trust Ledger, the remote-rules cache and
        /// the support record all live one directory UP from this namespace.
        #[test]
        fn storing_loading_and_clearing_touch_nothing_outside_the_namespace() {
            let root = TempRoot::new("neighbours");
            let neighbours = ["history.json", "rules-manifest.json", "support-evidence.json"];
            for name in neighbours {
                std::fs::write(root.0.join(name), b"neighbour").unwrap();
            }

            let kp = ed25519_compact::KeyPair::generate();
            stored(&root, &kp);
            let key = key_of(&kp);
            let _ = cache_load_verified(&root.cache(), &cx(&key));
            cache_clear(&root.cache()).expect("clear");

            assert!(!root.cache().exists(), "the namespace itself is gone");
            for name in neighbours {
                assert_eq!(
                    std::fs::read(root.0.join(name)).unwrap(),
                    b"neighbour",
                    "{name} must be untouched by anything Tier 1 does"
                );
            }
        }

        #[test]
        fn clearing_a_cache_that_was_never_written_is_not_an_error() {
            let root = TempRoot::new("clear-empty");
            assert_eq!(cache_clear(&root.cache()), Ok(()));
        }

        // ── Only verified bytes are committed ──────────────────────────────

        #[test]
        fn storing_refuses_to_commit_a_pair_that_does_not_verify() {
            let root = TempRoot::new("refuse-store");
            let signer = ed25519_compact::KeyPair::generate();
            let other = ed25519_compact::KeyPair::generate();
            let (manifest, catalog) = signed_pair(&signer);

            let key = key_of(&other);
            assert_eq!(
                cache_store_verified(&root.cache(), &manifest, &catalog, &cx(&key)).unwrap_err(),
                CaseCacheError::Untrusted(CaseTrustError::SignatureInvalid)
            );
            assert!(!root.file().exists(), "nothing unproven may reach the disk at all");
        }

        /// The reason the envelope is one file: a store that fails must not cost the copy already
        /// held. Two files and two renames could not promise this.
        #[test]
        fn a_failed_store_leaves_the_previous_good_copy_intact() {
            let root = TempRoot::new("keep-lkg");
            let kp = ed25519_compact::KeyPair::generate();
            stored(&root, &kp);
            let good = std::fs::read(root.file()).unwrap();

            let impostor = ed25519_compact::KeyPair::generate();
            let (bad_manifest, bad_catalog) = signed_pair(&impostor);
            let key = key_of(&kp);
            assert!(cache_store_verified(&root.cache(), &bad_manifest, &bad_catalog, &cx(&key)).is_err());

            assert_eq!(std::fs::read(root.file()).unwrap(), good, "the LKG survives a bad update");
            assert!(cache_load_verified(&root.cache(), &cx(&key)).is_ok());
        }

        #[test]
        fn a_store_leaves_no_temp_file_behind() {
            let root = TempRoot::new("no-tmp");
            let kp = ed25519_compact::KeyPair::generate();
            stored(&root, &kp);
            assert!(
                !root.file().with_extension("json.tmp").exists(),
                "a rename, not a copy — a lingering .tmp means the swap did not happen"
            );
        }

        /// Debris is anything in the namespace that is not the one file. Pruning removes it and
        /// leaves the cache itself alone — that is the file-count cap.
        #[test]
        fn pruning_removes_debris_and_never_the_cache_itself() {
            let root = TempRoot::new("prune");
            let kp = ed25519_compact::KeyPair::generate();
            stored(&root, &kp);
            std::fs::write(root.cache().join("last-known-good.json.tmp"), b"{}").unwrap();
            std::fs::write(root.cache().join("catalog.json"), b"{}").unwrap();
            std::fs::create_dir_all(root.cache().join("stale-subdir")).unwrap();

            assert_eq!(cache_prune(&root.cache()), Ok(3));
            let key = key_of(&kp);
            assert!(cache_load_verified(&root.cache(), &cx(&key)).is_ok());
            assert_eq!(std::fs::read_dir(root.cache()).unwrap().count(), 1);
        }

        #[test]
        fn a_leftover_temp_file_does_not_disturb_a_load() {
            let root = TempRoot::new("tmp-ignored");
            let kp = ed25519_compact::KeyPair::generate();
            stored(&root, &kp);
            std::fs::write(root.file().with_extension("json.tmp"), b"torn").unwrap();
            let key = key_of(&kp);
            assert!(cache_load_verified(&root.cache(), &cx(&key)).is_ok());
        }

        // ── Verified again on every load ───────────────────────────────────

        /// The whole point of re-verifying: the cache sits in the user's own writable directory, so
        /// what was proven at store time proves nothing at load time.
        #[test]
        fn a_tampered_cached_catalog_is_refused_on_load() {
            let root = TempRoot::new("tamper-catalog");
            let kp = ed25519_compact::KeyPair::generate();
            stored(&root, &kp);
            rewrite_envelope(&root, |e| {
                let mut catalog: Value = serde_json::from_str(e["catalog"].as_str().unwrap()).unwrap();
                catalog["entries"][0]["next_steps"][0]["headline"] = json!("Run this installer");
                e["catalog"] = json!(serde_json::to_string(&catalog).unwrap());
            });
            let key = key_of(&kp);
            assert_eq!(
                cache_load_verified(&root.cache(), &cx(&key)).unwrap_err(),
                CaseCacheError::Untrusted(CaseTrustError::DigestMismatch)
            );
        }

        #[test]
        fn a_tampered_cached_manifest_is_refused_on_load() {
            let root = TempRoot::new("tamper-manifest");
            let kp = ed25519_compact::KeyPair::generate();
            stored(&root, &kp);
            rewrite_envelope(&root, |e| {
                let mut manifest: Value =
                    serde_json::from_str(e["manifest"].as_str().unwrap()).unwrap();
                manifest["catalog_version"] = json!(9999);
                e["manifest"] = json!(serde_json::to_string(&manifest).unwrap());
            });
            let key = key_of(&kp);
            assert_eq!(
                cache_load_verified(&root.cache(), &cx(&key)).unwrap_err(),
                CaseCacheError::Untrusted(CaseTrustError::SignatureInvalid)
            );
        }

        #[test]
        fn a_cache_written_under_a_different_key_is_refused_on_load() {
            let root = TempRoot::new("key-rotate");
            let kp = ed25519_compact::KeyPair::generate();
            stored(&root, &kp);
            let rotated = key_of(&ed25519_compact::KeyPair::generate());
            assert_eq!(
                cache_load_verified(&root.cache(), &cx(&rotated)).unwrap_err(),
                CaseCacheError::Untrusted(CaseTrustError::SignatureInvalid),
                "rotating the trust root must invalidate everything the old one signed"
            );
        }

        #[test]
        fn an_expired_cached_catalog_is_refused_on_load() {
            let root = TempRoot::new("expired");
            let kp = ed25519_compact::KeyPair::generate();
            stored(&root, &kp);
            let key = key_of(&kp);
            let mut context = cx(&key);
            context.now = at("2027-01-01T00:00:00Z");
            assert_eq!(
                cache_load_verified(&root.cache(), &context).unwrap_err(),
                CaseCacheError::Untrusted(CaseTrustError::Expired),
                "a cached copy does not get to outlive its own expiry"
            );
        }

        #[test]
        fn a_cached_catalog_below_the_rollback_floor_is_refused_on_load() {
            let root = TempRoot::new("rollback");
            let kp = ed25519_compact::KeyPair::generate();
            stored(&root, &kp); // catalog_version 7
            let key = key_of(&kp);
            let mut context = cx(&key);
            context.last_seen_catalog_version = 9;
            assert_eq!(
                cache_load_verified(&root.cache(), &context).unwrap_err(),
                CaseCacheError::Untrusted(CaseTrustError::CatalogVersionRollback {
                    latest: 9,
                    attempted: 7
                })
            );
        }

        // ── The rollback floor ─────────────────────────────────────────────

        /// The floor is read from a copy that VERIFIES, never from a number sitting in a file — and
        /// the cache is not allowed to be its own rollback evidence, so the floor is zeroed for the
        /// load that computes it.
        #[test]
        fn the_rollback_floor_comes_from_a_copy_that_verifies() {
            let root = TempRoot::new("floor");
            let kp = ed25519_compact::KeyPair::generate();
            stored(&root, &kp);
            let key = key_of(&kp);

            assert_eq!(cache_floor_version(&root.cache(), &cx(&key)), 7);

            let mut already_high = cx(&key);
            already_high.last_seen_catalog_version = 99;
            assert_eq!(
                cache_floor_version(&root.cache(), &already_high),
                7,
                "the floor must not be its own input, or the first high number would stick forever"
            );

            let rotated = key_of(&ed25519_compact::KeyPair::generate());
            assert_eq!(
                cache_floor_version(&root.cache(), &cx(&rotated)),
                0,
                "a version nobody can prove is not evidence of anything"
            );
        }

        #[test]
        fn the_floor_of_an_empty_cache_is_zero() {
            let root = TempRoot::new("floor-empty");
            let kp = ed25519_compact::KeyPair::generate();
            let key = key_of(&kp);
            assert_eq!(cache_floor_version(&root.cache(), &cx(&key)), 0);
        }

        // ── The envelope ───────────────────────────────────────────────────

        /// The cache holds the two downloaded documents and NOTHING local. No incident, no match, no
        /// machine fact, not even a timestamp of our own — `deny_unknown_fields` on the envelope
        /// means a future attempt to add one fails to parse instead of quietly persisting.
        #[test]
        fn the_envelope_holds_the_two_documents_verbatim_and_nothing_local() {
            let root = TempRoot::new("envelope");
            let kp = ed25519_compact::KeyPair::generate();
            let (manifest, catalog) = stored(&root, &kp);

            let written: Value = serde_json::from_slice(&std::fs::read(root.file()).unwrap()).unwrap();
            let mut keys: Vec<&str> = written.as_object().unwrap().keys().map(|k| k.as_str()).collect();
            keys.sort_unstable();
            assert_eq!(keys, vec!["catalog", "envelope_version", "manifest"]);

            assert_eq!(written["manifest"].as_str().unwrap().as_bytes(), manifest.as_slice());
            assert_eq!(written["catalog"].as_str().unwrap().as_bytes(), catalog.as_slice());
            assert_eq!(written["envelope_version"], json!(CASE_CACHE_ENVELOPE_VERSION));
        }

        #[test]
        fn an_envelope_carrying_an_extra_field_is_refused() {
            let root = TempRoot::new("extra-field");
            let kp = ed25519_compact::KeyPair::generate();
            stored(&root, &kp);
            rewrite_envelope(&root, |e| {
                e["last_incident_id"] = json!("local-machine-fact");
            });
            let key = key_of(&kp);
            assert!(matches!(
                cache_load_verified(&root.cache(), &cx(&key)).unwrap_err(),
                CaseCacheError::Corrupt(_)
            ));
        }

        #[test]
        fn an_envelope_from_another_version_is_refused() {
            let root = TempRoot::new("envelope-version");
            let kp = ed25519_compact::KeyPair::generate();
            stored(&root, &kp);
            rewrite_envelope(&root, |e| {
                e["envelope_version"] = json!(CASE_CACHE_ENVELOPE_VERSION + 1);
            });
            let key = key_of(&kp);
            assert!(matches!(
                cache_load_verified(&root.cache(), &cx(&key)).unwrap_err(),
                CaseCacheError::Corrupt(_)
            ));
        }

        #[test]
        fn a_corrupt_cache_file_is_refused_without_a_panic() {
            let root = TempRoot::new("corrupt");
            let kp = ed25519_compact::KeyPair::generate();
            stored(&root, &kp);
            let good = std::fs::read(root.file()).unwrap();
            let key = key_of(&kp);

            for (why, bytes) in [
                ("truncated mid-write", good[..good.len() / 2].to_vec()),
                ("empty", Vec::new()),
                ("not json", b"\x00\x01\x02 not json".to_vec()),
                ("json but not an envelope", b"[1,2,3]".to_vec()),
            ] {
                std::fs::write(root.file(), &bytes).unwrap();
                assert!(
                    matches!(
                        cache_load_verified(&root.cache(), &cx(&key)).unwrap_err(),
                        CaseCacheError::Corrupt(_)
                    ),
                    "a {why} cache must be refused, never panic"
                );
            }
        }

        #[test]
        fn an_oversized_cache_file_is_refused_before_it_is_parsed() {
            let root = TempRoot::new("oversize");
            let kp = ed25519_compact::KeyPair::generate();
            stored(&root, &kp);
            let huge = vec![b'x'; CASE_CACHE_MAX_BYTES + 1];
            std::fs::write(root.file(), &huge).unwrap();
            let key = key_of(&kp);
            assert_eq!(
                cache_load_verified(&root.cache(), &cx(&key)).unwrap_err(),
                CaseCacheError::Oversize {
                    found: CASE_CACHE_MAX_BYTES + 1,
                    max: CASE_CACHE_MAX_BYTES
                },
                "the cap is a stat on the file, not a failure part-way through reading it"
            );
        }

        // ── The darkness proof ─────────────────────────────────────────────

        /// The production read is `None` in this build and never touches the disk to find out: the
        /// gate is checked first, and behind it the placeholder trust root would refuse anything a
        /// load returned anyway.
        #[test]
        fn the_production_read_returns_nothing_because_tier_1_is_dark() {
            assert!(!case_intelligence_gate());
            assert!(cached_catalog().is_none());
            assert!(case_cache_dir().ends_with(CASE_CACHE_DIR_NAME));
        }
    }

    /// Plan task 5 — the local matcher.
    ///
    /// Every test here is pure except the three that exercise `advise_in`, and those touch only a
    /// temp directory. Nothing in this module opens a socket, and that is the point: matching a
    /// crash against public knowledge is something Compy does entirely on the user's side of the
    /// wire. The catalog travels; the incident never does.
    mod matcher {
        use super::*;

        // ── Fixtures ───────────────────────────────────────────────────────

        /// Build a catalog through the real parser, so a fixture can never assert behaviour on a
        /// document the shipped path would have refused.
        fn catalog_of(entries: Vec<Value>) -> CaseCatalog {
            let doc = json!({ "schema_version": CASE_SCHEMA_VERSION, "entries": entries });
            parse_catalog(&doc.to_string()).expect("fixture catalog must parse")
        }

        fn one(entry: Value) -> CaseCatalog {
            catalog_of(vec![entry])
        }

        fn entry_with(edit: impl FnOnce(&mut Value)) -> Value {
            let mut entry = base_entry();
            edit(&mut entry);
            entry
        }

        /// The incident `base_entry` was written about: a display-driver timeout naming amdkmdag.
        fn gpu_incident() -> CaseIncidentFacts {
            CaseIncidentFacts {
                kind: CaseIncidentKind::GpuTimeout,
                faulting_app: None,
                faulting_module: Some(
                    "C:\\Windows\\System32\\DriverStore\\FileRepository\\amdkmdag.sys".to_string(),
                ),
                error_code: None,
                has_vitals: true,
            }
        }

        fn amd_facts() -> CaseLocalFacts {
            CaseLocalFacts {
                gpu_vendor: Some("AMD".to_string()),
                gpu_driver_version: Some("26.1.1".to_string()),
                windows_build: Some(26100),
            }
        }

        fn found(outcome: &CaseMatchOutcome) -> &CaseIntelligenceMatch {
            match outcome {
                CaseMatchOutcome::Found(m) => m,
                CaseMatchOutcome::Nothing(level) => {
                    panic!("expected a match, got {level:?}")
                }
            }
        }

        fn run(catalog: &CaseCatalog) -> CaseMatchOutcome {
            match_facts(catalog, 7, &gpu_incident(), &amd_facts())
        }

        // ── The positive control ───────────────────────────────────────────
        //
        // If this ever fails, every negative test below is passing for free.

        #[test]
        fn the_recorded_shape_matches_and_the_result_is_the_catalogs_own_words() {
            let catalog = one(base_entry());
            let outcome = run(&catalog);
            let m = found(&outcome);
            assert_eq!(m.level, CaseMatchLevel::MatchedKnownIssue);
            assert_eq!(m.case_id, "amd-tdr-adrenalin-2026-q1");
            assert_eq!(m.catalog_version, 7);
            assert_eq!(m.title, catalog.entries[0].title);
            assert_eq!(m.summary, catalog.entries[0].summary);
            assert_eq!(m.source_url, catalog.entries[0].source_url);
        }

        // ── The incident kind is a gate, not a hint ────────────────────────

        #[test]
        fn a_writeup_about_another_incident_kind_never_matches() {
            let catalog = one(entry_with(|e| e["incident_kinds"] = json!(["app_crash"])));
            assert_eq!(run(&catalog).level(), CaseMatchLevel::NoKnownMatch);
        }

        #[test]
        fn an_entry_listing_several_kinds_matches_any_one_of_them() {
            let catalog =
                one(entry_with(|e| e["incident_kinds"] = json!(["blue_screen", "gpu_timeout"])));
            assert_eq!(run(&catalog).level(), CaseMatchLevel::MatchedKnownIssue);
        }

        // ── Matchers are an AND, and an absent fact is never a pass ────────

        #[test]
        fn every_matcher_must_hold_not_merely_one_of_them() {
            // The module still lines up; the vendor no longer does.
            let catalog = one(base_entry());
            let facts = CaseLocalFacts { gpu_vendor: Some("nvidia".into()), ..amd_facts() };
            let outcome = match_facts(&catalog, 7, &gpu_incident(), &facts);
            assert_eq!(outcome.level(), CaseMatchLevel::NoKnownMatch);
        }

        #[test]
        fn a_matcher_over_a_fact_compy_cannot_see_fails_rather_than_passes() {
            // The heart of the refuse-to-guess rail: unknown is not "probably yes".
            let catalog = one(base_entry());
            let facts = CaseLocalFacts { gpu_vendor: None, ..amd_facts() };
            let outcome = match_facts(&catalog, 7, &gpu_incident(), &facts);
            assert_eq!(outcome.level(), CaseMatchLevel::NoKnownMatch);
        }

        #[test]
        fn an_entry_with_no_matchers_cannot_match_every_incident_of_its_kind() {
            // The schema already refuses this document, so it is built by hand to reach the second
            // lock. Two locks, because "matches every GPU timeout ever" is the single worst thing a
            // signed catalog could be talked into saying.
            let catalog = CaseCatalog {
                schema_version: CASE_SCHEMA_VERSION,
                entries: vec![CaseEntry {
                    id: "catch-all".into(),
                    revision: 1,
                    incident_kinds: vec![CaseIncidentKind::GpuTimeout],
                    matchers: vec![],
                    required_evidence: vec![],
                    title: "Everything".into(),
                    summary: "Anything at all.".into(),
                    next_steps: vec![],
                    contraindications: vec![],
                    source_url: "https://www.amd.com/x".into(),
                    source_updated_at: "2026-02-04T00:00:00Z".into(),
                }],
            };
            assert_eq!(run(&catalog).level(), CaseMatchLevel::NoKnownMatch);
        }

        // ── Each matcher, checked on its own terms ─────────────────────────

        #[test]
        fn an_app_family_ignores_the_path_the_case_and_the_extension() {
            let catalog = one(entry_with(|e| {
                e["matchers"] = json!([{ "app_family_equals": { "value": "bar" } }]);
                e["required_evidence"] = json!(["faulting_app"]);
            }));
            let incident = CaseIncidentFacts {
                faulting_app: Some("C:\\Games\\Foo\\Bar.EXE".to_string()),
                ..gpu_incident()
            };
            let outcome = match_facts(&catalog, 7, &incident, &amd_facts());
            assert_eq!(outcome.level(), CaseMatchLevel::MatchedKnownIssue);
        }

        #[test]
        fn a_prefix_matcher_is_anchored_and_is_never_a_substring_search() {
            // `amd` must reach amdkmdag and must NOT reach xamdy. The day this fails, the matcher
            // language has quietly become a pattern language.
            let catalog = one(entry_with(|e| {
                e["matchers"] = json!([{ "module_family_prefix": { "value": "amd" } }]);
                e["required_evidence"] = json!(["faulting_module"]);
            }));

            let hits = CaseIncidentFacts {
                faulting_module: Some("amdkmdag.sys".into()),
                ..gpu_incident()
            };
            assert_eq!(
                match_facts(&catalog, 7, &hits, &amd_facts()).level(),
                CaseMatchLevel::MatchedKnownIssue
            );

            let misses =
                CaseIncidentFacts { faulting_module: Some("xamdy.sys".into()), ..gpu_incident() };
            assert_eq!(
                match_facts(&catalog, 7, &misses, &amd_facts()).level(),
                CaseMatchLevel::NoKnownMatch
            );
        }

        #[test]
        fn an_error_code_folds_case_and_surrounding_space_and_nothing_else() {
            let catalog = one(entry_with(|e| {
                e["matchers"] = json!([{ "error_code_equals": { "value": "0xc0000005" } }]);
                e["required_evidence"] = json!(["error_code"]);
            }));

            let spelled_loudly = CaseIncidentFacts {
                error_code: Some("  0xC0000005 ".into()),
                ..gpu_incident()
            };
            assert_eq!(
                match_facts(&catalog, 7, &spelled_loudly, &amd_facts()).level(),
                CaseMatchLevel::MatchedKnownIssue
            );

            let different_code =
                CaseIncidentFacts { error_code: Some("0xc0000006".into()), ..gpu_incident() };
            assert_eq!(
                match_facts(&catalog, 7, &different_code, &amd_facts()).level(),
                CaseMatchLevel::NoKnownMatch
            );
        }

        #[test]
        fn a_driver_version_inside_the_range_matches_and_one_outside_it_does_not() {
            let catalog = one(entry_with(|e| {
                e["matchers"] =
                    json!([{ "gpu_driver_version_range": { "min": "26.1.0", "max": "26.2.0" } }]);
                e["required_evidence"] = json!(["gpu_driver_version"]);
            }));

            assert_eq!(run_with_driver(&catalog, "26.1.1"), CaseMatchLevel::MatchedKnownIssue);
            assert_eq!(run_with_driver(&catalog, "26.1.0"), CaseMatchLevel::MatchedKnownIssue);
            assert_eq!(run_with_driver(&catalog, "26.2.0"), CaseMatchLevel::MatchedKnownIssue);
            assert_eq!(run_with_driver(&catalog, "26.0.9"), CaseMatchLevel::NoKnownMatch);
            assert_eq!(run_with_driver(&catalog, "26.2.1"), CaseMatchLevel::NoKnownMatch);
        }

        fn run_with_driver(catalog: &CaseCatalog, driver: &str) -> CaseMatchLevel {
            let facts = CaseLocalFacts { gpu_driver_version: Some(driver.into()), ..amd_facts() };
            match_facts(catalog, 7, &gpu_incident(), &facts).level()
        }

        #[test]
        fn a_driver_range_compares_in_release_order_not_alphabetical_order() {
            // "26.10" sorts BEFORE "26.9" as text and AFTER it as a release. A string compare here
            // would quietly offer 26.10 users advice written for a driver they are past.
            let catalog = one(entry_with(|e| {
                e["matchers"] =
                    json!([{ "gpu_driver_version_range": { "min": "26.1", "max": "26.9" } }]);
                e["required_evidence"] = json!(["gpu_driver_version"]);
            }));
            assert_eq!(run_with_driver(&catalog, "26.9"), CaseMatchLevel::MatchedKnownIssue);
            assert_eq!(run_with_driver(&catalog, "26.10"), CaseMatchLevel::NoKnownMatch);
        }

        #[test]
        fn a_driver_string_compy_cannot_read_as_a_version_never_lands_inside_a_range() {
            let catalog = one(entry_with(|e| {
                e["matchers"] =
                    json!([{ "gpu_driver_version_range": { "min": "0.0.1", "max": "99.0.0" } }]);
                e["required_evidence"] = json!(["gpu_driver_version"]);
            }));
            assert_eq!(run_with_driver(&catalog, "Adrenalin 26.1"), CaseMatchLevel::NoKnownMatch);
            assert_eq!(run_with_driver(&catalog, ""), CaseMatchLevel::NoKnownMatch);
        }

        #[test]
        fn a_windows_build_range_is_inclusive_at_both_ends() {
            let catalog = one(entry_with(|e| {
                e["matchers"] = json!([{ "windows_build_range": { "min": 26100, "max": 26200 } }]);
                e["required_evidence"] = json!(["windows_build"]);
            }));
            for (build, expected) in [
                (26099u32, CaseMatchLevel::NoKnownMatch),
                (26100, CaseMatchLevel::MatchedKnownIssue),
                (26200, CaseMatchLevel::MatchedKnownIssue),
                (26201, CaseMatchLevel::NoKnownMatch),
            ] {
                let facts = CaseLocalFacts { windows_build: Some(build), ..amd_facts() };
                assert_eq!(
                    match_facts(&catalog, 7, &gpu_incident(), &facts).level(),
                    expected,
                    "build {build}"
                );
            }
        }

        // ── Required evidence sets the level ───────────────────────────────
        //
        // Matchers ask whether the facts AGREE. Required evidence asks whether Compy can SEE enough
        // to stand behind the answer. Different questions, and the level is the second one.

        #[test]
        fn missing_required_evidence_drops_a_hit_to_possible() {
            let catalog = one(entry_with(|e| {
                e["required_evidence"] = json!(["faulting_module", "gpu_vendor", "vitals"]);
            }));
            let blind = CaseIncidentFacts { has_vitals: false, ..gpu_incident() };
            let outcome = match_facts(&catalog, 7, &blind, &amd_facts());
            assert_eq!(outcome.level(), CaseMatchLevel::PossibleKnownIssue);
        }

        #[test]
        fn evidence_refs_name_the_facts_and_never_carry_their_values() {
            // A ref is a key. The day one carries an executable name, a match becomes a thing that
            // could not safely be logged, shown to a friend, or sent anywhere under any later tier.
            let catalog = one(base_entry());
            let outcome = run(&catalog);
            let m = found(&outcome);
            assert_eq!(m.evidence_refs, vec!["faulting_module", "gpu_vendor"]);
            let joined = m.evidence_refs.join(" ");
            assert!(!joined.to_lowercase().contains("amdkmdag"), "leaked a module name: {joined}");
            assert!(!joined.contains("C:\\"), "leaked a path: {joined}");
        }

        #[test]
        fn evidence_refs_are_sorted_and_deduplicated_so_a_match_reads_the_same_every_time() {
            // Two matchers over the same fact, and that fact also required: one ref, not three.
            let catalog = one(entry_with(|e| {
                e["matchers"] = json!([
                    { "module_family_prefix": { "value": "amd" } },
                    { "module_family_equals": { "value": "amdkmdag" } }
                ]);
                e["required_evidence"] = json!(["faulting_module"]);
            }));
            let outcome = run(&catalog);
            assert_eq!(found(&outcome).evidence_refs, vec!["faulting_module"]);
        }

        // ── Suppression: what a maybe is allowed to suggest ────────────────

        fn two_steps() -> Value {
            json!([
                {
                    "headline": "Install the newest Adrenalin driver",
                    "detail": "AMD published a driver that changes this behaviour.",
                    "research_only": false
                },
                {
                    "headline": "Have the power supply checked",
                    "detail": "A shop can test whether the supply holds up under load.",
                    "research_only": true
                }
            ])
        }

        #[test]
        fn a_possible_match_withholds_the_irreversible_steps_entirely() {
            // research_only marks a fix nobody can undo: a PSU swap, a repaste, a BIOS flash.
            // Pointing someone at one of those on a maybe is the harm this level exists to prevent.
            let catalog = one(entry_with(|e| {
                e["next_steps"] = two_steps();
                e["required_evidence"] = json!(["faulting_module", "gpu_vendor", "vitals"]);
            }));
            let blind = CaseIncidentFacts { has_vitals: false, ..gpu_incident() };
            let outcome = match_facts(&catalog, 7, &blind, &amd_facts());
            let m = found(&outcome);
            assert_eq!(m.level, CaseMatchLevel::PossibleKnownIssue);
            assert_eq!(m.next_steps.len(), 1);
            assert!(!m.next_steps[0].research_only);
        }

        #[test]
        fn a_full_match_keeps_the_irreversible_steps_and_keeps_them_flagged() {
            let catalog = one(entry_with(|e| e["next_steps"] = two_steps()));
            let outcome = run(&catalog);
            let m = found(&outcome);
            assert_eq!(m.level, CaseMatchLevel::MatchedKnownIssue);
            assert_eq!(m.next_steps.len(), 2);
            assert!(m.next_steps[1].research_only, "the flag must survive to the surface");
        }

        #[test]
        fn a_possible_match_whose_every_step_is_irreversible_offers_none_of_them() {
            let catalog = one(entry_with(|e| {
                e["next_steps"] = json!([{
                    "headline": "Have the power supply checked",
                    "detail": "A shop can test whether the supply holds up under load.",
                    "research_only": true
                }]);
                e["required_evidence"] = json!(["faulting_module", "gpu_vendor", "vitals"]);
            }));
            let blind = CaseIncidentFacts { has_vitals: false, ..gpu_incident() };
            let outcome = match_facts(&catalog, 7, &blind, &amd_facts());
            let m = found(&outcome);
            assert!(m.next_steps.is_empty());
            // Still worth showing: the write-up, the caveats and where it came from are the value.
            assert!(!m.summary.is_empty());
            assert!(!m.source_url.is_empty());
        }

        #[test]
        fn contraindications_ride_along_at_every_level() {
            // A step shown without its own caveat is worse than no step: the caveat is the part that
            // stops someone doing it in the one situation where it hurts.
            let catalog = one(base_entry());
            let full = run(&catalog);
            assert_eq!(found(&full).contraindications, catalog.entries[0].contraindications);

            let partial_catalog = one(entry_with(|e| {
                e["required_evidence"] = json!(["faulting_module", "gpu_vendor", "vitals"]);
            }));
            let blind = CaseIncidentFacts { has_vitals: false, ..gpu_incident() };
            let partial = match_facts(&partial_catalog, 7, &blind, &amd_facts());
            assert_eq!(found(&partial).level, CaseMatchLevel::PossibleKnownIssue);
            assert_eq!(found(&partial).contraindications.len(), 1);
        }

        // ── One answer, chosen the same way every time ─────────────────────

        fn named(id: &str, edit: impl FnOnce(&mut Value)) -> Value {
            let mut entry = base_entry();
            entry["id"] = json!(id);
            edit(&mut entry);
            entry
        }

        #[test]
        fn a_full_match_outranks_a_possible_one_whatever_order_they_are_written_in() {
            let possible = named("aaa-possible", |e| {
                e["required_evidence"] = json!(["faulting_module", "gpu_vendor", "error_code"]);
            });
            let full = named("zzz-full", |_| {});
            for entries in [vec![possible.clone(), full.clone()], vec![full, possible]] {
                let catalog = catalog_of(entries);
                let outcome = run(&catalog);
                assert_eq!(found(&outcome).case_id, "zzz-full");
            }
        }

        #[test]
        fn between_two_full_matches_the_more_specific_write_up_wins() {
            let broad = named("aaa-broad", |e| {
                e["matchers"] = json!([{ "gpu_vendor_equals": { "value": "amd" } }]);
                e["required_evidence"] = json!(["gpu_vendor"]);
            });
            let specific = named("zzz-specific", |_| {}); // two matchers
            let catalog = catalog_of(vec![broad, specific]);
            assert_eq!(found(&run(&catalog)).case_id, "zzz-specific");
        }

        #[test]
        fn an_exact_tie_breaks_on_revision_and_then_on_id_so_two_runs_never_disagree() {
            let older = named("bbb", |e| e["revision"] = json!(2));
            let newer = named("ccc", |e| e["revision"] = json!(9));
            let catalog = catalog_of(vec![older, newer]);
            assert_eq!(found(&run(&catalog)).case_id, "ccc", "the later revision wins");

            let left = named("bbb", |e| e["revision"] = json!(4));
            let right = named("ccc", |e| e["revision"] = json!(4));
            let tied = catalog_of(vec![right, left]);
            assert_eq!(found(&run(&tied)).case_id, "bbb", "a dead tie breaks on id, ascending");
        }

        #[test]
        fn the_same_catalog_and_the_same_incident_always_produce_the_same_answer() {
            let a = named("aaa", |_| {});
            let b = named("bbb", |_| {});
            let c = named("ccc", |_| {});
            let forward = catalog_of(vec![a.clone(), b.clone(), c.clone()]);
            let backward = catalog_of(vec![c, b, a]);
            let first = run(&forward);
            assert_eq!(first, run(&forward), "the matcher must be a function, not a coin toss");
            assert_eq!(found(&first).case_id, found(&run(&backward)).case_id);
        }

        // ── Honesty ────────────────────────────────────────────────────────

        #[test]
        fn the_matcher_writes_no_prose_of_its_own() {
            // Every word a user reads was signed by whoever wrote the case up. Compy contributes the
            // level and which facts lined up, and nothing else — which is why "caused", "definitely"
            // and "fixed" can be barred at the catalog's door and stay barred.
            let catalog = one(entry_with(|e| e["next_steps"] = two_steps()));
            let entry = &catalog.entries[0];
            let outcome = run(&catalog);
            let m = found(&outcome);
            assert_eq!(m.title, entry.title);
            assert_eq!(m.summary, entry.summary);
            assert_eq!(m.case_id, entry.id);
            assert_eq!(m.next_steps, entry.next_steps);
            assert_eq!(m.contraindications, entry.contraindications);
            assert_eq!(m.source_url, entry.source_url);
            assert_eq!(m.source_updated_at, entry.source_updated_at);
        }

        #[test]
        fn a_match_carries_no_numeric_confidence_on_the_wire() {
            let catalog = one(base_entry());
            let outcome = run(&catalog);
            let wire = serde_json::to_value(found(&outcome)).unwrap();
            let keys: Vec<&str> = wire.as_object().unwrap().keys().map(|k| k.as_str()).collect();
            for banned in ["confidence", "score", "probability", "percent", "certainty", "rank"] {
                assert!(!keys.contains(&banned), "{banned} must never reach the wire: {keys:?}");
            }
            assert_eq!(wire["level"], json!("matched_known_issue"));
        }

        // ── The Black Box seam ─────────────────────────────────────────────

        fn bb_incident() -> crate::blackbox::Incident {
            crate::blackbox::Incident {
                incident_id: "test-incident".into(),
                headline: "Your display driver stopped responding".into(),
                tag: "Display 4101".into(),
                when: "2026-08-20T21:42:00-05:00".into(),
                when_display: "Aug 20, 9:42 PM".into(),
                vitals: None,
                receipt: crate::blackbox::Receipt {
                    source: "System log · Display 4101".into(),
                    event_ids: vec![4101],
                    faulting_app: None,
                    faulting_module: Some("amdkmdag.sys".into()),
                    code: None,
                    detail: "Display driver amdkmdag stopped responding and has recovered.".into(),
                },
                assessment: None,
                case_intelligence: None,
                changed_before: None,
                kind: crate::blackbox::IncidentKind::GpuTimeout,
            }
        }

        #[test]
        fn the_adapter_reads_a_black_box_incident_without_black_box_knowing_tier_one_exists() {
            // `blackbox.rs` is not modified by this task. The seam lives on Tier 1's side, so the
            // frozen characterization tests from task 1 still mean what they said.
            let catalog = one(entry_with(|e| e["required_evidence"] = json!(["faulting_module"])));
            let outcome = match_incident(&catalog, 7, &bb_incident(), &amd_facts());
            assert_eq!(outcome.level(), CaseMatchLevel::MatchedKnownIssue);
        }

        #[test]
        fn nothing_on_the_matching_path_can_be_serialized_into_a_request() {
            // The plan's words: the matcher "creates no serializable request or payload". The facts
            // types are the ones a future send path would reach for, so they must not be reachable —
            // a derive is one word, and this test is the thing that has to be argued with.
            let source = include_str!("case_intelligence.rs");
            for name in ["struct CaseLocalFacts", "struct CaseIncidentFacts"] {
                let at = source.find(name).unwrap_or_else(|| panic!("{name} not found"));
                let derives = &source[at.saturating_sub(160)..at];
                assert!(
                    !derives.contains("Serialize"),
                    "{name} must not derive Serialize — matching is a local decision"
                );
            }
        }

        // ── The three empty answers, and the shipped path ──────────────────

        #[test]
        fn a_machine_that_has_never_fetched_a_catalog_has_no_catalog_not_an_error() {
            let root = TempRoot::new("advise-missing");
            let key = key_of(&ed25519_compact::KeyPair::generate());
            let outcome =
                advise_in(&root.cache(), &cx(&key), &gpu_incident(), &amd_facts());
            assert_eq!(outcome, CaseMatchOutcome::Nothing(CaseMatchLevel::NoCatalog));
        }

        #[test]
        fn a_catalog_we_hold_but_cannot_prove_is_unavailable_rather_than_absent() {
            // Different facts about Compy, so different answers. "Never fetched" and "held but no
            // longer trustworthy" must not collapse into one word.
            let root = TempRoot::new("advise-corrupt");
            std::fs::create_dir_all(root.cache()).unwrap();
            std::fs::write(root.file(), b"{ not an envelope").unwrap();
            let key = key_of(&ed25519_compact::KeyPair::generate());
            let outcome =
                advise_in(&root.cache(), &cx(&key), &gpu_incident(), &amd_facts());
            assert_eq!(outcome, CaseMatchOutcome::Nothing(CaseMatchLevel::CatalogUnavailable));
        }

        #[test]
        fn the_shipped_entry_point_is_dark_and_never_touches_the_disk() {
            assert!(!case_intelligence_gate(), "task 5 must not arm anything");
            let outcome = advise(&bb_incident(), &amd_facts());
            assert_eq!(outcome, CaseMatchOutcome::Nothing(CaseMatchLevel::NoCatalog));
        }
    }

    /// Plan task 6 — the pull path.
    ///
    /// These drive a REAL local HTTP server on 127.0.0.1 through the REAL reqwest client, because
    /// the claims worth making here — "it is a bare GET", "a redirect is refused", "the body is
    /// capped" — are claims about bytes on a wire, and a mock would only agree with whatever the
    /// code already does. Nothing leaves the loopback interface; the server binds port 0, serves a
    /// scripted answer, records the exact request it received, and dies with the test.
    mod transport {
        use super::*;
        use std::io::{Read, Write};
        use std::sync::{Arc, Mutex};

        // ── A local HTTP server, in as few lines as will hold a request ─────

        struct Fixture {
            base: String,
            seen: Arc<Mutex<Vec<String>>>,
        }

        impl Fixture {
            /// Serve `script` in order, one answer per connection.
            fn start(script: Vec<Vec<u8>>) -> Self {
                let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind loopback");
                let base = format!("http://{}", listener.local_addr().unwrap());
                let seen = Arc::new(Mutex::new(Vec::new()));
                let sink = Arc::clone(&seen);
                std::thread::spawn(move || {
                    for answer in script {
                        let Ok((mut stream, _)) = listener.accept() else { return };
                        let mut head = Vec::new();
                        let mut byte = [0u8; 1];
                        while !head.ends_with(b"\r\n\r\n") {
                            match stream.read(&mut byte) {
                                Ok(1) => head.push(byte[0]),
                                _ => break,
                            }
                        }
                        sink.lock().unwrap().push(String::from_utf8_lossy(&head).to_string());
                        let _ = stream.write_all(&answer);
                        let _ = stream.flush();
                    }
                });
                Self { base, seen }
            }

            fn url(&self, path: &str) -> String {
                format!("{}{path}", self.base)
            }

            /// Every request the server actually received, verbatim.
            fn requests(&self) -> Vec<String> {
                self.seen.lock().unwrap().clone()
            }
        }

        fn answer(status: &str, extra_headers: &str, body: &[u8]) -> Vec<u8> {
            let head = format!(
                "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n{extra_headers}\r\n",
                body.len()
            );
            let mut out = head.into_bytes();
            out.extend_from_slice(body);
            out
        }

        fn ok(body: &[u8]) -> Vec<u8> {
            answer("200 OK", "", body)
        }

        // ── The transport itself, over a real socket ───────────────────────

        #[test]
        fn a_plain_two_hundred_comes_back_whole() {
            let server = Fixture::start(vec![ok(b"{\"hello\":true}")]);
            let got = ReqwestCaseHttp
                .get(&server.url("/v1/manifest.json"), 4096)
                .expect("the fixture must answer, or every transport test below is vacuous");
            assert_eq!(got.status, 200);
            assert_eq!(got.body, b"{\"hello\":true}");
        }

        #[test]
        fn the_bytes_on_the_wire_are_a_bare_get_with_nothing_attached() {
            // The strongest statement this file can make: not "the code looks like a GET" but "the
            // server received a GET, with no query string, no cookie, no authorization and no body".
            let server = Fixture::start(vec![ok(b"{}")]);
            ReqwestCaseHttp.get(&server.url("/v1/manifest.json"), 4096).unwrap();

            let requests = server.requests();
            assert_eq!(requests.len(), 1, "one request, not a retry storm");
            let request = &requests[0];
            assert!(request.starts_with("GET /v1/manifest.json HTTP/1.1\r\n"), "{request}");
            assert!(!request.contains('?'), "a query string reached the wire: {request}");
            let lower = request.to_lowercase();
            for banned in ["cookie", "authorization", "x-", "content-length", "content-type"] {
                assert!(!lower.contains(banned), "the request carries {banned}: {request}");
            }
            assert!(lower.contains("user-agent: compy\r\n"), "{request}");
            // Head only: a GET with a body would have to declare one, and nothing follows the head.
            assert!(request.ends_with("\r\n\r\n"), "{request}");
        }

        #[test]
        fn a_redirect_is_refused_rather_than_followed() {
            // reqwest follows ten hops by default. Following even one would walk the request
            // straight off the compiled allowlist, so the policy is none() and a 3xx is an error.
            let server = Fixture::start(vec![answer(
                "302 Found",
                "Location: https://elsewhere.example.test/catalog.json\r\n",
                b"",
            )]);
            let refused = ReqwestCaseHttp.get(&server.url("/v1/manifest.json"), 4096);
            assert_eq!(refused, Err(CaseFetchError::Redirected(302)));
            assert_eq!(server.requests().len(), 1, "it must not have chased the Location header");
        }

        #[test]
        fn a_non_two_hundred_is_refused_with_its_status() {
            for (line, code) in [("404 Not Found", 404u16), ("500 Internal Server Error", 500)] {
                let server = Fixture::start(vec![answer(line, "", b"nope")]);
                assert_eq!(
                    ReqwestCaseHttp.get(&server.url("/v1/manifest.json"), 4096),
                    Err(CaseFetchError::Status(code))
                );
            }
        }

        #[test]
        fn an_oversized_answer_is_refused_on_the_declared_length_before_it_is_read() {
            let body = vec![b'x'; 5000];
            let server = Fixture::start(vec![ok(&body)]);
            let refused = ReqwestCaseHttp.get(&server.url("/v1/catalog.json"), 1024);
            assert_eq!(refused, Err(CaseFetchError::Oversize { found: 5000, max: 1024 }));
        }

        #[test]
        fn an_unreachable_endpoint_is_a_refusal_and_never_a_panic() {
            // Port 1 on loopback: nothing listens, and the refusal must be an ordinary Err.
            let refused = ReqwestCaseHttp.get("http://127.0.0.1:1/manifest.json", 4096);
            assert!(matches!(refused, Err(CaseFetchError::Transport(_))), "{refused:?}");
        }

        // ── The refresh, end to end ────────────────────────────────────────

        /// A transport that records what it was asked for and answers from a script — used where the
        /// question is about the ORDER of refusals rather than about bytes on a wire.
        struct Scripted {
            answers: Mutex<Vec<Result<CaseHttpResponse, CaseFetchError>>>,
            asked: Mutex<Vec<String>>,
        }

        impl Scripted {
            fn new(answers: Vec<Result<CaseHttpResponse, CaseFetchError>>) -> Self {
                Self { answers: Mutex::new(answers), asked: Mutex::new(Vec::new()) }
            }
            fn refusing() -> Self {
                Self::new(Vec::new())
            }
            fn asked(&self) -> Vec<String> {
                self.asked.lock().unwrap().clone()
            }
        }

        impl CaseHttp for Scripted {
            fn get(&self, url: &str, _max_bytes: usize) -> Result<CaseHttpResponse, CaseFetchError> {
                self.asked.lock().unwrap().push(url.to_string());
                let mut answers = self.answers.lock().unwrap();
                if answers.is_empty() {
                    return Err(CaseFetchError::Transport("no answer scripted".into()));
                }
                answers.remove(0)
            }
        }

        fn body_of(bytes: &[u8]) -> Result<CaseHttpResponse, CaseFetchError> {
            Ok(CaseHttpResponse { status: 200, body: bytes.to_vec() })
        }

        const MANIFEST_URL: &str = "https://cases.example.test/v1/manifest.json";
        const ENDPOINTS: &[&str] = &[MANIFEST_URL];

        #[test]
        fn a_verified_refresh_lands_in_the_cache_and_is_readable_again() {
            let root = TempRoot::new("refresh-ok");
            let kp = ed25519_compact::KeyPair::generate();
            let (manifest, catalog) = signed_pair(&kp);
            let http = Scripted::new(vec![body_of(&manifest), body_of(&catalog)]);
            let key = key_of(&kp);

            let stored = refresh_with(&http, &root.cache(), &cx(&key), ENDPOINTS)
                .expect("a correctly signed pair must land");
            assert_eq!(stored.catalog_version, 7);
            // The manifest is asked for first, and the body it names second — never the other way.
            assert_eq!(http.asked(), vec![MANIFEST_URL.to_string(), stored.catalog_url.clone()]);

            let (_, cached) = cache_load_verified(&root.cache(), &cx(&key)).expect("loads back");
            assert_eq!(cached.entries.len(), 1);
        }

        #[test]
        fn a_url_off_the_compiled_list_is_refused_without_a_request() {
            let root = TempRoot::new("refresh-offlist");
            let key = key_of(&ed25519_compact::KeyPair::generate());
            let http = Scripted::refusing();
            let refused = refresh_from(
                &http,
                &root.cache(),
                &cx(&key),
                "https://somewhere.else.test/manifest.json",
                ENDPOINTS,
            );
            assert!(matches!(refused, Err(CaseFetchError::OffAllowlist(_))), "{refused:?}");
            assert!(http.asked().is_empty(), "it asked anyway");
        }

        #[test]
        fn an_empty_endpoint_list_has_nowhere_to_ask() {
            let root = TempRoot::new("refresh-noendpoint");
            let key = key_of(&ed25519_compact::KeyPair::generate());
            let http = Scripted::refusing();
            assert_eq!(
                refresh_with(&http, &root.cache(), &cx(&key), &[]),
                Err(CaseFetchError::NoEndpoint)
            );
            assert!(http.asked().is_empty());
        }

        #[test]
        fn the_kill_switch_refuses_before_any_request_is_made() {
            let root = TempRoot::new("refresh-killswitch");
            std::fs::create_dir_all(root.cache()).unwrap();
            std::fs::write(root.cache().join(CASE_FETCH_DISABLE_FILE), b"").unwrap();
            let key = key_of(&ed25519_compact::KeyPair::generate());
            let http = Scripted::refusing();
            assert_eq!(
                refresh_with(&http, &root.cache(), &cx(&key), ENDPOINTS),
                Err(CaseFetchError::KillSwitch)
            );
            assert!(http.asked().is_empty(), "a switched-off PC must not be observable by its traffic");
        }

        #[test]
        fn the_kill_switch_survives_a_prune() {
            // The pruner deletes everything in the namespace that is not the cache file. If it swept
            // the switch away, "off" would quietly become "on" at the next tidy-up.
            let root = TempRoot::new("killswitch-prune");
            std::fs::create_dir_all(root.cache()).unwrap();
            let switch = root.cache().join(CASE_FETCH_DISABLE_FILE);
            std::fs::write(&switch, b"").unwrap();
            std::fs::write(root.cache().join("debris.tmp"), b"x").unwrap();
            assert_eq!(cache_prune(&root.cache()), Ok(1));
            assert!(switch.exists(), "the pruner deleted the kill switch");
            assert!(case_fetch_disabled(&root.cache()));
        }

        #[test]
        fn a_manifest_that_does_not_verify_never_causes_the_body_to_be_asked_for() {
            // The point of verifying the small document first: a forged manifest must not get to
            // choose what is downloaded next.
            let root = TempRoot::new("refresh-badsig");
            let kp = ed25519_compact::KeyPair::generate();
            let (manifest, _) = signed_pair(&kp);
            let stranger = key_of(&ed25519_compact::KeyPair::generate());
            let http = Scripted::new(vec![body_of(&manifest)]);

            let refused = refresh_with(&http, &root.cache(), &cx(&stranger), ENDPOINTS);
            assert!(matches!(refused, Err(CaseFetchError::Trust(_))), "{refused:?}");
            assert_eq!(http.asked(), vec![MANIFEST_URL.to_string()], "it fetched the body anyway");
        }

        #[test]
        fn an_older_catalog_than_the_one_on_disk_is_refused_as_a_rollback() {
            let root = TempRoot::new("refresh-rollback");
            let kp = ed25519_compact::KeyPair::generate();
            let key = key_of(&kp);
            // Land version 7 first.
            let (manifest, catalog) = signed_pair(&kp);
            refresh_with(
                &Scripted::new(vec![body_of(&manifest), body_of(&catalog)]),
                &root.cache(),
                &cx(&key),
                ENDPOINTS,
            )
            .expect("the first refresh must land");

            // Now offer a perfectly signed version 3.
            let older_catalog = catalog_bytes();
            let mut older = base_manifest_value(&older_catalog);
            older["catalog_version"] = json!(3u64);
            let older = sign(&kp, older);
            let http = Scripted::new(vec![body_of(&older), body_of(&older_catalog)]);
            let refused = refresh_with(&http, &root.cache(), &cx(&key), ENDPOINTS);
            assert_eq!(
                refused,
                Err(CaseFetchError::Trust(CaseTrustError::CatalogVersionRollback {
                    latest: 7,
                    attempted: 3
                }))
            );
        }

        #[test]
        fn a_failed_refresh_leaves_the_last_known_good_copy_and_local_analysis_alone() {
            // The offline case, which is most of the time. A refresh that cannot happen must cost
            // the user nothing they already had.
            let root = TempRoot::new("refresh-offline");
            let kp = ed25519_compact::KeyPair::generate();
            let key = key_of(&kp);
            let (manifest, catalog) = signed_pair(&kp);
            refresh_with(
                &Scripted::new(vec![body_of(&manifest), body_of(&catalog)]),
                &root.cache(),
                &cx(&key),
                ENDPOINTS,
            )
            .expect("the first refresh must land");

            let dead = Scripted::new(vec![Err(CaseFetchError::Transport("offline".into()))]);
            assert!(refresh_with(&dead, &root.cache(), &cx(&key), ENDPOINTS).is_err());

            // Still there, still verifying, still able to answer a crash.
            let outcome = advise_in(
                &root.cache(),
                &cx(&key),
                &CaseIncidentFacts {
                    kind: CaseIncidentKind::GpuTimeout,
                    faulting_app: None,
                    faulting_module: Some("amdkmdag.sys".into()),
                    error_code: None,
                    has_vitals: true,
                },
                &CaseLocalFacts {
                    gpu_vendor: Some("AMD".into()),
                    gpu_driver_version: Some("26.1.1".into()),
                    windows_build: Some(26100),
                },
            );
            assert_eq!(outcome.level(), CaseMatchLevel::MatchedKnownIssue);
        }

        // ── Darkness ───────────────────────────────────────────────────────

        #[test]
        fn the_compiled_endpoint_list_is_empty_and_would_be_https_only() {
            // Empty today, so the second assertion is a pin rather than a check: the day the owner
            // adds an endpoint, a plain-http one fails here.
            assert!(CASE_CATALOG_ENDPOINTS.is_empty(), "an endpoint shipped without arming review");
            for endpoint in CASE_CATALOG_ENDPOINTS {
                assert!(endpoint.starts_with("https://"), "{endpoint} is not https");
            }
        }

        #[test]
        fn the_shipped_refresh_refuses_before_it_reads_a_directory_or_builds_a_client() {
            assert!(!case_intelligence_gate());
            assert_eq!(refresh_case_catalog(), Err(CaseFetchError::Gated));
        }
    }

    // ─── Plan task 7: this machine's own facts ─────────────────────────────
    //
    // The half of the match Compy supplies. Every one of these tests is about the same rule: an
    // unreadable fact stays absent, because `matcher::an_absent_local_fact_never_satisfies_a_matcher`
    // only protects the user if nothing upstream quietly invents a value first.
    mod local_facts {
        use super::*;
        use crate::hardware::{GpuInfo, HardwareInfo, WindowsVersionInfo};

        fn gpu(name: &str, driver: &str) -> GpuInfo {
            GpuInfo { name: name.into(), driver_version: driver.into(), ..GpuInfo::default() }
        }

        fn win(build: &str) -> WindowsVersionInfo {
            WindowsVersionInfo { build: build.into(), ..WindowsVersionInfo::default() }
        }

        #[test]
        fn reads_vendor_driver_and_build_from_the_hardware_snapshot() {
            let hw = HardwareInfo {
                gpus: vec![gpu("AMD Radeon RX 9070 XT", "26.1.1")],
                windows_version: Some(win("26100")),
                ..HardwareInfo::default()
            };
            assert_eq!(
                local_facts_from(&hw),
                CaseLocalFacts {
                    gpu_vendor: Some("amd".into()),
                    gpu_driver_version: Some("26.1.1".into()),
                    windows_build: Some(26100),
                }
            );
        }

        #[test]
        fn the_vendor_is_folded_to_the_catalogs_own_closed_token_set() {
            // Whatever the adapter calls itself, the fact handed to the matcher is one of the three
            // tokens a catalog is allowed to name — so a matcher can never be written against a
            // marketing string that varies by driver release.
            for (name, expect) in [
                ("AMD Radeon RX 9070 XT", "amd"),
                ("NVIDIA GeForce RTX 3060 Ti", "nvidia"),
                ("Intel(R) UHD Graphics 770", "intel"),
            ] {
                let hw = HardwareInfo { gpus: vec![gpu(name, "1.0")], ..HardwareInfo::default() };
                assert_eq!(local_facts_from(&hw).gpu_vendor.as_deref(), Some(expect), "{name}");
                assert!(CASE_GPU_VENDORS.contains(&expect));
            }
        }

        #[test]
        fn an_unrecognised_adapter_yields_no_vendor_rather_than_a_guess() {
            let hw = HardwareInfo {
                gpus: vec![gpu("Microsoft Basic Display Adapter", "10.0.26100.1")],
                ..HardwareInfo::default()
            };
            assert_eq!(local_facts_from(&hw).gpu_vendor, None);
        }

        #[test]
        fn an_empty_or_blank_driver_string_is_absent_not_an_empty_version() {
            // "" would sail past `is_some()` and satisfy a `gpu_driver_version` evidence requirement
            // while telling the user nothing — a full match built on a blank.
            for driver in ["", "   "] {
                let hw = HardwareInfo {
                    gpus: vec![gpu("AMD Radeon RX 9070 XT", driver)],
                    ..HardwareInfo::default()
                };
                assert_eq!(local_facts_from(&hw).gpu_driver_version, None, "{driver:?}");
            }
        }

        #[test]
        fn an_unreadable_windows_build_is_absent() {
            for build in ["", "26100.1742", "not a number"] {
                let hw = HardwareInfo {
                    windows_version: Some(win(build)),
                    ..HardwareInfo::default()
                };
                assert_eq!(local_facts_from(&hw).windows_build, None, "{build:?}");
            }
        }

        #[test]
        fn a_machine_with_nothing_readable_yields_nothing_and_never_panics() {
            assert_eq!(local_facts_from(&HardwareInfo::default()), CaseLocalFacts::default());
        }

    }
}
