# 2026-08-04 — Compy startup-term analysis (owner-provided, verbatim)

> **Why this file exists:** this review was pasted into a Claude Code session whose worktree
> exists specifically for "a review and overall project optimization regarding the build
> direction and course of action" (per CLAUDE.md's resume-point framing). An earlier attempt at
> that same review was lost to a `/clear` mid-session. Per the project's own TOKEN LAW ("docs
> carry current state only... history lives in archive") this is not history — it's a live
> strategic input the project doesn't yet have a durable home for. It is captured here verbatim,
> unedited, so it survives future compaction/`/clear` cycles and future sessions can cite it by
> `path#section` instead of asking the owner to re-paste it again.
>
> **Status of the takeaways:** see `docs/RECEIPTS_DOCTRINE.md` §8 (North Star Metric + KPI
> hierarchy) for what was actually adopted into canonical doctrine from this review, and
> `docs/BACKLOG.md`'s cutline for the one new concrete action item it produced. This file is the
> raw source; those are the operationalized conclusions. Where they disagree, the doctrine/backlog
> win — this file is not itself doctrine.

---

Compy Startup-Term Analysis — Current State vs. Finished Release

## Core diagnosis

The previous analysis overstated Compy's maturity in some areas and projected it too broadly as an
"AI operating system." That is not the product currently defined by the repository.

Compy is presently:

- Technically: late private beta / early release-candidate software.
- Commercially: pre-revenue.
- Market-wise: pre-product-market fit.
- Operationally: a bootstrapped founder project with unusually mature safety and release controls.
- Strategically: a rollback-first, evidence-based Windows performance product for nontechnical
  gamers.

The repository defines Compy as a hardware-aware Windows optimization and safety dashboard whose
central promise is reversible configuration, plain-English guidance, and measured proof rather than
generic tweak claims. It uses a Tauri 2/Rust backend and React/TypeScript frontend.

As of August 4, 2026:

- v0.9.12 is the newest published updater release.
- The owner machine runs a newer local build at the same version number.
- Code signing remains open.
- Legal documents remain drafts.
- Only one tester is confirmed on v0.9.11.
- No tester is confirmed on v0.9.12.
- The remaining testers' installation state is unknown because Compy intentionally has no remote
  inventory.
- Product-completion, accessibility, performance-budget, support-evidence review, and wider-beta
  work remain open.

Therefore:

- Compy has a real product and a functioning release system, but it does not yet have a validated
  business.
- A technically finished 1.0 release would still not prove product-market fit, recurring demand,
  monetization, or sustainable distribution.

## Maturity by dimension

| Dimension | Current condition | Projected finished-release condition |
|---|---|---|
| Product implementation | Substantial beta product | Coherent 1.0 user journey |
| Safety architecture | Strong | Core competitive advantage |
| Release engineering | Unusually mature | Production-grade and repeatable |
| Public-launch readiness | Not ready | Signing, legal, support and QA closed |
| User validation | Very limited | Multiple completed beta cohorts |
| Product-market fit | Unknown | Still unproven at release |
| Revenue | None established | Monetization infrastructure may exist |
| Distribution | Minimal/manual | Repeatable organic acquisition begins |
| Competitive moat | Emerging | Potentially meaningful if receipts accumulate |
| Company maturity | Founder project | Early commercial software company |

## 1–5: Product validation and survival

### 1. MVP — Minimum Viable Product

**Current state.** Compy has moved beyond a conventional MVP in engineering scope. It already
contains: hardware detection; recommendations; reversible mutations; rollback records; monitoring;
benchmarking/Lab functionality; Gaming Mode; updater infrastructure; localization; a Trust Ledger;
support-evidence infrastructure; significant automated testing; release transaction controls.

Calling it "95% MVP complete" is misleading. MVP is not a percentage-based build milestone. It is
the smallest product needed to test a business hypothesis.

Compy's actual hypothesis should be: *nontechnical Windows gamers will repeatedly use and
eventually pay for a product that safely diagnoses performance problems, applies reversible
changes, and proves whether those changes helped.*

The application can technically test that hypothesis now. The missing component is sufficient
real-user exposure.

**Finished-release state.** A finished 1.0 release should not contain every planned feature. It
should contain one complete, comprehensible value journey: Detect the PC → identify one meaningful
problem → explain it → offer a safe action → obtain consent → apply it → verify the result →
preserve a rollback path → produce a readable receipt. That is the actual viable product.

**Critical verdict.** Compy is overbuilt relative to its market evidence, but not necessarily
overbuilt relative to its safety requirements. The release pipeline, rollback model, guards, and
receipts are not waste. They support the product's trust claim. Additional speculative features
are where overbuilding becomes dangerous.

### 2. PMF — Product-Market Fit

**Current state.** PMF is completely unproven. Positive comments from a few testers establish
usability clues, not PMF. A tester saying the interface is organized or that they like a feature is
weaker evidence than: returning without being prompted; completing multiple optimization sessions;
relying on the history; requesting access after changing PCs; recommending Compy to another person;
asking when a paid version becomes available; objecting when the product is unavailable.

Compy currently has insufficient cohort size, usage history, and distribution to determine this.

**Finished-release state.** A 1.0 release does not automatically create PMF. It only creates a
stable object that can be tested for PMF, evaluated through: activation; repeat use; retained rigs;
completed evidence loops; referrals; willingness to pay; qualitative dependency.

**Critical verdict.** PMF is Compy's largest business risk. The codebase is not the main uncertainty
anymore. User dependence is.

### 3. CAC — Customer Acquisition Cost

**Current state.** CAC is not zero. It is unmeasured. Organic acquisition still consumes: founder
time; support time; content-production time; community participation; tester onboarding; hosting
and tooling; future signing and legal costs. Calling acquisition "free" hides the economic cost.

**Finished-release state.** Compy's canonical business plan is organic-first: content and SEO;
waitlist; community referrals; receipts-based share material; affiliate surfaces; paid acquisition
only after organic conversion is proven. The doctrine explicitly prohibits paid advertising before
1.0 and requires evidence that paid acquisition can recover its cost.

**Critical verdict.** At an intended Pro price near $3–4/month (~$25/yr), Compy cannot tolerate high
paid CAC. Distribution must initially come from content, product sharing, referrals, communities,
and search.

### 4. LTV — Lifetime Value

**Current state.** LTV is undefined because Compy has no established paying customer cohort.
Potential pricing does not create LTV. LTV depends on: conversion; retention duration; renewal
rate; refunds; support cost; payment fees; cloud or model cost; affiliate contribution; multi-rig
adoption.

**Finished-release state.** Compy's projected revenue stack includes: paid Pro subscription;
affiliate upgrade recommendations; B2B licensing; potentially paid report depth; later
model-assisted services. That can produce higher LTV than a one-time optimizer, but only if users
continue finding value after the first optimization pass.

**Structural risk.** PC optimization has a natural "one-and-done" problem: a user fixes the system,
sees no further reason to return, and cancels. Compy needs recurring value through: post-update
checks; driver-change comparisons; game-session analysis; regression detection; multi-rig history;
ongoing monitoring; new-game recommendations; trustworthy upgrade guidance. Without those,
subscription LTV will remain weak.

### 5. Runway

**Current state.** Runway cannot currently be calculated from available evidence. The required
formula is: `Runway = available business cash ÷ monthly net cash burn`. Founder time, personal
living costs and company cash should not be mixed into one informal figure.

**Finished-release state.** Compy should maintain two separate runway measures: Cash runway (how
many months direct business expenses can be paid) and Founder runway (how long the owner can
continue working without sufficient Compy income).

**Critical verdict.** The project's zero-budget law reduces cash risk, but it does not eliminate
time risk. Founder time is currently Compy's scarcest resource.

## 6–12: Revenue, retention and financial quality

### 6. Burn Rate

Burn is probably low but unmeasured. A proper monthly ledger should include: AI and development
subscriptions; hosting; domain costs; signing; legal expenses; payment-provider fees; software
services; testing hardware; contractor costs; refunds; support expenses. The release does not need
a large budget. It needs a known budget. The doctrine's zero-budget constraint is strategically
useful because it prevents spending ahead of evidence.

### 7. ARR — Annual Recurring Revenue

No established ARR. Donations, one-time purchases and affiliate commissions are not ARR. ARR begins
only when subscription or recurring B2B revenue exists: `ARR = current normalized MRR × 12`. Compy
Pro and B2B seats would qualify. Affiliate income usually would not.

### 8. MRR — Monthly Recurring Revenue

No established MRR. Should be separated into: new MRR; expansion MRR; contraction MRR; churned MRR;
net new MRR. Likely categories: individual Pro subscriptions; additional-rig upgrades; B2B seats;
possibly support or reporting subscriptions.

### 9. Churn Rate

Paid churn cannot yet be measured. Usage churn can be measured manually during beta: a tester
activated Compy but stopped returning after the first or second session. Should track: customer
churn; revenue churn; usage churn; voluntary cancellation; payment failure; uninstall/abandonment
where voluntarily reported.

**Critical risk.** If the product produces value only during initial setup, churn will be
structurally high. Recurring diagnosis and proof must justify recurring payment.

### 10. Retention Rate

Retention is more important than download count, but current data is inadequate. One confirmed
updater canary is release evidence, not retention evidence. Relevant cohorts: returned within 7
days; returned within 30 days; returned after a driver or Windows update; completed a second
evidence loop; used history or comparison; applied or rolled back another recommendation.

**Critical verdict.** Retention is the clearest early indicator that Compy is more than an
attractive one-use utility.

### 11. EBITDA

Not useful yet. With no stable revenue, EBITDA would mainly describe expenses rather than business
performance. Becomes relevant after Compy has consistent revenue, employees/contractors, meaningful
operating expenses, formal accounting, and a period-to-period profitability trend.

### 12. Gross Margin

Undefined. The local desktop architecture creates favorable potential margins because much of the
product runs on the user's machine. Future telemetry, model-assisted explanations, support and
payment infrastructure can introduce variable costs. `Gross margin = (revenue − direct cost of
serving users) ÷ revenue`. Direct service cost can include: model inference; telemetry
infrastructure; account-tied support; payment processing; report generation; licensed data;
affiliate-network fees.

**Strategic implication.** Local-first intelligence is financially useful, not merely
privacy-oriented. It prevents every active user from creating a large recurring inference bill.

## 13–15: Market sizing

### 13. TAM — Total Addressable Market

No defensible TAM has been calculated. "Every PC user" is not a valid TAM, nor is "the AI software
market." The relevant TAM: all users and businesses that could realistically pay for cross-vendor,
evidence-based Windows performance diagnosis, reversible optimization, monitoring and proof. Should
be calculated bottom-up: potential paying users × realistic annual revenue per user, separately for
consumers, repair shops, boutique builders, managed IT/technical support, and affiliate-driven
upgrade decisions.

**Critical correction.** Compy should not increase its TAM estimate by calling itself an AI
operating system. That would weaken positioning and produce meaningless market numbers.

### 14. SAM — Serviceable Available Market

Constrained by: Windows support; supported hardware; language coverage; regional payment
availability; game and sensor compatibility; the gamer-oriented presentation; the absence of signed
public distribution; current support capacity. The initial SAM is more plausibly:
English- and Simplified-Chinese-speaking Windows gamers who care about performance, lack confidence
in manual tweaking, and value reversibility and proof. Later expansion: builders and repair shops.

### 15. SOM — Serviceable Obtainable Market

Small because distribution is currently limited to personal contacts, Discord communities, invited
testers, and future organic content — not a defect; SOM should be realistic. A defensible two-year
SOM would be based on: organic monthly visitors; download conversion; installation completion;
activation; retained rigs; free-to-paid conversion; average paid revenue.

**Critical verdict.** TAM should describe theoretical opportunity. SOM should describe what the
current founder, channels and budget can plausibly reach.

## 16–20: Ownership structure

### 16. Cap Table

Probably simple, but repository control is not a substitute for a legal ownership record. Should
identify: founder shares; any cofounder ownership; options; convertible instruments; advisory
grants; outside investors. A public release does not require external investors, but commercial
operation should have clear ownership and IP records.

### 17. Equity

Equity is ownership of the legal business, not merely of the repository. Before granting equity,
separate: code contribution; temporary development help; employment; advisory work; cofounder-level
risk; capital investment. **Do not exchange permanent ownership for work that could reasonably be
paid for later.**

### 18. Vesting

Not relevant unless another person receives founder, employee or advisor equity. Future
cofounder/employee equity should generally vest over time. Exact structure requires legal/tax
advice.

### 19. ESOP

"ESOP" can mean a formal Employee Stock Ownership Plan (regulated retirement structure) or,
informally, an employee stock option pool/plan. Compy is far too early for a formal plan; a future
option pool becomes relevant only when hiring requires equity compensation.

### 20. Dilution

No apparent dilution is required. Occurs through: issuing investor shares; creating an option pool;
convertible notes; SAFEs; additional founder/advisor grants. Bootstrapping preserves ownership but
may reduce growth speed; funding increases resources but sells part of future value and often
introduces control rights.

## 21–30: Investment and valuation

### 21. Angel Investor

Not necessary for the current path. Useful only if a small amount of capital removes a specific
verified bottleneck (signing, legal formation, professional security review, specialized testing
hardware, contractor support, launch distribution). Bad use: funding undefined expansion before
activation and retention are known.

### 22. Venture Capital

Compy is not presently VC-ready in the business sense. Venture investors would still ask: who
urgently needs this; how many return; how are users acquired; why will they pay; why can Microsoft,
Razer, AMD or NVIDIA not reproduce it; how large can the company become; what grows faster as more
users join. VC would currently finance assumptions rather than proven growth — poor founder
leverage, unfavorable valuation.

### 23. Seed Round

Premature. A credible case would need some combination of: strong retained usage; early revenue;
meaningful waitlist conversion; evidence that receipts improve trust and referrals; clear expansion
into B2B or a large consumer segment; repeatable acquisition.

### 24. Series A

Not simply "money to scale operations." For Compy it should mean a repeatable commercial system
already exists (acquisition → activation → retention → monetization → acceptable unit economics);
capital would scale that system, not search for it.

### 25. Series B

Would fund expansion of an already working model: more markets, hardware coverage, larger teams,
enterprise sales, broader data infrastructure, international distribution. Not currently
actionable.

### 26. Series C

Large-scale expansion, consolidation or acquisitions. No relevance to current product decisions.

### 27. Valuation

A credible valuation cannot be derived from test count, code volume, development time, feature
count, personal belief in the market, or hypothetical TAM. Value would come primarily from
recurring revenue, growth, retention, proprietary data, trusted distribution, defensible
technology, contracts, strategic acquisition value.

**Critical verdict.** Compy currently has meaningful technical asset value but no defensible
venture valuation.

### 28. Pre-Money Valuation

The company's negotiated value immediately before receiving an investment. Example: pre-money $2M,
investment $500K.

### 29. Post-Money Valuation

`Post-money = pre-money + new investment`. Using the example: $2M + $500K = $2.5M; the new investor
would own 20% before option-pool effects.

### 30. Term Sheet

Does more than summarize price. Important provisions: valuation; liquidation preference; board
control; voting rights; anti-dilution; option-pool treatment; founder vesting; pro-rata rights;
information rights; protective provisions; exclusivity. A high nominal valuation can still conceal
bad economic or control terms.

## 31–40: Strategic development

### 31. Due Diligence

**Current strengths.** Compy is unusually strong in technical diligence for its stage: authoritative
release-state documentation; immutable provenance; rollback boundaries; test and guard
infrastructure; release journals; explicit blockers; privacy documentation; branch dispositions;
evidence-backed claims.

**Current weaknesses.** Business/corporate diligence lags: formal entity structure; IP assignment;
finalized EULA/privacy terms; Authenticode signing; financial records; customer contracts;
analytics; retention evidence; revenue; support procedures; incident-response process; external-review-grade
dependency/security records.

**Verdict.** Technical diligence readiness is materially ahead of commercial diligence readiness.

### 32. Pivot

Compy has not pivoted into an AI operating system. The meaningful strategic evolution is: generic
PC optimizer → rollback-first configuration safety layer → evidence-based performance intelligence
and measurement brand. Coherent because each step strengthens the same underlying customer problem.

**Future pivot condition.** Justified only if evidence shows users value a different part of Compy
than expected — e.g. users ignore automated changes but value diagnosis; repair shops value
receipts more than consumers; upgrade recommendations outperform subscription interest;
session-history analysis creates more retention than optimization.

### 33. Bootstrap

Accurately describes Compy. The doctrine requires zero-budget, free-tier-first operation, organic
distribution and owner authorization for spending. Advantages: founder control, disciplined
spending, limited dilution, pressure to solve real user problems, freedom to retain safety
principles. Risks: slow distribution, founder overload, limited testing diversity, delayed legal
and signing work, excessive reliance on AI-assisted development, insufficient sales/marketing
execution.

### 34–36. Unicorn / Decacorn / Centicorn

Valuation-status labels ($1B / $10B / $100B+ private valuations). No current operational value.
Compy should optimize for user dependence, revenue quality, retention, defensible trust, and
sustainable owner income — not valuation status.

### 37. Unit Economics

Undefined. Projected consumer formula: `annual Pro revenue + affiliate contribution − payment fees
− support cost − infrastructure cost − model/inference cost − refunds = annual contribution per
customer`. That contribution must exceed CAC by enough to fund development and overhead.

**Important implication.** At ~$25/year, even moderate human support can destroy consumer unit
economics. The product must be highly self-explanatory, recoverable and support-efficient. Compy's
local support evidence and inspect-before-export design directly help here because users can
provide bounded, redacted evidence without automatic uploading.

### 38. North Star Metric

The previous suggestion of generic weekly active users was incomplete. Compy's recommended North
Star:

> **Weekly Active Rigs Completing a Verified Evidence Loop**

A verified evidence loop means the user: receives a diagnosis or recommendation; makes an informed
decision; applies, rejects or rolls back the action; receives a recorded outcome or receipt. This
is better than "measured wins" because honest no-change and regression findings still provide
value, and it avoids incentivizing Compy to recommend more aggressive changes merely to increase
its metric.

Supporting quality measure: **verified evidence loops per retained rig**.

### 39. KPI — Key Performance Indicator

Compy needs a controlled hierarchy, not dozens of equal-status metrics.

- **Product KPIs:** onboarding completion; first hardware scan completion; first evidence-loop
  completion; recommendation acceptance; action failure rate; rollback success; crash-free
  sessions; unsupported-hardware rate; time to first useful result.
- **Retention KPIs:** 7-day retained rigs; 30-day retained rigs; second evidence-loop completion;
  history/comparison reuse; return after Windows, driver or hardware change.
- **Business KPIs:** landing-page conversion; download-to-install conversion; free-to-paid
  conversion; monthly churn; MRR; affiliate click-through; support cost per user.
- **Trust KPIs:** rollback recovery rate; unresolved mutation incidents; false or overstated
  recommendation reports; receipt preview rate; support bundle usefulness; privacy-related
  complaints.

### 40. GTM — Go-to-Market Strategy

**Current state.** GTM is less mature than product engineering. The canonical doctrine defines a
sequence: content exporter; website and waitlist; opt-in anonymous Receipts telemetry; affiliate
surfaces; dark Pro infrastructure; B2B licensing after traction. That is a strategy, but not yet a
proven acquisition engine.

**Critical requirement.** Compy's GTM message should not be "another app that boosts your FPS."
Microsoft provides free cleanup, health checking and Windows tools (PC Manager). Razer Cortex
offers game/system boosting, settings optimization, FPS projections, overlays and restoration
controls. AMD and NVIDIA already provide first-party tuning, metrics, game settings and automatic
optimization.

Compy's stronger market position: **cross-vendor performance diagnosis with reversible actions and
evidence showing what actually changed on this specific PC.**

## 41–45: Customer and growth mechanics

### 41. ICP — Ideal Customer Profile

**Primary launch ICP:** a Windows gamer who wants better or more stable performance, lacks
confidence in manually editing BIOS/Windows/driver settings, distrusts generic optimizer claims,
and values the ability to understand and undo every change. Characteristics: Windows 10/11;
midrange or enthusiast gaming PC; performance problem or uncertainty; moderate technical
confidence; has tried guides/utilities/manual tweaks; fears breaking Windows or creating
instability; wants plain-English guidance; willing to provide structured feedback.

**Secondary ICP:** PC builders; repair shops; family technical support; boutique system
integrators.

**Not the initial ICP:** every Windows user; enterprise endpoint fleets; professional
overclockers; Linux/macOS users; users seeking antivirus or general cleanup; users expecting
guaranteed FPS gains.

### 42. Conversion Rate

Compy has several conversions, not one: visitor → waitlist → download → successful install →
hardware scan → first recommendation → completed evidence loop → free user → paid user → renewal →
referral → limiter-verdict → affiliate click.

**The most important early conversion is not website conversion. It is: successful install to
first verified evidence loop.**

### 43. Funnel

Recommended funnel: problem-aware gamer → finds a receipt/comparison/guide/recommendation →
understands Compy measures rather than promises → downloads signed installer → completes guided
setup → receives first useful diagnosis → completes a reversible evidence loop → returns after
another game/driver/system change → upgrades to Pro → shares a receipt or recommendation.

**Current funnel weakness.** The product and release pipeline are stronger than the top and middle
of the funnel. Discovery, onboarding measurement, activation tracking and return behavior remain
insufficiently proven.

### 44. A/B Testing

Premature for most decisions — requires enough traffic for meaningful differences; with a very
small beta population, direct observation and interviews are more useful (moderated onboarding,
task-completion observation, prototype comparison, structured tester interviews, comprehension
checks, preference testing, first-click testing). Later A/B tests: landing-page promise, onboarding
sequence, free-vs-Pro presentation, receipt-sharing CTA, recommendation wording, affiliate
placement, renewal framing. **A/B testing should never be used to weaken consent, hide risk, or
pressure unsafe changes.**

### 45. NPS — Net Promoter Score

Would be statistically weak with the current tester population (a score from six or ten invited
users can be distorted by personal relationships and sample selection). Better current questions:

- What did Compy help you decide?
- What did you not trust?
- What would stop you using it again?
- What would you use instead?
- Would you install it on another PC?
- Would you pay for continued history or monitoring?
- What would you lose if Compy disappeared?

NPS becomes useful once Compy has a larger, less personally connected user base, segmented by
free/paid, new/retained, hardware type, outcome, and consumer/B2B.

## 46–50: Outcomes, defensibility and compounding growth

### 46. Exit

Not relevant. An exit is an ownership outcome, not a product strategy. Building specifically for
acquisition can distort the product toward hypothetical buyers rather than users.

### 47. Acquisition

Compy could eventually be acquired for: cross-vendor performance intelligence; a trusted gamer
audience; recommendation and rollback technology; an aggregated outcomes dataset; diagnostic
rules; B2B repair workflows; strategic distribution. None of those assets is mature enough today to
support an acquisition thesis.

### 48. IPO

Not operationally relevant. Would require scale, governance, audited finances, predictable growth
and organizational maturity far beyond the current company.

### 49. Moat

One of the most important terms in the set.

**What is not a moat:** attractive interface; large test count; using AI; hardware detection;
monitoring FPS; applying Windows tweaks; an updater; generic recommendations; a large number of
features. Those can be copied or are already supplied by Microsoft, Razer, AMD and NVIDIA.

**Potential Compy moat:**
- **Rollback integrity** — every meaningful change has a known, tested recovery path.
- **Evidence continuity** — Compy preserves what changed, why, whether it helped and how to
  reverse it.
- **Cross-vendor interpretation** — connects Windows, CPU, GPU, memory, game and system behavior
  rather than one vendor's hardware.
- **Outcome dataset** — opt-in anonymous results can eventually show which actions helped which
  hardware combinations.
- **Trust reputation** — refusing to fabricate gains can become a brand advantage in a market full
  of broad performance claims.
- **Rules and knowledge corpus** — a maintained, hardware-aware diagnostic system becomes harder to
  reproduce as coverage deepens.
- **Workflow lock-in through value** — historical comparisons, multiple rigs, support records and
  accumulated evidence create legitimate switching cost.
- **B2B liability reduction** — shops may pay for proof that a change was authorized, applied,
  measured and reversible.

**Current moat rating:** technical moat moderate; data moat almost nonexistent today; brand moat
early; distribution moat absent; trust moat promising but not yet established at scale.

### 50. Flywheel

Compy's strongest plausible flywheel is not simply "more users create better AI." It is: users
complete evidence loops → opt-in anonymous outcomes accumulate → Compy identifies which actions
help specific rig classes → recommendations become more precise → receipts and aggregate results
create credible content → content earns search traffic and community trust → more appropriate
users install Compy → more users complete evidence loops → paid conversion, affiliate decisions and
B2B credibility improve.

**Required safeguards:** explicit opt-in; default off; inspectable payload; no personal
identifiers; minimum cohort sizes before aggregate claims; no fabricated statistics; clear
distinction between correlation and causation; kill switch; security review; owner authorization
before shipping. (These already align with the Receipts Doctrine.)

**Competitive reality.** Compy operates in a crowded field:

| Competitor class | Existing strength | Compy cannot win by |
|---|---|---|
| Microsoft PC Manager | Free cleanup, health checks, storage and Windows utilities | Offering another generic "health score" |
| Razer Cortex | Game boosting, Windows optimization, game settings, FPS prediction and overlay | Claiming one-click gaming optimization |
| AMD Adrenalin | First-party Radeon tuning, metrics and advice | Out-controlling AMD hardware |
| NVIDIA App | Drivers, tuning, game settings, overlays and latency metrics | Recreating vendor settings panels |
| Traditional optimizers | Cleanup, startup control, automation and broad speed claims | Adding more cleanup switches |

The defensible opening is not a larger pile of controls. It is: **Compy tells the user what is
wrong, what is worth changing, what actually changed, whether it helped, and how to reverse it —
across the entire PC rather than one vendor surface.**

## What "finished release" should mean

**Required for a credible public 1.0**

Product: one complete detect-to-proof journey · first useful result reached without technical
knowledge · canonical Lab presentation settled · reversible recommendation generation cleaned up ·
consumer/technical/support evidence exports coherent · empty/healthy/unsupported-rig states handled
honestly · no dead-end recommendations.

Safety: all mutation paths pass rollback testing · elevated actions preserve consent and
provenance · native installed-build testing completed · no unresolved severe mutation or rollback
defect · support evidence visual review completed · privacy claims agree with actual outbound
behavior.

Quality: accessibility assessment completed · measured startup/idle/active performance budgets
established · crash-free beta sessions at an acceptable level · installer and updater tested across
representative machines · unsupported hardware fails safely.

Distribution: Authenticode signing active · legal documents finalized · public website accurately
describes the product · support and incident process exists · release rollback and emergency
containment are documented · at least one wider beta cohort completes the full journey.

Business validation: ICP explicitly defined · activation measured · retention manually or
consensually measured · price tested · first recurring-value hypothesis tested · waitlist/download
funnel measured · no unsupported TAM or valuation claims.

## Recommended operating metric system

**North Star:** Weekly Active Rigs Completing a Verified Evidence Loop.

**Primary launch metrics:**

| Metric | Purpose |
|---|---|
| Install success rate | Distribution quality |
| First-scan completion | Initial usability |
| First evidence-loop completion | Activation |
| Time to first useful result | Product efficiency |
| 14-day return rate | Early retention |
| Second evidence-loop rate | Recurring utility |
| Action failure rate | Reliability |
| Rollback success rate | Safety |
| Severe incident count | Launch risk |
| Tester referral rate | Organic demand |
| Willingness to pay | Monetization evidence |

**Metrics to avoid treating as success:** total commits; total tests; feature count; repository
size; downloads without activation; waitlist size without conversion; social impressions;
AI-generated market estimates; hypothetical valuation; aggregate "issues found" counts that
incentivize fear-based UX.

## Final assessment

| Category | Current state | Finished-release potential |
|---|---|---|
| Product implementation | Strong | Strong |
| Safety and reversibility | Very strong for stage | Core moat |
| Release engineering | Very strong | Production-capable |
| Documentation integrity | Strong but maintenance-heavy | Valuable diligence asset |
| User experience | Improving, partially validated | Potentially strong |
| Market evidence | Weak | Must be built through beta |
| Retention evidence | Almost absent | Principal PMF test |
| Monetization | Doctrine only | Plausible but unvalidated |
| Distribution | Weak | Organic flywheel possible |
| Data advantage | Minimal | High potential after consented receipts |
| Competitive differentiation | Emerging | Strong if proof and rollback remain central |
| Public-launch readiness | Not ready | Achievable after explicit blockers |
| Sustainable-business probability | Indeterminate | Depends primarily on retention and acquisition |
| Venture-scale probability | Not presently assessable | Requires evidence far beyond technical quality |

## Bottom line

Compy is not merely an unfinished MVP. It is a technically advanced beta product whose engineering
maturity has outrun its market validation.

Its strongest projected form is not an all-purpose AI platform and not another system cleaner. It
is: **a cross-vendor PC performance intelligence and safety system that produces reversible
actions, measured outcomes and durable receipts for ordinary gamers.**

The most important terms from this analysis for Compy during the next stage are: MVP scope
discipline · PMF · Retention · ICP · North Star Metric · Funnel · Conversion · Unit economics ·
Moat · Flywheel · CAC · LTV. Funding rounds, valuation labels, EBITDA, IPO and unicorn
classifications are distractions until Compy proves that strangers repeatedly use the product and
consider its evidence valuable enough to pay for.
