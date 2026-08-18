# Owner action checklist — resolved §A items (archive)

> Moved out of [`docs/OWNER_ACTION_CHECKLIST.md`](../OWNER_ACTION_CHECKLIST.md) on **2026-08-04**
> under TOKEN LAW §1 (docs carry CURRENT STATE only; history moves to `docs/archive/*` with a
> pointer, never deleted). **Nothing in this file is waiting on the owner** — every item below was
> closed by his own verdict, and the closing verdicts are preserved verbatim so the record of what
> he approved, and when, survives. The live checklist keeps §A0 (the one §A item still open).
>
> Point-in-time records. Verify against `docs/RELEASE_STATE.md` before relying on any gate claim.

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
