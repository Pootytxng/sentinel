# Loose-ends sweep — backend/content audit (2026-06-01)

A read-only audit of the current build (run in parallel with the design/experience
pass on branch `experience-pass`), scoped to backend (`src-tauri/`), catalog content,
and docs. Frontend (`src/`) was **audited but not edited** — it is the design tab's turf.

**Headline:** the build is in genuinely good shape. No broken functionality, all 23 IPC
commands wired + implemented, no Apply button without a working + reversible path, no
runtime-panic risk in production code, catalog descriptions honest and consistent.
`cargo test` = **72 passed / 0 failed** at `main` (`5c5c764`). The loose ends below are
documentation drift and honesty-preservation flags, not functional breakage.

---

## ✅ Fixed in this sweep (branch `chore/loose-ends-sweep`)

- **A1 — Stale GPU-sensor comments in `src-tauri/src/monitoring.rs`.** The NVML section
  header said *"NVIDIA only for v1"* and a comment said *"ADLX (AMD) … will land in
  follow-up commits"* — but the AMD ADLX poller already ships right below it. Reworded to
  match reality (AMD via ADLX shipped; Intel GPA still planned). Comment-only; tests
  re-verified 72/72.

---

## 🟡 Flags for the DESIGN tab (`src/` — do not regress during the experience pass)

### B1 — GPU-vendor honesty indicators are a LOCKED rule (CLAUDE.md rule #5)
These currently exist and are correct; they **must survive** the Monitoring-surface
redesign verbatim. CLAUDE.md forbids silently upgrading NVIDIA's confidence.
- `src/App.tsx:1850-1851` — coverage line:
  *"AMD — verified · NVIDIA — implemented, not yet hardware-verified · Intel — planned."*
- `src/App.tsx:2165-2170` — per-card NVIDIA **"unverified"** badge + tooltip
  ("treat values as provisional").

When these move into the new design system, keep: AMD = verified, NVIDIA =
implemented-not-yet-hardware-verified, Intel = planned.

### B2 — Same stale "ADLX coming / NVIDIA-only" drift mirrored in the frontend
Fix when you next touch the Monitoring surface (mirror of A1):
- `src/App.tsx:1871` — comment "GPU panels — one per detected **NVIDIA** adapter"
  (now AMD too).
- `src/App.tsx:1875` — "AMD (ADLX) and Intel (GPA) [coming]" (ADLX has shipped).

### B3 — `APPLIABLE_REC_IDS` must stay in sync, backend ↔ frontend
- Backend source of truth: `src-tauri/src/history.rs:35-52` (16 IDs) — also enforced in
  the `apply_recommendation` dispatch and `check_change_active`.
- Frontend copy: `src/App.tsx:128-145` (16 IDs).
- They are **currently identical**. If the rec rendering changes, keep them in lockstep —
  otherwise an Apply button can appear for a rec the backend rejects (or vice versa).

---

## 🟠 Needs product-owner decision (not auto-fixed)

### A2 — CLAUDE.md "CURRENT STATE" references stale branch topology
The "DOCS-vs-`main` DRIFT" banner says `main` HEAD is `d049d63` (13 commits past the
`private-beta-001` freeze). Actual current topology:
- `main` = `5c5c764` (docs(experience) line)
- `experience-pass` = `cde67bc` (active design work)
- `beta/private-beta-001` = `16069fa` (frozen — unchanged)

The banner predates the experience-pass branch reorganization (CLAUDE.md mtime ~08:48;
experience-pass commits ~16:18–16:45). It is the authoritative brief and the branch
reshaping belongs to the design pass, so the wording should be refreshed by the
owner/design tab rather than unilaterally — flagged here for that.

---

## Audit coverage (for the record)

- Read in full: `lib.rs`, `hardware.rs`, `monitoring.rs`, `diagnostics.rs`,
  `recommendations.rs`, `history.rs`, `baseline-rules-v1.json`.
- Grep-swept: `actions.rs` (apply/rollback dispatch), `export.rs`, `readiness.rs`,
  `sessions.rs`, `priorities.rs`, `fps.rs`, `remote_rules.rs` — for TODO/stub/drift
  markers and production-path `unwrap()/expect()` (all such calls are test-only).
- Verified: appliable-rec contract consistent across `APPLIABLE_REC_IDS` (16) ↔ apply
  dispatch ↔ `check_change_active` ↔ catalog ↔ frontend; catalog = 17 JSON rules + ~13
  code recs ≈ 30 (CLAUDE.md "~29"); no duplicate rec IDs; honest `Provenance` tiers.
- Did NOT deep-read every line of `actions.rs` (1359 lines, mutation core) — grep showed
  the dispatch consistent and CLAUDE.md records it as QA-signed-off. Available on request.
