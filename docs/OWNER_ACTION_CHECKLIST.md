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

### A_settings. One line in your Claude settings that I am not allowed to touch  ·  ⏳ NEW 2026-08-20

**The ask:** one paste into `~/.claude/settings.json`. Your own rule reserves that file — and any
hook that gates what a session may do — to your hand, which is correct. (Its other edit, the merge
rule keyed to CI checks that never run, is live since 2026-08-30; record in the archive.)

**The receipt hook, if you want it armed.** `.claude/hooks/work-control-receipt-guard.mjs` blocks
`gh pr merge` / `gh issue close` / `gh pr ready` unless a proof receipt exists for the current
commit. It is written, tested both directions, and deliberately **not wired**, because wiring it
means editing the file above. The exact settings block to paste is in a comment at the bottom of the
hook. **Why it matters:** it is the mechanical version of a rule that was already broken once by the
session that had just re-read it.

### A_patches. Four hook fixes waiting for your hands  ·  ⏳ NEW 2026-09-18, #633 added 2026-09-29

**The ask:** hook files are yours to change (#368), so each PR below carries its fix as a
`.patch` in `docs/superpowers/specs/` plus tests. After a PR merges, in the repo folder:
`git apply <patch> && git rm -q <patch>`, run its test, commit. Or tell HQ or Codex to do it.

| PR | Fixes | Patch | Test (expect) |
|---|---|---|---|
| #464 | #463 advisory names another folder's issue | `2026-09-18-known-issue-token-scope.patch` | `tools/entry/project-write-assert.test.mjs` (42 passed) |
| #470 | #468 drift hook asks GitHub on every write | `2026-09-18-scope-drift-hook-thread-bound.patch` | `tools/entry/scope-drift-check-thread.test.mjs` (6 passed) |
| #471 | #465 drift hook measures a released claim | `2026-09-18-scope-drift-hook-released-claim.patch` | `tools/entry/scope-drift-check.test.mjs` (19 passed) |
| #633 (merged) | #632 hand-written successor prompts launch unchecked | `2026-09-29-successor-launch-guard-632.patch` | `scripts/successor-launch-guard.test.mjs` (its skipped owner-hook test then runs and passes) |

#470 and #471 touch the same hook and apply in either order. **Why it matters:** until applied, the
hooks keep issuing wrong or slow warnings that sessions learn to ignore.

### A_prune. Three dead branches I was not allowed to delete  ·  ⏳ NEW 2026-08-31 · re-derived 2026-09-03

**The ask:** one command — `git push origin --delete lane/native-routing-271
lane/css-margin-separators-274 lane/cleanup-train-2026-08-20`. It named FIFTEEN this morning: the
twelve that were **contained in `main`** went with the #355 sweep (P0-B, commit `f93a890e`), which a
session may do because deleting a ref `main` already holds cannot lose a commit. These three are
NOT ancestors, and that is exactly why they are yours: `271` (189 behind) and `274` (187 behind)
landed by squash and would only reintroduce a stale copy of status docs; PR
[#163](https://github.com/Pootytxng/sentinel/pull/163) closed unmerged, leaving
`cleanup-train-2026-08-20` **628 commits behind with an OLDER `handoff-block` guard** — merging it
would REGRESS `main`. Nothing is lost either way: the local refs and their worktrees still hold every
commit, and `scripts/prune-candidates.test.mjs` measures that promise ref by ref.
**`beta/private-beta-001` is deliberately NOT in it** — the frozen beta ref (`16069fa`) that
`CLAUDE.md` puts in owner territory; the same test fails if this command ever names it. It goes stale
every time a lane lands, so it is **re-derived, never carried over — re-derive before running.**
**Why it matters:** until the refs are gone their rows keep saying "landed but still here", which is
exactly what makes the next session distrust the branch list. Nothing is broken while it waits.

### A_wmi. Windows Management Instrumentation is hung on this PC  ·  ⏳ NEW 2026-09-02

**The ask:** reboot when convenient — or restart the *Windows Management Instrumentation* service
yourself; a system service is yours, not mine, under the standing security/system-settings rule.
**Measured 2026-09-02:** `Get-CimInstance Win32_Process` never returns, and `taskkill` takes 61s
and kills nothing, while `Get-Process` and the kernel's own process table answer in milliseconds.
The toolchain no longer depends on it — the tree kill and its guard read the kernel table (commit
`7aeff5f2`), and the preflight's process probe is bounded to 20s and reports nothing rather than
stalling — but anything else on this PC that asks WMI will stay slow or empty until the service is
back. **Why it matters:** two pre-push gates went red on a kill that had already happened; the fix
removed the dependency, only you can remove the symptom.

### A_spent. Spent checkouts to remove  ·  ⏳ NEW 2026-09-01, A_stale folded in 2026-09-26  ·  [#520](https://github.com/Pootytxng/sentinel/issues/520)

**The ask:** open a terminal in `C:\Users\Kuya\code\sentinel` and run these four lines one at a time. Each folder is superseded or salvaged; the evidence is on #520.

- `git worktree remove .claude\worktrees\compy-health-parity`
- `git worktree remove ..\sentinel-recon-261`
- `git worktree remove ..\sentinel-remote-design-286`
- `git worktree remove --force .claude\worktrees\license-tests`

The last line needs `--force` because that folder still holds one uncommitted file, and its tests are already on main (PR #537). Then the other dead checkouts. That list changes daily, so ask any session for it. `node scripts/fleet-snapshot.mjs` reads only git, so the session also checks each folder's branch for an open PR and a live Work Control claim, then hands you one checked command per folder. Branches survive removal, and removal is denied to sessions. **Why it matters:** `git worktree list` is how every session learns what is live, and each dead folder in it is a false lead.

### A_routines. Turn on "worktree" for both successor routines  ·  ⏳ NEW 2026-10-02  ·  [#637](https://github.com/Pootytxng/sentinel/issues/637)

**The ask:** Claude app → Routines → **Compy successor A** → Edit → turn on **worktree** → Save; then the same for **Compy successor B**. **Why it matters:** with it off, a launched successor starts in the shared checkout, where every write is refused, so it can only stop. With it on, each run gets its own folder.

### A-closed. Items you already closed — moved to [`archive/OWNER_ACTION_HISTORY.md`](archive/OWNER_ACTION_HISTORY.md)

None of them is waiting on you (A0's key backup closed 2026-08-18; record and the two count
corrections in the archive). **§A holds EIGHT things:** ① A0's residual — delete the
redundant `Desktop\COMPY KEY\` copy; ② A0's *"expand to the remaining invitees"* — a **distribution call**,
yours by definition; ③ **A_settings**, one paste in a file only you may edit; ④ **A_prune**,
one delete; ⑤ **A_wmi**, one reboot; ⑥ **A_patches**, four hook patches; ⑦ **A_spent**, the spent-folder removals; ⑧ **A_routines**, two toggles.
Archived (2026-08-04, 08-18, 08-20), each with its record and your verdict verbatim under its own heading in [`archive/OWNER_ACTION_HISTORY.md`](archive/OWNER_ACTION_HISTORY.md): **A_ci · A_rig · A_ref2 · B1 · B7 · B_arc · A_crash · A_ref · A_hook · A_disk · A0b · A1 · A2 · A3 · A4 · A5 · A6 · A7 · A8 · A9**.

---

## §B — Waiting on input only you can give

### B9. HQ's "performance assurance" strategy — two calls  ·  ⏳ NEW 2026-10-01  ·  [#639](https://github.com/Pootytxng/sentinel/issues/639)

**The ask:** say **"yes"** (in chat or on #639) to take both recommendations, or redirect either.
**Fork 1:** use "performance assurance" as an internal lens only; no public rename until Verifier v0
can be shown. **Fork 2:** add Verifier v0 (a read-only "did that change actually help?" check) between
Phase 3 and Phase 4. **Why it matters:** they set Compy's public category and what is built after
Phase 3. Nothing waits on them today.

### B8. Your #224 board row carries another lane's data — still yours?  ·  ⏳ NEW 2026-09-03

**The ask:** one word. The Work Control row for [#224](https://github.com/Pootytxng/sentinel/issues/224) is Lane = **Kuya**, so no agent retires
it — but its fields are #225's (worktree `compy-health-parity`, expiry 2026-08-27), while your newest claim on it
names `compy-visual-recovery-kit-6fd074`, expiry 2026-09-02. Say **"mine"** and it stays; say **"release"** and the
P0 lane retires it with the others. **Why it matters:** until then #224 blocks every lane touching its paths, on a claim nobody can tell is live.

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

**2026-07-22 wrong-link incident — ✅ closed, nothing on you;** record moved to [`archive/OWNER_ACTION_HISTORY.md`](archive/OWNER_ACTION_HISTORY.md) §B2 (2026-09-23).

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
- **Ko-fi is the single most-ready money surface** ([`product/MONETIZATION.md`](product/MONETIZATION.md);
  Ko-fi bridge): `src/data/site.ts` `KOFI_URL` is empty by design (empty = no support link ships, **no
  dead link**), and two dormant slots — the footer and the waitlist section — light up the instant
  you give me the URL. One line, regenerate, deploy. **Result → tell Claude: your Ko-fi profile URL.**

### B6. Monetization — money-surface unlocks  ·  ⏳  ·  [`product/MONETIZATION.md`](product/MONETIZATION.md)
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
- **Compy Pro (Layer 3)** — built dark, correct posture. **Price band 2026-08-22 (a hypothesis under Constitution §32): $4.99/mo ·
  $39/yr · $89 lifetime** ([`PRICING_RESEARCH.md`](PRICING_RESEARCH.md) — every comparable
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

### B5. Historical UI evidence reconciled — no current owner action  ·  ✅  ·  [`UI_VISION_BACKLOG.md`](UI_VISION_BACKLOG.md)
The motion/interaction stack you were most excited about is **built and on by default** — magnetic
cursor, Lenis spine, GSAP data-ticks and the room wipe shipped `1d310e12` (2026-07-12) and you
approved them on sight ("everything looks good"). The panoramic drag gallery you rejected 2026-07-09
and it was **deleted on your order** (`2de8d17c`); its drag/inertia feel lives on the rig hologram.
Two doc lines kept paraphrasing all of that as unbuilt and sent a session at it on 2026-08-24;
`src/ui-vision-status-guard.test.ts` rule D now fails the build on a pointer that names features
instead of rows. What historical [`UI_VISION_BACKLOG.md`](UI_VISION_BACKLOG.md) still labels 🔴 OPEN
is evidence to reconcile against the Product Constitution and roadmap, not current product priority
or authorization: **DIR-1** (your intuitive-UI lens) and **§G**
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
- **You said "there's more I'm missing" + "capture it first"** — preserved here as historical evidence. This record does not ask you to reconstruct a list and does not authorize its former
  Instrument Bench build target. Current direction comes from `docs/PRODUCT_CONSTITUTION.md`; current
  sequence comes from `docs/product/ROADMAP.md`.

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

### D_health. Health room parity — judged at the DEFAULT accent unless you veto  ·  ⏳ 2026-09-01, corrected same day  ·  [#225](https://github.com/Pootytxng/sentinel/issues/225)

**This row asked the wrong question, and is corrected rather than deleted so the mistake is legible.** It said your desk ran theme `midnight` with the Health accent set to a bare Sky `#46a8ff` — a value the picker no longer offers, so the app drops it and the room falls back. **Measured 2026-09-01** by an independent session reading the live app rather than the code — theme `violet`, accent `#b6f24a+#35e0e8` (Lime / Cyan), on all five rooms. That is a **reading, not a setting**: one click on an accent dot makes this line stale and nothing re-measures it for you.

**The call I am taking, so it is not parked on you: judge Health against the comp's DEFAULT accent.** The comp is the contract and it was shot there; your picks are yours and I change nothing. **Veto on sight** if you would rather I re-shoot the comp at Lime / Cyan — the only other honest option, and it costs a re-shoot, not code.

**I will never write your theme or accent to match a comp.** No code changes either way. Round 3 (`b4bf26bc`) was rejected for an incomplete difference list; that gap is fixed.
**Nothing aesthetic is parked on you by default** (CLAUDE.md, "TASTE IS MINE TO EXERCISE, HIS TO
OVERRULE"). Claude decides the look, ships it, and hands you a before/after to veto on sight. Only
brand — the product name, logo, price presentation — and reversals of a call you already made land
here as decisions. **Closed §D sign-offs (the interview default, the title-foil sweep, version
numbering, the motion default, the sibling-slop sweep) moved 2026-08-22, plus the wordmark reading
and the verdict-headline tail moved 2026-09-03, to
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
---

## Where the full lists live (so nothing is buried again)
| Area | Canonical doc |
|---|---|
| Gaming Mode QA cases | [`GAMING_MODE_QA.md`](GAMING_MODE_QA.md) |
| Beta smoke pass | [`BETA_SMOKE_CHECKLIST.md`](BETA_SMOKE_CHECKLIST.md) |
| What's next / status ledger | [`BACKLOG.md`](BACKLOG.md) |
| Historical owner UI/design evidence (not product priority) | [`UI_VISION_BACKLOG.md`](UI_VISION_BACKLOG.md) |
| Live gate/build state | [`RELEASE_STATE.md`](RELEASE_STATE.md) |
| Funnel go-live steps | [`archive/cowork-cc-relay/2026-06-15-funnel-golive-todo.cc.md`](archive/cowork-cc-relay/2026-06-15-funnel-golive-todo.cc.md) |
| NVIDIA validation (needs NVIDIA hardware) | [`NVIDIA_VALIDATION_PLAN.md`](NVIDIA_VALIDATION_PLAN.md) |

---

*Maintained by Claude — reconciled against every task-list doc in the repo. Items get added the
moment a deferred owner-action arises and checked off when you confirm. Ask "show my checklist" for
the current state.*
