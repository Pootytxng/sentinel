# Owner Action Checklist — the ONE place your open items live

> **Pull this up anytime ("show my checklist").** This is the single consolidated index of
> everything waiting on **you** — your hands (a UAC, a reboot, an eyeball), your input (a list, a
> URL, a decision), or your money/legal call. It exists because your asks were scattered across six
> different docs and got dropped; now every one of them points back here, and **every session is
> told to read this file** (wired into `CLAUDE.md`). Nothing here blocks Claude's ongoing build work
> — it keeps going and only raises one of these if it *truly* can't proceed.
>
> **Status legend:** ⬜ open · ✅ done · ⏳ waiting on you · 🔒 gated on money/legal.
> **A checklist that lists non-asks is worse than no checklist** — it makes the real ones harder to
> see, and it trains you to skim. The 2026-08-20 self-checkup pulled six items that never needed you
> (detail in §A-closed); if you find another, say so and it goes the same way.
> Last reconciled for release truth: **2026-07-28**; broader owner-list audit remains the
> **2026-07-11** Cowork pass (added the missing
> Monitor-v4 eyeball item, fixed a same-day self-contradiction on Lenis/HoloLens status, flagged a
> dead repo link in the legal drafts). Not a full re-sweep of every doc — see
> `docs/COWORK_AUDIT_2026-07-11.md` for what was and wasn't checked.

---

## §A — Needs your hands or eyes (owner-run, reversible)

### A_merge. One click: PR #160 is verified green but no session can merge it  ·  ⏳ NEW 2026-08-20

**The ask:** merge [PR #160](https://github.com/Pootytxng/sentinel/pull/160), or add a Bash
permission rule for `gh pr merge` so a session can. Nothing else about it is open.

**Why it matters in plain English:** the work is finished and proven — a report-only line in the
weekly usage report that tells you when a Rust build folder has grown past ~20 GB, so disk bloat
stops being invisible. It changes nothing on your PC and can delete nothing. It is sitting unmerged
purely because `gh pr merge` is refused by the session permission classifier — **twice now, in two
different sessions.** That is a permission, not an engineering problem, and I cannot clear it myself.

**State:** OPEN and MERGEABLE at `e3c8b0c7`. Gate re-run from scratch this session rather than
trusted: 350/350 test files, 4582 tests, Rust 963/0, clippy, `LOCAL CHECK RESULT: PASS`. Receipt
`.claude/work-control/2026-08-20-merge-pr-160.json`, `scripts/work-control-gate.mjs` → PASS. After
the merge the ref `origin/lane/usage-audit-disk-bloat` and its row in
[`BRANCH_DISPOSITIONS.md`](BRANCH_DISPOSITIONS.md) get pruned together, and issue
[#158](https://github.com/Pootytxng/sentinel/issues/158) closes.

### A0. NEW 2026-07-23 — Live updater: key backup + the LAST manual send

- ✅ **Updater signing key backed up OFF this machine — CLOSED 2026-08-18 (owner-reported).** The
  owner ran `scripts/backup-updater-key.ps1`, proved the armored file opens with
  `scripts/restore-updater-key.ps1 -Verify`, and stored the result off this PC with the passphrase in
  his password manager. The fleet anchor (`43711DD10AAB67D7`, the pubkey pinned in
  `src-tauri/tauri.conf.json` and `scripts/updater-trust-root-guard.test.mjs:23`) now survives a dead
  drive. **Why it mattered:** lose it → the fleet can never receive another update; leak it → whoever
  holds it can sign an update Compy installs silently on every install, because the updater has been
  live since 2026-07-22. Backup/restore behaviour stays pinned by
  `scripts/updater-key-backup-guard.test.mjs`.
- ⏳ **Residual (small, owner's hands): the `C:\Users\Kuya\Desktop\COMPY KEY\` copy.** It hashes
  identical to `C:\Users\Kuya\.tauri\compy-updater.key` — same secret, same disk, and a Desktop folder
  is the first place anything that ever runs on this PC looks. Now that an off-machine backup exists,
  deleting the Desktop folder is pure exposure reduction with no recovery cost. Deleting key material
  is owner territory, so it stays here rather than being done for you. The `.tauri` copy is the one
  the release train actually signs with — leave that one alone.
  Repo side is clean and mechanically enforced: no key material has ever been committed on any
  branch, and `scripts/secret-containment-guard.test.mjs` fails the build if key/`.env` patterns leave
  `.gitignore` or if key material ever lands in the index. Nothing for you in that half.
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
  live: v0.9.26 (`5e64074c`) published 2026-08-19** — public release id `372920800`, installer
  SHA-256 `4b72d681…9294e98`, manifest `0.9.26`, signature verified, and your own box runs those
  exact bytes — and the canary (on v0.9.11) proves that path works on someone else's machine. Every
  precondition is met (full local gate set green; hosted Actions stay off by your standing decision
  — see B7 — so **local IS the gate**), so nothing blocks widening but your call on who and when.
  The release page is
  `https://github.com/Pootytxng/compy-releases/releases/latest`. Once an invitee installs one
  updater-enabled build, future patches reach them in-app ("update ready" pill → one click). Key
  custody/rotation,
  Authenticode enrollment, publication, distribution, and external timing are owner territory;
  protected use of the existing updater key inside an authorized local release train is engineering.

### A-closed. Items you already closed — moved to [`archive/OWNER_ACTION_HISTORY.md`](archive/OWNER_ACTION_HISTORY.md)

None of them is waiting on you. **A0's key backup is CLOSED (2026-08-18)** — the signing key is
backed up off this machine and verified. **§A now holds TWO things, and only one is a chore:**
① A0's small residual — delete the redundant `Desktop\COMPY KEY\` copy (one command, 10 seconds);
② A0's *"expand to the remaining invitees"* — not a chore but a **distribution call** that is yours
by definition (who gets a build, and when). Corrected 2026-08-20: this paragraph said "exactly ONE"
while ② sat three bullets above it, still marked ⏳ — a checklist that miscounts itself is the same
defect as one that lists non-asks.
Archived 2026-08-20 by a self-checkup, because none of them ever needed you and a checklist that
lists non-asks makes the real ones harder to see: **A_ci** (GitHub refused branch protection on this
plan — the answer came from GitHub, not from you) · **A_rig** (its own text says "nothing for you to
do today"; it is a logged honesty note, not an action) · **A_ref2** (a "single delete click" that was
already done — the ref was gone from origin and its disposition row with it) · **B1** (resolved
verbally 2026-07-08; its one live residual is tracked in `BACKLOG.md`) · **B7** (site auto-deploy,
**CANCELLED BY OWNER 2026-07-16 — do not resurface**) · **B_arc** (filed as an owner fork on
2026-08-20 and it should never have been: dead engineering, not a product call; executed the same
day — see the `.arc-v2` row in `BACKLOG.md`).
Archived 2026-08-18: **A_crash** · **A_ref** · **A_hook** · **A_disk**, all closed 2026-08-11/12.
Archived 2026-08-04 (TOKEN LAW §1 — history leaves the live doc, never gets deleted): **A0b** zh-CN
merged + published in v0.9.11 · **A1** Gaming Mode QA signed off · **A2** beta smoke (sitting waived;
the live beta thread is **§B2** below) · **A3** Lab Ops Console · **A4** Home console · **A5** Monitor
v5 flight deck · **A6** three-train eyeball · **A7** JARVIS motion · **A8** Blackbook logbook · **A9**
per-room accents + palette. Your verdicts are preserved verbatim there.

---

## §B — Waiting on input only you can give

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
**Still genuinely open, unchanged:** the site-glow/"full overhaul" gate.

<!-- shipped-status-history -->
**Corrected 2026-08-19 (backlog C-12, same stale-paraphrase pattern as the two above).**
CommandPalette was listed here as deliberately parked, quoting `ShellV2.tsx`'s "a search box that
does nothing would be a fake affordance." The owner unparked it 2026-08-11 and it has shipped
**DEFAULT ON** since `22fb15b2` — topbar box + Ctrl+K over every destination, `UI_VISION_BACKLOG.md`
§D. **Nothing here is waiting on you for it.** `src/design/shipped-feature-doc-truth.test.ts` now
fails the suite if this claim comes back.
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

### B_gpu. A finished GPU-profile screen is built, tested, and mounted nowhere  ·  ⏳ NEW 2026-08-04
Found by the UI face inventory ([`UI_FACE_INVENTORY.md`](UI_FACE_INVENTORY.md) §d).
`src/surfaces/GpuProfile.tsx` — 346 lines, its own passing test suite (scope picker, before/after
delta, vendor advisory badges), plus `data/gpu-profile-store.ts` and `hooks/use-gpu-profile-scope.ts`
— has **zero non-test importers.** No room mounts it, so no user has ever seen it. It can only ever
be **advisory**: LOCKED rule 6 says GPU-profile *apply* is structurally impossible (AMD profile state
isn't user-mode readable, so rollback-first can't be satisfied). **Your call:** (a) wire it into a
room as an advisory panel — most likely the Lab — or (b) archive the trio. Product call, not cleanup;
nothing is deleted until you pick.

---

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

### B_eu. Analytics default-ON — one region question before it ships to strangers  ·  ⏳ NEW 2026-08-18
Same decision record. Usage analytics going **on by default with disclosure** is normal and legal in
the US. In the **EU/UK**, non-essential analytics generally needs the user to say yes first, and
"disclosed but on" is not yes. It changes nothing about the local app or your own machine — it only
matters once Compy is downloadable by Europeans. **Your call:** (a) US-first, ship default-ON and
region-gate later, (b) ask on first run everywhere (fewer people say yes, but zero legal exposure).
I would take (a) — you have no EU distribution today and (b) can be added the day you do.

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
**Nothing aesthetic is parked on you by default** (CLAUDE.md, "TASTE IS MINE TO EXERCISE, HIS TO
OVERRULE"). Claude decides the look, ships it, and hands you a before/after to veto on sight. Only
brand — the product name, logo, price presentation — and reversals of a call you already made land
here as decisions.
- ✅ **The title foil sweep now stops instead of looping forever — APPROVED 2026-08-06**, on a
  side-by-side before/after he watched run.  ·  PR [#76](https://github.com/Pootytxng/sentinel/pull/76)
  The shine that travels across the big room titles used to repaint that text on every single frame,
  forever, in every room — on its own it was **29.8% of one CPU core** while he did nothing. It now
  sweeps once when a room opens and settles. His verdict, verbatim: *"keep the more efficient shine
  change youre right compy isnt suppose to be a resource hog whatsoever matter of fact it should be
  the most optomized thing oin someons pc altoether."* That second sentence is a **standing product
  bar**, not a note about this one animation — recorded in [`perf/README.md`](perf/README.md).
  Nothing further on him here; the `infinite` revert is not being held open.
  Two things rode along and remain open: the 3D "two futures" scene could not be visually checked
  (it only mounts once he has a measured before/after pair, which this desk lacks — its diff is a
  screen-reader label only), and `src/surfaces/Optimize.css:175` still has a pre-existing bounce ease
  this lane deliberately did not touch.
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

- 🔨 **Home front door — the clutter you flagged 2026-08-18.** You saw Home on `555e2996` and called
  the stacked wording, the "What are you here to do?" question, the drop-down and the
  "16/16 measured · 1 flagged · Re-run check" band the exact opposite of the neat bento we agreed on.
  You were right, and none of it was written down as decided — that gap is the finding, not the
  pixels. **Shipped already** (PR [#136](https://github.com/Pootytxng/sentinel/pull/136) → `dbf174d2`,
  self-review PASS): the question is gone when there is nothing to answer, the topbar tagline is
  gone, the accent side-stripe is gone. **Correction:** that PR did NOT clear the third one you
  named — the bordered "Re-run check" button was still on the shipped build, and a screenshot is
  what caught it, not the 4,979 passing tests. It is now a plain text link (`436818c2`, self-review
  PASS 10/10 on the installed binary). All three are confirmed gone from the live app. Full list and what
  remains: [`CONFORMANCE_AUDIT_2026-08-18.md`](CONFORMANCE_AUDIT_2026-08-18.md), queue in
  [`BACKLOG.md`](BACKLOG.md) (C-04 … C-17).
  **The one call I want your eye on — recommendation attached, not a menu:** rename the **Home** room
  to what it answers (**"Health"**). Home names a location; every other room names a job, and the
  front door is where Compy either reads as a PC doctor or as a launcher. Say no and it stays Home.
  Everything else in that queue is taste and therefore mine — I ship it and hand you a before/after
  to veto on sight, per the 2026-08-07 decree.

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
