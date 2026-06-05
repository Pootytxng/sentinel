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
4. **compy.gg + getcompy.com registered** (identifier `gg.compy.app` and homepage are baked into
   the installer; register before any distribution).
5. **Beta feedback channel = Export receipts + chat (decision).** The decided beta terms are
   fully local / no telemetry / no new code — honor them. The Export report IS the telemetry:
   ask testers to share receipts voluntarily. The opt-in diagnostics rail (P4) moves to Wave 2
   with its own gate; do NOT rush network egress code into a local-only beta.

## Explicit NON-blockers (do not let these creep in)

Gaming Mode QA (stays dark) · code signing (beta is unsigned by decision; signing gates PUBLIC) ·
legal finalization beyond the name swap (gates PUBLIC) · NVIDIA hardware verification ·
Moments 3/4/4b (Wave 2 — need comparison arming + noise-floor wiring) · CSP work (already strict
in the working tree) · the frozen `private-beta-001` refs at `16069fa` (untouched, historical).

---

## Passes

**Pass 0 — today (Kuya, ~15 min).** Register compy.gg + getcompy.com (auto-renew on, WHOIS
privacy on). 10-minute USPTO TESS look for "Compy" in software classes.

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
