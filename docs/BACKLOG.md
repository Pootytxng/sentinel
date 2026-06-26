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

### Cycle 2026-06-25e — FIRST compy-burst run (cost-bounded workflow PROVEN) — `main` @ `a1fd03e`
First real run of `scripts/compy-burst.workflow.js` (maxItems 3): **2 shipped · 1 honestly skipped · GREEN.**
- ✅ 3-mode preset GUIDED checklists (`1daf03b`) · ✅ hardware-applicability tags on knowledge entries (`a1fd03e`).
- ⏭️ override-all toggle SKIPPED by the build agent — its assigned files couldn't support it without orphaned/incoherent
  UI; it refused + flagged the re-scope (needs `dismissed.ts` + `Fix.tsx`). Good discipline, no fabrication.
- **Verify GREEN:** cargo **636** · vitest **1956 / 318 files** · build clean. (HQ note: my first vitest re-check flaked
  "318 failed/no tests" from leftover burst workers — clean re-run passed. Re-confirm flakes in isolation, don't revert.)
- **💰 COST CALIBRATION:** burst cost **~660k total / ~402k output** for ~2 items ≈ **200k output/item** — ~2× the 60k
  estimate. `COST_PER_ITEM`→200k; LANE_WORKFLOW §3 updated. Rule of thumb: ~300k→1 item · ~600k→2 · ~1M→4.
- Structure VALIDATED: bounded, finite, self-skips gated/incoherent work, and HQ's independent re-verify caught the
  flake the agent's self-report missed — the safety net works.

### Cycle 2026-06-25c — API-error AUTO-RECOVERY (owner: "resume isn't recovering from the API error")
**Diagnosis:** the honesty lane resumed correctly (RECOVER-FIRST worked — it read LANE_BUS, found its
assignment) then hit a **rate-limit mid-task and halted with no auto-restart.** Root cause: RECOVER-FIRST (§⑦)
is *what to do on wake* — it can't *make* a dead loop wake. A bare `/loop` does NOT reliably survive an API
error (it can abort before rescheduling); re-sending by hand re-hits the transient throttle.
**Fix — the missing WAKE mechanism:** new **`scripts/lane-runner.ps1`** (LANE_BUS §⑨) runs a lane headlessly
(`claude --print`) in an **exponential-backoff retry loop** (30s→10min) + **`--fallback-model`** (rate-limit →
auto-switch model, not death). Because RECOVER-FIRST + the bus make a lane **stateless** (every tick reconciles
from git + LANE_BUS), each retry is a fresh cold run that resumes exactly where it left off — nothing lost or
duplicated. PowerShell parse-verified. Three resilience tiers documented (wait-and-resume · `--fallback-model`
on interactive tabs · the runner for hands-off; `-BypassPermissions` = owner opt-in for unattended).
**Corrected §②'s earlier over-claim** that `/loop` self-recovers from API errors — it doesn't. `main` green; script + docs only.

### Cycle 2026-06-25d — autonomous fleet STOPPED to conserve tokens; Phase-A non-gated work ~complete
**Owner directive:** complete all work + be self-sufficient, but **minimize tokens** (half the weekly budget already
spent). The 5 bypass-perms runners had each looped ~50 ticks (full Claude sessions) → that was the burn. **Stopped
all 5 runners** (TaskStop + verified no `lane-runner` loop alive; building ceased, main stable). The dashboard
(`lane-dashboard.ps1`) still shows the worktrees (now idle).
**What the fleet delivered (all green, all on main):** cargo **636** (+70 this session) · vitest **643** / 105 files
(+85) · build ✓ @ `0c2d4ce`. Across the run lanes shipped, e.g., service inventory + startup-drift + recovery guide +
network-readiness pills (backend), hardware-tier segmentation + LOCAL percentile (measurement, A2 done), USB-tier +
interrupt-affinity + wired-vs-wireless (peripheral), refresh-rate/powerline-MoCA/AMD-undervolt/eDPI/driver guides
(content), and a full tweak-debunk corpus honesty audit + extra Rule-5 guards (honesty). Cross-lane handoffs +
gate-flagging (DNS probe held as outbound-gated) worked end-to-end.
**Remaining work, tiered (for token-aware prioritization):**
- ⛔ **WALLED (impossible w/o kernel/vendor SDK — do NOT spend):** OSD detection · FreeSync↔VRB strobe detection · (+ the [[detection-feasibility-walls-usermode]] set).
- 🟡 **Buildable but MARGINAL (low ROI — deferred):** 3-mode preset checklists · monitor model-hint cards · use-case profile selector · A5 override toggle.
- 🔒 **GATED = the real remaining VALUE (needs an owner gate decision, not tokens-on-spec):** Phase B mutations (GPU-profile apply, service-suspend arming, bloat removal, one-click re-apply) · Phase C telemetry/Receipts · Phase D money/affiliate/funnel.
**Recommendation:** the high-value work left is GATED — spend remaining budget there *after* you open a gate, not on the marginal Phase-A tail. Phase-A non-gated product completeness is effectively DONE.

### Cycle 2026-06-25b — crash-recovery / resume-after-API-error (owner ask)
**Owner ask:** let sessions re-establish work / resume after API errors that halt the loop.
**Added to `LANE_BUS.md`:** (§① step 0 + §⑦) a **RECOVER-FIRST routine** that makes each lane loop **idempotent**
— on every wake it surveys uncommitted WIP (finish+commit or stash-with-note, never discard), handles a
half-rebase, checks whether the item already landed (merge-tree no-op / BACKLOG tick → skip, no duplication),
re-establishes a green cargo+npm baseline, then resumes. (§⑧) a **WATCHDOG**: steering reads each lane's
last-activity by its **file-domain on origin/main** (branch HEAD false-alarms since lanes merge via ephemeral
branches) and posts a restart instruction + pings owner for any lane quiet >~30m with open queue work. The §②
loop prompt now leads with RECOVER-FIRST and is explicitly idempotent.
**Why it survives API errors:** committed work is on origin, WIP is in the worktree, the checkpoint says where the
lane was → a restarted loop resumes without loss or duplication. `/loop` already rides out *transient* errors
(next tick recovers); a *hard* halt is recovered by RECOVER-FIRST on restart (manual / stop-hook / watchdog-prompted).
**Live watchdog run:** peripheral active (30m) · backend/content/honesty idle 3–4h (no loop running) · **measurement
~13.6h stalled — restart needed.** `main` @ `2f134e6` green; docs-only.

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
- [x] hardware-tier segmentation — LOCAL Entry/Mid/High band on the Benchmark surface from measured VRAM·cores·RAM (inputs named); reuses the canonical rig-tier bands via pure `benchRigTier`; like-to-like framing, no cohort/network — `372bde1`
- [x] percentile display — wired `percentile_rank` as a LOCAL display-only stub: each verified win ranked within the cohort of ALL the user's own wins (the scoreboard ledger), shown as "Top X% of your verified wins" in the award drill-down, labeled "local — no peer cohort yet"; gated below a 4-win floor; never persisted. Peer/cohort percentile stays Phase C gated — `0de96f0` (`benchmark_scoreboard.rs:63`)
- [x] CPU-runner flake fix (backend lane flagged) — `cpu_kernel` now guarantees ≥1 work chunk (do-while) so a starved tiny-run scheduled past its short deadline still measures real throughput instead of reading 0 and false-failing the shared green baseline; strong `> 0.0` shape assertion kept + a regression guard (`cpu_kernel_runs_at_least_one_chunk_past_deadline`) pins the contract; `benchmark.rs`, cargo 612
- [x] `normalize()` honesty fail-safe — a non-finite raw score now fails SAFE to 0 (no credit) instead of `Inf`→`.clamp(0,100)`→**100** (a fabricated "perfect" component score, the worst honesty failure). Currently unreachable (producers guard divisors via `.max(1e-6)`/`is_finite`) but guarded at the point-of-use so a future producer-guard regression can't invent a maxed score; invalid reference (non-finite/≤0) also → 0. Regression test pins Inf/NaN/-Inf + bad refs (was untested); real-path byte-identical — `2ee51aa` (`benchmark.rs:461`)
- [x] `completeness_pct()` honesty fail-safe (completeness-critic close-out of the above — the grep'd sibling) — its `ceiling <= 0.0` gate did NOT catch a non-finite input (`NaN <= 0.0` is false), so `+Inf current`→**100** (fabricated "fully optimized") and `NaN`→leaked through `.clamp()`. Now `is_finite` guards both inputs at the point of use, mirroring `normalize()`, so the boundary is uniform + safe-by-construction whenever this still-unwired primitive is wired. comparison::pct (guarded `base>0`, measured-FPS inputs, NaN-delta failure mode) + percentile_rank (u32-derived inputs) assessed safe — class now closed. Regression test pins Inf/NaN; finite-input behavior byte-identical — `dbc8358` (`benchmark_scoreboard.rs:75`)

### A3 · CONTENT reorg (Blackbook/Autopsy) — **half built; missing entry metadata**
- [x] entry dedup lint — `knowledge.lint.test.ts:78`
- [x] category + **hardware tags** on entries — **DONE**. Category: `knowledge-topics.ts` central id→topic map, 10 topics, required `BaseEntry.topic` + lint + Learn "Topic:" filter (`cf77e0b`). **Hardware tags DONE**: `Applicability` enum (AMD/NVIDIA/Intel/laptop/desktop) + central optional `APPLIES_BY_ID` map in `knowledge.ts` (absent = universal), `applies?` on entries, lint validity/completeness guards, Learn "Fits:" filter + per-card tag pills (read-only/advisory; self-reviewed). Topic + applicability labels flagged for owner taxonomy skim.
- [ ] date-added / last-updated metadata — no temporal fields on entries (deferred: backfilling historical add-dates can't be done honestly; would ship forward-only when meaningful)
- [x] filter-by-category + verdict UI — `Learn.tsx:578`
- [x] alias-collision lint + CI guard — `knowledge.lint.test.ts:98`
- [x] deprecated/superseded status field — `status` + `supersededBy` on BaseEntry + `lifecycle()` mapper + lint guard (real/different target) + honest Learn surfacing (`aedb3ab`)
- [x] orphaned-`related[]` lint — `knowledge.lint.test.ts:84`
- [x] Autopsy structured schema — versioning/migration added to the PERSISTED store: `autopsy-ledger.ts` now writes a versioned envelope `{ v, entries }` + `migrateLedger()` (forward-only, idempotent, lossless) carries the legacy bare-array form forward and seams in per-version upgrades for future field changes; +10 tests. The transient `AutopsyResult` (`knowledge-autopsy.ts:15`) is recomputed from re-graded text each session (never persisted) → nothing to migrate there (`3e16618`)
- [x] Autopsy "what did we learn?" rollup — `autopsy-ledger.ts`, `Learn.tsx:453`
- [x] local autopsy stats — `autopsy-ledger.ts`, `local-stats.ts`

### A4 · ADVISORY surfaces — **THE MAJOR REMAINING LANE (~24 of 33 not built)**

**Monitor/Display**
- [x] OSD detection — shipped the feasible+honest reading: `overlay_tools.rs` read-only probe detects third-party in-game overlay/OSD TOOLS running (RTSS · MSI Afterburner · Fraps · Bandicam — only tools whose running process reliably means an OSD is drawn), surfaced as an "On-screen overlays" Diagnostics section so a double-overlay with Compy's own overlay isn't a mystery. Informational only (no perf/FPS claim, no "close it"); curated labels only (live process names never surfaced/sent); honest coverage. Monitor-HARDWARE-OSD reading deliberately NOT attempted (DDC/CI is an unreliable per-monitor honesty-hazard). No new IPC; 8 tests + law guards — `bf0272f`
- [x] 3-mode preset GUIDED checklists (Visual Fidelity / Smooth / Clarity) advisory cards — read-only Monitor panel: 3 named presets bundle EXISTING guided walkthroughs; `src/surfaces/monitor-view.ts` (pure, 7 tests) + Monitor.tsx panel reusing chip/card/btn-small; no IPC/mutation
- [~] vendor-aware monitor walkthroughs — generic VRR/HDR exist; no model-specific
- [ ] FreeSync↔VRB exclusion warning (FreeSync detected, but no VRB feature)
- [ ] Acer XFA253QZ (and family) model-hint cards
- [x] refresh-rate / sRGB / gamma-vs-HDR / chroma debunk Learn entries — added `srgb-clamp`, `gamma-vs-hdr`, `chroma-subsampling` term explainers (factual color-science, debunk woven in, adversarially fact-checked, lint-clean); refresh-rate covered by `set-refresh-rate` + `hz-vs-fps`. Flagged for owner brand-voice skim.
- [x] refresh-rate **myth debunk** Learn entry — `human-eye-fps-myth` ("Can your eye see past 60 fps?") term explainer fills the gap the line above left (set-refresh-rate is a *real* tweak, hz-vs-fps is mechanics — neither busts the "eye can't see past 60/30/24 fps" myth). Honest/balanced (returns-diminish nuance, no fabricated study, no hardware-specific claim), display-topic, cross-linked; guard test `knowledge-refresh-myth.test.ts`. Flagged for owner brand-voice skim. **[honesty audit 2026-06-25: CLEAN — every claim web-verified vs authoritative sources; no fabricated/unmeasured/Rule-5 claim.]**
- [x] **shader-cache-guide vendor-precision fix** (honesty audit 2026-06-25 nit) — the guide's steps were NVIDIA-Control-Panel-specific ("Shader Cache Size → Unlimited/10 GB"), but AMD Adrenalin (our dev-rig vendor) + Intel expose only an on/off Shader Cache, NOT a size knob — an AMD user couldn't find the named setting. Made the steps + undo vendor-aware (NVIDIA size knob vs AMD/Intel on/off + Reset/Clear; AMD path web-verified against AMD's own support docs). bug→guard: `knowledge-shader-cache-guide.test.ts` pins the vendor-awareness so it can't regress to single-vendor
- [x] **driver-update-guide Intel-vendor fix** (completeness-critic pass over guides.json after the shader-cache fix — same defect class) — step 1 said "AMD's or NVIDIA's own site or app", stranding Intel GPU owners (Arc discrete + iGPU); now "AMD's, NVIDIA's, or Intel's". The other 6 guides surveyed clean (vrr names Reflex+Anti-Lag 2, xmp names XMP/EXPO/DOCP, fan-curve/fps-cap/startup vendor-neutral). bug→guard: `knowledge-driver-update-guide.test.ts` pins all-three-vendor coverage
- [x] **Autopsy truncation-note single-source fix** (fresh Learn.tsx read, stop-hook deeper pass) — the over-cap note hardcoded `(100000)` instead of the exported `AUTOPSY_MAX_CHARS` that drives the actual truncation (a "one source, can't drift" violation: a future cap change would make the note lie about how much was graded). Values coincide today (no user-visible bug) → latent-drift hardening. Now uses the constant. bug→guard: render test in `Learn.test.tsx` pins the displayed char count to `AUTOPSY_MAX_CHARS`
- [x] monitor model detection (EDID / WmiMonitorID, read-only) — `hardware.rs:1879`

**GPU**
- [~] vendor profile detection + advisory badges — vendor detected; AMD sensors verified, NVIDIA gated (Rule 5)
- [x] GPU-temp honesty gate consolidated to ONE source (`gradeGpuTempForVendor`, gpu-sensor.ts) — fixed a LIVE Rule-#5 violation (SessionDebrief graded NVIDIA temp bare); Play + DashboardV2 dedup'd onto it so it can't drift again (found by the 2026-06-24 workable-now audit; guard test added)
- [x] **[honesty]** tweak-debunk corpus fact-check (`tweaks.json`, all 84 entries) — **COMPLETE** (8 adversarial web-verified sub-agents): zero false-`real`/`risky` verdicts, zero surviving fabricated numbers. Three factual fixes landed by honesty (sysmain GB-number · fTPM misattribution · defrag-SSD "not a defrag" falsehood); verdict/voice handoff (timer-resolution re-grade + wording nits) processed by content. Regression guard `tweak-honesty-guard.test.ts` pins the three corpus fixes. Ledger: `docs/HONESTY_AUDIT_TWEAKS.md`
- [x] **[honesty]** new-Learn-entry audit + terms-corpus regression guard — audited all 8 net-new term explainers (human-eye-fps-myth · powerline/MoCA · keyboard×3 · amd-undervolting · eDPI) + the driver-update-guide Intel fix = CLEAN; caught + fixed one falsehood (`rapid-trigger` claimed Snap Tap/SOCD "banned in CS2 & Valorant" — Valorant actually PERMITS it, VCT §2.3.5). bug→guard: new `terms-honesty-guard.test.ts` pins that Valorant is framed as currently allowing it (the content keyboard guard only pins the generic ban/restrict/rules property, so the false game-list could have regressed green) — `terms-honesty-guard.test.ts`
- [x] **[honesty]** full metric-grading sweep for the NVIDIA-sensor Rule-5 gate — every authoritative GPU-temp grade routes through `gradeGpuTempForVendor` (Overlay/LiveCharts/DashboardV2/Play/SessionDebrief); the tuning path (TuningDebrief/Instrument/Verdict + `gpuRunningHot` nudge) is AMD-walled via `tuningGuideForVendor`; no live gap. Closed a COVERAGE hole in the guard: `gpu-temp-gate-guard.test.ts` now scans production `.ts` too (was `.tsx`-only), allowing only metric-grade.ts + gpu-sensor.ts — a `.ts` helper can no longer bypass the gate (`755f931`)
- [ ] per-game / global scope picker (UI only)
- [ ] before/after delta display (for profiles)
- [ ] GPU profile export (JSON)
- [ ] version-pinned mismatch warning
- [x] AMD undervolting guide (AMD-verified; NVIDIA/Intel withheld per Rule 5) — `amd-undervolting` power-topic term: splits the safe/reversible Radeon GPU path (Adrenalin, the one Compy guides) from the risky/advanced Ryzen CPU path (BIOS PBO/Curve Optimizer); cross-links amd-gpu-undervolt + pbo-curve-optimizer; no FPS promise, silicon-lottery caveat, NVIDIA/Intel explicitly withheld per Rule 5; guard test (`dd7e4e8`)

**Services**
- [x] read-only service inventory by category — `services.rs` (new): WMI enumerate-all → 9 plain-English gaming-relevant categories (vendor/launchers/anti-cheat/Xbox/perf/telemetry/updates/app-updaters/search), live state + factual descriptions, honest "<n> recognised of <m> total" coverage; folds into `get_diagnostics` (no new IPC, zero frontend change); pure-core unit-tested; inventory-not-advice (no safe-to-suspend judgement) — `b5b16b0`
  - [x] coverage expansion — added **Riot Vanguard** (`vgc`, the Valorant/LoL anti-cheat the category was missing), **GOG Galaxy** (`GalaxyClientService`), **NVIDIA Container** (`NvContainerLocalSystem`); faithful inventory-not-advice facts, exact-match (still never guessed), + no-duplicate-Name catalog guard — `32146bc`
- [ ] curated "safe-to-suspend" reference data (must be owner-curated, never LLM-generated)
- [ ] use-case profile selector (Gaming/Streaming/Creation/Idle — localStorage)
- [x] service-drift detection (extend Leftovers) — `services.rs`: closed curated catalog (Windows Audio · Audio Endpoint Builder · Themes) flagged when startup drifts from stock Automatic (Manual/Disabled only; Boot/System/Unknown never guessed; absent never flagged); receipts + origin-uncertainty + honest nothing-found; folds into Diagnostics, no new IPC; 10 pure tests incl. law guards (no boost/alarm; catalog can't target a Compy-endorsed disable) — `bd170ce`
- [x] recovery guide — `services.rs`: pure `build_recovery_guide` attaches by-hand, plain-English services.msc restore steps to drift findings (Automatic startup → Start); reference data, NO mutation (Compy performs none); names the exact affected services from the curated const catalog; honest origin-uncertainty + grammar/law guards; folds into Diagnostics as "Background services · How to restore", no new IPC; 5 tests — `a5d5cca`
- [x] recovery guide — **dependency ordering** (correctness fix): when a drifted service's curated prerequisite is ALSO drifted (Windows Audio → Audio Endpoint Builder), restore the prerequisite FIRST + one honest ordering step (else the user hits "a dependency service or group failed to start" following the guide top-to-bottom); note appears only when both are off (never lecture); closed curated fact, not a live WMI dependency read; read-only, `services.rs` only, +4 tests — `89488fb`

**Peripheral** (no Peripheral surface exists in the rail — whole section missing)
- [x] mouse DPI / genre audit — handed off to content (DPI isn't OS-readable → can't be a hardware-tailored peripheral card); shipped as the `effective-sensitivity` (eDPI) input-topic Learn entry: eDPI = DPI × in-game sensitivity is the number that decides aim feel, match it (not just DPI) to copy a setup; names the can't-read-DPI limit + the 400–800 (rarely >1600) rule-of-thumb; no FPS claim; guard test (`bcf7316`)
- [ ] debounce / Snap-Tap / Null-Bind / Rapid-Trigger detection
- [ ] sensor ID + known-issue DB (bundled JSON)
- [x] wired-vs-wireless latency model — honest conservative wireless-name advisory, read-only (`27f3651`)
- [x] keyboard actuation / NKRO / Rapid-Trigger guide — `keyboard-actuation` + `nkro` + `rapid-trigger` input-topic term explainers (pairs with peripheral's switch detection). Honest: actuation = a speed-vs-misfire feel preference (not skill/FPS); NKRO = inputs-not-dropped (not speed); Rapid Trigger needs HE/analog hardware and is **anti-cheat-aware** — flags that Snap Tap / SOCD is banned in CS2 (Valorant currently permits it — honesty fix), rules differ by game, and Compy enables/recommends nothing your game forbids. No fabricated specs. Guard test `knowledge-keyboard.test.ts`. Flagged for owner brand-voice skim.
- [x] USB-port recommendations — both halves shipped: SHARING (`shared_controller_advisory`) + TIER (`usb_tier_advisory`: honest 2.0-fine-for-input + 3.x/USB4 myth-buster, read-only, owns the tier dimension only — never re-issues the "move device X" call) (`9a045d9`)
- [x] **(backend signal)** per-rig USB top-spec exposed for the tier advisory — `hardware::detect_usb_top_spec() -> Option<String>` (capability tier only; `"Unknown"`→`None`); unblocks peripheral's USB-tier port half — `84a2af1`
- [x] polling-rate read — `latency.rs` (`latency_measure_mouse`)
- [x] interrupt-affinity suggestion — deepened into a NAMED read-only suggestion (multi-CCD + latency-sensitive devices named; never writes affinity) — `affinity_device_suggestion` (`e5d2356`)

**Network (detection only)**
- [x] connection-type classification (wired/Wi-Fi/other) — `hardware.rs:1788`
- [x] Wi-Fi link quality (band · signal% · link-rate) — enriches the network-connection advisory when on Wi-Fi (read-only `netsh wlan`; parser unit-tested; not verifiable on the wired dev rig)
- [x] wired-port-aware Wi-Fi nudge — on Wi-Fi AND a wired Ethernet port exists → names it ("plug it in") instead of the hedged "if you can run a cable" (read-only, reuses `has_wired_ethernet_port`; unit-tested)
- [x] wired link-speed detection — `hardware.rs`: negotiated wired Ethernet rate (MSFT_NetAdapter.Speed, reuses the existing adapter query — zero-outbound, NOT the 📡 ISP/DNS class); pure `active_wired_link_speed` + `format_link_rate`; readiness pill (neutral gigabit+, advisory ≤100 Mbps) + Diagnostics "Wired link speed" row with honest note (low link = old cable/port, still fine for gaming); 5 tests — `6f3f7dd`
- [ ] ISP speed snapshot (local) — 📡 outbound-gated (a real throughput test must download from a server = first outbound call, same wall as the DNS probe); only the zero-outbound NIC link-rate above is feasible without owner sign-off
- [x] network-readiness pills (backend signal) — `hw.network_pills: [{label,tone}]` on HardwareInfo, derived read-only from adapters/Wi-Fi/QoS/wired-port (zero-outbound, no new probe/IPC); tones good/neutral/advisory/unknown mirror the network-connection readiness honesty; 6 pure tests; UI half = content/peripheral — `490e081`
- [x] network-readiness pills (**UI half**, peripheral) — calm color-coded chips in the Latency surface ("Network connection" card, the online-latency axis); renders the authoritative `hw.network_pills` signal via a narrow `get_hardware_info` read (Benchmark `RigSpecs` precedent — the surface has no `hw` in scope); honest tones (`advisory` = calm accent, never amber/alarm; unknown future tone → neutral), card hidden when unread, no FPS promise; pure `networkPillTone` + 4 tests; live self-reviewed — `b33fcd4`
- [x] Wi-Fi channel / interference — `channel` surfaced on 2.4 GHz + overlap advisory (only 1/6/11 don't overlap → switch router or to 5 GHz); read-only, parser already read it, unit-tested
- [ ] DNS resolution-time probe
- [x] powerline / MoCA Learn guides — `powerline-ethernet` + `moca-ethernet` term explainers (network topic): honest no-new-cable wired-grade options for rooms you can't run a cable to. Both name the real win (ping/stability over Wi-Fi, NOT FPS), the practical catches (powerline ← wall-not-surge-strip, circuit-dependent; MoCA ← coax both ends + PoE filter), and when to prefer each. Cross-linked to `wifi-vs-ethernet-fps`; no fabricated speeds. Guard test `knowledge-powerline-moca.test.ts`. Flagged for owner brand-voice skim.
- [x] QoS advisory — read-only Policy-based-QoS detection (HKLM+HKCU `…\Windows\QoS`); surfaces a named Advisory ONLY when a policy exists (no clutter when clean); honest "as-found, not a problem on its own" framing; unit-tested

### A5 · GUIDED SETUP & VERIFICATION + PARAMEDIC — **half built; clean finishable gaps**
- [x] Setup-Complete state machine — `FirstCheck.tsx`, `Onboarding.tsx`
- [x] post-apply verification gate (re-run probes) — `use-scan.ts`, `Check.tsx:293`
- [x] green/yellow/red confidence chips (color-coded) — `Check.tsx:298`
- [~] exportable setup summary — report exists but no dedicated setup-summary card
- [~] Re-Run Setup — re-run check exists; no explicit re-baseline flow
- [x] **hardware-change detection** — wired into Check (Optimize→Fixes): advisory card names what changed + inline acknowledge/re-baseline (`acknowledge_hardware_changes`) so it never nags; live-verified 2026-06-24
- [x] override toggle — "Restore all (N)" bulk control in the Dismissed strip (Fix.tsx, ≥2 dismissed, reversible, zero IPC)
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
