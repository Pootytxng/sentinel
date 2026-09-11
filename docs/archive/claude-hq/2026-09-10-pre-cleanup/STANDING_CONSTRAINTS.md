# STANDING CONSTRAINTS — DERIVED INDEX

Status: **PROPOSED**. Assigned by GPT HQ 2026-09-10. Worker: Claude Cowork.
Proof boundary: exactly the 17 candidates, with provenance, no authority mutations.
This file is **not a lawgiver.** It is a persistent index that points at authorities.

## READING RULES

1. This index never overrides a canonical domain authority. Where a row conflicts with its
   authority, the authority wins and the row is the defect.
2. A constraint with no surviving canonical source stays **UNKNOWN**. Recurrence across older
   Claude documents is not promotion into law.
3. `PROVENANCE` is where the wording was found. It is not authority. Every provenance document
   here is a Claude-HQ project document classified REFERENCE or HISTORY on 2026-09-10.
4. Constraint wording below is **derived summary, not verbatim**. The provenance document holds
   the exact language. Verbatim confirmation is a pending verification step.
5. Domains follow the GPT HQ ruling of 2026-09-10: `docs/PRODUCT_CONSTITUTION.md` (product identity
   and direction), `docs/ARCHITECTURE_LOCKS.md` (safety and architecture), `docs/RELEASE_STATE.md`
   (build/gate/release truth), `docs/WORK_CONTROL.md` (mutation ownership and execution),
   `docs/BACKLOG.md` (execution status). `CLAUDE.md` is the bootstrap pointer.

## VERIFICATION METHOD AND ITS LIMIT

Attempted, 2026-09-10:
- Live `Pootytxng/sentinel@main` (`d9d65904`) — **NOT ACCESSIBLE from Claude HQ.** GitKraken
  `repository_get_file_content` requires an interactive GitKraken sign-in on the owner's device;
  no GitHub connector is available in this session. No `docs/` file could be read.
- In-context `CLAUDE.md` and `PRODUCT.md` — read. These are the only authority-chain documents
  currently reachable from Claude HQ.

Received 2026-09-10, after the first draft of this index:
- **GPT HQ rulings against live `main@d9d65904`.** GPT HQ can read the repository; Claude HQ cannot.
  Rows marked `RULED BY GPT HQ` below carry that adjudication and its citation. This is an
  authoritative ruling relayed to Claude HQ — it is *not* independent verification by Claude HQ, and
  the distinction is kept in the `LAST VERIFIED` field of every row.

**Consequence: no row below has been independently verified from Claude HQ.** Four rows are
supported by a GPT HQ ruling, `CLAUDE.md`, or a dated owner decision. Thirteen remain UNKNOWN.

## FINDING THAT OUTRANKS THIS INDEX

The `CLAUDE.md` copy in Claude HQ project context names `docs/RECEIPTS_DOCTRINE.md` as the
canonical authority for money and product questions (constraints C-05 and C-06 point there and
nowhere else). GPT HQ verified on live `main` that `RECEIPTS_DOCTRINE.md` is titled SUPERSEDED and
marked HISTORICAL ONLY. The in-context `CLAUDE.md` also does not mention
`docs/PRODUCT_CONSTITUTION.md`, which live `CLAUDE.md` designates supreme for product truth.

GPT HQ confirmed on 2026-09-10 that live `CLAUDE.md` now sends a fresh session first to
`PRODUCT_CONSTITUTION.md`, then `RELEASE_STATE.md`, `WORK_CONTROL.md` and the other domain
authorities. The August copy in this project does not.

**The bootstrap pointer in persistent context is stale and routes product and monetization
questions to a superseded authority.** This is the highest-consequence item found in the retention
review. It is not fixed by pruning; it is fixed by the re-sync. Until the re-sync lands, no product
or monetization constraint reached through this project's `CLAUDE.md` should be treated as current.

## SUMMARY

| Status | Count |
|---|---|
| ACTIVE | 4 |
| SUPERSEDED | 1 |
| UNKNOWN | 13 |

18 rows, not 17. The GPT HQ ruling of 2026-09-10 split C-06: the old absolute form is retained as
SUPERSEDED and its surviving replacement is filed as C-06a. Per that ruling the superseded row stays
visible until provenance cleanup completes, rather than being silently rewritten as though it had
always meant the newer rule.

UNKNOWN here means *unverified from Claude HQ*, not *invalid*. One verification pass against the
domain authorities after the re-sync should resolve most of them.

---

## LEGAL AND PRIVACY

### C-01 — Lawyer review before public launch or taking money
CONSTRAINT: EULA §4/§8/§9 and the LICENSE liability sentence must be reviewed by a qualified lawyer before money changes hands or the product launches publicly.
DOMAIN (proposed): PRODUCT_CONSTITUTION / owner gate
CANONICAL SOURCE: none identified. Candidate: `docs/PRODUCT_CONSTITUTION.md`, unread from HQ.
OWNER DECISION: — | OWNER GATE: "Money" (CLAUDE.md gate list)
STATUS: UNKNOWN
PROVENANCE: `claude/LEGAL_REVIEW_2026-08-23.md` (which states it is not legal advice)
LAST VERIFIED: never against a canonical source

### C-02 — No DRAFT-labelled legal documents on a public download page
CONSTRAINT: Do not ship legal documents labelled DRAFT from a public download page; version them or pull the links.
DOMAIN (proposed): PRODUCT_CONSTITUTION / owner gate
CANONICAL SOURCE: none identified.
OWNER DECISION: — | OWNER GATE: "Ships to OTHER people's machines"
STATUS: UNKNOWN
PROVENANCE: `claude/LEGAL_REVIEW_2026-08-23.md`
LAST VERIFIED: never

### C-03 — Privacy policy must disclose seven data flows
CONSTRAINT: The privacy policy must disclose `sessions.json` game history, per-second full process enumeration, `hw_fingerprint`, the `license.key` `email_hash`, the feedback-email flow, hostname in Markdown/Discord exports, and affiliate commissions.
DOMAIN (proposed): ARCHITECTURE_LOCKS (the flows) + PRODUCT_CONSTITUTION (the disclosure duty)
CANONICAL SOURCE: none identified.
OWNER DECISION: —
STATUS: UNKNOWN — high consequence; verify first after re-sync
PROVENANCE: `claude/LEGAL_REVIEW_2026-08-23.md`
LAST VERIFIED: never

### C-04 — INTAKE_EMAIL is the only real personal-data flow
CONSTRAINT: `INTAKE_EMAIL` is a hardcoded personal Gmail address and is the product's only genuine personal-data flow.
DOMAIN (proposed): ARCHITECTURE_LOCKS
CANONICAL SOURCE: none identified. This is a code fact and should be verified against source, not doctrine.
OWNER DECISION: —
STATUS: UNKNOWN — this is a finding, not a constraint; it may not belong in this index
PROVENANCE: `claude/LEGAL_REVIEW_2026-08-23.md`
LAST VERIFIED: never

## MONETIZATION

### C-05 — Rollback and core safety are never paywalled
CONSTRAINT: Rollback and core safety functions are never gated behind payment — compliance with Microsoft unwanted-software criteria, not generosity.
DOMAIN: PRODUCT_CONSTITUTION, refined by its derived monetization document
CANONICAL SOURCE: `docs/product/MONETIZATION.md` §1 — "Core safety and rollback cannot become hostage features." §3 places rollback of Compy-applied changes in candidate Free and requires that boundaries never make safety unusable. Not stated verbatim in the Product Constitution; re-homed there by the constitutional migration.
OWNER DECISION: — (none required; GPT HQ ruled no new owner decision is needed)
STATUS: **ACTIVE** — RULED BY GPT HQ 2026-09-10
PROVENANCE: `claude/PRICING_DECISION_2026-08-23.md` (which records "not yet accepted; the price is his", but marks this rule "not optional" independent of price)
LAST VERIFIED: 2026-09-10 by GPT HQ against `main@d9d65904`. Not independently verified from Claude HQ — `docs/product/MONETIZATION.md` is not in project context.

### C-06 — No telemetry *(old absolute form)*
CONSTRAINT: No telemetry. Any monetization model requiring measured conversion, churn or funnel is inoperable; upgrade triggers must be local.
DOMAIN: PRODUCT_CONSTITUTION / ARCHITECTURE_LOCKS
CANONICAL SOURCE: none — and the categorical prohibition is contradicted by live authority. `PRODUCT_CONSTITUTION.md` §34 prohibits only dark patterns *around* telemetry, not telemetry itself. `ARCHITECTURE_LOCKS.md` §1.8 expressly permits a separately gated Tier 2 scrubbed incident fingerprint, opt-in and default-OFF.
OWNER DECISION: —
STATUS: **SUPERSEDED AS WRITTEN** — RULED BY GPT HQ 2026-09-10. Retained visible, not rewritten. Replaced by C-06a. Remove only when provenance cleanup completes.
PROVENANCE: `claude/PRICING_DECISION_2026-08-23.md`
LAST VERIFIED: 2026-09-10 by GPT HQ against `main@d9d65904`
NOTE: the monetization half — that a model requiring measured conversion/churn/funnel is inoperable — was not separately adjudicated. It may survive on its own footing under C-05's document. Open.

### C-06a — No silent or ungated machine-data telemetry
CONSTRAINT: No silent or ungated machine-data telemetry. Outbound machine-derived data requires its own Capability Exception, explicit consent appropriate to the tier, bounded schema and retention, and owner arming. The Tier 2 scrubbed incident fingerprint is opt-in, default OFF, and remains OFF after arming. Current enabled/disabled state comes from `docs/RELEASE_STATE.md`.
DOMAIN: ARCHITECTURE_LOCKS (capability boundary) + RELEASE_STATE (current armed state)
CANONICAL SOURCE: `docs/ARCHITECTURE_LOCKS.md` §1.8; `docs/PRODUCT_CONSTITUTION.md` §34 (dark-pattern prohibition)
OWNER DECISION: — (arming is owner-gated by construction)
STATUS: **ACTIVE** — RULED BY GPT HQ 2026-09-10; wording supplied by GPT HQ
PROVENANCE: replaces C-06. Preserves the privacy intent without contradicting Architecture Locks.
LAST VERIFIED: 2026-09-10 by GPT HQ against `main@d9d65904`. Not independently verified from Claude HQ. **Never assert the current on/off state from this row — read `docs/RELEASE_STATE.md`.**

### C-10 — Zero recurring spend; compy.gg parked
CONSTRAINT: No recurring spend. The `compy.gg` domain is parked indefinitely until a waitlist proves demand.
DOMAIN (proposed): PRODUCT_CONSTITUTION / owner gate
CANONICAL SOURCE: `CLAUDE.md` — "ZERO-BUDGET LAW: every phase ships $0-first on free tiers; any spend is owner-gated with named payback"
OWNER DECISION: **2026-08-23 — "Parked indefinitely by owner instruction."**
STATUS: **ACTIVE**
PROVENANCE: `claude/MONEY_REPLAN_2026-08-23.md`
LAST VERIFIED: 2026-09-10 against in-context `CLAUDE.md` (stale copy — re-verify after re-sync)

### C-15 — Marketing copy is owner territory
CONSTRAINT: Marketing and positioning copy belongs to the owner. Agents flag problems; they do not edit copy.
DOMAIN (proposed): PRODUCT_CONSTITUTION / owner gate
CANONICAL SOURCE: none identified. Adjacent CLAUDE.md gates exist ("Product name, Logo, Price presentation") but do not state this rule.
OWNER DECISION: —
STATUS: UNKNOWN
PROVENANCE: `claude/MONEY_REPLAN_2026-08-23.md` (classified HISTORY)
LAST VERIFIED: never

## DISTRIBUTION AND SIGNING

### C-07 — MSIX / packaged Microsoft Store is a permanent NO-GO
CONSTRAINT: The MSIX and packaged Microsoft Store path is permanently out while Compy elevates. Not deferred — rejected.
DOMAIN (proposed): ARCHITECTURE_LOCKS (elevation) + PRODUCT_CONSTITUTION (distribution)
CANONICAL SOURCE: none identified.
OWNER DECISION: —
STATUS: UNKNOWN
PROVENANCE: `claude/MSIX_STORE_SCOPE_2026-08-23.md` — "NO-GO on MSIX. Not deferred."
LAST VERIFIED: never

### C-08 — EV certificates are rejected and not to be re-proposed
CONSTRAINT: EV code-signing certificates are rejected. Do not re-propose without naming the 2024 removal.
DOMAIN (proposed): PRODUCT_CONSTITUTION / owner gate
CANONICAL SOURCE: none identified.
OWNER DECISION: — | OWNER GATE: "Secrets / signing"
STATUS: UNKNOWN
PROVENANCE: `claude/MSIX_STORE_SCOPE_2026-08-23.md` — "RE-CONFIRMED, do not re-propose"
LAST VERIFIED: never

### C-09 — Code signing deferred until download volume exists
CONSTRAINT: Azure Artifact Signing (~$119.88/yr) is deferred; it buys nothing at zero download volume.
DOMAIN (proposed): PRODUCT_CONSTITUTION / owner gate
CANONICAL SOURCE: partial — `CLAUDE.md` ZERO-BUDGET LAW covers the spend half, not the signing verdict.
OWNER DECISION: — | OWNER GATE: "Secrets / signing", "Money"
STATUS: UNKNOWN
PROVENANCE: `claude/MSIX_STORE_SCOPE_2026-08-23.md`, `claude/MONEY_REPLAN_2026-08-23.md`
LAST VERIFIED: never

### C-13 — Free channels need no signing; antivirus is the real gate
CONSTRAINT: The releases repo, WinGet, Chocolatey and Scoop `extras` require no code signing. Antivirus — Defender, the engine WinGet gates on — is the actual gate, and was measured clean on 2026-08-23 (signature `1.457.306.0`).
DOMAIN (proposed): PRODUCT_CONSTITUTION (distribution) + RELEASE_STATE (artifact truth)
CANONICAL SOURCE: none identified.
OWNER DECISION: —
STATUS: UNKNOWN — the AV measurement is 18 days old and is release evidence, which belongs in `docs/RELEASE_STATE.md`, not here
PROVENANCE: `claude/DISTRIBUTION_SCOPE_2026-08-23.md` — "GO. STEPS ①–③ EXECUTED"
LAST VERIFIED: never

### C-14 — Publisher identity must be resolved before any manifest
CONSTRAINT: The publisher-identity conflict — `LICENSE` says "Kuya", `tauri.conf.json` says "Pootytxng" — must be resolved by the owner before any package manifest ships.
DOMAIN (proposed): owner gate
CANONICAL SOURCE: none identified.
OWNER DECISION: — **open owner item**
STATUS: UNKNOWN — but the underlying conflict is verifiable in the repo and should be closed regardless of where the rule lives
PROVENANCE: `claude/DISTRIBUTION_SCOPE_2026-08-23.md`
LAST VERIFIED: never

## HARDWARE ACCESS

### C-11 — PawnIO prohibition
CONSTRAINT: Compy will not bundle, install, download, recommend, update or remove PawnIO. Issue #202 passive detection is not authorized for implementation.
DOMAIN (proposed): ARCHITECTURE_LOCKS
CANONICAL SOURCE: none identified in a readable authority, but carried by an explicit dated owner decision.
OWNER DECISION: **2026-08-23 — "OWNER DECISION: Compy will NOT bundle, install, download, recommend, update or remove PawnIO."**
STATUS: **ACTIVE** (owner decision)
PROVENANCE: `claude/CPU_TEMP_FEASIBILITY_2026-08-23.md`
LAST VERIFIED: 2026-09-10 against provenance only

### C-12 — Re-proposal ban on hardware-access routes
CONSTRAINT: Do not re-propose HWiNFO SHM, LibreHardwareMonitor/WinRing0, Ryzen Master SDK, ADLX, Intel Power Gadget, or a Compy-owned signed driver.
DOMAIN (proposed): ARCHITECTURE_LOCKS
CANONICAL SOURCE: none identified.
OWNER DECISION: — (rides with C-11 but is not itself quoted as an owner decision)
STATUS: UNKNOWN — strong candidate for `docs/ARCHITECTURE_LOCKS.md`
PROVENANCE: `claude/CPU_TEMP_FEASIBILITY_2026-08-23.md`
LAST VERIFIED: never

## AGENT OPERATING DISCIPLINE

### C-16 — Declare vantage before asserting host state
CONSTRAINT: Before asserting anything about `%APPDATA%`, `%LOCALAPPDATA%` or `HKCU`, state which vantage the reading came from. Never launch Compy from a packaged host.
DOMAIN (proposed): WORK_CONTROL (verification discipline) + ARCHITECTURE_LOCKS (data root)
CANONICAL SOURCE: none identified.
OWNER DECISION: —
STATUS: UNKNOWN — no other document carries this rule; if it is not adopted into an authority it will be lost when its provenance doc is archived
PROVENANCE: `claude/DATA_ROOT_INTEGRITY_DOSSIER.md` (classified REFERENCE)
LAST VERIFIED: never

### C-17 — A guard must not encode one side of an unsettled question
CONSTRAINT: Automated guards must not hard-code a position on a question the owner has not settled.
DOMAIN (proposed): WORK_CONTROL
CANONICAL SOURCE: none identified.
OWNER DECISION: —
STATUS: UNKNOWN — extracted from a HISTORY-class document; adopt into `docs/WORK_CONTROL.md` or drop it
PROVENANCE: `claude/MONEY_REPLAN_2026-08-23.md` (classified HISTORY)
LAST VERIFIED: never

---

## WHAT WOULD CHANGE THESE STATUSES

1. Force the project GitHub re-sync with the corrected include set. That makes the five domain
   authorities readable from Claude HQ for the first time.
2. Re-read `CLAUDE.md` after the re-sync. The in-context copy is from 2026-08-12 and is known
   stale on the authority question.
3. One verification pass: for each UNKNOWN row, search the authorities for the rule. Found →
   ACTIVE with a `file:section` citation. Absent → the constraint is either dead or needs an owner
   decision to adopt it. Do not leave rows UNKNOWN indefinitely; an UNKNOWN constraint still
   steering work is the exact failure this index exists to expose.
4. Independently re-verify the four GPT-HQ-ruled rows (C-05, C-06, C-06a, and the C-10 citation)
   once `docs/` is readable from Claude HQ. A relayed ruling is authority, not verification.
5. Add `docs/product/MONETIZATION.md` to the persistent include set — GPT HQ ruling of 2026-09-10.
   It is the current derived home of C-05 and is more useful than preserving old monetization
   constraints here. Its own header states it is derived from the Product Constitution.

## OPEN / BLOCKED

- **BLOCKED:** all independent canonical-source verification, on the re-sync (owner-only).
- **RESOLVED 2026-09-10:** C-05 and C-06 authority homes — ruled by GPT HQ. C-05 ACTIVE in
  `docs/product/MONETIZATION.md`; C-06 SUPERSEDED as written and replaced by C-06a.
- **OPEN:** the monetization half of C-06 (a model requiring measured conversion/churn/funnel is
  inoperable) was not separately adjudicated and currently has no cited home.
- **OWNER-ONLY:** C-14 publisher identity is an unresolved owner decision, not a documentation gap.
- **SCOPE NOTE:** C-04 is a finding and C-13's antivirus result is release evidence. Neither is a
  constraint. Recommend removing both from this index once GPT HQ rules, leaving 15 rows.
