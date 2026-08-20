# Compy — Backlog steering-log ARCHIVE

> Older HQ STEERING LOG cycles, moved out of `docs/BACKLOG.md` (2026-07-13 usage-audit boot-tax fix:
> the live ledger keeps only the newest ~12 cycles; every session was paying ~55k tokens to read the
> full history at boot). Same format, newest on top. Grep here for any cycle older than the live board.
> Current truth lives in docs/RELEASE_STATE.md — these are point-in-time records.

---

## 2026-08-20 — C-18 / C-18 guard / C-18b conformance rows, moved verbatim (BACKLOG byte budget)

Moved out of `docs/BACKLOG.md` when the C-17b review ship pushed it over the 114KB wall. Byte-for-byte.

- [x] **C-18 · SHIPPED 2026-08-19 — the classic Monitor shell is gone** (issue
  [#146](https://github.com/Pootytxng/sentinel/issues/146)). **The row was wrong THREE times and the
  third correction is the one that mattered:** `src/surfaces/Monitor.tsx` was never "genuinely
  unreferenced" — `MonitorV2.tsx:6` imported `TuningPresets` out of it and renders it live in the v2
  quiet slot, so deleting the file as written would have broken the build. What was dead was the
  ROOM inside the live file: `export default Monitor` had had no production importer since MonitorV2
  replaced it, only its own test and one `monitor-v2.test.tsx` block. Fix: `TuningPresets` moved
  verbatim to `src/surfaces/TuningPresets.tsx`, then the shell + `Monitor.css` + `Monitor.test.tsx`
  deleted (213 + 17 + 123 lines); the one assertion still worth keeping (un-`bare` presets supply
  their own `<h2>`) now runs against the component directly. No user-visible change — nothing
  mounted it on any flag path. Earlier corrections (Play / SessionDebrief / MonitorDomainCards are
  LIVE, `monitor-panels.tsx` is the `compy_monitor_console="0"` failsafe, not dead code) stand and
  are why this lane grepped the class by hand: [[audit-needs-completeness-critic-grep]].
- [x] **C-18 guard (bug→guard) — `src/reachability-guard.test.ts` grew a second tier.** The
  file-level guard could not see this defect by construction: the FILE was reachable through one
  live symbol while the ROOM inside it was dead. The new tier fails when a module's DEFAULT-EXPORTED
  symbol has no production importer under EITHER form (`import X from` / lazy edge, or
  `import { X }` where it is also named-exported). The both-forms rule is load-bearing: two dozen
  surfaces here export a component by name and re-export it as default, and failing those would
  report 26 live rooms as dead on day one. **Falsified against the pre-fix tree** — it names exactly
  `surfaces/Monitor.tsx` and nothing else.
- [x] **C-18b · Both dead rooms DECIDED — issue [#148](https://github.com/Pootytxng/sentinel/issues/148).**
  `DEFAULT_ALLOWED` is empty again, which is the point: an entry there is a promise to come back, not
  a place to park a finding.
  **`src/Onboarding.tsx` + `Onboarding.css` DELETED.** Not a fresh product call — C-05 retired the
  modal in `docs/decisions/2026-08-11-design-navigation-audit.md` §4 and `App.tsx` said so in prose;
  what kept the file alive was two exports that were never about the modal. `ONBOARDED_KEY` and
  `type RigLine` now live beside `SETUP_TOUR_KEY` in `surfaces/setup/SetupTour.tsx`. The four
  source-text guards moved WITH it rather than around it: affordance-census entry + baseline,
  button-legibility's 2-button allowlist row, the capability-policy copy root, the modal-stacking
  z-index comment; the mono census dropped its three `Onboarding.css` selectors.
  **bug→guard:** `capability-exception-policy-guard` walked a copy root that no longer existed and
  passed in silence — coverage lost quietly is worse than coverage never claimed — so it now fails on
  any `COPY_ROOTS`/`COPY_DOCS` path that is missing from disk.
  **`design/vendor/Stepper/Stepper.tsx` settled by POLICY, not an entry.** Vendored code is exempt by
  rule (`VENDOR_PREFIX = "design/vendor/"`), because whether its default export is mounted here says
  nothing about whether the file is right, and pruning part of a vendored module is a judgement about
  the next re-vendor. Two tests keep the rule narrow: the prefix is pinned literally, and the
  exemption must still cover a real unmounted default or it is inert and gets deleted.

---
## ARCHIVED 2026-08-19 — LIVE UPDATER + the first field-QA wave (moved verbatim)

> Moved out of `docs/BACKLOG.md` for the byte budget on 2026-08-19, with a pointer left in its
> place. Every row here was closed — the in-app updater shipped and was proven end-to-end on the
> owner's rig, and the 2026-07-22 tester reviews (J + Matthew) were triaged to completion. Current
> updater/release truth is `docs/RELEASE_STATE.md`; this is the point-in-time record.

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
  "square crosshair is a little weird" is about the reticle's SHAPE and stays OPEN — a taste call,
  which since 2026-08-07 is ours to make and show, not the owner's to adjudicate (CLAUDE.md, "TASTE
  IS MINE TO EXERCISE, HIS TO OVERRULE"). It was never the same defect as the two-cursor bug.
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
  floor `src/theme-contrast.test.ts:100` pins for `--ix-text-3`. Raising that floor is ours to call
  (2026-08-07 taste decree) but it repaints every muted caption in the app — too wide for a T4
  review to absorb, so it stays logged here as its own scoped change, not deferred to the owner.
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
- [x] **J: per-room accents read as INCONSISTENCY** — ✅ RESOLVED per the owner's own 2026-07-23 pick
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

---
## ARCHIVED 2026-08-19 — conformance queue: the SHIPPED rows (moved verbatim)

> Moved out of `docs/BACKLOG.md` for the byte budget on 2026-08-19. The closed rows of the
> 2026-08-18 conformance audit queue (C-05/C-19, C-06/C-08/C-09, C-10, C-11, C-17).
> Verbatim, unedited; the queue's OPEN rows stay on the live ledger.

- [x] **C-05 + C-19 · SHIPPED 2026-08-18** (`d76f753f`). First run lands on the diagnosis: the tour
  no longer auto-opens, it is offered as a card on **all three** Home surfaces, and it has ONE name
  ("Compy tour") instead of "Guided setup"/"Hardware tour". CPU temperature is on the default Live
  face and on Home. Two durable corrections below (C-18, C-19) — **read them before trusting any
  older reachability claim in this file.** Guards: `src/first-run-front-door-guard.test.ts`,
  `src/cpu-temp-reachability-guard.test.ts`, both mutation-tested.
- [x] **C-06 + C-08 + C-09 · SHIPPED 2026-08-18.** Plain-English copy pass and the guard that holds
  it (`4c9e440e`); build identifiers out of consumer chrome (`6d047c2a`, `00d7020e`). Both carry a
  self-review PASS. The durable half: `plain-language-guard` scanned 199 `.tsx?` files and NONE of
  the 18 locale files holding the copy it exists to police — **when a decision silently reverts,
  check the guard's FILE FILTER before its rules.** Full record: `docs/RELEASE_STATE.md` installed row.

- [x] **C-10 · SHIPPED** (`3eca4a9f`). Seven raw `<select>`s, four of them measured live on one Lab
  screen. Replaced by `src/design/Picker.tsx` — one portalled, token-drawn dropdown on the ARIA APG
  select-only-combobox pattern (focus stays on the trigger, so nothing can drop focus to `<body>`),
  with keyboard + typeahead parity (one deliberate divergence, named in the file: a closed native
  `<select>` commits on an arrow key, this one opens instead). `no-raw-select-guard.test.ts` bans
  `<select>` under `src/` with no escape hatch; mutation-tested. **Two defects an independent review
  caught after the first push, both fixed in the same PR** (#139): the guard could not see a
  `<select` that ENDED a line — Prettier's own output for a wrapped opening tag — because the scan
  splits on newlines and the lookahead had no character left, and its mutation test proved a code
  path the real sweep never ran (one scanner now serves both); and the port had turned the blank
  `<option value="">` into a `placeholder`, which renders but cannot be chosen, silently removing the
  only way to CLEAR a pick in the Experiment Bench. Every existing test picked forward, so nothing
  noticed — the regression test goes backwards.
- [x] **C-11 · SHIPPED** (`3eca4a9f`). The owner's ledger holds 64 applies, **37 of them the same
  tweak** — the 30-row tape was one sentence printed over and over. `buildLogbook` folds by `rec_id`
  into a row that sits at the latest apply and states "applied N times since <date>", and carries
  the genuinely LIVE apply's id (a stale id from a superseded apply is the dangerous kind of wrong).
  Live: 30 rows → 17.
- [x] **C-17 · SHIPPED** (`3eca4a9f`). `mono-law-guard.test.ts` + `mono-census.baseline.json`:
  resolves the mono **alias graph** as a fixed point (a two-token grep is dodged by the third alias),
  then requires every one of the 224 mono rules to be declared `value` / `chrome-tag` / `violation`.
  A **census with a ratchet, not a ban** — 61 of those rules pair mono with uppercase and are the
  Instrument-HUD micro-label idiom the owner approved over two rounds; banning them would delete the
  design language to enforce a comment. New mono rule ⇒ build fails until classified.

---
## ARCHIVED 2026-08-19 — Cycle 2026-08-19c (moved verbatim)

> Moved out of `docs/BACKLOG.md` for the byte budget when Cycle 2026-08-19d was written
> the same day. Verbatim, unedited.

### Cycle 2026-08-19c — ✅ THE LAST IDLE FRAME LOOP (CC): issue #142 filed and fixed

`ReticleCursor` started a rAF loop on `pointerenter` and only stopped it on `pointerleave`, so a
pointer merely RESTING inside the window held the loop open for the whole visit. Measured on the
shipped v0.9.26 binary (`q7-probe` port + rAF-call counter in the live page): pointer outside
**0 calls/s**, pointer motionless inside **250 calls/s** (750 frames per 3s). After #127 that was
the app's only remaining idle frame loop. The lerp converges asymptotically and never arrives, so
there was no self-terminating condition; it now parks at sub-pixel distance and wakes on real input.

- [x] **#142 — park the reticle frame loop when nothing is moving.** Guard
  `src/design/console/reticle-idle-guard.test.tsx` drives the component's real effect through a fake
  frame scheduler (parks · wakes · still repaints the corner-spread · still cancels on leave),
  falsified against the pre-fix source. Pixel output unchanged, so no visual review was owed.

---
## ARCHIVED 2026-08-19 — Cycle 2026-08-19b (moved verbatim)

> Moved out of `docs/BACKLOG.md` for the byte budget the same day it landed — the live
> ledger was 0.5KB from its wall when Cycle 2026-08-19c was written. Verbatim, unedited.

### Cycle 2026-08-19b — ✅ THE FLEET MOVED (CC): **v0.9.26 published**, source `5e64074c`, release id `372920800`

PR [#141](https://github.com/Pootytxng/sentinel/pull/141) merged (`85ed8065`), then the owner's
fleet-move GO executed end to end: transaction **9 of 9**, alias attempt 1 in 3.7s, desk and fleet
back on the same bytes after three lanes of deliberate divergence. Testers now get the #127 idle
fix, the canonical data root, the CPU-temp offer and the C-10/C-11/C-17 conformance work.

**Four latent pipeline defects surfaced, each costing a ~13-minute cycle to find, each fixed with a
falsified guard** — same class every time: *the release `.ps1` files are executed by nothing in the
suite.* ① a stale staged receipt bound to an older commit read as FAIL, now PENDING (`5d21961a`).
② `Set-StrictMode -Version Latest` at file scope in a DOT-SOURCED library made the whole pipeline
strict and killed prove on an optional hook property (`b8e31e67`). ③ a powershell-spawning test
needed `it.runIf(windows)` (`0e885823`). ④ two guards timed out only at full parallelism
(`b3e82e9b`).

- [x] **Release preflight — fail in SECONDS, not after a verify + build.** `release.ps1` now resolves
  the version it is about to cut BEFORE the expensive gates and refuses on a leftover local/remote
  tag or a `RELEASE_STATE.md` still naming the previous candidate, each with the exact command that
  clears it. The doc rule stays in one implementation: `verify-release-state.mjs --stage-candidate`.
  Guards: `release-pipeline-guard` (ordering) + `verify-release-state-guard` (detector), both
  disarm-probed.

---
## ARCHIVED 2026-08-19 — Cycle 2026-08-19a (moved verbatim)

> Moved out of `docs/BACKLOG.md` for the byte budget once v0.9.26 carried this fix to the fleet
> (Cycle 2026-08-19b). Verbatim, unedited.

### Cycle 2026-08-19a — ✅ THE SCALE WAS THE TRIGGER, NOT THE RIG (CC): `75880de1` on `perf/idle-127-ambient-raster` — issue [#127](https://github.com/Pootytxng/sentinel/issues/127)

**Whole-app idle on Home: 19.632 → 10.483 percent of one core**, measured against the INSTALLED
binary before and after (`docs/perf/raw/idle-attribution-2026-08-19-{A-rig-on,D-installed-fix}.json`).
**#127's own diagnosis did not reproduce:** the rAF band is 0.201 points and fired ZERO frames, so
the 3D rig was never the cost, and the dependency-bump theory is dead (r3f/drei/three identical in
the lockfile at the baseline commit, at `efde8310`, at HEAD and on disk). The rAF registration
stacks were already sitting in the committed evidence, unread — they name GSAP's ticker and
`ReticleCursor`, never the rig chunk.

The cost was two decorative CSS animations that Cycle 2026-08-06a's guard treats as free because
they animate `transform`. That cycle removed `aurora`'s blur and **left its `scale()`** — the
multiplier went, the trigger stayed, and the layer still cost **13.257 points** (67.5% of idle) on
`body::before`, i.e. in every room. The two `.stl-ring` pulses on every Home cost **4.156**, and
that one is not about scale: 4.156 shipped / 4.001 promoted / 4.721 animating opacity alone —
**running forever was the cost, not the property.** Fix: aurora drifts on pure `translate3d`; both
always-on pings are now bounded. Two new guards, both falsified on purpose; `.stl-ring` joined the
always-on inventory it should always have been in. `q7-probe` gained `--inject-css`, which A/B-ed
each hypothesis against the shipped binary in ~6 min instead of a rebuild.

**Stated scope:** the update-pill LED got the same bounded treatment but was **not separately
measured** (no update available during the runs). Post-fix baselines are noisy, so the total is
quotable and single-run per-animation splits are not. `ReticleCursor` writes a transform every
frame while the pointer rests in the window — a live idle cost, not yet filed.

---
## ARCHIVED 2026-08-19 — Cycle 2026-08-06a (moved verbatim)

> Moved out of `docs/BACKLOG.md` for the byte budget when Cycle 2026-08-19a landed. Verbatim, unedited.

### Cycle 2026-08-06a — ✅ IDLE COST TEARDOWN: HALF A CORE WAS DECORATION NOBODY WAS LOOKING AT (CC): `e12467f5` … `e34db6f7` (14 commits) on `claude/idle-cost-teardown-1f6a80` — PR [#76](https://github.com/Pootytxng/sentinel/pull/76), issue [#75](https://github.com/Pootytxng/sentinel/issues/75), **unmerged** (owner decides the merge)

Q7 left a measured but unattributed number: the app burned **50.165% of one core sitting still**. This
cycle attributed it. `scripts/q7-probe.mjs` gained a subtraction waterfall — disable one animation,
re-measure, name its cost — and the answer was one line of CSS: the title foil sweep in
`src/surfaces/ambient-hud.css` ran `background-clip: text` on an `infinite` loop, repainting the big
room titles every frame in every room, forever, for **29.793% of a core on its own**. The rest was the
Lenis rAF spine ticking with nobody scrolling, two aurora backdrops repainting instead of compositing,
and three 3D scenes rendering at full cadence while parked. Re-measured on the shipped 0.9.13 build:
**50.165% → 23.348% of one core**, a 54% cut, reproduced across two 10-minute bare runs.

Two defects the self-review caught, both in the new scroll-park path, both now guarded rather than
just fixed: the parked spine handed Lenis the entire idle gap on wake (`50e5edda` — scroll snapped),
and a second park overwrote the first one's interval so the accumulated offset was wrong
(`3ad6eb48` — the lane teleported). `src/design/jarvis/lenis-wake-guard.test.tsx` pins all five
wake paths, the monotonic clock across three parks, and overlapping parks counted once each.

- **Look substitution, surfaced not gated** (`OWNER_ACTION_CHECKLIST.md` §D): the foil now sweeps a bounded
  number of times and settles, instead of forever. One-word revert is `both` → `infinite`.
- **DISCLOSED GAP:** `TwoFuturesScene` could not be visually verified — it only mounts with a measured
  before/after pair this desk lacks; its diff is an `aria-hidden` label only.
- 0.9.13 declared and silently reinstalled; desk verified live at `3ad6eb48 · release`.

cargo 922/922 · vitest 308 files / 3994 tests · tsc clean · doc-truth 30/30 0 drift · doc-budget PASS ·
branch-disposition-audit 22/22 · self-reviewer **VERDICT: PASS** (round 3)

---
## ARCHIVED 2026-08-18 — oldest steering-log cycle (moved verbatim)

> Moved out of `docs/BACKLOG.md` under its own retention rule (newest ~12 cycles) to make room for
> the product-conformance queue the 2026-08-18 audit produced. Verbatim, unedited.

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

---
## ARCHIVED 2026-08-06 — two oldest steering-log cycles (moved verbatim)

> Moved out of `docs/BACKLOG.md` under its own retention rule (the board keeps the newest ~12
> cycles; adding the 2026-08-06 idle-cost teardown made 14). Verbatim, unedited — history is not
> retro-edited. Cycles in this batch, newest first: Cycle 2026-07-16e · Cycle 2026-07-16d.
> The live board's 2026-07-16 owner decree points here for 16e.
> Current truth: `docs/RELEASE_STATE.md` (gates) · `docs/BACKLOG.md` (live board).

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


---


## ARCHIVED 2026-08-04 — five oldest steering-log cycles (moved verbatim)

> Moved out of `docs/BACKLOG.md` under its own retention rule (the board keeps the newest ~12
> cycles; adding Cycle 2026-08-04f made 17). Verbatim, unedited — history is not retro-edited.
> Cycles in this batch, newest first: Cycle 2026-07-16c · Cycle 2026-07-16b · Cycle 2026-07-16a · Cycle 2026-07-15d · Cycle 2026-07-15c.
> Current truth: `docs/RELEASE_STATE.md` (gates) · `docs/BACKLOG.md` (live board).

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

## ARCHIVED 2026-08-04 — Q6 doc-truth consolidation: the launch runway (moved verbatim)

> Moved out of `docs/BACKLOG.md` by Q6 (issue #65, `docs/superpowers/specs/2026-07-29-product-quality-stabilization-program.md`)
> — the live board carries CURRENT state only (TOKEN LAW 1). Written 2026-07-06; by 2026-08-04 its
> read-only sweep claims (**"zero open code stubs"**, **"no real UI gaps"**) and its gate citations
> (`actions.rs:1435` / `:1506` / `:1646`) had drifted from the code. Preserved unchanged here rather
> than corrected in place — history is not retro-edited. Current truth: `docs/RELEASE_STATE.md` (gates),
> `docs/OWNER_ACTION_CHECKLIST.md` (RUNG 3 + RUNG 4, still owner-gated), `docs/UI_VISION_BACKLOG.md` (UI).

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

---

## ARCHIVED 2026-07-22 — tier-1 board diet: completed non-cycle sections (moved verbatim, owner-approved)

> BACKLOG.md hit 128 KB (past the usage-audit 120 KB flag) with the cycle log already at its
> 12-cycle cap; these five sections were verified complete/superseded and moved verbatim, board
> order preserved. One-line pointers remain on the board.

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

## Bottom line (2026-06-23)
The 1.0 lane (Phase A) is **substantially but not fully built**. A1 and A6 are done; A2 mostly done; A3 and
A5 have scattered finishable gaps. **The real remaining bulk is A4** — Services advisory inventory, the
entire Peripheral Audit surface, deep Network detection, and the Monitor preset/OSD/hint cards. So: no, the
list has not been fully worked. The next-up, highest-leverage, non-gated work is **A4 + the A5 finishables
(wire `hwchange.rs` to the UI) + A3 entry metadata**.

---

## ARCHIVED 2026-08-04 — steering-log retention: the four oldest cycles (moved verbatim)

> Moved out of `docs/BACKLOG.md` to hold the live board at the newest ~12 cycles (retention rule
> 2026-07-13). Point-in-time records, preserved unchanged — current truth is `docs/RELEASE_STATE.md`.

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

### Cycle 2026-07-12j — ✅ PER-ROOM ACCENT PICKER SHIPPED LIVE `20e2b50` (curated swatches, behind existing `compy_room_identity` flag DEFAULT OFF; installer SHA-256 `457A2D00…F73EBDCE`, stamp-verified) — owner eyeball is the open gate

**Owner follow-up 2026-07-12b** (after eyeballing Cycle 12i's presets, verdict "it looks good … otherwise
everything looks good"): the Settings THEME selector now visibly changes only Home when room-identity is
on (other rooms are locked to presets) — "doesn't make much sense." His fix: **"offer within the tabs
themselves a very neatly placed little dropdown … on the corner of each tab to individually change the
color … for each window … the freedom to shift around the colors they want on each page."** Via
`AskUserQuestion` he picked **"Curated swatches"** (not a free hex field — keeps the dark-ink legibility
law unbreakable). **NOT committed, NOT shipped.**

- **What it is:** when `compy_room_identity` is ON (SAME flag, no new one — the picker only renders when
  the flag is on, so flag-off topbar is byte-identical), each room shows a small accent dot in the
  TOPBAR far-right corner (`.v2-top`, after `.v2-stamp`) reflecting the ACTIVE room's accent; click →
  10-swatch popover to recolor THAT room; persists per-room; "Reset to default" restores the preset.
  Re-skins that room's chrome + rig + sparkline via the same scoped `--v2-accent` mechanism as presets.
- **NEW files:** `src/design/RoomAccentPicker.tsx` (the control) · `src/design/room-accent-picker.css`
  (scoped `[data-v2="on"]`; swatch colors are INLINE so it stays literal-clean) · `src/design/room-accents.test.tsx`
  (21 guards: palette legibility ≥4.5:1 vs ink #1a0a2e, whitelist, store round-trip, managed-style
  scoping+same-element, flag-gating, interaction, + 3 bug→guards).
- **Modified:** `room-identity.ts` (`ROOM_ACCENT_SWATCHES` 10-swatch palette + `PICKABLE_ROOMS` +
  `defaultRoomAccent` + `isSwatchHex`) · `theme.ts` (`readRoomAccents`/`setRoomAccent`/`applyRoomAccents`
  → managed `<style id="compy-room-accents">`, rules scoped `:root[data-room-identity="on"] .v2-room[data-room=X]`
  with same-element `--v2-accent`+dim+line, whitelist-validated) · `main.tsx` (boot `applyRoomAccents`) ·
  `ShellV2.tsx` (renders `<RoomAccentPicker>` in topbar when `useRoomIdentityFlag()`) · `Settings.tsx`
  (row copy points at the corner control) · `surfaces/monitor/SessionStack.tsx` (repaint on
  `compy:room-identity-changed` — self-review fix b) · `design/tokens-v2-guard.test.ts` (registered
  `room-accent-picker.css` in V2_CSS).
- **Verify:** tsc 0 · vitest **1595** (177 files) · **zero `src-tauri`** (`git diff -- src-tauri` empty).
- **Self-review (self-reviewer subagent, live dev build CDP 9222):** round 1 FAIL (2) → fixed: (a)
  reduced-motion selector used a spaced `[data-motion] [data-v2]` combinator (both attrs on `<html>` →
  never matched) → COMPOUND `:root[data-v2="on"][data-motion="reduced"]`; (b) Monitor sparkline didn't
  repaint on an in-place pick → added `compy:room-identity-changed` listener + `accentTick` dep in
  `SessionStack` RowCanvas. Round 2 FAIL (1) → fixed: (c) popover floated over the new room on nav →
  `setOpen(false)` on room change in RoomAccentPicker's room-sync effect. All 3 are bug→guard-pinned.
  Round 2 confirmed items 1,2,4,5,6,7 PASS. **Round 3 = ✅ PASS 7/7** (agent `a1ea4efadff76d2f9`): item-3
  fix confirmed (open popover on Lab → click Home tab → `.v2-accent-pop` absent within 50ms, no floating
  panel/stale label), adjacent behaviors intact (opens on click; pick-after-switch persists + re-skins;
  Blackbook→Rose `#ff8ac4` persisted across nav). **Self-review is DONE — do NOT re-run it.**
- **Dev build was left reset to baseline (flag off) on CDP 9222** (displaces installed `72fa005`). Ship
  restores the installed app.
- ✅ **DONE 2026-07-12:** committed `20e2b50` (10 explicit paths, no `git add -A`), built (compy crate
  recompiled → new stamp embedded), silent-reinstalled via `ship-reinstall.ps1` (installer SHA-256
  `457A2D00…F73EBDCE`, one on the Desktop), **stamp-verified `20e2b50` live** (embedded-hash match).
  Doc-sync landed: RELEASE_STATE new Snapshot block + installer row; this cycle → ✅;
  `OWNER_ACTION_CHECKLIST` A9 updated (the picker is the built answer to his "freedom on each page" ask);
  UI_VISION accent-lock note. **OPEN GATE = owner one-flip eyeball:** Settings → Appearance → "Room accent
  colors (preview)" ON → the accent dot in each room's top-right corner → click to recolor that room.

### Cycle 2026-07-12i — ✅ PER-ROOM IDENTITY ACCENTS SHIPPED LIVE `72fa005` (flag `compy_room_identity` DEFAULT OFF; installer `D23DE073…9EBA9`, stamp-verified) — owner eyeball is the open gate

**Owner directive 2026-07-12** (answering the accent-lock taste call from Cycle 12h): picked **"per-room
identity"** — "i wanted … the components each had their own distinguishable color scheme so they were more
visible … whatever color schematic allows for that should be fine." Explore confirmed the 3D rig ALREADY
color-codes parts per his 2026-07-07 directive; the one uniform-violet surface was the ROOM chrome. So each
room now gets its OWN accent (the same part-identity philosophy extended to rooms). **NOT committed, NOT shipped.**

- **Palette (single source of truth `src/design/room-identity.ts`):** Monitor(play)=teal `#3fd9c2` · Blackbook(learn)=amber `#f0b878` · Lab(lab)/Optimize(fix)=emerald `#27e08a` · Home=violet `#a78bfa` (unchanged, no override).
- **New files:** `src/design/room-identity.ts` (palette + doctrine) · `src/surfaces/room-identity.css` (scoped `:root[data-room-identity="on"] .v2-room[data-room=X]` overrides of `--v2-accent` + `--v2-accent-dim`/`-line`) · `src/surfaces/room-identity.test.ts` (14 guards: scope/flag-off byte-identity · palette match+distinctness · DEFAULT-OFF wiring · derived-wash same-element re-declare · rig room-scope).
- **Modified:** `theme.ts` (`readRoomIdentity`/`applyRoomIdentity`, `=== "1"` DEFAULT OFF, dispatches `compy:room-identity-changed`) · `use-hud.ts` (`useRoomIdentityFlag`) · `main.tsx` (boot attr, only on "1") · `Settings.tsx` ("Room accent colors (preview)" row + fixed stale "one current preview row" comment) · `App.tsx` (css import) · `surfaces/monitor/SessionStack.tsx` (`readInk` reads room scope via row `wrapRef` when flag on → sparkline follows room teal; flag-off = documentElement, byte-identical) · `surfaces/rig/use-rig-colors.ts` (rig BAY accent resolves from active `.v2-room` when flag on + re-resolves on `data-room-identity`/`compy:room-identity-changed` → Lab hologram cage/ring emerald) · `design/tokens-v2.css` (:root dim/line kept as concrete violet literals — see gotcha).
- **⚠️ CSS GOTCHA (cost 2 self-review rounds, worth a memory):** a `var()`-chain inside a custom property substitutes at ITS **declaring element**, NOT the using element (proven live: `:root{--a:red;--b:var(--a)} .child{--a:blue}` → `var(--b)` = red). So `--v2-accent-dim`/`-line` declared at `:root` can't retro-follow a per-room `--v2-accent` override. FIX: re-declare the dim/line washes **same-element** in each room block (room-identity.css) — everything downstream (`--accent-soft/-line/-glow`, `--ix-accent-wash`, the `.play-armed` hairline) then follows.
- **Verify:** tsc 0 · vitest **1575** (176 files) · **zero `src-tauri`** (`git diff -- src-tauri` empty).
- **Self-review (self-reviewer subagent, live dev build port 9222):** round 1 FAIL (2 findings) → round 2: rig/finding-B **FIXED+verified**, derived-wash/finding-A still broken (my first fix was wrong — see gotcha) → finding-A **re-fixed same-element** → **round 3 = ✅ PASS** (agent `a9b0cfd1f3c27234f`, all 8 rubric items): `.play-armed` border = teal `color(srgb .247 .851 .761/.25)` under flag; per-room `--v2-accent-line` = teal/amber/emerald; flag-OFF restores `rgba(167,139,250,0.25)` violet byte-identical on every room; dark ink `rgb(26,10,46)` legible on all accent fills; rig idle GL probe clean (Home `--ix-accent` correctly unaffected). **Self-review is DONE — do NOT re-run it.** One NON-BLOCKING note: rig orbit-off settle burst measured 8,640 draws vs ~6k historical ref — reviewer classified benign (one-time settle → flat 0-growth, not a perpetual-invalidation loop); glance only if GPU idle-budget is being tracked.
- ~~Dev build still live on CDP 9222 (displaces the installed `617db5b` app).~~ → **Ship restored the installed app**: dev build + vite/cargo on 1420/9222 stopped (single-instance race law) before the release build, then silent-reinstalled to `72fa005`.
- ✅ **SHIPPED 2026-07-12** (self-review was already PASSED, NOT re-run): pre-commit verify re-run green (tsc 0 · vitest 1575/176) → committed `72fa005` (`feat(room-identity): per-room accent colors behind compy_room_identity DEFAULT OFF`, 11 explicit paths staged, NO `git add -A` — collision guard) → `npm run tauri build` (exit 0, cargo recompiled) → `scripts/ship-reinstall.ps1` (stale-gate passed, Desktop hygiene, silent `/S` install, launch) → installer `Compy_0.1.0_x64-setup.exe` SHA-256 `D23DE0732BAB2E510891482F6E501C728E8DC52AD60E5782A31358E74D19EBA9`, **stamp-verified `72fa005`** (installed exe embeds HEAD hash), one installer on the Desktop. **doc-sync same cycle:** `RELEASE_STATE.md` (new UPDATE banner + Git HEAD + Current-installer rows), this BACKLOG cycle → ✅, `UI_VISION_BACKLOG.md` accent-lock notes (§A Monitor + §C Blackbook Phase-4 — the resume's "§D/§E" pointer was imprecise; those are CommandPalette/tooling, so recorded where the taste call actually lives), `OWNER_ACTION_CHECKLIST.md` NEW item A9. Memory saved: [[css-var-declaring-element-substitution]].
- ⛳ **OPEN GATE:** owner one-flip eyeball (Settings → Appearance → "Room accent colors (preview)"), same pattern as Home/Monitor/JARVIS/Blackbook → approve/flip default-ON or iterate. This train is the built answer to the accent-lock taste call surfaced in Cycles 12g/12h — flipping it default-ON also closes that open decision.

### Cycle 2026-07-12h — ✅ CONSOLE HUD PHASE 4 "BLACKBOOK LOGBOOK" COMMITTED `617db5b` + SHIPPED LIVE (flag `compy_blackbook_console` DEFAULT OFF; installer `43234A53…943D5`, stamp-verified) — owner eyeball is the open gate

**Built from `docs/superpowers/plans/2026-07-12-console-hud-phase4-blackbook.md` (direction A "The
Logbook").** Committed `617db5b`, shipped + silent-reinstalled (restoring the installed app the dev
build had displaced), stamp-verified `617db5b` live. Owner eyeball = the one open gate (Settings →
Appearance → "Blackbook console (preview)").

- **New files** (`src/surfaces/blackbook/`): `logbook.ts` (pure `buildLogbook` tape builder +
  `startHereEntries` — honesty spine, 18-test truth-table `logbook.test.ts`) · `BlackbookConsole.tsx`
  + `blackbook-console.css` (the Logbook face: hairline tape of Change/Session/Guide-check records,
  mono timestamps, type tags, body status line, library strip) · `blackbook-console.test.tsx` +
  `blackbook-console-flag.test.tsx` (T4 guards).
- **Modified:** `theme.ts` (`readBlackbookConsole`/`applyBlackbookConsole`, `=== "1"` DEFAULT OFF) ·
  `use-hud.ts` (`useBlackbookConsoleFlag`) · `Settings.tsx` ("Blackbook console (preview)" row) ·
  `BlackbookV2.tsx` (console face behind flag + Logbook|Field-guide SegmentedControl + `onOpenLab`) ·
  `App.tsx` (passes `changes`/`sessions`/`onOpenLab={() => setActiveTab("Lab")}`) ·
  `tokens-v2-guard.test.ts` (registered `blackbook-console.css` in V2_CSS).
- **Verify:** tsc 0 · vitest **1560** (175 files) · **zero `src-tauri`** (`git diff -- src-tauri` empty).
- **Self-review round 1 FAIL → both handled:** (1) **duplication** — the in-room Undo button was a
  SECOND full undo surface, contradicting the owner's 2026-07-10 "Lab is the one undo home" decision.
  FIXED → Logbook is now a pure READ view; an active change routes to the Lab via a single
  `.bc-manage` "roll back in the Lab →" jump (the plan's sanctioned "manage in Optimize jump" v1); the
  Logbook triggers ZERO mutations now. (2) **accent `#a78bfa` under Crimson** — VERIFIED as the
  pre-existing, test-pinned, systemic per-room accent lock (`blackbook-v2.css` `--ix-accent →
  --v2-accent` for `.v2-room[data-room="learn"]`, identical on Monitor/Lab); NOT a defect this train
  introduced, no vendor purple, internally consistent. It IS the same open **Monitor accent-mismatch
  owner-taste call** (Cycle 2026-07-12g) — fold them into ONE owner decision, don't fix in-train.
- **Self-review round 2 = ✅ PASS** (agent `a851ea6bd10a9f2d2`, fresh full pass; both round-1
  findings verified resolved/correctly-classified, no new defects): 0 `.bc-undo` nodes (duplication
  resolved, Lab is the one interactive undo home, click-through to Lab live-confirmed); crimson facts
  independently verified (0 vendor-purple hits · `.bc-*` + `.seg-indicator` all compute the same
  `#a78bfa` = internally consistent · same lock present on Monitor/Lab = pre-existing/systemic);
  title-header h1 == "Blackbook" with the count in `.bc-status` body; contrast `.bc-manage:hover` =
  `#1a0a2e` accent-ink on the fill; reduced-motion still; flag-off round-trip clean. (Env note: this
  session's external MoveWindow didn't resize the WebView2 bounds — reviewer worked around via the
  app's own Maximize to 1920×1032 native, larger-than-target so no distortion risk.)
- ✅ **SHIPPED 2026-07-12:** committed `617db5b` (`feat(blackbook): Console Phase 4 Logbook behind
  compy_blackbook_console DEFAULT OFF`) → `npm run tauri build` (exit 0) → `scripts/ship-reinstall.ps1`
  (stale-gate passed, graceful close, Desktop hygiene, silent `/S` install, launch — **this restored
  the installed app the dev build had displaced**; the dev build + vite server on 1420/9222 were
  stopped first per the single-instance race law) → installer `Compy_0.1.0_x64-setup.exe` SHA-256
  `43234A53ED586A00AFBE163487BCDFBD8AE5D08147C15E1F910CE795C28943D5`, **stamp-verified `617db5b`**
  (installed exe embeds the HEAD hash), one installer on the Desktop. Docs synced same cycle:
  `RELEASE_STATE.md` (new UPDATE banner + Git HEAD + Current installer rows), this BACKLOG cycle → ✅,
  `UI_VISION_BACKLOG.md` §E Phase 4 → SHIPPED-behind-flag, `OWNER_ACTION_CHECKLIST.md` A8 → eyeball gate.
- ⛳ **OPEN GATE:** owner eyeball on the Blackbook Logbook (Settings → Appearance → "Blackbook console
  (preview)"), same one-flip pattern as Home/Monitor/JARVIS → then approve/flip default-ON or iterate.
- ⛳ **SURFACED TO OWNER (this cycle):** BOTH accent-lock taste calls folded into ONE decision — the
  Monitor room-chrome-vs-sparkline mismatch (Cycle 2026-07-12g follow-up) AND the Blackbook `.bc-*`
  chrome lock, both instances of the SAME systemic per-room `--ix-accent → --v2-accent` re-point that
  pins room chrome to `#a78bfa` under non-Violet themes. Not a defect (0 vendor-purple, internally
  consistent, invisible on the default Violet) — a taste fork: room chrome follows the live theme, or
  stays the violet signature? Owner's call, awaiting his answer.

### Cycle 2026-07-12g — ✅ MONITOR v5 CONSOLE FLIPPED DEFAULT-ON + shipped `e195f70` (owner "flip it default on and silent reinstall")

**Owner approved the Monitor v5 console** (the long-open §A5 eyeball — Flight Deck + Session Stack,
RTSS-style zero-anchored frametime, live `915e85b`) after I clarified it lived behind the DEFAULT-OFF
"Monitor console (preview)" toggle he hadn't flipped (his recent "everything looks good" was the
default face + JARVIS, NOT the flag-gated console — the honest catch prevented shipping a face he
hadn't actually seen). Verdict: "flip it default on and silent reinstall." Per
[[ship-approved-work-as-the-build]]: `readMonitorConsole` `=== "1"` → `!== "0"` (default ON, mirrors
Home/JARVIS); Settings row dropped "(preview)" → "Monitor console" (OFF failsafe); stale "DEFAULT OFF"
code comments corrected (`Settings.tsx` + `use-hud.ts`; theme.ts was already right). **bug→guard:**
`monitor-console-flag.test.tsx` re-pinned to DEFAULT-ON polarity (absent === console byte-identical to
"1"; "0" === classic, both editorial states); sibling `monitor-v2.test.tsx` re-pointed the same commit
(its own header note demanded it on any default flip). Zero `src-tauri`. Verify: tsc 0 · vitest
**1522** (172 files) · self-reviewer **PASS 8/8** on the installed build (default-ON Flight Deck in
Basic+Advanced · "0" restores classic 0-reload · Settings/h1 titles · honest "NO SIGNAL" scopes over
the owner's REAL session history · dark accent-ink on fills · 0 vendor-purple Crimson · 0 idle
draws/10s). Ship: installer `3B855DD1…FB003`, silent-reinstalled, **stamp-verified `e195f70` live**,
one installer on the Desktop.
- **Follow-up LOGGED (self-reviewer catch, NOT this diff — pre-existing, now exposed to 100% by the
  default flip):** the Monitor room chrome (buttons/chips/mode-pill) is locked to static violet via
  `monitor-v2.css`'s `[data-room="play"]` accent re-point (test-pinned), while `SessionStack`'s
  `readInk()` reads `--ix-accent` directly so its sparkline DOES follow the live theme → an internal
  accent mismatch under non-Violet themes (invisible on the default Violet; not an
  illegibility/vendor-purple defect). Owner-taste call — room chrome follows theme, or sparkline
  matches the violet lock? Surfaced to owner.
- ✅ §A5 CLOSED. Next open Console-HUD work: **Phase 4 Blackbook "The Logbook"** (Cycle 2026-07-12f —
  plan written, builds in a FRESH session). Phase 5 (Gaming/Settings chrome + app-wide HUD frame) after.

### Cycle 2026-07-12f — ✅ RELEASE_STATE table-drift fixed (`6824ab0`) + ✅ PHASE-4 BLACKBOOK CONSOLE CONCEPT OUT → owner PICKED "A · The Logbook"; build queued (fresh session)

**Resume (`/clear`, live `fcc400b`).** Ground truth re-verified: clean `main`, live exe stamps
`fcc400b` (JARVIS default-ON), one Desktop installer re-hashed to `DFE827D1…FB59` (matches the
banner), no parallel Cowork lane. **Drift caught + fixed (`6824ab0`):** `f15e2c5` added the `fcc400b`
default-ON RELEASE_STATE *banner* but left the *table's* Git-HEAD + Current-installer rows citing the
superseded `1d310e1`/`8EB6185D` DEFAULT-OFF installer; `verify-release-state.mjs` passed 36/36 because
it audits only code `path:line` citations, not installer-SHA prose. Both rows re-pointed.

**Next train = Console-HUD Phase 4 (Blackbook).** Per the locked build order it's the next per-tab
rollout (after Home default-ON, Monitor eyeball-pending); per the owner's per-tab signature process
rule ("spitball … before we do it") the concept comes BEFORE code. An Explore map surfaced a real IA
fork: **Blackbook today is the knowledge LIBRARY** (186 verified entries + "autopsy a guide"), NOT a
records room — the spec's "flight-recorder of applied changes + sessions" data lives in three OTHER
rooms (applied changes → Lab · sessions → Monitor) and there's already a shipped feature literally
named **"Black Box"** (crash forensics) in the Lab (naming collision flagged). So the premise is an
owner-territory decision, not a reskin. **Concept round OUT (mockup-first):** Artifact
<https://claude.ai/code/artifact/b00295a5-97d0-4f33-9703-0ae975951e91> — A "The Logbook" (library +
a unified your-changes/sessions/autopsy tape) · B "Flight Recorder" (scrub-tape IS the room) · C
"Field Records" (reskin the library only). **✅ OWNER PICKED same day: "A · The Logbook"** ("blackbook
looks good" + A); naming default accepted (room stays "Blackbook", timeline = "the logbook", Lab
"Black Box" left alone).
- **Build plan written + entry gate cleared:** `docs/superpowers/plans/2026-07-12-console-hud-phase4-blackbook.md`
  (flag `compy_blackbook_console` DEFAULT OFF · pure `buildLogbook` tape builder over EXISTING data —
  zero new IPC, zero `src-tauri` · rollback reuses the audited `rollback_change` path, mutation-gate
  glance · title-header law · honest-empty · reduced-motion still · naming guard).
- ⛳ **RESUME (next train, FRESH session): build Phase 4 "The Logbook" from that plan.** Then eyeball →
  default-ON (Home/Monitor pattern).

### Cycle 2026-07-12e — ✅ JARVIS MOTION LAYER FLIPPED DEFAULT-ON (owner eyeball "everything looks good", 2026-07-12)

**Owner gave the looks-good verdict on the JARVIS motion layer** (Cycle 2026-07-12c's open gate — he'd
been living with it pre-enabled on the live `1d310e1` build). Per [[ship-approved-work-as-the-build]]
the approved preview flips to the build: `compy_jarvis_motion` **DEFAULT OFF → DEFAULT ON** via the
`!=="0"` failsafe pattern (`readJarvisMotion` in `src/design/theme.ts` + the `main.tsx` pre-paint
boot attr), Settings row dropped "(preview)" → "JARVIS motion" (now the OFF failsafe), stale
DEFAULT-OFF comments in `use-jarvis.ts`/`ShellV2.tsx` corrected. **bug→guard:** the byte-identity
anchor in `jarvis-motion.test.tsx` re-pinned from key-absent to explicit `"0"` (absence now = ON) +
a new positive default-ON assertion (key-absent renders the live layer). Zero `src-tauri`. Verify:
tsc 0 · vitest **1522** (172 files). Built + silent-reinstalled + stamp-verified live; installer
SHA-256 + commit in the RELEASE_STATE Snapshot row. This build also carries the Cycle 2026-07-12d
naming-drift fixes (they ride this installer).
- ~~⏳ OPEN GATE (2026-07-12c): owner eyeball~~ → ✅ CLOSED — approved + flipped default-ON.

### Cycle 2026-07-12d — ✅ NAMING-DRIFT MAINTENANCE SWEEP DONE (owner-triggered, "get on track") — 4 user-facing leaks fixed + guard extended; JARVIS eyeball still the open gate

**Trigger:** while handing off the JARVIS build for eyeball, I told the owner to open the
"**Learn**" room. "Learn" is a RETIRED label — I read the internal `HomeRailId` id `learn` and
typed it as a tab name. Owner (rightly) flagged state-drift and ordered a **full maintenance sweep**.

**GROUND TRUTH (verified this session — `src/design/homeRail.ts`):** the shipped rail (ground,
default-ON) is **Home · Monitor · Blackbook · Lab**. Internal ids `learn`/`play`/`fix`/`check` are
KEPT as persisted nav keys (renaming them orphans stored history) — NOT defects. Label renames the
USER must see: **Play→Monitor · Fix→Tune (Optimize in the merge rail) · Learn→Blackbook · Check→folded
into the Lab's Optimize station.** A DEFECT = a retired label in VISIBLE copy (header/button/tooltip/
aria/prose/notification/empty-state). Existing partial guard: `src/stale-reference-guard.test.ts`
(only the Blackbook DATA json — `<X> tab`), `src/data/jargon-guard.test.ts`.

**Already fixed:** my fresh doc drift — `docs/OWNER_ACTION_CHECKLIST.md` §A7 "Blackbook/Learn" → "Blackbook".

**RESULT (workflow `wf_c688d119-49b` completed in background + completeness-critic grep + manual verify).**
Honest count: **4 confirmed user-facing leaks fixed · 3 rejected false positives · 1 live-doc drift.**
The multi-agent sweep alone would have UNDER-reported (harness dropped one confirmed verdict to a
StructuredOutput format error; it missed one leak entirely) — the completeness grep + transcript
recovery closed both gaps ([[audit-needs-completeness-critic-grep]]).

- **Fixed (4):** `src/data/tweaks.json:468` "Compy's Check" → "The Lab's Optimize station" (Blackbook
  prose; the possessive form slipped the old `<Name> tab`-only guard) · `src/design/Term.tsx:63` "More
  in the library →" → "More in the Blackbook →" (glossary tooltip on 12 surfaces; + `Term.test.tsx`
  pin updated) · `src/surfaces/TuningInstrument.tsx:75` "a Play debrief" → "a Monitor debrief" (Lab
  empty state) · `src/surfaces/blackbook-v2-data.ts:20` "search the library" → "search the Blackbook"
  (Blackbook empty state; my grep caught this — the finders missed it; + `blackbook-v2.test.tsx` pin).
- **Rejected (3, correctly left alone):** TrustMoment.tsx:131/146 + SetupTour.tsx:261 "Trust Ledger"
  — that's the CURRENT live brand, not retired (coexists with the narrower "Applied & history" Lab
  disclosure label). Also confirmed NOT-a-leak: `setup-steps.ts:161` "The Check tab" (classic-rail raw
  tie, remapped to "The Lab scans…" under the ground rail — contextually correct).
- **bug→guard:** `src/stale-reference-guard.test.ts` extended — now also scans `src/surfaces/**` +
  `src/design/**` rendered copy (comments stripped) for `(Play|Learn|Fix)`-as-room, the "library"
  brand, and `Compy's <Retired>`. Red-green proven on all 4 leaks; per-file assertions + a floor on
  files-scanned (no false-green on a broken glob).
- **doc-sync:** `DESIGN.md:111` rail line → "Home · Monitor · Blackbook · Lab" + the id-vs-label note.
  **PRODUCT.md and CLAUDE.md were VERIFIED CLEAN** — the resume note's "they still list …" was an
  unverified assumption; only DESIGN.md actually had the stale rail. CHANGELOG/archive/spec hits are
  dated point-in-time records, left as-is.
- **Memory saved:** [[room-labels-vs-nav-ids]] (rail = Home·Monitor·Blackbook·Lab; never speak an id).
- **Verify:** tsc 0 · vitest **1521** (172 files) green, incl. the extended guard. Self-reviewer
  dispatched on the two `.tsx` copy changes (verdict pending at write time).

**JARVIS eyeball still open** (Cycle 2026-07-12c): installed app is live `1d310e1`, JARVIS flag
PRE-ENABLED for the owner (persisted in localStorage, survives restart), clean launch no debug port.

### Cycle 2026-07-12c — ✅ JARVIS MOTION LAYER BUILT + SHIPPED LIVE `1d310e1` (installer SHA-256 `8EB6185D…812D10`, embedded-hash-verified; NEW flag `compy_jarvis_motion` DEFAULT OFF) — owner eyeball = the open gate

**The UI_VISION_BACKLOG §A.2/A.3/A.5/A.6 train** (rails: de-slop directive `:111-176`; the motion
layer the reskin substituted away). Built as ONE flag-gated layer: **A.5** Lenis spine on `.v2-content`
(`lenis@1.3.25`, active-only dynamic import, nested-scroller auto-yield, rAF stops on hidden) ·
**A.6** room-retune wipe (300ms accent hairline, transform-only, never first-paint/flag-flip, native
animationend self-removal — React 19's synthetic onAnimationEnd doesn't fire in this webview) ·
**A.3** magnetic rail tabs (GSAP quickTo ≤4px; Dock excluded — owns the magnify lift) + Home stage
chrome tilt ≤2.4° off the existing `--hc-px/--hc-py` vars (canvas never tilts) · **A.2** gauge
data-tick (GSAP ring flash on real→real measured change ONLY; hologram shader uniforms deliberately
excluded — demand-frameloop idle-GPU law, deviation disclosed in UI_VISION_BACKLOG §A.2). Guards:
`src/design/jarvis/jarvis-motion.test.tsx` (flag-off byte-identity · reduced-wins incl. mid-session ·
honest-tick ×5 · wipe lifecycle). Verify: tsc 0 · vitest **1364** (172 files) · `git diff -- src-tauri`
EMPTY · self-reviewer **PASS 8/8** (flag-on-at-rest chrome = identity matrix; GL idle 0 draws/16s;
rail circuit ≲50ms, sole 58ms outlier on the flag-OFF baseline). Docs: UI_VISION_BACKLOG §A flipped
🟢-behind-flag, RELEASE_STATE banner+installer rows, OWNER_ACTION_CHECKLIST §A7 eyeball row.
- ⏳ **OPEN GATE: owner eyeball** — Settings → Appearance → "JARVIS motion (preview)" (checklist §A7);
  looks-good ⇒ default-ON flip rides its own commit (the Home-console pattern).

### Cycle 2026-07-12b — ✅ Home title-header fix SHIPPED LIVE `cc1ffce` (the last non-gated `[ ]`); Cowork audit correction committed

**Resume found no open train; the one non-gated `[ ]` was the Cycle 2026-07-11e flagged
title-header violation** — HomeConsole's h1 rendered postureLine's status sentence. Shipped
`cc1ffce`: h1 = eyebrow + "Home" (title only, sub line gone from the header); the posture
verdict + trimmed dek relocate to the new `.hc-verdict` body strip above the stage
(postureLine's real output rendered exactly ONCE — one-mention law; attention state inks warn,
agreeing with the LED; strip joins the mount stagger). Scoped like the rooms' `626b83c` sweep
(live face only; HomeHud/HomeV2 devtools-only failsafes untouched). Guards re-anchored +
extended in `home-console.test.tsx` (title pin · one-mention pin · attention tone pin · no-sub
pin). Verify: tsc 0 · vitest **1351** (171 files) · zero src-tauri · self-reviewer **PASS 8/8**
(live 1500×980, REAL rig data incl. a real attention state; contrast 16.78:1 / 6.51:1;
reduced-motion still; no stage collision). Ship: installer `4F4DB63A…FB45B931`,
silent-reinstalled, **stamp-verified `cc1ffce` live**, one installer on the Desktop.
Also this session: **Cowork's 2026-07-11 audit self-correction committed as-is (`e1cec74`)** —
its uncommitted rewrite disclosing the partly-fabricated round-1 sections + the real re-run;
committed isolated so it can't be swept into an unrelated train.
**Open out of this cycle:**
- [ ] Flagged, pre-existing (self-reviewer finding, NOT this diff): the ShellV2 topbar's static
  per-room tagline (`ROOM_CRUMB`, `src/design/ShellV2.tsx:19` — e.g. "Home · how your PC is
  doing") sits directly above the room header and reads like the standing-descriptive-line
  class the title-header law targets — needs an owner-taste read (topbar chrome vs header
  space) before any sweep; don't silently delete.

### Cycle 2026-07-12a — ✅ dist-site staleness bug→guard + Q3 expert-layer GO filed

**Cowork audit 2026-07-11 relayed two items; both landed.** (1) The gitignored deploy staging tree
`dist-site/` still claimed "174 entries" while the library holds **191** (84 tweaks · 85 terms ·
14 tricks · 8 guides — `loadLibrary()` verified) — root cause: staging was a manual, undocumented
copy. Fix = `scripts/stage-dist-site.mjs` (`npm run stage:site` — regenerates from live data, clean
rm+mirror of site/ minus tooling + functions/; deploy stays owner-gated). bug→guard:
`scripts/dist-site-staleness-guard.test.mjs` (Guard A: every committed site/ page's stated count ==
data count · Guard B: dist-site, when present, is a byte-exact complete mirror — **red proven on
the stale 174 tree, green after staging**). The committed `site/` tree was already correct at 191;
only the staging artifact had drifted. (2) Q3 expert-layer spec **GO** + added ship condition
recorded (spec Status block + the row below).
**Open out of this cycle:**
- [x] ✅ **BUILT 2026-07-12 `5850ac0`: Expert-view scoped train** — `docs/superpowers/specs/2026-07-11-expert-layer-middle-ground.md`.
  One genuine Settings preference (`compy_expert_view`, Behavior row beside Motion, default OFF —
  the skeptic face is byte-identical). ON = refused drawer open with reasoning inline · exact
  target (registry/service/powercfg/Settings-path) inline on safe + needs-your-call rows via the
  display-only `src/data/expert-targets.ts` map (transcribed from actions.rs, literal-pinned by
  `expert-targets.test.ts`) · true `local_percentiles` + 1-decimal session/benchmark numbers ·
  long-tail sections render open. **Ship condition MET + mechanized:** the rollback-boundary
  disclaimer renders beside every inline target (`expert-view.test.tsx` pins disclaimer count ==
  target count). Zero `src-tauri` diff (presentation-only, no mutation-gate). Verify: tsc clean ·
  vitest 1350/1350 (171 files, +28 new guards) · self-review PASS (live 1500×980; honest note:
  expert-ON Optimize is a ~10.6-screen scroll — the accepted cost of un-de-emphasizing, not a
  defect; percentile/debrief precision verified by unit tests, no live session data on the rig).

### Cycle 2026-07-11e — ✅ CONSUMER-PANEL OVERHAUL BUILT + SHIPPED `50b5c03` — Q3 expert-layer proposal = the open owner gate

**The five-persona panel plan ran end to end** (`docs/superpowers/plans/2026-07-11-consumer-panel-overhaul.md`
— owner's Q1–Q4 answers + per-item commit citations recorded in-file; supersedes the marathon
roadmap doc). One commit `50b5c03` (47 files, zero src-tauri): Phase 0 verified (fully-applied IS
reachable with zero user action — live probe), Phase 1 copy honesty + Term glosses (Monitor bucket
DEFERRED until the v5 eyeball settles — inventory in the plan), Phase 2 readiness formula note +
NEW TrustMoment watch-it-work loop (audited IPC only, ledger-empty gate, HKCU whitelist), Phase 3
site rebalance (kicker↔h1, free above the fold, proof-loop hero, start-here trio, per-card "Why:"),
Phase 4 Q2 flag-debt sweep (11 rows out; failsafes now devtools-only — RELEASE_STATE banners
superseded) + Q4 protection-first recovery reframe. Self-review round 1 FAIL (4 real catches) →
fixed + guard-pinned (`term-style-guard.test.ts`) → round 2 **PASS**. Ship: installer
`653FFEA0…9BADC2`, silent-reinstalled, **stamp-verified `50b5c03` live**, one installer on the
Desktop. Verify: tsc 0 · vitest **1322** (167 files) · site-landing 15/15.
**Open gates out of this cycle:**
- [x] ✅ Q3 expert-layer middle ground — **GO (2026-07-12**, source-verified by the Cowork audit;
  verdict + one added ship condition recorded in the spec's Status block). Build row lives in
  Cycle 2026-07-12a.
- [x] ✅ **DONE 2026-07-13 `530ef8b`** (shipped live, installer `703F078B…B99EE40B8`, stamp-verified):
  Monitor-surface jargon glosses (deferred bucket). Sequencing gate cleared — the Monitor v5 console
  flipped DEFAULT-ON (`e195f70`). The one user-facing gap on the default face was the DeckScope hero's
  raw "frametime" label (the sibling Play face + Deep-Monitoring section-help already glossed it);
  fixed via `Oscilloscope.label` `string→ReactNode` + `<Term id="frametime">` on the DeckScope hero.
  Only "frametime" glossed — FPS/latency/spikes/budget are consumer relabels/self-explanatory/have no
  correct term. tsc 0 · vitest 1607 (+2 guards) · self-reviewer PASS 8/8 · zero `src-tauri`. See
  Cycle 2026-07-13a below.
- [ ] ⏳ OWNER eyeball of this train's visible changes (Home/Lab gauge notes + glosses, Settings
  slimmed to one preview row, calm recovery banner, site hero) on the live `50b5c03` build.
- [x] ~~Flagged, pre-existing (NOT this train's diff): Home's h1 renders postureLine's status
  sentence ("N thing(s) need your attention") — reads against the title-header law; separate
  pass.~~ → ✅ **SHIPPED `cc1ffce` 2026-07-12** (Cycle 2026-07-12b).

### Cycle 2026-07-11d — ✅ MONITOR v5 "FLIGHT DECK + SESSION STACK" BUILT + SHIPPED `960734c` (flag OFF) — owner eyeball = the open gate

**The 2026-07-11c resume ran to completion:** v5 built from
`docs/superpowers/plans/2026-07-11-monitor-v5-deck-stack.md`, T1→T5 TDD, one commit each
(`d06a63c` pure data `monitor-stack-profile.ts` 33-test truth-table · `69c8f90` `SessionStack`
small multiples · `255a400` Flight Deck assembly — `DeckScope` scrub/drag-zoom port onto the
frametime Oscilloscope, session-scoped delta row, stack replaces the shelf, **SessionWaterfall +
`waterfall-profile` deleted**, no mode toggle · `0c68553` height/motion polish · `960734c`
recorded-span coverage fix). Self-review on REAL 5-session data (the law the v4 rejection wrote):
round 1 **FAIL** — the 10.5 h Sand session's backend-capped timeline (~2 h recorded) drew as a
sliver (x normalized to `duration_secs`, a shape no fixture exercised); fix = rows draw the
RECORDED span + "first 2h 0m recorded" stated on the row + detail line, pins anchor only inside
coverage, guard-pinned in the profile + stack suites → round 2 **PASS 8/8**. Ship: installer
`A4D3BF98…D147E0`, silent-reinstalled, **stamp-verified `960734c` live**, one installer on the
Desktop. Verify: tsc 0 · vitest 1305 (165 files) · cargo 688. Flag `compy_monitor_console`
**DEFAULT OFF** (flag-off byte-identity re-pinned both `compy_editorial` states).
- **Owner refinement ask same day ("clean up and refine how the actual line on the graph
  looks") → SHIPPED `e900b6a`** (installer `5AE1ED22…C7821236`, stamp-verified live): monotone
  Fritsch–Carlson curves + round joins on stack rows (every real sample kept, dips keep true
  depth — pin-on-minimum verified), round joins on the scope SVG traces; guard-pinned; vitest
  1306 · self-review PASS. RELEASE_STATE row `204d901`.
- **Owner quick-fix ask on the eyeball ("lines need to just be sharpened and sleek no added
  bloom or saturation/thickness") → SHIPPED `f2acb23`** (installer `05399D9D…EA7B7459`,
  stamp-verified live): scope trace glow DELETED (the drop-shadow bloomed theme violet around
  graded ink), all scope strokes `vector-effect: non-scaling-stroke` (the stretched viewBox no
  longer fattens them), trace 1.25px, ink/hue untouched; bug→guard "line discipline" pin in
  `oscilloscope.test.tsx`. tsc 0 · vitest 1307 · self-reviewer PASS 8/8. Same session,
  `a4c95df`: RELEASE_STATE Snapshot table caught up to the live-installer chain (was two
  installers stale; drift script 36/36).
- **Owner round-2 ask on the eyeball ("make the lines not so tightly packed and erratic
  without … taking away from the accuracy … transient spikes … overbearing and chaotic") →
  scope ENVELOPE mode SHIPPED `e02d1ad`** (installer `0AA8E222…F21A55`, stamp-verified live):
  dense ≥120-sample frametime windows draw a faint min–max band (per-bucket TRUE extremes,
  nothing hidden) + a monotone MEDIAN line (shared Fritsch–Carlson extracted to
  `src/design/console/monotone.ts`, SessionStack refactored onto it); spikes/scrub/worst-
  callout stay raw-exact; zoom <120 samples returns the raw polyline; caption states "line =
  typical · band = every frame"; fps scope deliberately raw. Self-review round 1 **FAIL**
  (real catch: the median `<path>` escaped the non-scaling-stroke selector — rendered fat,
  the exact f2acb23 class) → fixed + the line-discipline guard strengthened to selector
  coverage of line/polyline/path → round 2 **PASS** (computed vectorEffect + side-by-side
  stroke-weight proof, live real-density mount). tsc 0 · vitest **1311** · envelope guards
  (truth-table · dense⇒band+path+note · sparse⇒raw · no-prop⇒raw).
- **❌ Envelope REJECTED on sight (owner: "this is atrocious just go do some reasearch on some
  clean and comprehensive looking frametime graphs or just match riva tuners or something") →
  RTSS-style ZERO-ANCHORED scale SHIPPED `915e85b`** (installer `3B3A65C4…B19DAD`,
  stamp-verified live): envelope mode DELETED; research applied (RTSS "graph max" / CapFrameX
  fixed y-range) — the frametime hero draws the RAW per-frame line on a stable 0→`niceCap` ms
  axis (frame-budget landmarks 8.3/16.7/25/33.3/50/100/250) w/ labeled quarter-cap gridlines;
  axis states "0–\<cap\> ms scale · budget X ms". **Root cause named:** window-min/max
  normalization stretched ~3 ms of ordinary jitter to full chart height — THAT was the
  "erratic"; the envelope had treated the symptom. fps/Home traces byte-same ("window"
  default); `monotone.ts` stays (stack rows). Guards: niceCap truth-table · calm-amplitude
  <10% of plot height while spikes tower · raw polyline pinned · labeled gridlines · window
  default pinned. tsc 0 · vitest 1311 · self-reviewer PASS 8/8.
- **⏳ GATE: owner eyeball of v5** — Settings → Appearance → "Monitor console (preview)", both
  modes; the stack half shines with his real 5-session history on screen. Phase 4 (Blackbook
  console) still queues behind this verdict.

### Cycle 2026-07-11c — ❌ MONITOR v4 ROUND-2 VERDICT: "not working out" → CONCEPT ROUND 3 OUT (mockup-first, owner pick pending)

**Owner round-2 eyeball on the `915cb96` rework (verbatim, retained in UI_VISION §A0 item 2):**
*"the monitor tab doesnt seem to be working out like i presumed, unless yo can really just change
it to where it looks more intuitive then maybe just re work the whole thing to something else thats
more likely to be comprehensive."* Read: after two build-rejections on this face (v3 ribbon, v4
waterfall), the depth-stacked-sessions CONCEPT is the problem — stop polishing, re-concept. Per the
mockup-first pattern (resolved the Lab; produced the v4 pick), **concept round 3 shipped as an
interactive Artifact** <https://claude.ai/code/artifact/9ebf6305-e488-422d-b699-0c281b15676c>:
**A "Flight Deck"** (ONE comprehensive face, no modes — live ms-axis scope w/ exact spike pins +
hover scrub, MAX FPS/AVG/LOWEST LATENCY/SPIKES readouts, plain-number "vs last session" delta row,
session shelf) · **B "Session Stack"** (small multiples — every session a flat mini-graph on ONE
shared 1%-low axis, stacked newest-first, worst-dip pin w/ exact clock time per row, delta chip vs
previous, DIFFERENT-GAME labeling) · **C "Debrief Card"** (measured grade + plain-English headline,
two-session side-by-side bars, verdict sentences). All three carry the §A0 binding musts; natural
combine flagged (A's top + B's stack). Same simulated feed across all three, labeled SIMULATED.
OWNER_ACTION_CHECKLIST §A5 updated to the pick.
- ~~⏳ GATE: owner picks A / B / C / combine~~ → **✅ PICKED same day (owner, 2026-07-11):
  "A's top + B's stack"** (mockups verdict: "ooooo ya i like the mockups you sent me").
  ~~**⛳ RESUME (next train, FRESH session): build Monitor v5 "Flight Deck + Session Stack" from
  `docs/superpowers/plans/2026-07-11-monitor-v5-deck-stack.md`**~~ → ✅ **RAN — see Cycle
  2026-07-11d** (built + shipped `960734c`, flag OFF, owner eyeball open).

### Cycle 2026-07-11b — ✅ DEAD-SURFACE HYGIENE TRAIN (`eb5e62a`+`4a9a6ed`+`257ab32`) — the 2026-07-10j logged candidate executed; Monitor v4 eyeball still the open gate

**With every plain `[ ]` gated and Phase 4 entry-gated on the Monitor v4 round-2 eyeball, the next
non-gated item was the logged dead-surface cleanup** (Cycle 2026-07-10j reviewer finding / UI_VISION
§A.4 caveat). Verified then deleted: `CommandCenter`/`HomeV3`/`HardwareSection`/`OverviewTab`
(unreachable under EVERY flag combo — `v2Shell` is unconditional once hw loads; CommandCenter was
imported only by its own test) + their CSS/tests + the dead `.cc-*` blocks in shared CSS
(`eb5e62a`). Cascade catch: the **ambient-backdrop subsystem was a lying control** — Settings'
"Ambient backdrop" seg + "Step aside when I play" toggle had NO live consumer (only the deleted
CommandCenter mounted `AmbientBackdrop`), i.e. two do-nothing Settings rows in the shipped app →
both rows + `AmbientBackdrop` + the theme.ts ambiance/step-aside helpers removed (`4a9a6ed`;
LivePreview keeps a fixed 3-streak theme preview; stale `compy_ambiance`/`compy_stepaside_game`
localStorage keys simply go unread). Residue sweep `257ab32` (WindowChrome/dashboard-skin dead
selectors, `cc-nav-ico`→`nav-ico`; live `cc-chip` namespace untouched). Kept deliberately:
`CompyHero`+`readCommitted` (the parked `compy_committed` future-landing hero) · `HardwareGrid` /
`command-center-data` (live in the Home consoles). Verify: tsc 0 · vitest **1306** (164 files; −14
tests = the orphans' own suites + ambiance/step-aside pins) · zero src-tauri · self-reviewer
**PASS 8/8** (Settings renders clean where both rows were, segs/theme cards functional, preview
recolors Violet→Emerald, Home+Monitor zero-delta spot-check, no stale wording; its WindowChrome
catch fixed in `257ab32`). Not rebuilt — rides the next installer (the owner's live build still
shows the two dead rows until then; the open eyeball on `915cb96` is unaffected).
- **⏳ Unchanged gate: owner eyeball round 2 on Monitor v4** (Settings → Appearance → "Monitor
  console (preview)", Now + Compare). Phase 4 (Blackbook console) still queues behind it.

### Cycle 2026-07-11a — ✅ MONITOR v4 "SESSION WATERFALL" BUILT + SHIPPED, ❌ ROUND-1 REJECTED on real data, REWORKED → round-2 eyeball open (backfilled 2026-07-11, Cowork audit — this cycle was missing from the log; full detail already lived in RELEASE_STATE.md + UI_VISION_BACKLOG.md §A0 item 2)

**Resuming Cycle 2026-07-10k's cleared gate:** Monitor v4 "Session Waterfall" (B Depth Waterfall + A's
drag-segment) built and shipped `85eb8c6` — LIVE mode (frametime scope, drag-zoom, receding
same-capture snapshots) + SESSIONS mode (last ≤5 sessions, delta strip, dip pins), replacing the
deleted v3 ribbon. Self-review round 1 FAIL (4 real catches, fixed) → round 2 **PASS 8/8** — but that
PASS ran on fixture-scale data. **Owner rejected on his real 5-session data: "this looks absolutely
terrible … what a mess"** — real multi-hour timelines drew as smears, dip pins as a barcode, legend
printed over chart ink, Live/Sessions duplicated the room's own segment labels. **Reworked**
(`082414c` + `915cb96`): `downsampleTimeline` caps drawn samples, `MAX_LAYER_PINS=3`, legend moved off
the stage, modes renamed Now/Compare. Two bug→guards landed from this: draw-density pinned in
`waterfall-profile.test.ts`, and the self-reviewer rubric gained a **"real-density law"** (a PASS
earned only on fixture-scale data is not a PASS — `.claude/agents/self-reviewer.md`).
**⏳ Owner eyeball round 2 is the open gate** (now tracked in `OWNER_ACTION_CHECKLIST.md` §A5, which
had also been missing this item until this same audit pass).

### Cycle 2026-07-10k — ❌ MONITOR v3 RIBBON REJECTED on eyeball → CONCEPT ROUND 2 OUT (interactive mockups, owner pick pending)

**Owner eyeballed the ribbon (screenshot): "this looks sloppy and doesnt make sense … create
something sensible thats achieves the same goal and still incorporates some sort of 3D or just
simpyl interactive graph"** (full verbatim + failure diagnosis retained in UI_VISION §A0 item 2:
the extruded mound had no y-axis/scale, perspective warped magnitude — zero readable values, so the
3D broke his own exact-spike-moment requirement). Per the pattern that resolved the Lab
(build-reject ×2 → interactive mockups → pick), **v4 goes mockup-first**: Artifact
<https://claude.ai/code/artifact/a8e6acf7-54f6-47c4-a1db-d4e1880d8249> — **A Precision Scope**
(interactive 2D: real ms axis, hover-scrub exact frames, drag-zoom, clickable spike chips) ·
**B Depth Waterfall** (depth = TIME: front trace flat + readable, history recedes, spike pins
persist) · **C Bar Skyline** (per-frame columns vs a labeled ms wall on a gridded floor,
drag-orbit, spikes print exact ms). Same simulated feed, budget line, exact-moment markers,
consumer readouts across all three.
- ~~⏳ GATE: owner picks A/B/C~~ → **✅ PICKED same day (owner, 2026-07-10): B + A's drag-segment,
  "leaning more into the previous session comparison … really refining that as a working
  implementation … more comprehensive visually and systematically"** (verbatim retained in the v4
  plan). **⛳ RESUME (next train, FRESH session): build Monitor v4 "Session Waterfall" from
  `docs/superpowers/plans/2026-07-10-monitor-v4-session-waterfall.md`** — entry gate CLEARED; same
  flag `compy_monitor_console` DEFAULT OFF; 2D-canvas waterfall, LIVE mode (front = real 240-frame
  `recent_frametimes_ms` scope w/ drag-zoom + spike moments; depth = same-capture snapshots) +
  SESSIONS mode (depth layers = the last ≤5 sessions' real `stutter_timeline`, dip pins from
  `stutter_events`, delta strip, same-game filter, compy-changes-active tag); ribbon component
  DELETED in T4. Zero new IPC, zero src-tauri.
  Phase 4 (Blackbook console) stays queued behind the Monitor verdict chain.

### Cycle 2026-07-10j — ✅ A0 item 6 CLOSED: consumer-terms preset relabel + rig-hint fix (next non-gated item; Monitor-v3 eyeball still the pending gate)

**With all plain `[ ]` items gated and Phase 4 (Blackbook console) entry-gated on the Monitor-v3
eyeball, the next non-gated item was the owner's A0 decomposition item 6** (consumer-market terms —
the v3 train had covered only the readouts; the exact "Visual Fidelity / Smooth / Clarity" trio he
flagged still labeled the tuning presets) **+ the §A.4 tracked hint-copy residual.** Shipped: preset
trio → **"Max Quality" / "More FPS" / "Lower Latency"** (ids stable, labels test-pinned in
`monitor-view.test.ts`). Self-review round 1 **FAIL** (2 real catches): literal "Max FPS"/"Low
Latency" chips rendered on the SAME screen as the v3 measured "MAX FPS"/"LOWEST LATENCY" stat
readouts (a chip must never read as a measured value → goal-register comparatives; readouts keep the
owner's verbatim stat terms) + the Lower-Latency goal line orphaned its Storage Sense checklist item
(now "free up drive headroom, prioritize the game, and cut background drag"). "High Resolution"
deliberately not used — that preset bundles HDR+VRR, nothing touches resolution (honesty rail; owner
may overrule at eyeball). Round 2 **PASS 8/8**. RigViewer hint → "hover or click a part" (§A.4
residual closed at source) — reviewer finding logged: the CHROMED RigViewer has **no reachable
surface under any flag combo** (`OverviewTab`/`HardwareSection` + `CommandCenter`/`HomeV3` are
orphaned; `App.tsx:1474` renders HomeRoom for "Overview" unconditionally) — dead-surface cleanup is
its own hygiene candidate, not silently done. Verify: tsc 0 · vitest **1253** (166 files, +1 label
pin) · zero src-tauri.
- **⏳ Unchanged gate: owner eyeball** on Settings → Appearance → "Monitor console (preview)"
  (ideally mid-capture) — now also shows the relabeled presets. Phase 4 waits on it.

### Cycle 2026-07-10i — ✅ MONITOR v3 "TELEMETRY RIBBON" SHIPPED LIVE `6932fa7` (installer SHA-256 `E9737D6E…32421E`, stamp-verified; reinstall ran AFTER Palworld closed)

**Owner picked the 3D-ribbon concept and said "continue" — built same session** (plan
`docs/superpowers/plans/2026-07-10-monitor-v3-ribbon.md`, entry gate cleared): `66966ea` Oscilloscope
v2 (full-width window — his caught bug — budget line, exact-moment spike markers, pure `spikeIndices`)
· `c266898` consumer-term readouts (MAX FPS / AVG FPS / LOWEST LATENCY / SPIKES, `readoutStats`,
em-dash never 0) · `8fe63d7` `FrametimeRibbon` (lazy r3f, real per-frame extrusion, spike cones,
budget plane, orbit, `frameloop="demand"`; pure `ribbon-profile.ts`) · `215e36d` face assembly
(ribbon hero mounts only when live · overlay toggle + corner picker ported verbatim · uniform stage
tilt, data ink never warped) · `4c051e0` **self-review round-1 FAIL fixed** (content-equal 1 Hz polls
repainted the demand canvas — `ftWin` content-stable ref + reference-identity bug→guard).
Verify: tsc 0 · vitest **1252** (166 files) · `git diff -- src-tauri` EMPTY · self-reviewer round-2
**PASS 8/8** (GL probe: idle flat 15s on content-equal pushes, repaints on real change, orbit
animates; full-width trace x=239/240; overlay toggle exercised live). Spec amendment landed: the
direction spec's Monitor row now carries the owner's 2026-07-10 3D/parallax amendment; UI_VISION
§A0 item 1 closed with the density/backdrop residual logged explicitly.
- **✅ SHIPPED:** the game-exit watcher fired, the stale-build gate correctly refused the `4c051e0`
  artifact against the moved HEAD → rebuilt at `6932fa7` (docs-only delta), silent-reinstalled,
  **stamp-verified `6932fa7` live**, ONE installer on the Desktop. (Note kept for the owner: round-2
  review had to stop his live fps capture for the GL probe — partial debrief in Sessions.)
- **⏳ Then: owner eyeball** on Settings → Appearance → "Monitor console (preview)" (ideally mid-capture
  — the ribbon + spike markers need live frames). Taste gate before default-ON.

### Cycle 2026-07-10h — ✅ PHASE-3 MONITOR CONSOLE BUILT + SHIPPED LIVE `3fbd371` (installer SHA-256 `7E74216C…97295D`, stamp-verified; supersedes `bce72d6`; flag `compy_monitor_console` DEFAULT OFF)

**The 2026-07-10g resume pointer executed end-to-end in one fresh session** (plan
`docs/superpowers/plans/2026-07-10-console-hud-phase3-monitor.md`, 5 tasks TDD; the per-tab
concept-check entry gate cleared by the owner's go on the instrument cluster — live traces +
gauges, NO hologram/parallax): `1527d61` flag plumbing + MonitorV2 Live-face branch (DEFAULT OFF,
absent === "0" byte-identity pinned BOTH `compy_editorial` states; Settings → Appearance "Monitor
console (preview)") · `7bb9508` the `Oscilloscope` kit component (pure render of caller-buffered
REAL samples — no self-driven rAF/interval, cap-windowed, ArcGauge tone contract, token-only ink;
empty buffer ⇒ honest "no signal", never a synthetic line; reduced ⇒ no glow/sweep) · `3f09742`
MonitorConsole — the SAME three 1 Hz read-only polls MonitorBasic/Play live run ported verbatim
(commands, cadence, cancellation, visibility gate — zero new IPC): fps trace = real polled capture
samples, cleared the moment the helper stops (never frozen-as-live); frametime trace = the
backend's real `recent_frametimes_ms` window (the Overlay's stream); ArcGauges GPU temp
(vendor-gated, NVIDIA ungraded per rule 5) / CPU (ungraded by design) / RAM (+ GPU load in
Advanced); capture control = the same audited toggle; V2-8 `onFpsActive` door mirror preserved;
Basic keeps the last-session door; Sessions + TuningPresets untouched · `3fbd371` motion layer —
Phase 2's spotlight (event-driven, no rAF) + `backwards` reveal + stage reticle, deliberately NO
parallax over the traces; reduced ⇒ still page; border-hygiene guard caught + fixed an undefined
`--ix-bg` fallback.
Verify: tsc 0 · full vitest **1236** (164 files, +26 pins) · `git diff -- src-tauri` EMPTY ·
self-reviewer **PASS** 8/8 (native 1500×980: stopped-state honesty, visual stillness at rest — two
shots 12s apart differ only in real sensor numbers, computed accent-ink contrast on the capture
button, flag-off classic round-trip, live Settings toggle no reload, Crimson spot-check — the
violet capture button under Crimson traced to the PRE-EXISTING test-pinned per-room accent
re-point `monitor-v2.css:31`, not this train).
- **✅ OWNER verdict IN (same day):** v2 cluster rated "satisfactory" (classic tiles were "liked");
  he asked for a third option to surpass both + gave binding direction (graphs a MUST with
  exact-moment spike indicators · frametime-trace half-width bug · 3D/parallax un-banned ·
  consumer-market terms · overlay control on the face) — FULL verbatim response retained in
  `docs/UI_VISION_BACKLOG.md` §A0 (`e1abce9`). Concept spitballed per the per-tab law; **owner
  chose "3D ribbon graph"**.
- **⛳ RESUME (next train, FRESH session):** build **Monitor v3 "Telemetry Ribbon"** from
  `docs/superpowers/plans/2026-07-10-monitor-v3-ribbon.md` — same flag `compy_monitor_console`
  DEFAULT OFF · Oscilloscope full-stretch + spike markers · consumer-term readouts · lazy r3f
  `FrametimeRibbon` (demand frameloop, orbit, budget plane) · overlay control ported · direction-
  spec amendment folded in (T5). **Entry gate ALREADY CLEARED** (owner picked the concept
  2026-07-10).
- **📌 Known preview gap (owner reaction decides):** the Advanced console face shows the instrument
  cluster only — overlay controls + deep monitoring stay on the classic face (flag off) for now.
- **📌 Open candidates unchanged:** T6b (batched restore-side elevation) · the gated backlog `[ ]`
  items.

### Cycle 2026-07-10g — ✅ OWNER VERDICT IN ("everything looks good and gaming mode worked") → HOME CONSOLE DEFAULT-ON SHIPPED LIVE `bce72d6` (installer SHA-256 `2DA1340D…E6F3E4`, stamp-verified; supersedes `80c69f1`) + PHASE-3 PLAN WRITTEN

**Both pending gates cleared by one verdict (2026-07-10):** the T6c Resume worked live on his real
orphaned session, and the Home-console eyeball (A4) approved. Shipped per
[[ship-approved-work-as-the-build]]:
- **`compy_home_console` DEFAULT ON** (`readHomeConsole` → `!== "0"`); Settings row drops
  "(preview)" (title/aria "Home console"); **"0" = the classic-Home failsafe**, byte-identical for
  both `compy_editorial` states. Pins re-anchored: `home-console-flag.test.tsx` (new default
  contract: absent === "1" === console root), `home-hud-flag.test.tsx` +
  `hologram-orbit-optin-guard.test.tsx` pin the "0" failsafe for the layers they guard, + NEW
  console-stage orbit pin (T4d contract on the now-default screen). OWNER_ACTION_CHECKLIST **A4 →
  ✅ DONE**. Verify: tsc 0 · vitest **1210** (161 files) · zero src-tauri · self-reviewer **PASS**
  (settings round-trip live both ways no reload, "(preview)" grep-clean, console idle 0 GL
  draws/16s, orbit opt-in holds).
- ~~⛳ RESUME: build Phase 3 (Monitor)~~ → **✅ EXECUTED — see Cycle 2026-07-10h above**
  (`3fbd371` shipped live behind `compy_monitor_console` DEFAULT OFF).
- **📌 Open candidates unchanged:** T6b (batched restore-side elevation) · the gated backlog `[ ]`
  items (owner-curated data / outbound walls).

### Cycle 2026-07-10f — ✅ T6c ONE-CLICK RESUME + MOUNT-AWARE BANNER DEFERRAL SHIPPED LIVE `80c69f1` (installer SHA-256 `B7F0148A…BDCFA0`, stamp-verified; supersedes `72d9b6e`)

**The 2026-07-10c owner directive built as its own train** (no Home-console verdict had landed, all
remaining backlog `[ ]` are gated — this was the next non-gated item): the GLOBAL gaming-recovery
banner leads with one-click **"Resume Gaming Mode"** (primary; the pane's audited
`recover_gaming_session(confirm)` → `start_gaming_session` sequence verbatim — rollback-first, then
an explicit user-clicked restart, never zero-click on launch), "Restore now" secondary, "Review" no
longer clears the recovery (dead-end fixed: the banner persists until the pane's own card takes
over). NEW pure `resumeOptionsFrom`: resume restarts with the interrupted session's OWN tiers
derived from its recorded change labels (backend-pinned constants) — the pane's checkboxes reset to
core-only on remount and silently downgraded a resumed advanced-tier session (pane's `onResume`
fixed too). **The 2026-07-10d carried note is RESOLVED:** deferral is mount-aware
(`GAMING_PANE_(UN)MOUNTED_EVENT` counter in App) — the old tab-name set hid a pending recovery
anywhere on Lab/Optimize outside the gaming door. **Round-1 self-review catch (pre-existing,
app-wide):** bare `.btn-small-on` lost the cascade tie to the later `.btn-small` base rule (accent
ink DEAD on all 7 call sites) + the generic hover painted the primary danger-red →
`.btn-small.btn-small-on` double-class + hover override, bug→guard in
`button-legibility-guard.test.ts`. Guards: resumeOptionsFrom truth-table + anchored-label pins ·
pane mount-announce pin · resume-order + derived-tiers IPC pin · mount-aware defer truth-table.
Verify: tsc 0 · vitest **1208** (161 files, +5 net) · `git diff -- src-tauri` EMPTY (zero new
IPC/mutation primitive) · self-reviewer round-2 **PASS** (computed accent at rest+hover on 3 live
sites; one-prompt-at-a-time proven live).
- **⚠️ NOTE for the owner:** a REAL orphaned Gaming Mode session ("still applied — not yet
  restored") sits on this rig right now — the self-reviewer found it read-only and never touched
  it. Next time he looks at the app, THIS new banner greets him: one click "Resume Gaming Mode" or
  "Restore now". His settings are currently still in the gaming-session state.
- **⏳ Still open from 2026-07-10e:** owner eyeball on the Home console preview (Settings →
  Appearance → "Home console (preview)") — the taste gate before `compy_home_console` default-ON
  and Phase 3 (Monitor oscilloscope).
- **📌 T6b stays a candidate** (batched restore-side elevation — restore still elevates per change).

### Cycle 2026-07-10e — ✅ PHASE-2 HOME CONSOLE COLD-OPEN BUILT + SHIPPED LIVE `72d9b6e` (installer SHA-256 `12B47273…68BAFF`, stamp-verified; flag `compy_home_console` DEFAULT OFF)

**The 2026-07-10d resume pointer executed end-to-end in one fresh session** (plan
`docs/superpowers/plans/2026-07-10-console-hud-phase2-home.md`, 5 tasks TDD, entry gate was open):
`5b79d58` flag plumbing + HomeRoom console branch (byte-identity pinned BOTH `compy_editorial`
states) · `917fa99` the console stage — HomeHud's masthead ported to flag-independent `hc-` classes,
lazy hologram center, 4 honesty-pinned corner gauges (Readiness ratio · Avg FPS · 1% low · GPU temp;
absent ⇒ NOT-YET, NVIDIA neutral per rule 5), edge annotations, `--ix→--v2` kit remap ·
`1ae489c` the room Dock (doors = `railFor(optimizeMerged, labGround)` minus Home — the 4-room ground
rail resolution from the resume pointer; Lab primary; navigates via navHome; activeKey null) + the
#1-limiter context row (quiet tag + "See in Lab" jump; clean renders nothing) · `594c7f0` motion
layer (spotlight · staggered reveal `backwards` fill · stage reticle · annotation parallax; reduced ⇒
still page; vendor-purple pin) · `72d9b6e` **self-reviewer round-1 duplication catch fixed** (the
Dock stacked above RoomShell's ForwardDoor — two go-to-Lab controls; now `doorOpen={!dockRenders}`,
ONE forward affordance, bug→guard both branches).
Verify: tsc 0 · full vitest **1203** (161 files, +21 pins) · cargo **688** · `git diff -- src-tauri`
EMPTY (zero new IPC) · self-reviewer round-2 **PASS** (fresh full pass at `72d9b6e` incl. the canvas
idle probe: 0 GL draws/16s at rest, Orbit re-engages; flag left OFF as it ships).
- **⏳ OWNER eyeball (the taste gate before default-ON and before Phase 3 Monitor):** Settings →
  Appearance → **"Home console (preview)"** ON, open Home, react.
- **⛳ RESUME (after the eyeball):** verdict "ALL GOOD" → flip `compy_home_console` default-ON per
  [[ship-approved-work-as-the-build]]; then Phase 3 (Monitor — gauges + the `Oscilloscope` kit
  component on live telemetry) gets its own plan. "Needs changes" → fold into a fix train first.

### Cycle 2026-07-10d — ✅ PROVING GROUND DEFAULT-ON + standalone Optimize tab DROPPED, SHIPPED LIVE `59249bb` (installer SHA-256 `8D5F8938…75D6B5`, stamp-verified)

**Both decided 2026-07-10 calls shipped in one train** (round-4 "ALL GOOD" cleared the gate):
`compy_lab_ground` **DEFAULT ON** (`readLabGround` → `!== "0"`) + the **standalone Optimize tab
REMOVED** — rail = Home · Monitor · Blackbook · Lab (`railFor(merged, ground)`, order preserved, Lab
stays the last chapter); the Lab's Optimize station is the ONE door. Re-routed under ground: Home
limiter buttons ("See in Lab") · Home forward door (`doorFor` → Lab) · gaming-recovery "Review" →
Lab · navHome/HOME_FOR_TAB fallbacks · Setup & Tour (4-room recap, lesson ties, seatbelt names the
Lab's ledger) · Settings row sheds "(preview)". **Self-reviewer round-1 FAIL fixed pre-ship:** the
decided "undo stays reachable via the Lab panel" had no ledger surface in the station →
OptimizeStation gained the "Applied & history — every change, undoable" disclosure rendering the
classic room's audited `<Fix view="ledger">` (bug→guard pin in `lab-ground.test.tsx`).
stale-reference-guard: "Optimize" re-joins the retired-tab regex. `compy_lab_ground="0"` = full
classic failsafe (rail/tabs/rooms/tour restore live, round-trip live-verified, no reload).
Verify: tsc 0 · vitest **1182** (159 files, +14 pins) · `git diff -- src-tauri` EMPTY (zero new
IPC/mutation primitive) · self-reviewer round-2 **PASS** (native 1500×980; noted caveat: the Home
"See in Lab" button proven by source-read + equivalent-path clicks — rig had 0 open limiters).
- **⛳ RESUME (next train, FRESH session — heavy-context handoff per the usage-economics law):
  Phase-2 Home cold-open** per `docs/superpowers/plans/2026-07-10-console-hud-phase2-home.md`
  (5 tasks, TDD, flag `compy_home_console` **DEFAULT OFF**). Its entry gate is OPEN: the round-2/4
  eyeball approved the direction and the Optimize-tab call is recorded + shipped — the Home dock's
  room list at default-ON is the 4-room ground rail (`railFor(merged, ground)`).
- **📌 Carried note for the T6c global-banner train:** on the Lab tab the global recovery banner
  defers to the embedded Gaming pane (`TABS_EMBEDDING_GAMING_MODE`), but in the console the pane
  only mounts once Optimize station + Power features are opened — a pending recovery is invisible
  while sitting on the Lab (visible on every other tab; pre-existing shape, now live at default-ON).
  Fold the fix into T6c's banner rework.

### Cycle 2026-07-10c — ✅ Console round-3 owner catches SHIPPED `889de10` (dock false-highlight · gauge readout over the ring stroke · drift-aware caption)

**Owner round-3 eyeball caught 2 bugs on the `626b83c` build** ("the optimize box seems to be default
highlighted before actually clicking it" · "the 8/9 safe stack icon is distorted") + asked for a self-run
abnormality sweep, green-lit continuing. Root causes (live CDP rect/computed evidence, systematic-debugging):
(1) `.dock-node-primary` wore the EXACT accent border `.dock-node-active` uses → resting primary now a 35%
color-mix border (accent ink kept); active alone gets full accent border + 14% tinted fill. (2)
`.lab-gauge-center` single-line `align-items: baseline` flex anchored the readout to the TOP of the 76px ring
box — "8/9" painted over the ring stroke (num rect y == box y, proven) → outer box centers, new
`.lab-gauge-txt` inner group owns the baseline. (3) Sweep catch (self-reviewer, the abnormality class the
owner asked for): with a drifted rec the ring caption said "1 left to enable below" while the corner gauge
said "0 ready" — the caption re-framed the drift group's item as a fresh enable → caption now splits
freshPending vs driftedPending ("1 was turned off outside Compy — restore it below." / mixed branch).
bug→guard: `optimize-gauge-dock-guard.test.tsx` (7 tests — structural pin, CSS pins both files, all three
caption branches). Verify: tsc 0 · vitest **1168** (159 files; the one full-suite red was
`export-library.test.mjs` hook-timeout under dev-server contention, green in 21s once dev stopped) ·
`git diff -- src-tauri` EMPTY · self-reviewer **PASS ×2** (native 1500×980: resting primary border
`color(srgb …/0.35)` vs active full accent + tint, active look moves station-to-station; readout center
±1px of ring center; drift caption live-verified against the rig's real drifted Game Mode).
- **✅ SHIPPED 2026-07-10 · installer SHA-256 `945E86B1767362391318E18EBC36EB58AAFA1E909D563DA562DB3B0352E81A5C` ·
  LIVE** — stamp-verified `889de10` in the installed exe, stale-build gate passed, one installer on the Desktop.
- **✅ OWNER VERDICT 2026-07-10 (round 4): "ALL GOOD"** — the Ops Console eyeball gate is CLEARED.
- **⛳ RESUME (next train, FRESH session per the Lab-overhaul law):** (1) flip `compy_lab_ground`
  **default-ON** + **drop the standalone Optimize tab** in the same train (both DECIDED 2026-07-10 —
  the removal ships WITH the flip; classic stays the `"0"` failsafe); (2) then build **Phase 2 Home
  cold-open** (`docs/superpowers/plans/2026-07-10-console-hud-phase2-home.md`, flag
  `compy_home_console` DEFAULT OFF) — its entry gate (the owner's console verdict) is now open.
- **🆕 OWNER DIRECTIVE 2026-07-10 — one-click "Resume Gaming Mode" on the GLOBAL recovery banner
  (T6c candidate):** verbatim: *"the resume gaming mode option just auto enabled the gaming mode
  instead of doing the rollback and needing the user to re enable … unless it does do that."*
  **Code-verified state: it HALF does.** The Gaming pane's recovery card already has one-click
  **Resume Gaming Mode** as primary (`GamingMode.tsx` `onResume` — recover(confirm) → immediate
  `start_gaming_session`; the internal rollback is deliberate so the fresh session snapshots TRUE
  priors — rollback-first). **The GAP:** the app-level global banner (`App.tsx`
  `gaming-recovery-banner` — what the owner actually sees after a reboot on any other tab) offers
  only "Restore now" / "Review", no Resume → his lived flow was restore-then-re-enable-by-hand.
  Build: add the same one-click Resume (primary) to the global banner, reusing the pane's audited
  recover+start flow, resuming with the interrupted session's own tiers; keep "Restore now" as the
  secondary. NEVER zero-click auto-apply on launch (elevation + consent laws). Reuses audited
  commands only (no new mutation primitive) but session-boundary behavior → self-review + the
  gaming-mode test pins; its own train, not folded into the Lab flip.

### Cycle 2026-07-10b — ✅ Title-header law SHIPPED `626b83c` (owner round-2: "header = a title, not a description/notification") — built + guarded + self-review PASS + LIVE

**Owner round-2 feedback (verbatim):** header must be a TITLE; "1 change you applied was turned off outside compy"
(the optimizeVerdict drift headline standing as the Lab h1) relocates somewhere sensible; sweep the class app-wide.
**Built (`626b83c`):** hud-on h1 = room title in all 5 v2 rooms (`LabGround`/`OptimizeV2`/
`MonitorV2`/`BlackbookV2`/`LabV2` — "Lab"/"Optimize"/"Monitor"/"Blackbook"); header `sub` dropped under hud; classic
`compy_editorial="0"` failsafe keeps verdict headers. Relocations: drift guidance + "never re-applies" → Fix drift
intro; undo promise → Fix consent line (`lc-detail-note` trimmed to read-only-room fact, no double-say); Monitor's
last-session answer + "· live estimate" → Play hero (`monitor-v2.css` hide rescoped `:not([data-hud="on"])` — the
self-review CATCH: the old one-mention rule swallowed the relocated line); Blackbook record + autopsy hint restored
via new Learn `keepRecord` prop. Guards: hud-rooms-flag title contract ×4 + hint pin + CSS-source pin ·
lab-ground "Lab" pin · lab-console note pin. Law: self-reviewer rubric 6 upgraded + memory + direction-spec addendum
(Home masthead verdict KEPT — cold-open answer, flagged for owner taste). Verify: tsc 0 · vitest **1161** (158
files) · `git diff -- src-tauri` EMPTY. Self-review round 1: FAIL on the hero-hide only → fixed + bug→guard'd →
**re-review PASS** (hero row live-verified "Smooth · 1m 44s · live estimate" w=1074 h=26, ×1 on screen; classic "0"
hide re-applies; guards 14/14; flags left `compy_lab_ground="1"`, `compy_editorial` default).
- **✅ SHIPPED 2026-07-10 · installer SHA-256 `9D5434ED59F0BBD0078A0C146FE79CCE57657EFE15A771250EE2CD34A9626522` ·
  LIVE** — stamp-verified: `626b83c` embedded in the installed exe (`Select-String` true), ship-reinstall
  stale-build gate passed, exactly one installer on the Desktop.
- **⛳ RESUME:** owner eyeball round 3 — the Lab preview toggle should already be ON (the review left
  `compy_lab_ground="1"`); if the Lab tab doesn't show the Ops Console, re-flip Settings → Appearance →
  "Lab proving ground (preview)". Phase-2 Home plan
  (`docs/superpowers/plans/2026-07-10-console-hud-phase2-home.md`) stays entry-gated on his verdict.

### Cycle 2026-07-10a — ✅ Header-slop law SHIPPED `1a9f44f` (owner round-1 Ops Console feedback; open-on-click CONFIRMED)

**✅ DONE 2026-07-10 · installer SHA-256 `0B16E904…48AE6` · LIVE (stamp-verified `1a9f44f`, one installer on the Desktop).**
Owner's eyeball feedback did two things: (1) **CONFIRMED Optimize open-on-click** ("cleaner") — recorded in the direction
spec's Open section; (2) decreed the **header-slop law**: tab header space = header-format text only (eyebrow / headline /
a sub that qualifies THIS headline's measured fact); small always-on descriptive lines are banned and relocate to their
context element. Shipped: `.v2-measured` strips removed from Optimize/Monitor/Blackbook/LabV2 (facts already in the
bodies) · Lab (Ops Console) header cut to eyebrow + headline · console lede DELETED, its undo/read-only promise relocated
to `.lc-detail-note` inside the Optimize station panel (panel-only, test-pinned) · Home's masthead readout untouched
(formatted instrument data) · dead `*MeasuredLine` helpers deleted · bug→guard: `.v2-measured`-absence pins ×4 +
lede/note pin · **law mechanized as self-reviewer rubric item 6** + memory `header-slop-law-no-micro-descriptive-text`.
Verify: tsc 0 · vitest **1158** · `git diff 63585e9..1a9f44f -- src-tauri` EMPTY · self-reviewer **PASS** (8/8, native
1500×980). ⚠️ The review reset the `compy_lab_ground` preview toggle to OFF — owner re-flips it to keep eyeballing.
- **⛳ RESUME:** owner eyeball round 2 (re-flip the Lab preview) · ~~the ONE open owner call~~ ✅ **DECIDED 2026-07-10:
  the standalone Optimize tab DROPS at default-ON** (removal ships WITH the default-ON flip, after the eyeball; both spec
  calls now resolved in the direction spec's Open section) · **Phase 2 (Home cold-open) PLANNED** —
  `docs/superpowers/plans/2026-07-10-console-hud-phase2-home.md` (`d1e91ce`), entry-gated on the round-2 eyeball; build
  once it approves. Phases 3–4 follow per-tab (each must pass the header-slop exit check).

### Cycle 2026-07-09f — ✅ Lab "Ops Console" Phase 1 COMPLETE + SHIPPED `63585e9` (post whole-branch review; DEFAULT OFF, owner eyeball pending)
**Owner rejected the built bento Instrument Bench (`403be45`) as "generic slop / wide horizontal boxes."** Ran brainstorming
→ 3 interactive HUD mockups (Artifact <https://claude.ai/code/artifact/e2830b73-cfc0-43c6-b263-5b59a1075639>) → owner picked
**A · Ops Console** (spatial game-HUD: real 3D hologram center + corner arc gauges + magnify Dock; reactbits-referenced), center =
the real recognizable hologram. **Direction LOCKED spec: [`docs/superpowers/specs/2026-07-09-compy-console-hud-direction.md`](superpowers/specs/2026-07-09-compy-console-hud-direction.md)**
(app-wide language; Lab merges Optimize toggles + Benchmark, each individually accessible; build order = Lab first then per-tab
rollout; bento un-retired as an option for OTHER surfaces, not the Lab). **Phase-1 plan: [`docs/superpowers/plans/2026-07-09-console-hud-phase1-lab.md`](superpowers/plans/2026-07-09-console-hud-phase1-lab.md)** (6 tasks, TDD, subagent-driven; ledger `.superpowers/sdd/progress.md`).
- **BUILT + committed on `main`, all behind `compy_lab_ground` DEFAULT OFF (live app byte-identical):** T1 ArcGauge `9558cfa` ·
  T2 Sparkline `9e2eb64` · T3 Dock `7b85cf9` · kit-fix (ArcGauge centering, CDP-caught) `6bbb1e7` · **T4 LabConsole** (real
  hologram center + 4 honest corner gauges + station Dock; Optimize primary, opens on click; **bento DELETED**) `b18f498` ·
  **T5 reactivity+reticle** (accent spotlight + staggered reveal `@keyframes v2-lc-rise` + stage-scoped ReticleCursor) `e0f5a62` ·
  **self-review-fix** (RigViewer `chromeless` mode — footer form collided with corner gauges; + spotlight reset) `1b8c102`.
  Kit under `src/design/console/`; room `src/surfaces/LabConsole.{tsx,css}`. Verify at `1b8c102`: **tsc 0 · vitest 1157 ·
  `git diff b23a97e..HEAD -- src-tauri` EMPTY** (mutation boundary untouched, zero IPC).
- **✅ SHIPPED 2026-07-09 · installer SHA-256 `62DF3FF1…604DD` · LIVE** (stamp-verified: installed exe embeds `63585e9`,
  ship-reinstall stale-build gate passed, Desktop holds exactly one installer). Task 6 done: self-review #1 FAILed →
  chromeless fix `1b8c102` → **re-review PASSED all items**. **Final whole-branch review (opus, base `b23a97e`) DONE** — caught
  1 CRITICAL honesty-rail bug + 2 Important items, all fixed in `63585e9`: the Safe-stack corner gauge collapsed "recs not
  loaded / `get_recommendations` failed" into a fabricated "0 · measured" → now honest NOT-YET until recs load (bug→guard: 2
  `lab-console.test.tsx` pins) · ReticleCursor cancels its rAF on pointerleave · RigViewer skips the fan poll in `chromeless`.
  Post-fix self-reviewer **PASS** on the shipped build (NOT-YET contract computed-verified consistent with siblings, no
  vendor-purple leak, no regression). Full verify at `63585e9`: **tsc 0 · vitest 1158 (158 files) ·
  `git diff b23a97e..63585e9 -- src-tauri` EMPTY** (cargo unchanged by construction).
- **⛳ RESUME (fresh session):** (1) **OWNER EYEBALL** — flip **Settings → Appearance → "Lab proving ground (preview)"**, open
  the **Lab** tab, react to the Ops Console. Two owner-gated calls in the spec's Open section: Optimize panel open-on-click vs
  always-visible · drop the standalone Optimize tab at default-ON. (2) **Phases 2–4 (per-tab Console rollout)** each get their
  own plan AFTER the eyeball.

### Cycle 2026-07-09e — ✅ Instrument Bench Phase 1 Tasks 2–5 COMPLETE + SHIPPED `403be45` (DEFAULT OFF, owner eyeball pending)
**✅ DONE 2026-07-09 · installer SHA-256 `2EF72796…B9231` · LIVE (stamp-verified: installed exe embeds `403be45`, prior
`77d0233` absent, ship-reinstall stale-build gate passed, Desktop holds exactly one installer).** Built straight through
Tasks 2–5 of `docs/superpowers/plans/2026-07-09-lab-instrument-bench-p1.md`, flag `compy_lab_ground` **DEFAULT OFF** the
whole time (owner's live look byte-identical). What landed:
- **T2 `LabBench` bento grid (`02a1129`):** `LabGround` renders a new `LabBench` — a bento grid of living station bays —
  in place of `<Lab v2 ground>`'s linear spine. HERO bay = station 1 "Optimize" (enable-all fast path inline, same
  audited `apply_recommendations_batch`, ZERO new IPC); 5 measure bays (Diagnostics/Benchmark/Latency/Tuning/Black Box)
  as compact doors, one detail at a time, no Gallery. `lab-bench.css` scoped under `[data-v2="on"]` (tokens-v2 guard).
  Engineering note: `LabBench` now owns the measure-station on-mount reads (the same probes Lab did); Lab's `ground` mode
  is now dead code (left inert for Phase 1, a reviewer can prune).
- **T3 bolder reactivity (`3cb01eb`):** accent spotlight + tilt/magnetism (measure doors) + hover-lift + sibling-dim +
  staggered mount reveal (`@keyframes v2-bench-rise`, per-bay delay), ALL reduced-motion-gated (static bench when reduced).
- **T4 data-reactive hero gauge (`77d0233`):** new `useCountTo` GSAP hook drives a ring gauge bound to the measured
  applied/total safe stack — honesty rail: `null` source ⇒ renders nothing (no placeholder number ever animates).
- **T5 self-review + ship (`403be45`):** self-reviewer FAILed on 3 real defects → the 2 in-scope fixed CSS-only + 3
  bug→guard source pins → re-review **PASS** (computed evidence): (i) hero 2×2 span shared grid rows with the measure
  bays → inflated them to 804px → hero is now a full-width banner + compact 128px doors; (ii) `animation-fill-mode:both`
  on the reveal permanently blocked the `:hover` lift/dim → `backwards`; (iii) vendor-purple `.particle-container:hover`
  box-shadow leaked under reduced motion → base `box-shadow:none` on `.lab-bench-card` outranks it.
- **Verify:** tsc 0 · full vitest **1151** (154 files, +18 across T2–T5) · cargo **688** + clippy clean · `git diff
  f16d158..403be45 -- src-tauri/` EMPTY (mutation/rollback boundary untouched).
- **⏳ OWNER (eyeball + ONE deferred decision):** flip **Settings → Appearance → "Lab proving ground (preview)"**, open
  **Lab**, react to The Instrument Bench (bento of bays · living hero gauge · reactive motion). **Open decision (owner-gated
  deferral, self-review re-surfaced):** with the preview on, the standalone **Optimize** rail tab still coexists with the
  Lab hero (same enable-all surface in two places) — confirm whether to drop the tab when the flag's on before default-ON.
  Tracked in `docs/OWNER_ACTION_CHECKLIST.md` + `docs/UI_VISION_BACKLOG.md` §C. Phases 2–4 of the plan remain open.

### Cycle 2026-07-09d — ✅ Lab redesign APPROVED ("Instrument Bench") + P1 Task 1 shipped-to-tree; Tasks 2–5 → fresh session
Owner approved the researched direction (see the direction gate below in 09c). This cycle:
- **Research + council + proposal + plan (all committed):** cited direction proposal
  `docs/superpowers/specs/2026-07-09-lab-redesign-direction-proposal.md` (owner Q1–Q5 answered: **"Instrument
  Bench" bento-of-living-bays APPROVED · BOLDER motion bound to real data · DELETE the gallery · cleanup now**)
  + Phase-1 plan `docs/superpowers/plans/2026-07-09-lab-instrument-bench-p1.md` (5 tasks, flag `compy_lab_ground`
  DEFAULT OFF, zero new deps — gsap/motion/three all already installed).
- **Docs cleanup (`cec32c9`):** killed the stale-spec drift that misled the last train — SUPERSEDED banners
  on `2026-07-08-lab-proving-ground.md` (§2/§3/§8 UI dead; catalog/§2a/mutation parts stand) + CLAUDE.md rule-6
  pointer scoped + 4 stale Lab-status copies (OWNER_ACTION_CHECKLIST A3/B5, UI_VISION A.1, RELEASE_STATE
  amendment) corrected + 6 stale gallery screenshots deleted.
- **✅ P1 Task 1 — gallery DELETED (`2de8d17`, shipped-to-tree, NOT installed):** removed TelemetryGallery +
  gallery-pieces + the "gallery" LabStationKey/facts/wiring across Lab.tsx / lab-guided-data / lab-bento-data;
  KEPT `lab/fly-camera.tsx` (shared with HardwareTourScene — plan was wrong to list it for deletion); tests
  updated. **tsc 0 · vitest 1133 (was 1145, −12 gallery tests) · `git diff -- src-tauri` EMPTY.** Flag still
  DEFAULT OFF → owner's live app byte-identical; nothing installed this cycle.
- **⛳ RESUME (fresh session) — build P1 Tasks 2–5 from the plan** (`2026-07-09-lab-instrument-bench-p1.md`):
  (2) new `LabBench` bento grid replaces `<Lab v2 ground>` in `LabGround.tsx` (hero bay = Optimize station 1,
  measure bays around it; model the bento on the existing `LabBento.tsx` + vendored `MagicBento`); (3) bolder
  reactivity (accent spotlight + tilt/magnetism ON — they ship OFF today — + staggered reveal, reduced-motion
  static); (4) one GSAP data-reactive hero gauge bound to a measured number (`null` ⇒ render nothing); (5)
  self-reviewer PASS + `ship` skill + owner eyeball. Keep flag DEFAULT OFF; `git diff -- src-tauri` must stay
  EMPTY. Note: after Task 2, Lab.tsx's `ground` mode becomes dead code (only LabGround used it) — remove or
  leave inert, reviewer's call.

### Cycle 2026-07-09c — ⛔ Owner REJECTED the blended-Lab marathon — REDESIGN via research+council, approval-gate FIRST
**Owner eyeballed `f16d158` and rejected the direction (not a live regression — flag was DEFAULT OFF).** Verbatim
concerns: the **telemetry gallery "makes 0 sense / looks terrible"** — he had **explicitly said NOT to clone the
scroll/drag gallery from his sister's site**, only to *reference the type/level* of its animation + design language;
I **removed the bento layout he liked and reverted to the linear "spine" we'd already binned**; and **none of it reads
JARVIS / Tony-Stark / high-tech** — the animated reactive feel he's described repeatedly is absent.
- **Root cause:** I executed `2026-07-08-lab-proving-ground.md`'s UI direction ("retire bento → one linear spine →
  build the drag gallery") faithfully — but that spec **contradicted his verbal direction.** Doc drift steered the work.
- **The corrected process (owner's ask): NO more building yet.** Research + **council** (`docs/COUNCIL_PROTOCOL.md`) →
  draw up a direction he's confident fits, **with cited references/examples to show him** → **detailed plain-English
  questions for his go/no-go BEFORE any code.** Full brief + his requirements: **`docs/superpowers/specs/2026-07-09-lab-redesign-COURSE-CORRECTION.md`** (SUPERSEDES the 2026-07-08 spec's UI direction; the catalog/§2a/safety parts stand).
- **PARALLEL ask:** full `docs/` + sentinel-directory **maintenance** — organize/refine/optimize the .md files, kill
  contradictions/stale/superseded direction (the thing that misled me). Slice 0 = the course-correction brief above.
- **Shipped `f16d158` stays inert** (flag OFF, app byte-identical) — do NOT reflexively revert; the redesign decides
  what to keep (§2a DARK backend + mutation-safety = fine; §3 gallery + bento→spine collapse = replace).
- **⛳ RESUME (fresh session):** invoke **brainstorming** + council; research the JARVIS/high-tech animated language +
  confirm the bento basis + clarify the **"exebenus"** reference he named (unknown — ask, don't guess); produce a
  referenced proposal + a short question set for his approval. No code until he passes it.

### Cycle 2026-07-09b — ✅ Lab BLENDED-ROOM marathon COMPLETE + SHIPPED `f16d158` (DEFAULT OFF, owner eyeball pending)

**✅ DONE 2026-07-09 · installer SHA-256 `0B4D15A0…6BD9` · LIVE (stamp-verified: installed exe embeds `f16d158`,
ship-reinstall stale-build gate passed, Desktop holds exactly one installer).** The whole marathon built straight
through on ONE numbered spine, flag `compy_lab_ground` **DEFAULT OFF the entire time** (his live look never changed),
no preview pings between phases — per the owner's cadence directive. What landed:

- **§8 blended spine** (`4410bec`): tweak-apply is now station 1 "Optimize", a NATIVE member of the numbered spine
  (same contract/badge/frame as 2–6, no seam); `LabGround` thin, `LabGround.css` deleted; `OptimizeStation.tsx` new.
- **§2b Two Futures measured split** (`47c57f5`): wired as the Benchmark station's "prove it" payoff (item B closed).
- **§2a aggregate-stack A/B** (`6d49f10`, **DARK** `stack_trial_gate()` OFF): apply whole safe stack in one UAC →
  measure cumulative delta → roll all back; reuses the audited batch path (NO new mutation primitive); mutation-gate
  10/10 + rust-tauri-reviewer CONFIRMED-fix (corrupt-ledger read aborts before mutating). Arming = later gated commit.
- **§3 telemetry GALLERY** (`330cd5c`): panoramic drag-shell + fly-to-piece over scoreboard/sessions/ledger/black-box
  (all existing IPC); `buildGalleryPieces` anti-fabrication law; reduced-motion grid; empty-state loops to the bench.
- **§5 armed-feature Power bay** (`0412e0f`): gaming_mode + service-suspend read-first in station 1 (debloat already
  in the fixes surface). All three armed features now provable from the Lab.
- **Finalize self-review** (`f16d158`): FAILed on 2 real defects I introduced → fixed + bug→guard'd (duplicate Lab
  recovery banner; gallery caption legibility — 24-tile cap + radius cap + closer camera). Re-review **PASS**.
- **Verify:** tsc 0 · full vitest **1145** · cargo **688** + clippy clean · `git diff -- src-tauri` empty for §3/§5/§8
  (§2a is the only src-tauri change, dark-gated).
- **⏳ OWNER (2 things):** (1) eyeball — flip **Settings → Appearance → "Lab proving ground (preview)"**, open Lab,
  react. (2) one deferred slice-1 call: the standalone **Optimize** rail tab still coexists with Lab station 1
  (documented deferral from `d0e30f5`) — confirm whether to complete the merge (drop the tab when the flag's on)
  before default-ON. Both tracked in `docs/OWNER_ACTION_CHECKLIST.md` + `docs/UI_VISION_BACKLOG.md` item C.

<details><summary>Original marathon brief (owner reject of the verbatim phase-1 merge, 2026-07-09) — kept for the record</summary>

**Owner 2026-07-09, verbatim:** *"im not satisfied with this whatsoever do not just copy paste over the merge
… recreate a blended and brand new LAB with the migration of the optimize tab features incorporated into the
lab … i dont want you to ping me for preview of the lab until you have fully completed the whole design marathon
that you should refer to from all the relative MD files."* The shipped `d0e30f5` LabGround **stacked
`<Check>`+`<Fix>` above a demoted `<Lab>`** with a paragraph seam = two surfaces bolted together, not a blend.

- **DESIGN LOCKED** (this commit): `docs/superpowers/specs/2026-07-08-lab-proving-ground.md` **§8 — the
  blended-spine architecture.** Core: **ONE numbered spine, the fast path is station #1** ("Optimize — enable
  the safe stack in one tap") in the Lab's own instrument language, with stations 2–6 the existing
  measure→prove instruments; the intake router gets a LEAD row routing to `optimize`; one verdict, one
  numbering, no seam. Station-1 body REUSES the audited `apply_recommendations_batch`/per-row-undo path (never
  forks the mutation boundary) but is RE-PRESENTED as a Lab station (new `OptimizeStation`, Lab skin — must
  read as the same room as stations 2–6, zero Optimize-panel tell). Full wiring/files/guards in §8.1–8.5.
- **CADENCE (owner directive):** flag `compy_lab_ground` stays **DEFAULT OFF the entire marathon** (his live
  look never changes); **NO preview ping until the WHOLE thing is done** (§8 blended spine → §2 prove-utility
  + aggregate A/B + Two Futures per-part → §3 telemetry gallery → §5 armed bays → finalize/ship/eyeball ONCE).
  Multi-session build; hand off with this ledger, never ping mid-way. Memory: [[lab-no-copypaste-full-marathon]].
- **⛳ RESUME — build §8 first (fresh session, full runway):** (1) `lab-guided-data.ts` — add `"optimize"`
  `LabStationKey` (ground-only, prepended via `groundStationKeys`, so the 5-station measure spine stays
  byte-identical off-ground), its `LAB_STATIONS` contract, the `LAB_ROUTER` lead row, the `stationReading`
  branch (+ `safeReady`/`stackApplied` facts, pure). (2) New `src/surfaces/lab/OptimizeStation.tsx` = enable-all
  hero + safe-tweak review list in Lab skin (reuse `onApplyBatch`/`onToggleRec`/`onRollback`; Check's
  startup/bloat/preload/leftovers/nic fold under a "More cleanup" disclosure). (3) `Lab.tsx` accepts the
  fast-path props as OPTIONAL, used only in `ground` to render `stationBody("optimize")`; `STATION_ICON.optimize`.
  (4) `LabGround.tsx` goes thin (RoomShell + `<Lab v2 ground {...fastPathProps}>`); DELETE `.lg-fast`/`.lg-utility`
  + `LabGround.css`. (5) New CSS → register in `tokens-v2-guard.test.ts` `V2_CSS`. Verify: tsc 0 · vitest
  no-regress · flag-off byte-identity · `git diff -- src-tauri` EMPTY · self-reviewer "same-room" check. NO ship.
- **Then §2 → §3 → §5 → finalize** per spec §8.5. Phase 4 (real new catalog tweaks) is a SEPARATE per-tweak
  owner-gated track, NOT part of this UI marathon.
- **The shipped `d0e30f5` build stays live** (flag OFF → byte-identical to the prior look; harmless). Do NOT
  re-ship until the blended Lab is complete.

### Cycle 2026-07-09a — ✅ SHIPPED `d0e30f5` + ship-docs (Lab overhaul PHASE 1 — Optimize merged into the Lab proving ground, DEFAULT OFF)
**Code `d0e30f5` · installer SHA-256 `B932EDA0…FD8F0` · LIVE (stamp-verified 2026-07-09: installed exe embeds
`d0e30f5`, `f13d10a` absent, ship-reinstall stale-build gate passed, Desktop holds exactly one installer).**
Note: the prior session's `d05871c` resume-breadcrumb commit was folded back (`reset --soft` to `d0e30f5`, both
local-only, 0 behind origin) so the exe stamp == HEAD at ship time and the doc rows land as the ship-docs commit
on top — the established `<commit> + ship-docs` pattern. Flag off → app byte-identical, NO live look change until
the owner flips the preview toggle.
- **What landed (`d0e30f5`, frontend-only, `git diff -- src-tauri` EMPTY):** phase 1 of the Lab overhaul
  (★ PRIMARY BLUEPRINT `docs/superpowers/specs/2026-07-08-lab-proving-ground.md`, Directive 2) behind
  **`compy_lab_ground` DEFAULT OFF**. New `src/surfaces/LabGround.tsx`+`.css` = the merged room: FAST PATH
  (`Check`+`Fix view="fixes"` = safe tweaks + the existing "Apply all safe fixes" enable-all, no benchmark,
  reuses `applyBatch`→`apply_recommendations_batch`, ZERO new IPC) + UTILITY (Lab's new additive `ground`
  mode = intake router + numbered station spine, collapses bento/guided/classic into one). App swaps the Lab
  tab `LabV2`→`LabGround` when the flag is on (`App.tsx` ~L1406); Settings preview toggle added
  (`Settings.tsx`). Cohesion fix: `hud-rooms.css` fix-room HUD skin broadened to `:is(.v2-room[data-room="fix"],
  .v2-room[data-room="lab"] :where(.lg-fast))` (specificity-neutral → fix-room byte-unchanged);
  `tokens-v2-guard.test.ts` comma-split made paren-aware.
- **Verified:** tsc 0 · vitest **1128** (152 files, +6 `lab-ground.test.tsx` guards: flag-off byte-identity,
  ground-spine-only, ground-overrides-bento, empty-state) · tokens-v2-guard 52 green · self-reviewer **PASS**
  (fast-path leads, cohesion seam caught + fixed, re-verified with computed 3px/transparent evidence matching
  the Optimize tab; one idiom below; honest fixes-first verdict). Shots `docs/ui-sweep/shots/lab-ground/`.
- **Step 0 (`6d7397b`):** CLAUDE.md rule 6 + PRODUCT_DIRECTION + RECEIPTS re-synced to the opened-catalog
  (measurable-benefit-under-rails) policy.
- **✅ SHIPPED 2026-07-09 (all resume steps done):** (1) `scripts/ship-reinstall.ps1` ran green — stale-build
  gate passed, graceful close, one installer staged, silent `/S` install, launched; (2) stamp-verified live ==
  `d0e30f5` via the embedded `COMPY_GIT_HASH` (installed exe: `d0e30f5` present, `f13d10a` absent); (3) doc rows
  landed this same ship-docs commit — RELEASE_STATE.md Snapshot row (SHA-256 `B932EDA0…FD8F0`, built-from
  `d0e30f5`, Installed by Claude + LIVE, supersedes `f13d10a`), this entry flipped ✅ SHIPPED, `UI_VISION_BACKLOG.md`
  item C marked phase-1-shipped-behind-flag.
- **⏳ OWNER (eyeball + a scoping welfare-check):** flip **Settings → Appearance → "Lab proving ground
  (preview)"**, open the **Lab** tab, react to the merged room. **Scoping call made (slice 1, reversible):**
  merges Optimize's CONTENT into the Lab behind the preview; the Optimize rail TAB removal + full rail
  collapse is DEFERRED to a next slice (wider App/rail surgery), so during preview BOTH the Optimize tab and
  the merged Lab exist. Undo stays reachable (Optimize/History tabs + per-row toggle-off). Confirm this
  direction before default-ON / before removing the Optimize tab. Remaining: phases 2 (prove utility +
  aggregate-stack A/B) · 3 (telemetry gallery) · 4 (catalog-expansion pipeline) · 5 (armed-feature bays).

### Cycle 2026-07-08c — ✅ SHIPPED `f13d10a` + ship-docs (sibling spotlight-tag de-slop sweep — "sweep the rest")
**Code `f13d10a` · installer SHA-256 `E65D649C…9C7EA` · LIVE (stamp-verified 2026-07-08).** The §D sibling
slop the previous cycle logged: the same "#1 BIGGEST LIMITER" alert-badge pattern the owner caught + retired on
Home still shouted on the first-run **FirstCheck** verdict card and the **Setup & Tour** first-check step. Quieted to
match the approved Home `.hud-pill` fix — text → lowercase "#1 biggest limiter" (`FirstCheck.tsx`, both `SetupTour.tsx`
variants); `SetupTour.css .st-spotlight-tag` de-ambered `--ix-amber` → muted `--ix-text-3` at 0.14em (its own
`.st-tweaks-head` micro-label register); the `.st-spotlight` card keeps its subtle tint to carry attention (esp. the
drift variant); FirstCheck's tag left card-coherent green (only the uppercase literal was the shout). **Advisory/onboarding
surfaces — zero src-tauri** (`git diff a5352cb..f13d10a -- src-tauri/` EMPTY; mutation/rollback boundary untouched).
bug→guard `spotlight-tag-quiet-guard.test.ts` (+4 tests) pins no uppercase "BIGGEST LIMITER", lowercase tag present, no
uppercase text-transform, no `--ix-amber` on the tag. Verify: tsc 0 · vitest **1122** (151 files, +1 file) · self-reviewer
**PASS 8/8** (FirstCheck tag green 10.2:1 · SetupTour tag muted `rgb(130,136,150)` 5.0:1 not amber · `textTransform:none`
both · no overflow · both SetupTour variants render). RELEASE_STATE Snapshot row updated the same ship-docs commit;
OWNER_ACTION_CHECKLIST §D closed. ⏳ OWNER: eyeball only if you re-trigger onboarding (first run / tour) — the live LOOK
of the main app is otherwise unchanged.

### Cycle 2026-07-08b — ✅ SHIPPED `a5352cb` + ship-docs (Home priority-queue de-slop + Game Mode double-listing + task-list consolidation)
**Code `a5352cb` · installer SHA-256 `A1D6EA55…BD7C4` · LIVE (stamp-verified 2026-07-08).** Owner caught THREE
defects in one Home priority-queue screenshot: (1) filled UPPERCASE amber ALERT badges ("BIGGEST LIMITER" /
"MEDIUM CONFIDENCE") = the loud AI-slop pattern the de-slop directive retired everywhere else → now quiet mono
tags, no fill/uppercase/warn-color, #1 keeps a faint accent (`home-hud.css`; guard `home-hud-pill-quiet-guard.test.ts`).
(2) Game Mode listed twice contradictorily — "you applied it and it drifted off" (`readiness.rs` drift row) AND
"you haven't applied it" (`priorities.rs` pending-safe aggregate) → `readiness.rs` now exposes drifted rec titles
structurally; `priorities.rs` excludes them from pending-safe (the drift row owns the setting). (3) "1 safe one-click
tweak(s) not applied" = the exact `N setting(s)` grammar the flags-name-it law bans → real singular/plural. **Advisory
surface — mutation/rollback boundary untouched** (`git diff bdc9daa..a5352cb -- actions.rs history.rs` EMPTY). Verify:
cargo **684** + clippy clean · tsc 0 · vitest **1118** (150 files, +4 tests) · self-reviewer **PASS**. **Also this cycle:
task-list consolidation** — owner flagged that lists he'd made were scattered and dropped. A read-only sweep found 6
genuinely-dropped owner lists (OWNER_ACTION_CHECKLIST sign-off phrases never said · GAMING_MODE_QA 8/10 unrun ·
BETA_SMOKE 0/24 · funnel go-live parked since 06-15 · Lab train awaiting his list · 2 substituted asks). Rewrote
[`OWNER_ACTION_CHECKLIST.md`](OWNER_ACTION_CHECKLIST.md) as the ONE consolidated index (every scattered list points
back to it) and **wired it into CLAUDE.md's resume path** (root cause: it was never linked, so no session surfaced it).
⏳ OWNER: eyeball the quieted Home tags; the §A–§D checklist is now your single "what's on me" view. Sibling slop
(FirstCheck/SetupTour `#1 BIGGEST LIMITER` uppercase) logged in §D — say "sweep the rest" to quiet them too.

### Cycle 2026-07-08a — ✅ SHIPPED `bdc9daa` + ship-docs (T6b + restore-confirmation train)
**Code `bdc9daa` · installer SHA-256 `4BB38FC3…A7CD5` · LIVE (stamp-verified 2026-07-08). Train COMPLETE — parallel
lanes: do NOT re-dispatch the re-verify or re-ship; the ~11:00 "legs STILL UNVERIFIED" note is superseded below.**
`src-tauri/src/gaming_orchestrator.rs` (T6b: restore side batches contiguous elevated rollbacks → ONE UAC via the
same sink→`compose_batch_script`→receipts machinery as T6; + rust-tauri-reviewer fixes: post-phase-1 fallback
re-dispatches STAGED items only · `SESSION_OP` try-lock serializes start/stop/recover · bounds-safe
`contiguous_run_end`) · `src/surfaces/gaming-mode.ts` (`restoredSummary` + `GAMING_SESSION_RESOLVED_EVENT` +
`showGlobalRecoveryBanner`/`showGlobalRestoredBanner` pure gates) · `src/surfaces/GamingMode.{tsx,css}` +
`src/App.{tsx,css}` (visible restore-success confirmation on BOTH surfaces — the owner-caught UX gap; sibling-prompt
sync; BOTH global banners defer to the pane on Optimize — the restored banner's missing gate was the self-review
ROUND-2 catch, live-reproduced then helper-extracted + pinned) · guards `GamingMode.test.tsx` (5 pins) +
`gaming-mode.test.ts` (+6) + 6 new cargo tests · `docs/GAMING_MODE_QA.md` #4/#10 notes.
**Review chain fully consumed this time:** round 1 FAIL (items 3+4 + tint) → fixed; round 2 (fresh full rubric,
2026-07-08 ~11:05) FAIL item 3 only — hover item 4 PASSED with computed values (`--fg`/`--border-strong` on both
Done buttons vs danger-red control) and tint confirmed; banner-defer fix + pure helpers → **round 3 PASS 8/8**
(live import of the shipped module for all 7 gate combinations · live-witnessed Optimize view: pane card present,
banner absent · hover re-proven post-refactor). **Verify at `bdc9daa`: cargo 681 + clippy clean · tsc 0 · vitest
1115 (149 files) · rust-tauri-reviewer PASS 0 blockers** (noted-only: receipts TOCTOU pre-existing shared arch ·
no in-script order assertion · qa6 GUID nit). RELEASE_STATE row updated in the same ship-docs commit.
⏳ OWNER: next real session's stop/restore = ONE UAC on the restore side + a visible "Your settings are back"
confirmation naming the changes. Cowork adversarial audit WARRANTED (mutation-boundary diff class).

> Maintained by the HQ/steering session. Anchored to live `main`, not banners. Lanes: read your row,
> stay in your file domain, rebase onto `main` before every push.
>
> **🚌 Live per-lane QUEUES + the cross-lane MESSAGE BUS now live in [`docs/LANE_BUS.md`](LANE_BUS.md).**
> Lanes: run your `/loop` (LANE_BUS §②) and **self-continue** through your queue — never stop to "await
> direction." This STEERING LOG keeps the integrate-verify history; LANE_BUS holds the live work distribution.

### Cycle 2026-07-05d — A5/A6 finishables cleared (Fable autonomous, same session as 05c) — `main` @ `c6c00a4`
The queued non-gated finishables, all six shipped after the HUD pilot checkpoint:
- ✅ `2f698e4` **A6 anchor test** (test-only): export-layer anchor integrity for every RetailLink.
- ✅ `2f5b675` **rig-tag train**: `hw_fingerprint` stamped on every new receipt (one funnel, all
  paths) + driver-insensitive `on_this_rig` · History "This rig only" filter (legacy rows never
  hidden) · "last seen working on" tag/receipt-line/active-card heads-up · fuller before/after
  (TrustSnapshotLine " · set to <after>", locked §6 copy intact). Mutation/rollback boundary
  untouched; rollback still resolves from history.json alone.
- ✅ `d060b07` **supersession chain**: transitive resolver + Learn links the CURRENT end + corpus
  lint pins chain termination.
- ✅ `c6c00a4` **applicability override**: reversible "My hardware supports this" on
  capability-gated recs; same audited apply path; decision on record.
- **Verify GREEN:** cargo 662 + clippy clean · vitest **1013** · tsc 0 · fixture-mount self-review
  at native 1500×980 (`docs/ui-sweep/shots/hud/*fixture*.png`; new `cdp-eval-file.mjs` driver).
- The A5/A6 `[~]` tail is now **zero**; remaining non-gated work is the owner-gated-adjacent
  redesign rollout (waits on the HUD eyeball) — see the top lane.

```
COUNCIL STRIP — A5/A6 finishables train, 2026-07-05
Contrarian: the applicability override is the one risk-bearing item — a user can now surface a capability-gated rec Compy's probe rejected; contained because the apply path, snapshot, and rollback are byte-identical and the pile keeps the decision auditable.
First-Principles: rig identity belonged ON the receipt, not inferred later — stamping at the one funnel makes every future rig feature (filter, tag, per-rig analysis) a pure view over honest data.
Expansionist: per-receipt fingerprints are the substrate for per-rig Receipts aggregation later (Phase C) without a schema migration.
Outsider: the ledger now answers "which PC did this happen on?" — the first multi-rig-aware surface in the app.
Executor: nothing here waits on the owner; the only open asks remain the two preview-toggle eyeballs.
Chairman: the marginal tail is cleared with the boundary untouched — the backlog's non-gated lane is empty, honestly.
```

### Cycle 2026-07-05c — DIRECTION CORRECTION: editorial retired → pure Instrument-HUD Home pilot (Fable autonomous) — `main` @ `b60a2b5`
Owner saw the built editorial and REVERSED it — serif/magazine composition fights a live-telemetry
app. Spec CORRECTED (pure operator-console/Stark HUD, restraint rails, never gamer-RGB); this cycle
executed the correction in one train:
- ✅ `b60a2b5` **editorial retired** (Instrument Serif fonts deleted, `editorial-rooms.css` +
  `HomeEditorial` + 4-room masthead branches removed) + **`HomeHud` pure-HUD pilot** behind the SAME
  preview flag (key `compy_editorial` kept for opt-in continuity; `data-hud`; Settings label now
  "Instrument HUD (preview)", DEFAULT OFF). Console masthead w/ scan LED + segmented readout ·
  bracketed/ruled bay + scanline + event-driven parallax · fps-vs-Hz ring gauge (measured ratio
  only) · graded ink carried over · oscilloscope trace · ranked queue.
- **Checkpoint enforced in code:** HUD is HOME-ONLY — the four rooms ignore the flag
  (`hud-rooms-untouched.test.tsx`); rollout waits for the owner's eyeball.
- **Verify GREEN:** tsc 0 · vitest **1000** (137 files) · `git diff -- src-tauri` empty · self-review
  native 1500×980 (`docs/ui-sweep/shots/hud/`, computed inks CDP-probed) · installer rebuilt +
  silent-reinstalled, **stamp-verified `b60a2b5` live**, one installer on the Desktop.
- **⏳ OWNER:** flip "Instrument HUD (preview)" → react to the HUD Home; on approval the language
  rolls to the other four rooms (+ deep internals de-slop + voice pass). "Guided Lab bench" eyeball
  still pending too (unchanged by the correction).

```
COUNCIL STRIP — HUD correction train, 2026-07-05
Contrarian: two aesthetic pivots in one day — the risk is thrash; the mitigation is that the HUD pilot reuses the proven honest core (same data, same probes) so only the skin moved.
First-Principles: the owner's reversal confirms the diagnosis was right (de-slop) but the prescription was wrong (serif); telemetry wants an instrument voice, not a magazine voice.
Expansionist: the ring-gauge + readout-strip grammar is exactly the share-card shape Receipts will want — the HUD language compounds toward the measurement brand.
Outsider: a first-time user now reads Home as "my PC's cockpit" — the strongest differentiation from optimizer-slop yet; the four un-reskinned rooms are the visible seam until rollout.
Executor: one toggle flip is the whole owner ask; everything else is staged behind it.
Chairman: correction executed same-day with rigor intact; the taste verdict is the owner's again.
```

### Cycle 2026-07-05b — Editorial-Instrument marathon (Fable autonomous, owner away) — `main` @ `1deda2c` **[SUPERSEDED by 2026-07-05c: editorial RETIRED on owner sight; its Lab router rework survives under `compy_lab_guided`]**
The full de-slop redesign train, built solo under the spec's CREATIVE AUTHORITY mandate. ALL of it
behind **`compy_editorial` DEFAULT OFF** (Settings → Appearance "Editorial look (preview)"); flag-off
byte-identity test-pinned per room; zero `src-tauri` diff across the whole train.
- ✅ `1aa85d6` **Home pilot**: Instrument Serif masthead (OFL, bundled, 43KB) · instrument bay (real
  hologram + HUD brackets + whisper scanline + callout leaders + event-driven parallax, no rAF loop) ·
  telemetry ledger · ranked docket. 2 voice defects caught+fixed in self-review.
- ✅ `f3e90c1` **rollout 2-5/5**: shared `editorial-rooms.css` (masthead all rooms, eyebrows, flattened
  seg-control keeping the ink-on-accent invariant, hairline chrome) + **Lab walk-the-bench REMOVED,
  router promoted to "What are you here to do?"** (deslop #1; `compy_lab_guided` still DEFAULT OFF).
- ✅ `1deda2c` setup-door polish. State commits `bbc3845` · `9caa56a` · this one.
- **Verify GREEN at every checkpoint:** tsc 0 · vitest 998→**1006** (19 new guards) · `git diff --
  src-tauri` empty · self-review native 1500×980 shots (`docs/ui-sweep/shots/editorial/`, computed
  inks CDP-probed) · 3 installers built+silent-reinstalled, each **stamp-verified** (`1aa85d6` →
  `f3e90c1` → `1deda2c` live now).
- **⏳ OWNER (the only open gates on this lane):** flip "Editorial look (preview)" and react (taste
  gate for default-ON); eyeball the reworked guided Lab; then the deeper body-copy voice pass rides
  the approved direction.
- **📋 NEXT-SESSION QUEUE (non-gated, session ended at the milestone per the owner's usage-economics
  rule — not a false-done):** the A5/A6 `[~]` finishables, marginal-but-buildable: ledger
  "this rig only" filter toggle · "last seen working on" hardware-tag UI card · fuller before/after
  delta display on ledger rows · applicability override for ineligible recs · supersession chain
  UI · (Rust, test-only) markdown-export anchor test. Plus, AFTER the owner approves the editorial
  direction: deep Check/Fix internals de-slop + body-copy voice pass under the same flag.

```
COUNCIL STRIP — Editorial-Instrument marathon, 2026-07-05
Contrarian: serif-in-a-telemetry-app is the one real bet — if it reads "magazine cosplay" to the owner, the whole language re-anchors on it; flag-off reversibility is the containment.
First-Principles: the slop was shape+type sameness, not color — re-pointing type/geometry/hairlines at the token layer attacked the actual cause instead of adding more decoration.
Expansionist: the masthead/eyebrow/folio grammar is share-card-shaped — the same language can render Receipts exports later (measurement brand compounding).
Outsider: five rooms now read as one printed instrument panel; the remaining tell is the deep Check/Fix card internals, which still speak the old dialect under the new masthead.
Executor: owner flips two Settings toggles, reacts to Home first; if it lands, default-ON + deep-internals pass is the next train.
Chairman: direction executed end-to-end behind its flag with rigor intact — ship verdict now belongs to the owner's eyes.
```

### Cycle 2026-07-05 — Lab linear guided bench (owner-approved spec, CC build train) — `main` @ `2c49ed0`
Spec `docs/superpowers/specs/2026-07-05-lab-linear-guided-bench.md` built in full, 6 commits, behind
**`compy_lab_guided` DEFAULT OFF** (Settings → Appearance preview toggle; flag-off Lab byte-identical, test-pinned):
- ✅ `1b6a9de` flag + byte-identity guard · `0a4cc04` numbered stations (four-line contract, bench order, live line 3
  or honest "No reading yet") · `5e80a41` symptom→station router (map pinned literally) · `815a39a` readings strip
  removed flag-on · `42bbb15` "Walk the bench" read-only step-through (`compy_lab_walk_seen_v1`) · `2c49ed0` polish+shots.
- **Verify GREEN:** tsc 0 · vitest **985/985** (24 new lab-guided guards) · `git diff -- src-tauri` **empty** (zero new
  IPC) · self-review 7 native 1500×980 shots (`docs/ui-sweep/shots/lab-guided/`) · installer rebuilt + silent-reinstalled,
  **stamp-verified `2c49ed0 · release`**.
- **⏳ OWNER:** flip the preview toggle on (Settings → Appearance → "Guided Lab bench"), eyeball; default-ON is his
  taste call (P-series contract).

### Cycle 2026-06-25f — SECOND compy-burst (A5 finishables, owner "+300k") — `main` @ `901e1a5`
Burst (maxItems 2 + A5 focus; triage returned 3 disjoint): **3 shipped · 0 skipped · GREEN.**
- ✅ A4 Monitor: FreeSync↔VRB exclusion **warning** (advisory, not strobe-detection — honest angle) (`49b03f3`).
- ✅ A5: **override/restore-all toggle** (`1675995`) — correctly re-scoped to `dismissed.ts` + `Fix.tsx` this time
  (the new `focus` arg fed the right files; the item the last burst honestly skipped is now built).
- ✅ A4 Services: **use-case profile selector** (Gaming/Streaming/Creation/General, localStorage) (`901e1a5`).
- **Verify — HQ clean re-run GREEN:** cargo **636** · vitest **643 files / 3958 tests** · build clean. The burst's
  verify agent FALSE-REDDED ("globals undefined env-wide") — same leftover-worker contention flake as last burst;
  build agents saw vitest 658/665 green mid-build, and my clean re-run passed. **Hardened the workflow verify phase**
  to kill stray workers + re-run clean before reporting red, so the agent's verdict becomes trustworthy (stops the
  recurring HQ re-verify cost).
- **💰 Cost:** ~650k total / ~470k output for 3 items ≈ **~155k output / ~217k total per item** (in line with the
  ~200k calibration). Two bursts this round delivered **5 features** total.

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

### Conformance C-19 (archived 2026-08-19 from BACKLOG.md, byte budget)

- [x] **C-19 · SHIPPED with C-05** (`d76f753f`). **The filed premise — "three clicks deep" — was
  wrong, and the truth was worse: on default flags the offer had NO path at all** (see the C-18
  correction above; `.mdc-root` and `.play-monitor` were both absent from the shipped build, checked
  live, not inferred from a green suite). Home also *asserted* "no CPU temp — needs a sensor app"
  with no probe behind it, so it printed that while HWiNFO was publishing — an unmeasured claim.
  Now: a CPU TEMP gauge on the default Live face in **both** modes, a graded reading on Home's CPU
  callout, and `CpuTempOffer` in a boxed Home tile that appears only while there is no reading. The
  offer is deliberately NOT on the annotation plane — the owner's 2026-08-06 call is that planes are
  labels, not controls, and `home-console-standard-readout-guard.test.tsx` caught the first cut that
  broke it. `cpu_temp.rs` gained a 900ms/15s hit-miss cache first, so the new caller costs less than
  the old one did.

### Measurement Platform 2.0 — `next_test` structured rec-id (archived 2026-08-19 from BACKLOG.md, byte budget)

- [x] **Measurement Platform 2.0 follow-up — `next_test` structured rec-id (additive).** The deferral's own
  unlock condition is now met: the engine emits a real, OPTIONAL rec-id where a safe mapping provably exists.
  `EventRecord.rec_id` carries the catalog id **copied verbatim off the Trust-Ledger row**, so
  `Hypothesis.next_test_rec_id` / `WhatChangedReport.next_action_rec_id` are **READ, never matched from prose** —
  nothing parses a summary or maps free text onto the catalog. Emitted under three read conditions, all inside
  `compy-config-change` (the only hypothesis with a ledger row behind it): exactly ONE distinct rec in the
  window · it has an apply event · that apply is not `since_rolled_back`. Every other hypothesis, the
  confounded path, and the count-delta-only path emit `None` permanently. Deliberately NOT gated on
  `is_appliable` — LOCKED rule 3 resolves rollback from `history.json` alone, so a rec that has since left the
  apply allowlist is still undoable. **Routing correction (the deferral got the destination wrong):** the
  destination is the **Trust Ledger / Applied Changes**, NOT a pre-loaded `ExperimentBench` pick — the bench
  *applies* (`experiment.rs` `start_experiment` → `history::apply_recommendation`) while this next test
  prescribes a *rollback*, and feeding it a still-active rec hits `already_active` in `simulate`'s precedence
  chain and returns `already-configured` ("nothing left to change or test") — a dead end. Guard:
  `next_test_rec_id_is_read_from_the_ledger_never_matched_from_prose` (6 cases, mutation-verified to fail on a
  relaxed rule). Decision doc `docs/decisions/2026-07-18-prove-a-change-overlap.md` §5.
  No mutation / network / gate change.
  **Ledger half — ✅ LANDED, both halves now closed.** The "Next test" line in the What-changed report carries
  an inline `Roll back "<change>"` button whenever the engine's rec id still resolves to a live applied row.
  **Routing refinement of the line above** (the destination was right, the *location* wasn't): the affordance
  brings the Ledger action TO the report rather than sending the user to the Ledger surface —
  [[flags-name-it-and-fix-it-inline]] forbids a "go to another tab" dead-end and requires the flag to name the
  specific thing it found (hence the change's title in the label, never a bare "Roll back"). Resolution is
  against the **live** `changes` array (`App.tsx` `findActiveChangeForRec`), so the button self-hides the
  instant the rollback lands — which is exactly why the engine's prose still names the Trust Ledger itself and
  was left untouched: the sentence is the route, the button is only the shortcut. Props
  (`activeChangeFor`/`onRollback`/`busy`) are optional together, so every pre-existing mount renders unchanged.
  **Duplication caught by self-review and fixed in the same train:** in the primary flow (apply a fix from the
  debrief → `arm_comparison` for that rec → the next same-game session resolves it) the `ComparisonCard`'s rec
  and the engine's `next_action_rec_id` are the SAME still-active row, so an unguarded shortcut stacked TWO
  differently-worded buttons for ONE action in one card. `SessionDebrief` now wraps the host resolver
  (`rollbackShortcutFor`) and returns `undefined` for the card's own rec — for **every** verdict, not only the
  ones showing "Revert it", because a `Roll back "X"` hanging under an *improved* card that just said "Keep it"
  would contradict it outright. Wrapping the resolver rather than adding a prop leaves `WhatChangedPanel`'s
  contract untouched and gives `SessionInvestigator` the same protection for free.
  Guard: `src/surfaces/what-changed-rollback-guard.test.tsx` — 13 cases: 9 pinning the render condition, the
  handed-over row, the busy face and all six stand-down paths, plus 4 that mount the *composition*
  (`SessionDebrief`, not the isolated panel — which is exactly why the first 9 stayed green while the defect was
  live) covering both suppression paths and both must-still-render paths. Mutation-verified: reverting the memo
  to a bare `activeChangeFor(recId)` fails exactly the 2 suppression cases.
