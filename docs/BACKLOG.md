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

### Cycle 2026-07-15b — ✅ DIRECTOR #5 BUILT: SCROLL-SCRUBBED TELEMETRY THROUGHLINE — site-only, PRE-PUBLISH, NO gate moved, zero src-tauri, zero src/

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

### Cycle 2026-07-13f — ✅ 390px LANDING PAGE-EDGE OVERFLOW FIXED (the pre-existing defect 13e logged) — site-only, NO gate moved, zero src-tauri, zero src/

**Root cause (probed, not guessed):** `.topbar`, `.hero`, and `.article` each share their element
with `.wrap` (`<header class="wrap topbar">` …) and their `padding:` SHORTHANDS (`22px 0 18px` etc.)
clobbered `.wrap`'s `0 24px` side padding (same specificity, later in file). Below ~1128px the hero
ran edge-to-edge and the verdict ribbon (`.verdicts` `right:-10px` + `.vd::after` `inset:-7px`)
scrolled the page to 407px at a 390px viewport; article body text sat flush at x=0 on every
library/debunk page. **Fix (`site/src/library.css`, regenerated + restaged):** longhand
`padding-top/-bottom` on all three rules + `.hero h1` clamp cap 44→42px (the self-reviewer's
round-1 catch: the correctly-narrowed 569px column wrapped the hard-`<br>` headline to a 3rd line
at ≥1294px). Desktop effect: topbar/hero now ALIGN with every `.wrap` section (they were the odd
ones out by 24px). **bug→guard (`scripts/site-landing.test.mjs`): red-PROVEN on the pre-fix CSS**
— parses every rule, flags a `padding:` shorthand in any block whose subject is a wrap-combined
class (classes derived from the landing + both article templates), and pins generated==source css.
Verify: self-reviewer round-1 PASS on 390 visuals/768/1000 band/full-page eyeball + round-2 h1 ==
exactly 2 line boxes at 1280/1440/1920 (worker hit its session limit mid-round-2; the remaining
NUMERIC checks closed inline, disclosed: index sw==cw at 1280/1440/1920/390 w/ 0 offenders ·
article 390 padL/R 24px, h1/p x=24, sw 390 · article 1440 unchanged 720px centered) · site-landing
**17/17** + staleness guard · full vitest **1610/1610** (177 files). Impeccable-hook notes
(gradient hero h1, two article `border-left` pulls) = pre-existing taste-gated design, untouched.
Site stays pre-publish (deploy owner-gated).

### Cycle 2026-07-13e — ✅ SITE HERO RECEIPT IS NOW REAL (mock replaced with a measured trial) — site-only, NO gate moved, zero src-tauri, zero src/

**Cowork consumer-panel follow-up flagged the hero proof strip's numbers as fabricated** (marked
decorative in source: `fast-startup-off` "+8 fps · 1% low +11" — doubly fake, a boot-time tweak
can't move fps) — the "measured, not promised" brand illustrating its core claim with an invented
example. **Replaced with a REAL receipt produced through the app's own Lab → Benchmark
"Measure this tweak" flow on this rig:** `game-mode` applied 18:28 → measured on live Palworld
frames (5+5 windows, ~120 fps menu) → verdict **within noise** (no gain beyond the rig's
same-session calibrated ±0.7% run-to-run floor) → auto-rolled-back (Trust Ledger
`game-mode-1783992509604`). `game-mode` was the ONLY measurable candidate (every other appliable
rec is already applied on this rig); per the task's own rule the honest within-noise outcome ships
un-padded — and it literally demonstrates value card 02's "No measurable change gets called exactly
that." Provenance record: `site/src/proof-receipt.json`. bug→guard: `site-landing.test.mjs` now
pins the rendered strip to the provenance record (re-measuring must update both together) + bans
the fabricated trio from rendered copy. Site regenerated (`node site/generate.mjs`, index only —
deploy stays owner-gated; site is pre-publish). Verify: site-landing **16/16** · visual pass
1440px+390px (marginal 390px title overflow caught + fixed by shortening; page-edge mobile
overflow at 390px was PRE-EXISTING, identical render on the committed page — ✅ fixed in Cycle 13f).
**Note for a future better receipt:** a Keep-verdict receipt (real measured WIN) can replace this
one when one occurs naturally — e.g. a tester rig or a fresh Windows state where a START-HERE tweak
isn't already applied; the provenance+guard structure makes the swap a two-file edit.

### Cycle 2026-07-13d — ✅ GLOSSARY-TOOLTIP TRIO FIXED + SHIPPED LIVE `86ecad1` (installer SHA-256 `1C1F13DC…FE657E0`, stamp-verified) — NO gate moved, zero src-tauri

**Owner-reported (screenshot, Blackbook tape "1% low" gloss):** (1) tooltip overpainted by later tape
rows — root cause `animation-fill-mode: both` on the `.bc-row` reveal left every row a PERMANENT
stacking context (filled transform/opacity animation) so later siblings painted over the open tooltip;
fix `both → backwards` (`blackbook-console.css`) + css-scan guard banning `both`/`forwards`
(`blackbook-console.test.tsx`). (2) "More in the Blackbook →" unreachable — mouse-leave closed the
tooltip instantly across its 6px gap; fix 160ms close-grace in `Term.tsx` (wrapper re-entry cancels;
focus/Escape unchanged) + fake-timer guards (`Term.test.tsx`); benefits every Term site app-wide.
**(3) found by the fix's self-review (pre-existing):** the deep-link opened the library + expanded the
category but never SCROLLED — `Learn.tsx`'s scroll-into-view effect missed on first run (category
still collapsed → no cardRef) and lacked `openCats` in its deps; fixed + guarded (`Learn.test.tsx`,
spy at `HTMLElement.prototype` where `src/test/setup.ts` stubs it). Verify: tsc 0 · vitest
**1608/1608** (178 files) · self-reviewer **PASS** (live real data: tooltip opaque `rgb(20,24,36)`
over sibling rows; real CDP pointer crossed the gap; link navigated, card `rect.top=108` vs 1023+
off-screen before; stagger + reduced-motion intact; Monitor "frametime" gloss regression-checked).
Reviewer field-note: on 800×600 dev-CDP mouse tests, scroll `.v2-content.lenis` up first — a row
below the 600px fold makes `elementFromPoint` return null (environmental, not app behavior).

### Cycle 2026-07-13c — ✅ DEFAULT-ON GRADUATION + duo palette + A+B Blackbook SHIPPED LIVE `18272be` (installer SHA-256 `A8C341DE…61EC1C10`, stamp-verified) — NO gate moved, zero src-tauri

**Owner directives (this cycle, all owner-verbatim):** (1) "everything was supposed to be default on
to avoid the QA toggle section as per the consumer interest rec" → `compy_room_identity` +
`compy_blackbook_console` flipped **DEFAULT ON** (readers `!== "0"`, theme.ts; boot attr main.tsx;
both "(preview)" Settings rows REMOVED — devtools `"0"` failsafe stays, graduated-flag convention);
(2) "double color options rather than the ugly earth tones like olive … then leave that finished" →
`ROOM_ACCENT_SWATCHES` (src/design/room-identity.ts) re-curated to **15**: Rust/Olive/Pine pruned, 3
DUO swatches added (Cyan/Midnight `#35e0e8+#3b2a7a` · Red/Blue `#ff6b6b+#2f6bff` · Lime/Cyan
`#b6f24a+#35e0e8`; duo = bright PRIMARY for chrome/text, SECONDARY drives only the dim/line washes;
new helpers swatchKey/splitSwatchKey/swatchDotCss; duo persists as `a+b` key; picker dots render a
135° split — RoomAccentPicker.tsx, theme.ts applyRoomAccents); (3) Blackbook intuitiveness — owner
PICKED **"A + B together"** from the concept artifact
(https://claude.ai/code/artifact/88345144-e138-4b44-a71a-de487aa42929): BUILT in
src/surfaces/blackbook/BlackbookConsole.tsx + blackbook-console.css — (A) Receipts Strip (3 tappable
count tiles replace the `bc-status` line, filter the tape, aria-pressed, zero-count disabled) + (B)
sentence rows ("Compy applied…", "You played… for …", "You fact-checked a guide") + tape section head
("THE RECORD ─ everything Compy has done on this PC · since <date>", filtered ⇒ "· sessions only").
- **Round-1 self-review: FAIL with 1 real finding, FIXED:** a Home accent pick recolored chrome but
  never the rig hologram — use-rig-colors.ts read `.v2-room` while Home's `--ix-accent` re-point
  lives on the NESTED `.home-console` (custom props don't propagate up). Fix: prefer
  `.home-console` ?? `.v2-room` (src/surfaces/rig/use-rig-colors.ts) + bug→guard in
  room-identity.test.ts (call-order pin + stale-comment ban). Everything else round-1 verified PASS
  with direct evidence (contrast numbers, persistence, failsafes, Settings cleanup).
- **Verify state:** tsc 0 · vitest **1604/1604** (177 files; guards re-pinned to the new default-ON
  polarity in room-identity.test.ts / room-accents.test.tsx / blackbook-console-flag.test.tsx /
  blackbook-v2.test.tsx / hud-rooms-flag.test.tsx (classic suites pin `"0"`); new duo + strip +
  sentence + filter guards in room-accents.test.tsx + blackbook-console.test.tsx).
- ✅ **SHIPPED LIVE 2026-07-13 `18272be`.** The round-2 self-reviewer returned before the context
  refresh fired: **PASS all 8 items** on the owner's REAL 70-record logbook (native 1500×980 — rig
  recolor pixel-proven for Plum AND Cyan/Midnight with `--ix-accent` read back off `.home-console`;
  Lab emerald no-regression; strip counts 51/19/0 sum exactly to the tape; changes-tile "13 still
  on" == the bc-manage jump's number; filter/aria-pressed/disabled-zero live-verified; reduced-motion
  still; h1 "Blackbook"; field-guide strip unchanged; GL idle 0 draws/18s). One soft note logged: the
  changes-tile sub and the bc-manage CTA say near-identical things in different roles — wording
  tighten is a future-polish candidate, judged not-duplication. Committed `18272be` (15 files,
  explicit paths) → rebuilt (exit 0, exe embeds `18272be`) → ship-reinstall OK (stale-gate PASSED,
  installer SHA-256 `A8C341DEB55F32630E59144D6CA33CAF205A16B48A34F8923C27D65861EC1C10`, one on
  Desktop, launched) → **stamp-verified `18272be` live**. doc-sync same commit: RELEASE_STATE banner
  + Git-HEAD/installer rows; OWNER_ACTION_CHECKLIST **A8 + A9 → ✅ resolved-by-directive**.

### Cycle 2026-07-13b — ✅ DEAD-CODE CLEANUP + readiness leak fix SHIPPED LIVE `2b64c51` (code `c80678f`; installer SHA-256 `21942094…0930FF4F`, stamp-verified) — NO gate moved

**Turbo-window maintenance pass (owner-directed "full self review, maintenance, dead-code cleanup").** Three
read-only audits (frontend dead code · Rust dead-code+clippy · doc/stale-ref drift) fanned out; findings
applied serially, all mechanically verified. **Committed + pushed `c80678f` (18 files, −2154 lines).**

- **Deleted (grep-verified 0 importers, tsc-confirmed):** 7 never-adopted vendored React Bits dirs
  (`src/design/vendor/{DotField,GlareHover,GooeyNav,Grainient,Noise,PillNav,Radar}`) + `monotonePathD`
  (`src/design/console/monotone.ts`). `tokens-v2-guard.test.ts` "vendor kit present" floor 12→7;
  `THIRD_PARTY.md` rows pruned.
- **readiness.rs retired-label leak FIXED** (drift audit; room-labels-vs-nav-ids law): the applied-changes
  check detail said "roll it back in **Optimize**" (no standalone Optimize tab exists post the 2026-07-10
  ground-flip) → both strings now "in **the Lab**" (the undo home; backend can't read the runtime rail
  flag). The Rust test at `readiness.rs` that ENFORCED the stale text (false-green) → flipped into a
  bug→guard (asserts "the Lab" present AND no "in Optimize" dead-end).
- **Verify:** tsc 0 · **vitest 1593/1593** (177 files; −14 = per-component license tests for the removed
  vendor dirs) · cargo test readiness **35/0**. Zero mutation-boundary / gate changes.
- ✅ **SHIPPED LIVE 2026-07-13 `2b64c51`.** The next session's ship found HEAD had advanced to `2b64c51`
  (the docs persist-commit) AFTER the `c80678f` build, so the pre-built NSIS embedded `c80678f` while the
  stale-gate now demanded `2b64c51` — it would have (correctly) thrown. **Rebuilt at HEAD** (`npm run tauri
  build`, exit 0; sole `c80678f`→`2b64c51` delta is `docs/BACKLOG.md`, not compiled → binary functionally
  identical to `c80678f`; `build.rs` re-stamped `COMPY_GIT_HASH=2b64c51` via its `.git/HEAD` rerun trigger) →
  `scripts/ship-reinstall.ps1` (stale-gate PASSED, silent install exit 0, one installer on Desktop, launched)
  → **stamp-verified `2b64c51` live** (installed `%LOCALAPPDATA%\Compy\compy.exe` embeds `2b64c51` only — not
  `530ef8b`/`c80678f`). New installer SHA-256 `219420944926D99318CFB8FFA6D689952D154FF6005756926BF334640930FF4F`,
  supersedes `703F078B…9EE40B8`/`530ef8b`. **doc-sync same commit:** RELEASE_STATE new UPDATE banner + table
  Git-HEAD/Current-installer rows re-anchored `530ef8b`→`2b64c51`.
- **DEFERRED follow-ups (verified-safe, NOT done — flagged for a focused pass):**
  1. **`theme.ts` 14 orphaned exports** (0-reference, safe delete; superseded by `main.tsx` inline boot):
     `INSTRUMENT_THEMES`, `readLivingInstrument`, `applyLivingInstrument`, `applyLabGuided`, `applyLabBento`,
     `applySetupStepper`, `applyFirstCheckTheater`, `applyMonitorCards`, `applyHologramV2`, `applyTwoFutures`,
     `applyHud`, `applyHomeConsole`, `readDashV2`, `applyDashV2`. Deferred (14 edits in a critical file).
  2. **`ogl` npm dep likely orphaned** — was pulled ONLY by the deleted Radar + Grainient; verify no other
     importer, then drop from `package.json` (dedicated dep-prune pass). Noted in `THIRD_PARTY.md`.
  3. **RigViewer non-chromeless chrome (~140 lines, `src/surfaces/rig/RigViewer.tsx:77-97,114-214`)** — dead
     in production (only caller `LabConsole.tsx:303` passes `chromeless`), BUT `hologram-orbit-optin-guard.test.tsx`
     exercises the branch → needs an OWNER product call that LabConsole is the only forever-caller before trimming.
  4. **CompyHero + readCommitted/applyCommitted** — technically 0-importer but BACKLOG says "kept deliberately"
     (parked `compy_committed` future landing hero). NO action — documented keep.
- **Clean results (no action needed):** Rust crate is **0 cargo warnings / 0 clippy lints**; the 14
  `#[allow(dead_code)]` sites are intentional (gate-dark mutation boundary + published-schema fields). Doc
  drift: **0 state contradictions** (drift agent re-verified my `530ef8b` doc-sync incl. installer SHA by hash).
  TODO/stub debt: **0 open** (`latency.rs:944` is a resolved reference).

### Cycle 2026-07-13a — ✅ MONITOR v5 "frametime" JARGON GLOSS SHIPPED LIVE `530ef8b` (deferred Monitor-jargon bucket closed; installer SHA-256 `703F078B…B99EE40B8`, stamp-verified) — NO gate moved

**Resume (`/clear`, live `72ded53`/`cc9adb8`).** The room-identity palette train was fully done +
shipped; its ONE open item is the owner's one-flip eyeball on the pruned-15 legible palette (owner
territory — did NOT flip `compy_room_identity` default-ON). Pulled the next non-gated `[ ]` item from
this ledger: **Monitor-surface jargon glosses** (line ~589), whose sequencing gate ("AFTER the Monitor
v5 owner eyeball settles") had CLEARED — the console flipped DEFAULT-ON at `e195f70` (Cycle 12g).

- **The gap (source-verified, not assumed):** the Monitor v5 console (default face) DeckScope hero
  passed a plain string `label="frametime"` to `Oscilloscope`, rendering the raw term with no gloss —
  while its sibling **Play face already glosses it** (`Play.tsx:266` `<Term id="frametime">`) and the
  Deep-Monitoring section-help does too (`App.tsx:1800`). A jargon gap on the default face against
  CLAUDE.md's no-jargon promise.
- **Fix (`530ef8b`, zero `src-tauri`):** `Oscilloscope.label` widened `string → ReactNode`
  (backward-compatible; mirrors the ArcGauge ReactNode-label precedent — every other caller passes a
  string, grep-confirmed unchanged) + `DeckScope` passes `label={<Term id="frametime">frametime</Term>}`.
- **Scope discipline — only "frametime" glossed.** Inventoried the whole Monitor surface: `1% low`
  (capture status) + `ETW` (honest line) already glossed on the console; FPS/latency/spikes/budget were
  deliberately LEFT plain — they're consumer relabels, self-explanatory, or have no correct glossary
  term. Glossing "LOWEST LATENCY" with the `input-latency` term would be FACTUALLY WRONG (the readout is
  a frametime minimum, not click-to-photon input lag) — facts-first over a lazy gloss. monitor-panels'
  "frametime"/"FPS" are second-exposures (the section-help above them already glosses frametime) → no
  re-gloss (one-tooltip-per-label rule).
- **bug→guard:** `deck-scope.test.tsx` +2 guards — the hero renders a real glossary Term
  (`.osc-label .kl-term` == "frametime") and the tooltip reveals the definition (a dead id fails soft to
  plain text, so the guard would find nothing → pins the id stays real).
- **Verify:** tsc 0 · vitest **1607** (177 files, +2) · **self-reviewer PASS 8/8** (live 1500×980 CDP:
  `.osc-label .kl-term` `rgb(139,147,167)` uppercase matching siblings, dotted accent underline ~6.37:1
  on the dark panel; tooltip opens/closes on hover+click, not clipped, definition + Blackbook link
  intact; FPS/latency/spikes/budget stay plain; backward-compat proven).
- ✅ **SHIPPED 2026-07-13:** committed `530ef8b` (3 explicit paths, no `git add -A`) → `npm run tauri
  build` (crate recompiled 28.65s) → `ship-reinstall.ps1` (stale-gate passed, one installer on Desktop,
  silent `/S`, launch) → installer SHA-256 `703F078BCEA0BBA2BF740F93A7E559A421CB06D82CC5B981C8A6463B99EE40B8`,
  **stamp-verified `530ef8b` live** (installed exe embeds HEAD). **doc-sync same cycle:** RELEASE_STATE
  new UPDATE banner + **table Git-HEAD/Current-installer rows re-anchored** `72fa005`→`530ef8b` (they had
  drifted behind the banners through the whole `8a9ab76`/`8e6920f`/`cc9adb8` palette chain — table-drift
  class fixed); this cycle + the deferred item → ✅.
- ⛳ **RESUME:** deferred Monitor-jargon bucket CLOSED. The room-identity palette's owner one-flip eyeball
  (pruned-15 legible palette → `compy_room_identity` default-ON) remains the standing owner-territory gate
  (Cycle 12l) — do NOT flip without owner sign-off. Next non-gated `[ ]`: see the ShellV2 topbar tagline
  (owner-taste, line ~547) and the deeper data/outbound-gated items (owner-curated / outbound walls).

### Cycle 2026-07-12l — ✅ PALETTE PRUNED 20→15 SHIPPED LIVE `8e6920f` (differentiation prune, behind `compy_room_identity` DEFAULT OFF; installer SHA-256 `51B0A754…3862F39A`, stamp-verified) — owner one-flip eyeball on the pruned palette is the open gate

**Owner verdict on the 20-swatch expansion (2026-07-13): "looks good but i agree to prune and widen
variety more differentiation."** So the direction is approved; he wants the near-dupe clusters cut and
the survivors spread wider. **Default-ON flip still DEFERRED** until he re-eyeballs the pruned set.

- **✅ SHIPPED `8e6920f`:** `ROOM_ACCENT_SWATCHES` re-curated 20 → **15** (9 bright + 6 dark). Pruned the
  clusters — four warm-oranges → Amber only; three pinks → one Magenta; teal/cyan overlap → Teal only —
  re-spread the survivors, added a dark **Olive** `#5f5620` (ink `#f7f3e0`) in the empty dark-gold gap.
  Removed: Cyan, Gold, Coral, Rose, Hot Pink, Azure, Chartreuse, Tangerine, Indigo; Sky/Lime hexes
  retuned. Final 15: Violet · Teal · Amber · Emerald · Sky `#46a8ff` · Red `#ff6b6b` · Yellow `#ffe14a`
  · Lime `#b6f24a` · Magenta `#f45cc6` (bright) + Rust · Olive · Pine · Slate · Plum · Wine (dark).
- **Differentiation VERIFIED, not eyeballed:** CIEDE2000 across all 15 → minimum non-preset pairwise
  distance **18.0** (was 13.4 for the Magenta/Rose pair the adversarial review flagged); the only closer
  pair is the LOCKED Teal/Emerald presets (14.3, both green, unavoidable). Legibility law + adaptive-ink
  mechanism (`theme.ts`) unchanged. Zero `src-tauri`.
- **Verify:** tsc 0 · vitest **1600** (177 files) · CIEDE2000 audit · fresh-context adversarial review
  (Magenta/Rose fix confirmed) · **self-reviewer PASS** (live CDP 1500×980: Monitor/Plum computed text
  `#f4e9ff` on the dark fill; Blackbook/Magenta computed text `#1a0a2e` on the bright fill; grid 5×3).
- ✅ **FOLLOW-UP TRAIN DONE — dark-accent-as-TEXT legibility SHIPPED `cc9adb8`** (installer SHA-256
  `B7931E4E…5A3E92BC`, live-stamp-verified, supersedes `51B0A754…3862F39A`; SAME flag `compy_room_identity`
  **DEFAULT OFF**). Where chrome used the room accent as direct **foreground TEXT** on a near-black bg
  (`.dock-node-primary` Home dock, Lab station tabs, blackbook `.bc-tag`/`.bc-state-on`/`.bc-manage`,
  Monitor `.mc-cap`/session meta) a **DARK** accent rendered ~2.5:1 — the adaptive ink covered
  accent-as-**FILL** only. **Fix:** each of the 6 dark swatches gained a paired light, hue-carrying
  `text` tint (`room-identity.ts`, `swatchText()`); `applyRoomAccents` (`theme.ts`) emits
  `--v2-accent-text`/`--ix-accent-text` (the light tint) for dark picks only — bright picks emit
  neither. Swept the in-room accent-as-text sites `var(--ix-accent)`→`var(--ix-accent-text)` (dock,
  blackbook-console, monitor-console, Lab, lab-bento) + `var(--v2-accent)`→`var(--v2-accent-text, var(
  --v2-accent))` (masthead sep, forward-door arrow, chip-count, home-hud); `home-console` gained
  `--ix-accent-text` via the fallback (descendant of the managed target). Scoped `.v2-room` overrides
  for the 3 dual-context glyphs (Check ✓ / GamingMode marker / Learn superseded-link hover) that ALSO
  render outside a room. A read-only scope audit **corrected the earlier "dozens across arc-instrument/
  Check/BlackBox/ActionDrawer" estimate** — those render OUT of room (onboarding/FirstCheck/escape-hatch/
  portal/overlay) so a pick never reaches them; BlackBox already read `--ix-accent-text`. Guards: 3
  swatch invariants (legibility ≥4.5:1 vs panel · load-bearing · coverage) + swatchText + emit-mechanism.
  Verify: tsc 0 · vitest **1605** · read-only scope audit · fresh-context adversarial review (2 fixes:
  Learn hover, emit-test) · self-reviewer **PASS** (live 1500×980: dock `#ef8ea8` ~8.1:1, Monitor
  `#c79cef`, Blackbook `#68d2a6`, Lab `#98b4e6` ~8.9:1; flag-off byte-identity). **Flag STAYS DEFAULT OFF.**
- ⛳ **RESUME:** the palette AND the dark-accent-text legibility are both DONE + shipped. The ONE open
  item is **owner's one-flip eyeball** on the pruned-15, now-fully-legible palette → then the
  `compy_room_identity` default-ON flip (owner territory).

### Cycle 2026-07-12k — ✅ PALETTE EXPANDED 10→20 SHIPPED LIVE `8a9ab76` (neon brights + adaptive-ink dark tones, behind `compy_room_identity` DEFAULT OFF; installer SHA-256 `97C581BB…EEE7698`, stamp-verified) — SUPERSEDED by Cycle 12l (pruned to 15)

**Owner verdict on the Cycle-12j picker (2026-07-12): "i like it" — the picker feature is APPROVED.**
Follow-up ask, verbatim: *"maybe more variety of color diversity more neon or bright/dark tone mixed
idk just more variety."* Owner answered the A/B/both fork: **"i agree with both."**

**✅ SHIPPED (both A + B), `8a9ab76`:** `ROOM_ACCENT_SWATCHES` (`src/design/room-identity.ts`) grew from
10 bright swatches to **20** — kept the original 10, added **5 new neon/saturated brights** (Magenta
`#f45cc6` · Azure `#33b1ff` · Chartreuse `#d0f14e` · Tangerine `#ff9a2e` · Hot Pink `#ff5f9e`) and **5
true DARK tones** (Indigo `#4a37c4` · Wine `#9e1f46` · Pine `#12694a` · Plum `#6b2b9e` · Slate `#33507f`),
laid out as a clean 5×4 picker grid. **Option B (dark tones) landed via adaptive ink:** each dark swatch
carries a paired light `ink`; `applyRoomAccents` (`theme.ts`) emits it as BOTH `--v2-accent-ink` AND
`--ix-accent-ink` in the managed `<style>` per pick (so the light ink reaches every accent-fill consumer,
incl. Home which never re-points ink), flipping a dark fill to legible light-on-dark; bright picks emit no
ink override and keep the default dark ink `#1a0a2e`. **Legibility law mechanized BOTH ways**
(`room-accents.test.tsx`, +5 guards incl. `swatchInk`, the DARK-emits/BRIGHT-doesn't managed-style
contract, and per-room write isolation): every bright ≥4.5:1 vs `#1a0a2e`; every dark ≥4.5:1 vs ITS ink
AND genuinely <4.5:1 vs `#1a0a2e` (adaptive ink is load-bearing). Zero `src-tauri`.

- **Verify:** tsc 0 · vitest **1600** (177 files) · fresh-context adversarial diff review **SOUND**
  (min contrast Pine 5.94:1; all 20 pairwise-distinct) · **self-reviewer PASS** (live CDP 1500×980:
  Monitor/Indigo computed text `rgb(236,233,255)`=`#ece9ff` on the dark fill; Blackbook/Magenta computed
  text `rgb(26,10,46)`=`#1a0a2e` on the bright fill — contrast holds both directions).
- **Default-ON flip is STILL DEFERRED** — do NOT flip `compy_room_identity` default-ON. Owner re-eyeballs
  the NEW palette first (one flip: Settings → Appearance → "Room accent colors (preview)" ON → click a
  room's corner accent dot → pick a dark tone). This is the ONE remaining gate.

- **Current palette (10, all bright by necessity):** Violet `#a78bfa` · Teal `#3fd9c2` · Amber `#f0b878`
  · Emerald `#27e08a` · Sky `#5aa9ff` · Rose `#ff8ac4` · Coral `#ff9163` · Gold `#ffd166` · Lime
  `#a6e85f` · Cyan `#5fd7f0` (`ROOM_ACCENT_SWATCHES`, `src/design/room-identity.ts:55`).
- **The hard constraint (why they're all bright):** every swatch is guarded ≥ WCAG 4.5:1 vs the dark
  accent-ink `--v2-accent-ink #1a0a2e`, because the accent doubles as a **button/pill FILL with dark ink
  on top** (`room-accents.test.tsx:59`, "button-legibility law"). High-luminance neon/bright colours pass
  easily; **true dark-tone swatches FAIL** (dark accent under dark ink < 4.5:1) and the guard blocks them.
- **The ONE design fork the next session must resolve:**
  - **(A) Bright-only expansion — fast, safe, single-ink architecture untouched:** grow to ~16–20 swatches
    with far more neon/saturated range (electric blue, magenta, hot pink, chartreuse, orange, aqua,
    violet-blue, etc.), all still ≥4.5:1 vs `#1a0a2e`. Covers "more neon/bright + more variety" fully;
    does NOT deliver "dark tone."
  - **(B) Also unlock dark tones — bigger, touches the ink architecture:** make `--v2-accent-ink`
    luminance-adaptive (light ink on dark accents) so dark swatches stay legible as fills. Requires: the
    managed `<style id="compy-room-accents">` (`theme.ts` `applyRoomAccents`) to also emit the paired ink
    per swatch; the legibility guard extended to test each swatch against ITS ink (not a fixed dark ink);
    a re-check of every accent-fill use site (buttons/pills/chips) + `button-legibility-guard.test.ts`;
    self-review pass. **Recommended: do BOTH — (A) for the easy bright variety + (B) for a few dark
    swatches — so "bright/dark tone mixed" is actually satisfied** (TURBO window has budget for the rigor).
- **This is a TASTE deliverable** — the owner delegated the picks ("idk just more variety") but the final
  set is his eyeball. Present the expanded palette live (the picker shows it) and let him approve before
  the default-ON flip. Legibility law (`#1a0a2e` ink ≥4.5:1, or adaptive ink under option B) is
  NON-NEGOTIABLE — that's why it's curated swatches, not a free hex field.
- ✅ **DONE `8a9ab76` (2026-07-13):** owner chose "both" → shipped A (5 neon brights) + B (5 adaptive-ink
  dark tones), 20 swatches total. The palette/fork context above (10-swatch state, "why they're all
  bright", the A/B fork) is the point-in-time cycle record; the shipped result is the ✅ header + the
  bullets under it. Whitelist auto-derives from `ROOM_ACCENT_SWATCHES` (no separate `SWATCH_WHITELIST`
  symbol). **Only open item: the owner's one-flip eyeball on the NEW palette before any default-ON flip.**

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
- [ ] curated "safe-to-suspend" reference data (must be owner-curated, never LLM-generated)
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
  Learn terms). Unblocks when the owner curates the device list.
- [ ] sensor ID + known-issue DB (bundled JSON) — 🪪 **owner-curated-data-gated** (assessed 2026-07-05):
  the sensor silicon inside a mouse is not exposed over USB/HID (only the mouse's own product name is —
  already read, `latency.rs`); model→sensor mapping + "known issues" are third-party teardown claims =
  the owner-curated-never-LLM-generated class. Unblocks when the owner curates the DB.
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
- [ ] DNS resolution-time probe — 📡 outbound-gated (a resolution-time measurement IS a live DNS query = outbound call; held at the same wall as the ISP snapshot above — Cycle 2026-06-25d flagged it as gated)
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

## PHASE C — Telemetry / outbound 📡 (stop-rule 3: own spec + security review + owner sign-off; ships DARK)
- [BUILT-DARK] Receipts opt-in consent UI + payload preview — `receipts.rs`, `ReceiptsConsent.tsx` (gate off)
- [ ] bufferbloat/speed-test send · jitter/packet-loss · session network telemetry · A/B preset efficacy · ISP/ZIP lookup

## PHASE D — Money / distribution 🔒 (owner territory — DEFERRED per current 1.0 focus)
- [BUILT-DARK] License / Pro gate scaffolding — `license.rs`, `ProGate.tsx`, `pro.ts`
- [ ] affiliate tag-swap · compy.gg waitlist funnel · Receipts arming · leaderboard · Pro multi-rig · B2B
- Funnel go-live mechanical steps parked in `docs/cowork-cc-relay/2026-06-15-funnel-golive-todo.cc.md` (owner-initiated).

---

> **✅ Phase-A closure (verified 2026-07-01):** no unchecked, non-gated, cleanly-buildable Phase-A `[ ]` item remains — the 5 open rows are all gated/walled: safe-to-suspend data (owner-curated) · peripheral debounce/Snap-Tap/Rapid-Trigger *detection* + sensor-ID DB (user-mode firmware-read wall, same class as DPI/line 355) · ISP-speed + DNS probes (📡 outbound-gated). Remaining VALUE is Phase B/C/D (gated). Supersedes the stale "Bottom line" below.

## Bottom line (2026-06-23)
The 1.0 lane (Phase A) is **substantially but not fully built**. A1 and A6 are done; A2 mostly done; A3 and
A5 have scattered finishable gaps. **The real remaining bulk is A4** — Services advisory inventory, the
entire Peripheral Audit surface, deep Network detection, and the Monitor preset/OSD/hint cards. So: no, the
list has not been fully worked. The next-up, highest-leverage, non-gated work is **A4 + the A5 finishables
(wire `hwchange.rs` to the UI) + A3 entry metadata**.
