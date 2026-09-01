# Owner action checklist — resolved §A items (archive)

> Moved out of [`docs/OWNER_ACTION_CHECKLIST.md`](../OWNER_ACTION_CHECKLIST.md) on **2026-08-04**
> under TOKEN LAW §1 (docs carry CURRENT STATE only; history moves to `docs/archive/*` with a
> pointer, never deleted). **Nothing in this file is waiting on the owner** — every item below was
> closed by his own verdict, and the closing verdicts are preserved verbatim so the record of what
> he approved, and when, survives. The live checklist keeps §A0 (the one §A item still open).
>
> Point-in-time records. Verify against `docs/RELEASE_STATE.md` before relying on any gate claim.

---

## §D — taste / visual sign-offs the owner already closed

> Moved out of [`docs/OWNER_ACTION_CHECKLIST.md`](../OWNER_ACTION_CHECKLIST.md) §D on
> **2026-08-22** for its BYTE budget. Every entry below is ✅ closed by the owner's own
> verdict, preserved verbatim. **Nothing here is waiting on him.** The live §D keeps only the
> two entries that still want his eye (the site-hero direction pick, and the Home→Health
> rename recommendation).

- ✅ **ANSWERED 2026-08-20 — the interview: he said turn it on, with one objection.**
  · [`decisions/2026-08-20-home-interview-default.md`](../decisions/2026-08-20-home-interview-default.md)
  · [`superpowers/plans/2026-08-20-comprehensibility-sweep.md`](../superpowers/plans/2026-08-20-comprehensibility-sweep.md)
  His words: *"i like it i just dont like the placement for the help me with my pc"*. So the default
  flips ON, but **not on its own** — it flips in the lane that first fixes where that button sits,
  so the Home that ships on by default is the one he approved. **CLOSED 2026-08-20 the same day:**
  his "Clean header" pick shipped in desk build `ab54f1e4` (button on the verdict line, fine print
  routed to Test, default ON), self-review PASS, before/after handed to him. Nothing left on him here.

- ✅ **The title foil sweep now stops instead of looping forever — APPROVED 2026-08-06**, on a
  side-by-side before/after he watched run.  ·  PR [#76](https://github.com/Pootytxng/sentinel/pull/76)
  The shine that travels across the big room titles used to repaint that text on every single frame,
  forever, in every room — on its own it was **29.8% of one CPU core** while he did nothing. It now
  sweeps once when a room opens and settles. His verdict, verbatim: *"keep the more efficient shine
  change youre right compy isnt suppose to be a resource hog whatsoever matter of fact it should be
  the most optomized thing oin someons pc altoether."* That second sentence is a **standing product
  bar**, not a note about this one animation — recorded in [`perf/README.md`](../perf/README.md).
  Nothing further on him here; the `infinite` revert is not being held open.
  Two things rode along and remain open: the 3D "two futures" scene could not be visually checked
  (it only mounts once he has a measured before/after pair, which this desk lacks — its diff is a
  screen-reader label only), and `src/surfaces/Optimize.css:175` still has a pre-existing bounce ease
  this lane deliberately did not touch.
- ✅ **Version numbering call — DECIDED 2026-07-16: "0.9.0 now, 1.0.0 at Claude's bar."** Applied same
  day (manifests + Cargo.lock at `0.9.0`, ship-reinstall derives the filename, drift-guard test added);
  spec flipped to DECIDED:
  [`superpowers/specs/2026-07-16-version-policy-proposal.md`](../superpowers/specs/2026-07-16-version-policy-proposal.md).
  Nothing further on you until the 1.0.0 confirmation moment.
- ✅ **Version numbering call — DECIDED 2026-07-16: "0.9.0 now, 1.0.0 at Claude's bar."** Applied same
  day (manifests + Cargo.lock at `0.9.0`, ship-reinstall derives the filename, drift-guard test added);
  spec flipped to DECIDED:
  [`superpowers/specs/2026-07-16-version-policy-proposal.md`](../superpowers/specs/2026-07-16-version-policy-proposal.md).
  Nothing further on you until the 1.0.0 confirmation moment.
- 🔨 **Site hero verdict: REJECTED → full compy.gg makeover commissioned (2026-07-14).** You saw the
  PART B two-strip hero (`2eda4eb`) and rejected it outright ("needs a complete makeover"). New
  directive logged in `docs/UI_VISION_BACKLOG.md` §G: research-first, spitball directions, decide
  together before build. Your open call here = **pick the direction from the spitball options** when
  presented. The two-strip's honesty guardrails (real-provenance receipts, no gain claims,
  `scripts/site-landing.test.mjs`) survive into any redesign. Site stays PRE-PUBLISH; deploy GO
  unchanged (§B3).
- ✅ **Motion default — RESOLVED 2026-08-05 as "keep `full`", on your standing 2026-06-19 decision.**
  The `design/quiet-pit-wall` branch (#49) wanted `src/design/use-motion.ts` to follow the Windows
  "reduce motion" setting by default. Your WebView2 reports `prefers-reduced-motion: reduce`, so that
  flip would have made the whole app static on your own desk — the exact failure your 2026-06-19
  decision was written after. Held, not landed; the guard still pins `"full"`, and anyone who *wants*
  Windows to decide already has it one click away in Settings → Motion (all three choices ship).
  Nothing changed in the app; this entry only ever existed to tell you a branch disagreed with you.
  Re-open it if you ever want the flip.
- ✅ **Sibling slop sweep — DONE + SHIPPED `f13d10a` (2026-07-08).** The `#1 BIGGEST LIMITER` uppercase
  tags in **FirstCheck** and the **Setup Tour** spotlight are now quiet lowercase "#1 biggest limiter"
  mono tags matching Home's fix (SetupTour de-ambered too); self-reviewer PASS 8/8, guard-pinned, live.
  Your eyeball is optional — you'll only see these on a first run / tour re-trigger; the main app's live
  look is unchanged.


---

### A0b. zh-CN (Simplified Chinese) — ✅ CLOSED: merged AND published in v0.9.11 (updated 2026-07-28)

The full zh-CN translation (`100ace3`) and the reversible ship/QA fixes (`e22be5e`, `719408b`) are
already on live `origin/main` at `20306bc` — the old merge hold is **closed**. Your 2026-07-24
follow-up also settled the vocabulary taste call: user-visible Real/Placebo/Risky labels are localized
as 真有效 / 安慰剂 / 有风险, with the full refusal badge 有风险 — 已拒绝. That completion ships with a
regression guard that rejects visible English verdict vocabulary anywhere in the zh-CN Black Book
(interpolation placeholder names excluded).

- ✅ **Merge the base zh-CN cut into `main`** — complete at `20306bc`.
- ✅ **Localize the verdict vocabulary** — your decision, resolved; completion + regression guard are
  integrated and now merged on `main` at `d000295`.
- ✅ **Publish into the in-app updater** — done. Your GO published **v0.9.11** (`7ba5fb6`) on
  2026-07-28; the public updater manifest now reads **0.9.11**, so the zh-CN completion is
  fleet-visible. v0.9.9 never reached `compy-releases`; v0.9.10's abandoned draft and releases-repo
  tag were deleted 2026-07-28 under your authorization, with its source tag and evidence preserved.
  The canary is done and PASSED (A0); the only fleet action still on you is whether to widen to the
  remaining invitees.

**Hosted CI is not on this list — by your own standing decision.** GitHub refuses every job before
runner startup under the account's $0 Actions budget; that was declined as a zero-budget-law spend
gate on 2026-07-16 (B7). It is a settled configuration, **not an open owner obligation** — nobody is
waiting on you to "restore CI," and you will not be asked for a billing change or budget raise again.
The full gate set runs locally instead.

### A1. Gaming Mode QA — ✅ CLOSED: SIGNED OFF (owner, 2026-07-14)  ·  full list: [`GAMING_MODE_QA.md`](../GAMING_MODE_QA.md)

**Owner said "gaming mode qa signed off" 2026-07-14 — F1 is field-proven for 1.0.** Nothing left on
this item. The feature is live. **ALL 10 cases are PASSED** (#4/#10 owner-run 2026-07-07; #1/#2/#3/#5/#8/#9
CC-automated on the installed build with ground-truth probes, 2026-07-14 — evidence per-case in the
QA doc):

- ✅ #6 UAC-cancel at START — owner-clicked 2026-07-14 on the `db5349e` build (this case caught a
  real bug first: the `runas` crate misread a decline as approved-then-failed + fired a spurious
  second prompt; fixed in `db5349e`, then #6/#7 re-run clean — see the QA doc's runas note).
- ✅ #7 UAC-cancel at RESTORE + retry — owner-clicked same run (Yes · No · Yes): decline retained the
  contract (`restore-failed`, no false success), retry restored everything.
- ✅ Sign-off — given 2026-07-14, recorded in the QA doc, CLAUDE.md, and RELEASE_STATE.

### A2. Beta smoke pass — before any invites go out  ·  full list: [`BETA_SMOKE_CHECKLIST.md`](../BETA_SMOKE_CHECKLIST.md)
**Status 2026-07-22 (supersedes "0 run"):** the **headless half is machine-verified** — see the
checklist's "HQ automated pass" block (§1 partial · §3 · §4-auto · §7 · §8; suites re-derived
cargo 858 / npm 1777; a real §6 presenter bug was caught and fixed same-day — `970f801` is on YOUR
box only). **SITTING WAIVED by your 2026-07-22 directive ("fully take over or skip") — resolution:** §2b
(the one item with real tester-facing detriment) was **run fully automated and PASSED** — the exact
link-served artifact installed over genuinely-seeded 0.1.0-era data, launched clean, data
preserved, zero crash events; your build + real data restored byte-exact after. §1/§4/§5/§6-live
and "feel" are **formally skipped with named risks (LOW to LOW-MODERATE)** — full grades in
`BETA_SMOKE_CHECKLIST.md`'s waiver block. Nothing here needs your hands anymore. Note: your UAC
policy checked stock-healthy (read-only); CC's "silent elevation" observation was not a policy
hole. **The only open beta item is the ride-vs-recut call in §B2.**
- **Result → tell Claude:** "Beta smoke passed" (or paste anything that looked off).

### A3. Lab Ops Console — ✅ RESOLVED (your round-4 "ALL GOOD", 2026-07-10) → default-ON SHIPPED
The eyeball gate is cleared and both your calls shipped in `59249bb` (2026-07-10, live on your Desktop
build): the **Ops Console Lab is the default** and the **standalone Optimize tab is gone** — the rail is
Home · Monitor · Blackbook · Lab, and the Lab's Optimize station (open-on-click, your "cleaner" call) is
the one door to the toggles, with "Applied & history" undo inside the panel. Nothing on you here anymore;
if anything feels off, Settings → Appearance → "Lab proving ground" OFF restores the classic look
instantly. Full thread: [`BACKLOG.md`](../BACKLOG.md) Cycles 2026-07-09f / 2026-07-10a–d.

### A4. Home console preview — your eyeball  ·  ✅ DONE 2026-07-10 ("everything looks good")
Approved and **shipped default-ON** (`bce72d6` live): Home now opens as the console for everyone;
Settings → Appearance → "Home console" OFF restores the classic Home instantly (the failsafe).

### A5. Monitor console — v5 "Flight Deck + Session Stack"  ·  ✅ DONE 2026-07-12 (you approved → "flip it default on"; shipped DEFAULT-ON `e195f70`)
The chain so far: v2 cluster ("satisfactory") → v3 ribbon (rejected) → v4 waterfall round 1
(rejected) → v4 rework round 2 → **your 2026-07-11 verdict: "doesnt seem to be working out like i
presumed … maybe just re work the whole thing to something else thats more likely to be
comprehensive."** So it's re-concepted mockup-first (the pattern that worked for the Lab):
**→ [Concept round 3 mockups](https://claude.ai/code/artifact/9ebf6305-e488-422d-b699-0c281b15676c)**
— **A Flight Deck** (everything on one face, plain-number deltas) · **B Session Stack** (each
session a flat mini-graph, one shared axis, stacked like a playlist) · **C Debrief Card** (grade +
side-by-side scoreboard in words and bars). All keep your musts (real graphs, exact spike moments,
MAX FPS-style terms, session comparison, overlay control, honest empties).
- ~~Result → tell Claude: "A" / "B" / "C" / a combine~~ → ✅ **PICKED 2026-07-11: "A's top +
  B's stack"** ("ooooo ya i like the mockups"). Build plan:
  [`2026-07-11-monitor-v5-deck-stack.md`](../superpowers/plans/2026-07-11-monitor-v5-deck-stack.md).
- **→ ✅ RESOLVED 2026-07-12:** you approved the flight deck and said "flip it default on and silent
  reinstall" — done. Monitor now opens on the flight deck for EVERYONE (live `e195f70`, installer
  `3B855DD1…FB003`, stamp-verified); Settings → Appearance → "Monitor console" OFF is the classic
  failsafe. Nothing on you here anymore. One known follow-up (a theme-color nit — the room's buttons
  stay violet under non-Violet themes while the session sparkline follows the theme) is logged for a
  later polish pass; it's invisible on your default Violet theme.

### A6. One look at the latest live build — three trains' visible changes  ·  ✅ DONE 2026-07-12 ("everything looks good so far on my end")
Your live app (`cc1ffce`, installed 2026-07-12) carries three not-yet-eyeballed trains; one open of
the app covers all three:
- **Consumer-panel overhaul (`50b5c03`):** Home/Lab gauge formula notes + first-exposure term
  glosses, Settings slimmed to ONE preview row, calmer protection-first recovery banner. (The site
  rebalance is part of this too but stays dark until your separate publish GO.)
- **Expert view (`5850ac0`):** Settings → Behavior → "Expert view" (default OFF) — flip it and skim
  Optimize/Benchmark: refused-drawer reasoning inline, exact registry/service targets with the
  rollback-boundary disclaimer, 1-decimal numbers, long sections open.
- **Home masthead (`cc1ffce`, today):** the header now says just "Home"; the "ready to play /
  N things need attention" verdict moved to its own line above the stage (your title-header law).
- ~~Result → tell Claude: looks-good / what's off~~ → ✅ verdict in, same day. (Deliberately NOT
  counted as the §A5 Monitor-v5 verdict — that one needs the Settings → "Monitor console
  (preview)" flip to even be visible.)

### A7. JARVIS motion layer — eyeball the preview  ·  ✅ DONE 2026-07-12 ("everything looks good") → flipped DEFAULT-ON
You eyeballed the motion layer (it was pre-enabled on your live build) and approved it. It's now
**default-ON** — the retune sweep between rooms, Lenis glide scrolling, magnetic rail tabs, Home
stage-chrome tilt, and honest gauge ticks are on for everyone, no flip needed. Settings → Appearance
still has a "JARVIS motion" toggle (now the OFF failsafe). Ships on its own commit + reinstall; your
live app carries it after this cycle's build. ~~Two disclosed deviations stand (you may still overrule):
hologram shader-pulses excluded (idle-GPU bar), and the Dock isn't magnetic (it owns the magnify lift).~~
→ **✅ RATIFIED 2026-07-14 ("lets go with your recommendation")** after an evidence review (captured
proof: dock 8px lift fires, rail tabs pull the full 4px clamp, hologram 0 GL draws in 15s idle —
`docs/ui-sweep/shots/deviation-*.png` + `motion-evidence-log.json`). **Both deviations STAND:** Dock
keeps lift-only; no hologram shader-pulse (the gauge data-tick is the vehicle). Noted for the future,
NOT queued: if he ever wants shader energy, the agreed shape is a change-triggered pulse (flash on a
real value change, then back to sleep) — preserves the idle-GPU law.

### A8. Blackbook console (Phase 4 "The Logbook") — ✅ RESOLVED 2026-07-13 ("it looks much better" + the default-ON directive) → shipped DEFAULT-ON, preview row removed
Your verdict came in 2026-07-13 with two follow-ups, both done the same day: it's **default-ON for
everyone** (the Settings preview row is gone per your "avoid the QA toggle section" directive;
devtools `"0"` remains the failsafe), and your intuitiveness ask ("skippers should inherently
comprehend it") shipped as your **A+B pick** — the Receipts Strip (three tappable count tiles that
name what the room records and filter the tape) + sentence-grammar rows ("Compy applied… / You
played…"). Nothing on you here anymore.

History: you picked **A · The Logbook** from the 2026-07-12 concept round ("blackbook looks good" + A),
it shipped default-OFF `617db5b`, your 2026-07-13 eyeball approved it, and the A+B intuitiveness pick came
from [the 2026-07-13 concepts](https://claude.ai/code/artifact/88345144-e138-4b44-a71a-de487aa42929).
Room = "Blackbook", timeline = "the logbook"; still a read-only view that routes undo to the Lab.
Plan: [`2026-07-12-console-hud-phase4-blackbook.md`](../superpowers/plans/2026-07-12-console-hud-phase4-blackbook.md).

### A9. Per-room identity accents **+ per-room color picker** — ✅ RESOLVED 2026-07-13 (your palette directive) → shipped DEFAULT-ON, preview row removed
Closed by your 2026-07-13 directive: the earth tones (Rust/Olive/Pine) are **gone**, three **two-color
combos** are in (Cyan/Midnight · Red/Blue · Lime/Cyan — the first color paints buttons/text, the second
tints the room's borders and glows), singles untouched, and the whole feature is **default-ON for
everyone** with the preview row removed ("avoid the QA toggle section"). The palette is 15 (9 bright ·
3 dark · 3 duo) and you called it finished — it stays as-is unless you reopen it. Nothing on you here.

<!-- Pre-resolution history below, kept for the record: -->
Original thread — ⏳ your eyeball · SHIPPED default-OFF, palette PRUNED 2026-07-13 (`8e6920f`):
You picked **"per-room identity"** as the answer to the accent-lock question (Cycles 12g/12h) — "i wanted … the
components each had their own distinguishable color scheme so they were more visible." Each room gets its own preset
accent so the rooms are more distinguishable at a glance: **Monitor teal · Blackbook amber · Lab/Optimize emerald ·
Home violet** (unchanged). Then you asked for more (Cycle 12i follow-up): **"the freedom to shift around the colors
they want on each page."** That's built too — **a little accent dot in the top-right corner of each room; click it for
a swatch popover to recolor THAT room** (it remembers per-room; "Reset to default" puts the preset back). You liked
the picker, saw the first 20-color expansion, and said **"looks good but i agree to prune and widen variety more
differentiation"** — so the palette is now a tighter, more-differentiated **15** (9 bright + 6 dark): I cut the
look-alikes (four oranges → one, three pinks → one) and spread the rest wider, checked with a real color-distance
metric so no two read as near-twins. The dark tones (Rust, Olive, Pine, Slate, Plum, Wine) stay readable on
**buttons/pills** because the ink flips to light automatically. All on your live app (`8e6920f`, installer
`51B0A754…3862F39A`, stamp-verified), still behind the same **default-OFF** flag so nothing changed until you flip it.
- **→ Your one job (a gate before default-ON):** Settings → Appearance → flip **"Room accent colors (preview)"** ON,
  click a room's **top-right accent dot**, and try the 15 — **especially a dark tone** to see the buttons stay legible.
  **Result → tell Claude:** "looks good" (toward the default-ON flip) or what to tweak — it's your palette, delegated
  to me but your final taste call.
- ~~⚠️ hold the default-ON flip until the accent-as-text fix lands~~ → ✅ **that fix SHIPPED 2026-07-13
  (`cc9adb8`, on your live build):** dark picks are now legible EVERYWHERE — buttons/pills (adaptive ink) AND
  the accent-as-text spots (Lab station tabs, Home dock labels, blackbook tags — each dark tone carries a
  paired light text tint, ≥4.5:1 guard-pinned). **Nothing holds the eyeball anymore** — flip the preview on,
  try a dark tone anywhere, and give the verdict. Full thread: [`BACKLOG.md`](../BACKLOG.md) Cycle 2026-07-12l.

---

> **Moved 2026-08-18** under TOKEN LAW §1, when §A0 gained its scripted backup tool and the live
> checklist went over budget. Four §A sections below were already marked CLOSED in the live doc;
> their verdicts are preserved verbatim. Nothing here is waiting on the owner.

### A_crash. ✅ CLOSED 2026-08-12 — the flag it was waiting on no longer gates it
A tester whose PC had crashed searched Compy, found nothing that said "crash", and went to Windows
Event Viewer instead — while Compy's own crash-evidence reader sat one room away, named "Black Box".
Both causes are fixed: the Home door lands **on** the evidence instead of dropping you at the Lab
door, and the station is called **Crash & Freeze Rescue** everywhere it is named.

**✅ The flag question this item asked you to answer is GONE — nothing here is waiting on you.**
When this was written, that Home door was a row inside the intake band, so it inherited
`compy_home_intake` and the ask was "flip it and eyeball it". Two things happened since:
the band **graduated to default-ON 2026-08-11** (so the flip you were asked for already
happened), and on **2026-08-12** the crash door was **extracted out of the band entirely** into
the always-visible Care entry the #91 discovery contract requires — independent of that flag in
every state, including the `"0"` Settings failsafe. A user who switches the optimization band off
keeps crash rescue, which is the point: the people most likely to silence a busy band overlap hard
with the people whose PC keeps crashing. Pinned by `src/surfaces/care-home-route-guard.test.ts` and
the Care-entry block in `src/surfaces/home-intake.test.tsx`.

**What is genuinely still yours here: nothing structural, one look.** The entry has not been seen
on your real screen at your real resolution — the visual self-review the plan asks for (Task 8
step 5) has not run. That is a look, not a decision, and the feature reaches users either way.

### A_ref. ✅ CLOSED 2026-08-11 — the six dead branches are gone
You said "you have full permission", so the pile is cleared: `docs/close-recovery-lane`,
`codex/compy-care-capability-gate`, `claude/admiring-lumiere-648403`,
`claude/compy-recovery-closeout-391516`, `claude/merge-prs-tauri-visibility-c5660e` and
`claude/checklist-owner-items-c5660e` were each proven MERGED first, then deleted on GitHub, and
their now-dead rows dropped from `docs/BRANCH_DISPOSITIONS.md` in the same commit. Nothing is left
for you here.

### A_hook. ✅ CLOSED 2026-08-12 — the handoff-block guard is registered and live
You pointed out (again) that sessions were ending without telling you whether to archive or delete
them, which is how your sidebar fills with work you can't tell apart. That rule was written in
`CLAUDE.md` the whole time and kept getting missed, so it is now a guard instead of a paragraph:
`.claude/hooks/handoff-block-guard.mjs` refuses to let a session end without both a disposition and
a real next step. It is merged and tested (PR [#106](https://github.com/Pootytxng/sentinel/pull/106)).

**It is now registered.** The entry sits third in the `Stop` hooks array of `.claude/settings.json`,
after the autopilot queue check and the context-size advisor. Proven live rather than read back: fed
a synthetic transcript, a reply carrying neither a disposition nor a next action is blocked with the
correction text, a compliant reply passes untouched, and `stop_hook_active` short-circuits so the
guard can never loop a session. Nothing is left for you here — a session that ends without telling
you archive/delete plus a next step now gets stopped before you see it.

### A_disk. ✅ 10.24 GB reclaimed 2026-08-12 — an empty husk is all that is left
`.claude/worktrees/nodejs-background-execution-fd4def` was a leftover checkout from a finished
session. Git had already stopped tracking it (`git worktree remove` deregistered it successfully);
what remained was build output. Measured before deletion it was **10.24 GB, not 9** — and every file
and subfolder in it is now gone, deleted 2026-08-12 from a Cowork session. Six other dead folders
from the same era were empty and were already gone.

What survived the sweep is the **empty top-level folder — 0 bytes, 0 children.** Windows still will
not unlink the directory itself, and nothing on this machine names it: no running process carries
that path on its command line, which points at a finished session's working directory as the holder.
That kind of hold only clears on restart. **There is nothing to do and nothing at stake** — an empty
folder costs no disk. If you want it gone, restart the machine at whatever moment suits you and then
run this (or say the word and a session will):

```
Remove-Item -Recurse -Force "C:\Users\Kuya\code\sentinel\.claude\worktrees\nodejs-background-execution-fd4def"
```

Nothing in the folder was ever unique — the branch and every commit live on GitHub.

### B_dataroot. ✅ Trust Ledger merged 2026-08-18 — one history again, 64 receipts
The owner said **"run the merge"** on 2026-08-18 and it ran, from the lane worktree:
`node scripts/recover-data-root.mjs --apply` over the canonical ledger (3 receipts) and the
packaged-Claude overlay copy (61). Both inputs hashed byte-for-byte identical to the rehearsal
before the write (`41E8CDC1…B4203`, `ABB928FE…57EA`), both were backed up to
`C:\Users\Kuya\code\compy-data-root-recovery\` first, and the union wrote **64 receipts** (39
applied, 25 rolled back, `2026-05-28` → `2026-07-29`, zero id collisions, all 64 ids unique on
read-back, new hash `8429CEA3…0F38`).

Then the overlay folder was **moved, not deleted** — all 58 files to
`C:\Users\Kuya\code\compy-data-root-recovery\overlay-Compy\`. Note that only `history.json` was
merged: the overlay's other files (`sessions.json`, `benchmark.json`, `experiments.json`,
`drift.json`, `intelligence.json`, `exports/`) had canonical counterparts of their own and are
archived intact rather than unioned. Nothing was lost; recovering any of it is a copy away.

The PowerShell resolver (`scripts/lib/canonical-data-root.ps1`, the parity twin of
`src-tauri/src/data_root.rs`) re-run afterward on the real desk returns
`C:\Users\Kuya\AppData\Roaming\Compy`, Exists = True — **`Canonical`**, no longer `Conflict`. Applies
and rollbacks are unblocked on this machine.

## Items closed out of the live checklist 2026-08-20 (self-checkup)

None of these needed the owner. A_ci was answered by GitHub itself, A_rig says "nothing for you to do
today" in its own text, A_ref2 was already done, B1 was resolved verbally on 2026-07-08, B7 was
cancelled by the owner (**do not resurface**), and B_arc was mine to decide and was executed.
Byte-preserved below.

### A_ci. Branch protection on `main` — **not available on this plan; no action needed from you**  ·  ⏳ NEW 2026-08-05, revised same day
`main`'s CI sat **red for two days** and nobody noticed ([#68](https://github.com/Pootytxng/sentinel/issues/68)).
The detection half is built and green — a daily watchdog that files an issue when the trunk goes red
([#72](https://github.com/Pootytxng/sentinel/pull/72)). The prevention half would be a rule on `main`
requiring the two CI jobs to pass, and requiring a branch to be up to date before it merges.

**I tried to set it and GitHub refused.** Both `repos/…/branches/main/protection` and
`repos/…/rulesets` return `403 — Upgrade to GitHub Pro or make this repository public`. This account
is a free User plan and the repo is private, so **the checkboxes do not exist to be ticked** — by
either of us. This item was first written as "two checkboxes only you can tick"; that was wrong, and
this is the correction.

That leaves three real options, and **my recommendation is the third**: (1) pay for GitHub Pro —
a recurring spend for one guard, against the zero-budget law; (2) make the repo public now —
that is the first-public-exposure decision, which CLAUDE.md already schedules alongside the
`compy.gg` domain step, and it should not be forced early by a CI rule; (3) **accept the watchdog as
the only guard until the repo goes public anyway**, at which point protection becomes available for
free and this item closes itself.

The concrete hole the rule would have closed, found 2026-08-05: `ci.yml` triggers on
`pull_request: branches: [main]`, and that filter matches the **base**, so a stacked PR runs no CI
at all. When its parent merges, GitHub auto-retargets it — and a base change fires `edited`, which
is **not** one of the default trigger events. **So a stacked PR can land on `main` having never run
CI once.** That was the default path for this very stack. Without the rule available, the standing
mitigation is procedural and mine to keep: **after every merge into `main`, the next PR in a stack
gets `origin/main` merged into it and must show a green run on that result before it lands** — done
for #71 ([31022512767](https://github.com/Pootytxng/sentinel/actions/runs/31022512767)) and for #72.
Widening the CI trigger to all branches would also fix it and was rejected — that is the unbounded
spend that exhausted July's allowance and killed CI for 22 days in the first place.

### A_rig. The performance budgets are proven on ONE machine — yours  ·  ⏳ NEW 2026-08-05
Q7 recorded Compy's real numbers against the installed build and turned them into budgets a test
re-checks on every run ([`docs/perf/q7-baseline.json`](../perf/q7-baseline.json), issue
[#73](https://github.com/Pootytxng/sentinel/issues/73)). Every one of those 14 numbers came off your
desk: Ryzen X3D, 16 cores, 29.4 GB, RX 9070 XT, 240 Hz. **In plain English: we now know Compy starts
in 3.7 seconds and uses 575 MB on a fast gaming PC. We do not know what it does on a slow laptop,
and nothing in the repo should be read as claiming we do.**

Nothing for you to do today — this is logged so it does not silently become a claim. The moment a
second, slower Windows machine is available (a spare laptop, a tester's PC, anything), the whole
sweep is one command per leg and takes about twenty minutes:
`node scripts/q7-probe.mjs coldstart|boot|rooms|latency|idle-bare|a11y`. Until then the budgets stay
labelled *upper bound proven on fast hardware*, and the one bad finding below stays open regardless
of rig: **idle Compy burns ~half a CPU core doing nothing**, which will be worse, not better, on a
weaker machine.

### A_ref2. One more dead branch — a single delete click  ·  ⏳ NEW 2026-08-11
A sixth-and-final leftover appeared right after A_ref closed: `docs/untangle-dispositions`. A session
fixed the branch-record duplicate there, but its push was blocked long enough that another lane fixed
the exact same thing first (PRs #109 and #110). The branch now carries nothing `main` lacks, so it was
abandoned rather than merged. Its row in `docs/BRANCH_DISPOSITIONS.md` is marked SUPERSEDED and goes
when the ref does. Nothing is lost: nothing on it is unique.

### B1. The Lab room — hand over your task list  ·  ✅ resolved (direction delivered verbally 2026-07-08)
You delivered the Lab direction verbally 2026-07-08 (the proving-ground brief) and steered the redesign
through three rounds to the approved **Ops Console** (see A3) — the parked train is long since moving.
Still folded in and NOT yet built: the **Two Futures hologram** feedback — *"looks really good BUT the
hologram has no visible purpose or information integrated"* (needs part-anchored, measured info) — it
rides a later Lab phase, tracked in [`BACKLOG.md`](../BACKLOG.md).

### B7. Site auto-deploy  ·  🛑 CANCELLED BY OWNER 2026-07-16 — do not resurface
Dropped by owner decision, decreed via Cowork with the owner at the console. The real facts (read
live from the owner's GitHub dashboard, correcting this entry's earlier guesses): **no failed
payment, billed $0** — the block was the account-level $0 Actions budget (stop-usage on), and
**$12 of ~$16 included free minutes were already burned by Jul 9**, so "should cost $0" was not
guaranteed. That makes unblocking a zero-budget-law spend gate; the owner declined it.
**Standing state:** the workflow file stays (it skips green, no error spam) · manual
`wrangler pages deploy` under the standing B3 deploy GO is THE publishing path · never ask the
owner for the Cloudflare token, a billing change, or a budget raise again. Revisit ONLY if the
owner raises it himself — his accepted trigger: a multi-day absence where the site must update
unattended. (Cross-ref: BACKLOG steering-log decree above Cycle 2026-07-16e.)

### B_arc. Half the arc skin is built, wired, and switched off — delete it or turn it on  ·  ⏳ NEW 2026-08-20
`src/arc-instrument.css` M3 (session debrief) + M4/4b (comparison cards) — 156 lines of finished
skin whose prop chain runs end to end but that no caller ever turns on, so no user has seen it. The
dead-by-deletion strata around it (M1 Onboarding, the M2 radar) are already gone; this half is
**dormant, not dead**, which is why it wasn't touched. **My recommendation:** delete the CSS *and*
the `arcV2` prop chain in `SessionDebrief`/`WhatChangedPanel` together — a prop that promises a
re-skin and does nothing is worse than neither, and three skin generations have shipped since it was
written. **The other direction:** one prop at `Play.tsx:488` lights it, and then it owes a build →
install → self-review like any visual change. Either way it's one train. Row: [`BACKLOG.md`](../BACKLOG.md).

---

## B6 — Wordmark taste fork (resolved 2026-07-15)

Moved out of `docs/OWNER_ACTION_CHECKLIST.md` §B6 on 2026-08-21 under TOKEN LAW §1 to pay for a new
B6 item. Verbatim:

- ~~**Wordmark taste fork** (surfaced by the web-design-director): the home page renders "COMPY" as
  all-caps mono; the generated library/debunk pages use a pulsing-"o" wordmark. Director recommends
  unifying to the all-caps mono. **It's your brand taste call** — say unify / keep-both / your own.~~
  → **✅ RESOLVED 2026-07-15** ("completely follow the design directors taste calls"): unified to
  the all-caps tracked mono COMPY site-wide (landing, footer, /compare, all generated Blackbook
  pages); the pulsing-"o" variant is removed.

---

## §B items closed by an owner verdict

> Moved out of the live checklist on **2026-08-22** under TOKEN LAW §1. The live doc keeps a two-line pointer plus the one residual.

### B_land. Where feedback and analytics land — ✅ DECIDED 2026-08-18, no inbox, nothing for you to open
You asked not to funnel this into your personal Gmail, and you were right to: an address printed
inside a shipped app is a permanent target (scraping, phishing, attachments), and it ties your
personal identity to the product forever. **So no email is involved at all.** Both features post to
your own site the same way the waitlist already does — `functions/api/waitlist.ts` → Cloudflare D1,
same-origin, IP hashed, rate-limited, honeypotted. That pattern is live and verified today.

**Destination:** D1 database **`compy_reports`** (`73f5e8a3-1827-42e3-8543-9fedc3750532`, WNAM),
created 2026-08-18 on your existing Cloudflare account — $0, no new service, no new login. The
consent screen can name it truthfully: *"sent to Compy's own store on compy.gg."* Storage is
write-only from the app; the only way to read it is your Cloudflare account, and Claude reads the
reports for you through the connected Cloudflare tools — **you never check an inbox.**

**Your one residual:** when the endpoints are built (Q9b), the site has to be deployed once —
`npx wrangler pages deploy` — because you cancelled site auto-deploy (B7) and deploys reach the
public. One command, or one word to let me run it. Nothing else.

---

## Moved from the live checklist on 2026-09-01 — §B items closed 2026-08-21/22

> Same rule as the rest of this file: closed by the owner's own verdict or by the work simply landing, kept verbatim so the record of what he approved, and when, survives. The live checklist kept a one-line pointer (`B-closed4`). Moved because `docs/OWNER_ACTION_CHECKLIST.md` hit its BYTE budget and TOKEN LAW §1 pays that from the archive, never by raising the cap.

### B_startup. A Windows mutation outside `actions.rs` — ✅ CLOSED 2026-08-22, it was already fixed
The item was filed 2026-08-02 and **fixed 2026-08-03, the next day, by a different lane** — nobody
closed the row, so it sat on your list for twenty days asking you to decide something that no longer
existed. `set_startup_entry_enabled` moved out of `lib.rs` into `history.rs` and now mutates through
`actions::apply_startup_entry_enabled`: typed `SetStartupEntryEnabled` action, a raw-bytes snapshot
of Windows' own approval value, and a Trust Ledger entry like every other change — so a startup app
Compy disables *is* undoable from your history. Verified in the code today, not taken on trust.
`CLAUDE.md`'s module map still claimed the exception existed and now doesn't. **Nothing on you.**

### B_gpu. A finished GPU-profile screen mounted nowhere — ✅ CLOSED 2026-08-22, wired in
You said do everything, so this took option (a) rather than parking a built-and-tested surface any
longer. `src/surfaces/GpuProfile.tsx` now mounts in the **Lab**, below the console, as an advisory
panel: which slice of GPU data you're looking at, plain-English notes for your Radeon, and a
before/after diff of the readable GPU settings when you change something in Adrenalin yourself.
It stays advisory forever — LOCKED rule 6 makes GPU-profile *apply* structurally impossible, since
AMD profile state isn't user-mode readable and rollback-first can't be satisfied. Nothing here
writes to your PC. *Why it matters:* work that was finished and invisible is now something you can
actually see, and if you don't like it, say so and it comes out.

### B_write. The write refusal — ✅ ARMED 2026-08-22 on your "do everything"
A Claude session you open by hand — rather than through the launcher — used to be *unverified*:
nothing on disk said which folder, branch, issue and conversation it was working under, and it wrote
anyway. Now the moment such a session edits a file inside this repo it is stopped and handed the one
command that verifies it on the spot, so nothing is lost and no window closes. Registered in
`.claude/settings.json` on `Write|Edit|NotebookEdit`; this machine's live session was adopted first,
per the spec's own ordering, so arming it could not lock the arming session out.
*Why it matters:* it is the difference between "a change nobody can attribute later" and "a change
bound to a folder, a branch and an issue". **`Bash` is deliberately still unguarded** — a named hole
(spec §3c) that doubles as the escape hatch if the hook ever misbehaves, and a test now fails the
build if anyone adds `Bash` to it or quietly unwires the hook. Reads stay advisory.

### B_shelter. The collision guard — ✅ NOTHING WAS EVER WAITING ON YOU; it landed 2026-08-21
**This row was wrong and is withdrawn.** Issue [#128](https://github.com/Pootytxng/sentinel/issues/128)'s
1,100 lines are **on `main` and have been since 2026-08-21** — merged as `bf8e2e6e`, then hardened by
`38279f95` to resolve its state root through the #130 resolver. Its tests run in every gate; the
`scripts/process-mutex-guard.test.mjs` flake the handoff warns about IS this code, live.
*Why it matters:* it stops a release and an app-install from running over each other — the failure that
once left you with an installer that exited "success" and replaced nothing. It is protecting you now.
*How the row got here:* it was re-derived on 2026-08-25 from the shelter tag
`preserve/local-collision-guard-707572f1` without checking whether that commit was already an ancestor
of `main`. It was. **Guard added so this class of stale ask cannot recur:** a shelter tag whose commit
is reachable from `origin/main` now fails `scripts/shelter-tag-guard.test.mjs`.

---

## Moved from the live checklist on 2026-09-01 — two decided §B items

> Decided on the owner's own verdicts (2026-08-18 and 2026-08-22) and kept verbatim. `B_land` still carries one residual — a single site deploy once the Q9b endpoints exist — which is why the live checklist's pointer names it rather than merely filing it away. `B_eu` has a trigger rather than a date: revisit when Compy is downloadable by Europeans.

### B_land. Where feedback and analytics land — ✅ DECIDED 2026-08-18  ·  full record below in this file
No email, no inbox: both features post to your own site like the waitlist already does, into Cloudflare D1 `compy_reports`. **Your one residual:** when the endpoints are built (Q9b) the site needs one deploy — one command, or one word to let me run it.

### B_eu. Analytics default-ON in the EU — ✅ DECIDED 2026-08-22 as **(a) US-first**
Taken on your "do everything", and it is the recommendation that was already on the row. Usage
analytics **on by default with disclosure** is normal and legal in the US, and you have no EU
distribution today. Option (b) — ask on first run everywhere — costs real sign-up rate to buy legal
cover for a market that does not exist yet, and it can be added the day it does. **Reversible and
cheap to reverse:** the region gate is a first-run branch, not an architecture. Nothing about your
own machine or the local app changes either way. Revisit this the moment Compy is downloadable by
Europeans — that is the trigger, not a date.

### A0. Updater key backup + the one-tester canary — ✅ both CLOSED (archived 2026-09-01)

Moved out of the live checklist because they were closed and still being re-read as open work. The
third A0 half — deleting the `DesktopCOMPY KEY` copy — is NOT closed and stays live there.

- ✅ **Updater signing key backed up OFF this machine — CLOSED 2026-08-18 (owner-reported).** The
  owner ran `scripts/backup-updater-key.ps1`, proved the armored file opens with
  `scripts/restore-updater-key.ps1 -Verify`, and stored the result off this PC with the passphrase in
  his password manager. The fleet anchor (`43711DD10AAB67D7`, the pubkey pinned in
  `src-tauri/tauri.conf.json` and `scripts/updater-trust-root-guard.test.mjs:23`) now survives a dead
  drive. **Why it mattered:** lose it → the fleet can never receive another update; leak it → whoever
  holds it can sign an update Compy installs silently on every install, because the updater has been
  live since 2026-07-22. Backup/restore behaviour stays pinned by
  `scripts/updater-key-backup-guard.test.mjs`.
- ✅ **One-tester canary — PASS (recorded 2026-07-28).** A tester completed it through Compy's
  **normal public updater** and is **currently running v0.9.11**; **no updater failure was
  reported.** That is the entire record — their prior version, the exact timing, and any per-step
  detail were never captured, so nothing more can be claimed. **Nothing is pending from you on the
  canary; do not re-run it or recruit another tester for it.** The only remaining distribution call
  is whether/when to widen to the other invitees (§B2).

### §D. Two taste calls ruled and shipped 2026-08-26 — archived 2026-09-01

- ✅ **The wordmark reading `©ompy` — RULED AND SHIPPED 2026-08-26** ([#213](https://github.com/Pootytxng/sentinel/issues/213) A1)
  You chose "drop the inner ring when tiny". Done: below 22px the heartbeat inside the C is not drawn,
  so the rail mark reads **Compy**. The threshold is 22 rather than the ~24 I proposed because a
  capture at 16/19/20/22/24 measured the pulse legible at 22 — Settings → About draws it at exactly
  that size and keeps its flourish. Your triple-click egg still plays at rail size: the pulse appears
  for the beat, then tucks away. Nothing else about the mark moved. Before/after sent to you.
- ✅ **The verdict headline's "· and 3 more" tail — RULED AND SHIPPED 2026-08-26** ([#219](https://github.com/Pootytxng/sentinel/issues/219))
  You chose "drop the count from the headline". Done: the big line names the one flagged thing and
  stops. Nothing is hidden — the line under it still prints the honest proportion ("15 of 16 checks
  look good.") and the rest are one press away in Check and Fix. **Correction:** I first told you
  "the rest are still visible in the list below" — on Home they are not, they are one click away.
  Nothing is hidden either way, but you ruled on a slightly wrong description of the screen and you
  should know that. Say the word and Home can name them all inline. The retired translation
  string is deleted in both languages so it cannot be wired back up by accident.
