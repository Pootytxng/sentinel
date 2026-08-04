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

## 🎯 CURRENT PROGRAM CUTLINE — PRODUCT QUALITY STABILIZATION (owner request 2026-07-29)

> **This section wins on current product priority.** Full sequencing, dependencies, acceptance,
> conflict resolutions, and defer/reject rules:
> `docs/superpowers/specs/2026-07-29-product-quality-stabilization-program.md`.
> Live execution and claims remain in [Kuya Work Control](WORK_CONTROL.md); gate/release truth remains
> in [RELEASE_STATE.md](RELEASE_STATE.md). Historical priority sections below remain evidence, not the
> current pull order.

- [~] **Q0 — LabDeck glance-first presentation pilot:** Active in issue
  [#14](https://github.com/Pootytxng/sentinel/issues/14), default OFF; preserve the real RigViewer,
  essential measured gauges, comparison evidence, and the accepted decision-journey organization.
- [x] **P0 before the next release or wider beta — ALL THREE LANDED 2026-08-03.**
  - **Q1 privacy/storage/trust-copy truth** — shipped as v0.9.12 (issue
    [#59](https://github.com/Pootytxng/sentinel/issues/59)): absolute offline claims gone from both
    locales, the legal documents and the marketing site; `docs/PRIVACY.md` at v0.3; automatic update
    checks switchable off; `src/outbound-claim-guard.test.ts` fails the build on any absolute claim
    while an outbound surface is live. **Acceptance-list pass done 2026-08-04 (Cowork):**
    `docs/PRIVACY.md`/`site/privacy.html` wrongly named `%LOCALAPPDATA%\Compy\` for FPS runtime
    files (`fps_dir()` is `compy_data_dir().join("runtime")` = `%APPDATA%\Compy\runtime\`) and
    blanketed "Compy will recreate what it needs" over `history.json`, hiding that deleting it
    erases the Trust Ledger. Both fixed in both files; pinned by
    `src/privacy-data-dir-guard.test.ts`. en↔zh-CN parity spot-checked on the Trust-Ledger/
    deletion strings in `home.json` and the network-check line in `settings.json` — meaning
    matches; not a full line-by-line diff of all 8 locale-file pairs.
  - **Q2 main-vs-overlay command authority** — owner GO 2026-08-03, merged as
    [#62](https://github.com/Pootytxng/sentinel/pull/62). The overlay held all 91 custom commands
    and needed 3; `build.rs` now declares them via `AppManifest::commands` and the two capability
    files split main from overlay. Guard: `src/command-authority-guard.test.ts`. *Deferred by
    decision:* the per-command main-window caller check (the ACL already rejects before the body
    runs) — see #62 for the reasoning.
  - **Q3 FPS PID-recycle attribution** — merged as
    [#34](https://github.com/Pootytxng/sentinel/pull/34). Candidates must match pid AND name,
    `alive` is consulted on the frame path, and our pid under a foreign name is a recycle. Merged on
    code evidence (3 red → green, mutation-proven both directions, 891 cargo). *Open, owner/native:*
    a real game-close probe against an INSTALLED build carrying the fix — attempted 2026-08-03 and
    not possible, `compy.exe` was not running and `fps.json` was 12 hours stale. Rides the next
    install rather than blocking the merge.
- [ ] **P1 stabilization:** ~~reproducible local supply-chain/release gate~~ **Q4 DELIVERED** (issue
  [#35](https://github.com/Pootytxng/sentinel/issues/35)) — one command `powershell -NoProfile -File
  scripts/verify-release.ps1`, 14 checks, PASS/FAIL/BLOCKED/PENDING, reachability-classified npm +
  cargo audits with expiring acknowledgements, evidence pack JSON; see RELEASE_AUTONOMY.md → "The one
  local command". §11 property/fuzz coverage for persistence parsing + bounded IPC inputs also DELIVERED
  (issue [#37](https://github.com/Pootytxng/sentinel/issues/37)) — dependency-free fixed-seed generator,
  9 properties over the ledger, session file, elevated-command guards, mutation allowlists, batch
  receipts, and rollback-contract resolution. Open: Q5 local-only redacted support evidence (blocked on
  Q1's privacy vocabulary + a data-retention review) · Q7 native accessibility and measured
  performance budgets (blocked on a stable candidate + owner's machine). **Q6 DELIVERED 2026-08-04**
  (issue [#65](https://github.com/Pootytxng/sentinel/issues/65), `9bf3bde`) — three stale live claims
  retired: `GAMING_MODE_PLAN.md` reconciled against the QA record (8 rows mapped, 3 left unchecked as
  *unproven, not failing*), the 2026-07-06 launch runway archived verbatim with its "no real UI gaps"
  sweep claim, and "every branch has a verified disposition" made true rather than retired — all 20
  origin branches dispositioned in `docs/BRANCH_DISPOSITIONS.md`, enforced by
  `scripts/branch-disposition-audit.mjs`.
- [ ] **P2 product completion:** owner-accepted canonical Lab + reversible generation pruning →
  first-win action/rollback/proof journey → Consumer/Technical/Support evidence exports.
- [ ] **LATER:** Intelligence Phase 4/5, vendor-awareness expansion, Receipts/crowd intelligence,
  remote rules, Pro/affiliate/B2B, and model-assisted explanation remain behind the blueprint's gates.

---

> **🧰 TOOLCHAIN — Fable-window persistence pack** (2026-07-06) — COMPLETE 2026-07-07: all 4 items shipped; living pointer = CLAUDE.md → PROJECT SKILLS INDEX. Moved verbatim to `BACKLOG_ARCHIVE.md` (2026-07-22 tier-1 board diet).

## 🚚 LIVE UPDATER — SHIPPED (owner directive 2026-07-22) + FIRST FIELD-QA WAVE (reviews 2026-07-22)

- [x] **Live in-app updater — SHIPPED + E2E-PROVEN** (`135d609` feat · `a6d1508` v0.9.2 · `90fc73e`
  v0.9.3): endpoint `Pootytxng/compy-releases` `releases/latest/download/latest.json`; consent-first
  topbar UpdatePill (offer → progress → passive NSIS → auto-relaunch; zero chrome when idle); footer
  honesty copy "Outbound: signed update check only" (test-pinned); minisign key OUTSIDE repo;
  `scripts/release.ps1` pipeline + `scripts/e2e-updater-probe.mjs` CDP probe. **Proven live on the
  owner's rig: 0.9.2 self-updated to 0.9.3 through the updater.** Full state: RELEASE_STATE 23a
  banner. Owner leftovers: key backup + first-link send (OWNER_ACTION_CHECKLIST §A0).

**Tester reviews 2026-07-22 (J + Matthew, on the 0.9.0 build) — each item rides normal triage; fixes
now SHIP through the updater.** J also praised: more organized, less overwhelming, loves controlled
experiments + logbook. Matthew praised: guided-setup rail line, simple home, Optimize clarity,
"What's this" on Telemetry Tasks.

- [x] **Default window too small (multiple testers + owner 2026-07-23)** — ✅ SHIPPED v0.9.4
  (`23ff847` feat · `419ec81` release), delivered to the owner's box THROUGH the updater: first-run
  default 800×600 → 1280×720 centered, plus `tauri-plugin-window-state` so the size/position the
  user sets persists (overlay denylisted). Restore path live-proven (state-file round-trip).
- [x] **J: bigger 3D PC window** — ✅ SHIPPED v0.9.6 (`5c74ba2`/`29e5217`, through the updater):
  Home stage 420→540, live canvas 362→482px; cards-band guard upgraded to DERIVE its bound from
  the stage css (drift-proof).
- [x] **J: cursor consistency** — ✅ FIX ALREADY SHIPPED (reticle.css `cursor: none !important` on
  a universal descendant selector, which is required because an explicit same-element
  `cursor: pointer` beats an inherited `cursor: none`). It had **no guard**; added
  `src/design/console/reticle-cursor-contract.test.ts` (`e2f1322`) pinning the selector, the
  `!important`, both escapes (text entry, `:disabled`) and the z-index band. Matthew's separate
  "square crosshair is a little weird" is a TASTE call on the reticle's shape and stays OPEN as
  owner territory — it was never the same defect as the two-cursor bug.
- [x] **J: "1 safe tweak not applied" is a dead end** — ✅ SHIPPED 2026-08-03 (`17d5f84`). The
  detail was never missing: `apply_recommendations_batch` already returns `{ title, reason }` per
  skip and HomeConsole discarded it one line after arrival, keeping only `.length`. The receipt now
  retains the items and offers a subordinate disclosure naming each skipped tweak with the reason
  the batch primitive gave (never synthesised here). Copy in en + zh-CN. bug→guard:
  `src/surfaces/fastpath-skipped-detail-guard.test.ts`, proven both directions. **NOT taken:**
  apply/ignore inline — a skip can come from a failed elevated step, so re-applying needs the
  elevation flow rather than a button; larger than the dead end it would close.
  **Visual self-review ✅ PASS 2026-08-04** (supersedes `17d5f84`'s "NOT RUN" note and the earlier
  OUTSTANDING line here): captured natively via a live-fixture mount of the real HomeConsole with a
  skip-bearing batch receipt — no machine mutation. 7/7 rubric PASS. One flag, not new to this diff:
  the skip-reason line inherits the muted caption token at 3.44:1 on 12.5px — sub-AA for body text,
  but it is the same token already shipping one line above and it clears the deliberate AA-large
  floor `src/theme-contrast.test.ts:100` pins for `--ix-text-3`. Raising that floor is a theme-hex
  call (owner territory), so it is logged here, not changed under a T4 review.
- [x] **J: post-check routing** — ✅ ALREADY SHIPPED (found 2026-08-03, stale entry). FirstCheck
  renders "Take me to the Lab" beside "Open the dashboard" and deep-links the Optimize station via
  the one-shot `compy_lab_open_station` handoff (App writes before `navHome("lab")`; LabConsole
  reads + clears on mount). It had **no guard** — added `src/surfaces/post-check-lab-route-guard.test.ts`
  (`06c047a`), which pins all three halves; the `removeItem` is load-bearing (without it every later
  Lab visit force-opens Optimize). 🔻 **NEW, logged not fixed:** FirstCheck's CTA copy and verdict
  prose are hardcoded English — that surface is un-i18n'd, so zh-CN users read English.
- [x] **J: "Needs your call" cards not interactive** — ✅ SHIPPED v0.9.6+v0.9.7: whole card head is
  a door (chevron, hover accent), opens the guided steps or an HONEST no-switch answer; What's-this
  + bordered Not-for-me in a visible actions row. Live-verified via CDP (6 doors, no-guide case).
  **Test-debt:** a DOM guard for the door behavior is NOT yet written (live-verified only) — add to
  `optimize-v2-ia.test.tsx` next pass. Apply-from-card stays absent BY DESIGN (no safe switch).
- [x] **J: per-room accents read as INCONSISTENCY** — ✅ RESOLVED per owner taste call 2026-07-23
  ("apply to all"): SHIPPED v0.9.5 (`67541e4` feat · `ac518f1` release) through the updater — one-tap
  "Apply to all rooms" in the accent picker; per-room freedom intact. Live-proven + owner state
  restored. UI_VISION_BACKLOG NAV-1 (a) has the record.
- [x] **Matthew: Guided-Setup copy** — ✅ SHIPPED v0.9.6: the rail-orientation line now rides the
  FIRST step (mode-aware, 3 new setup-steps guards; recap still closes with it), and every lesson's
  tweak list reads "Settings Compy **can** tune here" + a nothing-changes-during-the-tour fine line.
- [x] **Matthew: Field Guide explanation placement** — ✅ SHIPPED v0.9.6: the guide introduces
  itself on its own tab (`bbv2-guide-lede`) and the intro's Blackbook blurb names it.
- [x] **Matthew: non-admin old-tweaks check "Couldn't check" lines** — ✅ SHIPPED v0.9.6: grouped
  in a calm bordered aside with an honest head ("N settings couldn't be read this pass — no guesses
  made") + the design-philosophy note ("Compy doesn't ask for admin rights just to look"). The
  guard-pinned per-item line format is preserved; the blanket run-as-admin recommendation was
  deliberately NOT taken (conflicts with the consent-first elevation doctrine).
- [x] **Matthew: bottom expandable rows too "quiet"** — ✅ SHIPPED v0.9.6: `.lab-optimize-more-summary`
  restyled from inline mono-caps links to full-width bordered door rows (matching the group-head
  grammar above); still subordinate to the enable-all hero. Deliberate revision of the earlier
  demote-spec, owner-backed.

## 🧠 INTELLIGENCE PLATFORM LANE (owner directive 2026-07-16 — supersedes priority ordering per its §0.12)

Owner-approved direction: evolve Compy into **evidence-based PC performance intelligence** — the
measurement layer that can say *what changed, what likely caused it, and what to test next*, from
local records only. In-git anchor: `docs/superpowers/specs/2026-07-16-intelligence-foundation-train1.md`
(the Intelligence Phase 1 spec; the directive itself is a Cowork-lane review artifact, not committed).
**Namespace rule: phases in this lane are always written "Intelligence Phase N"** — never bare
"Phase N" (Optimization Cleanup owns a separate Phase 0–3 sequence; the two numbering schemes must
never be conflatable in any doc, commit message, or report).

- [x] **Intelligence Phase 1 — foundation + "What changed?" (read-only vertical slice)** — ✅ BUILT
  this cycle (hashes in Cycle 2026-07-17a): `intelligence.rs` canonical domain layer + local event
  timeline (from existing persisted data ONLY — never fabricates historical events) + deterministic
  two-session "What changed?" engine (fixed hypothesis catalog; enum confidence bands
  unknown/low/medium/high, never numerics; never causation-from-precedence) + first surfaces
  (Monitor SessionDebrief WhatChangedPanel · Blackbook logbook observed rows · Home last-session
  line) + expert view + anti-fabrication guards. Flag `compy_intelligence` DEFAULT ON ("0" failsafe
  test-pinned). Zero mutation, zero network, zero capability change.
- [x] **Intelligence Phase 2 — patterns, good-vs-bad, evidence graph** — ✅ BUILT + SHIPPED this
  cycle (`9c6af4b` backend · `094d834` frontend; installer SHA-256 `3EB0FAE5…C570D838`, live exe
  stamp-verified `094d834` clean). Spec `docs/superpowers/specs/2026-07-17-intelligence-phase2-train2.md`.
  Delivered: `intelligence_patterns.rs` six cross-session detectors (trend/thermal/memory/driver/mode/
  fade, passive-capped at Medium, §0.12 coverage reasons) · `what_changed_between` (§4D last-good-vs-
  first-bad) · EvidenceGraph re-projection (§4C, no new data, no causation language) · `drift.json`
  ingestion (external reverts as observed events) · `AppliedChange.rolled_back_at` (additive
  `#[serde(default)]` stamp, rollback logic unchanged). Surfaced Expert-view only (`compy_expert_view`
  default OFF): SessionInvestigator + evidence graph (Monitor), PatternsTile (Blackbook §5E, no fifth
  room); plain view unchanged. Read-only + one additive field — zero mutation/network/capability change.
  cargo 787/787 · clippy clean · vitest 1710/1710 · rust-tauri-reviewer PASS · self-reviewer PASS.
- [x] **Intelligence Phase 3 — experiment engine + optimization simulator** — ✅ **ARMED + SHIPPED**
  2026-07-17 (owner-signed "Ship it live now"). Groundwork built dark `7e00a06`; arming flips
  `experiment_gate() -> bool { true }` (`experiment.rs:55`) + wires `build_sim_context` to the REAL
  hardware-tailored catalog + converts the two dark tests to armed reality + interactive `ExperimentBench`
  FE (Lab room). Spec `docs/superpowers/specs/2026-07-17-intelligence-phase3-experiment-engine.md` §7.
  The engine ORCHESTRATES the existing mutation boundary (**no new apply/rollback primitive, no enum
  variant**; applies via `history::apply_recommendation`, restores via `history::rollback_change`, resolve
  stays history-only) · delta judged on the SAME 3% floor (`comparison::classify_with_guards`) · simulator
  reads the catalog READ-ONLY (unknown rec ⇒ honest insufficient-evidence, never a fabricated verdict).
  Mutation-gate 10/10 + rust-tauri-reviewer PASS + live apply→rollback round-trip on the rig + Cowork
  audit flagged. **The owner's first real gaming-session experiment IS the live FPS→verdict QA** (real
  frames are the owner's to produce — anti-fabrication law). Installer + stamp in RELEASE_STATE Snapshot.
- [x] **Intelligence Phase 3 fast-follow (W2 — UX staleness):** ✅ FIXED `f558d1d`. `ExperimentBench`
  now re-runs its simulator read on window/tab refocus, so a pick that became already-applied during the
  same Lab visit re-derives to the honest `already-configured` verdict card (Start withdrawn) and STAYS
  VISIBLE in the picker via the new `options` list rather than vanishing. Never a correctness bug —
  server-side `build_sim_context` already re-derived `already_active` from the ledger at start, so a stale
  pick could never double-apply; this closes the staleness window. Guard: `ExperimentBench.test.tsx`
  "re-derives the active pick from the live ledger on refocus" (6/6). (W1, the reselect race AT the apply
  boundary, was FIXED + guard-tested pre-ship: the picker locks during `simBusy` + request-id sequencing
  drops superseded reads + the sim card names its exact mutation target — `ExperimentBench.test.tsx`
  "locks the change picker while a simulation is in flight".)
- [x] **Measurement Platform 2.0 follow-up — treatment-side game-match check (additive, V1 limitation) — SHIPPED 2026-07-18.**
  The controlled experiment (`ExperimentBench`) captured a `GameStateFingerprint` at **baseline** but did
  NOT re-check the game/process on the **treatment** side, so a game-swap mid-run (quit the game, launch a
  different one between baseline and treatment) was **not provably excluded from stored data**. **Shipped
  fix (additive, safe-default, read-only advisory):** `conclude_experiment` now takes an optional
  `treatment_game: Option<String>` (the treatment session's `process_name`, which the FE already has via
  `treatmentFor`'s same-game filter — the game identity is the ONE axis that can realistically swap within a
  single sitting; rig/driver/res are held constant by construction, §1 of the decision doc). `conclude_outcome`
  runs a pure `game_match(baseline, treatment) → GameMatch` check at **top precedence, before crash + sample
  gates**: `Mismatch` ⇒ `not-comparable` verdict, restore (`keep=false`), **Unknown** confidence, plain-English
  "measured a different game … not enough comparable evidence"; `Unverified` (either side blank/absent) proceeds
  but drops the same-game claim; `Match` earns the "same rig and game" note. **Defense-in-depth** — the FE
  same-game filter stays, but the backend no longer trusts it (mirrors the `MAX_TEXT_LEN` webview-trust-boundary
  posture). No apply/rollback mutation, no network, no gate change. Guards: 5 new cargo tests +
  `not-comparable` added to `no_verdict_note_ever_carries_a_numeric_confidence` + an `ExperimentBench.test.tsx`
  render guard (the `not-comparable` verdict is unreachable in the live UI by design, so its label is vitest-proven).
  Decision doc `docs/decisions/2026-07-18-experiment-comparability.md` §3/§4 updated to CLOSED.
- [ ] **Measurement Platform 2.0 follow-up — `next_test` → experiment structured routing (additive).**
  A leading hypothesis's suggested next test is **free prose** (`next_action` / `next_test` strings) with no
  machine-readable rec-id, so "run the supported next test" cannot be wired into a pre-loaded `ExperimentBench`
  pick without **fabricating** a prose→catalog-rec mapping (a no-fabrication violation). Deferred until the
  hypothesis engine can emit a real, OPTIONAL rec-id where a safe mapping provably exists; until then the
  connection stays a plain-language instruction, not a button. Decision doc
  `docs/decisions/2026-07-18-prove-a-change-overlap.md` §5. No mutation / network / gate change.
- [ ] **Measurement Platform 2.0 follow-up — comparability vocabulary chrome convergence (cosmetic).**
  "What Changed" and `ExperimentBench` now share the comparability WORDS at the domain level (Task G surfaced
  `SessionComparability` in the shared `WhatChangedReportView`); a later pass could unify their visual chrome
  (badges / section labels) into one shared component vocabulary. Cosmetic, additive. Any **surface-level
  reshape** (merging/renaming the "prove a change" rooms themselves) is **owner territory**, not autonomous —
  logged so the option stays visible. Decision doc `2026-07-18-prove-a-change-overlap.md` §1/§5.
- [~] **Intelligence Phase 4 — hardware-twin intelligence integration (IN PROGRESS):**
  - [x] **Component-level evidence highlighting (slice 1)** — ✅ BUILT this cycle. `component_evidence.rs`
    is a READ-ONLY projection: it re-keys the existing Intelligence Phase 2 pattern findings
    (`intelligence_patterns::detect_patterns`) BY the hardware component each names (memory-trend → Memory;
    thermal-trend / driver-split → GPU), inventing no evidence and reaching no conclusion the Patterns tile
    doesn't. `HardwareGrid` lights a component card ONLY when a real pattern implicates it — accent border +
    label dot + an expandable evidence disclosure (band · non-causal headline · reasons · suggested next
    test) at that pattern's own confidence band (passive-capped at Medium, never High). Flag off or a fetch
    failure ⇒ fully neutral, never a fabricated glow. Command `get_component_evidence`; zero mutation /
    network / capability change. Guards: `HardwareGrid.test.tsx` (lit / neutral / fetch-fail / band-class) +
    `component_evidence.rs` 10 tests + the `.card.card-lit:hover` cascade guard in `border-hygiene-guard.test.ts`.
    cargo / clippy / vitest / tsc green · self-reviewer PASS (§4H, 9/9). Invisible on a rig with no qualifying
    session pattern yet (correctly neutral until evidence accrues) — that IS the design.
  - [x] **CPU thermal-peak tracking (hardware-health trends, slice 2)** — ✅ BUILT this cycle.
    `SessionAccumulator::record_thermals` (`sessions.rs`) tracks per-session `peak_cpu_temp_c` /
    `peak_gpu_hotspot_temp_c` as a running max-so-far — a tick with no reading holds the prior peak,
    never fabricates one — threaded through `SessionSummary` and `types.ts`. New `cpu-thermal-trend`
    cross-session detector (`intelligence_patterns.rs`, alongside the existing GPU thermal-trend)
    fires only once ≥`MIN_TREND_SESSIONS` sessions carry a real peak reading, silent otherwise;
    Medium confidence only on a sustained multi-session move, Low on a small/short one. cargo
    869/869 · tsc clean · vitest 1777/1777.
  - [ ] long-term personal knowledge graph (remaining Phase 4 slice).
- [ ] **Intelligence Phase 5:** evidence-based Upgrade Advisor 2.0 · "buy nothing" verdict ·
  technical prescription contract · consumer report and shop-report exports. (Subsumes the
  evidence-export-tiers item in PHASE A below and UI_VISION_BACKLOG §F upgrade-path engine —
  one lane, not two; both entries annotated at source.)
- [ ] **Intelligence Phase 6:** optional crowd intelligence · only after explicit security/privacy/
  owner gates · no work in the current train.
- [x] **Home HUD: rig-tier / corner-gauge text overlap (pre-existing defect, unrelated to the intelligence
  lane).** ✅ FIXED 2026-07-18. The self-reviewer (Intelligence Phase 4 §4H re-review) found `.hc-corner`
  ArcGauges overlapping `.hc-stage-cards` content on the Home HUD stage — intermittent because it only
  reproduces in 2D card view (`compy_home_rig_3d="0"`; the default 3D hologram leaves the corners clear)
  AND only when the HardwareGrid is tall enough to scroll rows into the gauge bands, so it was proven
  independent of the §4H diff (NOT a regression). Root cause: the four corner gauges are always-present
  (z-index:2, pinned 22px from each stage edge, ~56px tall) while `.hc-stage-cards` was a full-height
  (max-height:420px) scroll viewport, so a tall grid scrolled its rows UNDER the top/bottom gauges. Fix:
  confine `.hc-stage-cards` to the gauge-free MIDDLE band (max-height 420→240px) — `home-console.css`.
  bug→guard: two mechanized guards in `home-console.test.tsx` (a 2D-mode DOM coexistence check + a
  CSS-contract bound proving the viewport can never span the full stage again). Self-reviewer PASS:
  5.9–11px clear gaps measured top and bottom at both scroll extremes; 3D path unaffected.

**§0.12 demotion flags (owner reviews; nothing dropped without a trace):** open items below that
neither feed nor serve the intelligence platform are flagged 🔻 at their entries — five as of
2026-07-17 (curated safe-to-suspend data · debounce/Rapid-Trigger detection · sensor-ID DB · ISP
speed snapshot · DNS probe), each already blocked on its own gate, so demotion changes nothing
today. **NOT demoted:** Optimization Cleanup (separate lane per directive §0.11 AND a data source
for this platform — external drift + tweak-pack residue become timeline events) · pre-room intent
router + basic-mode simplification (complementary consumer-clarity work per directive §9 — stays
queued).

> **🔥 TOP PRIORITY LANE** (de-slop directive 2026-07-05) — CLOSED 2026-07-06: every item [x], Instrument-HUD reskin shipped (`394dd2f`/`96febda` live). Live UI truth = `UI_VISION_BACKLOG.md` + `RELEASE_STATE.md`. Moved verbatim to `BACKLOG_ARCHIVE.md` (2026-07-22).

> **🚀 LAUNCH RUNWAY** (Cowork consolidation, 2026-07-06) — ARCHIVED 2026-08-04 (Q6): a point-in-time consolidation whose sweep claims ("zero open code stubs", "no real UI gaps") and gate line numbers had drifted. Its still-live content is owner-gated and tracked where it belongs — RUNG 3 (private-beta send) and RUNG 4 (signing · legal · repo rename + `compy.gg`) in `OWNER_ACTION_CHECKLIST.md`; gate truth in `RELEASE_STATE.md`; UI truth in `UI_VISION_BACKLOG.md`. RUNG 2 closed 2026-07-08. Moved verbatim to `BACKLOG_ARCHIVE.md` (2026-08-04).

## 🛰️ HQ STEERING LOG — live lane board (newest on top)

> **Retention rule (2026-07-13):** this board keeps only the newest ~12 cycles. Older cycles live in
> `docs/BACKLOG_ARCHIVE.md` (same format — grep there for history). When appending a new cycle, move
> the oldest one(s) out if the board exceeds ~12 entries.

> ### 🛑 OWNER DECREE 2026-07-16 (via Cowork, owner at the console): AUTO-DEPLOY LANE DROPPED — do not resurface
>
> The GitHub-Actions auto-deploy errand (Cloudflare token + GitHub billing unblock, Cycle
> 2026-07-16e below) is **dead, permanently, by owner decision.** Facts established live in the
> owner's GitHub dashboard before the call: no failed payment, billed $0; Actions blocked since
> Jul 9 by the account's $0 Actions budget (stop-usage on); **$12 of ~$16 included free minutes
> already burned this month** — so "costs nothing" was not guaranteed, making this a zero-budget-law
> spend gate, and the owner declined. **Standing consequences:** ① the workflow file may stay in the
> repo (it fails politely) but do NOT ask the owner for the Cloudflare token, a billing change, or
> any budget raise again — the OWNER_ACTION_CHECKLIST item for the token paste is CANCELLED, remove
> it on next touch; ② manual `wrangler pages deploy` under the standing B3 deploy GO remains THE
> publishing path; ③ revisit ONLY if the owner raises it himself (the named trigger he accepted:
> multi-day absence where the site must update unattended).

### Cycle 2026-08-03a — ✅ STANDING AUTONOMY GRANT + Q2b TRIPWIRE · ⚠️ #60 part 2 REFUTED TWICE: `bb390cf` · `7013602`

- **Owner grant (`bb390cf`).** Kuya: he green-lights ~99% of what agents stop to ask about, so the
  stopping is itself the defect. `docs/RELEASE_AUTONOMY.md` now carries the standing grant (binds
  every lane) and `.claude/hooks/stop-continue.mjs` `MAX_CONTINUES` rises 2→8. Still stops: secrets/
  signing keys · authenticating as him · anything reaching another person's machine · spending ·
  destructive Git + frozen beta refs. **Rigor untouched** — the grant removes check-ins, not
  verification.
- **Q2b tripwire (`7013602`)** — `src/q2b-deferral-tripwire.test.ts`. #64's deferral of the
  in-command `require_main()` still holds (all four triggers unmet), so this mechanizes the
  *premises* instead of implementing the check: no window may load a remote origin, and the
  production CSP may not widen. Proven both directions. Trigger 3 already lives in
  `command-authority-guard.test.ts`; trigger 4 is not statically detectable.
- **Baseline re-verified after a disk sweep cleared `node_modules` + `target`:** cargo 891/891 ·
  clippy clean · vitest 272 files / 2991 · tsc 0 · encoding-guard 1176 · verify-release-state 24/24
  zero drift · module-map 44 · doc-budget ALL PASS.
- **Real defect caught by the staleness guard:** `dist-site/` (gitignored deploy staging tree) still
  carried BOTH errors `ad4f150` fixed in `site/privacy.html` — the wrong FPS path
  (`%LOCALAPPDATA%\Compy\` vs `%APPDATA%\Compy\runtime\`) and the blanket "Compy will recreate what
  it needs" that hides `history.json` deletion erasing the Trust Ledger. That commit fixed the
  source and never re-staged. Re-staged; guard 4/4. **Deploying it is a publication act — NOT done.**
- **✅ issue [#60](https://github.com/Pootytxng/sentinel/issues/60) BOTH PARTS RESOLVED
  (`c7c60d3` fix · `9e48bbf` ship record · `97e00fd` behavioural guard).** Part 2 WAS real — my
  earlier "not reproducible" call was wrong and is retracted on the issue. Reproduced live:
  ship-reinstall completed all its work and the wrapper had to be killed at 600s; under the fix the
  same command returned in **4s, exit 0**. Cause: a CreateProcess launch hands the child our
  stdout/stderr (`bInheritHandles=TRUE`) and the installed app is meant to outlive the script, so it
  held the *outermost* caller's pipe — bounding one middle link never fixed the chain. Fix:
  `Start-NativeProcess -Detached` (ShellExecute; `Start-Process` is correctly banned by the
  process-bypass rule, so the capability went INTO the abstraction). The debug-port guarantee was
  **strengthened** — ShellExecute cannot carry a child-only env, so the silent
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` clear became a LOUD assertion that it is absent, with
  `-Detached`/`-Environment` mutually exclusive by contract. 🔻 **Self-caught:** the `linger` fixture
  added in `df8e48a` was never registered in FAKE_GH's known-mode list, so that guard passed
  VACUOUSLY; found only because the new inherited-case assertion demands the opposite outcome.
  A guard whose fixture cannot fail reads as coverage and is worse than none.
- **(superseded) issue #60 part 1 was DONE and stale on the issue** (bounded retry in `release-transaction.ps1` + guard `release-transaction-e2e.test.mjs:90`,
  both already on `main`). **Part 2 (phantom prove/publish hang) remains OPEN with two hypotheses
  measured and REFUTED** — `-NoInheritStreams`, and bounding the parameterless `WaitForExit()`.
  Decisive: an inner script run with **no wrapper pipe at all** still took 9106 ms. Stream
  inheritance is not the mechanism; the launching PowerShell does not terminate until the launched
  app exits. A 223 ms reading that looked like a fix was an artifact of an unknown-parameter error —
  flagged on the issue so it is not re-derived as evidence. Nothing kept; tree clean.

### Cycle 2026-07-28a — ✅ RELEASE AUTONOMY + RESUMABILITY REPAIR → **v0.9.11 PUBLISHED**

- Live verification superseded the 2026-07-27a release snapshot below: source `main` and source tag
  v0.9.10 already resolved to `92c7608`; the owner machine already ran 0.9.10; and
  `compy-releases` already held a tag plus byte-correct **private draft**. Public latest and the
  updater manifest remained v0.9.7.
- The immutable v0.9.10 candidate is preserved at
  `C:\Users\Kuya\code\compy-release-evidence\2026-07-28-v0.9.10-private-draft-92c7608\`.
  The release-engineering repair must land after its tag, so the next publishable candidate was
  v0.9.11. v0.9.10 was never published; the publish train left it untouched, and its abandoned
  release debris was cleaned up afterwards (below).
- **Publish outcome (owner GO, 2026-07-28):** **v0.9.11 / `7ba5fb6` is PUBLIC** — release id
  `361056355`, `draft:false`, `prerelease:false`, published `14:44:17Z`; installer SHA-256
  `bb2b85a4…5438384f` and manifest SHA-256 `6bcd6cea…b76b007` both byte-match the signed receipt;
  updater signature verifies; public manifest now serves `0.9.11`; owner box runs `0.9.11` /
  `7ba5fb6 · release · shell 0.9.11`. Resumable transaction **complete 9/9**, closing on
  `public_assets_verified`. Three tooling repairs landed with it (`03c41e8` list-not-tag release
  lookup · `b6a50fa` PS 5.1 nested-JSON prerelease misparse · `c0fed45` latest-alias propagation
  wait).
- **A0 canary: PASS.** A tester completed it through Compy's normal public updater and runs
  **v0.9.11**; no updater failure was reported. Nothing else about that run was recorded (no prior
  version, timestamp, or per-step detail) — do not infer any. The canary is closed; widening to the
  remaining invitees stays an owner distribution call.
- **v0.9.10 release debris removed (owner-authorized, 2026-07-28).** The abandoned private draft
  `360948018` and the releases-repo tag `v0.9.10` were deleted (HTTP 204 each) after confirming no
  release depended on the tag — every `compy-releases` tag points at the same content commit
  `a628c9b`. Post-cleanup: no v0.9.10 release or tag in `compy-releases` (404), public latest still
  `v0.9.11`, manifest still `0.9.11`, installer hash + updater signature still verify, source tag
  `v0.9.11` still bound to `7ba5fb6`. **Preserved untouched:** source tag `v0.9.10` → `92c7608`,
  recovery branches, and the local evidence directory.
- **Release train closed.** v0.9.11 transaction complete 9/9 · A0 canary PASS · debris removed ·
  provenance preserved · **no active release blocker remains — normal product development resumes.**
- Durable authority lives in `docs/RELEASE_AUTONOMY.md`: failed reversible gates trigger
  preserve → diagnose → guard → repair → commit/push → resume. Only fleet-visible publication,
  distribution, secrets/key rotation, security settings, destructive Git, spending, and
  irreversible out-of-scope choices stop for the owner.

### Cycle 2026-07-27a — ✅ FORENSIC RECONCILIATION + SILENT-CORRUPTION REPAIR (CC): `15efc54` + `27c5f4b` on `chore/ci-encoding-and-state-truth` — **unpushed, unmerged**

- **Two silent defects, both now guarded.** (1) **Mojibake:** `scripts/release.ps1` read-modify-writes
  5 files per version bump; under **Windows PowerShell 5.1** `Get-Content -Raw` decodes BOM-less files
  as CP1252, so the UTF-8 writer double-encoded them. Reproduced on this host (em-dash → `c3 a2 e2 82
  ac e2 80 9d`). Fixed at the source with `Read-Utf8`; repaired 690 lines across
  `RELEASE_STATE_HISTORY.md`, `.claude/skills/INDEX.md`, `Cargo.toml`. `333b725` ("demojibake") had
  fixed 2 of 44 lines and closed the item — a human eyeball already failed on this class.
  Guard `scripts/encoding-guard.mjs` + 10 tests (runs in CI via `npm test`); 1020 tracked files clean.
  (2) **Unverified state anchor:** `source_main_commit=cff77ab` while `origin/main` was 16 commits on
  at `20306bc`, and `verify-release-state.mjs` passed — it checks where a citation LIVES, never
  whether the value is true. 3 anchors re-stamped; new check (6) resolves the commit, requires
  mainline ancestry, fails past `MAX_ANCHOR_LAG=10` (16 commits accrued in ONE day, so a loose bound
  would have missed this), and skips-not-fails on shallow clones.
- **🔴 Unpushed release, owner-gated.** Local `main` = `d9ced24` "release: v0.9.8" + annotated tag
  `v0.9.8`, **neither on origin**. The owner's live app IS that build (embedded stamp `d9ced24`,
  exe 0.9.8) — **his running app is reproducible only from this clone**, and corresponds to no
  published release. Registry `DisplayVersion` still reads 0.9.7 (stale vs the binary; the embedded
  stamp is truth). Push/publish/tag = owner territory, deliberately NOT done.
- **zh-CN reconciled.** Base cut (`100ace3`,`e22be5e`,`719408b`,`c51f3bb`) **is** on `origin/main`;
  the checklist there reads stale only because its correction sits in **`2461106`
  ("finish zh-CN verdict vocabulary"), the one commit still unmerged on `i18n/zh-CN`** (real delta —
  merge-tree ≠ main tree). ⚠️ **Merge-time correction required:** that commit's checklist adds
  "⏳ Restore hosted CI" — which is the **$0-Actions-budget item the OWNER DECREE above permanently
  declined.** Drop or re-word it to "CI stays red by owner decision" when merging; do not re-ask.
- **Gates (local, all green):** doc-budget PASS · encoding-guard 1020 clean · verify-release-state
  24/24, 0 drift · hooks-selftest 38/0 · cargo test 870 pass/0 fail · clippy `-D warnings` clean ·
  vitest 196 files/1855 tests · `npm run build` ✓ · `release.ps1` parses. **Hosted CI cannot confirm
  any of it — Actions blocked since Jul 9 by the owner's $0 budget (decree above). Local IS the gate.**
- **Next:** owner call — push `chore/ci-encoding-and-state-truth`, and decide the `d9ced24`/`v0.9.8`
  publish. Nothing here was pushed, tagged, merged, installed, or distributed.

### Cycle 2026-07-17a — ✅ INTELLIGENCE PHASE 1 SHIPPED (CC, owner directive `docs/reviews/2026-07-16-owner-directive-intelligence-platform.md` §5): `8f612d2` foundation + What-Changed read-only slice · `d45bb1c` game-name class sweep (bug→guard) · LIVE `d45bb1c`

- **Train `8f612d2` (23 files, +3984/−28):** new `src-tauri/src/intelligence.rs` domain layer
  (identity snapshots · change events · confidence bands **unknown/low/medium/high ONLY**, no
  numerics) + 3 query commands (`get_intelligence_timeline` · `what_changed_for_session` ·
  `get_intelligence_headline`) + the FE What-Changed engine + surfaces behind `compy_intelligence`
  **default ON**. Deterministic/inspectable/local; zero telemetry/network/account/remote; NO
  mutation-boundary change. 28 new Rust guards + FE pins. Honesty note for future writeups: the
  query commands are NOT literally pure reads — each calls `refresh_identity_snapshots_async()`
  which may write `intelligence.json` (own store only, throttled, mutex-guarded, atomic
  tmp+rename); `monitoring.rs` gains a per-tick `load_session()` BEHAVIORAL additive read
  populating `SessionSummary.gaming_mode_active` (`#[serde(default)]`).
- **Fix `d45bb1c` (6 files, +58/−19):** self-review caught `Palworld-Win64-Shipping` in a Black
  Box headline while every neighboring surface showed `Palworld` — class-swept BOTH language
  layers (`blackbox.rs` display prettifier delegates to shared `intelligence::pretty_game_name`;
  FE `sessionTrends`/`SessionDebrief`/`TuningDebrief` display sites on `prettyGameName`).
  **MATCHING stays raw everywhere** — `norm_app` keeps its own `.exe`-strip (a launcher exe and
  its shipping binary are different processes and must not merge). bug→guard: cargo
  `headline_strips_shipping_suffix_like_every_other_surface` + vitest grouping pin.
- **Reviewer chain:** rust-tauri-reviewer full-diff **"VERDICT: PASS"** + incremental
  **"Verdict: PASS … none Critical, none Warning"** · train self-review round-2 **PASS** ·
  fix-lane self-review round-1 **FAIL** (TS sweep missed the Rust-layer prettifier — the
  completeness-critic-grep failure mode) → fix → round-2 full-fresh **PASS** (live capture on
  real `sessions.json`, completeness grep both languages: zero additional misses).
- **Shipped:** installer `Compy_0.9.0_x64-setup.exe` SHA-256
  `8063F95744C6AF00C760FD3F77DA63FBD9B68B279773307D6D1AEB5773A52E0D`, silent reinstall done, live
  exe stamp-verified `d45bb1c` CLEAN (no `+dirty`). Verify: cargo **754/754** (count UP) · clippy
  clean · vitest **1708/1708** (183 files; export-library passed this run) · verify-release-state
  46/46.
- **§0.11 lane separation honored:** Optimization Cleanup is its own train — Phase 1 (restore
  ARMED, shipped 2026-07-16) left exactly where it was; nothing folded in.
- **Board retention:** 4 oldest cycles (13f/13e/13d/13c) moved verbatim to `BACKLOG_ARCHIVE.md`
  (104 lines); board at 12 cycles.

### Cycle 2026-07-16e — ✅ SITE DEPLOYED + AUTO-DEPLOY WIRED (CC, owner-directed "deploy the site … make it as automated as possible"): live on `compy-bd6.pages.dev` · ~~GitHub Actions deploy lane awaiting ONE owner token paste~~ **← CANCELLED, see decree above**

- **Manual deploy (the last one):** dist-site restaged fresh (`npm run stage:site`) → `wrangler pages
  deploy` under the standing deploy GO (checklist B3, 2026-07-15) → apex promotion PROVEN by hash
  (apex == deployment URL `37fa0e02…`, SHA-256 `FFC5D5ADD8812501…`, 34073 bytes both).
- **Auto-deploy lane:** `.github/workflows/deploy-site.yml` — push-to-main path-scoped (site/,
  site-app/, functions/, src/data/, the stage script) → `npm ci` ×2 → `stage:site` → wrangler-action
  production deploy. Preflight job SKIPS green until the credential exists (no red-X spam);
  zero-budget (ubuntu 1×, scoped triggers, concurrency-cancel).
- **Secrets:** `CLOUDFLARE_ACCOUNT_ID` set by CC via `gh secret set` (low-sensitivity). The deploy
  token is owner-mint-only → **checklist B7** (Pages:Edit-scoped custom token → GitHub secret
  `CLOUDFLARE_API_TOKEN`; never passes through chat/repo). First auto-run gets fired + verified on
  his "token's in".

### Cycle 2026-07-16d — ✅ OPTIMIZATION CLEANUP PHASE 0 SHIPPED (CC, owner-directed "ship Phase 0"): `55f68b6` locked name + first-class front door · `f831b5f` landed 16c's stranded deliverables — NO gate moved, zero mutation boundary

- **`f831b5f` — git-lock recovery + 16c's docs landed:** Cycle 2026-07-16c's Cowork session died on
  its final commit, leaving stale zero-byte `.git/HEAD.lock`/`index.lock` (evidence-verified: 19 min
  old, no git.exe running, HEAD intact) and its deliverables uncommitted. Removed the locks and landed
  the 7 pending files exactly as staged (the 4.1 spec · METHODOLOGY.md · consumer-story draft · both
  panel-review docs · BACKLOG/COMPY_OVERVIEW edits, completing `801ea62`'s truncated file). Parallel-lane
  COWORK_*.md working artifacts stay untracked, never swept.
- **`55f68b6` — 4.1 Phase 0 (owner-authorized, superseding the entry's "nothing authorized to build"):**
  the live `leftovers.rs` read-only audit now fronts as **"Optimization Cleanup"** (owner-locked name,
  2026-07-15) and is **UNBURIED** — out of the "Nothing else needs attention" drawer to a first-class
  Check section (title + explainer blurb + "Check this PC for old tweaks" run button; a check the user
  is meant to RUN can't hide in a leave-it-alone pile). terms.json/tweaks.json renamed (+ alias);
  title-case "Past Tweaks" pinned as a retired label in stale-reference-guard (lowercase descriptive
  phrase + the "Past tweak ·" row prefix stay legal); Optimize.test now asserts the section renders ON
  the open surface, never in the drawer. **Read-only unchanged:** no restore action exists,
  `restore_gate()` stays double-dark, identifiers keep `leftovers`. Phases 1–3 remain un-scope-gated;
  the Trust-Ledger-reuse vs separate-mechanism fork is still the first scope-gate call.
- **Verify:** tsc 0 · vitest 1682/1682 (181 files; new guard rides the existing per-file scans) ·
  self-reviewer PASS 9/9 (contrast 11.3:1 header, no dup mount, pre-run/busy/result/fixture states) ·
  installer re-cut + silent reinstall — SHA + stamp in the RELEASE_STATE 2026-07-16b banner.

### Cycle 2026-07-16c — ✅ PANEL-REVIEW EXECUTION CONTINUED (Cowork): research + content stage on the remaining 4.x items — doc/content only, zero src-tauri, zero site-build changes committed

**Owner's operative mandate:** *"do whatever needs to be done to move forward with all those review
suggestions"* — picking up where Cycle 2026-07-16b's doc triage left off, moving the still-open 4.x
items from "logged" to "researched/drafted."

- **`801ea62` — landed CC's COMPY_OVERVIEW.md staleness rewrite** (was sitting uncommitted per
  2026-07-16b's note) + closed the one Receipts-phrasing nit CC had flagged but not fixed (TL;DR
  read as if an opt-in sharing toggle already exists; it doesn't yet).
- **4.1 "Optimization Cleanup" — research stage done, spec drafted:** headline finding — this is
  mostly already built (`leftovers.rs` live read-only, 7/9 detectors already have dark tested restore
  resolvers in `actions.rs`). Full spec + the one unresolved architectural fork (Trust-Ledger-reuse
  vs. the BACKLOG's stated separate mechanism) at
  `docs/superpowers/specs/2026-07-16-optimization-cleanup-research-spec.md`. Detail folded into the
  4.1 entry above (PHASE B). **Not scope-gated or mutation-gated — nothing authorized to build yet.**
- **4.4 export tiers — audited, correction made:** `export.rs` has exactly one render path today; no
  share-card exists either (the brief assumed one did). All three proposed tiers are genuinely new,
  not a light pass — resized in the entry above.
- **4.2 intent router / 4.8 basic mode — gap-checked against real code, not assumed:** confirmed the
  Lab's in-Lab router is real and shouldn't be rebuilt (4.2 gap is specifically the pre-room entry
  point, unbuilt). FirstCheck audited against the persona's 5-point basic-mode ask: 3 of 5 already
  covered, 1 partial (what-changes isn't stated on the verdict card), 1 real gap (the
  restore-guarantee line is hidden inside the post-click confirm dialog, not on the verdict card
  itself). Both scoped down to small, concrete additions in the entries above.
- **4.5 methodology page — content drafted, not yet placed:** `docs/METHODOLOGY.md`, every claim
  cited to `fps.rs`/`benchmark_verdict.rs`/`comparison.rs`/`recommendations.rs`/`benchmark-view.ts`
  line numbers (capture mechanism, sample cadence, process/swapchain selection + the real
  msedgewebview2/323-vs-161 bug history, noise floors, 1%-low method, missing-data handling,
  Verified/Measured/Expected definitions, combined-effect logic). ⚠️ **Attempted to wire this into
  `site/generate.mjs` as a new reference page (parallel to the legal-pages pattern) — REVERTED,
  unverified.** The sandbox's file view of a same-session edit went stale/truncated mid-verification
  (known failure mode, see [[sandbox-fuse-git-view-unreliable]] memory, now confirmed for non-git
  file reads too) so `node site/generate.mjs` + the site test suite could not be run reliably this
  session. Reverted the generate.mjs edit rather than leave an unverified change in a tested build
  pipeline; the content (docs/METHODOLOGY.md) is safe and ready, the wiring is a small, scoped TODO
  for CC to apply + verify Windows-side (referencePages array + sitemap line + llms.txt line, design
  already worked out, ~20 lines).
- **4.6 non-competitive consumer story — content drafted, placement flagged:**
  `docs/content-drafts/2026-07-16-non-competitive-consumer-story.md`. Doesn't fit the
  `debunks.config.json` schema (that's graded tweak verdicts, this is a use-case narrative) — needs a
  placement decision (site section vs. in-app) from CC/owner, plus a grounding check against what
  Monitor actually correlates at a stutter timestamp before it ships (flagged in the draft, not
  independently re-verified here to avoid overclaiming on a time budget).
- **Verify:** COMPY_OVERVIEW.md commit confirmed via `git log`/`git show` at the time of commit;
  given this session's own sandbox-staleness finding, CC should re-confirm `801ea62` landed cleanly
  Windows-side rather than trusting this session's git output alone. No cargo/vitest run this
  session (no src-tauri or src/ code changed) — the generate.mjs syntax scare was the sandbox's stale
  copy, not a real defect; the actual file was reverted to its pre-session state via the Edit tool.
- ⛳ **RESUME:** the honest state of the review is: doc-triage (2026-07-16b) + research/content
  (2026-07-16c) are done; the two flagship items (4.1 build, 4.4 build) are NOT started and are the
  real remaining work — everything else here is either shipped, small, or a placement/wiring TODO.
  Next real decision: does 4.1 Phase 0 (ship the already-live `leftovers.rs` audit under the
  "Optimization Cleanup" name, near-zero cost) get scope-gated on its own ahead of anything else?

### Cycle 2026-07-16b — ✅ PANEL-REVIEW BRIEF EXECUTED (Cowork triage): combined-effect attribution `850dde2` · site copy scoping `60eea80` · 9-item doc triage — NO gate moved, zero src-tauri

**Owner's operative mandate:** *"Read docs/reviews/2026-07-15-cc-brief-panel-review-execution.md and
execute it"* — Cowork's triage of the 2026-07-15 consumer-panel review, executed in its Part-6 order
(app lane, parallel to the hero-site lane).

- **`60eea80` — Brief 3.1, site copy scoping:** "free forever" → "**core** stays free forever"
  (site-only; keeps the promise honest against the dark Compy Pro lane). ⚠️ **Deploy PENDING** — the
  permission classifier denied `wrangler pages deploy` this session (not retried per protocol);
  `dist-site` is built + staged, one command when the owner greenlights.
- **`850dde2` — Brief Part 2, combined-effect attribution audit (honest-measurement law):** a
  multi-change benchmark delta belongs to the STACK, never one change's win. Single sources in
  `benchmark-view.ts`: `changesBetweenRuns()` (the ONE graded-window filter — applied_at strictly >
  baseline_at, ≤ latest_at, unparseable → `[]`) + `changeAttribution(count)` (plural lead + the
  credit-refusing caveat). Every attributing surface re-pointed: Benchmark EfficacyCard · TwoFutures ·
  LabV2 room verdict (`labVerdict`) · Bento Checkup Report + guided/ground station readings
  (`stationReading` via `LabStationFacts.stackedCount`) · LabConsole facts. Singular ≤1-change
  readings stay byte-identical (pinned). Three self-review rounds — round 1 caught `labVerdict`
  hardcoded singular, round 2 caught the Checkup Report disagreeing with the room header on the SAME
  screen — round-3 **PASS** (both renderings live-verified agreeing, 2-change + 1-change states,
  flags restored). bug→guard: 3 new pinned tests.
- **Brief Part 4 — 9-item doc triage (this commit):** BACKLOG items 4.1/4.4/4.2/4.8/4.7 ·
  MONETIZATION_PLAN 4.5+4.6 (non-competitive consumer story + methodology page, Layer 2, $0) ·
  OWNER_ACTION_CHECKLIST §B2 4.10 (cold-start protocol folded into beta-send planning) + §D 4.9
  (version policy: `docs/superpowers/specs/2026-07-16-version-policy-proposal.md` drafted, numbering
  decision FLAGGED to owner, not decided) · UI_VISION_BACKLOG §F cross-ref · self-reviewer rubric
  item 9 ("earn its place", 4.3).
- **Brief Part 5 — cross-references confirmed resolving (no new entries, per the brief):** signing /
  legal venue / domain / beta smoke / tester GO → OWNER_ACTION_CHECKLIST §A2·§B2·§C ✓ · NVIDIA
  hardware verification → NVIDIA_VALIDATION_PLAN.md (still blocked on hardware, reaffirmed) ✓ ·
  design-tooling + upgrade-path forks → §B4 + UI_VISION §E/§F ✓ · B2B licensing → MONETIZATION_PLAN
  Layer 4, parked ✓.
- **COMPY_OVERVIEW.md drift check (brief's standing ask): PASS** — one Receipts-phrasing nit
  (reported to the Cowork lane; that file is Cowork-owned, NOT committed here).
- **Verify:** tsc 0 · vitest **1682/1682** (181 files, +3 guards) · site copy through the existing
  site test pipeline at `60eea80`.
- ⛳ **RESUME:** brief fully executed. Owner flags: ① site deploy pending (classifier denial — one
  `wrangler pages deploy dist-site` when greenlit) · ② version-policy numbering call (§D) · ③
  standing gates unchanged. Next: the owner's announced "biggest app orientation refinement workflow".

### Cycle 2026-07-16a — ✅ APP LANE TASK LIST CLOSED: room-palette 8+7 rework · App.css gradient-ink de-slop · nav-mount cost FIXED + SHIPPED LIVE — frontend-only, NO gate moved, zero src-tauri

**Owner's operative mandate:** the three-part order (*"make half of them some good 2 color shift
options and the remaining half all the standard color spectrum… follow through with [the App.css
gradient text] as well… that should allow for you to ccompletely finish this task list before i send
the biggest app orientation refinement workflow"*) — every item executed; **the app-lane task list is
now EMPTY** ahead of the owner's announced orientation-refinement workflow.

- **`92596d6` — room-accent palette reworked 8 duo + 7 solo** (owner pick: duos are the favorites):
  8 curated two-color shift options + 7 standard-spectrum solids, adaptive-ink law kept per swatch.
  self-reviewer **PASS 8/8** (duo-fill ink measured legible live).
- **`47300d9` — App.css gradient-text de-slop + CoreBar scaleX** (the agent-consultant suggestion the
  owner greenlit): static gradient headline ink retired to solid tokens where it read as template
  slop; CoreBar bar animates via transform (no layout thrash). Covered by the same PASS.
- **`b2d775d` — UI_VISION_BACKLOG stale-list fix:** the "Remaining 🔴" per-tab console rollout list
  was stale — Monitor gauges/oscilloscope + Blackbook flight-recorder had ALREADY shipped (2026-07-12/13);
  both recorded 🟢 with their ship hashes.
- **`d0392c9` — nav-mount cost FIXED (closes Cycle 2026-07-15d's open follow-up).** Investigation
  (delegated, then code-verified) found three root causes: ① MonitorV2's classic-shell one-shot sensor
  pre-warm duplicated the IPC every face already fires on its own mount → deleted; ② SessionStack ran
  `readInk`/`getComputedStyle` (forced whole-document style recalc) per-row ×4 tokens (up to 15 recalcs
  per mount) → ONE hoisted `compy:room-identity-changed` listener + shared memoized ink cache keyed on
  (identity-flag · accentTick · model), ≤4 reads per mount, in-place accent repaint preserved
  (guard re-pinned); ③ **Blackbook tape rendered the machine's ENTIRE lifetime history** (dominant cost
  + the 80–152ms variance) → first render caps at `TAPE_CAP=30` rows with a quiet mono
  "show N older records" disclosure (`.bc-tape-more`); Receipts Strip counts/sinceDate still derive
  from the FULL record set. bug→guard: 2 vitest cases pin cap + disclosure + full-count tiles + unroll.
  Ruled out & left alone: logbook.ts O(n²) same-game lookback (sub-ms), corpus imports, ArcGauge/gsap.
- **Verify:** tsc 0 · vitest **1666/1666** (181 files) · self-reviewer **PASS 8/8** on the nav-mount
  train (live 73-record ledger: 30 rows + "show 43 older records" → unroll to 73, button gone; accent
  pick teal→magenta repainted traces in place; only-new-element check passed — strip counts 53/20
  unchanged, code-verified full-set).
- ✅ **SHIPPED 2026-07-16:** `npm run tauri build` → `ship-reinstall.ps1` (dirty-stamp guard tripped on
  parallel-lane-only dirt — Cowork `COMPY_OVERVIEW.md` + a stray scratchpad png; app inputs
  porcelain-clean at build → deliberate `-AllowDirty`, 2026-07-15f precedent) → installer SHA-256
  `832B7CF3BDBD2603F925EDD18DD9A1669B0AB74CC441A7675769B46F48687A4E`, **stamp-verified `b968f0a` live,
  CLEAN (no `+dirty`)**, one installer on the Desktop. (`b968f0a` = HEAD at build: `d0392c9` + the site
  lane's site-only `b968f0a` on top; no other app diff.)
- ⛳ **RESUME:** app-lane list EMPTY; standing owner gates unchanged (room-identity one-flip eyeball ·
  outbound walls). Non-blocking note for the owner: CoreBar's "Per-core load" detail is only reachable
  with `compy_monitor_console=0` (non-default) — pre-existing routing, surfaced for awareness. Next:
  the owner's announced "biggest app orientation refinement workflow".

### Cycle 2026-07-15d — ✅ APP LANE: CONSOLE TRAINS 1–4 DEFAULT-ON + OVERLAY BACKDROP FIX, SHIPPED LIVE — frontend-only, NO gate moved, zero src-tauri

**Owner's operative mandate:** *"i want this session to be activel finishing remaining work
pertaining to the app directly seperate from the hero site"* + green light *"ok lets get it all done
lets go"*. The app lane's four console trains, executed end-to-end and shipped.

- **`50b505e` Train 1 — Monitor console density/backdrop fold-in** (MonitorConsole.tsx/.css;
  UI_VISION_BACKLOG updated same commit).
- **`f4b4ada` Train 2 — Settings quiet chrome** (Settings.css only, +75/−33).
- **`40bce4e` Trains 3+4 — Gaming Mode arm/engage console face** (`compy_gaming_console` DEFAULT ON)
  **+ app-wide viewport HUD frame & global reticle** (`compy_hud_frame` DEFAULT ON): corner
  brackets + bottom-right real-values-only mono readout (rig probe · clock — unfetchable segments
  omitted, never fabricated) + ReticleCursor scoped to the shell. Classic stays reachable via the
  "0" failsafe — flag-off byte-identity test-pinned (a HudFrame live-clock flake in the
  byte-identical suite was caught + frozen with fake timers, bug→guard). Nav-timing self-review
  round 2 caught `.v2-shell:has(> .hud-frame)` taxing the biggest room swaps → replaced with a
  plain `.v2-shell-hud` class; round-3 A/B (flag on vs "0") proved this train adds no nav cost —
  **residual Monitor (52–57ms) / Blackbook (80–152ms) nav-mount slowness is PRE-EXISTING**
  (equally slow flag-off) → open follow-up below.
- **`f160839` — owner defect FIXED** (*"overlay seems to have a full screen or window size backdrop
  thats feint but visible… on my fullscreen applications"*): main.tsx sets every skin attribute on
  documentElement BEFORE branching on the overlay window label, so document-level ambient pseudo
  layers (App.css `body::before` aurora, seasonal `::after`) painted a faint wash over games.
  Overlay.css now blanket-kills all six document-level pseudo slots (`content: none !important`);
  live-verified in the real overlay window over CDP (all six computed `none`). Bug→guard:
  `src/overlay-ambient-guard.test.ts` (kill rule pinned · bans `content !important` on
  document-level pseudos · bans `:has()` on the nav-hot shell).
- **Shipped:** installer SHA-256 `B87B3B3C…B3D20C`, silent-reinstalled, **stamp-verified `f160839`
  live (clean, no `+dirty`)**, one installer on the Desktop. Dirty-stamp guard overridden
  deliberately — the dirt was exclusively parallel-lane files (Cowork `COMPY_OVERVIEW.md` + site
  `site/*.html`), app inputs porcelain-clean.
- **Verify:** tsc 0 · vitest **1656/1656** (181 files, 8 skipped) · no Rust diff (cargo n/a) ·
  self-reviewer round-3 **PASS** 7/7 (consent modal exercised + cancelled without starting a
  session; 52px readout clearance verified at true scrollHeight).
- **Open follow-up (non-blocking, from round-3 verdict):** investigate what Monitor + Blackbook
  mount on nav-switch (pre-existing cost, separate from HudFrame/ShellV2 — both proven innocent
  by the A/B).

### Cycle 2026-07-15c — ✅ SITE COMPLETION: SEO/LAUNCH PLUMBING + /compare LIVE + DEPLOYED — site-only, NO gate moved, zero src-tauri, zero src/

**Owner's operative directive:** *"deploy go looks good for now… go about doing the full completion
of the site, everything necessary for completion so we can prepare to launch compy"* (a separate
session handles app finishing touches — this lane stays strictly site: `site/`, `site-app/`,
`dist-site`, `scripts/site-*`, `functions/`, docs). Executed end-to-end.

- **SEO / launch plumbing:** canonical URL scheme on every page (landing `/`; picks canonicalize to
  `https://compy.gg/<id>` from BOTH the top-level and `library/` copies — no duplicate-content split;
  non-picks → `/library/<id>`; legal → `/privacy`, `/eula`; compare → `/compare`); `robots.txt`
  (Allow all + sitemap pointer); `sitemap.xml` (196 URLs, picks listed once at top level, **no
  lastmod/priority/changefreq** — honesty law, never fabricate freshness); favicons (bracket-mark
  `favicon.svg` + hand-built 197-byte `favicon.ico`); static `404.html` (noindex, root-absolute
  links, no JS — CF Pages serves it with a real HTTP 404); honest JSON-LD (TechArticle on
  article/teaser pages, SoftwareApplication on landing — guard bans `aggregateRating`/`reviewCount`/
  `ratingValue`; `<`-escaped); og/twitter card meta pointing at the real `assets/og.png`;
  skip-link a11y on the generated pages + templates.
- **NEW `/compare` page (`site-app/src/pages/compare.astro`)** — Design Director spec, full six-seat
  council 2026-07-15. Five **construction-practice** axes (rollback · kernel/anti-cheat · catalog
  transparency · telemetry default · cost model), Compy's practice on the record vs "the usual
  playbook", **each admitting the tradeoff it costs us**. Room laws now guard-pinned: **never names a
  competitor** (bans CCleaner/Razer Cortex/Wise Care/Advanced SystemCare/Hone/ExitLag), **never
  invents a performance number** (bans `boost`/`faster`/`+N fps|%`), no gain claims. Kicker: "We
  don't have the other tools' rigs — or yours — so we won't invent benchmark numbers." Wired into the
  landing nav (Receipts→Blackbook→Compare→FAQ) + the FAQ FPS answer.
- **Legal contact fix:** the dead `github.com/Pootytxng/compy` contact links in `PRIVACY.md`/`EULA.md`
  are replaced with a real channel (reply to the waitlist email); the `[STATE]` venue blank stays
  intact + test-pinned (owner's to fill).
- **Guard:** new `scripts/site-seo.test.mjs` companion suite (robots/sitemap honesty, canonicals,
  favicons, 404, compare axes + competitor/hype bans, landing JSON-LD). Full pipeline **40/40 green**
  (site-landing + staleness + seo, regenerate/rebuild-if-stale). Self-review **PASS** (agent
  `adae2dc1b4d75fff8`: computed contrast `#f2ede4` on `#0d0b07` + `#140a00` on `#ff9a1e`; mobile
  390px no overflow; single footer; nav order; skip-links resolve; no retired-brand copy).
- **DEPLOYED** (owner's deploy GO): `npx wrangler pages deploy dist-site` → `d8a40fc5.compy-bd6.pages.dev`,
  **apex promoted + verified** (apex HTML md5 `458dc641203451a34e7eb44eeeb47ec1` == deploy hash;
  `/compare` + `/sitemap.xml` + `/robots.txt` + favicons 200; real HTTP 404 on unknown routes).
- **⚠️ Doc reconciliation:** the owner's **deploy GO supersedes** the "Site stays PRE-PUBLISH; owner
  taste gate before any deploy; deploy owner-gated" language in the older cycles below and in
  RELEASE_STATE — the site now **deploys autonomously**. Remaining launch gate is owner-only: the
  **`compy.gg` domain purchase** (canonicals/sitemap/JSON-LD all point at it; site currently lives
  only on `compy-bd6.pages.dev`).
- **P2 status:** `/compare` ✅ done, FAQ JSON-LD (`SoftwareApplication` on landing) ✅ done. **Still
  open P2 candidates:** `/pricing` page · `llms.txt` · the owner-flagged **mini playable demo** of one
  real Compy tool (UI_VISION_BACKLOG §G). P3 walkthrough/tour videos stay owner-flagged LATER.

### Cycle 2026-07-15b — ✅ DIRECTOR #5 BUILT: SCROLL-SCRUBBED TELEMETRY THROUGHLINE — site-only, NO gate moved, zero src-tauri, zero src/

**The queued Director change #5 got its own train** (owner green light: "proceed with the
conclusions made by the council and design director"). The `.record` replay deck's ▶ button replay
is RETIRED — the page scroll is now the Monitor's transport: with JS + motion allowed the section
becomes a 240vh runway (200vh ≤720px), the deck sticky-pins, and scroll scrubs the REAL 3:00:05
Diablo IV session bidirectionally — new event-timeline canvas (51 real events at true timestamps,
hour graticule, playhead), session clock, ~1Hz sample counter, events-passed n/51, live event feed —
landing on the measured-results grid ("T+3:00:05 · end of record") as the deck unpins.

- **Honesty boundary held:** that record has NO per-second fps series (guard-enforced), so nothing
  per-frame is animated or invented; fps numbers appear only as end results. Reduced-motion/no-JS
  get the finished static summary with ZERO dead runway (doorknob law) — new guard pins in
  `scripts/site-landing.test.mjs` ban `record--scrub`/timeline/hint from static markup.
- **Director seat-6 sat on the BUILT result: SHIP-WITH-CHANGES** ("the first mechanic on this site
  I'd actually remember"; clears both slop altitudes). Both named fixes applied same train:
  (1) **density-weighted transport** — all 51 events live in the session's first ~38%, so the linear
  scroll→time map idled for ~60% of the runway; `timeOf()` (ACTIVE_SHARE 0.85) now spends 85% of
  scroll on the event-dense span and fast-forwards the quiet 6,730s tail — transport SPEED only,
  every reading stays true to the record; samples + track fill follow session time. (2) the new
  scrub strings + canvas hour labels bumped `--fg-faint` → `--fg-dim` (AA).
- **Restraint call:** the deck scrub is the ONLY new scrolled motion — receipts/features/pricing/hero
  untouched (fourth-taste-FAIL risk from scattering motion).
- **Verify:** astro build + stage clean · vitest **25/25** (site-landing + staleness guard) ·
  self-review ran 4 rounds to PASS: round-2 caught a live→results swap-height jump (~20px desktop,
  `.rhud-swap` min-height was calibrated to the shorter results state) → fixed 252→276px; round-3
  confirmed desktop flat but caught the SAME class at mobile 390w (~84px, taller 2-col live state)
  → mobile-scoped 364px override in the 720px block; **round-4 full fresh review PASS** — swap +
  deck heights flat through the DONE_AT boundary at BOTH 1500×980 and 390×844 (and 700×900),
  contrast rgb(168,159,146) ~7.8:1, density transport climbing, bidirectional determinism,
  reduced-motion static fallback, no overflow, console clean. **Site stays PRE-PUBLISH; owner
  taste sign-off on the live scroll feel is the remaining gate; deploy owner-gated.**

### Cycle 2026-07-15 — ✅ COUNCIL SEAT 6 + BLACKBOOK TEASER SPLIT ("samples, not free meals") — site-only, PRE-PUBLISH, NO gate moved, zero src-tauri, zero src/

**Owner decree:** council the Flight Test landing, ADD a sixth council seat (award-winning web
design director) to own site taste + content-exposure calls, and fix the Blackbook giveaway —
"we just have the whole blackbook on display like were giving out free meals instead of samples."
**Built:** `.claude/agents/web-design-director.md` (opus — adversarial-judgment exception) +
`COUNCIL_PROTOCOL.md` seat 6. **Full six-seat council convened; Chairman adopted the TEASER-TIER
SPLIT** (Executor's `config.picks` branch + Contrarian's answer-the-query rule) over the Director's
full-kill minority — teasers keep every URL/guard/SEO surface while confining the payload to the app.

- **generate.mjs:** 14 curated ids stay full write-ups (the public sample); the other 177 entries
  now emit `teaserPage()` — header + summary + honest verdict + one short per-type section + an
  `.in-the-app` panel. Every page still ANSWERS its query in visible text (Contrarian rule — no
  fake-blur paywall tease). Index copy fixed (Outsider 🔴: it literally said "the same library that
  ships inside the app") → "14 full write-ups… the complete graded book ships inside the app."
- **library.css:** full amber unification (Director #2 — the teal/violet/magenta /library/ palette
  was a brand fracture vs the amber landing); verdict colors stay semantic; `.in-the-app` dashed
  panel styling. Impeccable hook's 3 findings classified, not edited: stance/blockquote side-tabs =
  classical quote idiom (pre-existing), gradient-text = dormant legacy-landing rule no generated
  page renders.
- **index.astro:** nav demoted Blackbook to slot 2 (Receipts first) · hero ghost CTA "Sample the
  Blackbook →" · module copy reframed ("EVERY VERDICT PUBLIC · THE BOOK SHIPS IN THE APP") · "1% low"
  glossed in trace label + strip tooltip (Outsider) · pricing gained "THE MANIFEST" rail + ledger-row
  manifest lists (Director #3) · below-fold h3 type confidence (Director #4).
- **Director #5 (scroll-scrubbed telemetry throughline) QUEUED, not built** → UI_VISION_BACKLOG
  §G.1 with reasoning (page-length motion rushed = fourth taste-FAIL risk; needs its own
  storyboard→build→self-review train).
- **Expansionist note (forward-looking, small):** extract the landing's session-receipt rendering
  into a reusable `<SessionReceipt>` share-card component — the same real-session receipt block is
  the natural unit for the Receipts-doctrine share cards (web reports, social proof). Not queued as
  a train; pick up when the share-card lane opens.
- **Verify:** `node site/generate.mjs` → 191 entries (14 full, 177 teasers) · astro build + stage
  clean · vitest **25/25** (site-landing + staleness guard) · self-reviewer **PASS 8/8** (agent
  `a715291cc90eb9c73`: .btn amber/ink 9.22:1 AAA · stale "same library" phrase grep-absent · zero
  teal/violet remnants · manifest ledger clean at 1500 + 390 · teaser pages honest + styled ·
  title-law h1s). **Site stays PRE-PUBLISH: owner taste gate before any deploy; deploy owner-gated.**

### Cycle 2026-07-14b — ✅ SITE MAKEOVER P1: MISSION CONTROL LANDING ON ASTRO — site-only, PRE-PUBLISH, NO gate moved, zero src-tauri, zero src/

**The landing moved out of `site/` into a new Astro + React-islands app (`site-app/`)** per the
owner-decided makeover (spec `docs/superpowers/specs/2026-07-14-site-makeover-research-spitball.md`:
Direction A "Mission Control" + Monitor replay demo + Astro rebuild). Home = topbar · hero with
**ReplayHUD** (the owner's REAL recorded Diablo IV session — session clock + ~1Hz sample counter +
real events at time-compressed real timestamps, measured results as the end-of-session reveal;
**no per-frame fps series exists, so none is animated — nothing fabricated**) · trust bar · features
bento · receipts (Game Mode null-result + Diablo IV, pinned to `site/src/*-receipt.json`) · honest
Pro teaser (no price, no button) · FAQ (NVIDIA sensor stays "not yet hardware-verified") · same-origin
waitlist. Design tokens mirrored from App.css; ONE self-hosted font (Fontsource JetBrains Mono);
zero third-party runtime requests (test-pinned). SSR = measured summary (no-JS visitors see real
results, no dead button); reduced-motion respected on the WEB (app-side motion law is app-only).
**Pipeline:** `site/generate.mjs` now content-pages-only; `scripts/stage-dist-site.mjs` dual-builds
and overlays `site-app/dist/`; `site-landing.test.mjs` rewritten against the BUILT artifact
(24 tests: provenance pinning, zero-third-party bundle scans, doorknob/pricing/FAQ honesty);
staleness guard expects the overlay. Verify: vitest **177 files / 1631 green** · self-review
round 2 **PASS** (round 1 caught 2 real 390px bugs — topbar CTA overflow + clipped receipt card —
fixed + re-captured). **Site stays PRE-PUBLISH: owner taste gate before any deploy; deploy owner-gated.**
Next: P2 (/pricing + /compare + FAQ JSON-LD + llms.txt), P3 videos (owner-flagged LATER).

### Cycle 2026-07-14a — ✅ JARVIS DEVIATIONS RATIFIED + DIRTY-STAMP FALSE-POSITIVE FIXED & GATED — no ship, NO gate moved, zero mutation-boundary code

**Owner ruling (checklist item 2, evidence-first):** both `1d310e1` motion deviations **STAND** —
Dock keeps lift-only (no magnetic pull; rail tabs own the 4px pull, both captured live) and no
hologram shader-pulse (gauge data-tick stays the vehicle; 0 GL draws in 15s idle re-proven on the
live build). Evidence: `docs/ui-sweep/shots/deviation-*.png` + `motion-evidence-log.json`; verdict
recorded in OWNER_ACTION_CHECKLIST A7 + UI_VISION_BACKLOG §A.2/A.3. Future option (noted, NOT
queued): change-triggered pulse. **Dirty-stamp incident (self-caught during the captures):** live
PART B stamp read `2eda4eb+dirty` — audited benign (tracked tree clean; 89 untracked `docs/` files
tripped `git status --porcelain`'s `??` count; binary code-identical to `2eda4eb`, no re-cut).
**Fix + bug→guard:** `src-tauri/build.rs` dirty check now `:(exclude)docs` (untracked non-docs
still counts) · new **DIRTY-STAMP GATE** step 0b in `scripts/ship-reinstall.ps1` (throws on
non-docs tree dirt pre-install, `-AllowDirty` override; red→green proven with a non-docs probe).
RELEASE_STATE update 2026-07-14b carries the audit. Next build/ship stamps clean.

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

> **🌿 Branch-integration health** — the 2026-06-24e sweep (every branch dispositioned, `main` the single product truth) is a **point-in-time record**, moved verbatim to `BACKLOG_ARCHIVE.md` (2026-07-22). **Its standing claim was false when written and is now enforced instead of asserted (2026-08-04, Q6):** every one of the **20** origin branches carries a row in **`docs/BRANCH_DISPOSITIONS.md`**, and `scripts/branch-disposition-audit.mjs` fails the build when a ref has no row, a row names a dead ref, or a `MERGED` row stops being a no-op. Result: 6 MERGED · 5 SUPERSEDED (content reached `main` by another path) · 3 PRESERVE (the frozen beta ref + two failed v0.9.9 candidates `RELEASE_AUTONOMY.md` requires kept) · 1 CLAIMED by the Codex lane (`feat/console-project-doctor`, no automatic takeover) · **5 UNLANDED** carrying real work — `docs/claude-md-split`, `codex/tool-shed-hygiene` (partial), `feat/bklit-anime-design-system` (owner taste), `feat/user-feedback-lab-recovery` (owner review), `design/quiet-pit-wall` (deferred, needs a visual self-review). `main` remains the **release** truth — every shipped build is built from it — but that is not a claim that no work lives elsewhere; live lane ownership is governed by `docs/WORK_CONTROL.md`. The durable merge-tree law stays in protocol rule 5 above; re-run it before asserting a branch is stranded.

---

## PHASE A — Allowed-now (the 1.0 product-completeness lane)

Legend: `[x]` shipped on main · `[~]` partial/thin · `[ ]` not built · `[⛔]` excluded by feasibility/design.

### A0 · Repo hygiene
- [x] Reconcile + prune the stranded branches; confirm `main` is the single product truth — done 2026-06-24e: pruned `spike/backend-agent`, `benchmark`, and the two no-op-redundant safety branches (`qa/locale-drift-hardening`=#6, `gaming/honest-partial-undo`=#7, both already in main); the 3 remaining unmerged branches are deliberately-superseded archives. `main` IS the single product truth.
- [x] Adopt this ledger as the persistent-workflow target — the HQ STEERING LOG (top) is the live per-cycle target; `/loop` + scheduled HQ sessions drive off it.

### A1 · DETECTION layer — **effectively complete** (feasibility-bounded)
- [x] core-parking state (policy/registry + powercfg) — `hardware.rs`, `lib.rs:288`
- [x] XMP/EXPO active — ✅ DONE + GUARDED (audit 2026-08-03): honest "running below rated", never
  claims "profile active" — `mem_speed_status` `hardware.rs:511`, surfaced via `xmp_expo_status`;
  guards `hardware.rs:3176` `mem_speed_status_is_honest` + `HardwareGrid.test.tsx:92`.
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
- [x] persist a real DOWNSAMPLED fps-over-time series per session — `fps_series: Vec<(u32, f64)>` additive `#[serde(default)]` on `SessionSummary`: per-10s-bucket MEAN of the real ~1 Hz samples, real elapsed-secs x-axis (gaps in play stay gaps, never interpolated), capped 2160 points (6 h), kept for the most-recent 20 sessions and stripped on save for older; TS contract mirrored (`types.ts` `fps_series?: [number, number][]`). 5 guard tests pin bucketing math, gap honesty, the cap, pre-series serde-default parse, and the strip window. Unblocks the site ReplayHUD real trace + an honest in-app session chart (neither wired yet — no UI renders it in this train). Read-only/additive, no mutation boundary — `sessions.rs`, `monitoring.rs:984`
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
- [ ] vitest 4th flake class (low): under full-suite worker contention, a file can error at
  collection with "Vitest failed to find the current suite" (seen once 2026-07-22 on the two
  `src/surfaces/setup/` files; both pass isolated AND on full-suite re-run). Not one of the three
  878a3a9 classes. If it recurs, investigate pool/maxWorkers; a single re-run is the current answer.
- [ ] evidence-export tiers — audience-shaped renders of the SAME measured evidence pack (`export.rs`
  today: `export_report` markdown/JSON + Discord block = the technical-ish default): add **Consumer**
  ("what changed, in plain English"), **Technical** (full probe/CI detail), and **Support** ("help me,
  here's my rig + ledger") render tiers over the one data source — presentation-only, no new probes, no
  new claims, honesty invariants shared. The **Shop** tier is NOT this item — it belongs to the parked
  Shop Report Mode (Phase D), don't build ahead of it. Provenance: panel-review brief 2026-07-15 §4.4.
  **Audit confirmed, 2026-07-16 (Cowork):** `export.rs` (824 lines) has exactly ONE render path —
  `build_markdown_report` + `build_discord_block`, no struct/enum tiering at all. **Correction to the
  brief's assumption:** no share-card export exists either (grepped repo-wide) — `docs/BACKLOG.md`'s
  own "Real-wins strip" section already notes the share-card component is a forward-looking idea, "not
  queued as a train." So Consumer/Technical/Support are ALL genuinely new, not a light tiering pass
  over existing variants — size this task accordingly before scoping it as small.
  **→ 🧠 SUBSUMED by Intelligence Phase 5 (2026-07-17, intelligence directive §9):** consumer/
  technical/shop report exports ship as part of the evidence-based Upgrade Advisor 2.0 lane — do not
  build this separately; the audit finding above (one render path, no share-card exists) carries
  forward as Intelligence Phase 5 input.

### A3 · CONTENT reorg (Blackbook/Autopsy) — **half built; missing entry metadata**
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

### A4 · ADVISORY surfaces — **THE MAJOR REMAINING LANE (~24 of 33 not built)**

**Monitor/Display**
- [x] OSD detection — shipped the feasible+honest reading: `overlay_tools.rs` read-only probe detects third-party in-game overlay/OSD TOOLS running (RTSS · MSI Afterburner · Fraps · Bandicam — only tools whose running process reliably means an OSD is drawn), surfaced as an "On-screen overlays" Diagnostics section so a double-overlay with Compy's own overlay isn't a mystery. Informational only (no perf/FPS claim, no "close it"); curated labels only (live process names never surfaced/sent); honest coverage. Monitor-HARDWARE-OSD reading deliberately NOT attempted (DDC/CI is an unreliable per-monitor honesty-hazard). No new IPC; 8 tests + law guards — `bf0272f`
- [x] 3-mode preset GUIDED checklists (Visual Fidelity / Smooth / Clarity) advisory cards — read-only Monitor panel: 3 named presets bundle EXISTING guided walkthroughs; `src/surfaces/monitor-view.ts` (pure, 7 tests) + Monitor.tsx panel reusing chip/card/btn-small; no IPC/mutation
- [x] vendor-aware monitor walkthroughs — code-injected `vendor-monitor-tuning` display-topic Learn term names the per-brand VRR/HDR/refresh path (AMD FreeSync · NVIDIA G-SYNC · Intel Adaptive-Sync), cross-linked; Monitor presets help now surfaces the detected brand's VRR name; read-only/advisory, no FPS claim; guard `knowledge-vendor-monitor.test.ts`
- [x] FreeSync↔VRB exclusion **advisory** (content) — shipped the honest, feasible form: `freesync-vrb-exclusion` display-topic Learn term (code-injected like GRADING_ENTRY, no tweaks.json count touch) explaining VRR & blur-reduction strobing usually can't run together (pick one); cross-links vrr/gsync-freesync/backlight-strobing; read-only, no FPS claim; guard `knowledge-freesync-vrb.test.ts` (live OSD strobe *detection* stays WALLED per line 62)
- [x] Acer XFA253QZ (and family) model-hint cards — code-injected `monitor-hint-acer-xfa253q` display term (like FREESYNC_VRB_ENTRY, frozen tweaks.json count untouched) + pure `monitorHintsFor()` EDID-model matcher (folded `xfa253q` stem covers the family) cross-linking set-refresh-rate/vrr/freesync-vrb-exclusion; read-only/advisory, no per-SKU number; guard `knowledge-monitor-hints.test.ts` (8 tests). /check + /security clean
- [x] refresh-rate / sRGB / gamma-vs-HDR / chroma debunk Learn entries — added `srgb-clamp`, `gamma-vs-hdr`, `chroma-subsampling` term explainers (factual color-science, debunk woven in, adversarially fact-checked, lint-clean); refresh-rate covered by `set-refresh-rate` + `hz-vs-fps`. Flagged for owner brand-voice skim.
- [x] refresh-rate **myth debunk** Learn entry — `human-eye-fps-myth` ("Can your eye see past 60 fps?") term explainer fills the gap the line above left (set-refresh-rate is a *real* tweak, hz-vs-fps is mechanics — neither busts the "eye can't see past 60/30/24 fps" myth). Honest/balanced (returns-diminish nuance, no fabricated study, no hardware-specific claim), display-topic, cross-linked; guard test `knowledge-refresh-myth.test.ts`. Flagged for owner brand-voice skim. **[honesty audit 2026-06-25: CLEAN — every claim web-verified vs authoritative sources; no fabricated/unmeasured/Rule-5 claim.]**
- [x] **shader-cache-guide vendor-precision fix** (honesty audit 2026-06-25 nit) — the guide's steps were NVIDIA-Control-Panel-specific ("Shader Cache Size → Unlimited/10 GB"), but AMD Adrenalin (our dev-rig vendor) + Intel expose only an on/off Shader Cache, NOT a size knob — an AMD user couldn't find the named setting. Made the steps + undo vendor-aware (NVIDIA size knob vs AMD/Intel on/off + Reset/Clear; AMD path web-verified against AMD's own support docs). bug→guard: `knowledge-shader-cache-guide.test.ts` pins the vendor-awareness so it can't regress to single-vendor
- [x] **driver-update-guide Intel-vendor fix** (completeness-critic pass over guides.json after the shader-cache fix — same defect class) — step 1 said "AMD's or NVIDIA's own site or app", stranding Intel GPU owners (Arc discrete + iGPU); now "AMD's, NVIDIA's, or Intel's". The other 6 guides surveyed clean (vrr names Reflex+Anti-Lag 2, xmp names XMP/EXPO/DOCP, fan-curve/fps-cap/startup vendor-neutral). bug→guard: `knowledge-driver-update-guide.test.ts` pins all-three-vendor coverage
- [x] **Autopsy truncation-note single-source fix** (fresh Learn.tsx read, stop-hook deeper pass) — the over-cap note hardcoded `(100000)` instead of the exported `AUTOPSY_MAX_CHARS` that drives the actual truncation (a "one source, can't drift" violation: a future cap change would make the note lie about how much was graded). Values coincide today (no user-visible bug) → latent-drift hardening. Now uses the constant. bug→guard: render test in `Learn.test.tsx` pins the displayed char count to `AUTOPSY_MAX_CHARS`
- [x] monitor model detection (EDID / WmiMonitorID, read-only) — `hardware.rs:1879`

**GPU**
- [~] vendor profile detection + advisory badges — **AMD half DONE + guarded** (`vendorProfileInsights`,
  GpuProfile — Adrenalin-named HAGS/power-mode/thermal insights, no perf promise; guard
  `src/data/gpu-sensor.test.ts`). **NVIDIA/Intel deliberately WITHHELD under LOCKED Rule 5**, not
  unfinished — this `[~]` means "as complete as the honesty rule permits", never a to-do.
- [x] GPU-temp honesty gate consolidated to ONE source (`gradeGpuTempForVendor`, gpu-sensor.ts) — fixed a LIVE Rule-#5 violation (SessionDebrief graded NVIDIA temp bare); Play + DashboardV2 dedup'd onto it so it can't drift again (found by the 2026-06-24 workable-now audit; guard test added)
- [x] **[honesty]** tweak-debunk corpus fact-check (`tweaks.json`, all 84 entries) — **COMPLETE** (8 adversarial web-verified sub-agents): zero false-`real`/`risky` verdicts, zero surviving fabricated numbers. Three factual fixes landed by honesty (sysmain GB-number · fTPM misattribution · defrag-SSD "not a defrag" falsehood); verdict/voice handoff (timer-resolution re-grade + wording nits) processed by content. Regression guard `tweak-honesty-guard.test.ts` pins the three corpus fixes. Ledger: `docs/HONESTY_AUDIT_TWEAKS.md`
- [x] **[honesty]** new-Learn-entry audit + terms-corpus regression guard — audited all 8 net-new term explainers (human-eye-fps-myth · powerline/MoCA · keyboard×3 · amd-undervolting · eDPI) + the driver-update-guide Intel fix = CLEAN; caught + fixed one falsehood (`rapid-trigger` claimed Snap Tap/SOCD "banned in CS2 & Valorant" — Valorant actually PERMITS it, VCT §2.3.5). bug→guard: new `terms-honesty-guard.test.ts` pins that Valorant is framed as currently allowing it (the content keyboard guard only pins the generic ban/restrict/rules property, so the false game-list could have regressed green) — `terms-honesty-guard.test.ts`
- [x] **[honesty]** full metric-grading sweep for the NVIDIA-sensor Rule-5 gate — every authoritative GPU-temp grade routes through `gradeGpuTempForVendor` (Overlay/LiveCharts/DashboardV2/Play/SessionDebrief); the tuning path (TuningDebrief/Instrument/Verdict + `gpuRunningHot` nudge) is AMD-walled via `tuningGuideForVendor`; no live gap. Closed a COVERAGE hole in the guard: `gpu-temp-gate-guard.test.ts` now scans production `.ts` too (was `.tsx`-only), allowing only metric-grade.ts + gpu-sensor.ts — a `.ts` helper can no longer bypass the gate (`755f931`)
- [x] per-game / global scope picker (UI only) — `GpuProfile.tsx` scope pills (Global / Per-game) bound to `useGpuProfileScope` over a guarded `GPU_SCOPE_KEY` localStorage value (`profile-store.ts`); advisory viewing lens only (frames which slice you look at — no Windows setting / tweak / IPC), cross-window storage relay, accent-ink on-fill legibility, 18 tests
- [x] before/after delta display (for profiles) — read-only/advisory: pure two-snapshot GPU-profile diff (vendor/model/driver/HAGS/power-mode/peak-temp) → same/changed/**unknown** (a missing read is never inflated into a change) + signed peak-temp delta (down=cooler, no FPS claim). `gpu_profile.rs` pure core (10 tests) + `gpu-profile-store.ts` engine/local-store (14 tests) + a `GpuProfileDelta` card added into `GpuProfile.tsx` beside the scope picker (10 surface tests total); zero mutation/IPC/network. NOT the gated Phase-B apply/rollback. Card renders in the surface; parent supplies the live snapshot + the Rust core is wired to a command later (dark, `#![allow(dead_code)]`).
- [x] GPU profile export (JSON) — read-only/advisory: `build_export` + `export_json` in `gpu_profile.rs` bundle the two (optional) snapshots + recomputed deltas + honest summary + `any_change` into a versioned (`schema_version`/`kind` discriminator) pretty-JSON shareable payload; recomputes via the live delta funcs so it can't drift, keeps the honesty invariants (unread=unknown, no FPS/perf claim), serializes cleanly with a missing side. 5 new tests (20 in module); pure — zero mutation/elevation/IPC/network. Dark (`#![allow(dead_code)]`), wired to a command/surface later.
- [x] version-pinned mismatch warning — read-only/advisory: when the two GPU snapshots weren't pinned to the same driver version AND a measurement (peak temp) also moved, an honest amber banner warns the before/after is confounded ("re-capture both on the same driver"), never a fabricated warning on a missing/unchanged driver read, no FPS/perf claim. `gpu_profile.rs` pure `version_mismatch`/`VersionMismatch` (5 tests) + `GpuProfile.tsx` `versionMismatch` derive + banner (3 surface tests, self-reviewed at native res); zero mutation/IPC/network
- [x] AMD undervolting guide (AMD-verified; NVIDIA/Intel withheld per Rule 5) — `amd-undervolting` power-topic term: splits the safe/reversible Radeon GPU path (Adrenalin, the one Compy guides) from the risky/advanced Ryzen CPU path (BIOS PBO/Curve Optimizer); cross-links amd-gpu-undervolt + pbo-curve-optimizer; no FPS promise, silicon-lottery caveat, NVIDIA/Intel explicitly withheld per Rule 5; guard test (`dd7e4e8`)

**Services**
- [x] read-only service inventory by category — `services.rs` (new): WMI enumerate-all → 9 plain-English gaming-relevant categories (vendor/launchers/anti-cheat/Xbox/perf/telemetry/updates/app-updaters/search), live state + factual descriptions, honest "<n> recognised of <m> total" coverage; folds into `get_diagnostics` (no new IPC, zero frontend change); pure-core unit-tested; inventory-not-advice (no safe-to-suspend judgement) — `b5b16b0`
  - [x] coverage expansion — added **Riot Vanguard** (`vgc`, the Valorant/LoL anti-cheat the category was missing), **GOG Galaxy** (`GalaxyClientService`), **NVIDIA Container** (`NvContainerLocalSystem`); faithful inventory-not-advice facts, exact-match (still never guessed), + no-duplicate-Name catalog guard — `32146bc`
- [ ] curated "safe-to-suspend" reference data (must be owner-curated, never LLM-generated) —
  🔻 **demotion-flagged 2026-07-17 (intelligence directive §0.12):** doesn't feed the intelligence
  platform; already blocked on owner curation, so nothing changes until he supplies the list.
- [x] use-case profile selector (Gaming/Streaming/Creation/General — localStorage) — `src/data/profile-store.ts` + `src/hooks/use-profile.ts`, surfaced as an advisory "What you mostly do" card on Benchmark; LOCAL label only (frames measurements; no Windows setting / tweak / service touched), guarded readers + cross-window storage relay; 17 tests; no new IPC
- [x] service-drift detection (extend Leftovers) — `services.rs`: closed curated catalog (Windows Audio · Audio Endpoint Builder · Themes) flagged when startup drifts from stock Automatic (Manual/Disabled only; Boot/System/Unknown never guessed; absent never flagged); receipts + origin-uncertainty + honest nothing-found; folds into Diagnostics, no new IPC; 10 pure tests incl. law guards (no boost/alarm; catalog can't target a Compy-endorsed disable) — `bd170ce`
- [x] recovery guide — `services.rs`: pure `build_recovery_guide` attaches by-hand, plain-English services.msc restore steps to drift findings (Automatic startup → Start); reference data, NO mutation (Compy performs none); names the exact affected services from the curated const catalog; honest origin-uncertainty + grammar/law guards; folds into Diagnostics as "Background services · How to restore", no new IPC; 5 tests — `a5d5cca`
- [x] recovery guide — **dependency ordering** (correctness fix): when a drifted service's curated prerequisite is ALSO drifted (Windows Audio → Audio Endpoint Builder), restore the prerequisite FIRST + one honest ordering step (else the user hits "a dependency service or group failed to start" following the guide top-to-bottom); note appears only when both are off (never lecture); closed curated fact, not a live WMI dependency read; read-only, `services.rs` only, +4 tests — `89488fb`

**Peripheral** (no Peripheral surface exists in the rail — whole section missing)
- [x] mouse DPI / genre audit — handed off to content (DPI isn't OS-readable → can't be a hardware-tailored peripheral card); shipped as the `effective-sensitivity` (eDPI) input-topic Learn entry: eDPI = DPI × in-game sensitivity is the number that decides aim feel, match it (not just DPI) to copy a setup; names the can't-read-DPI limit + the 400–800 (rarely >1600) rule-of-thumb; no FPS claim; guard test (`bcf7316`)
- [ ] debounce / Snap-Tap / Null-Bind / Rapid-Trigger detection — 🪪 **owner-curated-data-gated**
  (assessed 2026-07-05): whether the feature is *enabled* is firmware/vendor-software state — not
  user-mode readable (no standard HID report; same wall class as [[detection-feasibility-walls-usermode]]).
  The only honest buildable form is capability *inference*: match the connected keyboard's product name
  (already read — `latency.rs` PnP enumeration, real names + VID&PID) against a device→capability list —
  and that list is per-SKU claims about users' hardware, the owner-curated-never-LLM-generated class
  (same rule as safe-to-suspend above). Content half already shipped (`rapid-trigger`/`keyboard-actuation`
  Learn terms). Unblocks when the owner curates the device list. 🔻 **demotion-flagged 2026-07-17
  (intelligence directive §0.12):** doesn't feed the intelligence platform; already curation-gated.
- [ ] sensor ID + known-issue DB (bundled JSON) — 🪪 **owner-curated-data-gated** (assessed 2026-07-05):
  the sensor silicon inside a mouse is not exposed over USB/HID (only the mouse's own product name is —
  already read, `latency.rs`); model→sensor mapping + "known issues" are third-party teardown claims =
  the owner-curated-never-LLM-generated class. Unblocks when the owner curates the DB.
  🔻 **demotion-flagged 2026-07-17 (intelligence directive §0.12):** doesn't feed the intelligence
  platform; already curation-gated.
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
- [ ] ISP speed snapshot (local) — 📡 outbound-gated (a real throughput test must download from a server = first outbound call, same wall as the DNS probe); only the zero-outbound NIC link-rate above is feasible without owner sign-off. 🔻 **demotion-flagged 2026-07-17 (intelligence directive §0.12):** doesn't feed the intelligence platform; already outbound-gated.
- [x] network-readiness pills (backend signal) — `hw.network_pills: [{label,tone}]` on HardwareInfo, derived read-only from adapters/Wi-Fi/QoS/wired-port (zero-outbound, no new probe/IPC); tones good/neutral/advisory/unknown mirror the network-connection readiness honesty; 6 pure tests; UI half = content/peripheral — `490e081`
- [x] network-readiness pills (**UI half**, peripheral) — calm color-coded chips in the Latency surface ("Network connection" card, the online-latency axis); renders the authoritative `hw.network_pills` signal via a narrow `get_hardware_info` read (Benchmark `RigSpecs` precedent — the surface has no `hw` in scope); honest tones (`advisory` = calm accent, never amber/alarm; unknown future tone → neutral), card hidden when unread, no FPS promise; pure `networkPillTone` + 4 tests; live self-reviewed — `b33fcd4`
- [x] Wi-Fi channel / interference — `channel` surfaced on 2.4 GHz + overlap advisory (only 1/6/11 don't overlap → switch router or to 5 GHz); read-only, parser already read it, unit-tested
- [ ] DNS resolution-time probe — 📡 outbound-gated (a resolution-time measurement IS a live DNS query = outbound call; held at the same wall as the ISP snapshot above — Cycle 2026-06-25d flagged it as gated). 🔻 **demotion-flagged 2026-07-17 (intelligence directive §0.12):** doesn't feed the intelligence platform; already outbound-gated.
- [x] powerline / MoCA Learn guides — `powerline-ethernet` + `moca-ethernet` term explainers (network topic): honest no-new-cable wired-grade options for rooms you can't run a cable to. Both name the real win (ping/stability over Wi-Fi, NOT FPS), the practical catches (powerline ← wall-not-surge-strip, circuit-dependent; MoCA ← coax both ends + PoE filter), and when to prefer each. Cross-linked to `wifi-vs-ethernet-fps`; no fabricated speeds. Guard test `knowledge-powerline-moca.test.ts`. Flagged for owner brand-voice skim.
- [x] QoS advisory — read-only Policy-based-QoS detection (HKLM+HKCU `…\Windows\QoS`); surfaces a named Advisory ONLY when a policy exists (no clutter when clean); honest "as-found, not a problem on its own" framing; unit-tested

### A5 · GUIDED SETUP & VERIFICATION + PARAMEDIC — **half built; clean finishable gaps**
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
- [x] pre-room intent router — the Lab's symptom router ("What are you here to do?", shipped 2026-07-05
  via `compy_lab_guided`) covers IN-Lab wayfinding; the remaining gap is the **pre-room-selection entry
  point**: a first-class "what brought you here today?" entry on Home routing to Monitor / Blackbook / Lab by
  intent, so a non-technical user never has to know which room owns their problem. Scope ONLY that entry
  gap — don't rebuild the in-Lab router. Provenance: panel-review brief 2026-07-15 §4.2.
  *(2026-07-17, intelligence directive §9: complementary to the intelligence surfaces — stays
  queued, NOT demoted and NOT part of the intelligence trains.)*
  **BUILT 2026-07-18 behind DEFAULT-OFF flag `compy_home_intake`** (reversible; classic Home byte-identical
  when off). Owner greenlit A+C, declined B (2026-07-18): the intake band renders on HomeConsole as intent
  ROWS *above* the room doors (option A — problem-first: symptom → the room that owns it), PLUS an
  always-available one-tap "does-it-all" fast path (option C — applies every safe-and-ready fix through the
  audited applyBatch path, honest singular/plural counts, confirm-gated). **Gate 1b (door-level hints)
  DECLINED by me** — the intake band already carries the symptom→room mapping; duplicating it onto the doors
  is the "annoyance" the owner warned against, so the dock stays clean room-name doors. Taxonomy in
  `src/surfaces/home-intake-data.ts` (`HOME_INTAKE_ROWS`); one-owner stand-down so the play/"last session"
  row yields to the LAST SESSION verdict block when it renders (self-reviewer rubric-3 catch → bug→guard
  `home-intake.test.tsx`, 15/15). Self-reviewer **PASS** (both catches — session-question duplication +
  disabled-button hover leak — verified fixed with live-DOM/computed-style proof; full pass, no regressions).
  tsc clean. **Awaiting owner eyeball + default-ON/ship call** (owner taste call, per the slim-down flag
  precedent). Symptom→ROOM map surfaced in the ship report.
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

### A6 · UPGRADE-PATH advisory — **complete** (affiliate tags = Phase D)
- [x] hardware-limited verdict detection (GPU≥95% / HDD install drive) — `priorities.rs:95`
- [x] `build_upgrade_path` single source — `priorities.rs:106`
- [x] session-qualified copy — `priorities.rs:109`
- [x] copy-only buttons (no URL opener) — `Check.tsx:207`
- [x] plain retailer links (no tags) + disclosure — `priorities.rs:81`
- [x] markdown-export anchors — independently tested: anchor-format integrity for EVERY RetailLink (count parity, well-formed Markdown, https-only, export-layer tracking-marker ban mirroring the priorities guard) — `2f698e4`
- [x] test "no tags + disclosure always paired" — comprehensive affiliate/tracking guard over ALL retail links (const tables, 12 markers, https-only) + single-item disclosure pairing locked (`priorities.rs` tests)

---

> **UI SLIM-DOWN TRAIN** (council-approved 2026-07-01) — SHIPPED: P1–P3 + deep-cleans landed, all four flags default-ON since `733f132`; its P2 taste notes are point-in-time (pre-HUD Monitor, pre-rail-relabel). Moved verbatim to `BACKLOG_ARCHIVE.md` (2026-07-22).

---

## PHASE B — Gated mutations 🪪 (LOCKED rule 6: owner product decision + per-feature QA + welfare-check)
- [ARMED 2026-06-25] session service-suspend — `service_suspend_gate()`==**true** (QA passed: running-service
  exact-restore + UAC-cancel=no-partial + critical-blocked; owner sign-off) + selection UI in `GamingMode.tsx`.
  Boundary re-verified clean (no new IPC/capability; production elevation untouched). ✅ shipped in the 2026-06-26 rebuild
  (NSIS `512DAFF3…`) — NOTE (2026-06-27): installer superseded since; reinstall is Claude's job (silent-reinstall law), not an owner action. Current installer + live state → `docs/RELEASE_STATE.md`.
- [ARMED 2026-06-26] telemetry scheduled-task disable (debloat) — `bloat_removal_gate()`==**true** (QA passed:
  exact disable→enable restore + UAC-cancel=no-partial + off-list/Defender rejected; owner curated list = all 3 +
  sign-off "run all 3") + Fix-surface UI (`DebloatTasks`, reversible via Trust Ledger). ✅ shipped in the 2026-06-26 rebuild
  (NSIS `512DAFF3…`) — NOTE (2026-06-27): installer superseded since; reinstall is Claude's job (silent-reinstall law), not an owner action. Current installer + live state → `docs/RELEASE_STATE.md`.
- [⛔ WALLED 2026-07-01] GPU profile apply (AMD) — **blocked by rollback-first (LOCKED rule 3).** AMD GPU
  profile state (Anti-Lag/Enhanced-Sync/Tessellation/Sharpening) is NOT user-mode readable (lives in
  Adrenalin's private store; registry exposes only `*_component_na` capability flags — see
  [[detection-feasibility-walls-usermode]]). `amd_freesync.rs` ADLX FFI is read-only (FreeSync), no write path.
  Can't snapshot the true prior → must REFUSE per [[mutation-snapshot-failsafe-idiom]], not apply. Only `KMD_Chill*`
  is readable (low-value, driver-fragile). Excluded unless a full vendor-SDK write+read path is built (big project).
- [BUILT-DARK 2026-07-06] bloat removal → **preload-app removal** — owner nod given 2026-07-06 after a scope
  discussion (spec `docs/superpowers/specs/2026-07-06-preload-app-removal-dark.md`): the `HKCU\Run` DELETION half
  was **dropped** (the reversible startup disable already ships — `set_startup_entry_enabled`, same flag Task
  Manager flips; deleting the leftover line buys tidiness at real rollback cost) and the buildable half is
  **per-user UWP preload-app removal**, now built dark: `KnownPreloadApp` typed allowlist (4-app starter set,
  Store-published + no-user-data rules; Clipchamp/To Do excluded as data-adjacent; **Spotify cut by owner
  curation 2026-07-06** — same package id as a real install, no honest "stub" framing), `preload_removal_gate()`==false,
  snapshot-or-refuse apply (live PackageFullName/FamilyName/Version read, verified-gone re-read), two-tier honest
  undo (silent re-register verified by re-read, else Store-page hand-off returns Err so the ledger entry stays
  active), gated `remove_known_preload_app` + read-only `get_preload_apps`, dark-safe `PreloadApps` Fix card
  (renders nothing while dark, test-pinned). **Arming rides its own gate:** live QA harness
  (`qa_remove_then_reinstall_round_trip`, #[ignore]) + Store ProductId link-verification + owner curates the final
  list + explicit sign-off.
- [~] one-click re-apply — **SPLIT (audit 2026-08-03), because the single `[~]` read as one
  half-built thing and it is two separate states.** ① **batch-apply primitive: DONE + guarded** —
  `apply_recommendations_batch`, IPC-registered, invoked from App; parity guard
  `src/appliable-parity.test.ts` pins the FE/BE `APPLIABLE_REC_IDS` lists against drift.
  ② **a dedicated "re-apply everything that drifted" button: NOT BUILT** — only per-item re-apply
  exists. Original note: `apply_recommendations_batch` (`history.rs:528`,
  validates `APPLIABLE_REC_IDS`, single-consent + ONE UAC) wired at `App.tsx:772` on the QA-closed apply path.
  A dedicated "re-apply everything that drifted off in one click" button would be a small UI add on top if wanted.
- Gaming Mode (F1) — built, **gate still false**; needs physical-reboot QA + owner sign-off.
- [x] `--run-elevated` boundary-side guard (defense-in-depth, owner-approved 2026-07-14) — **SHIPPED
  2026-07-15.** Chosen lock: a ONE-TIME dispatch ticket over the HMAC option (no crypto dep, nothing
  secret to steal, stronger one-shot semantics). `run_elevated_powershell` mints a ticket file
  (`%APPDATA%\Compy\runtime\elev-<pid>-<seq>.ticket`, content = the exact command hex) and passes its
  path as a third argv (`mint_elevation_ticket` `actions.rs:1149`); the helper refuses any hex that
  doesn't byte-match the ticket (exit 3, runs ZERO PowerShell) and consumes it before running
  (`consume_elevation_ticket` `actions.rs:1171`, `run_elevated_helper` `lib.rs:69`, argv `main.rs:12`)
  — so a dispatch executes at most once and replay is dead. Exact-match against what the parent just
  minted ⇒ can never false-reject a legitimate apply (every builder passes by construction — the hard
  requirement). Honest attribution kept: mint failure = third pre-launch nothing-ran refusal
  (`elevation_error_nothing_ran`); exit 3 reads approved-but-failed; decline path cleans the ticket up.
  Guard tests both directions incl. end-to-end helper refuse/replay (cargo 724/0, clippy clean).
- [ ] **"Optimization Cleanup"** (name locked by the owner) — find + classify the residue OTHER tools/guides
  left behind (registry keys, services, scheduled tasks, orphaned tweak-pack artifacts) as
  useful / placebo / risky / outdated / unknown, and offer restore ONLY where the prior/default is
  unambiguous. **Own spec'd train: research → spec → scope-gate — never a same-session build.**
  Mutation-adjacent ⇒ full mutation-gate before any apply path exists. ~~restores ride a SEPARATE
  recovery-snapshot mechanism~~ — **fork RESOLVED by the owner 2026-07-16: restores REUSE the
  Trust Ledger** (provenance `leftover_adopted`, already built) — one rollback story, one audited
  persistence path; a second snapshot store would duplicate the H1/atomic-save machinery and
  fragment "undo everything" across two ledgers.
  Distinct from UI_VISION_BACKLOG §F (upgrade-path engine) — different feature, don't conflate.
  Provenance: panel-review brief 2026-07-15 §4.1 (`docs/reviews/2026-07-15-cc-brief-panel-review-execution.md`)
  + archived review (`docs/reviews/2026-07-15-consumer-panel-review.md`).
  **Research stage DONE, 2026-07-16 (Cowork):** spec at
  `docs/superpowers/specs/2026-07-16-optimization-cleanup-research-spec.md`. **Headline finding: this
  is mostly already built.** `leftovers.rs` (9 detectors) ships live read-only today; 7 of 9 already
  have typed rollback resolvers built + fixture-tested in `actions.rs`, dark only behind
  `restore_gate()==false` + no Tauri command registration (Leftovers v2, `docs/superpowers/specs/
  2026-06-11-leftovers-v2-dark-wave2.md`). Genuinely new: broader detection (registry/service/
  scheduled-task residue beyond the 9 curated settings), a formal 5-bucket taxonomy, and — the one
  real architectural fork — this BACKLOG entry said restores need a "SEPARATE recovery-snapshot
  mechanism," but the already-built dark path reuses the Trust Ledger with a `provenance` tag
  instead (fork RESOLVED to reuse — owner 2026-07-16, see above). Phasing per the spec:
  **Phase 0 SHIPPED 2026-07-16 (`55f68b6`)** — read-only audit live as a first-class Check section
  under the locked name. **Phase 1 SHIPPED 2026-07-16** — full mutation-gate run: owner-present
  live-UAC QA (W32PS/MPO/memcompress loops ALL PASS, memcompress scripts made state-aware),
  `restore_gate()` armed + `restore_leftover` registered, armed-world tests, QA receipts cleaned
  (owner call). Backend-only — no FE restore button yet; that UI is its own later train.
  **Remaining (still not scope-gated — not authorized to build):** Phase 2 (5-bucket taxonomy) →
  Phase 3 (net-new detection surface: registry/service/scheduled-task residue beyond the 9 curated
  settings; candidate detectors from Phase 1 QA: prefetch-sibling flags off, SysMain disabled).
  **Intelligence-platform relationship (2026-07-17, directive §0.11/§9):** Cleanup stays its OWN
  lane on its own mutation-gate discipline — never folded into intelligence trains — AND is a data
  source for the platform (external drift in Compy-managed settings + tweak-pack residue surface as
  timeline events); its Phase 2 taxonomy reuses the shipped real/placebo/risky vocabulary, which is
  the same grading language the intelligence layer must use. (These are Cleanup Phase numbers, not
  Intelligence Phase numbers — see the 🧠 lane's namespace rule.)

## PHASE C — Telemetry / outbound 📡 (stop-rule 3: own spec + security review + owner sign-off; ships DARK)
- [BUILT-DARK] Receipts opt-in consent UI + payload preview — `receipts.rs`, `ReceiptsConsent.tsx` (gate off)
- [ ] bufferbloat/speed-test send · jitter/packet-loss · session network telemetry · A/B preset efficacy · ISP/ZIP lookup

## PHASE D — Money / distribution 🔒 (owner territory — DEFERRED per current 1.0 focus)
- [BUILT-DARK] License / Pro gate scaffolding — `license.rs`, `ProGate.tsx`, `pro.ts`
- [ ] affiliate tag-swap · compy.gg waitlist funnel · Receipts arming · leaderboard · Pro multi-rig · B2B
- [PARKED] **Shop Report Mode** — B2B evidence workflow for repair/optimization shops (pilot scope when
  unparked: job name → before scan → approved changes → after scan → rollback availability → signed
  export). Logged for traceability ONLY — do NOT build ahead of B2B traction (MONETIZATION_PLAN Layer 4
  posture: "no page until you ask"); the Shop render tier of the A2 evidence-export item defers here.
  Provenance: panel-review brief 2026-07-15 §4.7.
- Funnel go-live mechanical steps parked in `docs/cowork-cc-relay/2026-06-15-funnel-golive-todo.cc.md` (owner-initiated).

---

> **✅ Phase-A closure (verified 2026-07-01):** no unchecked, non-gated, cleanly-buildable Phase-A `[ ]` item remains — the 5 open rows are all gated/walled: safe-to-suspend data (owner-curated) · peripheral debounce/Snap-Tap/Rapid-Trigger *detection* + sensor-ID DB (user-mode firmware-read wall, same class as DPI/line 355) · ISP-speed + DNS probes (📡 outbound-gated). Remaining VALUE is Phase B/C/D (gated). Supersedes the stale "Bottom line" below.

> **Bottom line (2026-06-23)** — superseded by the Phase-A closure note above; moved verbatim to `BACKLOG_ARCHIVE.md` (2026-07-22).
