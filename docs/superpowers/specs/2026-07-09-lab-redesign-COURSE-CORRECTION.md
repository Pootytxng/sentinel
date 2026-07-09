# Lab redesign — COURSE CORRECTION (owner rejected the marathon, 2026-07-09)

> **STATUS: the `2026-07-08-lab-proving-ground.md` spec's UI direction is WRONG per the owner and is
> SUPERSEDED by this brief.** The catalog/mutation-safety parts of that spec (Directive 1 measurable-
> benefit policy, §2a aggregate A/B, the safety rails) still stand. But its **layout/UX direction —
> "retire the bento, collapse to ONE linear accordion spine, build a drag/scroll telemetry gallery" —
> is REJECTED.** Do not build from it. This file is the source of truth for the redesign.

## What the owner rejected (verbatim intent, 2026-07-09)

Owner reaction to the shipped `f16d158` blended Lab (flag DEFAULT OFF, so his live app was unaffected —
the rejection is of the *work/direction*, not a live regression):

1. **The telemetry gallery "makes 0 sense" and looks terrible.** He **explicitly told me NOT to add the
   scroll/drag gallery from his sister's site** — only to **reference that _type_ of design effect** and
   to **understand the LEVEL of animated effect + the design styles he wants in the app.** I cloned the
   feature instead of learning the language. The drag gallery is out.
2. **I got rid of the bento-style layout and reverted to the OLD linear layout we had already binned**
   after agreeing it was bad. The bento was the good direction; the accordion/linear "spine" was not.
3. **Nothing about this reads as Tony-Stark / high-tech / JARVIS.** The animated, reactive, "living
   instrument" feel he has described *multiple times* is absent. That feel is the actual goal.
4. Net: "you haven't implemented a single thing in the direction I described multiple times." The whole
   train pointed the wrong way.

## What the owner wants INSTEAD (the corrected process — approval BEFORE build)

He is **not** asking for another build pass. He is asking for a **design-discovery + approval gate**:

1. **Consult the council** (`docs/COUNCIL_PROTOCOL.md`) on the direction.
2. **Do real research** — study the *type/level* of animation & design language he's pointing at
   (JARVIS / high-tech HUD / his sister's site as a STYLE reference, NOT a feature to clone), find
   concrete references/examples.
3. **Draw something up** he can be confident fits his descriptions — **with examples to link/show him
   and the sources cited** (where the ideas/effects came from).
4. **Then ask him detailed, easy-to-understand questions** so he can give a clear yes/no on the
   direction **before any code is written.** No building until he passes on it.

### Open reference to clarify with him
- **"exebenus" / "exebenus website"** — a reference he named that I do NOT recognize. Confirm exactly
  what site/company/portfolio this is (spelling?) and what about it he wants echoed. Do not guess.
- Confirm the **bento** stays as the Lab's layout basis (he liked it; I wrongly removed it).
- Confirm the sister's site (`sister-site-tau.vercel.app` / Prickly Creations) is a **style/effect
  reference only** — the specific scroll gallery is explicitly NOT wanted.

## The shipped code (what to do with it)
- `f16d158` is LIVE but **flag `compy_lab_ground` DEFAULT OFF** → the owner's app is byte-identical; the
  wrong work is inert, not in front of him. **Leave it inert for now; do NOT revert reflexively.** The
  redesign decides per-piece what to keep (the §2a DARK aggregate-A/B backend + the mutation-safety work
  are fine and orthogonal to the UI direction; the §3 gallery + the bento→spine collapse are the parts
  to replace).
- The `compy_lab_bento` flag/layout still exists in the tree — the bento the owner liked is NOT gone
  from git, only from the `ground` room. Good starting point for the redesign.

## Second, PARALLEL ask — repo / .md maintenance
Owner: *"do a full system and file directory maintenance to organize, refine, optimize, and improve all
relevant .md files and everything else in the sentinel directory that is possibly diluting the quality
of your work or interfering with achieving the task."* Root cause this addresses: **a stale/misaligned
spec (2026-07-08 proving-ground) actively steered me the wrong way** — doc clutter/drift is not cosmetic,
it corrupts execution. Scope to define with the council: audit `docs/` + specs for contradictions,
stale/superseded direction, duplication; consolidate; flag anything that could mislead a fresh session.
Treat this brief as slice 0 of that cleanup (it supersedes the wrong UI direction in one place).

## Next step (for the fresh session)
Invoke the **brainstorming** skill (design/creative work) + **council**. Research references for the
JARVIS/high-tech animated language + confirm the bento basis. Produce a referenced proposal + a short,
plain-English question set for the owner's go/no-go. **No code until he approves the direction.**
