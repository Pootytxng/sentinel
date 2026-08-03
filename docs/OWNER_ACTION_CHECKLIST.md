# Owner Action Checklist — the ONE place your open items live

> **Pull this up anytime ("show my checklist").** This is the single consolidated index of
> everything waiting on **you** — your hands (a UAC, a reboot, an eyeball), your input (a list, a
> URL, a decision), or your money/legal call. It exists because your asks were scattered across six
> different docs and got dropped; now every one of them points back here, and **every session is
> told to read this file** (wired into `CLAUDE.md`). Nothing here blocks Claude's ongoing build work
> — it keeps going and only raises one of these if it *truly* can't proceed.
>
> **Status legend:** ⬜ open · ✅ done · ⏳ waiting on you · 🔒 gated on money/legal.
> Last reconciled for release truth: **2026-07-28**; broader owner-list audit remains the
> **2026-07-11** Cowork pass (added the missing
> Monitor-v4 eyeball item, fixed a same-day self-contradiction on Lenis/HoloLens status, flagged a
> dead repo link in the legal drafts). Not a full re-sweep of every doc — see
> `docs/COWORK_AUDIT_2026-07-11.md` for what was and wasn't checked.

---

## §A — Needs your hands or eyes (owner-run, reversible)

### A0. NEW 2026-07-23 — Live updater: key backup + the LAST manual send

- ⏳ **Back up the updater signing key (2 minutes, genuinely important).** Copy
  `C:\Users\Kuya\.tauri\compy-updater.key` (and `.key.pub`) somewhere private OFF this machine —
  password-manager attachment or your personal cloud. **Lose it** → the fleet can never receive
  another update (one-time re-send of new-key builds required). **Leak it** → whoever holds it can
  push code to every install. Same custody class as the remote-rules key law.
- ✅ **One-tester canary — PASS (recorded 2026-07-28).** A tester completed it through Compy's
  **normal public updater** and is **currently running v0.9.11**; **no updater failure was
  reported.** That is the entire record — their prior version, the exact timing, and any per-step
  detail were never captured, so nothing more can be claimed. **Nothing is pending from you on the
  canary; do not re-run it or recruit another tester for it.** The only remaining distribution call
  is whether/when to widen to the other invitees (§B2).
- ⏳ **Expanding to the remaining invitees.** Their current installs (0.9.0/0.1.0) have NO updater and
  cannot hear about updates until they install one build that does. Do **not** send the stale v0.9.3
  installer, and do **not** send the **v0.9.9** build (`664aa5e`) that previously ran on your machine
  — v0.9.9 was source-tagged and owner-installed but its publish failed closed, so it exists on no
  public page and is not republishable. **v0.9.10 is likewise not sendable** — you authorized its
  cleanup, so its abandoned draft and releases-repo tag were deleted on 2026-07-28 (source tag
  `92c7608` and the local evidence stay preserved). **The send candidate is now
  live: v0.9.11 (`7ba5fb6`) published 2026-07-28** — public release id `361056355`, installer
  SHA-256 `bb2b85a4…5438384f`, manifest `0.9.11`, signature verified, and your own box runs those
  exact bytes — and the canary above proves that path works on someone else's machine. Every
  precondition is met (full local gate set green; hosted Actions stay off by your standing decision
  — see B7 — so **local IS the gate**), so nothing blocks widening but your call on who and when.
  The release page is
  `https://github.com/Pootytxng/compy-releases/releases/latest`. Once an invitee installs one
  updater-enabled build, future patches reach them in-app ("update ready" pill → one click). Key
  custody/rotation,
  Authenticode enrollment, publication, distribution, and external timing are owner territory;
  protected use of the existing updater key inside an authorized local release train is engineering.

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

### B2. Widening updater distribution past the canary — go / no-go  ·  ⏳

The six original invitees already received the verified 0.9.0 link. The former
`beta-001`-versus-0.9.1 choice is closed; do not resend either historical artifact. **Publication is
done — v0.9.11 (`7ba5fb6`) is public and proved on the owner machine — and the single-tester canary
PASSED:** a tester updated through the normal public updater, runs v0.9.11, and reported no updater
failure. **The canary itself needs nothing further and must not be re-run.** The only remaining
distribution decision is **whether/when the other invitees move onto the updater-enabled build.**

**Historical 0.9.0 distribution protocol (completed 2026-07-22; preserve for provenance only):**
Release label: **"Compy 0.9.0 Invite-Only Private Beta — Validated binary source: 37a166c"**.
The artifact is the exact validated NSIS built from `37a166c` — `Compy_0.9.0_x64-setup.exe`,
SHA-256 `6BC2F7DFBCCC31A6714A49EE07F36327016DBB65741FA40D4371A45690F5A2C4` (3,826,464 bytes;
re-verified intact on the Desktop 2026-07-21). Note: repo HEAD moves — derive it live
(`git rev-parse HEAD`); never trust a hash baked into this paragraph. The validated binary source
for THIS beta stays `37a166c`; newer main commits (e.g. `970f801`, the §6 presenter fix now on the
  owner's box) do NOT change what the six invitees hold. The old choice to ride `37a166c` or cut
  0.9.1 is **closed and superseded**. At the completed send:
1. Recalculate the file's SHA-256 immediately before uploading; it must match the value above.
2. Upload to the private tester location; **never overwrite the validated file with a different
   build under the same filename.**
3. Test the download from a second browser or device; hash the downloaded copy — same SHA-256.
4. Tell testers up front: unsigned invite-only beta; SmartScreen "unknown publisher" warnings
   are expected.
5. Record who received it and the exact link/artifact each person got.
The send decision + recipient list are yours; Claude runs the mechanics (hash, upload,
download-test, record-keeping) on your GO.

**⚠️ INCIDENT 2026-07-22 AM — the wrong link went out; two things now on YOU:**
The OLD June kit's link (stale `fc940fe` 0.1.0 build) was sent out instead of the staged 0.9.0
link — protocol steps 3 (verify the actual link) and 5 (record recipients) were skipped. Cowork
has since killed the old link (verified dead unauthenticated), renamed the file
`RETIRED-DO-NOT-SEND_Compy-Beta-Kit_OLD-0.1.0-June.zip`, and re-verified the correct link
end-to-end (anonymous download, SHA-256 `6BC2F7DF…F5A2C4` exact):
https://drive.google.com/file/d/1BNuoY-ubKCLTkPUDFdnmFGAUkK4g0J9n/view?usp=sharing
1. ~~Tell Claude who received the old link~~ → ✅ DONE 2026-07-22: **Matcher · Chinaman · J ·
   Zoid · Sultan · Majin** — recorded in `BETA_DISTRIBUTION_RECORD.md`.
2. ~~Re-send using ONLY the link above~~ → ✅ DONE 2026-07-22 (~9 AM PDT): owner sent the
   correction + verified link to all six; the exact sent link was re-verified unauthenticated
   **post-send** (HTTP 200 · SHA-256 exact) and the old link re-confirmed dead in the same pass.
**Nothing left on you for this incident.** The open risk item is now §A2 (smoke pass, 0/24) —
six people hold a working install link. Anyone clicking the old link sees "request access" — safe.

**Fold-in — cold-start user testing (panel-review brief 2026-07-15 §4.10):** the beta send doubles as
the cold-start test event — same recipients, no separate program. Target mix when picking who gets it:
~3 non-technical gamers · 2 people burned by tweak packs before · 2 enthusiasts · 1 privacy-focused
user · 1 repair tech. Observation protocol (your only job beyond sending): watch or ask about the
FIRST cold launch un-coached — where they stalled, what they clicked first, whether the verdict read
as trustworthy plain English — and relay the raw reactions to Claude unfiltered. No survey to build;
the protocol is "first launch, no help, tell us what confused you."

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
- ~~**Wordmark taste fork** (surfaced by the web-design-director): the home page renders "COMPY" as
  all-caps mono; the generated library/debunk pages use a pulsing-"o" wordmark. Director recommends
  unifying to the all-caps mono. **It's your brand taste call** — say unify / keep-both / your own.~~
  → **✅ RESOLVED 2026-07-15** ("completely follow the design directors taste calls"): unified to
  the all-caps tracked mono COMPY site-wide (landing, footer, /compare, all generated Blackbook
  pages); the pulsing-"o" variant is removed.

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
rejected on sight). **Correction (2026-07-11 audit — this line previously contradicted UI_VISION_BACKLOG.md and was
wrong):** Lenis smooth-scroll — **UPDATE 2026-07-22: this correction is now ITSELF stale.** The
2026-07-11 audit found Lenis "still unbuilt, verified 0 files" — true then, but the JARVIS motion
train shipped 2026-07-12 (`1d310e1`) and built it: `src/design/jarvis/LenisSpine.tsx` exists,
imports `lenis@1.3.25`, and is mounted in `ShellV2.tsx` behind the `jarvis` flag (A7 above confirms
that flag is default-ON, owner-ratified 2026-07-14). UI_VISION_BACKLOG.md §A.5 already reflects this
(🟢 BUILT) — only this file's paraphrase had drifted out of sync with it. The HoloLens onboarding
tour redesign is **NOT open — it SHIPPED** (verified 2026-07-08, UI_VISION_BACKLOG.md §H) and should
not have been listed here as unresolved.
**Also corrected 2026-07-22 (same stale-paraphrase pattern — re-verified against current code, and
UI_VISION_BACKLOG.md already had these right):** the magnetic-cursor slice is **BUILT**, not just a
narrower "reticle" — `MagneticLayer.tsx` (delegated magnetic pull via GSAP `quickTo`) is imported and
mounted in `ShellV2.tsx`, commit `1d310e1`. GSAP data-reactivity is **BUILT** — `ArcGauge`'s
count-up/ring-sweep plus a GSAP data-tick flash on real measured changes. The room-transition wipe
itself is **BUILT** (`1d310e1`, keyed remount on room change in `ShellV2.tsx`) — what's actually
still partial is a *different*, narrower sub-piece: Monitor's "living oscilloscope trace" treatment
for its meters (Home has one trace; Monitor's rollout is incomplete) — don't conflate the two.
**Still genuinely open, unchanged:** CommandPalette (deliberately parked — `ShellV2.tsx`'s own
comment: "a search box that does nothing would be a fake affordance — banned," owner call post-P6)
and the site-glow/"full overhaul" gate.
- **You said "there's more I'm missing" + "capture it first"** — done (this doc). **Next → tell me if
  the 🔴 list is complete or still short an item.** The first build target is **DECIDED** — the Instrument
  Bench Phase-1 build (the drag gallery is deleted, not a build option). Note: your original **"Feature Roadmap Checklist (CC Brief)"**
  is NOT in the repo — if *that's* the list you meant, you'd need to re-share it.

### B_startup. A Windows mutation lives outside `actions.rs` — decide whether that's allowed  ·  ⏳ NEW 2026-08-02
Found mechanically by `scripts/verify-module-map.mjs` on its first run. `set_startup_entry_enabled`
(`lib.rs`, a `#[tauri::command]`) writes `HKCU\...\StartupApproved\Run` directly: **no typed rollback
contract, no snapshot, no Trust Ledger entry.** So a startup app Compy disables never appears in the
user's history and cannot be undone from the ledger like every other change. It is self-reversing
from the same toggle, so it is not a hidden one-way door — but LOCKED rule 3 says "never apply a
change you can't roll back," and the map claimed `actions.rs` was the *only* mutation boundary.
**Your call:** (a) route it through `actions.rs` + the ledger like every other apply, (b) declare
startup toggles an explicit, documented exemption, or (c) leave as-is. Nothing changes until you pick.

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
- ✅ **Version numbering call — DECIDED 2026-07-16: "0.9.0 now, 1.0.0 at Claude's bar."** Applied same
  day (manifests + Cargo.lock at `0.9.0`, ship-reinstall derives the filename, drift-guard test added);
  spec flipped to DECIDED:
  [`superpowers/specs/2026-07-16-version-policy-proposal.md`](superpowers/specs/2026-07-16-version-policy-proposal.md).
  Nothing further on you until the 1.0.0 confirmation moment.
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
