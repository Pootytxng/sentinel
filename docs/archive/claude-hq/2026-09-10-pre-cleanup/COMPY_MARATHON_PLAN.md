# Compy Marathon Sprint Plan — 2026-08-12

**Owner:** Kuya. **Prepared by:** Cowork HQ audit session, from measured evidence only.
**Ledger:** `claude/HQ_DECISION_LEDGER.md` governs; this plan is filed there.

---

## Part 1 — The audit verdict: where the last two weeks actually went

Your perception ("little to no visual or functional change") is **half right, and the
half that's right is the half that matters.**

Measured, from `git` on `C:\Users\Kuya\code\sentinel` (14 days):

| Metric | Value |
| --- | --- |
| Total commits | **305** |
| Commits matching meta prefixes (docs/guard/test/hooks/merge) | **160 (52%)** — floor, not ceiling |
| Commits touching product code (`src/` or `src-tauri/`) | **82 (27%)** — and many of those are guard *tests*, not features |
| Files touched: product (`src` + `src-tauri` + `site`) | 441 |
| Files touched: meta (`tools` + `docs` + `scripts` + `.claude` + agent files) | **~720** |
| Releases published to the fleet in these 14 days | **1** (v0.9.12, on 2026-08-03 — day 1 of the window; **nothing since**) |
| Open PRs right now | **0** |
| Active worktrees | 7, several tied to stale/parked lanes |

**Diagnosis.** The company is not idle — it produced 305 commits. It is **spending the
majority of its throughput governing itself**: dispositions, handoff docs, guard hooks,
lane bookkeeping, CLAUDE.md budget trims. That machinery was built for a real reason
(the drift audits are in the record) and it works — but it has become the main product.
Meanwhile:

- `RELEASE_STATE.md` itself says, in bold: **"no active release blocker remains, and
  normal product development may resume."** The gate is open. Nobody is driving through it.
- The fleet (your testers) is still on **v0.9.12 from Aug 3**. Your desk got 0.9.13 on
  Aug 11, but nothing you or anyone else can *see* has shipped outward in 9 days. That is
  why it feels like nothing is happening — outwardly, nothing is.
- Zero open PRs means there is no product work in flight *right now*.

**Tooling audit (skills / plugins / settings / connectors): NOT the bottleneck.**
Plugins (compy, gitkraken, desktop-commander, cowork-plugin-management, productivity) are
right-sized; settings already grant full permissions; the one real config defect (project
knowledge base storing scaffolding while excluding canonical docs) was found and fixed
this session (95% → 44%, canonical docs now retrievable). Adding tools now would be
capability-before-need. **The fix is throughput allocation, not acquisition.**

---

## Part 2 — Marathon laws (effective immediately, filed in the ledger)

1. **Product-first ratio.** A work session ends only after at least one *user-visible*
   change ships to the desk build. Governance/doc/guard work happens in the last 10% of a
   session, never the first 90%. (bug-to-guard still applies when a defect is caught —
   that law is untouched.)
2. **Dispositions batch daily**, not per-commit. One row-sweep at end of day.
3. **No new guards without a caught defect.** Guard-writing as default motion is over.
4. **The fleet moves weekly.** If the desk build is stable at week's end, cut and publish
   the release. A desk a minor version ahead of the fleet for 9+ days is invisible progress.
5. **One lane at a time.** 7 worktrees is how the chaos feels like chaos. Marathon runs
   ONE product train to completion before opening the next.

---

## Part 3 — The sprint itself (design & build first, from YOUR OWN cutline)

Priority source honored: `docs/BACKLOG.md` §CURRENT PROGRAM CUTLINE (owner request
2026-07-29, Product Quality Stabilization), which supersedes the 2026-06-21 roadmap
sequencing for pull order. These are not invented tasks — they are the open items your
own ledger names, ordered for visibility.

### Train 1 — Mount the "add a part" form (Day 1; small, visible, already diagnosed)
The BACKLOG's own words: the manual-parts feature is **"reachable in tests only — a user
cannot add the PSU or cooler Compy admits it cannot read."** `<RigViewer>` only renders
`chromeless` from `LabConsole.tsx`, which hides the add-a-part form, explode/orbit
controls, and monitor nudge. Fix: mount a non-chromeless viewer or move the form into the
Lab's chrome. First visible win, day one. Ship to desk.

### Train 2 — Issue #49: Quiet Pit Wall Lab, the DESIGN train (Days 2–6)
This is the open **[DESIGN]** issue, and the `feat/lab-49-parity-port` worktree already
holds the portable goods: the real rig evidence map, measured gauges, comparison
evidence, honest unavailable states, decision-journey behavior, a11y/layout guards. Port
what has earned parity into the Lab surface. This is the single biggest *visual* change
available — it is literally the design overhaul you keep asking to see.

### Train 3 — Issue #91: Compy Care, Tier 1 + the visible Care entry (Days 7–12)
Owner-approved 2026-08-09; queue position exact — #102 landed 8/11, so #91 rebases NOW.
Two halves, and the second is visible:
- Dark half: signed pull-only known-issue catalog, Rust-side, separate key/schema/domain,
  runtime hard-false (per the approved Capability Exception record).
- **Visible half:** the discovery contract says a compact **Care entry ("Crash & Freeze
  Rescue") is always visible on Home.** That is a user-facing product change, part of the
  approved design. Build it in this train.

### Train 4 — Publish (Day 13–14)
Cut v0.9.14 from the trains above and **publish to the fleet** via the normal 9-stage
transaction. Code signing and legal remain OPEN but gate *public* release only, not the
private-beta updater — the fleet path is proven (canary PASS, ≥2 testers auto-updated to
0.9.12). End the marathon with testers visibly running the new build.

### Cleanup (parallel, low effort)
- Verify-then-prune stale worktrees: `sentinel-project-doctor` (tied to #55's stale
  claim per BACKLOG), `sentinel-pr89-identity` (Codex second-opinion lane; Codex is "not
  a lane work waits behind" per your own roles doc). Keep `sentinel-quietpitwall`
  (feeds Train 2) and `sentinel-feedback` (preserved source, read-only).
- Issues #54/#55 (Project Doctor): park explicitly — BACKLOG already calls the claim
  stale; an honest "parked" beats a phantom lane.
- #64 (Q2b caller checks): stays open, queued behind the trains; touch it only if #91
  work trips it.

---

## Part 4 — What "done" looks like on Day 14

- Add-a-part reachable by a real user. ✅ visible
- Lab surface carrying the evidence map + gauges. ✅ visible
- Care entry on Home; Tier 1 dark plumbing merged. ✅ visible + strategic
- v0.9.14 published; testers on it. ✅ visible to other humans
- Meta-commit share for the sprint window under 30%, measured the same way as above.
- Zero new worktrees opened; ≤4 remaining.

Anything that doesn't serve those six lines waits until Day 15.
