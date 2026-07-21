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

**Protocol checklist (2026-07-21 GO):**

| Step | Status |
|---|---|
| SHA-256 recalculated pre-upload, matches | ✅ 2026-07-21 (`6BC2F7DF…F5A2C4`, 3,826,464 B) |
| Uploaded to private tester location (Google Drive) | ⏳ pending owner drag-drop (no Drive-upload CLI on this machine; MCP can't carry a binary) |
| Link sharing set to "anyone with the link — Viewer" | ⏳ with the upload |
| Download tested from a second browser (unauthenticated fetch) | ⏳ after upload |
| Downloaded copy SHA-256 matches | ⏳ after upload |
| Testers told: unsigned invite-only beta, SmartScreen expected | ✅ baked into `beta-kit/invite-message-0.9.0.txt` |

**Link:** _pending upload_

**Invite text:** `beta-kit/invite-message-0.9.0.txt` (0.9.0 update of the owner-approved June wording;
single exe, no zip).

**Recipients (fill as sends happen — name/handle · date · exact link/artifact received):**

| Recipient | Date sent | Link / artifact |
|---|---|---|
| _none yet_ | | |

## Prior distribution surfaces (historical)

- **`Compy-Beta-Kit.zip` on Google Drive** (file ID `1dphNbBkoJSbCPOWiUVy-y6iz25t9nMEO`, uploaded
  2026-06-11, 2,762,560 B — the 0.1.0-era kit): confirmed 2026-07-21 still shared
  **anyone-with-link** and the direct-download URL still resolves (HTTP 200) — the old link is
  LIVE and serves a stale build. **Recommended: remove link-sharing on this file once the 0.9.0
  link is out** (owner's click in Drive; no permission-editing tool exists in this lane). This
  resolves the "old share-link reachability UNKNOWN" row in `RELEASE_STATE.md`.
- Historical kits handed to other machines: frozen unsigned private beta `16069fa` and a later kit
  cut from `fc940fe` (see `RELEASE_STATE.md` row 3). What those testers currently run remains
  unknown (zero-outbound: no telemetry).
