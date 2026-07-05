# V2 nits + glanceable-fill pass — spec (Cowork, 2026-07-05)

> Owner live-reviewed the shipped V2 shell (all 5 rooms, maximized) on 2026-07-05 and chose
> **"fix the nits first"** + **"fill with glanceable content"** for the empty real estate.
> This spec covers both. Laws in force: honest-measurement (measured or honestly absent —
> never fabricated), one-mention (RoomShell verdict is the ONE summary; a fill card must not
> re-state what a row already says), answer-first (fills land BELOW the verdict/priorities —
> nothing pushes the verdict down), placement/doorknob, all-original. Frontend only — zero
> `src-tauri` diff, zero new IPC, reuse existing props/probes. Small commits, reversible.

## Nit 1 — the no-op receipt row (bug→guard)

**Symptom (live):** Optimize → Applied shows *"Disable telemetry task (compatibility-appraiser)
· Disabled → Disabled"* — a change arrow when nothing changed. The task was already Disabled
when Compy applied it, so the captured prior honestly equals the after-state.

**Root cause:** `Fix.tsx` renders `restores_label → applied_label` (lines ~612 and ~643)
with no case for `restores_label === applied_label`. Data is honest; the *render* implies a
change that didn't happen.

**Fix (Fix.tsx only):** when `restores_label === applied_label`, drop the arrow and render an
honest no-change label instead — e.g. **"Already <state> — no change needed"** (both the
collapsed ` · X → Y` line ~612 and the expanded "Before … → after …" ~643). Rollback affordance
for such a row stays consistent (rolling back a no-op must remain a no-op — do not synthesize an
Enabled target it never set).

**Guard (bug→guard, tier 1):** a vitest render test in `Fix.test.tsx` (or the nearest applied-row
test) pinning that an applied change with `restores_label === applied_label` renders the
no-change copy and NOT the `→` arrow. Non-equal states keep the arrow (unchanged).

## Nit 2 — glanceable fill for the empty areas

Both areas today end with dead space below the last real element. Fill with **measured-only**
glance cards, reusing data already in props (no new IPC).

### Home (`HomeV2.tsx`) — right-hand stat column, below the Trust-ledger card

Add two measured glance cards (same `hv2-card` chrome as the existing stat cards), in order:

1. **Drift watch** — from `readiness.drifts`.
   - Empty → **"Nothing's drifted"** + sub *"every applied change is still holding."*
   - N>0 → **"{N} setting{s} drifted off"** + sub naming ≤2 (honest plural, "and N more").
   - Tone: ok when empty, warn when N>0. This is the A5 drift-watch signal, surfaced
     glanceably on Home for the first time (not shown elsewhere here → no one-mention conflict).

2. **Drive health** — from `hw.disk_health` (SMART).
   - All OK → **"Drives healthy"** + sub *"{N} drive{s} · SMART OK"*.
   - Any not-OK → name the flagged drive + its status; tone warn. Never invent a health value —
     a drive with no SMART read is simply omitted from the count (honest coverage).

Both are read-only, measured, and absent-safe (a card whose source is empty/unavailable renders
its honest empty state, never a fabricated number). They sit BELOW the existing three cards so
the verdict + hologram + priorities order is untouched (answer-first).

### Lab (`LabV2.tsx` / `lab-v2-data.ts`) — foot of the room, below the instrument list

Honesty note: Lab's instruments already show their own latest status inline (Baseline date,
MSI/timer, "Too aggressive", System report), so a fill here must be a **consolidation overview,
not a repeat**. Add ONE quiet **"Latest readings"** glance strip that gathers the single newest
value each instrument produced into a compact row of stat chips (benchmark baseline date ·
latency headline · tuning verdict · crash-record present?/absent · diagnostics captured?). It is
a different affordance (at-a-glance overview vs. the drill-in rows) and pulls from the SAME
`bench`/probe reads already in the surface — zero new IPC. Any instrument with no reading yet
shows an honest "—", never a placeholder number. If on review this reads as one-mention drift,
it's a clean revert (one card, additive).

**Guards:** vitest for each new card — the empty/absent state renders the honest copy (no number),
and a populated state renders the measured value from a stubbed prop. No fabricated-value path.

## Verify (per commit)

tsc clean · vitest green incl. the new guards · `git diff -- src-tauri` empty · self-review
rubric on the flag-live dev build with shots in `docs/ui-sweep/shots/v2-fill/` (state the computed
text color on any accent fill; check empty vs populated for every new card).

## Build order

1. Nit 1 (Fix.tsx no-op row + guard) — smallest, self-contained.
2. Home fill (drift-watch + drive-health cards + guards).
3. Lab fill (latest-readings strip + guards).
4. Self-review + shots; then the silent-reinstall + stamp-verify (Claude's job, not owner's).

Owner eyeballs the reinstalled build; the specific card copy/placement is a taste iterate if he
wants it — cheap, additive.
