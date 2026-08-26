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
    use serde_json::{json, Value};

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
}
