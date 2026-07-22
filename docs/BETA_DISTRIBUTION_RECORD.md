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
| ⚠️ UNKNOWN — owner to confirm who (if anyone) received the WRONG link on 2026-07-22 AM | 2026-07-22 (before ~08:00 PDT) | OLD stale-kit link (now dead, file renamed) — each recipient is owed the correction + the verified 0.9.0 link above |

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
  the current artifact when grabbing a link in a hurry. Why it re-opened between 11:37 PM and
  morning is **unresolved** (no further event visible in the Activity panel as rendered;
  owner-confirmable in Drive Activity) — treat "restricted once" as a NON-durable state: the
  durable guards are this record, the rename, and the mandatory send rule above.
- Historical kits handed to other machines: frozen unsigned private beta `16069fa` and the
  `fc940fe` kit above (see `RELEASE_STATE.md` row 3). What those testers currently run remains
  unknown (zero-outbound: no telemetry).
