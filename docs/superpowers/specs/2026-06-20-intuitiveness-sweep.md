# Intuitiveness Sweep — comprehensive UX audit (owner mandate 2026-06-20)

**Mandate (owner, verbatim intent):** be *very diligent* weeding through everything with even the
slightest potential to be more intuitive — improve navigation, word things more comprehensibly and
easily interpreted, make information easily navigable + accessible, and make every UI option /
interactable function maximize instinctive, easy-of-access structure. "We still haven't come close to
the level of instinctive and intuitive this app needs to be."

**The governing law:** [[flags-name-it-and-fix-it-inline]] — name the specific thing + carry the fix
inline; no vague counts, no "go to another tab" dead-ends, no false "advisory — no one-click change".
Extends to wording (plain, comprehensible), navigation (never make the user hunt), and interactions
(the obvious control is right where the need is).

**Method (rigor, no slop):** audit each surface live (CDP screenshots + code), catalog every issue as
its own atomic item, fix in reversible waves, **self-review each fix live before claiming done** (the
law [[always-self-review-visual-work]]), batch a rebuild/reinstall every few waves. Track here.

---

## Wave 1 — the flag anti-pattern (the card the owner flagged)  ✅ in progress

- [x] **Onboarding First Check "Applied Compy changes" card** (`SetupTour.tsx`) — now names the drifted
      setting ("'Enable Windows Game Mode' turned itself back off") + inline **Turn it back on** +
      game-mode AMD-reset honesty. `useScan` exposes the newest-per-rec `reverted` ledger list.
      Commit `7c9b5af`. Verified live (simulated drift → named → re-applied → cleared).
- [x] **Check surface — same `applied-changes` limiter** (`Check.tsx`) — mirrored. Commit `a0986f1`.
      Verified live.
- [ ] **`startup-load` limiter** (`priorities.rs`) — "Review the Startup tab and disable ones you
      don't need" → should let you disable inline (or at minimum name the heavy apps + a direct
      jump). Decide: inline toggle vs named + one-tap deep-link to the Startup list.
- [ ] **Root the naming in the backend** so Priorities + export name the drifted setting too (one
      source). Currently the frontend derives it from the ledger; backend `AppliedChangesSummary`
      could carry the named `reverted` list (prototyped + reverted — re-introduce when scaling).
- [ ] **Walkthroughs ("Show me the way" / "show-me")** — confirm the *what/why* is fully inline first;
      the walkthrough is the last mile for genuinely-external (Windows) settings, never the only info.
- [ ] **"What's this?" / "Details" links** — audit each: does it explain in place, or punt to a
      separate overlay the user has to chase?

## Wave 2+ — the comprehensive sweep (catalog per surface × category)

Walk each surface live; log issues under: **NAV** (hunting / teleporting / unclear where things live) ·
**WORD** (jargon, vague, hard to interpret) · **ACCESS** (info buried / hard to reach) · **ACT** (the
control isn't where the need is / non-obvious affordance).

- [ ] **Home (CommandCenter / DashboardV2)** — first impression; is every tile's purpose + next action obvious?
- [ ] **Check** — limiters/advisories phrasing; is each row's "so what + now what" instant?
- [ ] **Monitor (Play)** — live stats legibility; session debrief discoverability.
- [ ] **Tune (Fix)** — rec rows wording; Gaming Mode section clarity; the apply/undo affordances.
- [ ] **Blackbook (Learn)** — searchability; verdict glossary discoverability.
- [ ] **Advanced (Lab)** — Benchmark/Latency/Tuning/Diagnostics naming + when-to-use clarity.
- [ ] **Global** — titlebar/Settings reach, Back/Forward, Export, Action Drawer, theme/motion controls.

## Status

Wave 1 landed on branch `ui/inline-fix-flags` (not yet merged/shipped — batching the rebuild).
Gates / frozen refs untouched; all changes reversible.
