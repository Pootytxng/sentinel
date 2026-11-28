# QUEUE — the one work list (PRODUCT_CONSTITUTION §38). Edit it in the same commit as the work.
One writer per scope: each item below runs on its own branch or worktree; do not touch another writer's scope.
Changes to privilege, rollback or measurement code get an independent review before they land.
No builds, tests or pushes while a game runs on the owner's PC (see CLAUDE.md for the check).
The push check can fail on a vitest 15 s timeout when several builds share the PC (one retry passed; not a code failure). On 2026-11-28 it hit `ExperimentBench.test.tsx` three times, each on a worktree's first push while the gate also built Rust from cold; moving that file's `await import()`s did not help (branch `claude/e4-bench-test-timeout`, not landed). Before a new worktree's first push, build Rust there first (`cargo test --no-run --manifest-path src-tauri/Cargo.toml`). A push is confirmed only by the "main -> main" line.

## Owner ruling 2026-11-26 (supersedes earlier commercial proposals)
- Compy must work without the owner's labour. No paid sessions or service.
- Spending authorized: $0. The $1,000 remains whole.
- 2026-12-11 is not a v1.0 or paid launch.
- Next release: a free invite-only tester build, unsigned, through the existing release transaction, on the owner's explicit publish GO. The 2026-12-07 tester-build target is conditional.
- Steam, pricing, payments and signing are undecided and unscheduled.
- No new governance or coordination documents.
- The owner names 5-10 testers by 2026-12-01, including one NVIDIA, one Intel or laptop PC and two non-enthusiasts.
- Sequence: Phase 1 exit; tester build; watch-only first sessions; a week of ordinary play per ROADMAP Phase 5; review on 2026-12-22.
- Pass: 6 of 10 independently accepted answers AND Phase 5 on 3 or more outside PCs including a non-AMD GPU. 3-5 of 10: fix the top three points where a human had to step in, and rerun. Under 3 of 10: stop.

## NOW (in flight, each on its own branch)
- Desk build on the owner's PC: ec5bae0e (installed and runtime-proved 2026-11-22)

## NEXT (in order)
Phase 1 exit first (owner ruling 2026-11-26; `docs/product/ROADMAP.md` Phase 1). Already met and not re-queued: first look S4 and S5 (adfd664c); `home.json` in the wording scan (478f8d42); no "Check again" before an answer and the Re-run band wording (both under Done, 2026-11-20).
- [x] First-run and empty states for a new user — a new PC gets a clear first screen, not blank cards (e1, `claude/e1-first-run-empty-states`; read from the code, not yet seen on an installed build). Home was already clear on a fresh data root (`_train\view-1120e\report.md` B1). Fixed: with capture off, Live's "This session" tile says what fills its four dashes; Problems' "no session yet" lines (stutter compare, Since it last worked) get an Open Live button; Test's Proven tile at 0 says "nothing proved yet" instead of "measured" (both faces). Review r1 (`_train\e1-review-r1.md`) F1 and F2 fixed before landing. Reading Games, Problems, Live, Blackbook, Test and Optimize found no blank card (the classic Learn tree and Check's inner states were not read)
- [ ] First-run follow-ups, found by reading, not fixed in e1 (e2, `claude/e2-loading-not-nothing`, fixed three more: Optimize before its list is read, Applied & history before or after a failed ledger read, Live's sensor cells before the first poll; reviews `_train\e2ld-review-r1.md`; e3, `claude/e3-first-run-rest`, fixed three more: Games, Live and Sessions no longer say "no sessions yet" before or after a failed sessions read, the Blackbook empty tape offers Open Live, Live's GPU coverage line is in en + zh-CN): Test's Noise floor on a new PC is a bare "not yet" (which reads give a figure and what the user must do is not traced: trial calibration, `get_latest_comparison`, per-game `assumed_band`; several games measured or too varied also give null, review r1 F2); Open Live lands on Home when the hardware read is missing (App `activeTab === "Play" && hw`; the Games room's button too, review r1 F3) (e3: left, because it does not happen: while `hw` is null App renders no rooms at all, only its own "Reading your hardware…" screen, or "Couldn't read your hardware just now" with Try again, and once read `hw` is never cleared, so an Open Live button is only on screen when Live can render); the Test bench's "Nothing worth testing on this PC right now" may show on a PC with no measured noise (e3: left, because measured noise does not decide it: `trial_candidates.rs` `screen` leaves a change out for noise only when the catalog states its effect and the band is measured, no change states one, and an unmeasured band keeps a change in; the line shows only when every change failed another filter, each listed under "Show why others aren't listed"); HomeRoom and the Lab (both also get `sessions`) were not audited for "none" lines; the tape with other records but an unread session list leaves the sessions out without saying so; when the session re-read lands, priorities are not re-ranked (App's refresh skips `priorities_from` while any of its four reads failed, and the retry only sets the list), so Home's ranking stays as it was until the next refresh (review of `claude/modest-hawking-ztqibr`; the gap was there before the retry). Fixed on `claude/modest-hawking-ztqibr` (cloud, PR; read from the code and tests, not seen on an installed build): HomeGlass's "No games yet" card and Last session tile ("Not read yet" / "Couldn't read") and the Blackbook's empty tape and Sessions tile ("—", "not read yet" / "couldn't read") take App's session read state; a failed session read is re-read on the ledger's backoff (`useListReadRetry`, which `useLedgerReadRetry` now calls; e3 review r1 F3)
- [ ] One vocabulary for how sure Compy is (design `_train\d3-vocabulary-design.md`): slices 1-3 are on main (7c446a8f, 68010f6f, 9c450762; tests 3df789e5, 6d172e08). e5a (`claude/e5a-vocabulary-words`) changed the words still on screens: the Problems room's strength tag is the shared "Possible" / 有可能 for every band, sentence case (was Strong/Partial/Weak signal in capitals; `gaming.blackBox.strengthLabel.*` removed as orphans with their census entries); the Changed-before rows, the Since-it-last-worked list and the stutter compare's section head and cause headings keep their caveat as "Not shown to be the cause" / 未证实是原因 (was "not proven cause", and "listed by time, not proven cause" for Since it last worked; the design's row "Listed by when it happened" was not true for the Changed-before rows, which are in a fixed category order, nor for ranked causes, and dropped the only caveat in view for Changed-before and Since it last worked, review r1 F1-F2: e5b's scan must keep a caveat in these places and in `gaming.blackBox.stutter.compared`, which still says "proven"); the assessment box's emphasis follows the mapped strength; the Live debrief's improved line says "a real difference here, though it may not hold for every game or session" (was "a real signal, not a guarantee"); the Live debrief says "Worth a look first:", "Check the next one:", "One thing ruled out:" (was Prime suspect, Chase suspect #2, One suspect cleared); What changed's picker says "Compare (rough session)". None of it on an installed build yet. e5b (`claude/e5b-vocabulary-scan`): the strict retired-word scan is in `src/data/confidence-word.test.ts` (every locale value, plus "confidence" in JSX text; three keys allowed by name, each with its reason and each must still hold a retired word: the oscilloscope's "no signal", Hardware's identity "Unknown", the jitter value 未知); `common.confidenceWord.*` is deleted, so the tiles and chips say "Read from your PC" / "Not measured on your PC" / "Not enough to say yet" (was Known / Expected / Unknown; "Measured N times" is `common.measuredTimes`); reworded: What changed's expert row ("Strongest it can be" + Possible / Not enough to say yet, was "Confidence capped at" + Unknown/Low/Medium/High), the provenance chip ("Not measured on your PC", was Expected), Test's Proven tile on both faces ("Measured wins" / 实测提升, notes "measured before and after" / 前后都实测过 and "no measured wins yet" / 还没有实测提升, no unit word: a win is a bench test result and the bench then tries to roll the change back, `benchmark_trial.rs` ~413-422, so nothing says kept; the award is written before that rollback, which can fail, so nothing says put back either; `lab.labConsole.unitKept` retired; review r1 F1, r2 N1-N2), the simulator's "Might help — weak support" / 可能有帮助——依据较弱 (was "Plausible — unproven"; the producer knows only a low expected impact, not whether a test ran, review r1 F4), the Trial receipt's "Verdict level, as recorded" (was Confidence), the benchmark's "95% interval for the change in the median" / 中位数变化的 95% 区间 (was 95% CI / confidence interval; it is a bootstrap interval on the change in the median, `benchmark_verdict.rs` ~9, not a spread of runs, review r1 F2), the "N tweaks not applied" row shows no source word (review r1 F3, see below), the stutter compare's "compared" line ("none of it is shown to be the cause" / 未证实是原因), the interview's FPS sentences ("can't tell yet whether they help", was "expected, not proven"); census entries re-recorded. Not on an installed build. Left: `common.confidenceHint.*` stays, because ConfidenceWord, BenchWord and the Home interview still render it as tooltips (its "likely" hint reworded); sentences that open "Unknown:" (`gaming.blackBox.changedBefore.unknown.*`, `lab.experimentBench.journey.realPlay.unknown*`), the real-play faces "Likely better/worse" and "Unknown — restored", and the simulator's "Unknown — measure it to find out" are not whole-value tags, so the scan does not catch them and the design does not map them; the debrief's "Check the next one: {{name}}" button only dismisses the card (pre-existing, review r1 F6), and "One thing ruled out: your dips aren't {{title}}" rests on one before/after pair (design question, F7); the caveat tag shows on the stutter section's head and on Since it last worked's head even when nothing is listed under them, and the stutter head's tag repeats the "compared" line's caveat (e5a review r2 S1); the zh-CN strings want a native read (design §4); backend, not fixed: "N tweaks not applied" (`priorities.rs` `pending-safe-recs`, ~697 `currently_applied ... unwrap_or(false)`) counts a tweak whose state Compy couldn't read (`state_unread` / `live_read_unread`) as not applied (e5b review r1 F3; the frontend only dropped the word); What changed's expert ceiling now reads Possible for both a high and a medium band (design question 2; r1 F7); owner: the site's Real chip titles still say "well-proven" (`site/*.html`; the app now says "well-documented"), and the Welcome tagline "measured, never guessed" and its "Measured" pill (`home.compyHero.*`, design question 3)
- [x] Paramedic card: drift evidence lines name the setting (driftApplied/driftOther): already on main in ca866354 and f0f49c71 (`driftLine` in ParamedicCard.tsx names it from the same live drift list Home uses, and says the general line only when that list isn't loaded, has no title, can't be read now, or holds a different notice). e6 (`claude/e6-drift-lines-name-setting`) fixed the several-titles sentence: "settings Compy applied are no longer on" (was "a setting it applied was no longer on"), and zh-CN says 设置, not 某项设置, because zh-CN has one plural form for one title and several
- [ ] first look: drift notices and changes undone inside the window. Done (e6, same branch, from data the card already has): "Settings Compy applied that are off now" gives one row per notice flagged inside the window: the notice's two times once (the last check that could read its settings and flagged none off, and the first that flagged one: a setting kept as set outside Compy is off but never flagged), then the titles off now with no time each, "though Compy's history still lists it as applied" (its newest record; an older undo of the same setting can be listed above). A notice whose last unflagged check is before the window is not listed as a change, by the same rule the diagnosis uses for its own window (`paramedic.rs` `ambiguous`); one line says when it changed isn't known. Changes Compy made before the window and undone inside it join "Changes Compy made" (from the ledger list), never twice. Both groups carry "Not shown to be the cause". Not "turned off outside Compy" (the Paramedic strings keep that claim out, f2fc65b6). Left: (1) backend: the drift list the card reads (`Drift`, `drift.rs`) has no time per title, so a title that went off later on a standing notice can't be given its own time or window; drift.json state keeps one per title (`drift.rs` ~341-350), but the engine sends it only for a notice that has read ready again (`seen`, `paramedic.rs` ~3209-3216); (2) a notice that has since closed (the setting back on) is only in drift.json, so the first look can't list it; (3) "Compy found no dated change in this period" can show before the ledger list or the drift list has loaded; (4) the first look's "check that could read its settings" rests on the engine calling a scan Ready, and `readiness.rs` ~1006-1016 also calls a partly read scan Ready, so the words can overstate until that is split (backend; e6 review r4)
- [ ] Problems room follow-ups: the heading "What this points to" sits above a "can't tell" sentence; "Did this help?" answers match by rule only; a time limit on the Event Log reader; the fixed 85°C line is never compared with this card's sessions that did not crash; thermal-trend patterns reach Medium on an unmeasured "well past normal variation"
- [ ] Card: opening it pushes the lower half of Home below the fold; the questions view has no "More below" cue; Escape from a disclosure
- [ ] The app says three things about what leaves the PC (site: "sends nothing"; site: "checks GitHub"; app footer: "signed update check only"): one true sentence in the app; the site is the owner's
- [x] tauri.conf.json description drops "safe" (checked 2026-11-27 at 833cbe64: neither description holds the word)
- [ ] Phase 1 exit check: install current main on the desk (ec5bae0e predates the d10-d12, D6, b13 and a10 landings), then the look-only run as a brand-new user; the Home headline decision is under "Waiting on the owner"
Then, in this order (owner ruling 2026-11-26):
- [ ] Tester build: free, invite-only, unsigned, through the existing release transaction (`docs/RELEASE_TRANSACTION.md`), on the owner's explicit publish GO. Target 2026-12-07, conditional on the Phase 1 exit
- [ ] Watch-only first sessions with the named testers: every point where a human had to step in is written down
- [ ] A week of ordinary play on each tester PC (ROADMAP Phase 5)
- [ ] 2026-12-22 review against the pass rule in the owner ruling
Rest of NEXT (order unchanged):
- [ ] Per-machine install: the per-user install folder itself is user-writable
- [ ] Owner capture checks (`_train\g3-owner-capture-checks.md`)
- [ ] Capture slice 2
- [ ] Consumer panel follow-up
- [ ] Handles audit S5: the direct query-only opens of the game (fps.rs ~520/~643, monitoring.rs ~896)
- [ ] Remove or rewrite the #[ignore] test in running_at_start.rs (~1180) that opens every process
- [ ] Capture slice 2 (design `_train\d1-capture-design.md`): ask "Measure this session?" when a game starts. The one-time group grant itself waits for the owner (it changes a security group on the account)
- [ ] PRIVACY.md additions (`_train\d4i-privacy-additions.md`, `_train\d1s1-privacy-line.txt`)
- [x] Crash-record headlines in the user's language (d10, `claude/d10-incident-headlines`): Rust sends a closed code plus values beside the English; Black Box rows, group lines, kind chips, "Since it last worked" and the Home Care card word it through i18n. A Care card stored before d10 shows its stored English in English and is worded from its kind tag in zh-CN (no game tail)
- [ ] The OS notification popup for a crash record is still English (incident_observer.rs `notify` → lib.rs `notify_care_incident`: English title, the card's English summary, English tail); Rust has no UI language today
- [ ] Self-delimiting stamp marker for verify-release-state
- [ ] Layer 2 design is written and parked (`_train\d2-layer2-design.md`); not before Layer 1 ships
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
- [ ] Signing, privacy policy and EULA — the installer is signed and the legal text is published
- [ ] verify the NVIDIA / AMD overlay and Game Bar image names on real installs

## LATER
- [ ] Layer 2: game-specific known issues for the user's game, hardware and driver
- [ ] Layer 3: the Tuning Bay — per-setting Trials on a repeatable workload; BIOS and overclock walkthroughs by hardware
- [ ] Unprompted "this session ran rough" notice — stays off until the rule is validated on other PCs
- [ ] Remaining diet steps — agent machinery removal (needs the owner's yes for the project settings file); docs archive
- [ ] Clear play history: a plain apply (Optimize, ledger lock only) can land just after the Trial-gate read, so Trial results may be deleted while that change is on; undo is unaffected. A report-only fix is in progress (branch claude/c4-apply-gap); the stronger fix needs the lock-order guard file and design 3.3 amended by the owner.

## Waiting on the owner
- Decide: the tier name "starter" (the app now says "N starter tweaks ready", "Starter stack", "Apply all starter fixes").
- Decide: the Test bench rule for "Likely better" (two agreeing comparisons).
- Decide: should Home count an unapplied optional tweak as "worth a look"?
- Decide: what the Home interview chip says for three findings (the health check, "I want more FPS", "always slow") whose chip reads "Measured" but rests on a setting check or a loaded list, not on play Compy measured: "Read from your PC", or no chip (`_train\d12-review-r1-unrun.md` F3).
- Privacy questions and the lawyer list (`_train\t2-privacy-for-owner-and-lawyer.md`).
- Site copy differences (`_train\t2-site-privacy-diff.md`, `_train\c3-site-claims.md`).
- Website lines that make the same game and anti-cheat claims, with suggested wording in `_train\c3-site-claims.md` (the EULA line needs a lawyer).
- ROB RUN driver-rollback test: four rough sessions in a row since the Nov 19 driver update; cause not settled.
- Code-signing identity check: not started. Signing is undecided and unscheduled (owner ruling 2026-11-26). Memo `_train\r1-signing-memo.md`: lead time up to 30 business days; individuals in the US or Canada.
- Decide: may Compy offer a one-time grant that adds the account to "Performance Log Users" so games are measured with no prompt (design `_train\d1-capture-design.md`)? To prove slice 1 he adds his own account by hand and plays one session.
- The website (his to publish): no download link; Game Mode is "no gain" in one place and "Real" in another; module names the app no longer uses; legal pages marked DRAFT; two different statements of what leaves the PC.
- Keep or restore the score ring; keep or reword the Home heading "N things are worth a look"; keep or reword "Something's wrong" as the main button (three of five panel personas: "I didn't say anything was wrong").
- Legal drafts for a lawyer (in progress): `_train\legal-drafts\`.
- One ordinary ROB RUN session with nothing else running (Compy now records background load).
- US/Canada eligibility and identity for code signing.
- Name 5-10 outside testers by 2026-12-01, including one NVIDIA, one Intel or laptop PC and two non-enthusiasts (owner ruling 2026-11-26).
- A VM (or 15 minutes) for the deletion tests ("Clear play history", "Clear everything"), the installer tests and a real UAC-prompt test.
- Yes or no on editing the project's `.claude/settings.json` in the diet.
- Publish the privacy page wording with the release: site/privacy.html lags docs/PRIVACY.md (the history backup, and now what "Clear play history" and "Clear everything" delete, keep and refuse).
- Decide: the lock-order guard edit (scripts/store-lock-order-guard.test.mjs) and design 3.3, needed for the stronger "Clear play history" apply-gap fix.
- Decide: per-user or per-machine install (brief `_train\a3-owner-brief.md`).
- Decide: the installer description's word "reversible" (state the mechanism instead).
- ARCHITECTURE_LOCKS line for the ledger backup (proposed text in _train\b1-review-r1.md).
- Coordinator defaults the owner may overturn: ship date: none set (owner ruling 2026-11-26: 2026-12-11 is not a v1.0 or paid launch; `docs/product/ROADMAP.md` still shows the old target); v1 ships only the admin fixes the Paramedic needs; install to Program Files; no use of the word "guarantee"; a strength above the lowest needs two independent supports and no contradicting evidence (in the Paramedic's code and now the Problems room's; not yet written in the constitution); the full health check shows no score ring (removed 2026-11-20, one revert restores it).

## Done (newest first)
- 2026-11-26 - Owner ruling recorded at the top of this file. Closed two owner questions: "is 2026-12-11 a free invite-only beta rather than a paid launch" (decided: not a v1.0 or paid launch; the next release is the free invite-only tester build) and "pricing" (deferred: undecided and unscheduled; `_train\m2-business-memo.md` and project doc `claude/CONSUMER_PANEL_2026-11-20.md` stay as references)
- 2026-11-22 - desk build ec5bae0e installed and stamped (installed over fc01eff9)
- 2026-11-22 - Security slice and follow-ups: system tools run by absolute path from the real system directory with a pinned child environment; logman with a cleared environment; elevation only for absolute, closed targets; the gaming tier refuses elevation when its receipts file cannot be cleared; where Compy runs from is recorded at each start b19b886c, 7ed20677, 4e8fee63, 8b492da8, 184b4fbf, eb1d26cd
- 2026-11-22 - Capture starts without an administrator prompt when this sign-in is already in Performance Log Users; the no-prompt line states the mechanism fe1102f9, 1fb8e983
- 2026-11-22 - Follow-through slice 1: the card keeps a setting that was read back on as a dated suspect; Home's quiet usual-range line; the card's "Measured once" f5d1c939, aab55dd3, cf501f32, 5f877746, a91b92be, 020756f8
- 2026-11-22 - Home truth: Home counts what is off-normal, never an unapplied tweak; a rough game is named with a date on every face; nothing measured is not "clean" 0ad9617d, 43010d11, 7bf2427b
- 2026-11-22 - "Turn it back on" in the Something's-wrong card, through the Lab's own path bdff3631
- 2026-11-22 - A recovery row "matches the timing" (or "Doesn't match the timing"), never "points to" d2e4739b, 9234c254
- 2026-11-22 - Driver follow-through in the card and "since the last check" lines (less read is never "unchanged"; a dropped row is "Not shown this time") 666c3545, 2a545b5f, 64bffc6a, 3dfe72d8, ec5bae0e
- 2026-11-22 - Export follow-ups: one stock power-plan GUID table, apostrophe and path-slash cases, numbered ledger ids, renamed plan copies, adapter names, generated word list 22318628, 4d9921ea, b4c313b9, 058017b3, 8c1c8667, 280ed067
- 2026-11-22 - Settings "Your data": "Clear play history" and "Clear everything" screens (plan first, per-file result, start-up finish of an interrupted clear, the frame-rate helper's leftover files named) 5432b01d, a217e934, 6b06891a, ff3f71dd, 4c7f377e, 7928c287, 4bc4b3bf; clear core f35b79ac, 8953f263
- 2026-11-22 - PRIVACY.md: what "Clear play history" and "Clear everything" delete, keep and refuse 42b20448, 1a3598d9, e86f3e07, d7bad0c6
- 2026-11-22 - Test hygiene: scratch folders no run can reuse, push-check guards stop repeating whole-tree work, bench pins state their property fbba142b, f8adaf26, c84dcc62, 85e554c3
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
- 2026-11-27 queue session (docs/QUEUE.md only): recorded the owner ruling of 2026-11-26, moved the Phase 1 exit items to the top of NEXT after checking them against main 833cbe64, closed the 2026-12-11 and pricing questions. No code, no build, no other file.
- 2026-11-22 desk-install session 8: built and installed main ec5bae0e over fc01eff9, proved at runtime, stamped in RELEASE_STATE; look-only re-check in _train\view-1122a.
- 2026-11-21 desk-install session 7: built and installed main fc01eff9 over 0c4057c7, proved at runtime, stamped in RELEASE_STATE; look-only re-check in _train\view-1121d.
- 2026-11-21 desk-install session 6: built and installed main 0c4057c7 over a0cfaca3, proved at runtime, stamped in RELEASE_STATE; look-only re-check in _train\view-1121c.
- 2026-11-21 desk-install session 5: built and installed main a0cfaca3 over 4115e40e, proved at runtime, stamped in RELEASE_STATE; look-only checks in _train\view-1121b.
- 2026-11-21 session: landed the game-claims correction, export redaction, grouped crash records, first-look running-now, power-plan and hardware-sweep safety fixes (listed under Done; each reviewed, each through the push check). Install of current main and look-only checks blocked at 06:00 PT (PC not idle); installed build is still 4115e40e. g2-handles and n1-drift in review; d1s1-capture parked.
- 2026-11-20 desk-install session 4: built and installed main 4115e40e, proved at runtime, stamped in RELEASE_STATE; look-only checks (new-user sandbox, then real data) in _train\view-1120e.
- 2026-11-20 afternoon session: landed 0cc3a30e, fec63809, cb8afffe, abbad9bc, b8f782d7 (each reviewed, each through the push check). Look-only check of 5f4cad34 on the owner's data ran (_train\view-1120d\report-2.md); the brand-new-user half did NOT run (owner came back to the PC). Affordance baseline re-recorded: the score ring's entries and the header button retired by the coordinator, reported to the owner, reversible.
- 2026-11-20 desk-install session 3: built and installed main 5f4cad34, proved at runtime, stamped in RELEASE_STATE; look-only checks of the Home card (real data and new-user sandbox) in _train\view-1120d.
- 2026-11-20 desk-install session 2: built and installed main dd799c62, proved at runtime, stamped in RELEASE_STATE; look-only check of the Home card in _train\view-1120c.
