# src-tauri — Rust module map (read-only half)

> **Auto-loads only when work touches `src-tauri/`.** The root `CLAUDE.md`, which every session
> loads, keeps the ★ index and `.rs` count, because knowing which modules are the safety boundary is a
> safety step and not a lookup. The ★ entries and `main.rs`/`lib.rs` core wiring live in
> `.claude/rules/rust-safety-boundary.md` (#479), which loads alongside this file. This file carries
> the read-only remainder.
>
> **Both halves are one map.** `node scripts/verify-module-map.mjs` reads them together and fails on
> a missing module, a ghost, a wrong file count, a module declared in both halves, or an unstarred
> module that writes Windows state. No gate runs it (its guard test was removed with the process guards
> in `397cfe72`, 2026-11-20), so run it by hand before trusting the map; a red result means the map is
> stale, not the tree. The 18 modules it found missing on 2026-11-23 were added that day. Files are
> counted by name, as the script counts them; the `.rs` file count lives in the root header,
> deliberately in one place so it cannot drift against itself.

Line counts drift — treat as rough and verify against current code before asserting.

### Rust module map — read-only modules (continued from the root `CLAUDE.md`)

**Hardware, sensors & detection (read-only probes)**
- `hardware.rs` (~3350) — `HardwareInfo` probe (CPU/GPU/RAM/storage/network); Rust↔TS serde contract.
- `cpu_temp.rs` (~1137) — HWiNFO shared-memory CPU-temp/fan read (SEH-crash risk noted in audit). GPU temp via vendor SDK elsewhere.
- `amd_freesync.rs` (~250), `overlay_tools.rs` (~230), `hwchange.rs` (~190) — FreeSync detection, overlay-tool detection, hardware-change tracking.
- `hw_class.rs` (~190) — tier-neutral pure hardware-class helpers (basename token / RAM bucket / GPU vendor token), extracted from Tier 2's receipts module per the Q9b contract §4 so Tier 2 and Tier 3 share exact vocabularies without a tier import. Imports no tier module; guarded by `src/case-evidence-tier-separation-guard.test.ts`.

**Monitoring, FPS & sessions**
- `monitoring.rs` (~1300) — monitor-tool orchestration + sensor coverage.
- `other_load.rs` — non-game load.
- `own_token.rs` (~20) — reads this process's own token; changes nothing. A leaf (no Compy module), so fps_pipe and monitoring reach the token without an edge into the store modules.
- `fps.rs` (~1092) — FPS/frametime IPC (`fps.json`/`fps.alive`) from the ETW helper.
- `sessions.rs` (~569) — session-summary persistence (`sessions.json`).
- `stutter.rs` (~135) — stutter/1%-low derivation.
- `fps_pipe.rs` (~817) — hardening slice 2 (F3): the capture helper's reports travel over a named pipe the APP creates (`\\.\pipe\compy-fps-<random>`, first instance only) instead of files the (usually elevated) helper wrote in the user-writable runtime folder.
- `session_boundary.rs` (~1005) — where one recorded session ends and the next begins: a session belongs to ONE process identity (image name + pid); a pure state machine the monitoring thread drives once a second, plus the read-only flag for a session that already swallowed two games.
- `running_at_start.rs` (~1266) — which KNOWN programs were already running when a session began, under an allowlist-only privacy rule (only programs in its reviewed table are named; anything else is counted, never named).

**Paramedic engine & the day-one answer (read-only; added to the map 2026-11-23)**
- `changes.rs` (~844) in `paramedic/` — F4b: turns the read-only change readers' report into evidence, candidates and "what Compy checked / couldn't see" lines; runs the readers once, off the UI thread, inside a time budget. An unread source is never "nothing changed".
- `extras.rs` (~324) in `paramedic/` — M3: the graphics card's peak temperature and the diagnosed game's crash history, as evidence, never a verdict ("overheating"/"throttling" are never said).
- `hardware_records.rs` (~200) in `paramedic/` — F7: when Windows wrote its hardware error records (WHEA-Logger 17/18/19) against the game's measured sessions, as one lead (Possible at most) with next steps and no action. Only the time of each record is read, never which part it names; an unread or uncovered log is "couldn't see", never "none".
- `mods.rs` (~299) in `paramedic/` — M3: graphics mods in the game's folder as evidence, from the mod detector's files-only read (it can never know a mod is loaded).
- `facts.rs` (~744) in `paramedic/` — the first look's "What looks off on this PC" facts (the readiness rules' pure verdicts, each a code and its numbers) and Compy's own dated changes, read without locking or repairing the ledger.
- `recovery.rs` (~954) in `paramedic/` — F3 "did it get better?": judged afresh from the game's next recorded sessions, never stored; a recovery supports or weakens a candidate, never proves one.
- `home_status.rs` (~166) in `paramedic/` — B1 Home truth: which games run rougher than usual right now, by the Paramedic's own judgement, from the session store alone (no Windows reads, no write).
- `tests.rs` (~6711) in `paramedic/` — the Paramedic engine's test module (numbers-only fixtures: no game names, paths or machine identifiers).
- `first_look.rs` (~2321) in `paramedic/` — the day-one answer (design M5): what changed on this PC around when it started, for the whole PC or one picked game, from Windows' own dated records; every row a dated fact at most `Possible`, nothing called a problem or a cause. Writes and stores nothing.
- `crash_split.rs` (~222) in `paramedic/first_look/` — S5: how many of the picked game's readable crash records fall before and after the earliest dated change; counts are "at least".
- `recorded.rs` (~243) in `paramedic/first_look/` — how many sessions Compy has recorded for the picked game; a failed read or an unmatched pick is "can't tell", never zero.
- `running_now.rs` (~178) in `paramedic/first_look/` — S4: which KNOWN programs are running right now (names-only snapshot, no process opened), under the same allowlist rule; a fact about now, not about when the game ran badly.

**Build plumbing & test support**
- `sys_exe.rs` (~1034) — hardening slice 1: the ONE place a Windows system tool is located and its child process built. A tool is named by a closed enum, never a string, and resolved to an absolute system path (std would search the app's own, user-writable folder first). Builds (never starts) the process; callers start it. Changes no Windows state, so unstarred.
- `test_scratch.rs` (~142) — test-only scratch folders under %TEMP% (D1d): a root no other run can reuse, created empty, removed on drop; a child path can never leave the root.

**Benchmark & Lab**
- `benchmark.rs` (~1330), `benchmark_trial.rs` (~615), `benchmark_verdict.rs` (~580), `benchmark_scoreboard.rs` (~460), `comparison.rs` (~686) — the Lab proving-ground bench: trials, verdicts, scoreboard, A/B comparison.
- `noise_floor.rs` (~447) — P4-noise-store: each game's own run-to-run noise on this PC, recorded by a Lab calibration (`noise_floors.json`, written through `atomic_write`) and looked up by a Trial conclude as Measured / Stale / Unmeasured. Never guesses a level it did not measure. Writes no Windows state.
- `latency.rs` (~2255) — input/network latency probes.
- `game_mods.rs` (~3000) - Paramedic M2: read-only detector for graphics mods in a game's folder (OptiScaler-style layers, ReShade, Special K, ENB, DXVK) by named files and DLL version strings; Unreadable/Partial are never "no mods"; not wired yet.
- `change_sources.rs` (~2250) - Paramedic F4: read-only dated change readers (driver installs, Windows Update, Steam game update, installed programs); Unreadable is never "no change"; not wired yet.
- `blackbox.rs` (~2150) — diagnostic black-box capture.

**Advisory, ranking & export**
- `recommendations.rs` (~970), `readiness.rs` (~1615), `priorities.rs` (~707), `diagnostics.rs` (~637), `leftovers.rs` (~1200) — recs catalog, gaming-readiness, priority ranking, diagnostics, leftover-cleanup advisory.
- `export.rs` (~1278) — evidence-pack / share-card export.
- `support_evidence.rs` (~931) — Q5 local support evidence: bounded, redacted-at-construction, on-disk only. No outbound surface (`src/support-evidence-outbound-guard.test.ts`); `record` swallows every error so it can never block a rollback.
- `case_intelligence.rs` (~4629) — **Compy Care Tier 1, DARK** (#220): the signed, pull-only PUBLIC-ADVISORY catalog and its pure local matcher. Its OWN Ed25519 trust root, separate from remote-rules. DOWNLOAD-only — it uploads no machine data, so it is advisory, not an outbound *send* path like Tier 2 — and it cannot represent a command, registry path, action id or regex. `case_intelligence_gate()` is hard-false and `CASE_CATALOG_ENDPOINTS`/`CASE_CATALOG_ORIGINS` are EMPTY. Full contract (trust-root separation, transport shape, cache, arming move): `docs/CARE_TIER_MODULE_CONTRACTS.md` §1.
- `case_evidence_upload.rs` (~1735) — **Compy Care Tier 3, STAGE 1 ONLY, DARK** (Q9b, #252/#259): the PURE half of explicit per-case evidence upload — the §2 allowlist struct, its own six-class redactor (a deliberate §4 duplicate of `support_evidence`'s, never an import), and ONE canonical serializer the preview shares. NO command, NO HTTP, NO endpoint, NO consent state, NO queue; `case_evidence_gate()` is hard-false. Full contract (redactor residuals, §4 never-imports list, guards, arming move): `docs/CARE_TIER_MODULE_CONTRACTS.md` §2.
- `incident_observer.rs` (~1267) — **Compy Care Tier 1, plan task 9:** the persisted LOCAL incident observer — three named scan moments (launch / main-window foreground / session finalized), **no timer, service, scheduled task, watcher or poll**, one atomic JSON file, at most one WHAT-and-WHEN toast per scan. Opens no network path of its own and is NOT a mutation boundary. Full contract (throttle, identity reconciliation, DTO limits, commands, guards): `docs/CARE_TIER_MODULE_CONTRACTS.md` §3.
- `tray.rs` (~177) — system-tray integration.

**Intelligence & Measurement Platform (read-only, additive — no mutation markers, verified 2026-08-02)**
- `machine_model.rs` (~1494) — Phase 2 (#385): the shared Machine Model. Composes ONE read-only `Fact<T>` view (value + evidence class + source + honest unknown) from the producers above; owns no store and probes nothing itself. Reports identity disagreement, never resolves it.
- `intelligence.rs` (~3614) — Phase 1: canonical intelligence types, local event timeline, deterministic "What changed?" engine. READ-ONLY by doctrine; never mutates Windows, never networks.
- `paramedic.rs` (~1500) — PC Paramedic, READ-ONLY.
- `intelligence_patterns.rs` (~903) — Phase 2: cross-session pattern detection over `sessions.json`.
- `experiment.rs` (~1420) — Phase 3: single-variable experiment engine + optimization simulator. **ARMED** (`experiment_gate()` returns true, owner sign-off 2026-07-17) — the bench renders live. It APPLIES via `history::apply_recommendation`, so an already-active rec simulates to `already-configured`; do not route a rollback-shaped next test here.
- `trial_candidates.rs` (~710) — P4-candidates/rank: read-only Trial picker filter + test order (ENGINE §3.1–3.7), one reason each.
- `realplay.rs` (~1400) — P5-realplay: pure judge (which sessions count, looks at 3/5/8, the Trial's own band). No I/O, lock or Windows state.
- `component_evidence.rs` (~332) — Phase 4: component-level evidence attribution. READ-ONLY.
- `comparability.rs` (~730), `game_state.rs` (~276), `capture.rs` (~279) — Measurement Platform 2.0 tasks E/F: session-comparability gate, conditions fingerprint, capture-backend/capability model.
- `fuzz_support.rs` (~184) — test-only input generator for the property/fuzz suites.

**Secondary state persistence**
- `data_clear.rs` (~1410) - D4-2: "Clear my data", the planner and the executor. `plan_clear` (pure: reads the folder listing and the ledger, changes nothing) returns exactly what would be deleted, what is kept and why, which files Compy did not create (kept, reported), and why a clear is refused; `execute_clear` re-plans, refuses on any change since the plan, then deletes exactly that list file by file and reports each failure (never as success). Every deletable name comes from `data_inventory.rs`; nothing here removes a folder or the data root (a missing root would re-arm the legacy `Sentinel` copy-in). Clear play history never touches `history.json*`; the two live wrappers are NOT registered as commands yet (UI/relaunch slice) and Clear everything has the core but no wrapper (D4-3). Deletes only files inside the data root, never through a link. Unstarred: it changes no Windows setting.
- `data_inventory.rs` (~1270) - D4-1: the inventory of everything Compy stores (64 rows: path, writer modules, category, personal data, how it is created, sandbox effect; plus the page's 67 browser-storage keys). DATA ONLY: no command, no I/O, no deletion; first readers are the Clear-my-data commands (D4-2/D4-3). Kept complete by `scripts/data-root-guard.test.mjs` (a new file name written without a row fails the gate; a row nobody writes fails it). Writes nothing, so unstarred.
- `win_handle.rs` (~84) — handle-bound file checks and deletes (moved out of the Clear-my-data module in hardening slice 2): open a file once, ask the HANDLE where it really is, delete through that same handle. Used by the Clear-my-data executor and by the elevated helper's ticket consume. Deletes only the file it was handed; changes no Windows setting, so unstarred.
- `install_location.rs` (~191) — A3: records where this compy.exe runs from (`user_folder` on today's per-user install) and whether an old per-user copy is still installed for the account. Reads two known folders and one HKCU value; writes nothing but one support-log line per launch (fixed words, no path).
- `atomic_write.rs` (~447) — whole-file byte replacement (temp in the target's own dir → rename) for the SECONDARY stores: benchmark, comparison, readiness dismissals, drift, and the license token — which is signed plain text, not JSON, so its exact bytes pass through unserialized. An interrupted save leaves the previous complete file instead of a truncated one that every loader reads as "no data". **NOT power-loss durability, NOT a lock, NOT a transaction** — the module doc says so and the tests prove only a named interruption point. Writes no Windows state, so unstarred. Deliberately NOT used by the Trust Ledger or the signed remote rules; the module doc says why (there, not here, because this map's halves must stay disjoint).
