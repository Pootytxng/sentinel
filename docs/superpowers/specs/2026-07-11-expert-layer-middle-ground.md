# Expert layer — the middle-ground proposal (consumer-panel Q3, owner-directed research)

> Owner's Q3 answer (2026-07-11): *"research into this to find the best middle ground to appease the
> largest consumer interest range. definitely finding a way to allow for the tinkerer to have their
> full panel of tweaks to fuel their junky cravings if they so choose."*
> Status: **GO (2026-07-12) — verified against source, one added ship condition.** The verification
> confirmed the central claim is real, not aspirational: `local_percentiles`, `friendly-labels.ts`,
> `export_report`, and the catalog's reasoning fields all exist (the "why" name below is a loose
> paraphrase of the catalog's description/impact/downside fields, not a literal field — the substance
> holds), and the live "Deliberately refused" drawer already carries a one-line reason per item plus
> an autopsy link, so §1's "default-open" framing is accurate.
> **ADDED CONDITION (must ship with §1's inline targets):** wherever Expert view shows the exact
> registry key / service / setting inline, a one-line disclaimer sits next to it — **edits made
> outside Compy aren't tracked and can't be rolled back by Compy.** Showing the raw target is new
> information exposure even with zero new mutation paths; the honest boundary must ship with it.
> Builds as its own scoped train (not part of the closed consumer-panel marathon). Nothing built yet.
> Hard boundary throughout:
> the tinkerer's "full panel" spans **non-LOCKED items only** — no override on the barred-refusal
> tier, no kernel driver / CPU temp (both stay in the plan's "Reopened" owner conversation).

## What the research actually says

1. **The panel's target-consumer finding stands:** the primary audience is the recovering skeptic;
   only 1 of 5 personas wanted an expert layer. Whatever we build must be *invisible until asked
   for* — an opt-in, never a default face.
2. **The Tinkerer's respect went to "NEEDS YOUR CALL"** ("here's exactly where each one lives, with
   the steps") — *informing rather than managing*. His complaint was never missing data; it was
   data he could see existing but not reach: the refused drawer closed by default, reasoning a tap
   away, "top N%" instead of raw numbers.
3. **Most of the "expert layer" already exists in the repo** — it's presentation-gated, not
   missing: every rec carries its technical name (`friendly-labels.ts` tech tags), full reasoning
   (`why` in the catalog), a details drawer, per-tweak apply/undo, a full 191-entry Blackbook, a
   real export (`export_report`), and an unrendered `local_percentiles` field the UI rounds to
   "top N%".

**Conclusion: the middle ground is not a new surface — it's an "Expert view" preference that
un-hides what Compy already knows.** Cheapest build, zero new mutation paths, zero dilution of the
default simplicity (the skeptic never sees it), and the Tinkerer gets his full panel.

## Proposed: one Settings preference — "Expert view" (default OFF)

A genuine user preference (like Motion), NOT a preview flag — it survives the Q2 flag-debt rule.
When ON:

1. **Full-panel Optimize:** the "Deliberately refused" drawer renders open with each item's full
   reasoning inline (informing, not managing). Needs-your-call and safe rows show the technical
   name + the exact target (registry key / service / setting) inline instead of behind "What's
   this?". All catalog data that already exists — display only.
2. **Raw numbers:** session/benchmark stats render raw measured values + true percentiles
   (`local_percentiles`, already computed, currently rounded to "top N%"). No new measurement.
3. **Per-tweak granularity is already the contract** (every row applies/undoes individually) — the
   expert view just stops visually de-emphasizing the long tail below the enable-all hero.
4. **Explicitly NOT included:** any override on the barred tier (LOCKED rule 6a), any new tweak,
   any new probe. The verdict-key copy tension ("lets you decide with eyes open" vs the barred
   tier) stays in the plan's Reopened owner conversation — this proposal doesn't touch that copy.

## Cost / risk

Presentation-only over existing data + one localStorage preference: roughly a day's train, fully
reversible, no mutation-boundary diff, no RELEASE_STATE gate. Riskiest part is visual crowding —
handled by the standard self-review gate.

## The ask

Owner: **GO / adjust / park.** On GO this becomes its own scoped train (not part of the 2026-07-11
consumer-panel marathon, which closes with this proposal as Q3's deliverable).
