# Compy Care — tier module contracts

**Engineering reference. Not product authority.** Product law for Care lives in
`product/CARE_ENGINE.md` (derived from `PRODUCT_CONSTITUTION.md`); the outbound tiers and the
Capability Exception Gate live in `ARCHITECTURE_LOCKS.md`. This file records the *implementation
contract* of the three Care modules — what each one may and may not do, and which guard proves it —
so the Rust module map in `../src-tauri/CLAUDE.md` can stay a map.

**Why the split.** The map's job is one line per module: what is this, and is it a mutation
boundary. These three entries had grown into 4,650 bytes — 47% of a file with a 10 KB byte budget —
of contract prose that a session reads on every `src-tauri/` touch whether or not it is working on
Care. The prose is load-bearing, so it moved here rather than being deleted; the map keeps a compact
line per module plus a pointer to the section below.

**Arming moves the line, not the contract.** Two of these modules are DARK. When the owner arms
either one, its map line moves to the ★ mutation/rollback/gate half in the **root** `CLAUDE.md`,
which every session loads — a live gate belongs in the always-loaded file. This document stays here
either way.

---

## 1. `case_intelligence.rs` — Compy Care **Tier 1**, DARK (#220)

The signed, pull-only **PUBLIC-ADVISORY catalog**: strict domain types plus a parser, and the pure
local matcher that compares a signed write-up against this machine's own facts.

**Trust root — its own, deliberately separate.** `verify_catalog_chain` verifies Ed25519 over a
**Tier-1-only signing context**, so a remote-rules signature cannot cross over *even on a shared
key*. Its key, schema, origins and cache are all its own, separate from the privileged remote-rules
trust domain. Case intelligence is a signed **advisory** capability and must never be conflated with
remote **mutation** rules.

**Cache.** A last-known-good cache under `%APPDATA%\Compy\case-intelligence\`, which **re-verifies
on every read** — a cached catalog is not trusted for being cached.

**Matcher.** `match_facts` / `advise` are pure and local. **An unreadable fact never satisfies a
matcher** (unavailable stays unknown, never fabricated), and **every word shown is the catalog's,
never Compy's**.

**Transport is one shape.** A bare GET for a compiled URL — no body, no query string, no cookie, no
custom header — so **no machine fact can travel even by accident**. It is DOWNLOAD-only: it uploads
no machine data, which is what makes it advisory rather than an outbound *send* path like Tier 2.

**It cannot represent a mutation.** No command, no registry path, no action id, no regex; matchers
are a closed set over a lowercase token charset.

**Gate state (DARK).** `case_intelligence_gate()` is hard-false, `CASE_CATALOG_ENDPOINTS` is EMPTY,
`CASE_CATALOG_ORIGINS` is EMPTY — so no manifest can validate — and a deny-only `fetch-disabled`
file refuses every fetch locally.

**When the owner arms it, this module's map line moves to the ★ half in the root `CLAUDE.md`.**

Guards: `src/case-intelligence-outbound-guard.test.ts`, the Tier 1 rows of
`src/support-evidence-outbound-guard.test.ts`.

---

## 2. `case_evidence_upload.rs` — Compy Care **Tier 3**, STAGE 1 ONLY, DARK (Q9b, #252/#259)

The **pure half** of explicit per-case evidence upload. Stage 1 is shape and redaction only; the
refusing send command is **Stage 4's own reviewed diff**, not this module's.

**Allowlist.** The contract §2 allowlist is a `deny_unknown_fields` struct — 14 fields, three case
shapes: comment / incident evidence / both.

**Redactor.** Its own six-class free-text redactor, a **deliberate contract §4 duplicate** of
`support_evidence`'s and **never an import** — the duplication is the tier separation. It sits
behind `flatten_input`, which drops invisible formatting and folds full-width ASCII so a detector
matches what a reader **SEES** (#259 S1).

**Documented residuals — these are known and deliberately NOT masked:** mixed-script homoglyphs and
U+2800. Each is pinned by a test that asserts it is *not* masked, so a future change that starts
masking them is a visible contract change rather than a silent one.

**Producers and serialization.** Pure producers over the normalized `Incident` and over hardware
facts via the tier-neutral `hw_class` helpers (that module imports no tier module, which is what
lets Tier 2 and Tier 3 share exact vocabularies without a tier import). **ONE canonical serializer**
that refuses a shapeless payload exactly as the preview does, and a preview serialized from the same
struct as the wire — **byte-identical modulo whitespace, key order included**.

**What is absent, on purpose.** NO command, NO HTTP, NO endpoint, NO consent state, NO queue.

**Contract §4 — never imports.** `receipts`, `support_evidence`, `case_intelligence`,
`remote_rules`. This list is absolute.

**Gate state (DARK).** `case_evidence_gate()` is hard-false and nothing calls through it.

**When the owner arms Tier 3, this module's map line moves to the ★ half in the root `CLAUDE.md`.**

Guards: `src/case-evidence-tier-separation-guard.test.ts`, `src/case-evidence-consent-guard.test.ts`,
and the Tier 3 rows of `src/support-evidence-outbound-guard.test.ts`.

---

## 3. `incident_observer.rs` — Compy Care **Tier 1**, plan task 9

The persisted **LOCAL** incident observer. Not a mutation boundary.

**Three named scan moments, and nothing between them.** It reads `blackbox::get_crash_blackbox()` on
app launch, main-window foreground, and session finalized — **no timer, service, scheduled task,
watcher or poll exists**. The two non-launch triggers are throttled by `SCAN_MIN_INTERVAL_SECS`
against a persisted watermark; a crash that happened while Compy was closed is caught by the
unthrottled `Launch` pass.

**State.** One small JSON file, `%APPDATA%\Compy\care\incident-observer.json`, written atomically. A
corrupt or unknown-schema file is quarantined and re-seeded **silently**. The first-ever pass SEEDS
and announces nothing, so installing Compy never generates notifications about pre-Compy crashes.

**Identity reconciliation.** An incident's id is a hash over its traits, and Windows keeps revising
those — a WER report merges in minutes later and moves the recorded instant. Each remembered row
therefore stores its matching traits, and `reconcile_identity_shifts` re-points it. Without that, a
dismissed card comes back under a new id.

**Notification limits.** At most one toast per scan, under a 30-minute family cooldown, saying only
**WHAT** happened and **WHEN**. The DTO carries no cause, no confidence and no advisory field —
because a notification strips the hedge, the evidence and the limits off Tier 1's prose.

**Boundaries.** Opens no network path of its own and mints no identity. It is **NOT** a mutation
boundary: `dismiss_care_incident` clears Compy's own pointer and deletes no Windows record.

Commands: `get_pending_care_incident` / `mark_care_incident_opened` / `dismiss_care_incident` — main
window only, never the overlay.

Guards: `src/care-incident-observer-contract.test.ts`, `src/surfaces/care-home-route-guard.test.ts`.
