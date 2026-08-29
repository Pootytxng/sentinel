# Q9b — Tier 3 case-evidence upload: the capability-specific implementation contract

> **Status:** contract/spec only — Stage 0 of the rollout in §11. **No uploader exists and none may
> be written until this contract is reviewed and accepted.** Runtime is unchanged by this document.
> **Date:** 2026-08-29 · **Owner:** Kuya · **Work Control:** issue
> [#247](https://github.com/Pootytxng/sentinel/issues/247)
> **Authority:** `docs/decisions/2026-08-09-capability-exception-gate.md` (Tier 3 defined) ·
> `docs/decisions/2026-08-18-outbound-capability-expansion.md` §3/§3b (Tier 3 approved to build;
> destination decided) · owner retention ruling 2026-08-29 (recorded in §9 below) ·
> `docs/superpowers/specs/2026-08-09-compy-care-capability-exception-gate.md` §8 (tier posture).
> **Reference implementation for the receiver posture:** `functions/api/usage.ts` (Q9a, #217) — a
> proven pattern, NOT a shared endpoint. Tier 3 reuses the posture and nothing else.

## 0. One-sentence contract

A user may send **one case** — a written comment, one crash/incident's allowlisted evidence, or
both — to Compy support, after seeing the exact payload, with a per-submission consent that expires
with the submission; the server keeps it at most 30 days, hands back a ticket ID plus a
deletion-only secret, and hard-deletes on either the deadline or an authenticated request.

Everything below is the exact security, privacy, consent, retention, deletion, rollout and guard
contract the Capability Exception Gate requires before an uploader is code.

---

## 1. User journeys — two entries, never blurred

### A. "Send feedback"

- The user writes a comment. That comment is the payload.
- **No crash or incident evidence is attached unless the user explicitly adds it** from the same
  preview screen — and adding it converts the submission into journey B's combined form, with the
  evidence fields individually visible and removable.

### B. "Send this incident to Compy support"

- Entered from ONE specific crash/incident (the Crash & Freeze Rescue station's selected incident).
- Payload is that incident's allowlisted evidence (§2 group B), plus an optional user comment,
  plus optional support context (§2 group C) the user can strip.
- Only the evidence shown in the preview is sent. There is no "and related data" tail.

### Rules common to both

- The preview screen states, in one line, **which of the three shapes** is being sent: *comment
  only* · *incident evidence only* · *comment + incident evidence*.
- **No background sending. No surprise attachment. No blanket "send diagnostics" action** whose
  payload cannot be inspected field-by-field before the send.
- One submission = one case = one consent (§3). Sending a second case starts from zero.

## 2. Exact field allowlist

**Default rule: a field not listed here cannot leave the machine.** The Rust payload struct is the
allowlist — it has exactly these fields, serde refuses unknown fields on round-trip, and the
serializer is the only path to bytes. The server re-validates the same list and refuses anything
else (§5). Enforcement is structural, not procedural.

Explicitly **excluded**, forever under this contract (a change needs a new exception record):

- the Support Evidence bundle (`support_evidence.rs` stays local-only and network-free — its
  existing guard `src/support-evidence-outbound-guard.test.ts` continues to enforce that);
- Tier 2's analytics payload (separate consent, separate schema, separate endpoint);
- raw crash dumps and raw memory in any form;
- arbitrary/raw Event Viewer text. **Schema v1 carries NO free-form event text at all.** The
  normalized incident fields below already carry the diagnostic shape (kind, app family, module
  family, public code); a bounded event-message excerpt was considered and rejected for v1 because
  its redaction cannot be proven as tightly as token fields can. If support experience later proves
  an excerpt is genuinely needed, it enters as a schema v2 field with its own stated redaction and
  size contract and its own review — not as a quiet widening.

Legend: **Remove** = the user can delete this field on the preview before sending.

### Group A — user-authored

| Field | Source | Why needed | Req? | Remove | Redaction / bounds | Free text? |
|---|---|---|---|---|---|---|
| `user_comment` | typed by the user | the actual feedback; in journey A it is the whole point | journey A: required · journey B: optional | yes (journey B) | client-side redaction identical in class to Support Evidence's (`<user>` `<host>` `<path>` `<ip>` `<key>` `<serial>` masks); max 2,000 bytes UTF-8; control characters stripped | **yes — the ONLY free-text field in the schema** |

The comment may contain a path/username **typed by the user**; the redactor masks recognizable
shapes, and the preview shows the post-redaction text so the user sees exactly what survives.
Honesty rule: redaction of free text is best-effort and the consent copy must say so.

### Group B — incident evidence (journey B only)

All from the already-normalized `Incident` (`blackbox.rs`) — never re-read raw from Windows at
send time. Every field is a closed vocabulary or a scrubbed token; none may contain a path,
hostname, username, serial, or raw Windows record.

| Field | Source | Why needed | Req? | Remove | Redaction / bounds |
|---|---|---|---|---|---|
| `incident_kind` | `Incident` kind | what class of failure this is | required | no (it defines the case) | closed vocabulary (app crash / hang / GPU timeout / BSOD-WHEA / unexpected restart) |
| `occurred_at` | `Incident` time | lets support order events; distinguishes stale from fresh | required | no | RFC3339, truncated to the minute (second precision adds identity, not diagnosis) |
| `app_family` | `Incident` app executable | which program failed | required | yes | basename only, token-scrubbed (Tier 2 `sanitize_token` class: lowercase, no separators/drive/`@`/control chars, ≤64) |
| `module_family` | `Incident` faulting module | narrows the differential | optional | yes | same token scrub, ≤64 |
| `error_code` | `Incident` public error/bugcheck code | the one Windows fact worth having | optional | yes | `0x`-hex or short public code token, ≤32, pattern-pinned |

### Group C — optional support context

Only what changes support's answer. Each individually removable; all closed-vocab or scrubbed.

| Field | Source | Why needed | Req? | Remove | Redaction / bounds |
|---|---|---|---|---|---|
| `gpu_vendor` / `gpu_model` / `cpu_family` / `ram_gb_bucket` | the Tier 2 `hw_class` producers in `receipts.rs` (same functions, re-used read-only) | "does this reproduce on hardware like mine" | optional | yes (as one block) | Tier 2's exact closed vocabularies and token scrub — nothing new to review |
| `windows_build` | existing local probe | OS-specific known issues | optional | yes | numeric build token ≤16 chars |
| `gpu_driver_version` | existing local probe | driver-specific known issues | optional | yes | dotted-numeric token ≤32 chars |
| `compy_version` | build constant | which app produced this payload | required | no | compiled-in semver string |
| `schema_version` | constant | receiver refuses versions it does not understand | required | no | integer, = 1 |

### Group D — server-generated (never sent by the client)

| Field | Why |
|---|---|
| `ticket_id` | opaque case identity (§6) |
| `deletion_verifier` | hash of the deletion secret (§6); the raw secret is never stored |
| `received_at` | retention anchor |
| `expires_at` | `received_at + 30 days`, explicit column (§9) |

A client that sends any group-D field is refused (unknown-field rejection, §5).

## 3. Preview and consent

- **The preview is the payload.** The screen renders the final serialized JSON — the bytes that
  will be transmitted — not a friendly summary that could diverge. (Pretty-printing the same JSON
  is allowed; a *different* structure is not, and a guard pins preview-source == send-source: both
  must come from the one serializer call in `case_evidence_upload.rs`.)
- Every optional field carries a visible remove control; removing it re-renders the payload.
- **Consent is for ONE submission.** It is consumed by the send (success or failure). There is no
  global Tier 3 switch that makes future sends silent, and no consent inherited from Tier 1,
  Receipts/Tier 2, Support Evidence, the updater, or any previous Tier 3 case.
- The consent copy names the recipient — *"Compy's own store on compy.gg"* (B_land decision) — the
  30-day retention deadline, the deletion secret's meaning, and the free-text-redaction honesty
  rule from §2A.
- **No background queue. No silent or scheduled retries.** A failed send returns to the preview
  with the failure stated; sending again is a new explicit user action (same consent screen). No
  state may exist that sends without a click.

## 4. Module and transport separation

- Tier 3 lives in **`src-tauri/src/case_evidence_upload.rs`** — its own module, gate, schema
  version, payload types, and tests.
- It must NOT live in, or import evidence from: `support_evidence.rs` (local-only, network-free),
  `receipts.rs` (Tier 2), `case_intelligence.rs` (Tier 1), `remote_rules.rs` (privileged trust
  domain), or any frontend/webview networking (no `fetch`, no CSP widening — a webview transport
  would trigger issue #64 Q2b; Rust-side transport does not).
- Its gate `case_evidence_gate()` is **hard-false** — a compiled constant, not a setting — until
  the separate owner arming decision (Stage 9). The send command refuses at the gate before it
  refuses for any other reason, mirroring `send_decision`'s refusal order in `receipts.rs`.
- Transport reuses **the crate's one existing `reqwest`** exactly as declared (no TLS feature of
  its own — the declared-features invariant in `src/support-evidence-outbound-guard.test.ts` stays
  intact). No second HTTP/TLS stack may be added for this.
- Storage: Tier 3 writes to its **own D1 table** in the already-decided shared database
  `compy_reports`. **Storage sharing implies no consent, schema, or transport sharing** — its
  endpoint, table, schema version and consent are all its own.

## 5. Receiver contract

New Pages Function(s), same-origin on the site, patterned on `functions/api/usage.ts` but a
**separate endpoint** — Q9a's `/api/usage` is not reused.

- **Submit:** `POST /api/case` (`functions/api/case/index.ts`). GET answers 405 with `Allow: POST`.
- **Delete:** `POST /api/case/delete` (`functions/api/case/delete.ts`) — §7.
- Content type: `application/json` only (415 otherwise). Max request size: **16 KiB** declared AND
  actual (413) — an order of magnitude above the largest legal payload, far below abuse size.
- `schema_version` must equal the one supported version; anything else is refused (400), never
  guessed at.
- **Strict unknown-field behavior:** the validator rebuilds the payload from named fields only;
  any unknown key, wrong type, out-of-vocabulary value, or over-length string → 400 with no reason
  detail (no probing oracle; the app's own preview is where a user inspects the payload).
- **Secondary server-side redaction/refusal:** the server re-runs the token/vocabulary/length
  checks and REFUSES rather than stores on violation. A client-side scrub is treated as a claim,
  not a fact. Free text (`user_comment`) is additionally re-passed through the same mask patterns
  server-side; a comment the server cannot bound is refused.
- **Rate/abuse controls:** per-`ip_hash` hourly submission cap via a self-pruning `case_rate` table
  (the `usage_rate` pattern: peppered SHA-256 of the connecting IP, rows deleted after 1 hour,
  in-transaction correlated-count guard). Over-limit is reported as success to the client — no
  limit oracle.
- **IP/network metadata:** the raw IP is never stored. The peppered hash lives ONLY in `case_rate`
  and self-deletes within the hour. **No network identifier is written on the case row** — a
  support case is user-initiated and carries a ticket, so it needs no IP for its function.
- **Table schema** (`case_evidence`, migration lands Stage 3, applied to production only at
  Stage 7):

  ```sql
  CREATE TABLE case_evidence (
    ticket_id         TEXT PRIMARY KEY,   -- §6, server-generated
    deletion_verifier TEXT NOT NULL,      -- SHA-256(pepper + deletion_secret); raw secret never stored
    received_at       TEXT NOT NULL,      -- datetime('now')
    expires_at        TEXT NOT NULL,      -- datetime('now', '+30 days')  (§9)
    schema_version    INTEGER NOT NULL,
    kind              TEXT NOT NULL,      -- 'comment' | 'incident' | 'both'
    payload_json      TEXT NOT NULL      -- the validated, rebuilt payload; never the raw body
  );
  CREATE TABLE case_rate (ip_hash TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE case_tombstones (ticket_id TEXT PRIMARY KEY, deleted_at TEXT NOT NULL); -- §7
  ```

- **Transaction behavior:** one D1 `batch` per submit, in order: ① prune `case_rate` past the
  window; ② prune `case_evidence` past `expires_at` (§9 — retention rides the write path);
  ③ prune `case_tombstones` older than the provider's maximum recovery window (§7 — the tombstone
  table is self-cleaning by the same mechanism, so it can never become a long-lived ledger);
  ④ insert the case guarded by the correlated rate count; ⑤ record the rate attempt. The delete
  endpoint's own batch runs the same three prunes. All-or-nothing.
- **Errors to the client are generic:** `{ok:false}` + status. No internals, no field names, no
  stack, nothing PII-bearing thrown or logged.
- **Ticket identity is server-generated** (§6) and returned only in the success response, together
  with the deletion secret and the exact `expires_at`.
- The server distrusts the client, full stop: nothing in a request can extend retention, choose a
  ticket, choose an expiry, or store an unvalidated byte.

## 6. Ticket and deletion authorization — two separate powers

| | `ticket_id` | `deletion_secret` |
|---|---|---|
| What it is | opaque random support identifier | high-entropy bearer credential for deletion of exactly this case |
| Randomness | ≥128 bits (server CSPRNG) | ≥256 bits (server CSPRNG) |
| Shown to | user, support, anywhere — safe to display | the submitting client ONLY, once, in the success response |
| Stored server-side | yes (primary key) | **never raw** — only `SHA-256(pepper + secret)` as `deletion_verifier` |
| Grants | identifying/discussing the case | deleting exactly this one case |
| Does NOT grant | deletion, reading, modification | reading or modifying anything; touching any other case; any account or cross-case identity |

- Verification is hash-and-compare in constant time. A presented secret authorizes one operation:
  delete this row.
- **Secret loss is honest:** support cannot authenticate an anonymous "please delete" request it
  cannot prove. The truthful answer, written into the consent and receipt copy, is: without the
  secret, the case cannot be selectively deleted on request — and it hard-expires within 30 days
  regardless (§9). Support may always delete proactively from its own side; what it may never do is
  pretend a caller proved ownership.
- **The delete endpoint must not become a ticket-enumeration oracle:** failed attempts are
  rate-limited per `ip_hash` (same self-pruning pattern), and an unknown ticket vs. a wrong secret
  return the same generic refusal.

## 7. Deletion behavior

A valid deletion request (`POST /api/case/delete` with `ticket_id` + `deletion_secret`):

1. authenticates the pair (constant-time verifier compare);
2. hard-deletes the `case_evidence` row — evidence and verifier together;
3. thereby invalidates the deletion credential (nothing remains to verify against);
4. inserts a **tombstone** — `ticket_id` + `deleted_at` and NOTHING else (no evidence, no payload,
   no hash of the payload);
5. returns a deletion receipt: ticket ID · deleted-at time · active-store deletion status ·
   the truthful infrastructure caveat below.

**Truthful caveat (must appear in the receipt and the disclosure copy):** deletion removes the
case from Compy's active support store immediately. Cloud-provider disaster-recovery history —
Cloudflare D1's Time Travel/backup window — is a separate infrastructure property and does not
vanish at the same instant; it is not readable by ordinary support access and ages out on the
provider's schedule. We do not promise instantaneous physical erasure from provider recovery
systems, because that promise would be false.

**Operational restore rule (binding):** a D1 Time Travel/backup restore is NEVER authorization to
resurrect intentionally deleted Tier 3 evidence into normal support access. Before a restored
database becomes normally accessible, the operator MUST reconcile it: delete every `case_evidence`
row whose `ticket_id` appears in `case_tombstones`, and every row past `expires_at`. The tombstone
table is exactly what makes this possible without keeping any copy of the evidence — it records
that a deletion was honored, never what was deleted. Tombstones are pruned once older than the
provider's maximum recovery window (30 days for D1 Time Travel) — mechanically, by the same
self-cleaning write path that prunes expired evidence (§5 batch step ③, on every submit AND every
delete), so they cannot become a long-lived ledger either. This rule lands in the spec now and
must be restated in the runbook that accompanies Stage 7 deployment.

## 8. Local send receipt

After a successful upload, Compy keeps ONE minimal local receipt per sent case (in the Compy data
dir, alongside — not inside — other local stores):

- ticket ID · which local case/incident it refers to (local incident id) · sent-at · destination ·
  the server-stated `expires_at` (active retention deadline) · deletion secret · deletion status
  (available / used / expired).

The local receipt **may** retain the deletion secret: possession permits only deletion, never
evidence disclosure, so keeping it is strictly deletion-empowering for the user. The receipt does
NOT retain another copy of the uploaded evidence (the payload is not stored twice locally merely
for the receipt), and it mints no cross-case identity — receipts share no linking key, and nothing
about a receipt is ever transmitted except by the user explicitly invoking the deletion flow.

## 9. 30-day server retention (owner ruling, 2026-08-29)

Mechanical invariant: **`expires_at = received_at + 30 days`**, written as an explicit column at
insert (§5 schema) — never computed at read time from a policy document.

- Expired records are unavailable to ordinary support lookup: every support read path filters
  `expires_at > datetime('now')`, AND the write path physically prunes expired rows (§5 step ②) —
  the same self-cleaning-table mechanism Q9a's `usage_rate` already proves in production. Retention
  is a property of the code path, not a promise somebody has to remember; there is no manual
  cleanup to forget.
- The cleanup is testable: the receiver test suite inserts an expired row and proves the next
  submit's batch removes it, and proves the read filter hides it even before a prune runs
  (positive + negative controls, §12).
- **Nothing extends `expires_at`.** Not a read, not an open support conversation, not anything a
  client sends. If support genuinely needs evidence after expiry, the user explicitly sends a new
  case — that is the designed behavior, not a failure mode.
- **No archives:** no indefinite or manual archive copies of Tier 3 evidence, no export into R2 or
  any long-lived backup merely to preserve it. Provider disaster-recovery history (§7 caveat) is
  the only longer-lived trace, it is not application retention, and the user-facing wording says
  so honestly.
- Before Stage 7 deployment (and again before Stage 9 arming), **re-verify the then-current D1
  recovery-retention behavior** (Time Travel window and backup semantics) and update the §7 caveat
  wording to the exact provider limitation. The number written into privacy copy must be checked
  against the provider on the day it ships, not on the day this spec was written.

## 10. Privacy / disclosure contract

Every live surface that must change BEFORE Tier 3 is armed (Stage 9) — inventoried now so none can
be forgotten then:

1. `docs/PRIVACY.md` — new Tier 3 section: user-initiated per-case sending · exact evidence
   classes (§2 groups) · exact destination · 30-day active retention max · immediate active-store
   deletion on authenticated request · the deletion mechanism · no background queue · no inherited
   consent · the provider disaster-recovery limitation, stated accurately.
2. `docs/EULA.md` (§10 pattern from Q9a) and any other legal copy naming data practices.
3. Generated/site privacy copy (`site/privacy.html` and whatever generates it).
4. In-app consent + preview copy (the §3 screen) — same release as arming, not later.
5. Capability-policy mirrors pinned by `src/capability-exception-policy-guard.test.ts`
   (CLAUDE.md tier line, `docs/ARCHITECTURE_LOCKS.md` §1.8, `docs/RECEIPTS_DOCTRINE.md`,
   `docs/PRODUCT_DIRECTION.md`, `docs/RELEASE_STATE.md`, `docs/BACKLOG.md`).
6. Outbound guards: `src/outbound-claim-guard.test.ts` (a new live outbound surface changes which
   absolute claims are false) and the tier-separation guards in §12.
7. `docs/RELEASE_STATE.md` — the gate row flips in the same commit the runtime capability changes,
   per standing law.
8. `docs/OWNER_ACTION_CHECKLIST.md` §C — the arming row, so arming can never happen quietly.

**While Tier 3 remains dark/not implemented, current privacy statements stay truthful as written.**
`docs/PRIVACY.md` v0.6 does not claim crash-report transmission exists, and it must not be
prematurely rewritten to imply it does. The disclosure lands ahead of ARMING (the Q9a precedent:
describe before it can ever run), not ahead of the code existing. This is product/privacy
engineering, not legal advice; no legal-compliance claim is made or implied until independently
reviewed (the owner's standing legal-review caveat in PRIVACY.md applies).

## 11. Rollout — separate proof boundaries, none inheriting the next

| Stage | Scope | Proof boundary |
|---|---|---|
| 0 | **This contract** reviewed and accepted | independent read-only review (below) + owner acceptance |
| 1 | Pure payload/redaction/schema code only (`case_evidence_upload.rs` types, serializer, redactor; no transport, no commands) | unit tests incl. §12 guards for allowlist + redaction |
| 2 | Local preview/edit/consent UI (fixture-rig reachable; unreachable in shipped builds) | self-review law + fixture parity guard |
| 3 | Receiver + migration, local/staged ONLY — **not public, not deployed** | `case-endpoint` tests green incl. retention/deletion controls |
| 4 | Dark Rust send path behind hard-false `case_evidence_gate()` | gate-refusal-first test; tier-separation guards green |
| 5 | Deletion endpoint + local deletion-receipt behavior | §6/§7 tests incl. oracle/rate-limit controls |
| 6 | Adversarial security/privacy review of the exact implementation | written verdict bound to the exact head |
| 7 | **Owner-authorized** infrastructure deployment + staged proof (`wrangler pages deploy`, migration applied, runbook incl. §7 restore rule) | owner GO recorded; endpoint answers; store empty |
| 8 | Exact candidate build + installed proof **with Tier 3 still dark** | installed-build stamp + refusal proof |
| 9 | **Separate owner arming decision, in a later release** | §10 disclosure inventory shipped in the same release; owner sign-off |

No stage inherits authority to cross the next boundary. **Deployment (7) and arming (9) are never
combined; implementation (1–5) and arming are never combined.** A green stage authorizes exactly
nothing beyond itself.

## 12. Required guards — the red test that must land before each behavior counts

Bug→guard law applied in advance: each implementation slice names its guard here, and the guard
lands red-first with positive AND negative controls so an empty corpus can never fake a green.

| Invariant | Guard (new unless marked) |
|---|---|
| Exact Tier 3 field allowlist — payload serializes these fields and no others | Rust unit tests in `case_evidence_upload.rs`: exhaustive-struct serialization pin + a compile-time-shaped test that a new field fails until added here and in the spec |
| Unknown-field rejection (client structs) | serde `deny_unknown_fields` round-trip tests, positive control: a payload with an extra key fails to parse |
| Client-side redaction | Rust adversarial tests (the `receipts.rs` pattern): path/username/hostname/serial/IP shapes cannot survive any string field; negative control: clean tokens pass |
| Server-side rejection re-validates everything | `scripts/case-endpoint.test.mjs` (the `usage-endpoint.test.mjs` pattern): every vocabulary/token/length rule, unknown fields 400, oversize 413, wrong content type 415, wrong schema version 400; vocab sets pinned against the Rust producers |
| Support Evidence stays network-free | existing `src/support-evidence-outbound-guard.test.ts` — untouched, still green; plus its tier-reachability block extended to name `case_evidence_upload.rs` |
| Tier 1/2/3 consent separation | `src/case-evidence-tier-separation-guard.test.ts`: `case_evidence_upload.rs` imports none of `support_evidence`/`receipts`/`case_intelligence`/`remote_rules`; no consent value crosses modules; positive controls prove the detectors fire |
| Tier 3 stays dark until explicit arming | gate pin: `case_evidence_gate()` is hard-false in source; send command's FIRST refusal is the gate (order-pinned like `send_decision`) |
| No background queue / no automatic retry | same separation guard: no timer/spawn/queue/persisted-unsent-payload construct in the module; failed-send state machine test proves re-send requires a fresh consent |
| No raw dumps | allowlist structure (no field can carry one) + endpoint size caps + a copy guard that consent copy never offers a dump |
| No frontend networking | existing `src/q2b-deferral-tripwire.test.ts` + outbound guard's frontend scan — must stay green with the new module present |
| Deletion secret cannot disclose a case | endpoint test: the delete route returns no payload data on any input, valid credentials included |
| Ticket ID alone cannot delete | endpoint test: delete with valid ticket + wrong/absent secret refuses; refusal identical for unknown ticket (no oracle); failed attempts rate-limited |
| Active evidence expires by 30 days | endpoint tests: inserted `expires_at` = received + 30d exactly; expired row invisible to lookup; next write's batch prunes it (both directions controlled) |
| Tombstones cannot become a long-lived ledger | endpoint test: a tombstone older than the recovery window is pruned by the next submit's and the next delete's batch; a younger one survives (both controlled) |
| Authenticated deletion removes active evidence immediately | endpoint test: row + verifier gone in the same transaction; tombstone written with no evidence columns |
| Privacy text never claims Tier 3 is live while dark | `src/capability-exception-policy-guard.test.ts` corpus already pins PRIVACY.md's current-runtime language; extend its REQUIRED pins when the Tier 3 disclosure lands (Stage 9), with the retired-claim positive-control pattern |
| Positive/negative controls throughout | every guard above includes at least one seeded-defect control, per the existing house pattern (`catches the shapes it was written for`) |

## 13. Explicitly out of scope for this contract mission

No Tier 3 production code · no Cloudflare deploys · no production D1 mutation or table creation ·
no arming of Tier 1, 2, or 3 · no security/system settings changes · no Health #225 · not #237,
#240, #243 · no Project Doctor · no branch cleanup · no Mission 3 visual work · nothing published
or released · Support Evidence is not altered into an uploader · no raw crash-dump upload · no
retention longer than 30 days may be invented anywhere downstream of this document.
