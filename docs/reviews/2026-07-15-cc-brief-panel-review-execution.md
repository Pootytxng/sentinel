# CC Brief — execute the 2026-07-15 consumer panel review

> **PRODUCT DIRECTION SUPERSEDED 2026-09-04 (#369).** This execution brief, its “source of truth,”
> “execute now,” and old product/monetization routing are historical and no longer authorize work.
> Current product direction comes from `docs/PRODUCT_CONSTITUTION.md`; current sequence and ownership
> require the Roadmap and Work Control. The panel evidence remains historical research only.
>
> **Source of truth for the review's content:** [`2026-07-15-consumer-panel-review.md`](2026-07-15-consumer-panel-review.md)
> (archived verbatim — do not paraphrase from this brief instead of that file if you need the
> owner's exact original wording on anything). This brief is Cowork's triage of that review against
> the live repo, done 2026-07-15. Cowork read `COMPY_OVERVIEW.md`, `BACKLOG.md` (partial, first
> ~420 lines), `OWNER_ACTION_CHECKLIST.md`, `UI_VISION_BACKLOG.md`, and `MONETIZATION_PLAN.md`
> before writing this — re-verify against current `main` before acting, per standing doctrine, since
> this repo moves fast and Cowork's read was a snapshot.
>
> **Two owner decisions already made (2026-07-15), do not re-ask:**
> 1. Flagship naming for the "undo tweak-pack damage" surface → **"Optimization Cleanup"** (not
>    "Tweak Damage Audit," not publicly "Paramedic Mode").
> 2. The site's "free forever" / absolute zero-outbound promise → **scope it now** to "core stays
>    free forever" language, ahead of Compy Pro's approach, not after.
>
> **Already done by Cowork this session (verify, don't redo):** `COMPY_OVERVIEW.md` was rewritten
> to fix the staleness the review caught (Gaming Mode marked live, catalog marked open, monetization
> section replaced with the real doctrine/plan summary, telemetry-absolutism framing scoped, a
> "last reconciled" banner added). Run your normal doc-drift check on it, but the rewrite is done —
> don't duplicate the effort.

---

## Part 1 — fact-check result (context, no action needed)

Cowork ran every checkable factual claim in the review against the repo before trusting it. 7 of 7
came back accurate: installer version `0.1.0`, site "free forever"/"zero outbound" copy (verified
present), the 4-item nav rail (Home/Monitor/Blackbook/Lab), the 6 Lab stations, NVIDIA
not-yet-hardware-verified status, the 196-URL sitemap, and RELEASE_STATE's gate lines (Gaming Mode
live, Receipts dark, outbound none). The one named problem — `COMPY_OVERVIEW.md` stale — was
confirmed **worse** than the review states (it also predated the 2026-07-15 site launch and
`MONETIZATION_PLAN.md`). **Conclusion: the review's read of the product is trustworthy. Treat its
recommendations as informed, not naive outside guessing.**

---

## Part 2 — already satisfied, confirm only (no new doc entries)

Don't create tracking for these; if you touch the relevant area anyway, just sanity-check the claim
still holds.

- **Monetization "undecided" framing** (persona 12 / finding #1) — superseded by
  `RECEIPTS_DOCTRINE.md` + `MONETIZATION_PLAN.md`, both already rank affiliate → content → Pro →
  B2B and both already state the core-free promise. No new doc needed.
- **"No upgrade recommended" as a trust event, not a failure** (recommendation #6) — already the
  doctrine's stated posture (Layer 1: "we get paid when the proof says buy hardware, and only
  then"). Carry the principle into any future upgrade-prescription UI work; no standalone task.
- **Fabricated/decorative site numbers** (persona 3, persona 10 partial) — already fixed per
  BACKLOG Cycle 2026-07-13e (hero receipt replaced with a real measured trial) and `/compare`'s
  no-competitor/no-invented-number guards. Confirm still true, don't rebuild.
- **Combined-effect attribution wording** (recommendation #5) — review says this is *partially*
  already in the interface. **Action: audit coverage across Two Futures / Benchmark / any surface
  showing a result while >1 change is active, extend the wording where missing. This is a light QA
  pass, not a new feature — do fold it into BACKLOG as a small item if gaps are found.**

## Part 3 — owner-decided, execute now

### 3.1 Site copy: scope the "free forever" promise
**Owner-approved 2026-07-15.** Change the absolute framing to "core stays free forever" language
(optimize + rollback are the durable free promise; Pro is future paid *depth*, never a gate on the
free promise). Verified current locations (Cowork's fact-check pass, re-verify line numbers before
editing — the site is mid-flight per BACKLOG):
- `site-app/src/pages/index.astro` — meta description (~L78), hero line "Compy is free. No
  account, no ads, nothing leaves your PC." (~L164), vows list "zero outbound connections" /
  "free forever" (~L227, L230), "Free forever. Really." / "COMPY — FREE FOREVER" / "free forever,
  not a trial" (~L337, L342, L380).
- `site-app/src/pages/compare.astro` — "Nothing leaves your PC" / "makes zero outbound network
  requests" (~L41-43).

Go through the site's normal pipeline (`site/generate.mjs` / `scripts/stage-dist-site.mjs`,
`scripts/site-seo.test.mjs`, `site-landing.test.mjs`) — this is a live, tooled, deployed site
(`compy-bd6.pages.dev`) with its own guard suite; don't hand-edit and skip regen/tests. The
"zero outbound" claim itself stays accurate as-is (it's currently true and worth keeping) — only
the *permanence* language ("forever," "nothing" as an absolute) needs scoping so it survives Pro's
eventual launch without becoming a broken promise.

### 3.2 Flagship naming
"Optimization Cleanup" is locked. No site/app copy exists yet referencing this feature by any
name, so there's nothing to rename — just use this name in any future spec/plan doc for the
feature itself (see 4.1).

---

## Part 4 — new work to triage into BACKLOG.md / UI_VISION_BACKLOG.md / OWNER_ACTION_CHECKLIST.md

Use your normal `doc-sync` / `gate-drift-audit` discipline here — these three docs are live and
mid-flight (BACKLOG.md alone is 969+ lines with same-day cycles). **Do not create a fourth
competing list.** Merge into the existing structure, cite this brief + the archived review as
provenance, and check the cross-references noted below before adding anything — several of these
already have partial coverage.

### 4.1 Build "Optimization Cleanup" — flagship read-only surface
Source: persona 2 + recommendation #3. This is genuinely new product surface, not a small
reversible edit — treat it as its own spec'd train (research → spec → scope-gate), not a
same-session build. Scope per the review:
- identify known tweak-pack artifacts (timer/HPET hacks, disabled Defender, core parking, TCP
  mega-packs, fixed pagefile, service-pack damage, stale power-plan edits, conflicting
  overlay/monitoring software, external drift on Compy-managed values)
- classify each: useful / placebo / risky / outdated / unknown
- show the documented-default Windows state for comparison
- state confidence + evidence for the classification
- **only offer automatic restoration where the correct prior/default state is unambiguous** —
  everything else stays advisory, points the user at the real Windows location (same refusal
  pattern the app already uses for unrecorded settings)
- take a **separate recovery snapshot before any remediation** — do not reuse the main Trust
  Ledger snapshot path without review, this is touching state Compy didn't apply
- **Not the same feature as UI_VISION_BACKLOG §F "Upgrade-path engine"** (that's hardware upgrade
  advisory) — don't conflate scoping.
- This is mutation-adjacent (it can restore third-party settings). Route through your normal
  `mutation-gate` skill before any apply path ships, per LOCKED rule 3 (rollback-first) and rule 6
  (reversible/no-kernel/non-security-weakening rails apply even to "cleanup" framing).

### 4.2 Task-oriented intent router
Source: persona 9 + recommendation #2 ("What brought you here?" → route to the right instrument,
not station names). **Check first:** the Lab already has a symptom router ("walk-the-bench rework"
→ "What are you here to do?", shipped 2026-07-05 per BACKLOG). Scope only the gap — likely
extending intent-routing to be the entry point *before* room selection (Home → Monitor/Blackbook/
Lab), not just inside the Lab. Don't rebuild what already exists.

### 4.3 Design principle: every visual flourish must earn its place
Source: persona 10. "No decorative gauge without a decision. No hologram effect without hardware
meaning. No animation without a state transition. No technical label without a plain-language
explanation." This is a standing rule, not a task — check whether it belongs in the self-review
rubric (`.claude/skills/self-review`) or a design-direction spec, and add it there rather than as
a one-off BACKLOG item.

### 4.4 Evidence export tiers
Source: recommendation #4 — Share card / Consumer report / Technical report / Support report /
Shop report. Check current `export.rs` (~814 lines) scope before treating all five as new — a
share-card export already exists per the doctrine. Likely-new: Consumer/Technical/Support tiers.
Shop report ties to 4.7 below (don't build ahead of it).

### 4.5 Public technical methodology page
Source: persona 4 (capture source, sample cadence, process/swapchain selection, noise-floor calc,
1% low methodology, what "measured/verified/expected" mean). Mostly already true internally (it's
in code + specs) — the task is publishing it as a Blackbook/site content page. This is Layer 2
(content engine) work per `MONETIZATION_PLAN.md` — $0, no owner unlock needed, the doc already
names this as the highest-leverage lever available right now. Fold into the ongoing
content-publishing lane rather than treating as a separate initiative.

### 4.6 Non-competitive consumer story
Source: persona 7. Add one site/content narrative for the stutter/story-game use case (not
latency-obsessed): "Your game stutters after forty minutes — Compy records when the spikes start,
what GPU/memory were doing, and whether the next change fixed it." Content-only, low effort, fits
the Layer 2 content lane.

### 4.7 Shop Report Mode — do NOT build, log as parked
Source: persona 8. The review itself calls this premature before consumer validation, and
`MONETIZATION_PLAN.md` Layer 4 already says "parked, post-traction, no page until the owner asks."
Log the pilot scope (job name → before scan → approved changes → after scan → rollback → signed
export) in BACKLOG as a parked future item for traceability. **Do not scope or build now.**

### 4.8 Basic-mode simplification
Source: persona 1 — one verdict, one action, one what's-changing explanation, one restore
explanation, one next-step-after-playing. Check FirstCheck / the verdict-card flow for existing
coverage before treating as new — this may already be substantially the current default
experience; scope only what's missing (advanced instrumentation should reward exploration, not
gate basic completion).

### 4.9 Version policy
Source: recommendation #11. Installer is still `0.1.0` despite the May→July build gap being
enormous. Real, undecided process gap: beta build number vs. public semver vs. installer artifact
identity vs. displayed build hash vs. history/session compatibility + migration rules across
versions. **Draft a policy proposal** (this part is yours to do); the actual version-bump decision
and public-numbering scheme may need a quick owner nod once drafted — flag it to
`OWNER_ACTION_CHECKLIST.md` §D (taste/process sign-off) rather than deciding unilaterally, since it
touches how the public sees release maturity.

### 4.10 Cold-start user testing plan
Source: recommendation #9 — 3 non-technical gamers, 2 burned tweak-pack users, 2 enthusiasts, 1
privacy-focused user, 1 repair technician; measure comprehension of Lab/Gaming Mode/Undo/"no
measurable change"/what leaves the PC/install-despite-unsigned/what should cost money. **Not
currently tracked anywhere in this repo.** Fold into the beta-send planning (RUNG 3 /
`OWNER_ACTION_CHECKLIST.md` §B2) rather than standing up a parallel testing process — this is
naturally the same event as the beta send, just with a structured observation protocol attached.

---

## Part 5 — already tracked elsewhere, cross-reference only

Do not create new entries for these — they're already live in the repo's existing docs. If you're
touching the area anyway, confirm the cross-reference still resolves.

- Code signing, legal venue, domain purchase, beta smoke pass, tester distribution GO →
  `OWNER_ACTION_CHECKLIST.md` §A2, §B2, §C.
- NVIDIA hardware verification (recommendation #10) → `NVIDIA_VALIDATION_PLAN.md`, blocked on
  owner having/lending NVIDIA hardware. Reaffirm only.
- "Trending design tooling" (Figma/v0-Vercel MCPs) and "Upgrade-path engine" open forks →
  `OWNER_ACTION_CHECKLIST.md` §B4, `UI_VISION_BACKLOG.md` §E/§F. Already flagged, awaiting owner.
- B2B licensing page → `MONETIZATION_PLAN.md` Layer 4, explicitly parked. No action.

---

## Part 6 — execution order (suggested, not mandatory)

Cheapest/lowest-risk first, matching this repo's own SPORT MODE discipline (reversible work first,
owner-territory work flagged not executed):

1. Site copy scoping (3.1) — small, reversible, already owner-approved, goes through existing
   pipeline/tests.
2. Combined-effect attribution audit (Part 2 item) — light QA pass.
3. Doc triage itself (Part 4 items → BACKLOG/UI_VISION_BACKLOG/OWNER_ACTION_CHECKLIST, with
   cross-references from Part 5) — pure documentation, no code risk.
4. Non-competitive consumer story + methodology page (4.5, 4.6) — content-only, Layer 2, $0.
5. Version policy draft (4.9) — documentation, flag the numbering decision to the owner rather
   than deciding it.
6. Cold-start testing protocol (4.10) — fold into beta-send planning, don't build a parallel track.
7. Basic-mode + intent-router gap analysis (4.2, 4.8) — check existing coverage before scoping new
   build work.
8. "Optimization Cleanup" (4.1) — the one genuinely large new feature here. Its own spec'd train,
   own mutation-gate pass, after the above settle. Do not fold it into a same-session build.

Report back per standing token discipline: commit hash(es) · 1-2 line what-changed per item ·
verification line · any owner-decision flags raised. Nothing else needed in the report — this
brief plus the archived review carries the reasoning.
