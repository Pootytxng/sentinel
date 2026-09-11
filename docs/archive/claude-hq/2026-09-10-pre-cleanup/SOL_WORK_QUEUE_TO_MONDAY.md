# Sol work queue — now through Monday reset

**Context:** Claude's weekly limit is spent. This is everything that does not need Claude's judgment,
ordered by value. Work top-down. **One lane at a time** — finish and land an item before starting the
next.

**First reads, in order:** `claude/HQ_DECISION_LEDGER.md` → `claude/RIG_IDLE_DOSSIER.md` →
`claude/HANDOFF_JAIKARAN_AND_RIG_2026-08-14.md` → issue **#127**.

**Starting state (verify before trusting):** fleet = desk = **v0.9.25 (`efde8310`)**,
`main == origin/main` @ **`8c547ce7`**, tree clean, strict verifier **32/32 · 0 drift**, Compy running
with no debug port. Confirm with `git branch --show-current`, `git status --short`, and
`node scripts/verify-release-state.mjs --strict` before your first change.

---

## THE HARD RULES (violating these is worse than shipping nothing)

1. **Do not publish to the fleet.** Kuya holds the GO, in his own words, every time. Desk builds and
   look-reviews are fine; `release-publish.ps1` is not.
2. **Evidence before done.** A claim without named evidence is a guess wearing a claim's clothes.
3. **bug → guard, and falsify the guard.** Reintroduce the defect, watch it go red, put it back. ~90
   seconds. Non-negotiable now.
4. **LOOK at every desk build on the installed binary.** Three of the last six builds had a green
   suite and a failed look.
5. **`docs/RELEASE_STATE.md` is authoritative** — update it in the same commit that changes state.
6. **MINT RULE:** `release-prepare.ps1` mints `configured + 1` and commits BEFORE gates run. A failed
   prepare still burns the number. Pre-declare the NEXT number on any re-prepare.
7. **Never leave the tree dirty or a flag flipped.** Scratch `.ps1`/`.mjs` go in `$env:TEMP`, never in
   the repo — prepare and publish refuse a dirty tree.
8. **PowerShell 5.1:** inside `-Command "…"` you lose `$env:X` and nested quotes fail to parse. Write
   a wrapper and run with `-File`. Long commit messages / issue bodies: `-F` / `--body-file`.

---

## P0 — #127 RIG-IDLE + rig wheel ownership (ONE lane, both fixes)

**The single most valuable thing available.** Compy idles at **24.037% of one core** on Home; the rAF
frame loop is **20.137 of it (83.8%)**; freezing rAF drops the app to **2.353%**. Every user pays this
on arrival because `compy_home_rig_3d` defaults ON and Home is the landing screen.

**Step 1 — the cheap decisive test, before touching any code.** Re-run
`node scripts/q7-probe.mjs attribute --port 9455 --settle 30 --phase 60` with
`compy_home_rig_3d="0"`, diff the rAF band, **then restore the flag to `"1"` and confirm it**.
If the band collapses toward the 1.8 baseline, the rig owns it. **If it does not, #127 is wrong — say
so loudly and stop.** That refutation is worth more than a fix built on a bad premise.
⚠️ The probe **overwrites `docs/perf/raw/idle-attribution.json` in place** — that file is the
2026-08-06 baseline. Copy your result out, then `git checkout --` it back. Every run.

**Step 2 — the fix.** Diagnosed mechanism: drei's `OrbitControls` calls `controls.update()` from
inside a `useFrame` and invalidates on the controls' `change` event; r3f v9 treats an in-frame
`invalidate()` as `frames = 2`, which decrements to 1 and never reaches 0, so `frameloop="demand"`
latches free-running. Candidate: `enabled={orbiting || interacting}` on `<OrbitControls>`
(`RigHologram.tsx:491-501`), driving `interacting` from the existing `onStart`/`onEnd`. Alternative in
dossier §6.

**Step 3 — ride the wheel fix along, same lane, same file.** On v0.9.24 a single canvas wheel event
moved page scroll **0 → 228**; a short stream moved it **0 → 419**. Re-confirm on v0.9.25 first (UX-1
restructured this surface). Contract: one wheel stream, one owner — over the rig the page must not
move; outside it, shell scrolling is normal; real nested scrollers keep working. Fix shape is an
explicit interactive-zone exemption, **not** disabling shell scroll globally. These two fixes touch
the same `enabled` behaviour — doing them separately means the second invalidates the first's
measurement.

**Step 4 — acceptance.** Re-run the probe and **show the rAF band moved**. Not "it feels smoother".
Guard both contracts and falsify both guards.

**Already eliminated — do not re-investigate:** the Geist font, `compy_hologram_v2` (checked `null`),
`use-rig-colors` churn (chunk name is a Vite red herring), `nextFanSensors`, and any rig source change
in v0.9.18..v0.9.25.

## P1 — Close the feedback-draft P0 honestly

Shipped in v0.9.25 (`36d3a0c7`) and guarded, but **only three of the four paths were verified**.
Unit guards cover unmount→remount and were falsified. On the installed binary, only *restore-on-mount*
was confirmed.

**Verify on installed v0.9.25:** type a distinctive multi-line note, then (a) leave Settings by
**every** route including **Done**, (b) reload the app, (c) force a **failed submit**. Only after all
three does this become `fixed + guard proven`.

⚠️ **The CDP target picker follows the rail, and Settings has no rail.** Once Settings is open,
`cdp-eval-file` silently attaches to the in-game overlay window — you will see `textareaCount: 0` and
wrongly conclude the component is missing. Tell-tale: `document.body.textContent.length` ≈ 46 and
`cdp-shot` printing `WARN: no rail-bearing window found`. **Do everything inside Settings from ONE
eval issued while the rail is still present** — click the gear and schedule the rest in a `setTimeout`
in the same expression. React inputs need the native value setter + an `input` event.

## P2 — The second draft-loss channel (same class, different surface)

`App.tsx:373-375` — the export-modal feedback fields `fbWhat` / `fbConfusing` / `fbNext` are plain
`useState`, exactly like the bug just fixed. One-train job now the pattern exists: mirror through
`safe-storage`'s `lsGet`/`lsSet`, restore with a lazy initialiser, clear only on explicit discard.
Copy the shape from `src/surfaces/FeedbackExport.tsx`. **Add `localStorage.clear()` to that test
file's `beforeEach`** or drafts leak between cases.

## P3 — Jaikaran's remaining items (in this order)

1. **Intermittent freeze — measure AFTER #127 lands.** A frame loop eating a fifth of a core is the
   leading explanation. Bounded wheel + room-switch trace: input latency, long tasks, dropped frames,
   renderer CPU. Repeat with reduced motion to separate motion scheduling from room lifecycle.
   PR #76 overlap is **not** proof.
2. **Session appears only after restart.** Run the scenario before changing anything: keep Compy open,
   complete a capture **>60s with presenting game frames**, wait for finalization, inspect
   Play/Sessions **without restarting**, and **save the evidence before reopening Compy** — that
   ordering is the whole experiment. Short and no-frame captures are the negative controls. Current
   source has no app-level session-finalized refresh signal; `e5a5179` is adjacent, not a fix. Fix
   shape: emit one completion event after successful persistence, refresh only session summaries in
   the mounted UI, never for short/empty/failed captures.
3. **Lab/Home parity** and **diagnostics attachment** are **product decisions — Kuya's, not yours.**
   Bring recommendations with evidence; implement neither on your own initiative. PR #90 is merged and
   may already satisfy part of parity — share scene semantics without stripping Lab's evidence
   instrumentation. Any diagnostics attachment must be visible, previewable, bounded, redacted and
   explicitly opted into; the current refusal to auto-attach is **intentional safety behaviour, not a
   defect**.

Every item ends with exactly one disposition: `reproduced on candidate` · `already changed —
installed verification pending` · `fixed + guard proven` · `still present` · `product decision` ·
`insufficient evidence`.

## P4 — Forensics: why did idle CPU grow ~11× with no rig source change?

No file under `src/surfaces/rig/` changed between v0.9.18 and v0.9.25, yet the rAF band went
1.813 → 20.137. `@react-three/fiber`, `@react-three/drei` and `three` are all **caret ranges**, so a
lockfile refresh may have pulled in the `frames = 2` behaviour.

```
git log -p cfc0c4b7..HEAD -- package-lock.json > $env:TEMP\lockdiff.txt
```
Report only version transitions for those three packages, plus what `npm ls` shows installed now.
Cheap, mechanical, and it may explain everything.

## P5 — Test-coverage gap audit (never started; still valuable)

jsdom **loads no stylesheets**, so any defect living purely in the CSS cascade is invisible to the
330-file suite by construction. Three builds shipped visual defects with a fully green suite.

Scan the test tree and document **what categories the suite cannot see**: cross-file selector
specificity, layout overflow, font cascade, colour-on-colour contrast, and — newly proven — **runtime
cost** (#127 renders correctly and simply burns CPU; no amount of looking would have caught it).
Recommend guard shapes (static CSS text scans; instrument runs wired to a budget). **Report the gaps;
do not implement guards** — law 3 requires a caught defect first, and the report is what justifies
them.

## P6 — Housekeeping (governance train, ~5 min + full gate)

Retiring an `origin/*` ref **requires dropping its row from `docs/BRANCH_DISPOSITIONS.md` in the same
change**, or the audit fails every lane afterwards.

- Verify merged, then retire: `origin/claude/foreground-courtesy-handoff-82687b`,
  `origin/docs/design-foundation`. **NEVER `beta/private-beta-001`** — LOCKED by CLAUDE.md regardless
  of merge status.
- Local-only, no row needed: `design/ux1-front-door`, `perf/update-pill-and-feedback-draft`.
- Dead worktrees: `.claude/worktrees/design-foundation-a1`,
  `.claude/worktrees/merge-prs-tauri-visibility-c5660e` (detached `defcf0ff`).
  **Keep:** `C:\Users\Kuya\code\sentinel-feedback`, `C:\Users\Kuya\code\sentinel-quietpitwall`.
- `git fetch --prune` first. Report the delta before deleting anything.
- **#122 is closeable on evidence** — ref gone from origin, row dropped (`92315eaa`), audit green.

## P7 — Deferred UX-1 work, only if the queue above is clear

The four corner `ArcGauge`s demote to one ranked quiet footer line (`RoomShell`'s `quiet` slot) —
"ranked, not deleted", per design decision 1. Requires rewriting
`home-console-standard-readout-guard.test.tsx` (which pins the four readouts as STANDARD — the *data*
being ungated is the contract, not the corner it sits in) plus the corner selectors in
`home-console.test.tsx`. **If #127 restructures the stage anyway, do these together.**

Also small and in the same neighbourhood: `RigCase.tsx:42-45` lerps opacity asymptotically and never
reaches its target, so the scene is never *provably* at rest. Snap to target below an epsilon.

## DO NOT START

- **Step ③ (the interview).** It is the next *design* lane and needs Kuya's attention on the shape,
  not a solo build. It is behind #127 by decision.
- **Anything that emails or names a human.** Draft, never send.
- **A second lane in parallel.** Law 5, by owner decision, is literal.

---

## END-OF-RUN REPORT FORMAT

Lead with verdicts, not process. For each item touched: what you did, the **named evidence**, the
disposition, and whether its guard was falsified. If #127's decisive test refuted the diagnosis, that
goes first and everything else is secondary.

Finish with: `git branch --show-current`, `git status --short`, `node scripts/verify-release-state.mjs
--strict` output, and confirmation that no flags were left flipped and no debug port is open.
