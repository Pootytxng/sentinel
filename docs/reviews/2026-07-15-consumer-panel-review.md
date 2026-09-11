# Consumer Panel Review — 2026-07-15 (owner-authored)

> **PRODUCT DIRECTION SUPERSEDED 2026-09-04 (#369).** This verbatim panel record remains historical
> research and owner-context evidence, but its product hierarchy, priorities, names, monetization,
> and execution instructions are not current authority. Current direction comes from
> `docs/PRODUCT_CONSTITUTION.md`; current sequence comes from its derived roadmap.

> **Provenance.** Written by the owner (Kuya), delivered to Cowork verbatim on 2026-07-15 as a
> single complete document (12 consumer/stakeholder personas + panel-wide findings + 12 original
> recommendations + a revised consumer hierarchy + final verdict). Archived here **verbatim, in
> full, unedited** so nothing in it is ever lost or paraphrased away — this file is the source of
> truth for the review's content. Triage, fact-checking, and execution tracking live elsewhere
> (see the pointer at the bottom of this file); this file itself should not be edited except to
> fix a transcription error.
>
> **Cowork fact-check pass (2026-07-15, same day):** 7 of 7 checkable factual claims in this
> review were verified against the live repo and confirmed accurate (installer version 0.1.0,
> site "free forever"/"zero outbound" copy, 4-item nav rail, 6 Lab stations, NVIDIA
> not-yet-hardware-verified status, 196-URL sitemap, RELEASE_STATE gate lines). The one named
> problem — `COMPY_OVERVIEW.md` being stale — was confirmed **worse** than the review states (also
> predates the 2026-07-15 site launch and `MONETIZATION_PLAN.md`). Two owner decisions the review
> surfaced as open forks were resolved same day: flagship naming → **"Optimization Cleanup"**
> (not "Tweak Damage Audit" or "Paramedic Mode"); the "free forever" site promise → **scope it now**
> to "core stays free forever" language rather than the current absolute claim.
>
> **Owner-facing execution brief:** the triage of every item below into `BACKLOG.md` /
> `OWNER_ACTION_CHECKLIST.md` / `UI_VISION_BACKLOG.md`, plus the actual doc/copy fixes, is handed to
> Claude Code as its own prompt (delivered alongside this archive) rather than hand-merged from
> Cowork — this repo's planning docs are live, tooled, and mid-flight, and CC has the doc-sync /
> gate-drift-audit skills built for exactly this reconciliation.

---

## 1. Non-technical competitive gamer

Profile

* Plays Valorant, Apex, Marvel Rivals, Fortnite, Call of Duty, or similar titles.
* Understands FPS and perhaps 1% lows.
* Does not confidently understand Windows services, power plans, registry settings, or ETW.
* Has searched YouTube for optimization guides.

Likely first reaction
High visual interest, moderate initial comprehension.
The current Home console, real rig hologram, gauges, Monitor flight deck, and Lab proving-ground design give Compy significantly more perceived product value than the earlier dashboard. Home now uses the detected rig as the center of the interface, while Monitor presents live telemetry and session records through an instrument-console structure.

This user will understand:

* "That is my PC."
* "These are my gaming numbers."
* "This app can change settings."
* "It can put them back."

They may not immediately understand:

* why the Lab has multiple stations
* what qualifies as proof
* the difference between a live session and a controlled benchmark
* why a result can be inconclusive
* why some values say "not yet"

Strongest appeal
The strongest promise is no longer generic optimization. It is:
Compy will show me what is happening on my rig and tell me whether its changes actually helped.
The Lab now combines safe-stack application, diagnostics, benchmarking, latency testing, tuning, and crash analysis in one proving ground.

Main criticism
The app may now look more sophisticated than the target user feels.
The current visual language is intentionally operator-console/JARVIS-like. That differentiates it from generic utility software, but it risks creating the impression that the user must understand every gauge and station.

Recommended action
Keep Basic mode aggressively simple:

1. One current verdict.
2. One recommended action.
3. One visible explanation of what will change.
4. One visible explanation of how it is restored.
5. One next step after playing.

Advanced instrumentation should reward exploration rather than being required for completion.

Panel verdict
Primary consumer audience. Strong fit.

## 2. Burned optimization-guide user

Profile

* Has used registry scripts, debloat packs, optimizer apps, or YouTube commands.
* May have disabled services without understanding them.
* Has experienced instability, broken functionality, or no measurable improvement.
* Does not remember everything that was changed.

Likely first reaction
Very high interest.
This remains Compy's strongest emotional audience. The product's rollback system, Blackbook, refused-tweak explanations, and measurement workflow directly address their prior experience.

The current Blackbook is stronger than the old library. It combines the user's actual changes, gaming sessions, and guide fact-checks in a reverse-chronological logbook while preserving the field-guide content.

Strongest appeal

* "Tell me which advice was real."
* "Tell me what I changed."
* "Tell me what can be safely undone."
* "Stop me from making the same mistake twice."

Main criticism
Compy can completely guarantee rollback only for changes it recorded itself. It cannot safely claim that every unknown third-party modification can be restored automatically.
The source correctly distinguishes settings that are active but lack a Compy rollback record. In that case, the interface refuses to turn them off and tells the user to use the original Windows location.

Recommended action
Build Tweak Damage Audit as a flagship read-only product surface:

* identify known tweak-pack artifacts
* classify them as useful, placebo, risky, outdated, or unknown
* show the normal documented Windows state
* explain confidence and evidence
* only offer automatic restoration where the prior or correct state is unambiguous
* create a separate recovery snapshot before any remediation

Do not call it "Paramedic Mode" publicly unless testing proves users understand it. "Tweak Damage Audit" or "Optimization Cleanup" is clearer.

Panel verdict
Highest-pain and potentially highest-converting audience.

## 3. Mainstream gamer who distrusts optimizer software

Profile

* Has seen registry cleaners, game boosters, driver updaters, scareware, and fake FPS claims.
* Assumes a new optimizer is probably bloatware.
* Does not care how technically sophisticated the internals are.
* Notices SmartScreen and UAC warnings immediately.

Likely first reaction
Suspicion first, interest second.
The site currently addresses this well through:

* real recorded session data
* no fabricated benchmark claims
* rollback-first language
* clear tradeoffs on the comparison page
* actual receipts rather than decorative fake numbers

The landing page explicitly sources the hero waveform and session records from real captured data.

Strongest appeal
"Every change has an exact before-state and an Undo path."

Main criticism
Unsigned software requesting elevation is still the largest visible trust contradiction.
The source can be extremely secure, but the user sees:

* unknown publisher
* UAC request
* Windows settings being changed

Code signing remains a public-release gate.

Recommended action
Before broad consumer release, prioritize:

* signed installer
* public security architecture summary
* exact change preview before elevation
* public rollback demonstration video
* independently reproducible checksums
* a visible "what Compy can and cannot access" page
* clear explanation of why elevation is required
* explicit distinction between current zero-outbound operation and future optional telemetry

Panel verdict
Largest market, but hardest trust conversion.

## 4. Competitive performance enthusiast

Profile

* Uses PresentMon, CapFrameX, RTSS, HWiNFO, LatencyMon, OCCT, and manual Windows tuning.
* Understands frametime and 1% lows.
* Questions measurement methodology.
* May not need the safe-toggle functionality.

Likely first reaction
Substantially more positive than before.
The current product has moved beyond basic toggles:

* real session FPS-series persistence
* real process events
* benchmark comparisons
* noise-floor handling
* latency diagnostics
* crash Black Box
* session-stack visualization
* per-rig hardware fingerprinting
* combined-effect attribution warnings
* real presenter and swapchain selection fixes

The session data model already records hardware fingerprint information and core performance metrics.

Strongest appeal
This user may not buy Compy to change Game Mode. They may use it to:

* validate a driver update
* compare two system configurations
* identify performance regressions
* preserve a history of actual game sessions
* audit questionable optimization claims

Main criticism
Measurement credibility will remain under constant scrutiny.
The previous WebView presenter bug and the later elevation-decline bug demonstrate that broad real-world testing is essential. The positive point is that both were exposed through actual QA and converted into regression guards rather than hidden. Gaming Mode's real UAC-decline tests ultimately passed all ten cases.

Recommended action
Publish a technical methodology section covering:

* capture source
* sample cadence
* process-selection rules
* swapchain-selection rules
* minimum session duration
* low-sample rejection
* noise-floor calculation
* combined-change limitations
* 1% low methodology
* missing-data treatment
* what constitutes "measured," "verified," and "expected"

Panel verdict
Not the core consumer, but essential for credibility and referrals.

## 5. Hardware-upgrade shopper

Profile

* Believes something in the PC is holding performance back.
* Is willing to spend money but does not know which component matters.
* Wants a recommendation based on their actual rig and games.
* Is vulnerable to overspending on irrelevant upgrades.

Likely first reaction
High interest if Compy can give a clear prescription.
The current business doctrine explicitly positions Compy as a measurement brand that can profit when evidence shows a hardware upgrade is warranted. The planned affiliate engine would place upgrade links alongside limiter verdicts and web reports.

Strongest appeal
"Tell me whether I need a GPU, CPU, RAM, storage, or nothing."

Main criticism
Affiliate monetization creates a direct conflict-of-interest risk.
Compy's credibility depends on sometimes saying:

* "Do not buy anything."
* "This game is software-limited."
* "Your display is the current ceiling."
* "Your GPU upgrade would not fix this problem."
* "There is not enough evidence yet."

Recommended action
Create an Upgrade Prescription Contract:

* no purchase recommendation without a measurable limiter
* confidence level displayed
* evidence shown
* expected affected workload stated
* cheaper non-purchase options listed first
* affiliate disclosure adjacent to the link
* retailer availability separated from technical recommendation
* "No upgrade recommended" treated as a valid result
* recommendation expiration after major driver, game, or hardware changes

Panel verdict
High commercial potential, but the most dangerous trust boundary.

## 6. Privacy-conscious user

Profile

* Avoids telemetry and account systems.
* Distrusts background services.
* Wants local processing.
* Reads privacy statements.

Likely first reaction
Strong interest today, concern about future plans.
The shipped app currently uses a restrictive CSP whose production `connect-src` is limited to local application IPC endpoints.
However, the business doctrine has retired permanent no-telemetry absolutism in favor of planned optional Receipts telemetry. The proposed rules are reasonable—default off, anonymous, inspectable payload, no third-party trackers, kill switch—but the transition must be handled carefully.

Major current inconsistency
The website currently says:

* "nothing leaves your PC"
* "zero outbound connections"
* "free forever"

At the same time, the canonical doctrine plans:

* opt-in telemetry
* affiliate surfaces
* Compy Pro subscription

The claims may be true for the present build, but "free forever" and absolute zero-outbound language create future credibility debt.

Recommended action
Change permanent-sounding promises to version-correct promises:
"The current app runs locally. No account is required. Optional data sharing stays off unless you explicitly enable it."
And:
"Core diagnosis, safety, and rollback remain free."
That allows paid advanced features without contradicting the launch site.

Panel verdict
Strong audience, provided consent and transparency remain unusually strict.

## 7. Casual story-game player

Profile

* Plays demanding single-player games.
* Cares about smoothness, crashes, shader stutter, visual quality, and temperatures.
* Does not obsess over the lowest possible input latency.
* May have a 60–144 Hz display.

Likely first reaction
Moderate interest, currently under-targeted.
The site and app still lean toward FPS and competitive-performance language. However, the Monitor, Black Box, session history, GPU thermal data, and hardware-aware recommendations are also valuable for story-game players.

Strongest appeal

* diagnosing stutters
* identifying memory pressure
* checking GPU thermals
* determining whether a graphical setting or hardware limit is responsible
* seeing whether a driver update caused regressions
* restoring stable settings

Main criticism
The product may appear to be "for esports players only."

Recommended action
Add one consumer story that does not involve competitive latency:
"Your game stutters after forty minutes. Compy records when the spikes start, what the GPU and memory were doing, and whether the next change fixed it."

Panel verdict
Valuable secondary segment with low acquisition priority but broadening potential.

## 8. PC repair shop or boutique builder

Profile

* Configures or repairs multiple customer PCs.
* Needs evidence of what was changed.
* Needs rollback and accountability.
* Wants to reduce post-service disputes.

Likely first reaction
Very high professional interest if multi-rig workflows exist.
The rollback ledger and receipts model may be more commercially valuable to shops than the optimizer itself. The doctrine already identifies business licensing as a later-stage opportunity.

Strongest appeal

* before-state record
* change receipt
* after-test evidence
* customer-facing export
* exact restore path
* repeatable service checklist
* reduced liability

Main criticism
The present application is clearly designed around one user and one PC. Shops need:

* customer or job separation
* named profiles
* multiple-machine reporting
* technician identity
* signed reports
* export templates
* policy-based allowed changes
* backup and recovery procedures

Recommended action
Do not build full business functionality yet. First test a Shop Report Mode with three local repair technicians:

* job name
* before scan
* approved changes
* after scan
* rollback availability
* exported signed receipt

Panel verdict
Potentially the strongest long-term revenue segment, but premature before consumer validation.

## 9. UX and onboarding reviewer

Current assessment
The product's information architecture has improved materially.
The default rail now presents only:

* Home
* Monitor
* Blackbook
* Lab

The Lab absorbs optimization and measurement rather than forcing users across separate Check, Fix, and Lab rooms.

The default visual state now includes:

* Home console
* Monitor console
* Blackbook logbook
* room-specific color identity
* Lab proving ground
* first-check theater
* summary-first monitoring cards
* setup stepper

These are current default states rather than hidden experiments.

Strongest UX improvement
The product is beginning to tell a coherent story:

1. Home: This is your rig.
2. Monitor: This is what happened while you played.
3. Blackbook: This is the record and the knowledge base.
4. Lab: This is where changes are applied and proved.

That is a defensible four-room structure.

Main criticism
The Lab still contains six distinct instruments:

* Optimize
* diagnostics
* benchmark
* latency
* tuning
* Black Box

That is appropriate for advanced users but can still be cognitively expensive.

Recommended action
Add a task-oriented entry layer before station names:

* Make games smoother
* Check whether a tweak worked
* Find a stutter or crash
* Review and undo changes
* Test hardware latency

Then route the user to the proper station. The user should not need to know that "Black Box" is the correct tool.

Panel verdict
The current information architecture is strong; task routing is the next major usability gain.

## 10. Visual-design director

Current assessment
The design is no longer generic dashboard software.
The app uses:

* instrument-console structure
* real detected hardware
* interactive rig holograms
* measured arc gauges
* room-specific colors
* telemetry traces
* session stacks
* restrained HUD framing

The website likewise uses real session data as the visual centerpiece rather than decorative fake telemetry.

Strongest success
The visual style now reflects the product idea:
The data is the aesthetic.
That is original and brand-consistent.

Main criticism
There remains a risk of presentation overwhelming utility:

* holograms can look decorative
* boot animation can delay comprehension
* motion can feel theatrical
* users may admire the interface without knowing what action to take
* dense HUD styling may reduce casual accessibility

The project has already identified this issue. The Two Futures hologram was withheld from default-on status because it looked good but did not visibly communicate its measured purpose.

Recommended action
Apply one rule everywhere:
Every visual flourish must either explain detected hardware, show a measured change, expose state, or provide navigation.
No decorative gauge without a decision.
No hologram effect without hardware meaning.
No animation without a state transition.
No technical label without a plain-language explanation.

Panel verdict
Distinctive and potentially premium, but utility must remain visually dominant.

## 11. Growth and acquisition strategist

Current acquisition engine
Compy now has a credible organic funnel:

* landing page
* real-session hero
* waitlist
* Blackbook web articles
* teaser-versus-full-content split
* `/compare`
* structured data
* sitemap
* shareable receipts
* eventual affiliate recommendations

The Blackbook site contains 196 indexed URLs in the current sitemap plan, with a curated sample of full write-ups and teasers leading into the app.

Strongest acquisition concept
The best free acquisition content is not "how to optimize Windows."
It is:
We tested the tweak everyone recommends. Here is what it actually did.
That content naturally demonstrates Compy's brand while targeting high-intent search traffic.

Main criticism
The current public positioning contains several competing ideas:

* optimizer
* measurement instrument
* rollback safety layer
* Blackbook
* performance monitor
* Gaming Mode
* upgrade advisor
* future Pro product

The site hero is clear, but the complete product can still feel broad.

Recommended action
Use one acquisition hierarchy:

1. Hook: "The PC optimizer that shows its receipts."
2. Proof: real session and real result.
3. Safety: exact undo.
4. Differentiation: no kernel driver, no injection, no invented benchmark claims.
5. Depth: Monitor, Gaming Mode, Blackbook, Lab.
6. Conversion: waitlist/download.

Panel verdict
The current site is much closer to a viable launch funnel than the old project snapshot.

## 12. Monetization critic

Current model
The canonical plan now includes:

1. content/SEO
2. affiliate upgrade recommendations
3. optional Receipts telemetry
4. Compy Pro at approximately $3–4 monthly or about $25 annually
5. eventual business licensing

Positive assessment
The free app as the trust engine is strategically sound. Charging for rollback or basic safety would poison the product.

Major concern
A subscription creates friction with:

* current "free forever" website language
* local-first expectations
* lack of recurring cloud costs in the base product
* consumer hostility toward optimizer subscriptions
* the product's anti-snake-oil identity

Recommended monetization hierarchy
First: affiliate revenue
Only when an upgrade recommendation is evidence-based.
Second: voluntary support
Ko-fi or equivalent during the beta period.
Third: one-time advanced unlock
Possible paid features:

* extended session history
* advanced comparisons
* deeper latency analysis
* tweak-damage audit
* multi-profile export
* historical driver-regression tracking

Fourth: subscription
Only when the recurring value is objectively recurring:

* continuously updated measured outcome database
* multi-rig synchronization
* cloud backup
* new-game profiles
* sustained regression intelligence
* professional reporting

Panel verdict
Do not lead with a subscription at launch. Earn the right through recurring intelligence.

---

## Panel-wide findings

Strongest current product assets

1. The complete rollback architecture
2. Real session measurement
3. Gaming Mode that restores exact prior state
4. Blackbook as both personal record and public knowledge engine
5. The four-room interface
6. The Lab as one place to apply and prove
7. Real-data visual identity
8. Current zero-outbound operation
9. Honest no-result reporting
10. Strong regression and release-state discipline

Largest current product risks

1. Documentation contradiction
`COMPY_OVERVIEW.md` is materially stale. It still says:

* Gaming Mode is dark
* the catalog is frozen
* monetization is undecided
* no telemetry is an absolute
* the product is awaiting earlier beta steps

Those claims conflict with the authoritative current state and Receipts Doctrine.
This matters because it is explicitly written for outside reviewers. It can cause every future panel, investor, tester, or collaborator to evaluate the wrong product.

2. Website promise debt
"Free forever," "nothing leaves your PC," and "zero outbound connections" conflict with planned Pro and optional telemetry unless clearly scoped to the current/core product.

3. Trust versus monetization
Affiliate recommendations and telemetry can strengthen the product, but they can also make users question whether a limiter verdict exists to drive a sale.

4. Broad product identity
The product is simultaneously an optimizer, monitor, benchmark tool, knowledge base, Gaming Mode controller, crash analyzer, and future upgrade engine.

5. Limited vendor validation
AMD remains the strongest proven hardware path. The site deliberately continues to state that NVIDIA sensor coverage is not yet fully hardware-verified.

6. Public-release friction
The domain, code signing, beta smoke pass, legal venue, and actual distribution decision remain open owner actions.

---

## Original recommendations based on the current build

1. Establish a consumer-facing truth document
Create one current external overview derived automatically or manually from `RELEASE_STATE.md` and `RECEIPTS_DOCTRINE.md`.
It should state:

* what ships today
* what remains optional or dark
* what data leaves the machine today
* what future telemetry may do
* what is free
* what may become paid
* verified hardware vendors
* current release stage
* exact consumer promise

The existing `COMPY_OVERVIEW.md` should not remain the external review packet in its current state.

2. Replace feature-first onboarding with outcome-first onboarding
Do not introduce users to Monitor, Blackbook, Lab, Benchmark, Latency, and Black Box as equal concepts.
Ask:
What brought you here?
Options:

* My games stutter.
* I followed an optimization guide.
* I want to check my current setup.
* I want to measure a tweak.
* I want to undo previous changes.
* I think I need an upgrade.

Route from intent to the correct instrument.

3. Build Tweak Damage Audit before broad catalog growth
The catalog is now allowed to grow, but more switches are not necessarily the best growth.
The strongest expansion is identifying:

* unsupported timer changes
* disabled security components
* fixed pagefile hacks
* service-pack damage
* network-stack packs
* stale power-plan edits
* conflicting overlay or monitoring software
* external changes to Compy-managed values

This is safer and more differentiated than becoming a bigger tweak menu.

4. Make evidence export consumer-readable
The current export is technically valuable and already supports optional tester feedback.
Add distinct export tiers:

* Share card: one result
* Consumer report: plain language
* Technical report: full evidence
* Support report: reproducible diagnostic payload
* Shop report: before/change/after/rollback

5. Create a visible attribution warning system
When more than one change is active, Compy should prominently state:
"This session reflects the combined effect of multiple changes. Use the Lab to isolate one change."
The project has already added combined-effect wording in parts of the interface. Extend it consistently across all result surfaces.

6. Treat "No upgrade recommended" as a monetizable trust event
Track it internally as a successful prescription outcome, not a failure to generate an affiliate click.
A user who avoids a pointless $500 purchase may become the strongest promoter of the product.

7. Separate core-free guarantees from future paid depth
A durable promise:
Hardware detection, core safety checks, change receipts, and rollback remain free.
Avoid "everything is free forever" unless that is genuinely binding.

8. Define Compy Pro by recurring value, not feature withholding
Pro should not simply remove history limits or unlock interface controls.
It should eventually provide:

* continuously refreshed measured-outcome intelligence
* multi-rig history
* hardware-change comparisons
* game and driver regression detection
* longer-term trend interpretation
* advanced professional exports
* recurring profile maintenance

9. Conduct cold-start testing against the actual four-room build
Use at least:

* three non-technical gamers
* two burned tweak-pack users
* two enthusiasts
* one privacy-focused user
* one repair technician

Measure:

* what they think Compy does after 30 seconds
* where they click first
* whether they understand the Lab
* whether they trust Gaming Mode
* whether they can find Undo
* whether they understand "no measurable change"
* whether they understand what leaves the PC
* whether they would install despite an unsigned warning
* what they think should cost money

10. Verify NVIDIA before major public claims
NVIDIA is too large a consumer segment to leave partially verified at launch.
The minimum evidence should include:

* GPU sensor reading
* live capture
* completed session
* overlay
* session-series graph
* comparison workflow
* Gaming Mode behavior
* export report
* recovery after interruption

11. Version the public promise
The current installer remains version `0.1.0`.
Given the enormous difference between the May/June build and the July build, the release process needs a clear version policy before distribution:

* beta build number
* public semantic version
* installer artifact identity
* displayed build hash
* compatibility rules for histories and sessions
* migration expectations

12. Finish the boring launch work before another broad feature train
Current priority should be:

1. Beta smoke checklist
2. Fresh current-main beta artifact decision
3. NVIDIA validation
4. Domain decision
5. Code-signing path
6. Legal state venue
7. Current external overview
8. Actual tester distribution
9. Structured observation
10. Only then another broad feature expansion

---

## Revised consumer hierarchy

Primary audience
The gamer who has tried optimization advice but cannot verify or safely undo it.

Secondary audience
The gamer experiencing stutter, inconsistent frametimes, or unexplained performance changes.

High-value commercial audience
The user considering a hardware upgrade and needing an evidence-based prescription.

Credibility audience
Performance enthusiasts, reviewers, and PC technicians.

Later business audience
Repair shops and boutique PC builders.

Poor-fit audience

* users demanding guaranteed FPS gains
* extreme Windows tweakers who prefer unrestricted control
* users who refuse any elevation prompt
* users seeking automated overclocking
* users seeking a generic cleaner or antivirus replacement

---

## Final panel verdict

The current July 15 build is a materially more complete and distinctive product than the version evaluated previously.
Compy's strongest identity is now:
A gaming-PC flight recorder and proving ground with safe controls attached.
The optimizer label gets attention, but the defensible product is the combination of:

* a record of what happened
* a receipt for what changed
* an exact restoration path
* a controlled place to test changes
* a public knowledge base exposing bad advice
* an evidence-based hardware prescription when software changes are not enough

The current technical and visual direction is strong. The largest remaining weakness is no longer the application itself. It is truth alignment between the current app, stale overview documents, website promises, monetization doctrine, and launch messaging.
Fix that alignment before broad distribution. Otherwise, different consumers will be evaluating five different versions of what Compy supposedly is.

---

*Execution: see the CC brief delivered alongside this archive for the triaged, prioritized
work plan. Owner decisions already made on 2026-07-15: flagship naming = "Optimization Cleanup";
"free forever" site copy = scope to "core stays free forever" now, not later.*
