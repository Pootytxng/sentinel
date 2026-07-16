# Owner Action Checklist — the ONE place your open items live

> **Pull this up anytime ("show my checklist").** This is the single consolidated index of
> everything waiting on **you** — your hands (a UAC, a reboot, an eyeball), your input (a list, a
> URL, a decision), or your money/legal call. It exists because your asks were scattered across six
> different docs and got dropped; now every one of them points back here, and **every session is
> told to read this file** (wired into `CLAUDE.md`). Nothing here blocks Claude's ongoing build work
> — it keeps going and only raises one of these if it *truly* can't proceed.
>
> **Status legend:** ⬜ open · ✅ done · ⏳ waiting on you · 🔒 gated on money/legal.
> Last reconciled: **2026-07-08**, patched **2026-07-11** (Cowork full audit — added the missing
> Monitor-v4 eyeball item, fixed a same-day self-contradiction on Lenis/HoloLens status, flagged a
> dead repo link in the legal drafts). Not a full re-sweep of every doc — see
> `docs/COWORK_AUDIT_2026-07-11.md` for what was and wasn't checked.

---

## §A — Needs your hands or eyes (owner-run, reversible)

### A1. Gaming Mode QA — ✅ CLOSED: SIGNED OFF (owner, 2026-07-14)  ·  full list: [`GAMING_MODE_QA.md`](GAMING_MODE_QA.md)

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

### A2. Beta smoke pass — before any invites go out  ·  full list: [`BETA_SMOKE_CHECKLIST.md`](BETA_SMOKE_CHECKLIST.md)
**24 checks, currently 0 run.** The critical one is **migration** (`%APPDATA%\Sentinel` → `\Compy`
copy on first launch). Only matters when you're actually ready to send the beta (see §B2) — parked
here so it isn't forgotten at send time.
- **Result → tell Claude:** "Beta smoke passed" (or paste anything that looked off).

### A3. Lab Ops Console — ✅ RESOLVED (your round-4 "ALL GOOD", 2026-07-10) → default-ON SHIPPED
The eyeball gate is cleared and both your calls shipped in `59249bb` (2026-07-10, live on your Desktop
build): the **Ops Console Lab is the default** and the **standalone Optimize tab is gone** — the rail is
Home · Monitor · Blackbook · Lab, and the Lab's Optimize station (open-on-click, your "cleaner" call) is
the one door to the toggles, with "Applied & history" undo inside the panel. Nothing on you here anymore;
if anything feels off, Settings → Appearance → "Lab proving ground" OFF restores the classic look
instantly. Full thread: [`BACKLOG.md`](BACKLOG.md) Cycles 2026-07-09f / 2026-07-10a–d.

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
  [`2026-07-11-monitor-v5-deck-stack.md`](superpowers/plans/2026-07-11-monitor-v5-deck-stack.md).
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
Plan: [`2026-07-12-console-hud-phase4-blackbook.md`](superpowers/plans/2026-07-12-console-hud-phase4-blackbook.md).

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
  try a dark tone anywhere, and give the verdict. Full thread: [`BACKLOG.md`](BACKLOG.md) Cycle 2026-07-12l.

---

## §B — Waiting on input only you can give

### B1. The Lab room — hand over your task list  ·  ✅ resolved (direction delivered verbally 2026-07-08)
You delivered the Lab direction verbally 2026-07-08 (the proving-ground brief) and steered the redesign
through three rounds to the approved **Ops Console** (see A3) — the parked train is long since moving.
Still folded in and NOT yet built: the **Two Futures hologram** feedback — *"looks really good BUT the
hologram has no visible purpose or information integrated"* (needs part-anchored, measured info) — it
rides a later Lab phase, tracked in [`BACKLOG.md`](BACKLOG.md).

### B2. Beta send — go / no-go  ·  ⏳
[`BACKLOG.md`](BACKLOG.md) RUNG 3: private-beta to friends + your Discord. The decision "ship from
current `main`" is made; what's pending is **your GO** to actually send (after A2 smoke). Also open:
ship `beta-001` frozen vs. cut a fresh `beta-002` from `main`.

### B3. Funnel go-live — two small inputs  ·  ⏳  ·  [`docs/archive/cowork-cc-relay/2026-06-15-funnel-golive-todo.cc.md`](archive/cowork-cc-relay/2026-06-15-funnel-golive-todo.cc.md)
Parked since 2026-06-15, waiting on you for: **(a) your Ko-fi profile URL** (to wire the tip/support
button) and ~~**(b) an explicit "deploy GO"** for the site refresh~~ — **(b) GRANTED 2026-07-15**
("deploy go looks good for now"); the site now deploys autonomously and is LIVE on
`compy-bd6.pages.dev` (SEO plumbing + `/compare` shipped 2026-07-15). **Still open: only (a) the Ko-fi
URL.**
- **Ko-fi is the single most-ready money surface** ([`MONETIZATION_PLAN.md`](MONETIZATION_PLAN.md)
  "Bridge"): `src/data/site.ts` `KOFI_URL` is empty by design (empty = no support link ships, **no
  dead link**), and two dormant slots — the footer and the waitlist section — light up the instant
  you give me the URL. One line, regenerate, deploy. **Result → tell Claude: your Ko-fi profile URL.**

### B6. Monetization plan — money-surface unlocks  ·  ⏳  ·  [`MONETIZATION_PLAN.md`](MONETIZATION_PLAN.md)
Drawn up 2026-07-15 at your ask ("draw up a monetization plan … and how best to set it up on the
site"). The plan documents/sequences what the site is **already built to do** — nothing here is a new
spend or a new outbound boundary. The layers, ranked by passivity, and the owner-only unlocks each
one waits on:
- **Content engine (Layer 2)** — LIVE, $0, **no unlock needed.** The near-term lever is *me*
  publishing more of the Blackbook corpus as full SEO pages. Nothing on you.
- **Affiliate upgrade links (Layer 1)** — **HOLD.** Needs **① affiliate accounts** (Amazon
  Associates / Newegg — your signup, a money call) **② enough Receipts data** to make a web
  bottleneck-report say something true. Until accounts exist, verdicts use plain retailer links (no
  revenue, still honest).
- **Compy Pro (Layer 3)** — built dark, correct posture. Needs **a legal entity + merchant-of-record
  (Paddle route) + a price you set + shipped Pro value.** The site's "in the works / no price yet"
  card is exactly right until then.
- **B2B licensing (Layer 4)** — parked, post-traction. No page until you ask.
- **Wordmark taste fork** (surfaced by the web-design-director): the home page renders "COMPY" as
  all-caps mono; the generated library/debunk pages use a pulsing-"o" wordmark. Director recommends
  unifying to the all-caps mono. **It's your brand taste call** — say unify / keep-both / your own.

### B4. Two substituted asks — confirm or redirect  ·  ⏳
Both were real asks that got quietly *substituted* rather than done — flagging so you can close or
push:
- **"Trending design tooling (Figma / v0-Vercel MCPs)"** (de-slop directive #6): Claude built the
  redesign in-repo instead because those MCPs spend your owner-gated credits. If you WANT the tooling
  used, say so; otherwise this stays a deliberate no.
- **"Upgrade-path engine"** (your Optimize feedback, 2026-07-03): the advisory upgrade block exists,
  but the fuller engine was deferred to "its own spec" and never built. Want it built, or leave it?

### B5. Your UI vision — pick what to build next  ·  ⏳  ·  [`UI_VISION_BACKLOG.md`](UI_VISION_BACKLOG.md)
You caught (2026-07-08) that a UI task list you'd made had been dropped. It had — your design
direction was scattered across ~20 specs and the redesign lane was marked "COMPLETE" after only the
*look* (Instrument-HUD reskin) shipped, while the **motion/interaction layer you were most excited
about was never built.** Now consolidated into [`UI_VISION_BACKLOG.md`](UI_VISION_BACKLOG.md) — its
🔴 OPEN section is the real remaining work. **Direction now DECIDED (2026-07-09):** the drag gallery was
built then rejected + **deleted**; the JARVIS motion stack (magnetic cursor, GSAP data-reactivity, hologram
inertia) is being built via the APPROVED **Ops Console** rollout
(`docs/superpowers/specs/2026-07-09-compy-console-hud-direction.md`; the Instrument-Bench bento was
rejected on sight). **Correction (2026-07-11 audit — this line previously contradicted
UI_VISION_BACKLOG.md and was wrong):** Lenis smooth-scroll is **NOT dropped — still unbuilt, still
open** (UI_VISION_BACKLOG.md §A.5, verified 0 files). The HoloLens onboarding tour redesign is **NOT
open — it SHIPPED** (verified 2026-07-08, UI_VISION_BACKLOG.md §H) and should not have been listed
here as unresolved. Also still genuinely open there: CommandPalette, the site-glow/"full overhaul"
gate, the magnetic-cursor slice (only a narrower "reticle Target Cursor" shipped so far), GSAP
data-reactivity (not built as specified), and the room-transition wipe (partial).
- **You said "there's more I'm missing" + "capture it first"** — done (this doc). **Next → tell me if
  the 🔴 list is complete or still short an item.** The first build target is **DECIDED** — the Instrument
  Bench Phase-1 build (the drag gallery is deleted, not a build option). Note: your original **"Feature Roadmap Checklist (CC Brief)"**
  is NOT in the repo — if *that's* the list you meant, you'd need to re-share it.

---

## §C — Release gates — your money / legal calls  ·  🔒
These gate **public** release only (not the local app you use daily). Full list:
[`ARCHITECTURE_LOCKS.md`](ARCHITECTURE_LOCKS.md) pre-launch section.
- 🔒 **Code-signing route** — Azure Trusted Signing is the noted $0-first path; resolves the "unknown
  publisher" UAC banner for every elevation.
- 🔒 **Legal** — `docs/EULA.md` + `docs/PRIVACY.md` are drafts to finalize. **Narrower than it looks
  (2026-07-11 audit):** license model (proprietary, all-rights-reserved) and governing law (United
  States) are already decided in EULA v0.3 — only the `[STATE]` venue blank is genuinely open.
  **Bug found:** both docs already link to `https://github.com/Pootytxng/compy`, which doesn't exist
  yet (current repo is still `Pootytxng/sentinel`, private) — fix the links when the rename below
  actually happens, don't ship as-is.
- 🔒 **GitHub repo rename → `compy` + `compy.gg` domain** — bundled at first public exposure. **NOW
  TIMELY (2026-07-15):** the site is deployed and every canonical URL, the sitemap, and the JSON-LD
  already point at `https://compy.gg`, but the domain isn't purchased — the site currently lives only
  on `compy-bd6.pages.dev`. Buying `compy.gg` + pointing it at the Pages project is the last
  owner-only step before the SEO/canonical layer is actually correct in the wild.
- 🔒 **Receipts telemetry arming** — new outbound-network boundary; needs its security review + a
  consent UI + your sign-off before it can leave the machine (dark by design until then).

---

## §D — Taste / visual sign-offs (as they come up)
Claude proceeds on tasteful polish autonomously and only flags genuine forks here — default theme,
exact hexes, anything where your eye is the authority.
- 🔨 **Site hero verdict: REJECTED → full compy.gg makeover commissioned (2026-07-14).** You saw the
  PART B two-strip hero (`2eda4eb`) and rejected it outright ("needs a complete makeover"). New
  directive logged in `docs/UI_VISION_BACKLOG.md` §G: research-first, spitball directions, decide
  together before build. Your open call here = **pick the direction from the spitball options** when
  presented. The two-strip's honesty guardrails (real-provenance receipts, no gain claims,
  `scripts/site-landing.test.mjs`) survive into any redesign. Site stays PRE-PUBLISH; deploy GO
  unchanged (§B3).
- ✅ **Sibling slop sweep — DONE + SHIPPED `f13d10a` (2026-07-08).** The `#1 BIGGEST LIMITER` uppercase
  tags in **FirstCheck** and the **Setup Tour** spotlight are now quiet lowercase "#1 biggest limiter"
  mono tags matching Home's fix (SetupTour de-ambered too); self-reviewer PASS 8/8, guard-pinned, live.
  Your eyeball is optional — you'll only see these on a first run / tour re-trigger; the main app's live
  look is unchanged.

---

## Where the full lists live (so nothing is buried again)
| Area | Canonical doc |
|---|---|
| Gaming Mode QA cases | [`GAMING_MODE_QA.md`](GAMING_MODE_QA.md) |
| Beta smoke pass | [`BETA_SMOKE_CHECKLIST.md`](BETA_SMOKE_CHECKLIST.md) |
| What's next / status ledger | [`BACKLOG.md`](BACKLOG.md) |
| **Owner's UI / design vision** | [`UI_VISION_BACKLOG.md`](UI_VISION_BACKLOG.md) |
| Live gate/build state | [`RELEASE_STATE.md`](RELEASE_STATE.md) |
| Funnel go-live steps | [`archive/cowork-cc-relay/2026-06-15-funnel-golive-todo.cc.md`](archive/cowork-cc-relay/2026-06-15-funnel-golive-todo.cc.md) |
| NVIDIA validation (needs NVIDIA hardware) | [`NVIDIA_VALIDATION_PLAN.md`](NVIDIA_VALIDATION_PLAN.md) |

---

*Maintained by Claude — reconciled against every task-list doc in the repo. Items get added the
moment a deferred owner-action arises and checked off when you confirm. Ask "show my checklist" for
the current state.*
