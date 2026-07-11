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

### A1. Gaming Mode QA — sign it off  ·  full list: [`GAMING_MODE_QA.md`](GAMING_MODE_QA.md)
The feature is live. **2 of 10 cases are PASSED** (#4 full-reboot headline · #10 one-UAC advanced
tier). **8 quick cases remain** — most are a start/stop away, one batch in one sitting:
- ⬜ #1 normal start→stop · ⬜ #2 first-use consent gate · ⬜ #3 app-crash-while-active · ⬜ #5 normal
  stop restores · ⬜ #6 UAC-cancel at START (one prompt) · ⬜ #7 UAC-cancel at RESTORE (one prompt,
  since T6b) · ⬜ #8 missing power plan fails safe · ⬜ #9 external power-plan change mid-session.
- **New since your last run (build `a5352cb`+):** the restore side is now ONE UAC and shows a visible
  "Your settings are back" confirmation — case #5 or #7 doubles as your eyeball of that.
- **Result → tell Claude:** "Gaming Mode QA signed off". *This is the one milestone between F1 and
  "1.0-confident."*

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

### A5. Monitor console — eyeball the v5 "Flight Deck + Session Stack" build  ·  ⏳ OPEN (updated 2026-07-11: v5 SHIPPED `960734c`, flag OFF — your look is the gate)
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
- **→ v5 SHIPPED 2026-07-11 (`960734c`) — the eyeball is now on you:** your live app already has
  it; flip Settings → Appearance → "Monitor console (preview)" and open Monitor. Top half = live
  flight deck (hover the frametime graph to scrub exact frames, drag to zoom); bottom half = your
  last 5 sessions as flat rows on one shared axis (your real Sand/Marvel/Palworld history is
  already in there — click a row for its detail). Verdict → tell Claude looks-good / what's off.

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
button) and **(b) an explicit "deploy GO"** for the site refresh. No spend, no risk — just needs
those two from you when you want the funnel live.

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
- 🔒 **GitHub repo rename → `compy` + `compy.gg` domain** — bundled at first public exposure.
- 🔒 **Receipts telemetry arming** — new outbound-network boundary; needs its security review + a
  consent UI + your sign-off before it can leave the machine (dark by design until then).

---

## §D — Taste / visual sign-offs (as they come up)
Claude proceeds on tasteful polish autonomously and only flags genuine forks here — default theme,
exact hexes, anything where your eye is the authority.
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
