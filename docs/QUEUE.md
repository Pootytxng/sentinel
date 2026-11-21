# QUEUE — the one work list (PRODUCT_CONSTITUTION §38). Edit it in the same commit as the work.
One writer per scope: each item below runs on its own branch or worktree; do not touch another writer's scope.
Changes to privilege, rollback or measurement code get an independent review before they land.
No builds, tests or pushes while a game runs on the owner's PC (see CLAUDE.md for the check).

## NOW (in flight, each on its own branch)
- [ ] Security slice 1: system tools by absolute path, pinned child environment — closes planted-tool and inherited-environment risk (claude/m1-hard-1; reviewed and green, waiting for the owner's direct go-ahead to push)

## NEXT (in order)
- [ ] Look-only check of the installed build as a brand-new user (first launch, "Which game?", "When did it start?", privacy line) and of the Home and Problems-room changes — runs only while the owner is away from the PC
- [ ] Over-claims left outside the Problems room: `intelligence_patterns.rs` ~580 and ~604 ("points at the game itself ... rather than your PC"), the Home interview lines (`crashAnytime`, `slowAlways`, the heat keywords); then add home.json to the wording scan (`src/i18n/problems-room-claims.test.ts`)
- [ ] One vocabulary for how sure Compy is: the Problems room says Weak/Partial/Strong signal, the card says Possible/Likely
- [ ] Problems room follow-ups: the heading "What this points to" sits above a "can't tell" sentence; "Did this help?" answers match by rule only; a time limit on the Event Log reader; the fixed 85°C line is never compared with this card's sessions that did not crash
- [ ] History backup: write the backup at startup when the main file reads cleanly and no backup exists (today it appears only after the next save, so a PC with no new change has none)
- [ ] Card: opening it pushes the lower half of Home below the fold; the questions view has no "More below" cue; Escape from a disclosure
- [ ] Weekly test set (`npm run test:audit`): `scripts/verify-release-gate.test.mjs` fails; find out why
- [ ] first look: drift notices ('turned off outside Compy') and changes undone inside the window
- [ ] first look S4-S7 (programs running now; crash before/after line; start measuring + one-session statement; local store for answers)
- [ ] Group a crash-and-relaunch into one sitting for baselines, noise bands and real-play counts — a crash and relaunch no longer counts as two independent sessions
- [ ] Paramedic: sessions flagged Suspected (`session_boundary::suspected_splice`) are not judged; a note says why — an old two-game row never poisons a diagnosis
- [ ] Name the setting in "a setting Compy applied is no longer on" (needs a read-only ledger reader + a name on the drift record)
- [ ] Crash line: say when more reports matched the program name but ran from another folder (8.3 names, \\?\ paths, junctions)
- [ ] Mod scan: time-based release when a drive never answers
- [ ] Use more of what Compy already records as evidence — ignore sessions flagged as mixed
- [ ] Record what was already running when the game started (recorders, overlays, long builds) and use the background-load numbers both ways — the card can blame or clear background load
- [ ] Read the graphics driver's own settings (Radeon via ADLX; later NVIDIA) as a "what changed" source — a changed driver setting shows up in the diagnosis
- [ ] Crash complaint in the same card — "this crash has happened N times since <date> on the same game build"
- [ ] One-click fixes through the existing undo path (startup entry, power plan, undo a Compy change) — the owner presses one button instead of following steps
- [ ] Security slices 2-7 from the hardening design: frame-capture helper over a pipe; result relay and safe ticket handling; closed set of elevated operations sized to the Paramedic's fixes; per-machine install; uninstall notice — closes the remaining privilege and data-loss risks
- [ ] In-app Clear history (removes the ledger, its backup, marker and set-asides together)
- [ ] History backup follow-ups: a `backup_current` flag in the health view, age out the restored note, a `.corrupt` left after a full restore still reads as incomplete, render the restored note in the UI (en + zh-CN)
- [ ] Baseline keyed by frame cap, refresh rate and resolution — a changed cap no longer looks like a slowdown
- [ ] First-run and empty states for a new user — a new PC gets a clear first screen, not blank cards
- [ ] Signing, privacy policy and EULA — the installer is signed and the legal text is published
- [ ] Rewrite docs/product/ROADMAP.md around Layer 1 — the roadmap matches §38
- [ ] Export Snapshot: redact process-start program names that are not on the known-programs list
- [ ] verify the NVIDIA / AMD overlay and Game Bar image names on real installs

## LATER
- [ ] Layer 2: game-specific known issues for the user's game, hardware and driver
- [ ] Layer 3: the Tuning Bay — per-setting Trials on a repeatable workload; BIOS and overclock walkthroughs by hardware
- [ ] Unprompted "this session ran rough" notice — stays off until the rule is validated on other PCs
- [ ] Remaining diet steps — agent machinery removal (needs the owner's yes for the project settings file); docs archive

## Waiting on the owner
- Say "land the security slice" (claude/m1-hard-1).
- One ordinary ROB RUN session with nothing else running (Compy now records background load).
- US/Canada eligibility and identity for code signing.
- 3-5 outside testers.
- A VM or 15 minutes for a real UAC-prompt test.
- Yes or no on editing the project's `.claude/settings.json` in the diet.
- Publish the privacy page wording for the history backup with the release (site/privacy.html; docs/PRIVACY.md already has it).
- ARCHITECTURE_LOCKS line for the ledger backup (proposed text in _train\b1-review-r1.md).
- Coordinator defaults the owner may overturn: ship date Friday 2026-12-11; v1 ships only the admin fixes the Paramedic needs; install to Program Files; no use of the word "guarantee"; a strength above the lowest needs two independent supports and no contradicting evidence (in the Paramedic's code and now the Problems room's; not yet written in the constitution); the full health check shows no score ring (removed 2026-11-20, one revert restores it).

## Done (newest first)
- 2026-11-20 - Card: "Something else?" opens the questions inside the card; the header's duplicate "Something went wrong" button removed; the crash banner's "Find out why" still opens the crash record but is no longer a second main button; Escape closes the card; "More below" no longer covers text; the Re-run band says "No checks were graded" or "No full check has run yet" b8f782d7
- 2026-11-20 - Problems room: no rule shows above "Weak signal"; a crash record no longer rules out the PC or blames the game; "found no..." lines only when the Windows log read is proven by row count; the Lab picture no longer dims hardware for a crash record abbad9bc
- 2026-11-20 - desk build cb8afffe installed and stamped by the scheduled Friday install cc8e66da
- 2026-11-20 - Home: "Watch it work" and "Got it" are quiet buttons; the score ring is gone from the full health check cb8afffe
- 2026-11-20 - A reader frees its slot before it hands its answer over (a back-to-back read was refused as "took too long" on a busy PC) fec63809
- 2026-11-20 - Load-flaky push-check tests made deterministic (four named, three similar) 0cc3a30e
- 2026-11-20 - desk build 5f4cad34 installed and stamped
- 2026-11-20 - First look for a picked game (its Steam file change, crash history, graphics mods) and what looks off on this PC as plain facts, with Compy's own dated changes (claude/m5-first-look-2; 5f4cad34)
- 2026-11-20 - desk build dd799c62 installed and stamped
- 2026-11-20 - Mods, temperature and crash history as evidence; card polish (claude/m3-evidence, dd799c62)
- 2026-11-20 - Graphics-mod detector 33decacc
- 2026-11-20 - Desk build 3e69f454 installed and stamped
- 2026-11-20 - "Did it get better?" recovery check and a card that fits on Home 3e69f454
- 2026-11-20 — A session ends when its game exits; a new game starts a new session (no more two games in one record) bb47b314, review fixes b8e729ac
- 2026-11-20 - fix(history): the change history keeps a verified backup copy and restores from it when the main file is missing or damaged (claude/m1-hist-bak, reviewed)
- 2026-11-20 — Desk build 808a95ce installed and stamped 920f6bca
- 2026-11-20 — Readers wired into the diagnosis 808a95ce
- 2026-11-20 — Dated change readers (driver installs, Windows updates, Steam game updates, installed programs) c99d4b4d
- 2026-11-20 — Paramedic F1: "Something's wrong" card and engine f2fc65b6
- 2026-11-20 — History and Machine pages no longer re-read hardware per ledger row 74de779d
- 2026-11-20 — Pre-push gate cut to user safety and correctness, about 2 min, 134 process guards removed 397cfe72
- 2026-11-20 — §38 recorded ca2989ef

## Session log (newest 10)
- 2026-11-20 afternoon session: landed 0cc3a30e, fec63809, cb8afffe, abbad9bc, b8f782d7 (each reviewed, each through the push check). Look-only check of 5f4cad34 on the owner's data ran (_train\view-1120d\report-2.md); the brand-new-user half did NOT run (owner came back to the PC). Affordance baseline re-recorded: the score ring's entries and the header button retired by the coordinator, reported to the owner, reversible.
- 2026-11-20 desk-install session 3: built and installed main 5f4cad34, proved at runtime, stamped in RELEASE_STATE; look-only checks of the Home card (real data and new-user sandbox) in _train\view-1120d.
- 2026-11-20 desk-install session 2: built and installed main dd799c62, proved at runtime, stamped in RELEASE_STATE; look-only check of the Home card in _train\view-1120c.
- 2026-11-20 desk-install session: built and installed main 3e69f454, proved at runtime, stamped in RELEASE_STATE; look-only check of the Home card in _train\view-1120b.
- 2026-11-20 docs session: QUEUE.md and a short CLAUDE.md written; WORK_TRAIN.md points here.
