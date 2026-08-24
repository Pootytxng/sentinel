# Compy — Privacy Policy

**Status: DRAFT v0.5 (2026-08-24).** v0.5 adds four things the software already did but this policy
did not describe — the **local session history** (including the game executable name), the
**application-start notes** taken during capture, the **rig fingerprint**, and the **licence file**
— and names the second GitHub host the update check redirects to. Nothing about the software
changed; the policy was stricter than the build, and this closes that gap in the honest direction.
Reflects how the software AND the website behave today, with one
stated exception: v0.4 added the **local support record**, which is written and tested in the source
but is not yet in a released installer — it is disclosed here ahead of shipping rather than after,
so no build can ever collect something this policy has not already described. (v0.3 disclosed the
signed, consent-first app updater that went live on 2026-07-22, and the Settings switch that turns
its automatic checks off.) It is **not legal advice** — the owner should still have it reviewed by a
qualified professional before public distribution. Owner/contact identity: Pootytxng (GitHub issues).

> **Doctrine pointer (updated 2026-08-09):** This policy describes current runtime behavior.
> Receipts remains disabled and no send path exists. Tier 1 signed case intelligence is approved as
> a dark design but has no module, endpoint or traffic today. Before any Capability Exception Gate outbound tier is armed, this policy
> and generated site copy must be updated in the SAME release with its exact endpoint, payload,
> consent, retention/deletion and off-switch behavior; Tier 1 cannot authorize Tier 2 or 3.
> `src/outbound-claim-guard.test.ts` enforces the current outbound claims.

---

## The short version

**Compy's analysis and saved history stay on your PC.** It does not collect, transmit, sell, or
share any of your data — no accounts, no telemetry, no analytics, no advertising, and no upload of
your hardware, sessions, or results. Its one automatic network use is a **signed update check**,
which carries none of your data and which you can switch off in Settings; an installer downloads
only after you approve it. **The only personal data we ever collect is on our website:** if you join
the launch waitlist, we store your email (to send one launch message) and a hashed version of your
IP (for spam prevention) — nothing else, and no third-party trackers. Details below.

## What Compy reads

To give hardware-aware, per-rig recommendations, Compy reads information **locally on your
machine**, including:

- Hardware inventory (CPU, GPU, RAM, disks, displays) via standard Windows APIs and vendor
  libraries (AMD ADLX / NVIDIA NVML).
- Current Windows configuration relevant to its recommendations (e.g. power plan, certain
  services, registry values it knows how to read).
- Live performance sensors while you have monitoring open (GPU/CPU usage, temperatures where
  available, RAM, and FPS/frametime for a running game).
- **Which applications start, while — and only while — a capture session is running.** Once per
  second Compy compares the list of running process names against the previous second, so that a
  stutter can be explained by "something else just launched" instead of left a mystery. Only the
  *newly started* names are noted, as a line reading `<name> starting`; routine Windows background
  processes are skipped, and a large burst of launches (a login or a boot) is ignored rather than
  blamed on one app. Compy does not read what those applications are doing, only that they started.
  The notes are kept in the local session record described below and are not uploaded.

This information is **displayed to you and used only on your device**. Compy does not include it
in the update request, and does not upload it anywhere.

## What Compy stores (locally)

- **Change history / "Trust Ledger":** a local audit log of changes you chose to apply, so
  they can be rolled back. Stored at `%APPDATA%\Compy\history.json`. It records what was
  changed, the prior value (so it can be restored), and a timestamp. It stays on your device.
- **Session history:** when a monitoring session ends, Compy writes a summary of it to
  `%APPDATA%\Compy\sessions.json`, keeping up to the 100 most recent. Each entry records **the
  executable name of the game or app that was presenting frames** (for example `game.exe`), the
  start time and duration, the FPS / frametime / 1%-low figures, peak GPU temperature and usage,
  peak RAM, whether Gaming Mode was on, and the rig fingerprint described below. For the most
  recent sessions it also keeps the per-second stutter timeline and the events behind it —
  including the application-start notes described above; older sessions shed those when the file is
  saved. This is a record of what you played and when, and Compy keeps it so it can compare a bad
  session against a good one. It stays on your device: there is no path in the software that sends
  it, and deleting the file simply starts a new empty history.
- **Rig fingerprint (`hw_fingerprint`):** a short label stamped onto Trust Ledger entries and
  session summaries so Compy can tell "this rig" from "a rig you used to have" — which is what lets
  it say *"applied before your hardware changed"* instead of guessing. **It is deliberately not a
  machine ID.** It is the first 8 bytes of a SHA-256 of exactly four spec strings — GPU model, GPU
  driver version, whole gigabytes of RAM, and display resolution/refresh rate — and nothing else:
  no serial number, no MAC address, no Windows installation ID, no disk ID, no username. Thousands
  of identical rigs produce the identical value, which is the point — it groups by hardware class
  and cannot single you out. It stays on your disk.
- **Licence file (only if you buy Compy Pro):** a purchased licence is saved as
  `%APPDATA%\Compy\license.key`. The signed token inside it carries a **one-way hash of the email
  address you purchased with** — not the address itself — along with the tier name and the issue
  and expiry dates. Compy reads it locally to decide whether Pro features are unlocked; nothing
  sends it back out.
- **FPS monitoring working files:** temporary data under `%APPDATA%\Compy\runtime\`
  (`fps.json`, `fps.alive`) used to pass live capture data between Compy and its local
  capture helper. Local only.
- **A first-run flag** in the app's local storage so it doesn't replay the intro every launch.
- **Support record:** a short rolling log of what Compy itself did — app starts, reads and writes of
  the Trust Ledger, the FPS capture helper starting and stopping, and whether each apply or rollback
  succeeded, failed, or was declined at the Windows admin prompt. Stored at
  `%APPDATA%\Compy\support\evidence.jsonl`, capped at 400 entries (about 250 KB); older entries drop
  off as new ones arrive. It is **redacted as it is written and again when you export it** —
  usernames, your computer name, file paths, IP addresses, license keys and hardware serials are
  replaced with `<user>`, `<host>`, `<path>`, `<ip>`, `<key>`, `<serial>`. It records outcomes, not
  content: no file contents, no keystrokes, no browsing, no game data.

**Nothing sends the support record.** Compy has no way to upload it. You can read it in the app,
export it to a file under `%APPDATA%\Compy\exports\`, and attach that file to a support conversation
yourself — you are the transport, and you can read exactly what you are sending before you send it.

The FPS working files and the first-run flag are safe to delete — Compy just recreates them as needed. Deleting `history.json` is different: it erases your Trust Ledger, so past changes stop being reversible from it. Compy will start a fresh, empty ledger, not restore the old one. The support record can be cleared or deleted at any time and Compy simply starts a new empty one; the only consequence is that if you later ask for help with something that already went wrong, there is no record of it left to show — so clear it *after* a support conversation, not before.

## What Compy does NOT do

- No telemetry, usage analytics, or crash reporting. (Two clarifications, so this can't be
  misread: Compy does ask GitHub whether a newer signed version exists — see **Network use**
  below — but that request carries nothing about you or your PC, and you can switch it off. And
  Compy does keep the **local support record** described above — that is a file on your disk that
  only you can read or send, not reporting, because nothing transmits it.)
- No account, login, or cloud sync.
- No advertising or tracking identifiers.
- No selling or sharing of data with third parties.
- No background data collection.

## Network use

Compy makes **one kind of automatic network request: a signed update check.**

- **What it asks.** Whether a newer signed version of Compy exists, by fetching a fixed release
  manifest from GitHub:
  `https://github.com/Pootytxng/compy-releases/releases/latest/download/latest.json`. That URL is a
  redirect, so the check touches **two GitHub-operated hosts**, not one: `github.com`, which answers
  with the redirect, and `objects.githubusercontent.com`, GitHub's release-asset host, which serves
  the manifest file itself. Both are GitHub; no other host is contacted.
- **When.** Once when the app starts, and about every four hours while it stays open.
- **What it sends about you.** Nothing. The request carries no hardware inventory, no sessions, no
  Trust Ledger, no settings, no identifier, and no account — there is no account. As with any
  ordinary web request, GitHub does see connection metadata such as your IP address, under
  GitHub's own privacy terms.
- **Nothing is downloaded automatically.** If a newer version exists, Compy shows you the version
  and its notes. The installer downloads only after you choose **Update now**, and it must pass
  cryptographic signature verification against the public key built into Compy before it installs.
- **You can turn it off.** *Settings → About → Automatic update checks.* With it off, Compy makes
  no network request at all on its own; **Check now** in the same row runs a single check when you
  ask for one. Turning checks off never weakens signature verification.

Separately, some advisory recommendations may **open a link in your default web browser** (for
example, a GPU driver download page) — but only when you click the link. Once a link opens, your
browser, not Compy, handles it under your browser's own privacy terms.

> **About "telemetry" recommendations:** Some of Compy's optional recommendations help you
> *disable* Windows or NVIDIA telemetry services. That is a privacy feature that reduces what
> *other* software collects about you. It is unrelated to Compy's own data practices —
> Compy itself collects nothing.

## The Compy website & waitlist (separate from the app)

Everything above describes the **app**. The Compy **website** (the Pages site / future compy.gg) is
separate, and one part of it collects data — **only if you choose to give it:**

- **Waitlist email.** If you submit your email to the launch waitlist, we store that email address
  for one purpose: to send you a single message when the public beta opens. We do **not** sell it,
  share it with third parties, add you to other lists, or use it to track you.
- **Hashed IP (spam prevention).** When you submit the form, your IP address is converted to a
  one-way cryptographic hash (SHA-256 with a secret value) **before** it is stored — the raw IP
  address is never written to our records. The hash lets us limit spam without keeping your actual IP.
- **Where it's stored.** In a database (Cloudflare D1) on the site's hosting backend. The website
  itself loads **no third-party trackers, analytics, advertising scripts, or social pixels** — the
  page is built to make zero third-party requests.
- **Retention & deletion.** We keep your email until the launch message is sent (or until you ask us
  to remove it), then delete it. To have your email removed at any time, contact us (below).

This website data collection is separate from the app. The installed Compy app does not send the
website — or anyone else — your hardware, session history, Trust Ledger, or settings. Its only
automatic connection is the signed update check described above.

## Future: signed rule updates (currently disabled)

Compy contains the groundwork for downloading **cryptographically signed** recommendation
rule files in the future. This capability is **disabled** in the current build and performs no
network activity of its own — it is separate from the update check described above. If it is ever
enabled, it would only **download** signed rule files to keep
recommendations current — it would **never upload** information about you or your PC. Any such
change will be reflected in an updated version of this policy before it ships.

## Administrator access

Some actions (and the FPS capture helper) require Windows Administrator permission and will
prompt you (UAC). Compy uses these rights only to read state and to apply/undo the specific
change you requested. It installs no kernel driver and injects nothing into your games.

## Children's privacy

Compy is a PC utility, not directed at children, and collects no personal information from
anyone.

## Changes to this policy

If Compy's data behavior ever changes, this policy will be updated and dated, and shipped
with the corresponding version.

## Contact & governing law

**Pootytxng** (Compy). Privacy questions, concerns, or a request to delete your waitlist email:
reply directly to any email you receive from the waitlist — replies reach the owner.

This policy, and any dispute relating to it, is governed by the laws of the **United States** and the
owner's state of residence (see the EULA's governing-law clause for the specific venue).
