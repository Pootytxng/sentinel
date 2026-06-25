# Compy — Living Backlog Ledger

> **Why this file exists.** Persistent workflows (`/loop`, `/schedule`) kept declaring "genuinely
> finished, standing by for verification" while real product work remained. Root cause: there was no
> *machine-readable* checklist — completed work lived in CLAUDE.md victory-lap banners and scattered
> `*.REPORT.md` prose, so a waking session read "X landed, all green," found no open thread, and
> stopped. **This file is the canonical open/closed ledger.** Source of *priority* = the roadmap
> (`docs/superpowers/plans/2026-06-21-roadmap-sequencing.md`, Cowork's strategy lane). This file only
> tracks *status*, verified against code on `main` — not against banners.
>
> **Status anchored to `main` @ `47e93e6` (2026-06-23 audit).** Verified by a 5-agent read-only sweep of
> the actual source tree, not commit messages.

---

## 🛰️ HQ STEERING LOG — live lane board (newest on top)

> Maintained by the HQ/steering session. Anchored to live `main`, not banners. Lanes: read your row,
> stay in your file domain, rebase onto `main` before every push.
>
> **🚌 Live per-lane QUEUES + the cross-lane MESSAGE BUS now live in [`docs/LANE_BUS.md`](LANE_BUS.md).**
> Lanes: run your `/loop` (LANE_BUS §②) and **self-continue** through your queue — never stop to "await
> direction." This STEERING LOG keeps the integrate-verify history; LANE_BUS holds the live work distribution.

### Cycle 2026-06-25a — LANE BUS established (owner ask: lanes self-sustain + coordinate)
**Owner ask:** a lane ("Tab 2") was stalling "awaiting direction from steering"; make lanes able to communicate +
prompt one another to continue to the next task after completion → sustained autonomous workflow.
**Built `docs/LANE_BUS.md`:** (1) a **self-continuation protocol** every lane runs — after finishing an item it
rebases, pulls the next item from its queue, and continues; the only valid "wait" is a *posted* `queue dry` request,
never a silent stall. (2) A **per-lane queue** (backend · measurement · peripheral · content · honesty) with disjoint
file domains + deep runway from the open A4/A5/A3 items. (3) A **claimable pool** (Monitor/Display, GPU-advisory,
etc.) lanes grab via the message log so two never collide. (4) An append-only **message bus** for cross-lane
hand-offs / dependency signals / refill requests. (5) **Collision rules** (disjoint domains, only backend edits
`lib.rs`/`actions.rs`, honesty claims shared files, rebase-before-push, merge-tree no-op check).
**Mechanism (honest):** separate sessions can't wake each other → the channel is this file via git + each lane's
`/loop`. **OWNER ACTION to activate:** paste the §② `/loop` prompt into each lane tab once (esp. the stalled
`measurement` tab). `main` @ `02f9d1b` green (cargo 582 · vitest 565 · build ✓); docs-only change, no code touched.

### Cycle 2026-06-24f — `main` @ `1648c00`+ · integrated tree GREEN (measured)
**Two pushes integrated + verified** (counts re-RUN, not assumed): `lane/honesty` → LOCKED-rule-5 fix —
vendor-gate NVIDIA GPU temp in **Overlay + LiveCharts** onto the one-source `gradeGpuTempForVendor`, + a
class-wide `gpu-temp-gate-guard.test.ts` that fails if any `.tsx` calls `gradeGpuTempC` bare (`8355c4e`);
backend/ledger → A5 **true before→after delta in the Trust Ledger** (pure `applied_label_from_action()` in
`history.rs`, read-only, exhaustive match so a new catalog action can't silently mislabel) (`1648c00`).
Both read-only, no IPC/capability/mutation. **Verify:** cargo **582** · vitest **565** (94 files) · `npm run build` ✓.
Also this turn: merge-tree no-op guard added to the protocol (§5) + memory [[branch-redundancy-detect-by-mergetree]].

### Cycle 2026-06-24e — branch-redundancy CORRECTION (honesty fix to this ledger)
**Trigger:** owner greenlit landing `qa/locale-drift-hardening`. Setting up the isolated merge, the result tree was
**byte-identical to main** (`git diff main HEAD` = 0 lines) → its rollback-safety fixes are **ALREADY IN MAIN** via
PR #6 `5ab304d` ("fail-safe refuse instead of fabricating rollback snapshots across the mutation boundary, 5 paths").
`git cherry` showed `+` only because the PR landed under different hashes. Same for `gaming/honest-partial-undo` →
**already in main** via PR #7 `47e93e6` (no-op merge). **Both were redundant, not stranded.** My earlier
"🔴 stranded safety work needing owner sign-off" framing (cycles a–d, and the branch-health note) was **WRONG** — lanes
merge via PRs, leaving same-content branches behind by hash. The "always clean-merges" signal I kept citing was clean
*because* it was a no-op.
**Actions:** discarded the no-op merge + its worktree; **pruned `qa/locale-drift-hardening` + `gaming/honest-partial-undo`**
(content proven 100% in main, reflog-recoverable). Completeness sweep — the 3 remaining unmerged branches DO carry real
divergent content, stay archived (do NOT land): `feat/a1-detection` (~666 lines, 4-probe superseded by 7-probe),
`latency-capture` (~196, overlaps `latency.rs`), `tests/coverage-sweep-2026-06-18` (~410, value already folded).
**🔧 Cargo-count CORRECTION:** main is **580** (measured directly this cycle), not the **566** I carried in cycles c–d.
That 566 was assumed from a truncated capture + a commit message and NOT re-run — cycle d's "verified, not assumed" was
itself inaccurate. The real count rose 566→580 at cycle b when `services.rs` landed and never dropped back. (vitest 564, build ✓.)
**New lane:** `lane/honesty` worktree spun up (`C:/Users/Kuya/code/sentinel-honesty`, synced to main, no work yet).
**Net:** the rollback-safety property the owner greenlit is already shipped — nothing to merge; ledger now matches reality.

### Cycle 2026-06-24d — `main` @ `327cc87` · integrated tree GREEN
**Two more frontend/data pushes:** content → A4 **monitor motion-clarity explainers** (strobing/ULMB, overdrive,
GtG-vs-MPRT) in `terms.json` +24 (`6d41137`); agent → A4 Peripheral **plain-English polling-rate class** on the
mouse card (`Latency.tsx`/`latency-view.ts`, `327cc87`). Disjoint, read-only/advisory, zero src-tauri/IPC/capability.
**Integrate-verify:** vitest **564** / `npm run build` ✓; cargo unchanged at **566** (no `src-tauri` diff since the
565d94b run — verified, not assumed). **Lane heartbeat:** content + agent actively shipping; **`work/bench` now 16
behind, still no push — bench's A2 tier-segmentation looks stalled (2 cycles).** Owner items unchanged
(`qa/locale-drift-hardening` clean-merge gated; brand-voice skim now spans 6 new Learn debunks).

### Cycle 2026-06-24c — `main` @ `565d94b` · integrated tree GREEN
**Two more pushes integrated:** content/knowledge → A4 **color-science debunks** (sRGB-clamp, gamma-vs-HDR,
chroma-subsampling) in `terms.json` +24, zero `Learn.tsx` change (`113a2d7`); Phase-B → **service-suspend
dark-contract test** (`gaming_orchestrator.rs` +95, `docs/SERVICE_SUSPEND_QA.md`) proving the gate stays false
(`565d94b`). **Integrate-verify:** cargo **566** (exit 0) / vitest **562** (a transient teardown-race "2 errors"
cleared on rerun, not a failure) / `npm run build` ok.
**Gate re-check:** `service_suspend_gate()` returns `false` in prod (only `#[cfg(test)]` thread-local opens it,
compiled out of shipped binary; pinned by `gate_is_dark_until_qa_and_owner_signoff`) — **Phase B still DARK.**
**Owner items:** (1) `qa/locale-drift-hardening` still review-ready/clean-merge (rollback-safety, gated);
(2) content lane flagged the 3 new debunks for a brand-voice skim (`113a2d7`). Content shipped an A4 item, so
its A3 **entry-metadata** assignment stays open. No new branches to prune; frozen refs (`16069fa`) untouched.

### Cycle 2026-06-24b — `main` @ `2eb336a` · integrated tree GREEN
**Two lanes shipped + verified together:** backend → A4 read-only **service inventory by category** (new
`services.rs` +465, `diagnostics.rs`, `lib.rs` +1 — `b5b16b0`); agent → latency **timer-resolution range** +
fmtMs/severity tests (`234115c`, `7f93f28`). Disjoint (`services.rs`/`diagnostics.rs` ⟂ `Latency.tsx`/`latency-view.ts`;
`lib.rs` touched once). **Integrate-verify:** cargo **580** · vitest **562** · `npm run build` ✓.

**HQ read-only audit of `services.rs`** (mutation-adjacent module, so audited at source, not just by green tests):
WMI `SELECT Name,DisplayName,State,StartMode FROM Win32_Service` only — no `ExecMethod` / `OpenSCManager` / `sc` /
PowerShell / registry-write / process-spawn; `lib.rs` +1 = `mod services;`; surfaced via diagnostics.rs's EXISTING
command (no new IPC); no capability/CSP change. Verdict: **read-only — Phase-B service-suspend boundary NOT crossed.**

**Next assignments (still disjoint; only backend likely edits `lib.rs`):**
- **backend/readiness** → A4 Services **service-drift detection** (extend Leftovers — read-only advisory, builds on the inventory just shipped). *(curated safe-to-suspend list stays owner-gated.)* Domain: `services.rs`/leftovers + `lib.rs` reg.
- **agent/peripheral** → A4 Peripheral **wired-vs-wireless latency model** (STILL OPEN — agent did timer-res this cycle instead). Domain: `latency.rs` + `Latency.tsx` / `latency-view.ts`.
- **bench/measurement** → A2 **hardware-tier segmentation** (unchanged — no push this cycle). Domain: `benchmark_scoreboard.rs` + `Benchmark.tsx`.
- **content/knowledge** → A3 **entry metadata** (unchanged — no push). Fresh branch off `main`. Domain: `knowledge*.ts` + `Learn.tsx`.

**Owner-gated (unchanged):** `qa/locale-drift-hardening` re-verified **still merges CLEAN** onto `2eb336a` (4 ahead / 35 behind) — review-ready, merge owner-gated. No new branches to prune; frozen refs (`16069fa`) untouched.

### Cycle 2026-06-24a — `main` @ `b90bd1d` · integrated tree GREEN
**Integrate-verify (merged agent + bench push):** cargo **566** · vitest **558** · `npm run build` ✓ (only the
pre-existing >500 kB chunk advisory, not a regression). Agent (`Latency.tsx` / `latency-view.ts`) ⟂ bench
(`Benchmark.tsx`) — disjoint files, clean compose.

**Lane assignments (disjoint file domains — only the backend lane edits `lib.rs` this cycle):**

| Lane | Next item (non-gated) | File domain | Keep OUT of |
|---|---|---|---|
| **backend/readiness** | A4 Services → real **read-only service inventory by category** (expand the 4-service stub at `history.rs:118`). *(curated "safe-to-suspend" list = owner-curated/gated — NOT this)* | `src-tauri/{history.rs, new svc module, lib.rs reg}` | `actions.rs`\*, `benchmark_*`, `latency.rs` |
| **bench/measurement** | A2 → **hardware-tier segmentation** (budget/mid/high LOCAL mapping; wire the unwired `percentile_rank`). *(cohort percentile = Phase C gated)* | `src-tauri/benchmark_scoreboard.rs` + `Benchmark.tsx` | `lib.rs`, `history.rs`, `latency.rs` |
| **agent/peripheral** | A4 Peripheral → **wired-vs-wireless latency model** (pure advisory over existing latency + adapter data) | `src-tauri/latency.rs` + `Latency.tsx` / new `Peripheral.tsx` | `lib.rs`\*, `benchmark_*`, knowledge |
| **content/knowledge** | A3 → **category + hardware tags + date-added/last-updated** entry metadata (the named A3 gap, lines 81–82). Start a FRESH branch off `main` (current `feat/blackbook-lifecycle` is fully merged) | `src/data/knowledge*.ts` + `Learn.tsx` | all `src-tauri/`, other surfaces |

\* Prefer pure-logic / reuse existing IPC so only ONE lane touches `lib.rs` / `actions.rs` per cycle.

**🔴 Stranded work to land (surface to owner — needs per-PR sign-off):**
> **❌ SUPERSEDED by Cycle 2026-06-24e:** both branches below were found to be **already in main** (PR #6 `5ab304d`
> and PR #7 `47e93e6`) — redundant, not stranded; both pruned. The "clean-merge" claim was a no-op. Disregard this block.
- `qa/locale-drift-hardening` (4 ahead, 29 behind) — **real mutation-boundary safety fixes**: refuse instead of
  fabricating a rollback snapshot when powercfg / HAGS priors are unreadable (completes the key-open-collapse
  fail-safe tier — this is the fix for the 2026-06-22 completeness-critic finding). Touches `actions.rs` (the
  rollback boundary) → **owner per-PR merge instruction + adversarial review required** ([[merge-to-main-needs-explicit-per-pr-instruction]]).
  ✅ HQ-verified: **merges CLEAN onto current `main`** (no conflicts; diff = `actions.rs` +233/−44, `lib.rs` +85 guard tests).
  No rebase conflicts to resolve — it's review-ready; **the merge itself is owner-gated.**
- `gaming/honest-partial-undo` (1 ahead) — honest-error fix in gated Gaming-Mode code; land when Gaming-Mode QA resumes.

**Hygiene done:** pruned `spike/backend-agent` + `benchmark` (fully merged). Superseded/stale, left in place
(unmerged — kept as archive, do NOT land; all HQ-verified, not inferred):
- `feat/a1-detection` (658 unique lines = the 4-probe A1; superseded by the owner-chosen `reconcile/a1-merge` 7-probe — retained per CLAUDE.md).
- `latency-capture` (195 unique `latency.rs` lines = an **older latency impl** superseded by the active agent lane; **overlaps `latency.rs`** so it would collide — don't land).
- `tests/coverage-sweep-2026-06-18` (its 4 frontend test files + the `guided.ts` ms-settings allowlist enforcement are **confirmed present on `main`**; trivial 1-line `guided.ts` delta remains — coverage value is already shipped).

Frozen beta refs (`16069fa`) untouched.

## ⛔ Persistent-workflow protocol (read before declaring "done")

When running a `/loop` or scheduled session against "the checklist":

1. **Open THIS file. Pick the highest-priority `[ ]` item that is not owner-gated.** Do it (spec → TDD →
   build in an isolated worktree off `main` → `/check` + `/security` → `self-review` if visual →
   cargo/npm green → commit after branch+status check). Tick it `[x]` with the commit hash. Repeat.
2. **Never declare "done" without enumerating.** A valid stop is one of:
   - *"All `[ ]` items remaining are owner-gated — here they are: …"* (list them), OR
   - *"Phase A `[ ]` count is now 0; remaining work is Phase B/C/D which is gated — confirm before I cross a gate."*
   - A bare "I'm finished, standing by" with un-ticked `[ ]` items above is a **false finish** — keep going.
3. **A green test suite is NOT the stop signal.** The stop signal is "no un-ticked, non-gated item remains."
4. Owner-gated items (🔒 money/distribution, 🪪 mutation catalog-expansion, 📡 telemetry/outbound,
   🎨 taste) are *blockers to surface*, never silently skipped or marked done.
5. **Branch redundancy: judge by the TREE, not ahead/behind.** Lanes merge via PR (new hashes), so a branch can
   read "N ahead / `git cherry` all `+`" while its content is **already in main**. Before flagging a branch as
   "stranded/unmerged work," run `git merge-tree --write-tree main <branch>` — if it equals `git rev-parse main^{tree}`,
   the merge is a no-op → already shipped → prune, don't surface. Only a tree-changing merge is real unmerged work.
   And re-RUN cargo/vitest for counts each cycle — never carry an assumed number forward. ([[branch-redundancy-detect-by-mergetree]])

## 🌿 Branch-integration health (a contributing cause)

At audit time the repo had **16 branches**; most feature work was already merged to `main` (branches showed
"ahead of main by 0"), but a few carry **unmerged commits** that look "done" in their REPORTs yet are NOT in
the product:

- `feat/a1-detection` — 5 commits ahead of main (likely superseded by `reconcile/a1-merge`, verify before deleting)
- `qa/locale-drift-hardening` — 4 ahead
- `gaming/honest-partial-undo` — 1 ahead
- `ui/honest-apply-errors` — 1 ahead (pushed to origin)
- The working branch `tests/coverage-sweep-2026-06-18` is **140 behind main** — a stale checkout, easy to mistake for current.

**✅ Reconciled 2026-06-24 (HQ — full local+remote sweep; supersedes the audit-time snapshot above for live status):**
- **`ui/honest-apply-errors` is MERGED + DELETED** (its work is `6ce622d` on `main`) — it no longer exists local or
  remote; the bullet above is historical. Don't chase it.
- **Pruned** (fully merged, not checked out): `spike/backend-agent`, `benchmark`.
- **Merged but still checked out in a lane worktree** (NOT cruft — the lane's own workspace; git refuses to prune,
  and HQ does not remove other lanes' worktrees): `content/color-science-debunks` (worktree `content/`),
  `feat/a4-service-inventory` (worktree `svc/`), `feat/blackbook-lifecycle` (worktree `qa/`). They free up when the
  lane re-branches or the owner cleans the worktree.
- **Already in main → PRUNED (Cycle 2026-06-24e):** `qa/locale-drift-hardening` (= PR #6 `5ab304d`),
  `gaming/honest-partial-undo` (= PR #7 `47e93e6`) — both no-op merges; their content shipped under different hashes.
- **Unmerged, real divergent content, deliberately retained as archive (do NOT land):** `feat/a1-detection`
  (4-probe superseded by the 7-probe `reconcile/a1-merge`), `latency-capture` (older latency impl, overlaps `latency.rs`),
  `tests/coverage-sweep-2026-06-18` (value already folded). `beta/private-beta-001` = FROZEN, never touch.
- **Lane heartbeat:** `work/agent` 1 behind (active), **`work/bench` 13 behind — no push since the award-ledger
  (`1f712b1`); bench's A2 hardware-tier-segmentation assignment looks unstarted/stalled — watching.**

**Action item (A0):** reconcile/prune stranded branches so "merged into main" == "shipped." A branch whose
work is described as complete but sits unmerged is exactly how a session loses the thread.
*(Status (updated 2026-06-24e): every branch has a verified disposition ↑. The two branches once thought "stranded behind
gates" were found **already in main** (PRs #6/#7) and pruned. The only remaining unmerged branches are deliberately-superseded
archives (rejected/redundant content), so **`main` IS the single product truth** for shipped content. A0's reconcile sub-item
is effectively complete — see A0 below.)*

---

## PHASE A — Allowed-now (the 1.0 product-completeness lane)

Legend: `[x]` shipped on main · `[~]` partial/thin · `[ ]` not built · `[⛔]` excluded by feasibility/design.

### A0 · Repo hygiene
- [x] Reconcile + prune the stranded branches; confirm `main` is the single product truth — done 2026-06-24e: pruned `spike/backend-agent`, `benchmark`, and the two no-op-redundant safety branches (`qa/locale-drift-hardening`=#6, `gaming/honest-partial-undo`=#7, both already in main); the 3 remaining unmerged branches are deliberately-superseded archives. `main` IS the single product truth.
- [x] Adopt this ledger as the persistent-workflow target — the HQ STEERING LOG (top) is the live per-cycle target; `/loop` + scheduled HQ sessions drive off it.

### A1 · DETECTION layer — **effectively complete** (feasibility-bounded)
- [x] core-parking state (policy/registry + powercfg) — `hardware.rs`, `lib.rs:288`
- [~] XMP/EXPO active — honest "running below rated" only; never claims "profile active" — `hardware.rs:497`
- [⛔] Intel Speedshift/EPB — user-mode feasibility wall ([[detection-feasibility-walls-usermode]])
- [⛔] AMD PBO — feasibility wall (detect-only impossible without vendor SDK)
- [⛔] thermal-throttle (ACPI) — feasibility wall; only post-hoc noisy-run flag exists
- [~] power-draw — GPU via NVML/ADLX built; CPU package power not (no kernel/vendor path) — `monitoring.rs:365`
- [x] Hyper-V / VBS / SVM virtualization — `hardware.rs:1078`, `diagnostics.rs:126`
- [x] S.M.A.R.T. drive health — `hardware.rs:329`
- [x] USB device/lane tier — `hardware.rs:1148`
- [~] BIOS-tweak *availability* annotation — BIOS age detected; "which tweaks available" not probed
- [x] firmware/BIOS date check — `hardware.rs:1027`
- [x] driver-freshness all vendors + copyable URLs — `hardware.rs:1321`, `Check.tsx:49`
- [x] NIC driver freshness — `get_nic_driver_info`, `Check.tsx:262`

### A2 · MEASUREMENT spine — **mostly built**
- [x] benchmark before/after comparison (armed) — `comparison.rs:120`, `benchmark_trial.rs:238`
- [x] baseline set/clear — `benchmark.rs:940`
- [x] cross-session comparison — `comparison.rs`, `sessions.rs:212`
- [x] session history with hardware snapshot — `sessions.rs:35` (`hw_fingerprint`)
- [x] drift-regression advisory — `drift.rs`
- [x] local award/score ledger — drill-down UI: each award expands to its full certified receipt (rec_id handle + metric + 95% CI + points + timestamp) from the existing get_scoreboard data — `260f943`
- [~] hardware-tier segmentation — `percentile_rank` exists but **unwired**; no budget/mid/high mapping
- [~] percentile stub — function tested, **never called**, no cohort data (needs Phase C network) — `benchmark_scoreboard.rs:60`

### A3 · CONTENT reorg (Blackbook/Autopsy) — **half built; missing entry metadata**
- [x] entry dedup lint — `knowledge.lint.test.ts:78`
- [~] category + **hardware tags** on entries — **category DONE** (`knowledge-topics.ts`: central id→topic map, 10 topics, all 180 entries classified; required `BaseEntry.topic` + lint completeness guard + Learn "Topic:" filter; self-reviewed) — `cf77e0b`. **Hardware tags still open** (AMD/NVIDIA/Intel/laptop/desktop applicability) — follow-up. Topic enum/labels flagged for owner taxonomy skim.
- [ ] date-added / last-updated metadata — no temporal fields on entries (deferred: backfilling historical add-dates can't be done honestly; would ship forward-only when meaningful)
- [x] filter-by-category + verdict UI — `Learn.tsx:578`
- [x] alias-collision lint + CI guard — `knowledge.lint.test.ts:98`
- [x] deprecated/superseded status field — `status` + `supersededBy` on BaseEntry + `lifecycle()` mapper + lint guard (real/different target) + honest Learn surfacing (`aedb3ab`)
- [x] orphaned-`related[]` lint — `knowledge.lint.test.ts:84`
- [~] Autopsy structured schema — typed result exists, no versioning/migration — `knowledge-autopsy.ts:15`
- [x] Autopsy "what did we learn?" rollup — `autopsy-ledger.ts`, `Learn.tsx:453`
- [x] local autopsy stats — `autopsy-ledger.ts`, `local-stats.ts`

### A4 · ADVISORY surfaces — **THE MAJOR REMAINING LANE (~24 of 33 not built)**

**Monitor/Display**
- [ ] OSD detection
- [ ] 3-mode preset GUIDED checklists (Visual Fidelity / Smooth / Clarity) advisory cards
- [~] vendor-aware monitor walkthroughs — generic VRR/HDR exist; no model-specific
- [ ] FreeSync↔VRB exclusion warning (FreeSync detected, but no VRB feature)
- [ ] Acer XFA253QZ (and family) model-hint cards
- [x] refresh-rate / sRGB / gamma-vs-HDR / chroma debunk Learn entries — added `srgb-clamp`, `gamma-vs-hdr`, `chroma-subsampling` term explainers (factual color-science, debunk woven in, adversarially fact-checked, lint-clean); refresh-rate covered by `set-refresh-rate` + `hz-vs-fps`. Flagged for owner brand-voice skim.
- [x] monitor model detection (EDID / WmiMonitorID, read-only) — `hardware.rs:1879`

**GPU**
- [~] vendor profile detection + advisory badges — vendor detected; AMD sensors verified, NVIDIA gated (Rule 5)
- [x] GPU-temp honesty gate consolidated to ONE source (`gradeGpuTempForVendor`, gpu-sensor.ts) — fixed a LIVE Rule-#5 violation (SessionDebrief graded NVIDIA temp bare); Play + DashboardV2 dedup'd onto it so it can't drift again (found by the 2026-06-24 workable-now audit; guard test added)
- [ ] per-game / global scope picker (UI only)
- [ ] before/after delta display (for profiles)
- [ ] GPU profile export (JSON)
- [ ] version-pinned mismatch warning
- [ ] AMD undervolting guide (AMD-verified; NVIDIA/Intel withheld per Rule 5)

**Services**
- [x] read-only service inventory by category — `services.rs` (new): WMI enumerate-all → 9 plain-English gaming-relevant categories (vendor/launchers/anti-cheat/Xbox/perf/telemetry/updates/app-updaters/search), live state + factual descriptions, honest "<n> recognised of <m> total" coverage; folds into `get_diagnostics` (no new IPC, zero frontend change); pure-core unit-tested; inventory-not-advice (no safe-to-suspend judgement) — `b5b16b0`
- [ ] curated "safe-to-suspend" reference data (must be owner-curated, never LLM-generated)
- [ ] use-case profile selector (Gaming/Streaming/Creation/Idle — localStorage)
- [ ] service-drift detection (extend Leftovers)
- [ ] recovery guide

**Peripheral** (no Peripheral surface exists in the rail — whole section missing)
- [ ] mouse DPI / genre audit
- [ ] debounce / Snap-Tap / Null-Bind / Rapid-Trigger detection
- [ ] sensor ID + known-issue DB (bundled JSON)
- [ ] wired-vs-wireless latency model
- [ ] keyboard actuation / NKRO / Rapid-Trigger guide
- [ ] USB-port recommendations
- [x] polling-rate read — `latency.rs` (`latency_measure_mouse`)
- [~] interrupt-affinity suggestion — MSI advisory exists; no affinity tuning — `latency.rs:150`

**Network (detection only)**
- [x] connection-type classification (wired/Wi-Fi/other) — `hardware.rs:1788`
- [x] Wi-Fi link quality (band · signal% · link-rate) — enriches the network-connection advisory when on Wi-Fi (read-only `netsh wlan`; parser unit-tested; not verifiable on the wired dev rig)
- [x] wired-port-aware Wi-Fi nudge — on Wi-Fi AND a wired Ethernet port exists → names it ("plug it in") instead of the hedged "if you can run a cable" (read-only, reuses `has_wired_ethernet_port`; unit-tested)
- [ ] ISP speed snapshot (local)
- [ ] network-readiness pills
- [x] Wi-Fi channel / interference — `channel` surfaced on 2.4 GHz + overlap advisory (only 1/6/11 don't overlap → switch router or to 5 GHz); read-only, parser already read it, unit-tested
- [ ] DNS resolution-time probe
- [ ] powerline / MoCA Learn guides
- [x] QoS advisory — read-only Policy-based-QoS detection (HKLM+HKCU `…\Windows\QoS`); surfaces a named Advisory ONLY when a policy exists (no clutter when clean); honest "as-found, not a problem on its own" framing; unit-tested

### A5 · GUIDED SETUP & VERIFICATION + PARAMEDIC — **half built; clean finishable gaps**
- [x] Setup-Complete state machine — `FirstCheck.tsx`, `Onboarding.tsx`
- [x] post-apply verification gate (re-run probes) — `use-scan.ts`, `Check.tsx:293`
- [x] green/yellow/red confidence chips (color-coded) — `Check.tsx:298`
- [~] exportable setup summary — report exists but no dedicated setup-summary card
- [~] Re-Run Setup — re-run check exists; no explicit re-baseline flow
- [x] **hardware-change detection** — wired into Check (Optimize→Fixes): advisory card names what changed + inline acknowledge/re-baseline (`acknowledge_hardware_changes`) so it never nags; live-verified 2026-06-24
- [ ] override toggle (dismiss exists; no override-all)
- [x] drift-watch integration — `drift.rs`, `Check.tsx:325`
- [x] historical-ledger surfacing — `Fix.tsx:712`
- [~] applicability check — eligibility filter exists; no override for ineligible
- [~] obsolescence/superseded flags — status field only; no supersession chain
- [~] before/after delta display — shows rollback target only, no full diff
- [~] "last seen working on" hardware tag — backend names prior state; no UI card
- [x] per-tweak audit trail — `Fix.tsx:423`
- [~] ledger filter "this rig only" — no UI toggle
- [~] measured-payoff linkage — linked to some advisories; no per-tweak payoff meter

### A6 · UPGRADE-PATH advisory — **complete** (affiliate tags = Phase D)
- [x] hardware-limited verdict detection (GPU≥95% / HDD install drive) — `priorities.rs:95`
- [x] `build_upgrade_path` single source — `priorities.rs:106`
- [x] session-qualified copy — `priorities.rs:109`
- [x] copy-only buttons (no URL opener) — `Check.tsx:207`
- [x] plain retailer links (no tags) + disclosure — `priorities.rs:81`
- [~] markdown-export anchors — present; not independently tested
- [x] test "no tags + disclosure always paired" — comprehensive affiliate/tracking guard over ALL retail links (const tables, 12 markers, https-only) + single-item disclosure pairing locked (`priorities.rs` tests)

---

## PHASE B — Gated mutations 🪪 (LOCKED rule 6: owner product decision + per-feature QA + welfare-check)
- [BUILT-DARK] session service-suspend — `actions.rs`, gated `service_suspend_gate()==false`
- [BUILT-DARK] telemetry scheduled-task disable (debloat) — gated
- [ ] GPU profile apply (AMD first) / import / rollback
- [ ] bloat removal (user-UWP uninstall + `HKCU\Run` cleanup; NO Defender/Policy)
- [ ] one-click re-apply (limited to `APPLIABLE_REC_IDS`)
- Gaming Mode (F1) — built, **gate still false**; needs physical-reboot QA + owner sign-off.

## PHASE C — Telemetry / outbound 📡 (stop-rule 3: own spec + security review + owner sign-off; ships DARK)
- [BUILT-DARK] Receipts opt-in consent UI + payload preview — `receipts.rs`, `ReceiptsConsent.tsx` (gate off)
- [ ] bufferbloat/speed-test send · jitter/packet-loss · session network telemetry · A/B preset efficacy · ISP/ZIP lookup

## PHASE D — Money / distribution 🔒 (owner territory — DEFERRED per current 1.0 focus)
- [BUILT-DARK] License / Pro gate scaffolding — `license.rs`, `ProGate.tsx`, `pro.ts`
- [ ] affiliate tag-swap · compy.gg waitlist funnel · Receipts arming · leaderboard · Pro multi-rig · B2B
- Funnel go-live mechanical steps parked in `docs/cowork-cc-relay/2026-06-15-funnel-golive-todo.cc.md` (owner-initiated).

---

## Bottom line (2026-06-23)
The 1.0 lane (Phase A) is **substantially but not fully built**. A1 and A6 are done; A2 mostly done; A3 and
A5 have scattered finishable gaps. **The real remaining bulk is A4** — Services advisory inventory, the
entire Peripheral Audit surface, deep Network detection, and the Monitor preset/OSD/hint cards. So: no, the
list has not been fully worked. The next-up, highest-leverage, non-gated work is **A4 + the A5 finishables
(wire `hwchange.rs` to the UI) + A3 entry metadata**.
