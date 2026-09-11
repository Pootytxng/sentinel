# Handoff — Jaikaran reconciliation + rig work, 2026-08-14

**Supersedes `claude/AUDIT_HANDOFF_SOL_2026-08-13.md`**, which was written against v0.9.24 before the
2026-08-13 evening lane. Paste this instead. Read cold.

**First reads:** `claude/HQ_DECISION_LEDGER.md`, then `claude/RIG_IDLE_DOSSIER.md`, then issue **#127**.

---

## ⚠️ CORRECTIONS TO THE PRIOR HANDOFF AND TASK LIST — read before acting

The 2026-08-13 Sol handoff and the follow-up 7-item list are both pre-v0.9.25. These points are now
**wrong**, and two of them are wrong in ways that would waste the owner's relationship or your time:

1. **"Preserve 'bichnege' verbatim" — RETIRED.** The owner confirmed it is an irrelevant typo. It is
   not a task, not a clue, not a question for J. Drop it entirely.
2. **"Do not send Jaikaran's held reply" — THE HOLD IS LIFTED.** The owner spoke to J himself. There
   is nothing pending on a drafted email. (The general law still stands: anything that names a human
   is the owner's call. But do not treat this specific reply as blocking anything.)
3. **Fleet is v0.9.25 (`efde8310`), not v0.9.24.** Published 2026-08-13T22:34:15Z, id `370249321`,
   9/9, alias attempt 1. Desk matches. `main == origin/main` @ `8c547ce7`, tree clean.
4. **The current lane is NOT step ③.** Step ③ was deferred, unstarted. The lane is **RIG-IDLE (#127)**
   — a measured performance regression. The instruction "run only after step ③ hands off" therefore
   has no trigger; treat #127 as the gate instead.
5. **Strict verifier is 32/32 · 0 drift**, not 31/31.
6. **P0 feedback-draft loss is FIXED and shipped** in v0.9.25 — see task 1 below for exactly what was
   and was not verified, because the follow-up list is right to be sceptical.

---

## CURRENT TRUTH

**Fleet = desk = v0.9.25 (`efde8310`).** Shipped in it: the update-pill `box-shadow` repaint fix and
the feedback-draft persistence fix. Both guards were falsified before being trusted; both were looked
at on the installed binary.

**Open, in priority order:**

| # | Work | Why this order |
|---|---|---|
| **#127** | **RIG-IDLE** — the rig frame loop is 84% of idle CPU | Measured regression every user feels on the landing screen. Also the leading explanation for J's P0 freeze. |
| — | **Rig wheel ownership** (J's P1) | **Same surface, same files as #127.** Ride it along; do not open a second lane on the rig. |
| — | Feedback-draft installed re-verification | Cheap, closes a P0 honestly. |
| — | Session-finalized refresh (J's P1) | Independent surface. |
| — | Lab/Home parity, diagnostics attachment (J's P2 ×2) | Product decisions, owner's call. |

---

## TASK 1 — Verify the feedback-draft fix on the installed 0.9.25 stamp

**The follow-up list is right to demand this, and here is exactly where the gap is.**

What shipped (`36d3a0c7`): the draft mirrors to storage on every keystroke via `safe-storage`'s
`lsGet`/`lsSet` and restores through a **lazy `useState` initialiser** in
`src/surfaces/FeedbackExport.tsx`. Root cause: `Settings` is a ternary swap at `App.tsx:1362`, so
leaving it **unmounts** the component; the note lived only in `useState`.

**What was actually verified — do not overstate it:**
- Four unit guards in `FeedbackExport.test.tsx`, **falsified**: reverting the lazy initialiser turns
  3 of 4 red. Covers unmount→remount, restored-draft-is-what-exports, empty-box discard, and
  no-IPC-on-mount-with-a-draft-waiting.
- On the **installed 0.9.25 binary**: a seeded draft was present in the feedback box after Settings
  mounted. Capture `v0925-draft-restored.png`.

**What was NOT verified on the installed build, and is your job:**
- **The `Done → Settings` round trip** specifically (the list says v0.9.24 reproduced loss on that
  exact path). The installed check seeded storage and confirmed restore-on-mount; it did not type,
  press Done, and come back.
- **The full app reload path.**
- **The failed-submit path** (draft must survive an export that throws).

**Do this:** on installed 0.9.25, type a distinctive multi-line note, leave Settings by **every**
available route including Done, return; then reload the app; then force a failed submit. Only after
all three pass is this `fixed + guard proven`.

**Trap that will cost you an hour:** the CDP target picker follows the rail, and **Settings has no
rail** — once Settings is open, `cdp-eval-file` silently attaches to the in-game overlay window and
you will see `textareaCount: 0` and conclude the component does not exist. Tell-tale:
`document.body.textContent.length` ≈ 46, and `cdp-shot` printing `WARN: no rail-bearing window
found`. **Do everything that must run inside Settings from ONE eval issued while the rail is still
present** — click the gear and schedule the rest in a `setTimeout` in the same expression. React
inputs need the native value setter + an `input` event, not `el.value = x`.

## TASK 2 — Home rig wheel ownership (J's P1) — RIDE THIS WITH #127

**New measured evidence from the prior audit, carry it forward:** on v0.9.24, **one canvas wheel
event moved page scroll 0 → 228**; a short wheel stream moved it **0 → 419**. That is a quantified
reproduction, not a report. Re-confirm on v0.9.25 first — **UX-1 restructured this exact surface**.

**Contract:** one wheel stream must have exactly one owner. Over the rig, the rig owns it and page
scroll must not move. Outside the rig, shell scrolling is normal. Real nested scrollers keep working.

**Shape:** an explicit interactive-zone exemption. Do not fix it by disabling shell scroll globally.

**Why it rides with #127:** both live in `RigHologram.tsx` / the rig host, and #127's candidate fix
touches `<OrbitControls>` `enabled` — which is *also* what governs wheel capture. Fixing them
separately risks two lanes fighting over one file, and the second fix invalidating the first's
measurement. **One lane, both fixes, one look, one re-measure.**

**Guard it and falsify it:** pin the one-owner contract (wheel over rig ⇒ page scroll delta 0; wheel
outside ⇒ normal). Reintroduce the defect once, watch it go red, put it back.

## TASK 3 — #127 RIG-IDLE (the lane gate)

Full evidence in `claude/RIG_IDLE_DOSSIER.md` and issue #127. Headline: **idle 24.037% of one core on
Home, rAF 20.137 of it (83.8%), 2.353% with rAF frozen**; ~11× the 2026-08-06 baseline. Diagnosed
mechanism: drei `OrbitControls` updates inside a `useFrame`, r3f v9 latches `frames = 2` on an
in-frame `invalidate()`, so `frameloop="demand"` never returns to 0.

**Already eliminated — do not re-investigate:** the Geist font, the `compy_hologram_v2` flag (checked
`null`), `use-rig-colors` churn (chunk name is a Vite red herring), `nextFanSensors`, and any rig
source change in v0.9.18..v0.9.25.

**Start with the cheap decisive test:** re-run `q7-probe attribute` with `compy_home_rig_3d="0"`,
diff the band, **restore the flag**. If the band collapses, the rig owns it. If not, #127 is wrong —
say so loudly, that is the most valuable outcome available.

**Acceptance is the probe, not a feeling.** Re-run `q7-probe attribute` after the fix and show the
band moved. `docs/perf/raw/idle-attribution.json` is the 2026-08-06 **baseline** — the probe
overwrites it in place, so `git checkout --` it back and save your run under a dated name.

## TASK 4 — J's intermittent freeze: measure, don't assume

The follow-up list is right that **PR #76 overlap is not proof**. But note the strong prior now: a
frame loop eating a fifth of a core is exactly what makes scroll and room-switch stutter on his
RTX 3060 Ti / Ryzen 5 5600X.

**Do #127 first, then re-run his scenario.** A bounded measured wheel + room-switch trace (input
latency, long tasks, dropped frames, renderer CPU) is still the right instrument — but running it
before the frame-loop fix measures a machine you already know is sick. Repeat with reduced motion to
separate motion scheduling from room lifecycle.

## TASK 5 — Session appears only after restart (J's P1)

Unchanged and still open. Current source has **no app-level session-finalized refresh signal**:
successful persistence raises the native "debrief ready" notification, but the mounted session list
has no completion signal that reloads summaries. `e5a5179` is adjacent notification work, not a fix.

**Run the qualifying scenario before changing anything:** keep Compy open, complete a capture >60s
with presenting game frames, wait for finalization, inspect Play/Sessions **without restarting**.
**Save the evidence before reopening Compy** — that ordering is the whole experiment. Short and
no-frame captures are the negative controls.

**Fix shape if still open:** emit one app-level completion event after successful persistence and
refresh only session summaries in the mounted UI. Do not emit for short, empty or failed captures.
Guard manual capture, Gaming-Mode capture, delayed finalization, and background→foreground return.

## TASK 6 — Product decisions (owner's call, not yours)

- **Lab/Home diagram parity:** PR #90 (Lab Rig Evidence Map) is merged and may already satisfy part
  of the request. Share scene and interaction semantics; **do not remove Lab's evidence
  instrumentation** to achieve sameness.
- **Diagnostics attachment:** the current refusal to auto-attach is **intentional safety behaviour,
  not a defect**. If ever approved it must be visible, previewable, bounded, redacted, and explicitly
  opted into. Never a silent attach or background upload.

Bring these back as recommendations with evidence; do not implement either on your own initiative.

---

## STANDING RULES THAT WILL BITE YOU

- **Evidence before done.** A claim without named evidence is a guess wearing a claim's clothes.
- **bug → guard, and falsify the guard.** Reintroduce the defect, watch the guard go red, put it
  back. ~90 seconds. This is standard now, not a flourish.
- **LOOK at every build on the installed binary.** Three of the last six builds had a green suite and
  a failed look. **And know what looking cannot catch:** #127 is invisible on screen — the app
  renders correctly, it just burns a fifth of a core. Eyes catch layout and type; only instruments
  catch cost.
- **One lane at a time**, by owner decision.
- **Do not publish without Kuya's explicit GO.** He has given advance GOs in plain words before, and
  every lane still sent him the look captures before running the publish. Do that.
- **`docs/RELEASE_STATE.md` wins over prose.** Update it in the same commit that changes state.
- **PowerShell 5.1:** inside a `-Command "…"` string you lose `$env:X` and any nested double quote
  fails to parse. Write a wrapper `.ps1` to `$env:TEMP` and run with `-File` — **never into the repo**,
  prepare/publish refuse a dirty tree. Long commit messages / issue bodies: use `-F` / `--body-file`.
- **The Cowork↔desk bridge drops mid-lane** (three consecutive lanes). On reconnect: `RefreshMcpTools`,
  re-load Desktop Commander schemas, then re-run `git branch --show-current` + `git status --short`
  before touching anything. **Detached background jobs keep running through the outage** — check the
  log, do not restart them.
- **#121:** the pre-push gate is desk-state dependent. Compy OPEN for push + prepare, CLOSED for
  prove/publish, reopened for the doc-sync push. Do not re-diagnose it.

## REPORT FORMAT

Lead with the verdict, not the process.

1. **Draft persistence on installed 0.9.25** — the three paths, pass/fail each, disposition.
2. **Rig wheel** — v0.9.25 re-measurement (page-scroll delta), fix, guard + its falsification.
3. **#127** — before/after rAF band from the probe. This is the acceptance evidence.
4. **Freeze trace** — measured, after #127, with the reduced-motion control.
5. **Session refresh** — scenario result and disposition.
6. **Product decisions** — recommendation + evidence, no implementation.

Every J item ends with exactly one disposition: `reproduced on candidate` · `already changed —
installed verification pending` · `fixed + guard proven` · `still present` · `product decision` ·
`insufficient evidence`.
