# Spec — Lab welcoming pass (comprehensible + inviting for newcomers)

**Date:** 2026-06-10 · **Lane:** Cowork-specced → CC builds · **Class:** frontend copy + markup, reversible
**Sequence:** lands AFTER the Fix-tab reword (`2026-06-10-fix-tab-reword.md`) — same file family, do in order.

## Why

Lab is the instrument-heavy room. A non-technical newcomer lands on `lab-sub`
("prove it, don't vibe it") and four collapsed cards — Benchmark, Latency, Tuning,
Diagnostics — with words like "MSI", "undervolt", "latency". The one-liners explain each
card, but nothing orients the *room*: what Lab is for, where to start, and — critically —
that **nothing here changes their PC.** Add a short welcome band that lowers the barrier
without dumbing the instruments down (bathroom law: signpost at the moment of need).

## Hard lines (do not cross)

- **Frontend copy + static markup only.** `Lab.tsx` + `Lab.css`. ZERO logic, IPC, cargo,
  new instruments, or polling. No new commands.
- **Doorknob law.** The welcome band is static (no knob) — must NOT look clickable
  (no `cmp-door`, no hover-lift, no chevron). The four cards stay the only clickable things.
- **Honest-measurement law.** Keep "prove it, don't vibe it" energy; no gains/boost language.
- **Read-only truth.** The reassurance is literally true (Lab only reads) — Benchmark/
  Latency/Tuning/Diagnostics mutate nothing. Don't weaken it to a hedge.

## Changes

1. **`lab-sub` reframe (L87)** — keep the spirit, add the welcome + safety in one line:
   - Current: `The measured instruments — prove it, don't vibe it.`
   - Proposed: `Your rig's instrument panel. Everything here only measures — nothing in Lab changes your PC. Start with Benchmark.`

2. **New intro band** — a static `<div className="lab-welcome">` directly under `lab-head`,
   before the first `LabSection`. Plain-language "what each instrument is for" in one short
   line each (newcomer translation of the jargon), e.g.:
   - `Benchmark` — *did a change actually move anything?*
   - `Latency` — *what's slowing the trip from mouse to screen?*
   - `Tuning` — *did your AMD undervolt hold up?* (only when `tuningGuide` present)
   - `Diagnostics` — *the raw facts Compy read about this rig.*
   Render as a non-interactive definition strip (term + plain gloss). It mirrors the existing
   one-liners in newcomer words; CC may reuse the card `oneLiner` strings if cleaner than
   duplicating — author's call, keep it DRY.

3. **`Lab.css`** — style `.lab-welcome` as a quiet panel (token colors only, no accent fill,
   no shadow/hover). Tuning row hidden via the same `tuningGuide` gate so non-AMD rigs don't
   see a dead term.

## Verification

`tsc` + `vite build` clean · `npm test` green (add/adjust a Lab render assert if one exists
for `lab-sub`; check `Lab.test.tsx` if present) · grep confirms no gains language · band has
no `cmp-door`/click handler (doorknob check) · frontend-only, cargo untouched · /check.
