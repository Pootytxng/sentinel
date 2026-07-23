# Beta Distribution Record — who got what, exactly

> The canonical record of every private-beta artifact that leaves this machine. One row per
> recipient, exact link + artifact identity per send. Required by the owner-dictated distribution
> protocol (2026-07-21, `OWNER_ACTION_CHECKLIST.md` §B2). Update this file the same day anything
> is sent.

## Release: Compy 0.9.0 Invite-Only Private Beta — Validated binary source: 37a166c

**Artifact identity (the ONLY file this release may distribute):**

- File: `Compy_0.9.0_x64-setup.exe` (NSIS)
- Built from: `37a166c` (`37a166ca4825c7320477b67af6a258456065ab18`)
- SHA-256: `6BC2F7DFBCCC31A6714A49EE07F36327016DBB65741FA40D4371A45690F5A2C4`
- Size: 3,826,464 bytes
- Never overwrite this file with a different build under the same filename.
- **Canonical artifact location: Drive fileId `1BNuoY-ubKCLTkPUDFdnmFGAUkK4g0J9n` — verify through
  the link, never through a local path.** The Desktop copy ceased to be this artifact on
  2026-07-22 05:32: the `970f801` rebuild overwrote `C:\Users\Kuya\Desktop\Compy_0.9.0_x64-setup.exe`
  under the same filename (caught by pre-QA re-hash — `4B597830…`, 3,825,592 B). Local paths are
  convenience copies, not identity; the send rule's through-the-link verification is what protects
  testers from exactly this class of drift.

**Protocol checklist (2026-07-21 GO — staging executed 2026-07-22 via Cowork/Chrome):**

| Step | Status |
|---|---|
| SHA-256 recalculated pre-upload, matches | ✅ 2026-07-21 (CC) + independently re-verified 2026-07-22 (Cowork: hashed the staged Desktop copy directly) — `6BC2F7DF…F5A2C4`, 3,826,464 B |
| Uploaded to private tester location (Google Drive) | ✅ 2026-07-22 — via Chrome (Drive's own file-input, New > File upload), as a **brand-new file entity**; never touched any existing file's slot |
| Link sharing set to "anyone with the link — Viewer" | ✅ 2026-07-22 — confirmed both in the Drive UI and via the Drive API (`get_file_permissions` → `{role:"reader", type:"anyone"}`) |
| Download tested from a second browser (unauthenticated fetch) | ✅ 2026-07-22 — unauthenticated `curl` (no Google session) against both the `/view` link and the direct-download endpoint: HTTP 200 on both. Note for the invite: the direct-download path serves Google's own "can't scan this file for viruses — this file is executable" interstitial first (needs a click through "Download anyway"), **separate from and before** the Windows SmartScreen prompt. |
| Downloaded copy SHA-256 matches | ✅ 2026-07-22 — pulled the live Drive file back down via the API, decoded it, hashed it (`6bc2f7dfbccc31a6714a49ee07f36327016dbb65741fa40d4371a45690f5a2c4`), and `cmp`'d it byte-for-byte identical against the source exe |
| Testers told: unsigned invite-only beta, SmartScreen expected | ✅ baked into `beta-kit/invite-message-0.9.0.txt` (rewritten 2026-07-22 to the owner's exact verbatim wording for this round) |

**Link:** https://drive.google.com/file/d/1BNuoY-ubKCLTkPUDFdnmFGAUkK4g0J9n/view?usp=sharing
(Drive fileId `1BNuoY-ubKCLTkPUDFdnmFGAUkK4g0J9n`)

**MANDATORY SEND RULE (2026-07-22 — born from that morning's wrong-link send):** No link goes to
any human until it has been verified by downloading through that exact public link
**unauthenticated** and matching the artifact SHA-256 above. Only links recorded in THIS file get
sent — if a link isn't in this record, it doesn't get sent. (The 2026-07-22 failure: a send went
out before any verify, using the retired kit's link instead of the staged one above — protocol
steps 3 and 5 skipped.)

**Invite text:** `beta-kit/invite-message-0.9.0.txt` — rewritten 2026-07-22 to the owner's exact
verbatim SmartScreen warning + single "install cold" ask. **Flagged, not silently changed:** this
replaces the file's prior 3-part ask (play a session · send export receipt · one-sentence pitch —
`BETA_TESTER_TRACKER.md` calls the export receipt and the pitch sentence "the two things that
matter most per tester"). The owner specified only the single "install cold" ask for this round;
as written, this message alone will not collect an export receipt or a pitch sentence. If those are
still wanted, they need adding back — e.g. as a follow-up once a tester's installed, via the
tracker's "📋 paste when a tester goes quiet" template, which already covers exactly that ask.

**Recipients (fill as sends happen — name/handle · date · exact link/artifact received):**

| Recipient | Date sent | Link / artifact |
|---|---|---|
| Matcher | 2026-07-22 | verified 0.9.0 link `1BNuoY-ubKCLTkPUDFdnmFGAUkK4g0J9n` (after the AM wrong-link correction) |
| Chinaman | 2026-07-22 | verified 0.9.0 link — same |
| J | 2026-07-22 | verified 0.9.0 link — same |
| Zoid | 2026-07-22 | verified 0.9.0 link — same |
| Sultan | 2026-07-22 | verified 0.9.0 link — same |
| Majin | 2026-07-22 | verified 0.9.0 link — same |

**Send story (owner-reported + live-verified 2026-07-22):** all six first received the STALE kit
link that morning (the wrong-link incident above; that link died ~08:30 PDT — whether anyone
downloaded before the kill is unknown), then the owner sent each the correction DM containing the
verified 0.9.0 link. Post-send re-verify (~9 AM PDT): the exact sent link re-downloaded
unauthenticated → HTTP 200, `MZ`, 3,826,464 B, SHA-256 `6BC2F7DF…F5A2C4` (exact), and the old link
re-confirmed dead in the same pass. **Install status per tester: unknown until they report** —
`BETA_TESTER_TRACKER.md` is the follow-up surface.

## Release: Compy 0.9.1 — STAGED + VERIFIED, NOT SENT

**Artifact identity (the ONLY file this release may distribute once staging completes):**

- File: `Compy_0.9.1_x64-setup.exe` (NSIS)
- Built from: `395752a` (reconciled 0.9.1 train, merge `149d315` + follow-ups; `RELEASE_STATE.md` row 1/2)
- SHA-256: `7D7650EAC09375E797877FBEA69558565B3F3835A93507B16D7463D44C57E108`
- Size: 3,836,321 bytes
- Verified 2026-07-22 against both the build-output copy and the Desktop copy (`ship-reinstall.ps1`'s install copy) — hash-identical.

**Staging incident — self-caught before any send, not owner-caught:** this session first uploaded
the WRONG 0.9.1 build to Drive — `Compy_0.9.1_x64-setup.exe` sourced from the pre-merge `5d396f9`
lane (presenter-fix only, SHA-256 `81C64BDC5FB4ED7E42E99C4833CD17DD5572F64EA769D4349DBA5F4DBAF0FCB2`,
3,826,285 B, pulled from a stale `release-out/` copy this session hadn't refreshed against the
merge). That file was uploaded, set to "anyone with the link — Viewer", and even
anonymously re-downloaded/hash-verified successfully — before the mistake was caught by
cross-checking `RELEASE_STATE.md` row 1, which records a DIFFERENT installed hash (`7D7650EA…`)
from the reconciled/merged train. The wrong upload is missing the `775c9bb` fail-closed FPS
sticky-attachment fix and CPU thermal-peak tracking that landed in the merge — shipping it as
"0.9.1" would under-ship testers relative to what's already running on the owner's own machine.

**Correction status: RESOLVED 2026-07-22 ~6:05 PM PDT.** The Chrome bridge reconnected; the wrong
file was renamed in place (same fileId `1784qUWc5HtgI-vqyA90IBN8Cf1cZjnzg`, same retire-don't-delete
pattern as the 0.1.0 incident) to `SUPERSEDED-DO-NOT-SEND_Compy_0.9.1_preMerge-presenterFixOnly.exe`
and its sharing set to Restricted — confirmed dead via unauthenticated `curl` (redirects to Google
sign-in, HTTP 303, no file bytes served). The CORRECT file (`7D7650EA…`, verified above) was then
uploaded as a brand-new Drive entity, fileId `1DdMXaYIFe_Cy8t-vsCc-nlHPbBT4DRlo`, sharing set to
"anyone with the link — Viewer", and re-verified by an unauthenticated download through that exact
link (virus-scan-interstitial confirm-token flow, same as the 0.9.0 protocol) — 3,836,321 B,
SHA-256 `7d7650eac09375e797877fbea69558565b3f3835a93507b16d7463d44c57e108`, exact match.

**Link:** https://drive.google.com/file/d/1DdMXaYIFe_Cy8t-vsCc-nlHPbBT4DRlo/view?usp=sharing
(Drive fileId `1DdMXaYIFe_Cy8t-vsCc-nlHPbBT4DRlo`)

**Distributed artifact unchanged — nothing sent to any tester:** the six invitees still hold only
the `37a166c` 0.9.0 NSIS link (above); this section changes nothing about that, and the link above
is not recorded anywhere a tester would find it. A 0.9.1 replacement send is a separate owner
decision, additionally gated per `RELEASE_STATE.md` CURRENT STATE on an **owner-present smoke
pass** before GO — not yet scheduled. Whether to send 0.9.1 at all, versus waiting for 0.9.2 (the
in-progress updater build — see `RELEASE_STATE.md`), is also an open owner decision.

## Prior distribution surfaces (historical)

- **`Compy-Beta-Kit.zip` on Google Drive** (file ID `1dphNbBkoJSbCPOWiUVy-y6iz25t9nMEO`, uploaded
  2026-06-11, 2,762,560 B): **identity corrected 2026-07-22** — earlier text here called this
  generically "the 0.1.0-era kit." Byte-level verification (downloaded the live file via the Drive
  API, unzipped it, hashed the contained exe) proves it is specifically the **`fc940fe` re-cut**:
  contained-exe SHA-256 `5F2549E7EDD6BC94440D3C24ECCC0CB784005DAC520DE2490BB81F3260021F18`,
  internal zip timestamp `2026-06-10 18:17` — both match `CHANGELOG.md:378-391` exactly. (For the
  record: this Drive file slot was reused across two re-cuts before this one too — `17fd64d`/
  `E8D5588B…` then `fc940fe`/`5F2549E7…`, each changelog entry says "supersedes … everywhere incl.
  the kit" — so "the kit" has never been one static artifact, it's a slot that got overwritten in
  place, which is exactly the failure mode this new distribution avoids by using a brand-new file
  each time.)
  **Link-sharing on this file is now REMOVED** (`General access: Restricted`, confirmed both via
  the Drive UI and `get_file_permissions` on 2026-07-22) — the stale build can no longer be
  installed from that link. **Attribution checked, not assumed:** this session's own permissions
  check still showed `anyone:reader` at 7:54:46 PM PDT Jul 21 (matching the owner's "found still
  live"); Drive's own file **Activity log** timestamps the restriction at **7:57 PM PDT Jul 21**,
  attributed to the account itself ("You restricted access") — not flagged as a Google
  automated/abuse action. This session never clicked a revoke control for this file; by the time
  its Share dialog was reopened to do so, it was already Restricted. Given the account-level
  attribution and the ~2-minute timing landing squarely inside this task's own work, most likely
  explanation: the owner made this exact change himself in parallel (e.g. another tab/device)
  while this session was still mid-verification — not a side effect of anything this session did.
  This resolves the "old share-link reachability UNKNOWN" row in `RELEASE_STATE.md` (row 4,
  updated 2026-07-22).
  **INCIDENT UPDATE 2026-07-22 AM — the restriction did NOT hold; re-killed + renamed.** Drive's
  Activity log shows the account toggling this file's sharing through 2026-07-21 evening (7:57 PM
  restrict → **9:16 PM re-share anyone-viewer** → 11:37 PM restrict), and on 2026-07-22 ~8:10 AM
  PDT it measured **OPEN again** — `get_file_permissions` returned `anyone:reader` and an
  unauthenticated download of the direct link served the zip bytes (HTTP 200, 2,762,560 B, `PK`
  header). During this open window the stale kit's link was **sent out as if it were the 0.9.0
  link** (the wrong-build alert the owner relayed; who, if anyone, actually received it =
  owner-confirmable only — see the Recipients table). **Re-restricted 2026-07-22 ~8:30 AM PDT**
  (Cowork, Drive UI), verified three independent ways: `get_file_permissions` → owner-only ·
  unauthenticated fetch → Google access-denied HTML, not the zip · Drive Details → "Private to
  you". The file was also **renamed in place** (same fileId, dead link unchanged) to
  `RETIRED-DO-NOT-SEND_Compy-Beta-Kit_OLD-0.1.0-June.zip` so it can never again be mistaken for
  the current artifact when grabbing a link in a hurry. **Corrected 2026-07-22 PM:** the "11:37 PM restrict" and "11:41 PM rename" Activity entries are
  display-bug mislabels of Cowork's OWN 8:27/8:37 AM actions (proven: the rename demonstrably
  happened 8:37 AM this date yet renders as "11:41 PM Jul 21" — this panel's timestamps cannot be
  trusted for forensics). Real sequence on corroborated evidence only: restricted ~7:57 PM
  (API-confirmed by the prior session) → **re-shared 9:16 PM** (Activity + API `modifiedTime`
  agree) → stayed open all night → killed 8:27 AM. No phantom third re-open; one re-share, origin
  still unattributed (owner-in-parallel or session mis-click). Treat "restricted once" as a
  NON-durable state: the durable guards are this record, the rename, and the mandatory send rule
  above.
- Historical kits handed to other machines: frozen unsigned private beta `16069fa` and the
  `fc940fe` kit above (see `RELEASE_STATE.md` row 3). What those testers currently run remains
  unknown (zero-outbound: no telemetry).
