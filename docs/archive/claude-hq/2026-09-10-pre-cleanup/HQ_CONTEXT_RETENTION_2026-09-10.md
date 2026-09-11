# HQ CONTEXT RETENTION — PROPOSAL, 2026-09-10

Status: RATIFIED WITH AMENDMENTS by GPT HQ, 2026-09-10. See §0. Mutates no competing authority.
Author: Cowork Claude. Route to: GPT HQ (Astra) for ratification.
Scope: project-context retention only. No repository file is deleted by this proposal.

---

## 0. GPT HQ RATIFICATION — 2026-09-10

Reconciled by GPT HQ against live `Pootytxng/sentinel@main` at `d9d65904`. Direction ratified; authority model amended. GPT HQ could not read this document (not attached to that surface) and reconciled from a pasted summary.

**A0-1 — Authority is domain-specific, not a single chain.** Per `CLAUDE.md` on live main: `docs/PRODUCT_CONSTITUTION.md` is supreme for product truth; `docs/RELEASE_STATE.md` for build/gate truth; `docs/ARCHITECTURE_LOCKS.md` for safety/architecture; `docs/WORK_CONTROL.md` for mutation/ownership; `docs/BACKLOG.md` for execution status only. The Product Constitution supersedes prior product strategy and does not override the other three in their domains.

**A0-2 — Include set corrected.** `docs/PRODUCT_CONSTITUTION.md` MUST be added to the persistent set. `docs/RECEIPTS_DOCTRINE.md` MUST NOT be — it is titled SUPERSEDED and marked HISTORICAL ONLY on live main. Corrected persistent include set: PRODUCT_CONSTITUTION + RELEASE_STATE + ARCHITECTURE_LOCKS + WORK_CONTROL + BACKLOG. Optionally `docs/product/ROADMAP.md`, which Work Control names as the derived product-sequence authority, if capacity allows. This supersedes the include set named in §6 and in Handoff 1 of the 2026-09-10 Cowork report.

**A0-3 — Class amendments to §2.**
- `TOKEN_ECONOMY_LAW.md` — FOUNDATION *provisionally*; keep only while it agrees with mechanically enforced repo policy.
- `HQ_DECISION_LEDGER.md` — NOT FOUNDATION as one 830-line object. TEMPORARY OPERATIONS until split; surviving standing directives may then graduate, dated tail becomes HISTORY. It gets no permanent precedence slot.
- `HQ_RESUME.md` — OPERATIONS as a pointer/resume sheet only. It must not carry authoritative leases, gate truth, or release truth.
- `ASTRA_INTERRUPTION_RECOVERY_2026-09-07.md` — OPERATIONS now; moves to HISTORY once its recovery actions complete or are superseded. A dated recovery document does not stay permanently live.
- The 10 REFERENCE and 11 HISTORY classifications are RATIFIED unchanged.

**A0-4 — Three of the seven §4 conflicts are resolved.**
- §4.1 stale lease: `TWO_AGENT_PROTOCOL` loses. Work Control sets a 12-hour default lease expiry, and expiry is an alarm, not automatic takeover — a stale claim requires state inspection and a recorded takeover, and never authorizes reset, discard, deletion, process kill, or overwrite.
- §4.4 #225 ownership: neither HQ_RESUME nor the ledger decides this. Work Control plus the linked issue hold the lease; conversation context is explicitly non-authoritative. Surviving statement: **#225 currently holds no mutation lease and owns no release-state files; it remains open only at the owner acceptance boundary; any future mutation requires a newly derived Work Control lease.** Retire the HQ_RESUME sentence. The ledger's "not #225 work" sentence does not become law either — it merely happens to align with current mutation state.
- §4.5 compaction window: tracked settings on main set `CLAUDE_CODE_AUTO_COMPACT_WINDOW = 250000`. Surviving rule: **250000 is the standard current window; 300000 is an explicitly scoped MARATHON tier, never a global default and never inferred from a session that measured or tolerated a larger context.** Any HQ document asserting 300000 as the current window without that scope is incorrect or historical.

**A0-5 — SUPERSEDED by A0-10.** §4.2, §4.3, §4.6 and §4.7 were BLOCKED; all four were adjudicated by GPT HQ later on 2026-09-10.

**A0-6 — Deletion blocker RESOLVED.** Live `main` has no `claude/` directory — direct lookup returns 404. The repo has `.claude/`, a different directory. Only a reference to `claude/HQ_DECISION_LEDGER.md` inside `docs/COWORK_HANDOFF.md` exists, not the file. The 25 project documents are therefore single-copy and MUST be archived to `docs/archive/claude-hq/` before any removal from project context. This supersedes the UNKNOWN recorded in §7.

**A0-7 — P1 approved with modification.** `claude/STANDING_CONSTRAINTS.md` is approved as a persistent *derived constraint index*, not an independent lawgiver. Each row carries constraint, domain, canonical source, owner decision and date where applicable, status (ACTIVE / SUPERSEDED / UNKNOWN), and last verification. A constraint with no surviving canonical source stays UNKNOWN. Extraction must not promote a constraint into law because it recurred in older Claude documents. Worker: Claude Cowork, assigned by GPT HQ. Proof boundary: a proposed index of exactly the 17 candidates with provenance and no authority mutations. GPT HQ and Codex are read-only on this slice until review.

**A0-8 — Instructions clause replaced.** The §5 P3 wording is superseded by:
> Presence in project context establishes availability, not authority. Authority is domain-specific. Explicit owner decisions govern where they validly amend the applicable domain. `docs/PRODUCT_CONSTITUTION.md` governs product identity and direction; `docs/ARCHITECTURE_LOCKS.md` governs safety and architecture; `docs/RELEASE_STATE.md` governs current build, gate, installed, artifact, and release truth; `docs/WORK_CONTROL.md` plus the live Work Control Project and linked issue govern current mutation ownership and execution; `docs/BACKLOG.md` records execution status. `CLAUDE.md` is the bootstrap/pointer for these authorities. Claude-HQ documents such as HQ_RESUME, STANDING_CONSTRAINTS and decision history are subordinate coordination aids and never override their canonical domain. When contextual material conflicts with a newer authoritative source, stop the conflicting mutation, report the discrepancy, and re-derive live state.

**A0-9 — Owner sequencing.** Force re-sync with the corrected include set. Do NOT remove any of the 25 Claude-local documents yet: archive and the ledger split come first.

**A0-10 — Remaining four §4 conflicts resolved, 2026-09-10.** GPT HQ, against live `main@d9d65904`.

- **§4.2 parallelism — RESOLVED.** Concurrent implementation is permitted for disjoint scopes in separate worktrees/branches. Overlapping scope serializes under one mutation lease. The blanket "one lane at a time / no parallel implementation writers" law is superseded.
- **§4.3 worker roster — RESOLVED.** The 09-07 fixed three-worker roster is NOT current operating law. Claude Code, Codex and ChatGPT HQ are all eligible executors; there is "no permanent implementation department." Executor selection is dynamic, based on context, remaining capacity, tooling and ability to reach the proof boundary. "Sol" is retired as an organizational role, not banned as a model. **Neither "Sol does mechanical work" nor "Claude Code is sole implementation writer" survives in FOUNDATION.**
- **§4.6 `~/.claude/` posture — OWNER-ONLY survives.** Cowork has no standing authority to edit `~/.claude/settings.json`. `docs/OWNER_ACTION_CHECKLIST.md` still reserves that file and the session-gating hooks to the owner's hand. The 09-04 Cowork authorization applied the repo-side hook repair only; it created no blanket global-settings delegation, and the broad "resolve every task yourself" direction must not be generalized into permission to mutate owner-global control surfaces. Consequence: the two `TOKEN_ECONOMY_LAW` §5 items are **BLOCKED — OWNER-ONLY**, not permanently dead. They become actionable only on the owner making that exact global-settings change or explicitly authorizing that exact mutation.
- **§4.7 active lane / fleet — HISTORY.** `docs/RELEASE_STATE.md` has fleet/public release at v0.9.26, source `5e64074c`. Native issue #127 is closed, state reason completed, closed 2026-08-19. The `COMPY_AUDIT_2026-08-19` claim that #127 is active and fleet is v0.9.25 is stale historical state, as classified.

**Consequence for §2 classification:** `ASTRA_INTERRUPTION_RECOVERY_2026-09-07.md` remains OPERATIONS for its PR #387 lane state, but the worker-model line it carries ("Claude Code = sole implementation writer · Astra = independent exact-head reviewer · Cowork = only where local computer-use is required") is superseded by A0-10 §4.3 and must not be treated as the roster of record.

**A0-11 — Include set, final.** `docs/PRODUCT_CONSTITUTION.md` + `docs/RELEASE_STATE.md` + `docs/ARCHITECTURE_LOCKS.md` + `docs/WORK_CONTROL.md` + `docs/BACKLOG.md` + `docs/product/MONETIZATION.md`. Optionally `docs/product/ROADMAP.md`. `docs/RECEIPTS_DOCTRINE.md` stays excluded. MONETIZATION.md is added because it is the current derived home of the rollback/core-safety constraint (C-05) and is more useful persistently than preserving old monetization constraints in `claude/STANDING_CONSTRAINTS.md`; its own header states it is derived from the Constitution and it does not outrank it.

**A0-12 — Effective Claude-HQ rule, as reconciled.**
> Product Constitution decides product direction. Architecture Locks decides safety and privacy capability boundaries. Release State decides what is actually armed, built and published. Work Control decides who may mutate what. Derived documents such as MONETIZATION refine their own domain. Claude-HQ files summarize and route; they never overrule those sources.

## 1. VERIFIED FINDINGS

**F1 — The sync filter is already correct and is NOT in effect.**
Live filter on `Pootytxng/sentinel@main`:
```
"/": include
"/src/", "/docs/", "/tools/", "/.claude/", "/.vscode/", "/src-tauri/": exclude
"/package-lock.json": exclude
"/docs/BACKLOG.md", "/docs/WORK_CONTROL.md", "/docs/RELEASE_STATE.md",
"/docs/RECEIPTS_DOCTRINE.md", "/docs/ARCHITECTURE_LOCKS.md": include
```
Live doc list contradicts it: `package-lock.json` is PRESENT (excluded by filter); all five `docs/` includes are ABSENT. Every root doc carries `created_at` = `2026-08-12T02:33:39`, the original sync. The filter has been edited since; the sync has not re-run. **The pruning is configured and unapplied.**

**F2 — The named authority chain is entirely missing from context.**
`CLAUDE.md`: "LIVE GATE STATE → `docs/RELEASE_STATE.md` is authoritative… Where any older text in this file or any other doc disagrees about *current* gate state, RELEASE_STATE.md wins." `AGENTS.md` concurs. None of `docs/RELEASE_STATE.md`, `WORK_CONTROL.md`, `RECEIPTS_DOCTRINE.md`, `ARCHITECTURE_LOCKS.md`, `BACKLOG.md` are in project context. Context is 47.7% full (954,731 / 2,000,000) and holds zero designated authorities. `claude/HQ_DECISION_LEDGER.md` is named nowhere in the repo's authority chain.

**F3 — `claude/*` are project-written docs, not synced repo files.**
Their `created_at` values span 2026-08-12 → 2026-09-08 individually, outside the sync window. They are removable via `project_delete` with no repository effect. UNKNOWN: whether a repo-side copy exists. Verify before any deletion.

**F4 — Seven live contradictions inside `claude/`.** See §4.

---

## 2. CLASSIFICATION — 25 `claude/` DOCS

FOUNDATION (2) — persistent
- `HQ_DECISION_LEDGER.md` — standing directives, marathon laws, lane decisions. Self-subordinates to `HQ_RESUME.md` on state.
- `TOKEN_ECONOMY_LAW.md` — "the single authoritative token/usage policy for every lane"; landed `94db990b`; unretired.

OPERATIONS (2) — persistent while current
- `HQ_RESUME.md` — "if any two disagree about current state, this file wins"; brought current 2026-09-07.
- `ASTRA_INTERRUPTION_RECOVERY_2026-09-07.md` — PR #387 round 3 open; current worker model.

REFERENCE (10) — fetch on demand
- `TOKEN_ECONOMY_DOSSIER_2026-08-18.md` — "read this only to check its working"
- `HANDOFF_JAIKARAN_AND_RIG_2026-08-14.md` — tasks unconfirmed-closed
- `SOL_WORK_QUEUE_TO_MONDAY.md` — only enumeration of the P2–P7 backlog
- `RIG_IDLE_DOSSIER.md` — #127 evidence; trigger not runtime-confirmed
- `LEGAL_REVIEW_2026-08-23.md` — live fix-list; not legal advice
- `PRICING_DECISION_2026-08-23.md` — "not yet accepted; the price is his"
- `DISTRIBUTION_SCOPE_2026-08-23.md` — 5 open manifest blockers
- `MSIX_STORE_SCOPE_2026-08-23.md` — NO-GO verdict + sourcing
- `CPU_TEMP_FEASIBILITY_2026-08-23.md` — owner decision + re-proposal ban
- `DATA_ROOT_INTEGRITY_DOSSIER.md` — carries the vantage rule (FOUNDATION-grade content)

HISTORY (11) — archive, exclude from persistent context
`TWO_AGENT_PROTOCOL.md` (lease medium + "Sol" roster replaced), `TOKEN_ECONOMY_STATUS.md` ("LANDED… Nothing outstanding"), `COMPY_MARATHON_PLAN.md` (v0.9.14 target; fleet at v0.9.26), `COMPY_AUDIT_2026-08-19.md` (snapshot; lessons merged into ledger), `DESK_CONFLICT_AUDIT_2026-09-04.md` ("everything landed"), `MIGRATION_TO_VSCODE_2026-08-24.md` (self-closed; one claim already falsified), `SESSION_HANDOFF_2026-08-12.md`, `AUDIT_HANDOFF_SOL_2026-08-13.md` ("SUPERSEDED — do not use"), `CODEX_BRIEF_RIG_IDLE.md` (addressee removed from critical path), `MONEY_REPLAN_2026-08-23.md` (self-corrected; content moved to #204/#205/#206), `CPU_TEMP_SOURCING_DOSSIER.md` ("retired, and was also technically wrong").

Count reconciliation: 2 + 2 + 10 + 11 = 25. (REFERENCE listed 10; HISTORY 11.)

---

## 3. ROOT FILES

PERSISTENT: `CLAUDE.md` (self-declares auto-load; sole carrier of LOCKED rules, owner gates, TOKEN LAW).
ADD TO PERSISTENT (currently missing): `docs/RELEASE_STATE.md`, `docs/WORK_CONTROL.md`, `docs/ARCHITECTURE_LOCKS.md`, `docs/RECEIPTS_DOCTRINE.md`.
ON-DEMAND: `AGENTS.md` (Codex control file, defers to CLAUDE.md), `COMPY_OVERVIEW.md` (last reconciled 2026-08-09), `PRODUCT.md`, `DESIGN.md`, `README.md`, `package.json`, `compy-entry.ps1`, `_tester-message.md`.
ARCHIVE — ACTIVE HAZARD: `ui-spec.md`. Names Tailwind / shadcn/ui / Zustand / framer-motion / Inter+Geist and a `w-64` sidebar. `DESIGN.md` (shipped) says Segoe UI Variable, no remote fonts, one rail from `src/design/homeRail.ts`. A persistent pre-build spec that contradicts the shipped design is worse than an absent one.
REMOVE: `package-lock.json`, `tsconfig.json`, `tsconfig.node.json`, `vite.config.ts`, `vitest.config.ts`, `.editorconfig`, `.gitattributes`, `.gitignore`, `.mcp.json`, `components.json`, `vercel.json`, `wrangler.toml`, `rust-toolchain.toml`, `index.html`.

---

## 4. CONFLICTS FOR GPT HQ RECONCILIATION

1. **Takeover.** `TWO_AGENT_PROTOCOL`: "a lease whose heartbeat is >90 minutes stale is **abandoned**." Ledger: "A CLAIM HAS NO AUTOMATIC TAKEOVER. An expired clock is not a licence."
2. **Parallelism.** `TWO_AGENT_PROTOCOL`: replaces "one lane at a time" with a disciplined constraint. `HQ_RESUME` / marathon law 5: "No parallel implementation writers."
3. **Roster.** `TWO_AGENT_PROTOCOL` assigns work to "Sol." 09-07 model: "Claude Code = sole implementation writer"; Codex "removed from the critical path."
4. **#225 ownership.** `HQ_RESUME`: "#225 owns the release-state files." Ledger 09-07: "The release-state repair belongs to no live lane and is not '#225 work'."
5. **Compaction window.** `TOKEN_ECONOMY_LAW` §2: "near a local optimum at 250000. Leave it." Ledger, measured 09-04: env is `300000` — "repo… says 250000 — drift."
6. **`~/.claude/` posture.** Law §5: two items "blocked by `~/.claude/settings.json`'s own `hard_deny`." Ledger: "superseded for Cowork by the 09-04 directive."
7. **Active lane / fleet.** `COMPY_AUDIT`: "#127 is now the active lane"; v0.9.25. Ledger: "#127 closed — the rAF diagnosis was falsified"; v0.9.26 / `5e64074c`.

---

## 5. PROPOSED STRUCTURAL CHANGES

**P1 — Promote standing constraints, demote their carriers.** 17 still-binding constraints are trapped inside REFERENCE-class docs totalling ~12,000 words (legal, pricing, distribution, MSIX, CPU temp, data root). Extract them into one `claude/STANDING_CONSTRAINTS.md` (~1 page, FOUNDATION). Then the binding half persists and the sourcing half becomes fetch-on-demand. This is the single highest-leverage reduction and it converts accidental influence into deliberate law.

**P2 — Split the ledger.** `HQ_DECISION_LEDGER.md` is ~830 lines / ~8,500 words and is the largest persistent item by a wide margin. Its changelog tail is HISTORY living inside a FOUNDATION file. Split: laws/directives stay; dated changelog moves to `docs/archive/`.

**P3 — Instruction patch. SUPERSEDED by §0 A0-8.** Add to project instructions:
> Presence in project context establishes availability, not authority. Determine authority from the current governance hierarchy and the live operational source. Precedence, highest first: (1) explicit owner decision; (2) `docs/RELEASE_STATE.md` for current gate/build/release state; (3) `CLAUDE.md` and the `docs/` authorities it names; (4) `claude/HQ_RESUME.md` for Claude-lane volatile state; (5) `claude/HQ_DECISION_LEDGER.md` for Claude-lane standing directives. Where a contextual document conflicts with a newer authoritative source, do not follow the stale contextual copy. Report the conflict.

---

## 6. TARGET END STATE

Persistent: `CLAUDE.md` + 4 `docs/` authorities + `HQ_DECISION_LEDGER.md` (split) + `TOKEN_ECONOMY_LAW.md` + `STANDING_CONSTRAINTS.md` + `HQ_RESUME.md` + the current lane appendix. Ten to eleven files, all designated. Everything else fetched.

## 7. OPEN / BLOCKED

- RESOLVED 2026-09-10 (§0 A0-6): no `claude/` directory on main; the 25 documents are single-copy and must be archived to `docs/archive/claude-hq/` before removal.
- UNKNOWN: exact byte share of `package-lock.json`. Not measured — measuring it costs ~200k tokens under TOKEN LAW for a number that changes no decision.
- BLOCKED (owner-only): forcing the GitHub source to re-sync; editing project instructions.
- This document is OPERATIONS-class until executed, then HISTORY.
