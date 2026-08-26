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
    /// `catalog_version` must be a positive number.
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
            Self::BadCatalogVersion { found } => write!(f, "catalog_version {found} is not positive"),
            Self::InvertedRange { field } => write!(f, "{field} range is inverted"),
        }
    }
}

type R<T> = Result<T, CaseCatalogError>;

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

/// Parse and fully validate a manifest. Note that while `CASE_CATALOG_ORIGINS` is empty this ALWAYS
/// fails at the origin check — Tier 1 is dark and there is nowhere legitimate to download from.
pub(crate) fn parse_manifest(json: &str) -> R<CaseCatalogManifest> {
    let manifest: CaseCatalogManifest =
        serde_json::from_str(json).map_err(|e| CaseCatalogError::Malformed(e.to_string()))?;
    manifest.validate()?;
    Ok(manifest)
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
    ("reg add", "a registry write"),
    ("reg delete", "a registry write"),
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
        if self.catalog_version == 0 {
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

/// THE production entry point, and it cannot succeed in this build.
///
/// The placeholder-key guard runs before anything is read, so a shipped binary refuses a catalog
/// without parsing it — and `CASE_CATALOG_ORIGINS` being empty would refuse it a second time even if
/// a key were present. Two independent reasons, either of which alone keeps Tier 1 dark.
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
        if entry.file_name() == CASE_CACHE_FILE_NAME {
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
            evidence_refs: vec!["the faulting module was amdkmdag".into()],
            next_steps: vec![AdvisoryStep {
                headline: "Install the newest driver".into(),
                detail: "The vendor published a newer driver.".into(),
                research_only: false,
            }],
            source_url: "https://www.amd.com/kb/1".into(),
            source_updated_at: "2026-02-04T00:00:00Z".into(),
        };
        let wire = serde_json::to_string(&m).expect("serializes");
        assert!(wire.contains("matched_known_issue"));
        assert!(!wire.contains("confidence"), "a numeric confidence must never appear on the wire");
        assert!(!wire.contains("score"));
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
    }

    // ─── Last-known-good cache (plan task 4) ───────────────────────────────
    //
    // Real files in a real temp directory. A cache is a filesystem behaviour — atomicity, debris,
    // partial writes, a neighbour's data one directory up — and none of that is observable through
    // a mock, so these tests pay for a few directories and get to assert the thing that actually
    // ships.
    mod cache {
        use super::*;
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
}
