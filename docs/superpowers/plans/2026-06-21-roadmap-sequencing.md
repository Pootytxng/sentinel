# Compy Feature Roadmap — Sequenced Plan of Action (Tab 2)

> Generated 2026-06-21 (Tab 2, parallel to Tab 1's `ui/home-restructure` lane).
> Source: the owner's "Feature Roadmap Checklist (CC Brief)". Analysis = a 17-agent read-only
> workflow (4 ground-truth maps → 11 module classifiers → synthesis → adversarial critic) cross-checked
> against the LOCKED safety rules, the hard tweak BLOCKLIST, and the Receipts Doctrine.
> **Status: PROPOSED — awaiting owner prioritization. No code written. No git ops. Nothing committed.**

---

## 0. Tab 2 ⟂ Tab 1 — non-collision protocol (the explicit first ask)

| Lane | Worktree | Branch | Posture |
|---|---|---|---|
| **Tab 1 (active)** | `C:/Users/Kuya/code/sentinel-qa` | `ui/home-restructure` | committing **today** (monitor-on default, Home/Learn/Lab polish) + live screenshot sweep `docs/ui-sweep/shots/lap2…9/` — **DO NOT TOUCH** |
| **this main worktree** | `C:/Users/Kuya/code/sentinel` | `tests/coverage-sweep-2026-06-18` | holds WIP I did **not** create (`Check.css` + untracked design docs) — **NO blind `git add`/commit here** |
| paused | `sentinel-agent`, `sentinel-benchmark` | `spike/backend-agent`, `latency-capture` | leave alone |

**Rules for any Tab 2 execution (not this planning pass — it writes zero code):**
1. Execution work gets a **fresh dedicated worktree** off `main`: `git worktree add ../sentinel-tab2 -b roadmap/<feature> main`. Never the main worktree, never `sentinel-qa`.
2. Git's own guard: the same branch can't be checked out in two worktrees → I physically cannot grab `ui/home-restructure`.
3. Before every commit: `git branch --show-current` + `git status` (per [[cowork-worktree-collision-guard]]).
4. All analysis used read-only Explore agents — provably no writes.

---

## 1. The headline reality

The checklist is large and **deliberately reversible/opt-in**, which fits Compy. But ~15% of it
collides with Compy's **frozen tweak catalog + hard blocklist**, the **outbound/telemetry boundary**,
and the **money/affiliate gate**. So this is not a flat to-do list — it's **dependency-ordered phases**,
allowed-now work first, gated work clustered with its sign-offs.

| Classification | ~Count | Meaning |
|---|---|---|
| **allowed-now** (read-only / advisory / content / measurement) | **~137** | ships under existing rules — no new gate |
| **gated-mutation** (writes Windows state) | ~9 | EXPANDS the frozen catalog → LOCKED-rule-6 owner product decision + own apply/rollback QA + welfare-check |
| **telemetry-boundary** (outbound network) | ~7 | stop-rule 3 → own spec + security review + owner sign-off; ships DARK |
| **money-gate** (affiliate / Pro / B2B / compy.gg) | ~9 | owner territory (money + distribution) |

**Critic-confirmed:** every hard-blocklisted item (timer/HPET, bcdedit, MMCSS, NIC-offload packs,
**core-parking WRITES**, Defender disable, MPO disable, fixed pagefile, TCP mega-packs) is correctly
**excluded**; all money is money-gated; all telemetry is boundary-gated; rollback-first + NVIDIA Rule-5
honesty respected. **Verdict: safe to build per this sequence.**

### Corrections applied (from the critic + CLAUDE.md ground truth)
- **`manual-mutation-qa-blocker` is CLOSED** (owner sign-off 2026-05-31). Gated mutations do **not** wait
  on it. Their real gate is **LOCKED rule 6** (expanding the frozen catalog = explicit product-owner
  decision) **+ each new mutating feature's OWN apply/rollback QA + a security/system-settings welfare-check.**
- **Monitor model detection (EDID / WMI `Win32_DesktopMonitor` read) = allowed-now**, not gated. Only
  DDC-CI *writes* (if ever proposed) become a new peripheral-write boundary needing security review.
- **NVIDIA Rule-5 honesty:** GPU profile *detection* + AMD *applies* are fine; **NVML sensor + any tuning
  temp readout stays "not yet hardware-verified"** until a monitored NVIDIA session proves it. No NVIDIA
  tuning guide may claim sensor data before then.
- **Bloat removal** excludes Defender disable + `HKLM\...\Policies` (blocklist + security-gate); UWP
  uninstall scoped to user-installed apps; scheduled-task disable carries a full snapshot/rollback.
- **Core parking, Speedshift/EPB, PBO, XMP:** read/detect = allowed; **writing any of them = forbidden**
  (catalog-freeze / blocklist) — surface state + advise, never toggle.
- **Owner's current focus** ([[focus-product-perfection-not-distribution]]): completeness/polish toward
  **1.0**, NOT distribution. → money/telemetry/distribution phases are **DEFERRED by default**; the active
  lane is product completeness.

---

## 2. The phased, dependency-ordered plan

### PHASE A — Allowed-now (no gate; the 1.0 product-completeness lane) — START HERE
Order chosen so each track unblocks the next; tracks A2/A3/A5 are independently parallelizable.

**A1 · Low-level DETECTION layer** *(foundational — unblocks most advisory + later gates)*
Read-only probes, each an advisory card on Check / Lab: core-parking state · XMP/EXPO active (SMBIOS vs
configured) · Intel Speedshift/EPB · AMD PBO · thermal-throttle (ACPI) · power-draw (clarify GPU ADLX/NVML
vs system WMI) · Hyper-V/VBS/SVM · S.M.A.R.T. health · USB device/lane tree (SetupAPI) · BIOS-tweak
availability annotation · firmware/BIOS date check · driver-freshness extended to all vendors + copyable
URLs · NIC driver freshness. **No writes, ever.**

**A2 · MEASUREMENT spine** *(the Receipts Doctrine backbone — unblocks upgrade-path + leaderboard)*
Benchmark before/after comparison (armed mode) · baseline set/clear · cross-session comparison · session
history w/ hardware snapshot · drift-regression advisory · local award/score ledger · hardware-tier
segmentation · percentile stub (display-only). Reuses `comparison.rs` + session-debrief; pure local.

**A3 · CONTENT reorg (Blackbook / Autopsy)** *(parallelizable; Phase-1 web-export groundwork)*
Entry audit + dedup · category/hardware tags · date-added/last-updated metadata · filter-by-category+verdict
UI · alias-collision lint + CI guard · deprecated/superseded status field · orphaned-`related[]` lint ·
Autopsy structured schema + "what did we learn?" rollup + local autopsy stats. All data/frontend.

**A4 · ADVISORY surfaces (read-only halves of the mutation modules)**
- *Monitor/Display:* OSD detection · 3-mode preset GUIDED checklists (A Visual Fidelity / B Smooth / C
  Clarity) as advisory cards + vendor-aware **walkthroughs** (reuse `walkthroughs.json`) · FreeSync↔VRB
  exclusion warning · Acer XFA253QZ hint card · refresh-rate / sRGB / gamma-vs-HDR / chroma debunk Learn
  entries · **monitor model detection (EDID/WMI, read-only)**.
- *GPU:* vendor profile **detection** + advisory badges (NVIDIA + AMD) · per-game/global scope picker (UI
  only) · before/after delta *display* · profile **export** (JSON) · version-pinned mismatch warning ·
  AMD undervolting **guide** (AMD-verified; NVIDIA/Intel guides withheld per Rule 5).
- *Services:* read-only service inventory by category · curated "safe-to-suspend" reference data ·
  use-case profile selector (Gaming/Streaming/Creation/Idle — localStorage) · service-drift detection
  (extend Leftovers) · recovery guide.
- *Peripheral:* mouse DPI/genre audit · debounce/Snap-Tap/Null-Bind/Rapid-Trigger detection · sensor ID +
  known-issue DB (bundled JSON) · wired-vs-wireless latency model · keyboard actuation/NKRO/Rapid-Trigger
  guide · USB-port recs · polling-rate read · interrupt-affinity *suggestion* (advisory). New Lab > Peripheral Audit.
- *Network (detection only):* connection-type classification · ISP speed snapshot (local) · network-readiness
  pills · Wi-Fi channel/interference · DNS resolution-time probe · powerline/MoCA Learn guides · QoS advisory.

**A5 · GUIDED SETUP & VERIFICATION + PARAMEDIC (read-only)**
Setup-Complete state machine · post-apply verification gate (re-run state probes) · green/yellow/red
confidence chips · exportable summary · Re-Run Setup (reuse `useScan`) · hardware-change detection ·
override toggle · drift-watch integration. Paramedic: historical-ledger surfacing · applicability check ·
obsolescence/superseded flags · before/after delta display · "last seen working on" hardware tag ·
per-tweak audit trail · ledger filter "this rig only" · measured-payoff linkage (read-only).

**A6 · UPGRADE-PATH advisory (no affiliate tags yet)**
Hardware-limited verdict detection (GPU ≥95% / HDD install drive) · build-upgrade-path function (single
source in `priorities.rs`) · session-qualified copy ("your most recent session measured…") · copy-only
buttons (NO webview URL opener) · plain retailer search links (no tags) + **mandatory disclosure render** ·
markdown-export anchors · test suite enforcing "no tags + disclosure always paired". Affiliate tags = Phase D.

### PHASE B — Gated mutations *(LOCKED rule 6 owner product decision + per-feature QA + welfare-check)*
GPU profile **apply** (AMD first — verified; NVIDIA after sensor verification) · profile **import**
(schema-validated) · GPU rollback (snapshot) · **service suspension** orchestrator (`sc stop`/`sc start`,
session-scoped, hard-blocked critical-services list, audio/USB/network flagged) + crash-restore recovery ·
**bloat removal** (scheduled-task disable + user-UWP uninstall + `HKCU\Run` cleanup; NO Defender/Policy) ·
one-click **re-apply** (limited to `APPLIABLE_REC_IDS`). Each: full typed snapshot+rollback, own QA harness
(`qa-harness` skill), welfare-check first.

### PHASE C — Telemetry / outbound *(stop-rule 3 — own spec + security review + owner sign-off; ships DARK)*
In-app bufferbloat/speed test SEND path (local runner can be built; gate=false) · jitter/packet-loss send ·
session network telemetry · Receipts opt-in consent UI + payload preview · service-suspension metrics ·
preset-efficacy A/B/C measurement · ISP/fiber ZIP lookup (opt-in geolocation).

### PHASE D — Money / distribution *(owner territory — DEFERRED per current 1.0 focus)*
Affiliate tag-swap in `priorities.rs` · affiliate links on Keep verdicts + NIC/router upgrade paths ·
compy.gg waitlist funnel (Phase 2) · Receipts telemetry arming (Phase 3) · leaderboard opt-in submissions
(Phase 3+) · Compy Pro multi-rig sync (Phase 5) · B2B fleet scoring (Phase 6).

---

## 3. Key dependency edges (interoperability)
- `upgrade-path` ← `measurement-spine` + `detection-layer` (never suggest a part without a measured signal)
- `benchmark-leaderboard` ← `benchmark-comparison` + `award-ledger`
- `gpu-profile-apply` ← `gpu-profile-detection` + owner catalog decision + own QA
- `service-suspend` ← `service-inventory` + curated safe-list + welfare-check
- `setup-verification` ← `history.json` applied state + Check state-probes; `hardware-change-detect` ← it
- `paramedic-reapply` ← `historical-ledger` + measured-payoff linkage
- `affiliate` ← Keep-verdicts + Receipts(Phase 3); `leaderboard` ← Receipts(Phase 3) + tier-segmentation
- `monitor-osd-presets` ← osd-detection; `model-specific hints` ← monitor-model-detection

---

## 4. New skills to author (per [[rigor-workflow-for-non-taste-tasks]] — build skills, avoid slop)
Near-term (Phase A): `service-inventory` · `peripheral-audit` · `network-profile` · `tuning-guide-author`
· `library-export` · `gpu-profile-detector` (+ `amd-profile-detector`).
Phase B+: `nvidia-profile-applier` · `amd-profile-applier` · `gpu-profile-importer` · `service-suspend-guide`
· `service-suspend-mutation` · `paramedic-audit` · `network-speed-test`.
Phase C/D (later): `network-upgrade-finder` · `affiliate-links-advisor` · `pro-sync-advisor` · `b2b-fleet-advisor` · `waitlist-marketer`.

## 5. Per-feature execution rigor (every item)
Brainstorm (if fuzzy) → spec → TDD → build in the isolated worktree → `/check` + `/security` → **`self-review`
visual pass** on any UI ([[always-self-review-visual-work]]) → cargo/npm green → commit (after branch+status
check) → report terse. Coordinate with Cowork's lane (strategy/specs/review) — don't duplicate.

## 6. Top open risks (full list in workflow output)
- Service-suspend "system-critical" definition → owner-signed HARDBLOCKED list (csrss/lsass/services.exe/
  Defender/Windows Update/…), conservative Do-Not-Touch default.
- "Clean baseline" fallacy → Paramedic read-only detects pre-existing tweaks; report rig as-found, widen CIs.
- NVIDIA sensor honesty → no tuning claims until a monitored session verifies NVML.
- Curated lists (safe-services, sensor DB, bloat verdicts) must be owner-curated, never LLM-generated (doctrine).
