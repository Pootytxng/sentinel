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

### A_settings. Two lines in your Claude settings that I am not allowed to touch  ·  ⏳ NEW 2026-08-20

**The ask:** two small edits in `~/.claude/settings.json`. Your own rule reserves that file — and any
hook that gates what a session may do — to your hand, which is correct and I am not asking to change
it. Both are copy-paste.

**① A permission rule that can never be satisfied.** The `autoMode` block allows merging a PR "when
required CI checks are passing" and tells me to confirm with you first when checks are "failing,
pending, or **absent**". Hosted CI is OFF by your own 2026-07-16 zero-budget decision, so checks are
**always absent** — the rule reads as a permanent stop on a condition that can never clear. The gate
that actually runs on every push is `scripts/verify-local.ps1`. Replace, in `allow`:
`"…allowed when the owner has asked for the merge and required CI checks are passing."` and in
`soft_deny`: `"Merging a pull request whose required CI checks are failing, pending, or absent —
confirm with the owner first."` with wording keyed to the local gate instead. **Why it matters:**
right now the written rule and the working reality disagree, and a rule nobody can satisfy gets
worked around rather than followed — which is exactly how PR #157 got merged with no receipt.

**② The receipt hook, if you want it armed.** `.claude/hooks/work-control-receipt-guard.mjs` blocks
`gh pr merge` / `gh issue close` / `gh pr ready` unless a proof receipt exists for the current
commit. It is written, tested both directions, and deliberately **not wired**, because wiring it
means editing the file above. The exact settings block to paste is in a comment at the bottom of the
hook. **Why it matters:** it is the mechanical version of a rule that was already broken once by the
session that had just re-read it.

### A_prune. Dead refs and dead folders — one cleanup pass  ·  ⏳ 2026-08-31, re-scoped 2026-09-01

**Two commands, and neither is urgent.** Both were **denied to this session**, and a denial is a stop.

1. `git push origin --delete lane/native-routing-271 lane/css-margin-separators-274
   lane/cleanup-train-2026-08-20 lane/agent-skills-config` — four spent refs. Three landed (PRs
   [#273](https://github.com/Pootytxng/sentinel/pull/273) → `e26108f7`,
   [#275](https://github.com/Pootytxng/sentinel/pull/275) → `29fb8009`,
   [#290](https://github.com/Pootytxng/sentinel/pull/290) → `90e253a8`). The fourth's PR
   [#163](https://github.com/Pootytxng/sentinel/pull/163) closed **unmerged**, but its one real fix
   reached `main` independently and more fully, leaving that branch 139 lines BEHIND on its own files.
2. `git worktree remove` for the **fourteen** checkouts carrying no commit `main` lacks.

**Nothing is lost by either.** The local refs and their worktrees still hold every commit, so any of
the four branches can be pushed back with one command. The only real content those folders held was
six work-control proof receipts — evidence for merges and closes that existed on no branch at all, one
a full independent-review record. All six are now **verified present on `main`**, so those folders
hold nothing unique. What remains in them is a tool scratch folder and duplicate copies of those same
six receipts.

**Struck from this item 2026-09-01 — done, not waiting on you:** the ten rewritten `.codex/config.toml`
copies are restored, and one line-ending drift in a `CLAUDE.md` with them. That restore turned out to
be permitted when tried on its own, so it was simply done. Every worktree on this machine now reports
**zero tracked drift**, except the two another writer currently holds, which were left alone on purpose.

**Why it matters:** `git worktree list` and the branch list are what every new session reads to learn
what is live. Fourteen dead folders and four landed-but-present refs are why sessions keep re-deriving
the same wrong picture — and why the docs must keep saying "landed, still here".

### A-closed. Items you already closed — moved to [`archive/OWNER_ACTION_HISTORY.md`](archive/OWNER_ACTION_HISTORY.md)

None of them is waiting on you. **A0's key backup is CLOSED (2026-08-18)** — the signing key is
backed up off this machine and verified. **§A now holds THREE things, and only one is a chore:**
① A0's small residual — delete the redundant `Desktop\COMPY KEY\` copy (one command, 10 seconds);
② A0's *"expand to the remaining invitees"* — not a chore but a **distribution call** that is yours
by definition (who gets a build, and when); ③ **A_settings**, two copy-paste edits in a file only you may
edit. Corrected 2026-08-20: this paragraph said "exactly ONE"
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
Archived 2026-08-18 and 2026-08-04, each with its full record and your verdict verbatim under its own heading in [`archive/OWNER_ACTION_HISTORY.md`](archive/OWNER_ACTION_HISTORY.md): **A_crash · A_ref · A_hook · A_disk · A0b · A1 · A2 · A3 · A4 · A5 · A6 · A7 · A8 · A9**. The archive is the index; re-listing what each one was here was a second copy that only cost boot tax.

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
- **Compy Pro (Layer 3)** — built dark, correct posture. **Price ✅ SET 2026-08-22: $4.99/mo ·
  $39/yr · $89 one-time lifetime** ([`PRICING_RESEARCH.md`](PRICING_RESEARCH.md) — every comparable
  charges more than the old $25/yr guess, and a shop charges $45–95 just to *look* at a PC). Still
  needs **a legal entity + merchant-of-record (Paddle route) + shipped Pro value.** The site's "in
  the works / no price yet" card stays until Pro is purchasable.
- **B2B licensing (Layer 4)** — parked, post-traction. No page until you ask.
- **✅ CLOSED 2026-08-22 — the live site no longer calls Compy free.** You said *"land 193 dude"*;
  PR [#193](https://github.com/Pootytxng/sentinel/pull/193) merged as `d5571766`. `site/llms.txt` and
  its real source `site/generate.mjs:441` now read **"a Windows desktop app with a free tier"** — your
  own decree's words, saying nothing about Pro's price, contents or timing.
- **Wordmark taste fork** — ✅ RESOLVED 2026-07-15, moved to
  [`archive/OWNER_ACTION_HISTORY.md`](archive/OWNER_ACTION_HISTORY.md).

### B4. Two substituted asks — confirm or redirect  ·  ⏳
Both were real asks that got quietly *substituted* rather than done — flagging so you can close or
push:
- **"Trending design tooling (Figma / v0-Vercel MCPs)"** (de-slop directive #6): Claude built the
  redesign in-repo instead because those MCPs spend your owner-gated credits. If you WANT the tooling
  used, say so; otherwise this stays a deliberate no.
- **"Upgrade-path engine"** (your Optimize feedback, 2026-07-03): the advisory upgrade block exists,
  but the fuller engine was deferred to "its own spec" and never built. Want it built, or leave it?

### B5. Your UI vision — what is still yours to call  ·  ⏳  ·  [`UI_VISION_BACKLOG.md`](UI_VISION_BACKLOG.md)
The motion/interaction stack you were most excited about is **built and on by default** — magnetic
cursor, Lenis spine, GSAP data-ticks and the room wipe shipped `1d310e12` (2026-07-12) and you
approved them on sight ("everything looks good"). The panoramic drag gallery you rejected 2026-07-09
and it was **deleted on your order** (`2de8d17c`); its drag/inertia feel lives on the rig hologram.
Two doc lines kept paraphrasing all of that as unbuilt and sent a session at it on 2026-08-24;
`src/ui-vision-status-guard.test.ts` rule D now fails the build on a pointer that names features
instead of rows. What [`UI_VISION_BACKLOG.md`](UI_VISION_BACKLOG.md) still lists 🔴 OPEN: **DIR-1**
(your standing intuitive-UI lens — mine to apply on every train, nothing for you to pick) and **§G**
(the site's mini playable demo, which you flagged "maybe later"). **Yours — BOTH are now answered, so nothing in this
section is waiting on you:**
1. ~~**Do you want a panoramic drag surface back**~~ — ✅ **ANSWERED "no", 2026-08-25.** You took the
   recommendation: no second drag canvas, the hologram's drag-orbit keeps that feel, and the sensory
   load DIR-1 bars stays barred. Written into `UI_VISION_BACKLOG.md` §A.1 so it cannot come back as
   a paraphrase. **Nothing on you here any more.**
2. ~~**#49's B1–B5 needs your ChatGPT mockups**~~ — ✅ **RETRACTED 2026-08-25, it was never true.**
   You approved four room comps on 2026-08-23 and they have been bundled and implementation-ready
   since. Three of my ledgers said you still owed me pictures. **Nothing on you here — B1/B3/B4/B5
   are mine to make and show you, and B2 is already your ruling.**
- **You said "there's more I'm missing" + "capture it first"** — done (this doc). **Next → tell me if
  the 🔴 list is complete or still short an item.** The first build target is **DECIDED** — the Instrument
  Bench Phase-1 build (the drag gallery is deleted, not a build option). Note: your original **"Feature Roadmap Checklist (CC Brief)"**
  is NOT in the repo — if *that's* the list you meant, you'd need to re-share it.

### B-closed6. Six items closed 2026-08-18/22 — moved to [`archive/OWNER_ACTION_HISTORY.md`](archive/OWNER_ACTION_HISTORY.md)
**None of them is waiting on you.** `B_startup` (a Windows mutation outside `actions.rs` — already fixed the day after it was filed) · `B_gpu` (the finished GPU-profile screen, now mounted in the Lab, advisory forever) · `B_write` (the unverified-session write refusal, armed) · `B_shelter` (a row that was simply wrong — the collision guard had been on `main` since 2026-08-21, and a guard now fails the build if that stale-ask class recurs) · `B_land` (feedback and analytics post to your own site, into Cloudflare D1 — **your one residual is a single site deploy when the Q9b endpoints are built**) · `B_eu` (analytics default-ON, decided US-first; revisit the day Compy is downloadable by Europeans — that trigger is the reason it is archived rather than deleted). Closing verdicts preserved verbatim in the archive.

---

## §C — Release gates — your money / legal calls  ·  🔒
These gate **public** release only (not the local app you use daily). Full list:
[`ARCHITECTURE_LOCKS.md`](ARCHITECTURE_LOCKS.md) pre-launch section.
- 🔒 **Code-signing route** — Azure Trusted Signing is the noted $0-first path; resolves the "unknown
  publisher" UAC banner for every elevation.
- 🔒 **Legal** — `docs/EULA.md` + `docs/PRIVACY.md` are drafts to finalize. **Narrower than it looks
  (2026-07-11 audit):** license model (proprietary, all-rights-reserved) and governing law (United
  States) are already decided in EULA v0.3 — only the `[STATE]` venue blank is genuinely open.
  ~~**Bug found:** both docs link to `https://github.com/Pootytxng/compy`, which doesn't exist.~~
  **FIXED and re-verified 2026-08-23** — `docs/PRIVACY.md:87` and `site/privacy.html` both point at
  `Pootytxng/compy-releases`, which is public and live. `git grep 'github.com/Pootytxng/compy\b'`
  returns no hit in either legal doc. This entry sat here as a live bug for weeks after the fix
  landed (`docs/BACKLOG_ARCHIVE.md:903` records it) and was re-reported from this line as though
  still open. **A checklist that keeps a fixed bug open costs the same as one that misses a real
  one.**
- 🔒 **GitHub repo rename → `compy` + `compy.gg` domain** — bundled at first public exposure. **NOW
  TIMELY (2026-07-15):** the site is deployed and every canonical URL, the sitemap, and the JSON-LD
  already point at `https://compy.gg`, but the domain isn't purchased — the site currently lives only
  on `compy-bd6.pages.dev`. Buying `compy.gg` + pointing it at the Pages project is the last
  owner-only step before the SEO/canonical layer is actually correct in the wild.
- 🔒 **Receipts telemetry arming** — new outbound-network boundary, still dark. **The consent UI you
  were owed is now BUILT and merged** (#217 / PR #218, `8b2f0f64`): a first-run disclosure card, a
  real off switch, `EULA.md` §10, `PRIVACY.md` v0.6, and the receiver deployed + empty on your yes.
  Your 2026-08-24 ruling holds — **opt-in, default OFF even after arming**, because the shipped
  description already promises "No telemetry". **ONE thing is on you, not two — corrected 2026-08-26.**
  ① ~~how the disclosure card looks~~ ships as a taste call instead of waiting on you: the
  2026-08-07 decree makes the look mine to ship, yours to veto on sight. **Said honestly, because a
  reviewer pushed back on the flat version:** that decree carves out what reaches other people's
  machines, so a consent screen is the closest case yet — first application, not settled precedent.
  The fix itself was a legibility defect, squarely taste's side. Want consent surfaces yours by
  class? Say so and it becomes a rule. It has a visual self-review
  **PASS 12/12** (2026-08-25, two fix round-trips — a refused consent write was rendering in the same
  calm grey as ordinary copy, fixed in `b20e59dc` along with the identical defect in `Fix.tsx` and
  `LicensePanel.tsx`), and you already have its before/after. Saying nothing is a valid answer; it
  ships as built. ② **Arming itself is yours and always will be** — that is the whole gate. Nothing
  sends until you do that one thing.
- 🔒 **Compy Care Tier 1 arming** — a second outbound boundary, and as of **2026-08-26** the code
  for it is on `main` (#220, PR #221). It lets Compy show a publisher's own write-up next to a crash, from a catalog
  it has cryptographically verified. It **downloads** knowledge and **uploads nothing** — that is
  what makes it Tier 1, and it can never authorize Tier 2 or 3. **Three independent locks each
  refuse on their own** (gate hard-false, all-zero trust key, empty endpoint AND origin lists), so
  no shipped build reaches the network through it. **Nothing to decide today.** What will be yours,
  and only yours: custody of the signing key, the catalog's domain, and the arming itself — after an
  independent security review. This row exists so that arming can never happen quietly.

---

## §D — Taste / visual sign-offs (as they come up)

### D_health. Health room parity — which accent do I judge it at?  ·  ⏳ NEW 2026-09-01  ·  [#225](https://github.com/Pootytxng/sentinel/issues/225)

**One question, and it is the only thing blocking the Health room.** Your desk runs theme `midnight` with the Health accent set to Sky `#46a8ff`. Both are **your saved picks, not bugs** — but the approved comp was shot at Health's DEFAULT accent, so the room and the comp are being compared in two different colour schemes.

- **(a) Judge it at the default accent** — recommended. The comp is the contract and it was shot there; nothing about your saved picks changes.
- **(b) Re-shoot the comp** at Sky, and judge against that instead.

**I will never write your theme or accent to match a comp.** No code changes either way — this decides what "parity" is measured against. Round 3 (`b4bf26bc`) was rejected for an incomplete difference list; that report gap is fixed and the colour state is now stated with native proof.
**Nothing aesthetic is parked on you by default** (CLAUDE.md, "TASTE IS MINE TO EXERCISE, HIS TO
OVERRULE"). Claude decides the look, ships it, and hands you a before/after to veto on sight. Only
brand — the product name, logo, price presentation — and reversals of a call you already made land
here as decisions. **Closed §D sign-offs (the interview default, the title-foil sweep, version
numbering, the motion default, the sibling-slop sweep) moved 2026-08-22 to
[`archive/OWNER_ACTION_HISTORY.md`](archive/OWNER_ACTION_HISTORY.md) §D — nothing in them is on you.**
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
  **The one call I wanted your eye on — ✅ ANSWERED, nothing left here:** you took the Home → **Health**
  rename on 2026-08-19; the rail ships it (`src/design/homeRail.ts:17`). Everything else in that queue
  is taste and therefore mine — I ship it and hand you a before/after to veto on sight, per the
  2026-08-07 decree.
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
