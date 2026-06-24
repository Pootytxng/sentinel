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

## 🌿 Branch-integration health (a contributing cause)

At audit time the repo had **16 branches**; most feature work was already merged to `main` (branches showed
"ahead of main by 0"), but a few carry **unmerged commits** that look "done" in their REPORTs yet are NOT in
the product:

- `feat/a1-detection` — 5 commits ahead of main (likely superseded by `reconcile/a1-merge`, verify before deleting)
- `qa/locale-drift-hardening` — 4 ahead
- `gaming/honest-partial-undo` — 1 ahead
- `ui/honest-apply-errors` — 1 ahead (pushed to origin)
- The working branch `tests/coverage-sweep-2026-06-18` is **140 behind main** — a stale checkout, easy to mistake for current.

**Action item (A0):** reconcile/prune stranded branches so "merged into main" == "shipped." A branch whose
work is described as complete but sits unmerged is exactly how a session loses the thread.

---

## PHASE A — Allowed-now (the 1.0 product-completeness lane)

Legend: `[x]` shipped on main · `[~]` partial/thin · `[ ]` not built · `[⛔]` excluded by feasibility/design.

### A0 · Repo hygiene
- [ ] Reconcile + prune the stranded branches above; confirm `main` is the single product truth.
- [ ] Adopt this ledger as the persistent-workflow target (replace "continue the checklist" prompts).

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
- [~] local award/score ledger — recorded on Keep verdicts but **display-only**; no Arcade/drill-down UI — `benchmark_scoreboard.rs:131`
- [~] hardware-tier segmentation — `percentile_rank` exists but **unwired**; no budget/mid/high mapping
- [~] percentile stub — function tested, **never called**, no cohort data (needs Phase C network) — `benchmark_scoreboard.rs:60`

### A3 · CONTENT reorg (Blackbook/Autopsy) — **half built; missing entry metadata**
- [x] entry dedup lint — `knowledge.lint.test.ts:78`
- [ ] category + **hardware tags** on entries — only type-grouping exists; no hardware tags in schema
- [ ] date-added / last-updated metadata — no temporal fields on entries
- [x] filter-by-category + verdict UI — `Learn.tsx:578`
- [x] alias-collision lint + CI guard — `knowledge.lint.test.ts:98`
- [ ] deprecated/superseded status field — no lifecycle field on entries
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
- [~] refresh-rate / sRGB / gamma-vs-HDR / chroma debunk Learn entries — HDR+VRR only; sRGB/gamma/chroma missing
- [x] monitor model detection (EDID / WmiMonitorID, read-only) — `hardware.rs:1879`

**GPU**
- [~] vendor profile detection + advisory badges — vendor detected; AMD sensors verified, NVIDIA gated (Rule 5)
- [ ] per-game / global scope picker (UI only)
- [ ] before/after delta display (for profiles)
- [ ] GPU profile export (JSON)
- [ ] version-pinned mismatch warning
- [ ] AMD undervolting guide (AMD-verified; NVIDIA/Intel withheld per Rule 5)

**Services**
- [~] read-only service inventory by category — only 4 known services, no categorization — `history.rs:118`
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
- [ ] ISP speed snapshot (local)
- [ ] network-readiness pills
- [ ] Wi-Fi channel / interference
- [ ] DNS resolution-time probe
- [ ] powerline / MoCA Learn guides
- [ ] QoS advisory

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
