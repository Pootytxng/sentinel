# Owner Action Checklist — the ONE place your open items live

> **Pull this up anytime ("show my checklist").** This is the single consolidated index of
> everything waiting on **you** — your hands (a UAC, a reboot, an eyeball), your input (a list, a
> URL, a decision), or your money/legal call. It exists because your asks were scattered across six
> different docs and got dropped; now every one of them points back here, and **every session is
> told to read this file** (wired into `CLAUDE.md`). Nothing here blocks Claude's ongoing build work
> — it keeps going and only raises one of these if it *truly* can't proceed.
>
> **Status legend:** ⬜ open · ✅ done · ⏳ waiting on you · 🔒 gated on money/legal.
> Last reconciled: **2026-07-08** (full sweep of all task-list docs in the repo).

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

### A4. Home console preview — your eyeball  ·  ⏳ (shipped `72d9b6e`, 2026-07-10)
Phase 2 of the Console rollout is on your live build, **off by default — nothing looks different
until you flip it**: Settings → Appearance → **"Home console (preview)"**, then open Home. You should
see your rig hologram center-stage with four corner gauges, the top limiter with a "See in Lab"
jump, and a dock of room doors below. React with taste: "all good" flips it to the default look and
unlocks Phase 3 (Monitor); "needs changes" gets a fix train first. Toggle OFF restores today's Home
instantly.
- **Result → tell Claude:** your verdict on the Home console.

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
inertia — Lenis dropped as unneeded) is being built via the APPROVED **Ops Console** rollout
(`docs/superpowers/specs/2026-07-09-compy-console-hud-direction.md`; the Instrument-Bench bento was
rejected on sight). Also open there:
CommandPalette, the site-glow/"full overhaul" gate, and the HoloLens tour status.
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
- 🔒 **Legal** — EULA license model + governing law/jurisdiction; `docs/EULA.md` + `docs/PRIVACY.md`
  are drafts to finalize.
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
