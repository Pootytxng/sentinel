// Tier 3 (Q9b) case-evidence validation — the receiver's half of the contract.
//
// Contract: docs/superpowers/specs/2026-08-29-q9b-tier3-case-evidence-contract.md §2, §5.
// Producer:  src-tauri/src/case_evidence_upload.rs  (+ src-tauri/src/hw_class.rs).
//
// STAGE 3 IS LOCAL ONLY. This file lives under scripts/lib/ and NOT under functions/, so it is
// outside every input the site deploy watches. scripts/case-endpoint-isolation.test.mjs proves
// that mechanically rather than asserting it here. Nothing in the shipped app calls it:
// `case_evidence_gate()` is a literal `false`, and no Rust send command exists yet.
//
// WHY A SECOND WALL. The app already redacts and validates every field before it would ever be
// sent. This re-validates the SAME invariants and REFUSES rather than storing, for the reason
// functions/api/usage.ts states for Tier 2: a receiver that trusts its client is not a scrub, it
// is a hope. If a future build regresses the producer, the wall is here too.
//
// WHAT THIS WALL CANNOT DO, stated plainly rather than implied. The producer also masks values
// that identify THIS machine and THIS user — `%USERNAME%`, `%COMPUTERNAME%`, `%USERDOMAIN%`
// (`sensitive_literals`, case_evidence_upload.rs:158). The server does not know those values and
// can never re-detect them. Server-side re-detection covers the four STRUCTURAL classes only
// (path, address, key, serial). Identity-literal masking is client-side, single-wall, by
// construction — that is a limit of the design, not an oversight of this file.

/** The only payload version this receiver understands. A newer app is refused, never guessed at.
 *  Mirrors `CASE_SCHEMA_VERSION` (case_evidence_upload.rs). */
export const CASE_SCHEMA_VERSION = 1;

/** Contract §5. 16 KiB, checked against the DECLARED length and again against the actual bytes. */
export const MAX_BODY_BYTES = 16384;

/** `MAX_COMMENT_BYTES` in the producer. The producer clamps to it; the receiver refuses past it. */
export const MAX_COMMENT_BYTES = 2000;

/** `MAX_FAMILY_TOKEN_CHARS` / `MAX_ERROR_CODE_CHARS` / `MAX_WINDOWS_BUILD_CHARS` /
 *  `MAX_DRIVER_VERSION_CHARS` in the producer, in that order. */
const MAX_FAMILY_TOKEN_CHARS = 64;
const MAX_ERROR_CODE_CHARS = 32;
const MAX_WINDOWS_BUILD_CHARS = 16;
const MAX_DRIVER_VERSION_CHARS = 32;

/** The complete wire surface: `CasePayload` carries `#[serde(deny_unknown_fields)]` and exactly
 *  these fourteen. Any other key is a refusal, not a field to ignore. */
const ALLOWED_FIELDS = new Set([
  'schema_version',
  'compy_version',
  'user_comment',
  'incident_kind',
  'occurred_at',
  'app_family',
  'module_family',
  'error_code',
  'gpu_vendor',
  'gpu_model',
  'cpu_family',
  'ram_gb_bucket',
  'windows_build',
  'gpu_driver_version',
]);

/** `CaseIncidentKind`'s five serde renames. Closed set — an unknown kind is refused. */
const INCIDENT_KINDS = new Set([
  'app-crash',
  'app-hang',
  'gpu-timeout',
  'bsod-whea',
  'unexpected-restart',
]);

/** `ram_gb_bucket` in hw_class.rs. Closed set. */
const RAM_BUCKETS = new Set(['unknown', '0-8', '9-16', '17-24', '25-32', '33-64', '64+']);

/** `gpu_vendor_token` in hw_class.rs. Closed set. */
const GPU_VENDORS = new Set(['amd', 'nvidia', 'intel', 'other']);

/** The four Group C hardware fields. `assemble_case` builds every one of them from the same
 *  `Option<&HwContext>` whose members are plain `String`s (case_evidence_upload.rs:625-630,
 *  :692-695), so on the wire they are all present or all absent. Nothing in between is a payload
 *  the app can produce, so nothing in between is accepted. */
const HARDWARE_FIELDS = ['gpu_vendor', 'gpu_model', 'cpu_family', 'ram_gb_bucket'] as const;

/** The three incident details. `assemble_case` reaches them through `evidence.and_then(..)`, so
 *  each is optional EVEN WHEN evidence exists — an unexpected restart records no faulting app.
 *  What they cannot do is arrive without the evidence they were extracted from. */
const INCIDENT_DETAIL_FIELDS = ['app_family', 'module_family', 'error_code'] as const;

export type CasePayload = {
  schema_version: number;
  compy_version: string;
  user_comment?: string;
  incident_kind?: string;
  occurred_at?: string;
  app_family?: string;
  module_family?: string;
  error_code?: string;
  gpu_vendor?: string;
  gpu_model?: string;
  cpu_family?: string;
  ram_gb_bucket?: string;
  windows_build?: string;
  gpu_driver_version?: string;
};

/** Contract §1: the three shapes a case can take. Server-derived from the validated payload —
 *  never a wire field, so a client cannot mislabel its own case. */
export type CaseKind = 'comment' | 'incident' | 'both';

// ---------------------------------------------------------------------------
// Character classes — ported from the producer, not invented here
// ---------------------------------------------------------------------------

/** Unicode Cc, which is what Rust's `char::is_control` means. `flatten_input` turns \n \r \t into
 *  a space and DROPS the rest, so no honest payload carries any of these. */
function hasControlChar(value: string): boolean {
  for (const ch of value) {
    const c = ch.codePointAt(0) as number;
    if (c <= 0x1f || (c >= 0x7f && c <= 0x9f)) return true;
  }
  return false;
}

/** `is_invisible_format` (case_evidence_upload.rs) — Cf plus the non-Cf Default_Ignorable code
 *  points, written out because the producer deliberately carries no dependency on this path.
 *  Kept in the same order as the Rust so the two can be diffed by eye. */
function isInvisibleFormat(c: number): boolean {
  return (
    c === 0x00ad ||
    c === 0x034f ||
    c === 0x061c ||
    c === 0x06dd ||
    c === 0x070f ||
    c === 0x08e2 ||
    c === 0x3164 ||
    c === 0xfeff ||
    c === 0xffa0 ||
    (c >= 0x0600 && c <= 0x0605) ||
    (c >= 0x0890 && c <= 0x0891) ||
    (c >= 0x115f && c <= 0x1160) ||
    (c >= 0x17b4 && c <= 0x17b5) ||
    (c >= 0x180b && c <= 0x180f) ||
    (c >= 0x200b && c <= 0x200f) ||
    (c >= 0x202a && c <= 0x202e) ||
    (c >= 0x2060 && c <= 0x206f) ||
    (c >= 0xfe00 && c <= 0xfe0f) ||
    (c >= 0xfff0 && c <= 0xfff8) ||
    (c >= 0xfff9 && c <= 0xfffb) ||
    c === 0x110bd ||
    c === 0x110cd ||
    (c >= 0x13430 && c <= 0x1343f) ||
    (c >= 0x1bca0 && c <= 0x1bca3) ||
    (c >= 0x1d173 && c <= 0x1d17a) ||
    (c >= 0xe0000 && c <= 0xe0fff)
  );
}

function hasInvisibleFormat(value: string): boolean {
  for (const ch of value) {
    if (isInvisibleFormat(ch.codePointAt(0) as number)) return true;
  }
  return false;
}

/** `fold_full_width` — the FULLWIDTH FORMS block is a straight +0xFEE0 offset from printable
 *  ASCII, so the fold is subtraction rather than a normalization table. */
function foldFullWidth(value: string): string {
  let out = '';
  for (const ch of value) {
    const c = ch.codePointAt(0) as number;
    out += c >= 0xff01 && c <= 0xff5e ? String.fromCodePoint(c - 0xfee0) : ch;
  }
  return out;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

// ---------------------------------------------------------------------------
// The four structural detectors, ported from the producer's maskers
// ---------------------------------------------------------------------------
//
// The producer MASKS these shapes; the receiver REFUSES them. That asymmetry is the contract's
// (§5: "secondary server-side redaction/refusal"), and it is the safer half: masking server-side
// would silently rewrite a user's words, while refusing tells the app its own scrub regressed.

/** `path_root_len` (case_evidence_upload.rs:369) — `C:\`, `\\`, `%VAR%\`, `~/`, and a `/` run that
 *  holds a SECOND slash so a command switch like `/v` stays readable. */
function looksLikePath(value: string): boolean {
  const chars = Array.from(value);
  const sep = (c: string) => c === '\\' || c === '/';
  for (let i = 0; i < chars.length; i++) {
    // Only start a path at a token boundary, so `foo C:\x` matches but `abcC:\x` does not.
    if (i > 0 && /[\p{L}\p{N}]/u.test(chars[i - 1])) continue;
    if (i + 2 < chars.length && /^[A-Za-z]$/.test(chars[i]) && chars[i + 1] === ':' && sep(chars[i + 2])) return true;
    if (i + 1 < chars.length && chars[i] === '\\' && chars[i + 1] === '\\') return true;
    if (chars[i] === '%') {
      const close = chars.indexOf('%', i + 1);
      if (close !== -1 && close + 1 < chars.length && sep(chars[close + 1])) return true;
    }
    if (chars[i] === '~' && i + 1 < chars.length && chars[i + 1] === '/') return true;
    if (chars[i] === '/' && i + 1 < chars.length && !/\s/.test(chars[i + 1]) && chars[i + 1] !== '/') {
      for (let k = i + 1; k < chars.length && !/\s/.test(chars[k]); k++) {
        if (chars[k] === '/') return true;
      }
    }
  }
  return false;
}

function isIpv4(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

/** Deliberately broad, matching the producer's own note that a hit masks the WHOLE token: this
 *  errs toward hiding more, never less. Two or more colon-separated hex groups is an address
 *  shape; `12:30` (a clock time) is one colon and stays readable. */
function isIpv6(host: string): boolean {
  if (!host.includes(':')) return false;
  if (!/^[0-9A-Fa-f:.]+$/.test(host)) return false;
  return (host.match(/:/g) as string[]).length >= 2;
}

/** `looks_like_address` (case_evidence_upload.rs:445) — peel scheme, brackets, path and port,
 *  then test what is left. */
function looksLikeAddress(token: string): boolean {
  let t = token;
  const scheme = t.indexOf('://');
  if (scheme !== -1) t = t.slice(scheme + 3);
  t = t.replace(/^[[("']+/, '');
  t = t.split(/[/?]/)[0];
  const host = t.split(']')[0];
  if (isIpv4(host) || isIpv6(host)) return true;
  const colon = host.lastIndexOf(':');
  if (colon > 0) {
    const head = host.slice(0, colon);
    const port = host.slice(colon + 1);
    if (port.length > 0 && /^\d+$/.test(port) && isIpv4(head)) return true;
  }
  return false;
}

/** `mask_keys` — three or more `-` groups, twelve characters or more overall, every group at
 *  least four ASCII alphanumerics. A licence key, a GUID-ish token, an API key. */
function looksLikeKey(token: string): boolean {
  const groups = token.split('-');
  return (
    groups.length >= 3 &&
    token.length >= 12 &&
    groups.every((g) => g.length >= 4 && /^[0-9A-Za-z]+$/.test(g))
  );
}

/** `mask_serials` — sixteen or more ASCII alphanumerics carrying at least one digit and at least
 *  one letter. A hardware serial, a machine GUID with the dashes stripped. */
function looksLikeSerial(token: string): boolean {
  return (
    token.length >= 16 &&
    /^[0-9A-Za-z]+$/.test(token) &&
    /\d/.test(token) &&
    /[A-Za-z]/.test(token)
  );
}

/**
 * True when a structural identifier survived the client's scrub. Token-based checks run over
 * whitespace-delimited tokens exactly as `map_tokens` does; the path check is a character scan
 * because a path can sit mid-token.
 *
 * Runs on the FULL-WIDTH-FOLDED string: the producer folds before it detects, so a value that
 * only looks safe unfolded (`Ｃ：＼Users`) is caught here the same way it would have been there.
 */
export function carriesStructuralIdentifier(value: string): boolean {
  const folded = foldFullWidth(value);
  if (looksLikePath(folded)) return true;
  for (const token of folded.split(/\s+/)) {
    if (token.length === 0) continue;
    if (looksLikeAddress(token) || looksLikeKey(token) || looksLikeSerial(token)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Per-field validators
// ---------------------------------------------------------------------------

function optionalString(body: Record<string, unknown>, key: string): string | null | undefined {
  if (!(key in body)) return undefined;
  const raw = body[key];
  return typeof raw === 'string' ? raw : null;
}

/**
 * Every free-ish token on the wire has already been through `sanitize_token`, which lowercases
 * and trims. So: no ASCII uppercase, no leading/trailing whitespace, no control characters, no
 * invisible-format characters, and a length the producer's own cap permits.
 *
 * Two deliberate asymmetries with `user_comment`, both derived from what each producer does
 * rather than from a general rule:
 *   - Full-width characters are ALLOWED here. `flatten_input` folds them out of a comment, so a
 *     comment carrying one cannot be honest; `sanitize_token` does not fold, so a game or GPU
 *     named in full-width characters legitimately can.
 *   - Case is checked as "no A-Z" rather than `s === s.toLowerCase()`. Rust and JavaScript agree
 *     on ASCII casing and diverge on a handful of Unicode ones (İ, ẞ); pinning the ASCII half is
 *     the part that actually proves the client sanitized, without gambling on casing parity. It
 *     runs on the FOLDED string, because Rust's `to_lowercase` folds `Ａ` to `ａ` and an unfolded
 *     check would let full-width capitals through as if the client had never sanitized. The
 *     residual — a non-ASCII uppercase letter outside the full-width block — stays uncaught here
 *     and is stated rather than papered over.
 */
function isSanitizedToken(value: string, maxChars: number): boolean {
  if (value.length === 0 || Array.from(value).length > maxChars) return false;
  if (value !== value.trim()) return false;
  if (/[A-Z]/.test(foldFullWidth(value))) return false;
  if (hasControlChar(value) || hasInvisibleFormat(value)) return false;
  return !carriesStructuralIdentifier(value);
}

/** `family_token` adds refusal of `@ : \ /` on top of `sanitize_token`. Checked against the
 *  FOLDED string so a full-width `＼` counts as the separator it renders as. */
function isFamilyToken(value: string): boolean {
  if (!isSanitizedToken(value, MAX_FAMILY_TOKEN_CHARS)) return false;
  return !/[@:\\/]/.test(foldFullWidth(value));
}

/** `error_code_token` — trimmed, lowercased, `[a-z0-9_-]` only, capped. e.g. `0xc0000005`. */
function isErrorCode(value: string): boolean {
  return value.length <= MAX_ERROR_CODE_CHARS && /^[a-z0-9_-]+$/.test(value);
}

/** `dotted_numeric_token` — digits and dots only, a digit at both ends, no empty group. */
function isDottedNumeric(value: string, maxChars: number): boolean {
  if (value.length === 0 || value.length > maxChars) return false;
  return /^\d+(\.\d+)*$/.test(value);
}

/**
 * `occurred_at_minute` re-emits the timestamp with the second and nanosecond zeroed, through
 * `to_rfc3339_opts(SecondsFormat::Secs, false)` — so the offset is preserved and a `Z` input
 * comes back as `+00:00`. A bare `Z` on the wire is therefore not something the app produces.
 * The literal `00` seconds is the field's whole privacy point: a second-accurate crash time is a
 * far better correlator than a minute-accurate one.
 */
function isMinuteTimestamp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00[+-]\d{2}:\d{2}$/.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}

/** A semver-ish `CARGO_PKG_VERSION`. Bounded and charset-limited; never parsed for meaning. */
function isCompyVersion(value: string): boolean {
  return /^[0-9][0-9a-z.+-]{0,31}$/.test(value);
}

// ---------------------------------------------------------------------------
// The validator
// ---------------------------------------------------------------------------

/**
 * Returns the normalized payload, or `null` if anything at all is wrong.
 *
 * The caller turns `null` into a bare 400 with NO reason, the same way functions/api/usage.ts
 * does: a validator that explains itself teaches a probe exactly which field to vary next.
 *
 * The returned object is REBUILT from named fields. It is never the parsed body with extras
 * stripped, so a key this file does not know about cannot ride through on a spread.
 */
export function validateCase(parsed: unknown): CasePayload | null {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const body = parsed as Record<string, unknown>;

  // §5: strict unknown-field refusal, mirroring `#[serde(deny_unknown_fields)]`.
  for (const key of Object.keys(body)) {
    if (!ALLOWED_FIELDS.has(key)) return null;
  }

  if (body.schema_version !== CASE_SCHEMA_VERSION) return null;

  const compyVersion = body.compy_version;
  if (typeof compyVersion !== 'string' || !isCompyVersion(compyVersion)) return null;

  const out: CasePayload = {
    schema_version: CASE_SCHEMA_VERSION,
    compy_version: compyVersion,
  };

  const comment = optionalString(body, 'user_comment');
  if (comment === null) return null;
  if (comment !== undefined) {
    // `assemble_case` drops a comment that is empty after redaction, so an empty one on the wire
    // is not a payload the app produces.
    if (comment.length === 0 || comment !== comment.trim()) return null;
    if (byteLength(comment) > MAX_COMMENT_BYTES) return null;
    if (hasControlChar(comment) || hasInvisibleFormat(comment)) return null;
    // `flatten_input` folds the full-width block; a comment still carrying one did not come
    // through it.
    if (foldFullWidth(comment) !== comment) return null;
    if (carriesStructuralIdentifier(comment)) return null;
    out.user_comment = comment;
  }

  const kind = optionalString(body, 'incident_kind');
  if (kind === null) return null;
  if (kind !== undefined) {
    if (!INCIDENT_KINDS.has(kind)) return null;
    out.incident_kind = kind;
  }

  const occurredAt = optionalString(body, 'occurred_at');
  if (occurredAt === null) return null;
  if (occurredAt !== undefined) {
    if (!isMinuteTimestamp(occurredAt)) return null;
    out.occurred_at = occurredAt;
  }

  // Kind and time are both `evidence.map(..)`: they travel together or not at all.
  if ((out.incident_kind === undefined) !== (out.occurred_at === undefined)) return null;

  for (const field of INCIDENT_DETAIL_FIELDS) {
    const value = optionalString(body, field);
    if (value === null) return null;
    if (value === undefined) continue;
    const ok = field === 'error_code' ? isErrorCode(value) : isFamilyToken(value);
    if (!ok) return null;
    // Every one of these is extracted from the incident evidence, so none can arrive without it.
    if (out.incident_kind === undefined) return null;
    out[field] = value;
  }

  const vendor = optionalString(body, 'gpu_vendor');
  if (vendor === null) return null;
  if (vendor !== undefined) {
    if (!GPU_VENDORS.has(vendor)) return null;
    out.gpu_vendor = vendor;
  }

  for (const field of ['gpu_model', 'cpu_family'] as const) {
    const value = optionalString(body, field);
    if (value === null) return null;
    if (value === undefined) continue;
    if (!isSanitizedToken(value, MAX_FAMILY_TOKEN_CHARS)) return null;
    // `sanitize_token` takes the basename after splitting on both separators, so neither can
    // survive into these two fields.
    if (/[\\/]/.test(foldFullWidth(value))) return null;
    out[field] = value;
  }

  const ram = optionalString(body, 'ram_gb_bucket');
  if (ram === null) return null;
  if (ram !== undefined) {
    if (!RAM_BUCKETS.has(ram)) return null;
    out.ram_gb_bucket = ram;
  }

  // Group C is one block on the producer's side, so it is all four or none here.
  const hardwarePresent = HARDWARE_FIELDS.filter((f) => out[f] !== undefined).length;
  if (hardwarePresent !== 0 && hardwarePresent !== HARDWARE_FIELDS.length) return null;

  const windowsBuild = optionalString(body, 'windows_build');
  if (windowsBuild === null) return null;
  if (windowsBuild !== undefined) {
    if (!isDottedNumeric(windowsBuild, MAX_WINDOWS_BUILD_CHARS)) return null;
    out.windows_build = windowsBuild;
  }

  const driver = optionalString(body, 'gpu_driver_version');
  if (driver === null) return null;
  if (driver !== undefined) {
    if (!isDottedNumeric(driver, MAX_DRIVER_VERSION_CHARS)) return null;
    out.gpu_driver_version = driver;
  }

  // `assemble_case` refuses a shapeless case (`EmptyCase`). So does this.
  if (out.user_comment === undefined && out.incident_kind === undefined) return null;

  return out;
}

/** Contract §1, derived server-side from the validated payload. */
export function caseKind(payload: CasePayload): CaseKind {
  const hasComment = payload.user_comment !== undefined;
  const hasIncident = payload.incident_kind !== undefined;
  if (hasComment && hasIncident) return 'both';
  return hasComment ? 'comment' : 'incident';
}
