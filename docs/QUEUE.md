# QUEUE — the one work list (PRODUCT_CONSTITUTION §38). Edit it in the same commit as the work.
One writer per scope: each item below runs on its own branch or worktree; do not touch another writer's scope.
Changes to privilege, rollback or measurement code get an independent review before they land.
No builds, tests or pushes while a game runs on the owner's PC (see CLAUDE.md for the check).
The push check can fail on a vitest 15 s timeout when several builds share the PC (one retry passed; not a code failure). A push is confirmed only by the "main -> main" line.

## NOW (in flight, each on its own branch)
- Nothing building. Desk build on the owner's PC: fc01eff9 (installed and runtime-proved 2026-11-21)
- Parked: claude/m1-hard-1 d04c81e9 (rebased onto main today, 2,796 Rust tests green, every tool spawn covered; confirmed real on the installed build: a program planted in Compy's per-user install folder is run, twice with administrator rights; owner brief `_train\m1-owner-brief.md`; lands only on the owner's words "land the security slice")
- Parked: claude/d1s1-capture 10b3bcea, behind claude/m1-hard-1

## NEXT (in order)
- [ ] Land the security slice (claude/m1-hard-1) when the owner says "land the security slice"
- [ ] Per-machine install: the per-user install folder itself is user-writable
- [ ] Owner capture checks (`_train\g3-owner-capture-checks.md`)
- [ ] Capture slice 2
- [ ] Clear my data screen
- [ ] Consumer panel follow-up
- [ ] Handles audit S5: the direct query-only opens of the game (fps.rs ~520/~643, monitoring.rs ~896)
- [ ] Remove or rewrite the #[ignore] test in running_at_start.rs (~1180) that opens every process
- [ ] Paramedic card: drift evidence lines name the setting (driftApplied/driftOther)
- [ ] One vocabulary for how sure Compy is, slice 1 = types only (design `_train\d3-vocabulary-design.md`): Problems room says Weak/Partial/Strong signal, the card Possible/Likely, tiles Known/Likely/Unknown; a lowest-level pattern shows "Unknown" beside an observation; SessionDebrief says "Prime suspect"
- [ ] Clear my data in Settings, slice 2 (design `_train\d4-clear-data-design.md`) — must not strand applied changes without an undo
- [ ] Capture slice 2 (design `_train\d1-capture-design.md`): ask "Measure this session?" when a game starts. The one-time group grant itself waits for the owner (it changes a security group on the account)
- [ ] PRIVACY.md additions (`_train\d4i-privacy-additions.md`, `_train\d1s1-privacy-line.txt`)
- [ ] tauri.conf.json description drops "safe"
- [ ] Export follow-ups: one stock power-plan GUID table; apostrophe and 8.3 path cases; number the ledger ids
- [ ] Backend incident headline tail and values reach the screen as raw English (zh-CN users see English): move to i18n
- [ ] Self-delimiting stamp marker for verify-release-state
- [ ] Problems room follow-ups: the heading "What this points to" sits above a "can't tell" sentence; "Did this help?" answers match by rule only; a time limit on the Event Log reader; the fixed 85°C line is never compared with this card's sessions that did not crash; thermal-trend patterns reach Medium on an unmeasured "well past normal variation"
- [ ] Card: opening it pushes the lower half of Home below the fold; the questions view has no "More below" cue; Escape from a disclosure
- [ ] The app says three things about what leaves the PC (site: "sends nothing"; site: "checks GitHub"; app footer: "signed update check only"): one true sentence in the app; the site is the owner's
- [ ] Layer 2 design is written and parked (`_train\d2-layer2-design.md`); not before Layer 1 ships
- [ ] first look: drift notices ('turned off outside Compy') and changes undone inside the window
- [ ] first look S6-S7 (start measuring + one-session statement; local store for answers)
- [ ] Group a crash-and-relaunch into one sitting for baselines, noise bands and real-play counts — a crash and relaunch no longer counts as two independent sessions
- [ ] Paramedic: sessions flagged Suspected (`session_boundary::suspected_splice`) are not judged; a note says why — an old two-game row never poisons a diagnosis
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
- [ ] verify the NVIDIA / AMD overlay and Game Bar image names on real installs

## LATER
- [ ] Layer 2: game-specific known issues for the user's game, hardware and driver
- [ ] Layer 3: the Tuning Bay — per-setting Trials on a repeatable workload; BIOS and overclock walkthroughs by hardware
- [ ] Unprompted "this session ran rough" notice — stays off until the rule is validated on other PCs
- [ ] Remaining diet steps — agent machinery removal (needs the owner's yes for the project settings file); docs archive

## Waiting on the owner
- Decide: the tier name "starter" (the app now says "N starter tweaks ready", "Starter stack", "Apply all starter fixes").
- Decide: the Test bench rule for "Likely better" (two agreeing comparisons).
- Decide: should Home count an unapplied optional tweak as "worth a look"?
- Privacy questions and the lawyer list (`_train\t2-privacy-for-owner-and-lawyer.md`).
- Site copy differences (`_train\t2-site-privacy-diff.md`, `_train\c3-site-claims.md`).
- Say "land the security slice" (claude/m1-hard-1).
- Leave the PC idle for a few minutes so the install and look-only checks can run (blocked 2026-11-21: input every few seconds).
- Website lines that make the same game and anti-cheat claims, with suggested wording in `_train\c3-site-claims.md` (the EULA line needs a lawyer).
- ROB RUN driver-rollback test: four rough sessions in a row since the Nov 19 driver update; cause not settled.
- Start the code-signing identity check now (memo `_train\r1-signing-memo.md`: lead time up to 30 business days; individuals in the US or Canada).
- Decide: is 2026-12-11 a free invite-only beta rather than a paid launch (business memo `_train\m2-business-memo.md`; roadmap "Date risk": the date does not fit serially)?
- Decide: pricing. The memo proposes a free Paramedic with a one-time Pro; the 2026-08-22 ruling was a subscription; the panel accepted only a one-time price (project doc `claude/CONSUMER_PANEL_2026-11-20.md`).
- Decide: may Compy offer a one-time grant that adds the account to "Performance Log Users" so games are measured with no prompt (design `_train\d1-capture-design.md`)? To prove slice 1 he adds his own account by hand and plays one session.
- The website (his to publish): no download link; Game Mode is "no gain" in one place and "Real" in another; module names the app no longer uses; legal pages marked DRAFT; two different statements of what leaves the PC.
- Keep or restore the score ring; keep or reword the Home heading "N things are worth a look"; keep or reword "Something's wrong" as the main button (three of five panel personas: "I didn't say anything was wrong").
- Legal drafts for a lawyer (in progress): `_train\legal-drafts\`.
- One ordinary ROB RUN session with nothing else running (Compy now records background load).
- US/Canada eligibility and identity for code signing.
- 3-5 outside testers.
- A VM or 15 minutes for a real UAC-prompt test.
- Yes or no on editing the project's `.claude/settings.json` in the diet.
- Publish the privacy page wording for the history backup with the release (site/privacy.html; docs/PRIVACY.md already has it).
- ARCHITECTURE_LOCKS line for the ledger backup (proposed text in _train\b1-review-r1.md).
- Coordinator defaults the owner may overturn: ship date Friday 2026-12-11; v1 ships only the admin fixes the Paramedic needs; install to Program Files; no use of the word "guarantee"; a strength above the lowest needs two independent supports and no contradicting evidence (in the Paramedic's code and now the Problems room's; not yet written in the constitution); the full health check shows no score ring (removed 2026-11-20, one revert restores it).

## Done (newest first)
- 2026-11-21 - desk build fc01eff9 installed and stamped (installed over 0c4057c7)
- 2026-11-21 - The app no longer calls changes or itself "safe": the "starter" tier is named, the mechanism is stated instead of promises; guard src/i18n/safe-promise-claims.test.ts fc01eff9, 8937664f
- 2026-11-21 - Seconds Compy could not measure are counted from the helper's own counter, shown live, stored per session and excluded from the numbers; a mostly-unread session is not graded or compared anywhere 7c55c0c9, fd0cdc1d
- 2026-11-21 - Planted-tool and powercfg tests can no longer skip or hang 7bb265a0, 93f23905
- 2026-11-21 - Paramedic card: one earliest change that names Compy's own changes; the Windows Update line says only what its record shows; memory evidence scoped per session; Escape closes the card 9ab15eec, c2ce8e16
- 2026-11-21 - Problems room focus and count line, health-check count, the last "Likely" words; Test bench words follow the data 9d1472fa
- 2026-11-21 - Clear my data wiring prerequisites (commands still unregistered) a30ae21f
- 2026-11-21 - desk build 0c4057c7 installed and stamped (installed over a0cfaca3)
- 2026-11-21 - Screen fixes from the real-app check: Problems room groups folded by default, with a line for the group holding the marked record; Home says only what was read; one memory formatter; History wording; Monitor driver/overlay lines f07ca7f0..0c4057c7
- 2026-11-21 - PRIVACY.md v0.7 checked against code, and the installer description 5c22778a, 3c7149b5, 21884dd8, 7686ff53
- 2026-11-21 - Paramedic card truth fixes: the first look reads the sessions; the drifted setting is named with its two times; "already running" lines are scoped; memory shown as usable ca866354, f0f49c71
- 2026-11-21 - Compy opens no process by id (guard, empty allowlist) 8ecdb512, 5315c3e7
- 2026-11-21 - desk build a0cfaca3 installed and stamped (installed over 4115e40e; `history.json.bak` is now written at start-up)
- 2026-11-21 - Handles audit S1-S4: every remaining sysinfo all-process listing replaced by the handle-free snapshot, with a permanent guard (claude/g2-handles) df8d5d7d, e59541f7
- 2026-11-21 - Drift: the Home line and the Check screen name the setting, what it is now, and what Compy last recorded and when; review fixes say only what the ledger and the check know (claude/n1-drift) 7709f7a2, a816b545
- 2026-11-21 - Clear my data: core landed (inventory-driven plan and executor; reads the Trial store without moving it, keeps its set-asides); its commands are unregistered, so nothing shows in the app yet 26e2dad5, 40cfe1c2
- 2026-11-21 - Vocabulary slice 1: source and strength types, first caller, branded top strength (no screen change beyond the top strength) 7c446a8f, 227026b5
- 2026-11-21 - In-app game claims corrected: "Never touches your games" and "Safe with anti-cheat" replaced by what the code proves (glossary, export report, Leftovers and tweaks text too); permanent guard src/i18n/game-safety-claims.test.ts scans locale files, src/data and Rust strings c4a5b168, 4b2c13d6, e63c482c
- 2026-11-21 - Export report redaction: other programs' names, Windows user and computer names (whole word), custom power plan names and paths; PRIVACY.md paragraph rewritten; two privacy review rounds 64f63c87
- 2026-11-21 - Problems room shows identical crash records as one group ("...N times in the Windows records Compy read...", limit note on every group, "Show each one") 17a688d3, c0257d8c
- 2026-11-21 - First look: "Running right now" from a handle-free process list; crash records split before and after the earliest change adfd664c
- 2026-11-21 - RELEASE_STATE citations re-anchored 965eb473
- 2026-11-21 - Inventory of everything Compy stores, plus a guard that keeps it complete 3870b609, d3126dd0
- 2026-11-21 - Power plan flagged only when it is Windows "Power saver" b0f0f439, a8954500
- 2026-11-21 - Orphan-key and affordance guards moved into the push check fce1ef2d
- 2026-11-21 - SAFETY: hardware sweep no longer reads other processes' memory at start-up (ARCHITECTURE_LOCKS game-memory rule) 73b1fbe8, 755a94d9
- 2026-11-20 - Roadmap rewritten around the Paramedic, with an honest date-risk section (docs/product/ROADMAP.md)
- 2026-11-20 - Card wording: a suspect title no longer asserts what was only seen in other sessions; "How to test this" under a Possible suspect; no "Check again" before an answer; focus stays in the card efc96dea
- 2026-11-20 - Cross-game pattern lines and Home interview lines no longer rule out the PC or add to what the user said; a single comparison shows at the lowest level; home.json is in the wording scan 478f8d42
- 2026-11-20 - The change history's backup is written at start-up when none exists 888d8f6d
- 2026-11-20 - desk build 4115e40e installed and stamped a7e819e7; look-only checks as a brand-new user and on the owner's data (_train\view-1120e\report.md)
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
- 2026-11-21 desk-install session 7: built and installed main fc01eff9 over 0c4057c7, proved at runtime, stamped in RELEASE_STATE; look-only re-check in _train\view-1121d.
- 2026-11-21 desk-install session 6: built and installed main 0c4057c7 over a0cfaca3, proved at runtime, stamped in RELEASE_STATE; look-only re-check in _train\view-1121c.
- 2026-11-21 desk-install session 5: built and installed main a0cfaca3 over 4115e40e, proved at runtime, stamped in RELEASE_STATE; look-only checks in _train\view-1121b.
- 2026-11-21 session: landed the game-claims correction, export redaction, grouped crash records, first-look running-now, power-plan and hardware-sweep safety fixes (listed under Done; each reviewed, each through the push check). Install of current main and look-only checks blocked at 06:00 PT (PC not idle); installed build is still 4115e40e. g2-handles and n1-drift in review; d1s1-capture parked.
- 2026-11-20 desk-install session 4: built and installed main 4115e40e, proved at runtime, stamped in RELEASE_STATE; look-only checks (new-user sandbox, then real data) in _train\view-1120e.
- 2026-11-20 afternoon session: landed 0cc3a30e, fec63809, cb8afffe, abbad9bc, b8f782d7 (each reviewed, each through the push check). Look-only check of 5f4cad34 on the owner's data ran (_train\view-1120d\report-2.md); the brand-new-user half did NOT run (owner came back to the PC). Affordance baseline re-recorded: the score ring's entries and the header button retired by the coordinator, reported to the owner, reversible.
- 2026-11-20 desk-install session 3: built and installed main 5f4cad34, proved at runtime, stamped in RELEASE_STATE; look-only checks of the Home card (real data and new-user sandbox) in _train\view-1120d.
- 2026-11-20 desk-install session 2: built and installed main dd799c62, proved at runtime, stamped in RELEASE_STATE; look-only check of the Home card in _train\view-1120c.
- 2026-11-20 desk-install session: built and installed main 3e69f454, proved at runtime, stamped in RELEASE_STATE; look-only check of the Home card in _train\view-1120b.
- 2026-11-20 docs session: QUEUE.md and a short CLAUDE.md written; WORK_TRAIN.md points here.
