# BACKLOG steering log — cycles 2026-08-04b … 2026-08-04g (archived 2026-08-18)

Moved verbatim out of `docs/BACKLOG.md` under the TOKEN LAW byte budget (history leaves the living
ledger, nothing is deleted). All six cycles ran on `claude/harness-context-cleanup-700535` and were
left unpushed/unmerged for the owner's merge decision. Full change history: `docs/CHANGELOG.md`.

### Cycle 2026-08-04g — ✅ THE SIBLING ROOM STOPS SPEAKING FOR THE SAME UNREADABLE LEDGER (CC): `61e092c` · `50ff816` · `801b27c` on `claude/harness-context-cleanup-700535` — **unpushed, unmerged** (owner decides the merge)

Cycle f fixed Optimize. The same `get_applied_changes` array feeds the Blackbook Logbook, where the
emptiness was dressed as an even *wider* claim — the section scent reads *"everything Compy has done on this
PC · since &lt;date&gt;"*, the empty state reads *"No record yet"*. One surface honest and its sibling not is not
a fix, it is a smaller version of the same lie. So the disclosure was **extracted, not reimplemented**:
`src/design/LedgerHealthNotice.tsx` is now the ONE component both rooms render (`useLedgerHealth` probe +
`knownIncomplete` narrowing helper + the box), lifted out of `Fix.tsx` verbatim — net −54 lines of `Fix.css`,
and `optimize.ledgerHealth.*` → `common.ledgerHealth.*` in both locales. Two surfaces warning about the same
file in two different voices is a drift the next change would widen; the shared module makes it structurally
impossible.

The two failure shapes take **different numeric treatment**, because they are different facts. `error` —
`load_history()` is failing right now, so the changes tile renders `—`; a `0` there would say *"nothing ever
happened on this PC"*, where the dash says *"no number"*. `quarantined` — that load SUCCEEDED, so the count is
accurate for what survived and only the words narrow. The third state is the one easiest to get wrong:
UNKNOWN (probe failed, or the classic face isn't mounted) is **not** incompleteness — manufacturing a warning
from a read that failed is the same dishonesty mirrored — so it is pinned literally as
`expect(unknown).toBe(healthy)` on `innerHTML`, and the reviewer re-proved it live (3344 chars, exact match).
Placement is part of the claim: the notice renders FIRST, above the tile strip, and the guard asserts the
**order**, not the presence. Wiring is `useLedgerHealth(changes, consoleOn)` — keyed on `changes` so health is
read on the same tick as the rows it qualifies, gated on `consoleOn` so classic keeps its zero-IPC contract.

Guards, both mutation-verified: `src/surfaces/blackbook/ledger-health-blackbook-guard.test.tsx` (10 cases,
NEW) · `src/surfaces/ledger-health-disclosure-guard.test.tsx` (8, repointed at the extracted component).
`50ff816` fixes the doc-truth scan **scope**: `scannedDocs()` builds its corpus from every doc the branch
touches, so `6c0eb21`'s retention move made this branch fail on three archive sentences written in `1c2a0a2`
/ `4619689` — rewriting history to pass a scan would falsify the record, so the fix is an `isHistory`
predicate plus two separately-pinned safeguards (the detector, and that the exclusion never swallows
SPEC/WORK_CONTROL/BACKLOG). `801b27c` tracks the two pre-existing `docs/ui-sweep` window-geometry helpers the
native-res capture law depends on — untracked files vanish. cargo 922 · **npm 3274 (294 files)** · tsc clean ·
doc-truth 15/15 · encoding-guard 1221 clean · doc-budget PASS · self-reviewer **VERDICT: PASS** (9/9, both
rooms, both languages, hover via real CDP input; exactly two render sites tree-wide).

- **Closed here without the field it was prescribed:** `get_intelligence_timeline` shrinks silently on the
  same unreadable ledger. Cycle d recorded the fix as a `TimelineView` payload field — wrong shape. The
  timeline has exactly ONE consumer (`BlackbookV2.tsx:96`) and its events land in the same `records` array
  rendered directly beneath this disclosure, so one probe covers both. No IPC widened, no backend change.

### Cycle 2026-08-04f — ✅ THE LEDGER NO LONGER SAYS "NOTHING IS ACTIVE" WHEN IT CANNOT READ ITSELF (CC): `b60a314` · `a1d5f53` on `claude/harness-context-cleanup-700535` — **unpushed, unmerged** (owner decides the merge)

`get_applied_changes` degrades an unreadable Trust Ledger to an empty array, and the Active layer renders
empty as *"Nothing active on this PC"* — an affirmative claim about the MACHINE, spoken at the exact moment
every apply and every rollback is refusing. `history.rs` had carried this as an open follow-up against
itself since the H1 quarantine fix; closed here by two read-only commands, `get_ledger_health` +
`reveal_ledger_folder`, main-window only (`build.rs` `APP_COMMANDS` + `capabilities/default.json`,
deliberately absent from `overlay.json`).

Both failure shapes are checked, because either alone is a false negative: the **transient** `Err` from the
load, and the **durable** quarantine marker — after that rename every later load returns `Ok(vec![])`
forever, byte-identical to a first run, so `complete` can never come from a row count. `ledger_health_at`
loads FIRST then reads the marker (a failing load performs the rename as part of failing) and calls the
private `load_history_from`, not the public wrapper, which records a support-evidence event on every `Err` —
a UI-refresh-driven probe would push 400 identical records through a ring with no dedup. Third state kept
honest: probe UNKNOWN claims nothing and leaves the surface as it was. The disclosure carries its own fix
([[flags-name-it-and-fix-it-inline]]) — names the shape, quotes the raw OS error, reveals the preserved
`.corrupt` file, and surfaces a failed reveal rather than no-opping. Guard
`src/surfaces/ledger-health-disclosure-guard.test.tsx`, 8 cases, mutation-verified four ways. cargo 922 ·
npm 3262 · tsc clean · doc-budget PASS · self-reviewer **VERDICT: PASS** (title 10.43:1, hover 14.17:1, no
duplicate banner, long OS path contained). `a1d5f53` split a `BRANCH_DISPOSITIONS.md` sentence the doc-truth
guard read as a merge claim — the prose moved, not the regex (bug→guard).

- **Board retention:** the 5 oldest cycles (16c/16b/16a/15d/15c) moved verbatim to `BACKLOG_ARCHIVE.md`,
  per the retention rule above — 17 cycles back down to 12, and `docs/BACKLOG.md` from 1368 to 1178 lines.
- **Closed in Cycle 2026-08-04g — and not by the field this line asked for:** `get_intelligence_timeline`
  shrinks silently on the same unreadable ledger. The prescription (a `TimelineView` field) was the wrong
  shape: the timeline has exactly ONE consumer, and it renders beside the Change rows.

### Cycle 2026-08-04e — ✅ THE NEXT TEST MAY NAME A REC — BECAUSE IT READS THE ID (CC): `83ebfd8` on `claude/harness-context-cleanup-700535` — **unpushed, unmerged** (owner decides the merge)

The deferral premise was wrong. Routing `next_test` structurally looked like it needed a prose→catalog
mapping (fabrication), but `compy-config-change` is the one hypothesis backed by real Trust-Ledger
rows, and an `AppliedChange` already carries a real `rec_id`. So the id is **copied off the row**;
nothing parses a summary anywhere. `EventRecord.rec_id` is the only possible carrier (`WhatChangedInputs`
never sees raw ledger rows). Emitted only when three conditions **read** true: exactly ONE distinct rec
in the window (the sentence says "the change" — choosing between two is fabrication-by-selection), it
has an apply event, and that apply is not `since_rolled_back`. Read from the window's own events, not
the live ledger, so the engine stays pure.

Deliberately **not** gated on `is_appliable`: an advisory rec can't produce an apply row anyway, and a
rec that has since left the allowlist is still undoable (LOCKED rule 3 — rollback resolves from
`history.json` alone). Gating there would suppress a valid rollback.

**The item named the wrong destination.** `ExperimentBench` is ARMED but it *applies*, while the only
next test that can carry an id prescribes a **rollback** — a still-active rec hits `already_active` and
simulates to `already-configured`, a dead end. Destination corrected to the **Trust Ledger / Applied
Changes** surface in four places (Rust doc comment, TS mirror, this file, decision doc §5). Guard
`next_test_rec_id_is_read_from_the_ledger_never_matched_from_prose`, 6 cases, mutation-verified.
917 pass (+1) · clippy clean · npm 3239 · module-map OK · doc-budget PASS.

**Remaining half — closed the next commit, `2d5d955`** (this line said "recorded not built" for a day
after it was built; corrected in `343df36`). The affordance is an inline `Roll back "<change>"` button in
the What-changed report itself, not a trip to the Ledger surface — plus the duplication self-review caught
between it and the `ComparisonCard`'s own control, and a 13-case guard. Full record at the `[x]` item
above; not restated here.

### Cycle 2026-08-04d — ✅ AN UNREADABLE LEDGER NO LONGER EXONERATES COMPY (CC): `8798616` on `claude/harness-context-cleanup-700535` — **unpushed, unmerged** (owner decides the merge)

Swept every `load_history().unwrap_or_default()` against one test: *does the collapse make the app
**assert something false**, or merely **show less**?* Four sites merely show less (an empty history
view is honest) — documented, left alone. The fifth, `intelligence.rs::gather()`, asserts.
`compy-config-change` is the only hypothesis allowed to read ledger silence as *contradicting*
evidence, and it earns that from a premise in its own comment: the ledger is a complete record of
what Compy did. `unwrap_or_default` breaks that premise while looking exactly like a quiet machine —
so an unreadable ledger made the engine state *"No Compy changes were applied…"* as fact and **rule
Compy out** as the cause of a regression it may have caused.

Completeness has two legs and both are now checked: the transient `Err` from the load, and the
durable `ledger_was_quarantined()` — because the quarantine fails loud exactly ONCE, and after the
rename every load reads `Ok(vec![])` forever, indistinguishable from a first run. `gather()` loads
once and derives `LedgerHealth` before collapsing (a second load would double-record the support
evidence); it is passed to `what_changed` as a named parameter, so the engine stays deterministic.
Under `Incomplete` the silence routes to `missing`, not `contradicting` — the hypothesis lands in
**unknowns** with the gap disclosed, matching the file's existing Windows-build idiom. Red proven on
the assertion first (`ruled out: ["compy-config-change"]`), not on a compile error. 916 pass (+2) ·
clippy clean · npm 3239.

Follow-up, closed in Cycle 2026-08-04g: `get_intelligence_timeline` also shrinks silently on an
unreadable ledger. It's a view, not a claim — but it did **not** need the `TimelineView` field
prescribed here. Its one consumer renders it beside the Change rows, so a single `get_ledger_health`
probe on that surface discloses both, and no payload widened.

### Cycle 2026-08-04c — ✅ Q9 CONFOUND WATERMARK: THE COMMENT WAS THE ONLY GUARD (CC): `e97a6e3` on `claude/harness-context-cleanup-700535` — **unpushed, unmerged** (owner decides the merge)

Q9 acceptance: *"before/after attribution never credits one change when several changed."* The
Trust-Ledger watermark is the mechanism. `history.rs` documented it as refusing on a ledger that
**DIFFERS** from the armed count; `comparison.rs` implemented `ledger_now > watermark` — **advanced**,
not differs. The comment described a guard nobody wrote.

Reachable, not theoretical: `load_history_from` quarantines a corrupt ledger to `history.json.corrupt`,
after which every load returns empty **forever**. The count then sits *below* the watermark while
apply resumes into the fresh ledger — so real confounding changes land unseen and `0 > 3` reads as
"nothing happened." Both engines credited the delta to the armed change. Proven red first
(`left: "improved"` / `right: "confounded"` at `comparison.rs:371` + `experiment.rs:1080`), then fixed:
`ledger_len()` **deleted** for `ledger_len_checked() -> Result`, one shared `arm_watermark()` that
refuses to arm on an unreadable ledger, and `!= Some(watermark)` over `Option<usize>` at the single
comparison site. Equality is sound because the ledger is append-only in code. 914 pass · clippy clean.

### Cycle 2026-08-04b — ✅ Q7 IDLE-COST ACCEPTANCE LINES §397–§399 CLOSED (CC): `75ce9b3` · `452a990` · `2c01d5b` · `64cdaa6` on `claude/harness-context-cleanup-700535` — **unpushed, unmerged** (owner decides the merge)

The three Q7 acceptance lines that are *code* rather than *machine time* (spec
`2026-07-29-product-quality-stabilization-program.md:397–399`). Each defect became a guard before its
fix was done; each guard was negative-proved by breaking the code and watching it fail.

- **§397 — hidden windows kept polling sensors (`75ce9b3`).** Rooms polled `get_cpu_sensors` /
  `get_gpu_sensors` / `get_fps_status` behind a fully hidden window. `useDocumentVisible()` +
  `src/hidden-poll-guard.test.ts` (file-level, deliberately not AST).
- **§397 — a COLLAPSED disclosure still ticked (`452a990`).** `WalkthroughDisclosure` mounted its
  carousel while closed, so an unopened explainer animated forever and counted itself as a step.
  `useRoomActive()` is the second axis (inactive room), distinct from the window axis above;
  `src/keepalive-idle-guard.test.ts`.
- **§398 — two owners on one sensor stream (`2c01d5b`).** MonitorV2's shell polled `get_fps_status`
  in compositions where a mounted face already owned it. §398 is a **runtime-ownership** rule, not a
  code-duplication one — the fix names the one composition (advanced + Sessions) with no owner.
- **§399 — the tour's render loop never stood down (`64cdaa6`).** `HardwareTourScene` derived
  `frameloop` from a `paused` prop its only mount site hardcoded to `false`. Every animation inside
  checked `reduced`; nothing checked the loop — full GPU cost producing an identical frame.
  `src/idle-motion-guard.test.ts` now also pins the `:root[data-motion="reduced"]` reset that 32
  `infinite` declarations across 21 stylesheets silently depend on. Measured: 0 GL draws over ~21 s
  hands-off under reduced motion, 24,690 within ~2 s of flipping back.

**Deliberately NOT done:** no game-active (step-aside) axis on the tour canvas — it would need a
second `get_fps_status` poller, re-creating the §398 violation fixed one commit earlier. **Still
open in Q7:** the native accessibility sweep and the recorded performance baselines — both need the
owner's machine and a stable candidate, not more code. Evidence rows updated in
`docs/superpowers/specs/2026-07-31-q7-native-baseline.md`.
