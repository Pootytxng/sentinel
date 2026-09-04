# Intelligence Phase 1 — Foundation + "What changed?" (decision record)

> **PRODUCT DIRECTION SUPERSEDED 2026-09-04 (#369).** The `IN BUILD` label, priority, and execution
> directives below are historical and confer no current authority. Product identity and direction
> now come from `docs/PRODUCT_CONSTITUTION.md`; product sequence derives through
> `docs/product/ROADMAP.md`, and current ownership must come from `docs/WORK_CONTROL.md`. The bounded
> technical record remains provenance only where it conforms to the Constitution and
> `docs/ARCHITECTURE_LOCKS.md`.
>
**Status:** IN BUILD 2026-07-16. **Provenance:** owner directive `docs/reviews/2026-07-16-owner-directive-intelligence-platform.md`
§5 (Cowork-lane artifact — executed from, never committed). Owner-approved ("begin implementing the
foundation immediately"), not a brainstorm. **Namespace law (§6):** this lane is "Intelligence Phase N"
in every doc/commit/report — bare "Phase N" belongs to Optimization Cleanup (§0.11: that lane is
untouched by this train; its Phase 1 research spec stays exactly where it is).

**Scope (read-only vertical slice):** canonical intelligence types (Rust) · local event timeline from
persisted data · deterministic "What changed?" engine · first UI surfaces (Monitor session detail +
Blackbook tape + Home one-liner) · anti-fabrication guards. **Not in scope:** any mutation-path change,
any network/telemetry/capability change, ML of any kind, numeric confidence (no calibration exists —
bands only: Unknown/Low/Medium/High).

## Architecture decisions (§8.3)

1. **Canonical home = new `src-tauri/src/intelligence.rs`.** Every persisted store it reads is
   Rust-side JSON under `compy_data_dir()` (lib.rs:418); heuristics in React components are exactly
   what the directive bans. TS stays presentation-only. **One exception, verified:** Blackbook's
   autopsy ledger is localStorage-only (`compy_autopsy_ledger_v1`, `src/data/autopsy-ledger.ts:9`) —
   Rust can't read it, so it remains a TS-side tape source and the Rust timeline never mirrors it
   (single-truth rule: each event kind has exactly one source path into the UI).
2. **State pattern:** module statics + synchronous JSON (`intelligence.json`), matching every other
   module — the repo has no `tauri::State` anywhere.
3. **Identity snapshots (new persistence, honest from-now-on):** the engine needs GPU-driver /
   Windows-build / power-plan change events, but no store records them historically. New append-only
   snapshot log inside `intelligence.json`: `{observed_at, gpu_driver_version, gpu_driver_date,
   windows_build, windows_ubr, windows_display_version, power_plan, hw_hash}` — appended on probe
   ONLY when a field changed vs the last snapshot (plus first run). A delta between snapshots yields
   an event honestly stamped "observed `<date>`" (bounded by the two snapshot times, never a fabricated
   occurrence time). Nothing is backfilled (§5C: non-persisted sources exist only from the point
   persistence begins).
4. **Timeline (§5C):** `EventRecord` assembled deterministically from history.json (applies /
   rollbacks / external reverts), sessions.json, gaming-session state (lifecycle + recovery),
   benchmark + comparison stores, Black Box events, hardware-fingerprint changes, identity snapshots.
   Stable total order: `(timestamp, source_priority, id)` — pinned by a determinism guard.
5. **What-Changed engine (§5D):** compares two sessions (same game, same rig preferred; else says so).
   Metric deltas judged with METHODOLOGY.md's existing rails — flat 3% cross-session noise floor on
   the 1%-low delta; avg FPS is reference-only; "No meaningful difference" is a first-class verdict.
   Events-between feed a fixed hypothesis catalog (driver change · Windows build · Compy config ·
   Gaming Mode state · power plan · hardware change · memory pressure · thermal · game variance ·
   insufficient evidence), each carrying supporting / contradicting / missing evidence. **Multiple
   simultaneous changes ⇒ attribution refused** (plural copy — mirrors comparison.rs `confounded`).
   Confidence = rule-derived band only; correlation language never implies causation ("changed
   between these sessions", never "caused by").
6. **Commands (read-only), registered at lib.rs:971+:** timeline fetch + session-delta explain
   (final names at build). No new capabilities; `src-tauri/capabilities/` untouched.
7. **UI (§5E/F), flag `compy_intelligence` default ON** (owner-commissioned surface; flag is the
   failsafe per convention, OFF pins the prior tree byte-identical via `intelligence-flag.test.tsx`):
   - **Monitor** owns "what happened": a What-Changed panel in `SessionDebrief` (the slot at
     SessionDebrief.tsx:328-344 already has `comparison` + `changes` in scope), additive — the
     existing ComparisonCard keeps the rec-scoped A/B story; this panel answers "vs last time I
     played this game". Expert disclosure inside the panel (exact sessions, timestamps, deltas,
     evidence, what argues against it).
   - **Blackbook** owns history: extend `LogbookRecord`/`buildLogbook` (src/surfaces/blackbook/
     logbook.ts) with the new Rust-timeline event kinds (identity / gaming-mode / benchmark) — never
     a second timeline; existing change/session/autopsy rows untouched.
   - **Home**: at most one concise leading-finding line following the `hc-limiter` single-line
     template (HomeConsole.tsx:636-645). No fifth room.
8. **Language (§7):** "What changed? · Most likely cause · Evidence · What argues against it ·
   Next test · No meaningful difference". Banned: "AI-powered", scores, probability theater.
9. **Guards (§5G):** Rust — deterministic order · every event carries a real source timestamp (no
   fabrication) · unknown stays Unknown · confounded refusal · identical sessions ⇒ no invented
   cause · insufficient samples ⇒ honest inconclusive · bands only (no numeric confidence) ·
   external changes never presented as Compy-applied. TS — flag-OFF byte-identical pin · honest
   empty states · reduced-motion via use-motion tokens · keyboard = native buttons · no capability
   diff.

## Data inventory (§5A)

**Live probes (verified, hardware.rs / lib.rs):** GPU driver identity on `GpuInfo`
(`driver_version`, `driver_date` ISO-8601-or-empty, `driver_age_days`); Windows build on
`WindowsVersionInfo` (build + UBR + display_version, hardware.rs:78-85); power plan via
`current_power_plan_name()` (lib.rs:110) — fn-callable from intelligence.rs, no command needed;
rig identity via `HwFingerprint {hash, gpu, gpu_driver, ram_gb, display}` (hardware.rs:2342) —
already stamped onto FPS sessions (monitoring.rs:1071) and Trust-Ledger views (`on_this_rig`).
**No installed-updates probe exists** — Windows-update events start at identity-snapshot zero.
Startup entries: live-only, no history. Drift: Tier A per-rec `is_still_active` (history.rs) +
Tier B `drift.json` first-seen timestamps (drift.rs:30-91) — both consumable as evidence.

**Persisted stores (verified per-module sweep, 2026-07-16):**

| Store | Shape / timestamps | Timeline value |
|---|---|---|
| `sessions.json` | `SessionSummary[]`, `started_at` RFC3339 UTC (no `ended_at` — derive from `duration_secs`), cap 100, <60s dropped; `hw_fingerprint` `#[serde(default)]` **carries `gpu_driver` per record**; `fps_series` kept last-20 only, `stutter_timeline` last-5; peaks (GPU temp/usage, RAM) per session | Session events + per-session driver/rig identity + thermal/memory evidence |
| `history.json` | `AppliedChange[]`, `applied_at` RFC3339 UTC, uncapped, atomic writes; **no rollback timestamp exists** (status flips only); `provenance` (`leftover_adopted`) on disk but dropped by `into_view()` — engine reads the persisted struct, so it CAN surface it; `hw_fingerprint` per apply | Apply events (rollback shown as state, never a dated event); config-change evidence |
| `gaming-session.json` | Single slot, **deleted on clean end** — no history; no `ended_at` field | No historical events derivable. Sessions don't record Gaming-Mode state either → hypothesis honestly Unknown (see decision 10) |
| `scoreboard.json` | `AwardEntry[]` append-only, `at` RFC3339 UTC, Keep-verdicts only | Verified-win events |
| `benchmark.json` | Single-slot baseline + `baseline_at` | Current-baseline event only (overwritten history is gone) |
| `compy_comparison_result.json` | **Single-slot latest only**, `at` RFC3339 UTC (Rust-side; TS mirror omits it — add), verdict judged on 1%-low, `expired`>14d, `confounded` via `ledger_watermark` | Latest comparison event; the engine reuses these exact semantics |
| `hardware-fingerprint.json` (hwchange.rs) | **No timestamps at all**, single overwritten baseline | Useless for the timeline; per-record `HwFingerprint` on sessions/ledger is the real source |
| `drift.json` | `noticed_at` first-seen RFC3339, self-pruning (only currently-drifting) | What-Changed evidence ("reverted outside Compy, first noticed `<date>`"), not permanent tape rows |
| blackbox.rs | **No persistence** — live per-call OS assembly (Event Log/WER); `Incident.when` is RFC3339 **local-offset, not UTC** | Crash events with genuine OS timestamps — offset-normalized to UTC, source-tagged `windows` |
| leftovers/latency/game_mode_persist/receipts | No persistence (receipts + keeper + preload + stack-trial gates DARK) | — |

**Decisions forced by inventory (append to §8.3):**

10. **`SessionSummary.gaming_mode_active: Option<bool>` `#[serde(default)]`** — sampled per tick by the
    monitoring loop (slot valid at ANY tick ⇒ true; a save-time-only probe would miss a Gaming Mode
    session that ended before monitoring stopped). Additive app-data field (NOT a Windows-mutation change);
    without it the "Gaming Mode state difference" hypothesis has no evidence source ever. Old records
    parse `None` → Unknown, honestly. Justification recorded here per the directive's
    strictly-necessary clause.
11. **Rollback honesty:** the ledger has no rollback timestamp → the timeline NEVER emits a rollback
    event (anti-fabrication guard pins this); the apply event's summary carries "(since rolled back)".
12. **Timestamp normalization:** all timeline ordering is on UTC-parsed datetimes (offset-aware
    RFC3339 parse), never string comparison — blackbox local-offset stamps are the proven exception.
13. **Fingerprint-derived observed events:** consecutive fingerprinted records (sessions ∪ ledger,
    time-ordered) whose `gpu_driver`/`gpu`/`ram_gb`/`display` differ yield an event stamped at the
    LATER record's time with explicit `observed_between` bounds — "observed between X and Y", never a
    fabricated occurrence time. Same-rig comparability uses gpu/ram/display (like `same_rig()`),
    NEVER `hash` (hash includes the driver — a driver update would break comparability exactly when
    attribution matters most).
14. **Identity snapshots record on app start** (spawned probe thread in `run()`, matching existing
    startup-probe pattern) **+ on each intelligence command call** — accrues even for users who never
    open the panels; cadence limitation (no mid-run polling) noted honestly.
15. **Tape additions stay non-duplicative:** Blackbook gains ONLY the event kinds no surface shows
    (observed hardware/driver changes + identity deltas). Awards, comparisons, crashes keep their
    existing surfaces; the tape does not re-list them in Train 1.

**FE map (verified):** rooms/flags/primitives per Agent-3 sweep — mount points and conventions as
cited in §7 above; IPC = direct `invoke<T>` with serde-mirrored types in `src/types.ts` (shared)
or co-located (single-use); flag pattern = `readX/applyX` (theme.ts) + hook (use-hud.ts) +
`compy:x-changed` event + flag test.

## Cross-refs (§9)

Evidence-export tiers + upgrade-path advisory → Intelligence Phase 5 (not this train). Pre-room
intent router: complementary, not part of this lane. Optimization Cleanup: data source + separate
lane; shared grading vocabulary (real/placebo/risky) unchanged. METHODOLOGY.md: this train adds no
new measurement definitions — the engine REUSES the noise-floor/confounded/expired semantics
verbatim, so no METHODOLOGY edit is required unless wording drifts (checked at doc-sync).
