# Compy — Privacy Policy

**Status: DRAFT v0.2 (2026-06-13).** Reflects how the software AND the website behave today — v0.2
adds the website/waitlist data section (email + a hashed IP) now that the launch waitlist is live.
It is **not legal advice** — the owner should still have it reviewed by a qualified professional
before public distribution. Owner/contact identity: Pootytxng (GitHub issues).

> **Doctrine pointer (2026-06-12):** the absolutes below describe the software as it ships TODAY (still true); per `docs/RECEIPTS_DOCTRINE.md`, a future opt-in default-OFF Receipts telemetry phase is planned — this policy must be revised before that ships.

---

## The short version

**The Compy app runs entirely on your PC.** It does not collect, transmit, sell, or share any of
your data — no accounts, no telemetry, no analytics, no advertising, and no network connections to
operate. **The only data we ever collect is on our website:** if you join the launch waitlist, we
store your email (to send one launch message) and a hashed version of your IP (for spam prevention)
— nothing else, and no third-party trackers. Details below.

## What Compy reads

To give hardware-aware, per-rig recommendations, Compy reads information **locally on your
machine**, including:

- Hardware inventory (CPU, GPU, RAM, disks, displays) via standard Windows APIs and vendor
  libraries (AMD ADLX / NVIDIA NVML).
- Current Windows configuration relevant to its recommendations (e.g. power plan, certain
  services, registry values it knows how to read).
- Live performance sensors while you have monitoring open (GPU/CPU usage, temperatures where
  available, RAM, and FPS/frametime for a running game).

This information is **displayed to you and used only on your device**. It is never sent
anywhere.

## What Compy stores (locally)

- **Change history / "Trust Ledger":** a local audit log of changes you chose to apply, so
  they can be rolled back. Stored at `%APPDATA%\Compy\history.json`. It records what was
  changed, the prior value (so it can be restored), and a timestamp. It stays on your device.
- **FPS monitoring working files:** temporary data under `%LOCALAPPDATA%\Compy\`
  (`fps.json`, `fps.alive`) used to pass live capture data between Compy and its local
  capture helper. Local only.
- **A first-run flag** in the app's local storage so it doesn't replay the intro every launch.

You can delete any of these files; Compy will recreate what it needs.

## What Compy does NOT do

- No telemetry, usage analytics, crash reporting, or "phone home."
- No account, login, or cloud sync.
- No advertising or tracking identifiers.
- No selling or sharing of data with third parties.
- No background data collection.

## Network use

Compy makes **no network requests** to function. The only outbound action is that some
advisory recommendations may **open a link in your default web browser** (for example, a GPU
driver download page). Once a link opens, your browser — not Compy — handles it, under your
browser's own privacy terms.

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

This website data collection does **not** change anything about the app: the installed Compy app
still makes no network connections and sends nothing off your PC.

## Future: signed rule updates (currently disabled)

Compy contains the groundwork for downloading **cryptographically signed** recommendation
rule files in the future. This capability is **disabled** in the current build and performs no
network activity. If it is ever enabled, it would only **download** signed rule files to keep
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
open an issue on the project's GitHub issues page — https://github.com/Pootytxng/compy/issues — or
reply directly to the launch email you receive from the waitlist.
Project: https://github.com/Pootytxng/compy

This policy, and any dispute relating to it, is governed by the laws of the **United States** and the
owner's state of residence (see the EULA's governing-law clause for the specific venue).
