# Compy Roadmap: the Paramedic to v1.0

**Derived from:** `../PRODUCT_CONSTITUTION.md` §38 (owner, 2026-11-20).<br>
**On conflict:** the Constitution (product), `../ARCHITECTURE_LOCKS.md` (safety, privilege, privacy) and
`../RELEASE_STATE.md` (what is built, installed, released) win over this file.<br>
**Day-to-day order:** `../QUEUE.md`. This file says what each phase must prove; QUEUE says what runs next.

Three layers ship in order: (1) the Paramedic, alone, first; (2) game-specific known issues; (3) the
opt-in Tuning Bay. v1.0 is Layer 1 on the public release path: signed, with a privacy policy and EULA.
A phase is done when its exit holds on the **installed build**, not when code merges. Designs cited by
name are evidence, not authority, in `C:\Users\Kuya\code\_train\` (`m1-paramedic-design.md`,
`m5-day-one-design.md`, `m1-hardening-design.md`). Nothing here promises a performance result.

## Phase 0: already true (2026-11-20)

- Testers get builds through the signed in-app updater (published: v0.9.26); the owner's desk runs a
  newer unreleased desk build (RELEASE_STATE).
- Home's one main button, "Something's wrong", opens the Paramedic card: "Which game?" and "When did it
  start?", then a first look that needs no history (dated driver, Windows, Steam game and program
  changes; crash history; graphics mods; what looks off; Compy's own dated changes with undo), and a
  measured answer once a game has three normal sessions. "Did it get better?" checks sessions after a fix.
- The change history keeps a verified backup. A session ends when its game exits. The pre-push gate is
  limited to user safety and correctness. The score ring is gone.
- The old roadmap's Phases 0-3 (migration, stabilization, shared machine model, Trial protocol) exited;
  the Paramedic reads that machinery.
- Not yet true: installers are not code-signed; EULA and privacy text are drafts; Compy installs per
  user; frame capture starts only by hand, with a Windows admin prompt each session.

## Phase 1: an honest first answer, everywhere a new user looks

**At the end:** someone who installs Compy and presses "Something's wrong" gets a plain list of what
changed and what looks off on their PC, and no screen claims more than Compy knows.

**Exit:** the over-claims QUEUE names outside the Problems room are gone and `home.json` is in the
wording scan (`src/i18n/problems-room-claims.test.ts`); one "how sure" vocabulary in card and Problems
room, pinned by a test; first look S4 (programs running now) and S5 (crash before/after line) shipped; a
brand-new PC gets a clear first screen and empty states; a look-only check of the installed build as a
brand-new user finds no over-claim, no unreachable control and no "checked and clear" line that was not
checked, and the open items from `_train\view-1120e\report.md` (green "Check again" before a game is
picked, Re-run band wording, count-style Home headlines) are fixed or decided.

**In:** QUEUE items for over-claims, vocabulary, Problems room follow-ups, card layout, first-run states,
drift notices. **Out:** the navigation fold (paramedic F9), new rooms, any score or "N issues" tally.
**Depends on:** nothing new. **Owner:** the Home headline decision (m5 H5); time away from the PC for
the look-only check.

## Phase 2: the measured answer and "did it get better?"

**At the end:** Compy measures a game while the user plays, says when it runs much rougher than its own
normal and what changed around then, and after a fix says whether it got better or that it can't tell.

**Exit:** the measuring design below is decided and on the installed build; first look S6 ("Start
measuring" in the card) and S7 (handover baseline: "how it runs since you said it got better") shipped;
a crash-and-relaunch counts as one sitting, Suspected or mixed sessions are not judged and the card says
why, and the baseline is keyed by frame cap, refresh rate and resolution (each with a test that fails on
today's code); background load recorded at game start and used both ways; the graphics driver's own
settings (Radeon first) read as a "what changed" source; a crash complaint answered in the same card
(paramedic F5, F10); the 1-before/1-after fix check uses the m5 D3 bar and says "can't tell yet" below it.

**Open design: measuring without a ritual.** Today capture starts by hand, raises an admin prompt each
session, and a game needs three normal sessions before the measured answer speaks. A design is being
written. Decision point (m5 H4): keep a manual "Start measuring" with the prompt, or a consented
auto-start for the picked game. Auto-start makes the elevated capture helper start without the user
present, a privilege change: it needs an ARCHITECTURE_LOCKS review and the owner, and comes after
security slice 2.

**Out:** the unprompted "ran rough" notice (off until Phase 5); changing the frozen anomaly constants
without re-running the walk-forward test. **Depends on:** Phase 1's vocabulary. **Owner:** H3 (keep
the user's answers in a local, deletable, never-exported file), H4; one ordinary ROB RUN session with
nothing else running.

## Phase 3: safe one-button fixes and a closed privilege boundary

**At the end:** where Compy can fix the likely problem safely, the user presses one button and can undo
it from History; every admin action Compy can take is one its own code names in advance.

Security slices in the order of the hardening design §5 (independent review on each; its size estimates):

| # | Slice | Size | Blocks v1.0? |
|---|---|---|---|
| 1 | System tools by absolute path; pinned environment for elevated children | 1 d (reviewed, waiting to land) | Yes |
| 2 | Frame-capture helper over a verified pipe | 2 d | Yes |
| 3 | Elevated results over stdout; ticket consumed by handle | 1.5 d | Yes |
| 4a/4b | Closed set of typed elevated operations sized to the Paramedic's fixes; raw entry deleted | 3-4 d | Yes by default; deferring it is an owner decision with a written risk note |
| 5 | Per-machine install (Phase 4); may move up to second once the owner decides | 1 d + VM test | Yes: the only fix for a user-writable install folder |
| 6 | History backup | done | n/a |
| 7 | Uninstall notice (shares the install hook with 5) | 0.5 d | Yes |

**One-click fixes** use the existing apply/undo path (`actions.rs`, ledger row first, rollback from
`history.json`): turn off a new startup entry, switch back to the earlier power plan, undo a Compy change.
Fixes needing no admin rights may land after slice 1; a fix needing admin rights lands only as an
operation in slice 4's closed set. Driver rollback, Windows update removal, refresh rate and memory
profile stay as exact steps (paramedic C1-C4).

**Exit:** the fail-first tests in the hardening design and paramedic F6 pass; red-team checks RT1, RT4,
RT5 run before and after; each fix applies, shows in History and undoes to the exact prior state on the
installed build; a source guard proves the Paramedic never calls apply itself.

**Out:** one-click driver rollback, killing processes, anything barred by ARCHITECTURE_LOCKS §3.
**Depends on:** Phase 2 findings to attach fixes to. **Owner:** "land the security slice"; slice 4
hold-or-defer; the lock additions the design proposes.

## Phase 4: ready for strangers (install, signing, legal)

**At the end:** a stranger can download a signed installer, install Compy to Program Files, and read
what Compy does with their data before using it.

**Exit:** per-machine install puts Compy in `C:\Program Files\Compy`, ordinary users cannot write there,
the old per-user copy is removed, an update raises one admin prompt, and release tooling naming
`%LOCALAPPDATA%\Compy\compy.exe` is re-pointed, proven on a VM or the owner's UAC test (hardening §5.2);
the installer is Authenticode-signed in the release pipeline; privacy policy and EULA are final and
published (with the history-backup wording) and a first-launch notice says what Compy reads, keeps and
sends; Export Snapshot redacts unknown program names; overlay and Game Bar names checked on real
NVIDIA/AMD installs; the ARCHITECTURE_LOCKS §4 checklist walked item by item into RELEASE_STATE.

**Out:** store listing, payments, arming Receipts, case intelligence or remote rules (all stay dark).
**Depends on:** slices 5 and 7. **Owner:** signing eligibility and identity; the per-machine decision;
a VM or 15 minutes for the UAC test; legal text and its publication on the site.

## Phase 5: validated on PCs other than the owner's

**At the end:** Compy has been used on several PCs that are not the owner's, and its answers held up.

The anomaly thresholds were fitted to 50 sessions on one AMD PC; NVIDIA/Intel drivers, laptops,
non-Steam launchers, event-log access on other editions and first-week users cannot be checked on it
(paramedic G1-G2). **"Validated"** (coordinator proposal; the owner may amend): on at least 3 outside
PCs, one or more with a non-AMD GPU, about a week of ordinary play each on a tester build; at
least one game per PC reaches a measured answer; the rough-session rule fires on no session the tester
calls normal; the first look finishes in its time budget and shows no line the tester can show is false;
every one-click fix used undoes cleanly and nothing changes without a button press; each finding is fixed
or listed in the release notes as a known limit. Only after this may the unprompted notice be considered
for default-on (owner decision). Testers on the updater path do not need a signed build.

**Depends on:** Phases 1-2 and the no-admin fixes on a tester build; Phase 3 changes that land later are
re-checked on the testers' PCs before release. **Owner:** 3-5 named testers, willing to report by hand
what Compy showed them (there is no telemetry).

## Phase 6: v1.0 release

**At the end:** anyone can download Compy v1.0 from the public site.

**Exit:** Phases 1-5 hold on the release candidate; the release transaction (`../RELEASE_TRANSACTION.md`)
closes on its own evidence; RELEASE_STATE shows code signing and legal closed. **Owner:** the publish GO.

## Target date and date risk

**Target: Friday 2026-12-11**, a coordinator default (QUEUE "Waiting on the owner") the owner may overturn.

Mon 2026-11-23 to Fri 2026-12-11 is **15 working days**. From the designs' own estimates:
- security slices still to build: 2 (2) + 3 (1.5) + 4a/4b (3-4) + 5 (1) + 7 (0.5) = **8-9 days
  serial**, plus the owner's VM or UAC test; admin-needing fixes follow slice 4;
- Paramedic and honesty work still open: about **13 executor sessions** (first look S4-S7, paramedic F5,
  F6, F10, the QUEUE judging and wording items);
- outside validation: about **5 working days** of play, then fixes.

Strictly one writer at a time, 8-9 + ~13 + 5 is well over 15: **the date does not fit serially.** It
fits on paper, with 2-3 days of slack, only if security and Paramedic work run in parallel on disjoint
files and a tester build (Phases 1-2 plus no-admin fixes) goes out by Tue 2026-12-01.

**Any one of these makes 2026-12-11 unrealistic:** slice 1 not landed by Tue 2026-11-24; slice 4 past
4 days with no owner deferral; testers not named and installed by Tue 2026-12-01; the signing identity
not cleared in time to sign the candidate (outside lead time unknown, so it should start now); the owner
choosing consented auto-start for capture (privilege change plus locks review); validation false alarms
that need the thresholds re-fitted. A late tester start or a late slice 4 moves the date day for day;
the Friday after is 2026-12-18. The likeliest slips are owner-side inputs, not build work.

## Layer 2: game-specific known issues (after v1.0)

**Question first:** where the known-issue knowledge comes from and how it stays current and honest. A
list shipped in each release adds no network surface; a downloadable catalog is the signed
case-knowledge tier of ARCHITECTURE_LOCKS §1.8, built dark, needing its own owner arming decision.
**Smallest first version:** for the picked game on the user's GPU and driver version, the known
hardware-related issues that apply, each with source and date, in the same card; "none known" when none
apply; nothing the user's hardware or driver rules out. **Layer 1 first:** v1.0 shipped; game and
driver identification proven on outside PCs.

## Layer 3: the Tuning Bay (after Layer 2)

**Question first:** which optional changes are low or zero risk on this hardware and measurable on a
repeatable workload rather than ordinary play. **Smallest first version:** a separate opt-in space with
the existing per-setting Trial on a repeatable workload and one hardware-specific walkthrough (such as
the memory profile for the detected board vendor). Compy guides BIOS and overclocking steps; it does not
change firmware; ARCHITECTURE_LOCKS §3 applies unchanged. **Layer 1 first:** undo path and privilege
boundary proven on outside PCs; Layer 2 shipped.

## Not on the roadmap

Retired or frozen by §38. Existing code stays where it is unless QUEUE says otherwise; it is not built
further before v1.0.

- **Per-setting Trials as the headline.** Ten Trials in 177 days found no improvement: sessions vary
  13-26% while the settings on offer plausibly move a game 0-3%. They move to the Tuning Bay.
- **Old Phase 4-7 exit proofs and friend-tester halves** (optimization engine, guided optimization,
  Care and UX convergence). Retired by §38; Phase 5 above is the outside proof now.
- **Outcome choices and Safe / Recommended / Push results.** They depend on Trials finding wins.
- **Readiness scores, score rings, grades and issue tallies.** A score turns generic floors into a
  verdict; the first look lists facts.
- **Advanced tuning envelope (old Phase 8).** Becomes Layer 3.
- **Hardware upgrade advice (old Phase 9).** Not one of the three layers; frozen.
- **Evidence network, Receipts, case intelligence, remote rules (old Phase 10).** Stay dark; arming each
  is its own owner decision.
- **Monetization (old Phase 11).** `MONETIZATION.md` predates §38 and needs reconciling; no payment work
  before v1.0.
- **Process machinery.** No new guards or coordination documents (§38); Work Control and the work train
  no longer drive work (`../../CLAUDE.md`).
