# Beta Build Order — from the design tour to invites out

> **ADVISORY / REFERENCE ONLY (owner directive, 2026-06-04).** This pass structure is *not* a
> schedule and *not* a gate. The owner sequences final execution; HQ sequences engineering by real
> technical dependencies. All financial items (domains, signing, anything paid) are **deferred** —
> nothing paid is a prerequisite for any build work.

*2026-06-04, Cowork session. Sequences the rename completion (`docs/RENAME_COMPLETION_AUDIT.md`),
the approved first-experience arc (`docs/superpowers/specs/2026-06-04-first-experience-arc-design.md`),
and the already-decided beta route (unsigned · invite-only · direct download · fully local) into
passes with owner lanes. HQ owns all git and all Windows verification; Cowork owns no-compile work
(docs, specs, copy, diff review); Kuya owns purchases, recruiting, and eyes-on sign-offs.*

---

## What the invite beta ACTUALLY blocks on (the ruthless list)

1. **Rename one-shot committed** — Tier 1 user-visible strings (export.rs is the big one),
   Tier 2 identifier decisions, atomic-migration hardening, beta-facing docs renamed
   (BETA_TESTER_README, BETA_INVITE_MESSAGE, PRIVACY/EULA name swap). Tier 3 comments may trail.
2. **Renamed installer rebuilt + focused smoke re-run.** The pre-rename §7b packaging QA was
   performed on the *Sentinel* build — the rename (new identifier, new exe, new data dir)
   invalidates it. Re-run the focused installed-build smoke on `Compy_0.1.0_*` artifacts,
   including the legacy-migration test against the real `%APPDATA%\Sentinel` ledger.
3. **Moments 1+2 built (recommended blocker — owner may waive).** Frontend-only, no gates, no
   mutation surface. Rationale: ~20 testers × one first launch each = the entire reason the beta
   exists. Shipping the old 4-step lecture onboarding spends the scarcest resource (first
   impressions) on the weakest screen. Waiving this saves ~1–2 days and costs the best data.
4. **No domain, no signing for the invite beta** (owner decision, 2026-06-05 — money-last).
   `gg.compy.app` is just a reverse-DNS identifier *string*; Windows never verifies domain
   ownership, and SmartScreen warns regardless of domain (already disarmed in BETA_TESTER_README
   §2). Trusted friends who already know the owner need neither. **The domain trigger is the first
   PUBLIC / stranger exposure of the name** (a Reddit recruit, a public post) — *not* the first
   install. Register `compy.gg` (+ `getcompy.com`) before that moment, not before invites.
5. **Beta feedback channel = Export receipts + chat (decision).** The decided beta terms are
   fully local / no telemetry / no new code — honor them. The Export report IS the telemetry:
   ask testers to share receipts voluntarily. The opt-in diagnostics rail (P4) moves to Wave 2
   with its own gate; do NOT rush network egress code into a local-only beta.

## Explicit NON-blockers (do not let these creep in)

Gaming Mode QA (stays dark) · code signing (beta is unsigned by decision; signing gates PUBLIC) ·
legal finalization beyond the name swap (gates PUBLIC) · NVIDIA hardware verification ·
Moments 3/4/4b (Wave 2 — need comparison arming + noise-floor wiring) · CSP work (already strict
in the working tree) · the frozen `private-beta-001` refs at `16069fa` (untouched, historical).

**Tester data stays local (decision, 2026-06-05).** Third-party personal data — tester handles +
private notes — must never enter git history. `BETA_TESTER_TRACKER.md` ships only as a blank
template; the owner fills a gitignored `BETA_TESTER_TRACKER.local.md` (`*.local.md` is ignored). A
local-first product keeps its own operational data local too.

---

## Instrument reskin — surface-default governance (owner, 2026-06-06)

The Instrument reskin ships each surface behind a `compy_*_v2` localStorage flag (default ON in dev,
OFF in release), so the classic surface stays the shipped default until the new one is at parity.

**RULE — no capability silently lost on a default-flip or retirement:**
- **Classic Optimize cannot retire, and `compy_fix_v2` cannot become the shipped (release) default,
  until Startup management AND the full guided-advisory cards either reach parity inside Fix or are
  deliberately re-homed elsewhere (owner sign-off on the re-home).** Fix v1 intentionally omits both;
  they remain fully reachable in classic Optimize via the flag toggle. Nothing is silently dropped.
- The in-surface general "Look it up" Library launcher is a **deliberate permanent removal** (covered
  by the refuse-pile autopsy links + the home rail's "Learn") — a decision, not a parity gap.

Apply the same principle to every future surface flip: before the release default changes, enumerate
what the classic surface does that the new one doesn't, and either reach parity or record an explicit
owner decision to re-home/drop.

**Classic ThemePicker RETIRED (owner, 2026-06-06) — a decision, not a silent loss.** The Instrument
theme system (Velocity / Nova / Ember via `data-itheme`, applied app-wide at startup + managed in
Settings → Appearance) is now THE theme system. The legacy appearance ThemePicker (Graphite / Frost /
Aurora / Carbon-Ember via `data-theme`) is removed from the header. The old classic palettes are
superseded; classic (flag-off) surfaces now inherit the Instrument accent app-wide. Acceptance owner
spot-checks: Fix-classic/Optimize, Library-classic, and the classic arc must stay legible under
Velocity + Nova + Ember.

**Navigation IA BLESSED (owner, 2026-06-06) — the six-home information architecture.** The rail is:
**Home · Check · Play · Fix · Learn · Lab**, with:
- **Check** absorbs Readiness + Priorities.
- **Play** absorbs Sessions + Monitoring + the overlay control.
- **Lab** absorbs Benchmark + Latency — **Lab is visible to everyone** (not gated).
- **Fix** and **Learn** as built.
- **Export** is a global header action, not a tab. **Settings** is the gear (bottom of the rail).
This unblocks the dashboard-tab consolidation surfaces (Check / Play / Lab). Do NOT build those until
their specs land (Cowork is writing them); this entry only records the decided IA.

**Check / Play / Lab — BUILT (2026-06-06) behind `compy_{check,play,lab}_v2`.** Per the spec
`2026-06-06-check-play-lab.md`. Mechanism: a `railTabs` filter hides each absorbed classic from the
rail when its flag is on, while `visibleTabs` keeps them NAVIGABLE (so the surfaces' links + the
active-tab reset don't bounce). Check shares the scan with FirstCheck (extracted `useScan` +
`ScanStream`). Parity governance (above) still applies — classics stay reachable when flags are off.
- **Play's debrief — SUPERSEDED same day (owner UX verdict, halfway-home §1):** the original
  2026-06-06 decision (rows navigate to the Sessions tab; no inline extraction) was REVERSED by the
  owner's live sweep ("boxes in boxes"). Standing law: **navigation never teleports** — Play rows
  expand the full `SessionDebrief` IN PLACE (extraction greenlit; locked copy moved untouched), Lab
  embeds Benchmark/Latency inline, and the hidden-but-navigable classic-tab hack is retired. Built
  in `6a820be`.

**Halfway Home pass (owner live-sweep course-correction, 2026-06-06)** — spec
`2026-06-06-halfway-home.md`. Supersedes the green-tinted palette + the route-to-classic-tab nav;
everything else stands.
- **Footer re-home (§0) = owner-directed, not a silent loss.** The global footer now carries the
  version only. Re-homed: the nine `compy_*_v2` preview toggles → Settings → New look (their only
  home); "Re-run guided setup" / "Re-run check" → Settings → Setup (Check also has re-run); the
  standing approval line ("Compy never changes anything without your explicit approval.") → the Fix
  header (where approval happens) + it already lives in every apply confirm dialog.
- **`--ix-accent-ink` (§0):** labels on bright accent fills use dark ink (never white); the contrast
  guard now also asserts ink-on-accent ≥ 4.5:1 per theme (its old blind spot).
- **§1 navigation law — "navigation never teleports" — BUILT.** Play session rows expand IN PLACE
  into the full debrief (`SessionDebrief` cluster extracted verbatim → `src/surfaces/SessionDebrief.tsx`,
  locked copy unchanged; types `Recommendation`/`SessionSummary`/`ComparisonResult` added to
  `types.ts`). Lab embeds Benchmark + Latency as inline collapsible sections (those are already
  separate components). The route-to-tab links + the `railTabs` hack are gone; `visibleTabs` now drops
  the absorbed classics when a flag is on (they cease to be destinations). Rail labels always visible
  (gear is the conventional icon-only exception).
- **Play deep-Monitoring deferral (parity decision, halfway-home §1):** Play's live-monitor card +
  overlay card ARE the Monitoring consolidation (FPS/1%/temp/CPU + capture + overlay — the essentials,
  "stays as built" per spec). The deep classic MonitoringTab extras (memory-pressure card, per-core,
  time charts) are NOT embedded in Play v1 — embedding the whole tab would duplicate Play's capture +
  overlay controls. They remain in classic Monitoring (flag off). Deferred to a chart-only panel in a
  follow-up if tester signal wants it — recorded, not a silent drop.

**RELEASE DEFAULT FLIPPED — the redesign ships (owner decision, 2026-06-06).** The `compy_*_v2`
surfaces now DEFAULT ON in release (not just dev): `readDevFlag`/`readOverlayV2` default `true`; a
stored `"0"` (Settings → New look) still falls back to each classic surface. **The two parity gates
are now CLOSED**, which is what unblocked this:
- **Fix parity met:** Startup management + the full guided-advisory cards (where + steps + the
  allowlisted ms-settings "Open it" link) now live IN Fix (`57f2e21`) — classic Optimize is no longer
  the only home for them, so `compy_fix_v2` as the shipped default no longer drops a capability.
- **Play parity met:** the deep Monitoring panels (memory pressure, per-core, charts) embed in Play
  in place (`aaa4f79`) — classic Monitoring's depth is preserved, so `compy_play_v2` shipping default
  drops nothing.
Owner chose "close the gaps first, then ship all." Gaming Mode stays dark; the frozen
`private-beta-001` ref @ `16069fa` is untouched; the build is unsigned (beta-by-decision).

---

## Passes

**Pass 0 — NOT a blocker for the invite beta (owner decision, 2026-06-05; money-last).** Domain +
trademark are deferred to the first PUBLIC / stranger exposure of the name, not the first install.
*When that moment comes* (a public post / stranger recruit): register compy.gg + getcompy.com
(auto-renew on, WHOIS privacy on) and do a 10-minute USPTO TESS look for "Compy" in software
classes. The trusted-friends invite beta proceeds without any of it.
**Landing page PRE-BUILT and parked at `site/` (Cowork, 2026-06-06)** — single static
`index.html`, zero dependencies, deploy-ready on GitHub/Cloudflare Pages free tier (see
`site/README.md` for deploy steps + the `[KUYA: …]` placeholder checklist). Registering the
domain remains the ONLY cost at trigger time; the storefront opens the same afternoon.

**Pass 1 — rename lands (HQ, ~half day).** Work straight from
`docs/RENAME_COMPLETION_AUDIT.md`: Tier 1 strings → Tier 2 decisions (serde alias rename, ETW
session name, localStorage keys, package.json) → atomic staging-rename migration hardening +
migration unit test → Tier 3 comment sweep → beta-facing docs sweep. Commit the one-shot;
`cargo test` + `npm test` + builds green. Cowork: read-only diff review against the audit.
*Constraint: no behavior change beyond identity + migration in this commit.*

**Pass 2 — first-impression pass (HQ 1–2 days; Cowork parallel).** HQ implements Moment 1
(onboarding, 3 steps, hardware-snapshot prop) and Moment 2 (first-check landing) VERBATIM from
the spec — copy deviations need owner sign-off. Cowork drafts in parallel: `COMPY_OVERVIEW.md`
(diagnosis-led rewrite of SENTINEL_OVERVIEW.md, autopsy framing, honest young-codebase posture)
and refreshed BETA_TESTER_README / BETA_INVITE_MESSAGE copy for HQ to land. Frontend tests green;
owner clicks through both moments live.

**Pass 3 — package + prove (HQ + Kuya, ~half day).** `npm run tauri build` → Compy-named
artifacts → focused installed-build smoke per the audit checklist: identity, single-instance,
**real-ledger migration (Sentinel dir untouched, pre-rename rollback still executes)**, export
title/filename/BOM, headless elevated FPS helper, zero outbound, uninstall/reinstall persistence.
Uninstall the old Sentinel build from the dev machine after pass. Owner eyes-on sign-off.
**⇒ Beta shippable.**

**Pass 4 — ship (Kuya).** Send invites (~20 Calebs; recruit a couple from mid-crisis communities
— r/pcgamingtechsupport energy — they're the paramedic-mode persona). Ask every tester for two
things: their Export receipt after a session, and the sentence they'd use to describe Compy to a
friend (that sentence is the real pitch test from the open questions).

**Wave 2 — unblocked by feedback, not before.** Moment 3 polish (session-end toast, verdict
sentence, game-name capture) → Moments 4/4b (comparison arming + noise-floor math — benchmark
realignment work) → opt-in diagnostics rail with its own gate + owner sign-off → flagship bets
re-ranked by tester signal (latency culprit-naming vs paramedic mode) → monetization shaped by
what testers actually say, per the original priority list.

---

## Lane rationale (why this split)

- **HQ** is the only lane that can compile, test, build installers, and run Windows smokes —
  and the repo rule is "verification is never skipped," so all implementation lands there.
- **Cowork** cannot verify builds (Linux sandbox) → owns specs, docs, copy, collision/market
  research, and read-only review. Everything Cowork hands over is paste-ready or
  working-tree-only; git stays HQ's.
- **Kuya** owns what only he can: money (domains), judgment (sign-offs, name/tone dials),
  and people (invites, feedback collection).
