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

## 🧰 TOOLCHAIN — Fable-window persistence pack (Cowork lane, 2026-07-06)

> Owner directive: use the closing Fable-5 window to persist its judgment as toolchain assets
> (skills/guards/scripts) so post-Fable models (Opus 4.8 / Sonnet) execute at the same floor.
> Extend-and-consolidate, NOT replace (owner-confirmed): everything below slots beside the existing
> self-review / impeccable / coverage-sweep stack.

- [x] **5 new project skills** — `.claude/skills/{mutation-gate, gate-drift-audit, ship, guard-forge,
  doc-sync}` + **`.claude/skills/INDEX.md`** (trigger + cheapest-executor routing for all 8 skills,
  plus 4 tier-2 spec'd-not-built entries: receipts-copy-lint · new-tester-onboarding · council-strip ·
  receipts-arming-review). CLAUDE.md got a pointer stanza (PROJECT SKILLS INDEX).
- [x] **`scripts/verify-release-state.mjs`** — mechanizes layer-1 of the gate-drift audit (parses every
  backticked `path:line` citation in RELEASE_STATE.md, binds adjacent symbols, verifies location).
  **Proved itself on first run:** caught 6 citations drifted 77–253 lines (preload/receipt trains grew
  actions.rs/history.rs above the cited symbols) — all re-anchored same pass, layer-2 source re-read
  confirmed every gate VALUE unchanged (one truth fix: CSP note now quotes the literal connect-src).
  Script now exits 0 (21/21 anchored).
- [x] **`ship-reminder` PostToolUse(Bash) hook** — nudges the silent-reinstall law + RELEASE_STATE row
  after any `tauri build` (same pattern/throttle as self-review-reminder; behavior-tested pos+neg).
- [x] **Commit this train from the CC lane (Windows-side)** — committed 2026-07-07 from CC on `main`
  as `feat(toolchain): Fable persistence pack — 5 skills + INDEX + gate-drift script (6 citations re-anchored) + ship hook`.
  Verify script re-run at commit time: 22/22 citations anchored, exit 0. Note: `.claude/hooks/` is
  gitignored (standing pattern — self-review-reminder is machine-local too), so the ship-reminder
  hook SCRIPT stays local; only its settings.json registration is in git.

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
  - [ ] hardware-health trends · long-term personal knowledge graph (remaining Phase 4 slices).
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

## 🔥 TOP PRIORITY LANE (owner directive 2026-07-05) — de-slop the UI, organic + unique

Full spec: [`docs/superpowers/specs/2026-07-05-ui-deslop-organic-directive.md`](superpowers/specs/2026-07-05-ui-deslop-organic-directive.md).
Owner's verdict after living with the V2 shell: theme-consistent but reads as **generic AI-slop template design** — wants organic/unique, concise, crafted copy, and **trending design tooling (Figma / v0-Vercel MCPs)** used anywhere the UI uses recognizable AI defaults. Elevated to top priority per his instruction (after a confirmed clean stop — HEAD `b413204`, main synced, nothing stranded).

- [x] **Bug fixes (aesthetic-independent, ship now):** (#4) Home last-session numbers graded per-rig via `metric-grade.ts` + (#5) hologram stage fills its frame — **shipped `c945c88`** (2026-07-05), bug→guard tone-class pins in `home-v2.test.tsx`, live-verified via embedded hash (see RELEASE_STATE).
- [x] **Redesign lane — COMPLETE 2026-07-06 (`394dd2f` live). Direction CORRECTED (owner 2026-07-05, after seeing the built editorial): EDITORIAL RETIRED → pure Instrument / Stark-HUD.** Serif fights a live-telemetry app; the LOCKED direction is a clean, restrained operator-console HUD (mono/display type, gauges, oscilloscope traces, HUD brackets, scanline/CRT, JARVIS layer). The one hard steer: never gamer-RGB/neon.
  - [x] ~~Editorial Home pilot + 4-room rollout~~ — built (`1aa85d6`/`f3e90c1`), owner REVERSED on sight; **retired + deleted in `b60a2b5`** (serif fonts, `editorial-rooms.css`, `HomeEditorial`, room masthead branches all gone).
  - [x] **Pure-HUD Home pilot** — **shipped `b60a2b5`** (2026-07-05): `HomeHud` behind the SAME preview flag (key `compy_editorial` kept so the owner's opt-in carries over; now `data-hud` / Settings "Instrument HUD (preview)", **DEFAULT OFF**). System-console masthead (scan LED · segmented CHECKS/ATTENTION readout · uppercase display verdict) · bracketed + ruler-ticked bay around the real drag-orbit hologram, whisper scanline (stage + page CRT skin), event-driven parallax · telemetry column (fps-vs-Hz ring gauge — measured ratio only, renders only when both sides were read; graded ink carried over; oscilloscope trace on graph-grid) · ranked priority queue. Flag-off byte-identity pinned (`home-hud-flag.test.tsx`); **HUD is HOME-ONLY — the four rooms ignore the flag, pinned by `hud-rooms-untouched.test.tsx`** (checkpoint contract). Zero src-tauri. Self-review shots `docs/ui-sweep/shots/hud/`.
  - [x] #1 walk-the-bench rework — **shipped `f3e90c1`**, survives the correction (it rides `compy_lab_guided`, not the aesthetic flag): step-through REMOVED, symptom router leads as **"What are you here to do?"**; still DEFAULT OFF for the owner's eyeball.
  - [x] 🎨 **OWNER CHECKPOINT — round 1 verdict IN (2026-07-05): "needs changes first — type & copy voice"** (direction approved, no reject). Fix shipped `d577bd9`: verdict h1 → sentence case (the uppercase banner was the offender), buttons/segs/units/trace-cap drop uppercase (HUD register stays in micro-labels + readout + mono values), tracking normalized 0.14em, notes/dek/readings rebalanced; copy de-smugged (dropped "never guessed" / "a lesser tool would invent" / "not generic advice" tics; CPU callout now "no temp — Compy won't ship a kernel driver"; "//" → "·"; "Loading your rig in 3D…"). tsc 0 · vitest 1029 · self-reviewer PASS (computed textTransform/contrast/overflow evidence at native 1500×980). **Round-2 owner note landed mid-review ("keep the lightning border around the hologram") → shipped `6b2f46f`:** ElectricBorder frames the HUD hologram bay (its one sanctioned use-class, HomeV2 parity — theme-accent stroke, reduced-motion static-hairline fallback, stage's own border dropped); vitest 1037 · self-reviewer PASS (accent stroke confirmed live; brackets-inside-frame judged intentional-layered, borderline — drop bracket opacity if flagged busy). **Round-2 verdict IN (owner 2026-07-06: "all looks good") → APPROVED and SHIPPED:** `ce40f66` rolled the HUD language to all four rooms (shared `hud-rooms.css` + `HudMasthead` at the RoomShell verdict slot — masthead eyebrow "Repair bay / Live telemetry / Field records / Test bench" + honest LED + dateline, mono readout strip, page scanline; flag-off byte-identity re-pinned per room in `hud-rooms-flag.test.tsx`, superseding `hud-rooms-untouched.test.tsx` exactly as planned) · `96febda` flipped ALL THREE approved previews **default-ON** per [[ship-approved-work-as-the-build]] (`readHud`/`readLabBento`/`readSetupStepper` → `!== "0"`; Settings rows dropped "(preview)"; classic looks stay reachable as the "0" failsafe, toggle-off round-trip live-verified). tsc 0 · vitest 1048 · self-reviewer PASS (native 1500×980, default storage, all four rooms + Settings + Home-unchanged). ~~Remaining: deep Check/Fix internals de-slop + voice pass~~ → **SHIPPED `394dd2f` (2026-07-06), closing the lane:** CSS-only under the flag in `hud-rooms.css` (glow washes off; glass cards → hairline log rows with semantic warn/accent border MIXES — deliberately no side-stripe; section labels → micro-label + hairline rule; pills → flat mono tags; zero DOM delta so the flag-`"0"` failsafe stays byte-identical by construction) + surgical unflagged voice pass on shared strings (driver notes, startup-limiter reason + stale "in Optimize" self-ref, "YOUR rig" shout, "dialed in" double-say fixed + re-pinned, consent note, refuse intro drops the "honest" self-label). tsc 0 · vitest 1048 · self-reviewer PASS 7/7 (incl. flag-off classic round-trip) · installer rebuilt, silent-reinstalled, **stamp-verified `394dd2f` live** (RELEASE_STATE row current). **No non-gated item remains on this lane.**
  - [x] ✅ **SHIPPED LIVE 2026-07-06:** installer built from `96febda` (NSIS SHA-256 `62E2D5CC…F5AE9`), silent-reinstalled via `scripts/ship-reinstall.ps1` (stale-build gate passed), **installed exe stamp-verified `96febda`**, one installer on the Desktop. Self-reviewer stepper addendum came back **PASS** (default-ON stepper at 1500×980; connector accent proven theme-token-driven Violet→Emerald, never vendor purple). Current-state row: RELEASE_STATE.md.
  - Note: #6 "trending design tooling" — v0/Figma MCPs spend owner-gated credits ([[v0-mcp-for-compy-ui]]); pilot built in-repo instead (zero network, zero new deps). Use tooling only if a room's language demands it.
- [x] **Lab bento checkup — COMPLETE (approved + default-ON in `96febda`, live). (owner directive 2026-07-05, reactbits MagicBento prompt)** — **built `b0ec87a`**, behind `compy_lab_bento` (Settings → Appearance "Lab checkup bento (preview)", DEFAULT OFF): station-card grid left→right in bench order (status LED · Measured/Not-yet chip · educational lab notes) + synthesized checkup report (coverage headline · per-station annotated readings, `stationReading` one-source · ONE next step); cards are doors onto the existing router jump; stations render below in guided numbered form. Flag-off byte-identity test-pinned in both guided states; theme-accent glow (vendor purple can never paint, test-pinned); 16 new guards, vitest 1029. Spec `2026-07-05-lab-bento-checkup.md`.
  - [x] 🎨 **OWNER CHECKPOINT:** Lab checkup bento — **approved (owner 2026-07-06: "all looks good")**; flipping default-ON with the rollout-train rebuild.
  - [x] Stepper (owner's 2nd reactbits prompt, pre-vetted pass) — **shipped `76cfb5e`** (2026-07-05), behind `compy_setup_stepper` (Settings → Appearance "Setup stepper (preview)", DEFAULT OFF): the Setup & Tour's footer progress row as numbered React Bits step indicators (active dot · check-marked completed steps · animated accent connectors · click hops to a step). Vendored per the law (StepIndicator/StepConnector exported; vendor purple moved out of the motion variants into token CSS, can never paint — test-pinned; reduced-motion gated). Flag-off byte-identity pinned; 7 new guards, vitest 1037; zero src-tauri. Self-review PASS at native 1500×980.
  - [x] 🎨 **OWNER CHECKPOINT:** Setup stepper — **approved (owner 2026-07-06: "all looks good")**; flipping default-ON with the rollout-train rebuild.

## 🚀 LAUNCH RUNWAY — the ordered cutline to first launch (Cowork consolidation, 2026-07-06)

> Owner asked for the linear path to "MVP final / first launch." Verified against code by a
> read-only sweep 2026-07-06: **zero open code stubs** (no `todo!`/`unimplemented!`/FIXME across
> src-tauri + src; the single TODO hit is a resolved-2026-06-11 reference, `latency.rs:944`) and
> **no real UI gaps** — every "not yet / placeholder" string is an honest-by-design label,
> loading-state comment, or literal input placeholder. "Unfinished" = the gated features + owner
> decisions below, not hidden broken code. Gate booleans re-verified at source (drifted lines:
> service_suspend `actions.rs:1435` · bloat_removal `actions.rs:1506` · preload `actions.rs:1646`).

- **RUNG 0 — in flight now (CC, Fable window):** the 2026-07-06 train
  (`docs/superpowers/specs/2026-07-06-firstcheck-monitor-mvp-train.md`) — T0 stamp-check ·
  T1 FirstCheck dedupe · T2 FirstCheck stepper redesign · T3 Monitor summary-first ·
  T4 owner-picked R&D components (`2026-07-06-design-rnd-options.md`) · T5 optional QA filler.
- **RUNG 1 — DECIDED (owner, 2026-07-06): beta ships from CURRENT `main`** ("more complete in
  the way I want it"). Frozen `16069fa` stays archival. Consequence: RUNG 2 is now REQUIRED.
- **RUNG 2 — REQUIRED before any send, in order:** ① ✅ **single-prompt Gaming Mode elevation
  fix DONE 2026-07-07 (T6)** — session-start advanced tier batches to ONE elevation
  (`apply_elevated_tier`, gaming_orchestrator.rs; ≤1-dispatch cargo pin; no-partial +
  UAC-decline honesty preserved; mutation-gate 10/10; stop/restore side still elevates
  per change — out of T6 scope, flagged to owner) → ② ✅ **§6/§7 installed-build QA,
  CC-runnable parts DONE 2026-07-07 (T5, on the `5f765e4` installer):** §7 all-items sweep
  caught 3 honesty gaps (vendor-honesty line unreachable behind `{!embedded}` · tour never
  told the no-CPU-temp story · §7 items 1–2 anchored to retired UI) → fixed `ff186e6` +
  focused self-reviewer PASS on the shipped build; §6 corrupt ledger (fail-loud quarantine
  to `.corrupt`, empty load, no crash) + missing ledger (empty, no crash) proven live, real
  ledger + orphan gaming-session restored hash-identical; cancelled-apply covered by §1.
  **One §6 leg is owner-present by construction — helper-crash** (the FPS helper runs
  ELEVATED: starting it and killing it each take a UAC consent; fps.rs:11/371) — folds into
  ③'s owner session →
  ③ ✅ **owner-run GAMING_MODE_QA.md live case #4 — CLOSED 2026-07-07** (owner ran start →
  reboot → "Restore now" and confirmed the enable was exactly ONE UAC; CC read-only-verified
  the restore: session contract cleared — only reachable when every restore confirms — and
  every probed value matches his standing ledger state; cases #4 + #10 marked PASSED in
  GAMING_MODE_QA.md). Findings logged: **T6b candidate** (the 2 restore UACs = unbatched
  restore side, per elevated change) · **UX-gap candidate** (restore success shows NO visible
  confirmation — owner couldn't tell it worked). The old orphan-session file is GONE from disk,
  so the pending "~5 old-style prompts" restore-click leg is moot/absorbed by tonight's run.
  **§6 helper-crash probe CLOSED 2026-07-08 — RUNG 2 fully done:** owner enabled FPS (one
  UAC) → elevated helper PID 17900 up, `fps.json` writing at ~1s cadence (mtime
  00:38:16→00:38:20 observed) → owner Task-Manager-killed 17900 → `fps.json` froze at
  00:39:16, `fps.alive` heartbeat cleaned up, no ghost process (only the main app remained) →
  owner re-enabled at 00:39:51: NEW helper PID 17820, `fps.json` writing again
  (00:40:22→00:40:25 observed) — full crash→detect→clean→recover cycle backend-PROVEN, and
  the owner confirmed (2026-07-08) the Monitor room UI showed the FPS sensor STOPPED after
  the kill (not frozen/false-live). Closed in RELEASE_QA.md §6 + the RELEASE_STATE Snapshot
  "Last full installed-build QA" row the same commit; owner-legs memories deleted.
- **RUNG 3 — private-beta send (owner distribution act):** friends + Discord seed channel per
  RECEIPTS_DOCTRINE Phase 1 / zero-budget law. BETA_TESTER_README + TRACKER already exist.
- **RUNG 4 — public-launch gates (owner/$-gated, parallel once beta feedback flows):** code
  signing (Azure Trusted Signing route) · legal finalization (EULA/PRIVACY drafts → final) ·
  GitHub repo rename + `compy.gg` domain (bundled at first public exposure, per CLAUDE.md).
- **NOT launch blockers (each gated by its own track, deliberately dark):** Receipts arming
  (security review + consent UI) · preload-removal arming (live QA + owner-curated list) ·
  remote-fetch arming (production key + CDN + semver + rollout) · licensing/Pro enforcement ·
  A4 advisory items (owner-curated data / outbound-gated) · Phase C/D money items.
- ✅ **Two Futures measured split — BUILT v1 2026-07-07 (`4df5448`+`eb5df81`), owner pulled it
  AHEAD of RUNG 2 by explicit same-day order** (frontend-only, flag `compy_two_futures` DEFAULT
  OFF, zero src-tauri — moves no gate; **RUNG 2 above stays REQUIRED + open**). Benchmark
  station: baseline-vs-now rig pair (one canvas, ghost vs accent+shell), struct-sourced delta
  rail, subsumes the efficacy card flag-on. THE LAW pinned by the anti-fabrication guard suite
  (`two-futures.test.tsx`, 21 tests: empty-state truth-table, no-fallback source grep, flag
  wiring both ways, partGlow neutrality). v1 scope note in the spec: trial `MetricWindow` never
  crosses IPC → v1 renders from the benchmark pair only; trial-sourced split = v2 (+persist-
  latest Rust read). Self-reviewer PASS (fresh full pass at `eb5df81` after subsume + azimuth
  fixes). ✅ OWNER EYEBALLED 2026-07-07: **"looks really good BUT the hologram itself has no
  visible purpose or information integrated — just a cool split with no apparent changes
  before/after."** Verdict: stays preview-OFF; default-ON deferred INTO the Lab-establishment
  train below (the split's hologram must carry part-anchored, measured information — changed
  components visibly marked, deltas anchored to parts — not just the composition). Same train,
  LIVE surface: bay-shell `clearSpot` viewer-facing window (`209e4dc`).
- ✅ **Hologram shell-blink flicker — ROOT-CAUSED, FIXED + SHIPPED LIVE `d557e70` (2026-07-07):**
  the owner-clipped bay flicker (evidence `docs/superpowers/specs/assets/2026-07-07-holo-flicker/`)
  was the vendored shader's UPSTREAM per-frame blink time-hash pumping the whole DoubleSide
  additive shell (±2–4 mean-Y, Bloom-amplified; orbit-ON only — T1.5's idle fix had merely hidden
  it at rest; Glitch/clearSpot/b6687b3 guards exonerated). Fix at the callers, vendor file
  untouched: `enableBlinking={false}` on both mounts + `fresnelOpacity` 0.7→0.42 (matches the
  approved mid-state look, not the wash peak). bug→guard `holo-shell-blink-guard.test.ts` (every
  `<HolographicMaterial>` mount must disable blink; off-branch `': 1.0'` constant pinned). tsc 0 ·
  vitest 1103 (148 files) · self-reviewer PASS (orbit-on luma probe: max ΔY 0.95/1.27 vs the 2–4
  defect scale, 0 pumps; idle rest 0 draws/16s). Installer rebuilt + silent-reinstalled,
  **stamp-verified `d557e70` live** (RELEASE_STATE row current). Owner eyeball: orbit ON on the
  bay (+ Two Futures preview shells if flipped).
- ✅ **Per-part identity colors + see-through case — SHIPPED LIVE `48ca9ec` (2026-07-07, owner
  round-2 directive on the bay):** fixed theme-INDEPENDENT `PART_KIND_COLORS` (board slate · cpu
  amber · ram violet · gpu teal · storage green · cooler ice · psu copper · fan sky; ghosts keep
  the faint ink — honesty unchanged); shell dropped to a whisper (hologramOpacity 0.08 / fresnel
  0.2 / wireframe 0.28); theme key lights neutralized in all three rig scenes so the hues read.
  Guard: `use-rig-colors.test.ts` rewritten (hue uniqueness · theme-independence · ghost honesty).
  tsc 0 · vitest 1104 (148 files) · self-reviewer all-8-substantive PASS (pixel-sampled hues,
  Violet→Emerald part-hue identity, idle rest 0 draws/15s ×2); its wording nit + sibling
  light-wash follow-up fixed same-commit. Installer rebuilt + silent-reinstalled, **stamp-verified
  `48ca9ec` live**. Owner eyeball: the recolored bay.
- ~~**PARKED — owner's Lab-establishment train**~~ — **RESOLVED:** owner delivered direction verbally
  2026-07-08 (`2026-07-08-lab-proving-ground.md`); the train built + shipped `f16d158` (flag OFF), owner
  **REJECTED the UI direction 2026-07-09** (drag gallery + linear spine), and a new **"Instrument Bench"**
  direction was researched + council-reviewed + **APPROVED same day**
  (`docs/superpowers/specs/2026-07-09-lab-redesign-direction-proposal.md`; Phase-1 plan
  `docs/superpowers/plans/2026-07-09-lab-instrument-bench-p1.md`). See the 🛰️ HQ STEERING LOG below
  (Cycle 2026-07-09c) for the live thread. Still-honored folds-in: Two Futures hologram-information
  feedback · Two Futures v2 · interactive hologram work under the honest-measurement law (anything on a
  part must trace to a measured struct).

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
- [x] persist a real DOWNSAMPLED fps-over-time series per session — `fps_series: Vec<(u32, f64)>` additive `#[serde(default)]` on `SessionSummary`: per-10s-bucket MEAN of the real ~1 Hz samples, real elapsed-secs x-axis (gaps in play stay gaps, never interpolated), capped 2160 points (6 h), kept for the most-recent 20 sessions and stripped on save for older; TS contract mirrored (`types.ts` `fps_series?: [number, number][]`). 5 guard tests pin bucketing math, gap honesty, the cap, pre-series serde-default parse, and the strip window. Unblocks the site ReplayHUD real trace + an honest in-app session chart (neither wired yet — no UI renders it in this train). Read-only/additive, no mutation boundary — `sessions.rs`, `monitoring.rs:984`
- [x] hardware-tier segmentation — LOCAL Entry/Mid/High band on the Benchmark surface from measured VRAM·cores·RAM (inputs named); reuses the canonical rig-tier bands via pure `benchRigTier`; like-to-like framing, no cohort/network — `372bde1`
- [x] percentile display — wired `percentile_rank` as a LOCAL display-only stub: each verified win ranked within the cohort of ALL the user's own wins (the scoreboard ledger), shown as "Top X% of your verified wins" in the award drill-down, labeled "local — no peer cohort yet"; gated below a 4-win floor; never persisted. Peer/cohort percentile stays Phase C gated — `0de96f0` (`benchmark_scoreboard.rs:63`)
- [x] CPU-runner flake fix (backend lane flagged) — `cpu_kernel` now guarantees ≥1 work chunk (do-while) so a starved tiny-run scheduled past its short deadline still measures real throughput instead of reading 0 and false-failing the shared green baseline; strong `> 0.0` shape assertion kept + a regression guard (`cpu_kernel_runs_at_least_one_chunk_past_deadline`) pins the contract; `benchmark.rs`, cargo 612
- [x] `normalize()` honesty fail-safe — a non-finite raw score now fails SAFE to 0 (no credit) instead of `Inf`→`.clamp(0,100)`→**100** (a fabricated "perfect" component score, the worst honesty failure). Currently unreachable (producers guard divisors via `.max(1e-6)`/`is_finite`) but guarded at the point-of-use so a future producer-guard regression can't invent a maxed score; invalid reference (non-finite/≤0) also → 0. Regression test pins Inf/NaN/-Inf + bad refs (was untested); real-path byte-identical — `2ee51aa` (`benchmark.rs:461`)
- [x] `completeness_pct()` honesty fail-safe (completeness-critic close-out of the above — the grep'd sibling) — its `ceiling <= 0.0` gate did NOT catch a non-finite input (`NaN <= 0.0` is false), so `+Inf current`→**100** (fabricated "fully optimized") and `NaN`→leaked through `.clamp()`. Now `is_finite` guards both inputs at the point of use, mirroring `normalize()`, so the boundary is uniform + safe-by-construction whenever this still-unwired primitive is wired. comparison::pct (guarded `base>0`, measured-FPS inputs, NaN-delta failure mode) + percentile_rank (u32-derived inputs) assessed safe — class now closed. Regression test pins Inf/NaN; finite-input behavior byte-identical — `dbc8358` (`benchmark_scoreboard.rs:75`)

- [ ] FPS presenter picker: desktop apps can win between matches — live §6 evidence 2026-07-22
  (40-min Marvel Rivals watch): with the game closed/loading, the dominant-presenter pick wandered
  to Discord/RadeonSoftware/Code/claude (electron/DXGI presenters). The empty-name/dwm case is
  FIXED (`f96347d` — unnameable presenter can never win), but a session that starts before the
  game launches can still attribute early samples to a desktop app. Candidate polish: fullscreen/
  foreground heuristic, or a known-desktop-app denylist extension, or only attach once a presenter
  sustains game-like present rates. Honesty question, not a crash — design it before arming.
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
- [~] vendor profile detection + advisory badges — vendor detected; AMD sensors verified, NVIDIA gated (Rule 5); AMD read-only advisory badges shipped (`vendorProfileInsights`, GpuProfile — Adrenalin-named HAGS/power-mode/thermal insights, no perf promise; NVIDIA/Intel get none)
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

## UI SLIM-DOWN TRAIN — "answer first, detail on tap" (plan: `docs/UI_SLIMDOWN_PLAN.md` §5, council-approved 2026-07-01)

- [x] **P1 slimRows (Optimize)** — `5bb13f4` (2026-07-01): `SlimRecRow` master-detail primitive + Fixes-segment
  render path behind `compy_slim_rows` (**DEFAULT OFF**, Settings → Appearance preview toggle). One measured
  proof line always visible (honesty guardrail, CI-enforced by `src/slim-row-proof-guard.test.tsx`); §8c
  pre-selected Recommended in the consent sheet (selection ≠ application); TrustSwitch untouched; zero Rust.
  Verified tsc clean + vitest 788/788. **Default-ON flip is an owner taste call after he reviews the look.**
- [x] **P2 Monitor Basic/Advanced split** — `db00a44` (2026-07-02): global Basic/Advanced contract
  (`theme.ts` ViewMode + `<html data-view-mode>`) behind `compy_basic_advanced` (**DEFAULT OFF**, Settings →
  Appearance preview toggle). Basic = 4 glanceable tiles (FPS+capture · GPU temp · CPU · RAM) + ETW honesty
  line + last-session door → Advanced→Sessions; Advanced = today's panels untouched; flag-off byte-identical
  (test-pinned). Same read-only sensor IPC, zero new commands, NVIDIA grading unchanged (LOCKED #5). Verified
  tsc clean + vitest 796/796 + live self-review (shots `docs/ui-sweep/shots/p2-*.png`). **Default-ON flip is
  an owner taste call.** Open taste notes: "Advanced" now names both the rail Lab surface AND the mode; Basic
  leaves the lower half of a tall window empty (answer-first minimalism) — both his call at review.
- [x] **P3 Home answer-first** — (2026-07-02): `HomeV3` surface behind `compy_home_v3` (**DEFAULT OFF**,
  Settings → Appearance preview toggle; supersedes the dashV2 layout when on). Verdict leads (squint-test
  hero) → the #1 limiter (LimiterCard built in CommandCenter — apply/rollback flow byte-identical) → 3
  glanceable last-session tiles (real numbers or the honest empty state; graded, NVIDIA temp stays ungraded
  per LOCKED #5) → the RETAINED 3D rig hologram centerpiece with the full hardware cards one tap away (plan
  §6 correction) → the Setup & Tour door. §8b backdrop: homeV3 defaults ambiance to "calm" (an explicit
  Settings choice wins) and auto-offs in Advanced mode — both live-verified. Flag-off byte-identical
  (test-pinned); zero Rust, zero new IPC. Verified tsc clean + vitest 804/804 + live self-review (shots
  `docs/ui-sweep/shots/p3-*.png`). **Default-ON flip is an owner taste call.** Open taste note: the verdict
  sentence and the limiter clear-state both say "measured clean" (the same pairing the classic Home had) —
  a P5 copy-pass candidate.
- [x] **Default-ON flip (all four slim-down flags)** — `733f132` (2026-07-02, owner call): `compy_slim_rows` ·
  `compy_basic_advanced` · `compy_home_v3` · `compy_calm_chrome` all read `!== "0"` (unset ⇒ ON) — the
  slim-down IS the build. Settings → Appearance toggles stay live as the opt-out; classic render paths kept
  as the failsafe. Zero src-tauri/IPC change; TrustSwitch/apply/rollback untouched. tsc clean · vitest
  809/809 (default-pinning tests inverted; flag-off byte-identical guards unchanged).
- [x] **P5.5 Optimize deep-clean** — `cccb80e` (2026-07-02, owner live-build critique, all six items):
  all-checks receipt rows (mark · name · one-line result, UI voice — mono terminal list gone from the
  settled surface) · driver freshness grouped to ONE card (row per device w/ kind chips, ONE shared
  "newer may be available" note, links behind Copy buttons only — raw URL text removed) · Gaming Mode
  doored into its own Optimize segment (NEW `compy_gm_door`, calm-chrome family, DEFAULT ON, Settings
  toggle, classic inline slot on `"0"` — live-verified both states) · History segment collapsed into
  Applied as one `History (N)` expander + honest empty state (no more near-empty third room) ·
  Optimize type voice unified (mono = numbers/stamps only; judgment: startup cmd path stays mono as a
  machine value) · **honesty fix:** rendered disclosure now "Compy earns nothing from these links
  today…" (the backend "may earn a commission" const is FALSE while links are tag-free; it stays in
  `priorities.rs` untouched as the Phase-D swap point — swap the render back the same commit tags
  arm; guard test pins both sides). Bonus: GamingMode "onWhat's this?" run-together fixed. Zero
  src-tauri diff (`git diff 733f132..cccb80e -- src-tauri` empty) · TrustSwitch untouched · tsc clean ·
  vitest 815/815 · cargo 659/0 (A6 green) · self-review shots `docs/ui-sweep/shots/p55/` · shipped +
  stamp-verified live `cccb80e`.
- [x] **P4 dedup: delete classic/losing render paths** — `f13f82a` (2026-07-02). **Owner verdict
  RECORDED 2026-07-02: keeping the new look** (the P5.5 critique said "keep visual language"; his
  follow-up "do the single thing that unblocks everything" cleared this gate). Removed the five
  slim-down flags (`compy_slim_rows/basic_advanced/home_v3/calm_chrome/gm_door`) + every classic
  branch they gated (−1196 lines): theme.ts readers/appliers, main.tsx pre-paint (view-mode mirror
  kept), Settings' five preview toggles, dashV2-Home + classic-Home bodies + orphaned
  `DashboardV2.tsx`, classic single-face Monitor, classic inline GM slot, header Export branch,
  calm-static backdrop branch. Deliberately KEPT (older families, separate approval train — P4b
  candidates): `compy_optimize` / `compy_monitor` / `compy_living_instrument` / `compy_dash_v2`
  (standalone Tune view="all" classic FixRow rides `compy_optimize`). Self-review follow-up
  SHIPPED same day — `706094f`: the applied-changes drift reason (rendered on the Home #1-limiter
  card + the all-checks row) now NAMES the drifted setting(s) via a new read-only
  `drifted_titles` on `AppliedChangesSummary` (≤3 named + "and N more", honest plurals) and says
  Optimize instead of the merged-away "Tune"; bug→guard test pins named-setting and bans
  "setting(s)"/"Tune" (`readiness.rs`; cargo 659 · clippy clean · no gate/mutation/IPC change).
  P4 verified: tsc clean · vitest 800/800 · cargo 659 · live self-review shots
  `docs/ui-sweep/shots/p4/`.
- [x] **P6 "Journey" pass — SHIPPED via the V2 shell train** (Cowork audit 2026-07-04, verified in code; ledger
  was stale — this item and the kickoff's "land the P6 spec" thread predated the V2 train absorbing it). The
  V2-2..V2-8 train re-scoped the P6 spec (`2026-07-02-p6-journey-spec.md`) directly onto the V2 shell rather than a
  separate `compy_journey` flag. `src/design/room-shell.tsx` ships the `RoomShell` 5-slot skeleton (§1), the
  `ForwardDoor` primitive, and `DOOR_MAP` with the EXACT §2 copy/destinations (home→"Find what's worth fixing"→Optimize
  · fix→"Watch it live"→Monitor · play→"See what changed"→Blackbook · learn→"Open the instruments"→Lab · lab→none) plus
  the §2 `doorOpen` placement rules (Optimize opens only in apply-complete; Monitor closes during live capture). The
  door renders inside RoomShell keyed by DOOR_MAP so a room can't pick its own destination — cleaner than the spec's
  per-room render. §3 guards live in `room-shell.test.tsx` (copy + destinations pinned literally); §4 tour alignment =
  the SetupTour journey recap (`SetupTour.tsx:39`). Hard line held: `git diff 706094f..4e07420 -- src-tauri/` empty.
  Shipped DEFAULT-ON as part of the owner-greenlit V2 train (not a preview flag), so P6's reversibility contract was
  satisfied by the V2 train's own gate. **Nothing left to land.**
- [x] **P5 calm chrome (side-pile collapse + chrome/motion pass)** — `33669a1` (2026-07-02): behind
  `compy_calm_chrome` (**DEFAULT OFF**, Settings → Appearance preview toggle; flag-off byte-identical,
  test-pinned). ONE "Nothing else needs attention" expander at the foot of Optimize/Fixes swallows all six
  "leave it alone" piles (measured fine · not worth touching · not for this rig · dismissed · refuse pile ·
  Past Tweaks) via SidePileContext portals (`side-pile.tsx`) — content/state/audited handlers stay in
  Check/Fix, moved never removed; inside the drawer the refuse pile is retitled "Deliberately refused" (it
  stacked against Check's same-named pile). Export left the persistent header for the setup-summary card
  (SessionDebrief's untouched). Calm ambiance drifts barely-there (§8b: 76s/94s @ 0.6 opacity; Advanced
  auto-off + reduced/hidden freezes intact); the Settings Ambiance picker now shows the true effective
  default (calm under homeV3). P3's open taste note CLOSED: limiter clear-state retitled "None found today"
  and Check's Biggest-limiters empty state deduped — "measured clean" has one owner per screen, guard-pinned
  (≤1 occurrence test). Verified tsc clean + vitest 810/810 + cargo 659 + live self-review (shots
  `docs/ui-sweep/shots/p5/`). **Default-ON flip is an owner taste call** (armed in his live profile with
  P1–P3 for the same review pass).

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
- [~] one-click re-apply (`APPLIABLE_REC_IDS`) — **covered:** `apply_recommendations_batch` (`history.rs:528`,
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

## Bottom line (2026-06-23)
The 1.0 lane (Phase A) is **substantially but not fully built**. A1 and A6 are done; A2 mostly done; A3 and
A5 have scattered finishable gaps. **The real remaining bulk is A4** — Services advisory inventory, the
entire Peripheral Audit surface, deep Network detection, and the Monitor preset/OSD/hint cards. So: no, the
list has not been fully worked. The next-up, highest-leverage, non-gated work is **A4 + the A5 finishables
(wire `hwchange.rs` to the UI) + A3 entry metadata**.
