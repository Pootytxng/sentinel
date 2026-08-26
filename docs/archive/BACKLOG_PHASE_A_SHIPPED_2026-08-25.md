# BACKLOG — PHASE A closed rows, archived 2026-08-25

> Moved VERBATIM out of [`docs/BACKLOG.md`](../BACKLOG.md) §PHASE A for the byte budget
> (`scripts/doc-budget.ps1`). All 60 rows below were already `[x]` — closed, not deferred and not
> dropped. Nothing here is a live commitment; the live PHASE A rows stayed in the ledger.
>
> **This is a point-in-time record.** Every `file:line` in it was true when the row closed and may
> not be now. Current gate/build truth is [`docs/RELEASE_STATE.md`](../RELEASE_STATE.md).

- [x] Reconcile + prune the stranded branches; confirm `main` is the single product truth — done 2026-06-24e: pruned `spike/backend-agent`, `benchmark`, and the two no-op-redundant safety branches (`qa/locale-drift-hardening`=#6, `gaming/honest-partial-undo`=#7, both already in main); the 3 remaining unmerged branches are deliberately-superseded archives. `main` IS the single product truth.
- [x] Adopt this ledger as the persistent-workflow target — the HQ STEERING LOG (top) is the live per-cycle target; `/loop` + scheduled HQ sessions drive off it.
- [x] core-parking state (policy/registry + powercfg) — `hardware.rs`, `lib.rs:288`
- [x] XMP/EXPO active — ✅ DONE + GUARDED (audit 2026-08-03): honest "running below rated", never
  claims "profile active" — `mem_speed_status` `hardware.rs:511`, surfaced via `xmp_expo_status`;
  guards `hardware.rs:3176` `mem_speed_status_is_honest` + `HardwareGrid.test.tsx:92`.
- [x] Hyper-V / VBS / SVM virtualization — `hardware.rs:1078`, `diagnostics.rs:126`
- [x] S.M.A.R.T. drive health — `hardware.rs:329`
- [x] USB device/lane tier — `hardware.rs:1148`
- [x] firmware/BIOS date check — `hardware.rs:1027`
- [x] driver-freshness all vendors + copyable URLs — `hardware.rs:1321`, `Check.tsx:49`
- [x] NIC driver freshness — `get_nic_driver_info`, `Check.tsx:262`
- [x] benchmark before/after comparison (armed) — `comparison.rs:120`, `benchmark_trial.rs:238`
- [x] baseline set/clear — `benchmark.rs:940`
- [x] cross-session comparison — `comparison.rs`, `sessions.rs:212`
- [x] session history with hardware snapshot — `sessions.rs:35` (`hw_fingerprint`)
- [x] drift-regression advisory — `drift.rs`
- [x] local award/score ledger — drill-down UI: each award expands to its full certified receipt (rec_id handle + metric + 95% CI + points + timestamp) from the existing get_scoreboard data — `260f943`
- [x] persist a real DOWNSAMPLED fps-over-time series per session — `fps_series: Vec<(u32, f64)>` additive `#[serde(default)]` on `SessionSummary`: per-10s-bucket MEAN of the real ~1 Hz samples, real elapsed-secs x-axis (gaps in play stay gaps, never interpolated), capped 2160 points (6 h), kept for the most-recent 20 sessions and stripped on save for older; TS contract mirrored (`types.ts` `fps_series?: [number, number][]`). 5 guard tests pin bucketing math, gap honesty, the cap, pre-series serde-default parse, and the strip window. Unblocks the site ReplayHUD real trace + an honest in-app session chart (neither wired yet — no UI renders it in this train). Read-only/additive, no mutation boundary — `sessions.rs`, `monitoring.rs:984`
- [x] **draw `fps_series` — the trace is persisted and nothing renders it** (#49 deviation 3, 2026-08-24). The four-room brief asked Live to show a past session’s shape. The row above already persists exactly that (per-10s mean, real elapsed-secs x-axis, most-recent 20 sessions), but `grep -r fps_series src/` returns the `types.ts` declaration and nothing else: no component reads it, so a past session still renders as summary numbers with no curve. **Not a storage change** — the data is on `SessionSummary` today. Needs a sparkline that honours gaps (never interpolate) and says “no trace kept” for a stripped older session instead of drawing a flat line — `types.ts:179`, `sessions.rs` **BUILT and REVIEWED.** `FpsTrace` (`src/design/FpsTrace.tsx` + `.css`) draws it from `traceGeometry` (`geometry.ts`), mounted in `SessionDebrief` between the summary tiles and the analysis. Three honesty properties, each falsified by an injected defect: a missing bucket ENDS the run, a gap-isolated sample becomes a dot, and the value axis is anchored at 0. Empty series renders “No trace kept for this session”, never a flat line at zero. 22 guards (`geometry.test.ts`, `FpsTrace.test.tsx`), en + zh-CN copy, a11y + mono censuses updated. **CLOSED 2026-08-24 — `self-review` PASS, round 18** on the installed `ccc17355`. Gap-ends-run and the 0-anchored axis proved ON SCREEN; **the dot case was not** — no real session here has a gap-isolated sample, so it stays proved in `geometry.ts` alone. Detail: `RELEASE_STATE.md`.
- [x] hardware-tier segmentation — LOCAL Entry/Mid/High band on the Benchmark surface from measured VRAM·cores·RAM (inputs named); reuses the canonical rig-tier bands via pure `benchRigTier`; like-to-like framing, no cohort/network — `372bde1`
- [x] percentile display — wired `percentile_rank` as a LOCAL display-only stub: each verified win ranked within the cohort of ALL the user's own wins (the scoreboard ledger), shown as "Top X% of your verified wins" in the award drill-down, labeled "local — no peer cohort yet"; gated below a 4-win floor; never persisted. Peer/cohort percentile stays Phase C gated — `0de96f0` (`benchmark_scoreboard.rs:63`)
- [x] CPU-runner flake fix (backend lane flagged) — `cpu_kernel` now guarantees ≥1 work chunk (do-while) so a starved tiny-run scheduled past its short deadline still measures real throughput instead of reading 0 and false-failing the shared green baseline; strong `> 0.0` shape assertion kept + a regression guard (`cpu_kernel_runs_at_least_one_chunk_past_deadline`) pins the contract; `benchmark.rs`, cargo 612
- [x] `normalize()` honesty fail-safe — a non-finite raw score now fails SAFE to 0 (no credit) instead of `Inf`→`.clamp(0,100)`→**100** (a fabricated "perfect" component score, the worst honesty failure). Currently unreachable (producers guard divisors via `.max(1e-6)`/`is_finite`) but guarded at the point-of-use so a future producer-guard regression can't invent a maxed score; invalid reference (non-finite/≤0) also → 0. Regression test pins Inf/NaN/-Inf + bad refs (was untested); real-path byte-identical — `2ee51aa` (`benchmark.rs:461`)
- [x] `completeness_pct()` honesty fail-safe (completeness-critic close-out of the above — the grep'd sibling) — its `ceiling <= 0.0` gate did NOT catch a non-finite input (`NaN <= 0.0` is false), so `+Inf current`→**100** (fabricated "fully optimized") and `NaN`→leaked through `.clamp()`. Now `is_finite` guards both inputs at the point of use, mirroring `normalize()`, so the boundary is uniform + safe-by-construction whenever this still-unwired primitive is wired. comparison::pct (guarded `base>0`, measured-FPS inputs, NaN-delta failure mode) + percentile_rank (u32-derived inputs) assessed safe — class now closed. Regression test pins Inf/NaN; finite-input behavior byte-identical — `dbc8358` (`benchmark_scoreboard.rs:75`)
- [x] **FPS presenter picker: desktop apps winning between matches — FIXED this cycle (0.9.1).**
  Live §6 evidence 2026-07-22 (40-min Marvel Rivals watch) showed the dominant-presenter pick
  wandering to Discord/RadeonSoftware/Code/claude while the game sat closed/loading. Fix is
  positive window evidence + sticky attachment (`fps.rs`): acquisition now requires the candidate
  to own a visible top-level window, be foreground, AND cover its monitor's full bounds (excludes
  the whole windowless-Electron-GPU-process class structurally, no per-app denylist entry needed)
  for `ATTACH_STREAK_TICKS` consecutive ticks; once attached, only that pid is ever reported and a
  silent tick (menu/loading) emits nothing rather than re-picking — never abandoned for a chattier
  presenter, released only when the process actually dies/recycles. `monitoring.rs`'s FPS recorder
  gets a matching freshness gate (<3s mtime) since `fps.json` can now legitimately sit frozen.
  9 new attachment-state-machine tests. cargo 869/869.
- [x] **fps.rs pid-recycle re-check on the "still presenting" path — ✅ FIXED (Q3 of the stabilization
  program).** 0.9.1 review Warning (rust-tauri reviewer, 2026-07-22): `Attachment::Attached`'s
  frames-present arm never re-verified that the pid still mapped to the attached image; only the
  silent-tick arm called `alive(pid, name)`. So the one case that produces a wrong measurement — a
  recycled pid that is actively PRESENTING — was the one case that never reached the check, and real
  frametimes were reported under the dead game's name into `sessions.json`, comparisons, the
  scoreboard and every export. The audit under-stated it: the arm also filtered candidates by pid
  ALONE and reported the STORED name, so a recycled pid arriving under its new ETW-resolved image
  name was still attributed to the old game. Fix: candidates must match pid AND name; `alive` is
  consulted on the frame path as well as the silent one; and a pid presenting under a foreign name is
  treated as a recycle (release) rather than a loading screen (stay attached). Three red-first guards
  in `fps::attachment_tests` — recycle-while-presenting, foreign-image-name, and replacement must
  re-earn the full streak — plus one pinning the ordinary live case. Mutation-proven in both
  directions: dropping the liveness clause fails 1, dropping name matching fails 2. `cargo test
  --lib` 874 passed · clippy `-D warnings` clean.
- [x] entry dedup lint — `knowledge.lint.test.ts:78`
- [x] category + **hardware tags** on entries — **DONE**. Category: `knowledge-topics.ts` central id→topic map, 10 topics, required `BaseEntry.topic` + lint + Learn "Topic:" filter (`cf77e0b`). **Hardware tags DONE**: `Applicability` enum (AMD/NVIDIA/Intel/laptop/desktop) + central optional `APPLIES_BY_ID` map in `knowledge.ts` (absent = universal), `applies?` on entries, lint validity/completeness guards, Learn "Fits:" filter + per-card tag pills (read-only/advisory; self-reviewed). Topic + applicability labels flagged for owner taxonomy skim.
- [x] date-added / last-updated metadata — **DONE**. Optional central `DATES_BY_ID` map in `knowledge.ts` (id→`{added, updated?}`, ISO YYYY-MM-DD; absent = no date shown, never fabricated), `added?`/`updated?` on `BaseEntry` via a `withDates` pass, `formatEntryDate` TZ-safe "Mon YYYY", lint guards (real ids, well-formed dates, updated≥added), quiet Learn card footer line (read-only/advisory; self-reviewed).
- [x] filter-by-category + verdict UI — `Learn.tsx:578`
- [x] alias-collision lint + CI guard — `knowledge.lint.test.ts:98`
- [x] deprecated/superseded status field — `status` + `supersededBy` on BaseEntry + `lifecycle()` mapper + lint guard (real/different target) + honest Learn surfacing (`aedb3ab`)
- [x] orphaned-`related[]` lint — `knowledge.lint.test.ts:84`
- [x] Autopsy structured schema — versioning/migration added to the PERSISTED store: `autopsy-ledger.ts` now writes a versioned envelope `{ v, entries }` + `migrateLedger()` (forward-only, idempotent, lossless) carries the legacy bare-array form forward and seams in per-version upgrades for future field changes; +10 tests. The transient `AutopsyResult` (`knowledge-autopsy.ts:15`) is recomputed from re-graded text each session (never persisted) → nothing to migrate there (`3e16618`)
- [x] Autopsy "what did we learn?" rollup — `autopsy-ledger.ts`, `Learn.tsx:453`
- [x] local autopsy stats — `autopsy-ledger.ts`, `local-stats.ts`
- [x] Setup-Complete state machine — `FirstCheck.tsx`, `Onboarding.tsx`
- [x] post-apply verification gate (re-run probes) — `use-scan.ts`, `Check.tsx:293`
- [x] green/yellow/red confidence chips (color-coded) — `Check.tsx:298`
- [x] exportable setup summary — dedicated "Setup summary" card in Check (`buildSetupSummary` in `use-scan.ts`, copy-to-clipboard, read-only/advisory, zero IPC)
- [x] Re-Run Setup / re-baseline flow + overflow handling — `useHardwareChange` hook owns detect→acknowledge ("this is my rig now"); `summarizeHardwareChanges` caps change lines to "and N more" so a big multi-part swap never floods the card (`use-hardware-change.ts`, `Check.tsx`)
- [x] **hardware-change detection** — wired into Check (Optimize→Fixes): advisory card names what changed + inline acknowledge/re-baseline (`acknowledge_hardware_changes`) so it never nags; live-verified 2026-06-24
- [x] override toggle — "Restore all (N)" bulk control in the Dismissed strip (Fix.tsx, ≥2 dismissed, reversible, zero IPC)
- [x] drift-watch integration — `drift.rs`, `Check.tsx:325`
- [x] historical-ledger surfacing — `Fix.tsx:712`
- [x] applicability check + override — eligibility filter + A5 override: "My hardware supports this" on capability-gated recs in the Not-for-this-rig pile; rec rejoins the normal flow through the SAME audited apply path; reversible, decision kept on record ("overridden by you" + Compy's original read + "Set aside again"); localStorage pref (`eligibility-override.ts`), zero IPC — `c6c00a4`
- [x] obsolescence/superseded flags + supersession CHAIN — pure `supersessionChain()` (cycle-safe, missing-target-safe) resolves transitively; Learn's superseded note links the CURRENT end of the line + names multi-hop paths; corpus lint pins chain termination — `d060b07`
- [x] before/after delta display — full pair everywhere: TrustSnapshotLine appends " · set to <after>" ADDITIVELY (locked kernel-§6 sentence verbatim, test-pinned); Fix + CommandCenter pass the typed applied_label — `2f5b675`
- [x] "last seen working on" hardware tag — AppliedChange stamps `hw_fingerprint` at apply time (ONE receipt funnel covers all paths); `on_this_rig` computed driver-INsensitively (gpu·ram·display); history receipts + active cards show "Last seen working on <gpu · ram> — before your hardware changed"; legacy entries stay honest "rig unknown" — `2f5b675`
- [x] per-tweak audit trail — `Fix.tsx:423`
- [x] ledger filter "this rig only" — History checkbox, rendered only when some entry is KNOWN to be from other hardware; hides exactly those (legacy unstamped rows never hidden); hidden count named — `2f5b675`
- [x] measured-payoff linkage — per-tweak honest payoff meter: `payoff_label_from_action` (history.rs) names the KIND of gain (input latency / background CPU&RAM / network / power&thermal / …), never a fabricated number; rendered as a quiet advisory chip on active + history ledger rows (Fix.tsx)
- [x] pre-room intent router (BACKLOG:916) — **DONE, then SUPERSEDED.** Built 2026-07-18 as the Home
  intake band behind `compy_home_intake`; the owner removed it on sight 2026-08-12, and it was
  **deleted** 2026-08-20 when the **interview** (issue #177, design foundation ③) took over the same
  intent gap: one question per screen in a Sheet behind Home's single primary button
  (`src/surfaces/HomeInterview.tsx` ← `home-interview-data.ts`, flag `compy_home_interview`, default
  ON, `"0"` failsafe, Settings → Behavior toggle). Full band history — option A/C greenlight, the
  declined door-level hints, the one-owner stand-down, the self-reviewer PASS — moved to
  [BACKLOG_ARCHIVE.md](../BACKLOG_ARCHIVE.md#2026-08-20--pre-room-intent-router-the-intake-band-superseded-by-the-interview).
- [x] basic-mode simplification — SCOPE-CHECK FIRST, build only what's missing: FirstCheck's one-verdict
  flow + verdict cards + the answer-first Home already cover most of "one screen, one verdict, one
  action"; audit that flow against the panel's basic-mode ask and close only genuine gaps (no parallel
  "simple mode" build). Provenance: panel-review brief 2026-07-15 §4.8. *(2026-07-17, intelligence
  directive §9: complementary consumer-clarity work — stays queued, NOT demoted.)*
  **Scope-check done, 2026-07-16 (Cowork), against `FirstCheck.tsx`, the persona's 5-point ask:**
  (1) one verdict — **covered** (`fc-verdict` headline). (2) one recommended action — **covered**
  (#1-limiter spotlight, single Apply button). (3) one visible explanation of *what changes* —
  **partial**: the spotlight shows `top.reason` (why it's a limiter) but nothing on this screen
  states the actual before→after value. (4) one visible explanation of *how it's restored* — **real
  gap**: "Compy snapshots the prior state so you can roll this back anytime" only appears inside the
  confirm-dialog you see AFTER clicking Apply, not as a standing line on the verdict card itself — a
  user who doesn't click Apply never sees it. (5) one next-step-after-playing — **covered** (footer:
  "Play something tonight; the session debrief will tell you..."). Net: this is a small, well-scoped
  copy/layout addition (surface the restore-guarantee line + a plain what-changes line on the
  existing verdict card), not a new flow.
  ✅ CLOSED 2026-07-18. Gap (4) FIXED: the restore-guarantee now renders as a **standing line**
  on the #1-limiter spotlight card (`.fc-spotlight-reversible`, `FirstCheck.tsx`), gated on
  `recFor(top)` (only when there's an applyable fix — a hands-on fix has nothing for Compy to roll
  back), with the ↺ mark in `--ready`. Same true promise as the confirm-dialog body (LOCKED rule 3
  makes it honest); appears before any Apply click. Gap (3) before→after value **intentionally NOT
  built** — `PriorityItem`/`ScanRecLite` carry no such value on this surface, so a stated value would
  be fabrication (no-fabrication law); the existing `top.reason` + "Expected impact · not yet measured
  on this rig" chip already give the honest what/why. bug→guard: `FirstCheck.test.tsx` "surfaces the
  restore-guarantee as a standing line" (4/4 green). Self-reviewer PASS (contrast 6.16:1 muted /
  10.22:1 mark, 12px gap no overlap, no duplication). tsc clean.
- [x] hardware-limited verdict detection (GPU≥95% / HDD install drive) — `priorities.rs:95`
- [x] `build_upgrade_path` single source — `priorities.rs:106`
- [x] session-qualified copy — `priorities.rs:109`
- [x] copy-only buttons (no URL opener) — `Check.tsx:207`
- [x] plain retailer links (no tags) + disclosure — `priorities.rs:81`
- [x] markdown-export anchors — independently tested: anchor-format integrity for EVERY RetailLink (count parity, well-formed Markdown, https-only, export-layer tracking-marker ban mirroring the priorities guard) — `2f698e4`
- [x] test "no tags + disclosure always paired" — comprehensive affiliate/tracking guard over ALL retail links (const tables, 12 markers, https-only) + single-item disclosure pairing locked (`priorities.rs` tests)
