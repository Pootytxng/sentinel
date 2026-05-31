# Sentinel — Privacy Policy

**Status: DRAFT v0.1 (2026-05-31).** This is a starting-point draft that reflects how the
software currently behaves. It is **not legal advice** — the owner should review/adapt it
(and have it reviewed) before publishing. Owner/contact identity is set (Pootytxng; GitHub
issues); no other placeholders remain.

---

## The short version

**Sentinel runs entirely on your PC. It does not collect, transmit, sell, or share any of
your data. There are no accounts, no telemetry, no analytics, and no advertising. Sentinel
makes no network connections to operate.**

## What Sentinel reads

To give hardware-aware, per-rig recommendations, Sentinel reads information **locally on your
machine**, including:

- Hardware inventory (CPU, GPU, RAM, disks, displays) via standard Windows APIs and vendor
  libraries (AMD ADLX / NVIDIA NVML).
- Current Windows configuration relevant to its recommendations (e.g. power plan, certain
  services, registry values it knows how to read).
- Live performance sensors while you have monitoring open (GPU/CPU usage, temperatures where
  available, RAM, and FPS/frametime for a running game).

This information is **displayed to you and used only on your device**. It is never sent
anywhere.

## What Sentinel stores (locally)

- **Change history / "Trust Ledger":** a local audit log of changes you chose to apply, so
  they can be rolled back. Stored at `%APPDATA%\Sentinel\history.json`. It records what was
  changed, the prior value (so it can be restored), and a timestamp. It stays on your device.
- **FPS monitoring working files:** temporary data under `%LOCALAPPDATA%\Sentinel\`
  (`fps.json`, `fps.alive`) used to pass live capture data between Sentinel and its local
  capture helper. Local only.
- **A first-run flag** in the app's local storage so it doesn't replay the intro every launch.

You can delete any of these files; Sentinel will recreate what it needs.

## What Sentinel does NOT do

- No telemetry, usage analytics, crash reporting, or "phone home."
- No account, login, or cloud sync.
- No advertising or tracking identifiers.
- No selling or sharing of data with third parties.
- No background data collection.

## Network use

Sentinel makes **no network requests** to function. The only outbound action is that some
advisory recommendations may **open a link in your default web browser** (for example, a GPU
driver download page). Once a link opens, your browser — not Sentinel — handles it, under your
browser's own privacy terms.

> **About "telemetry" recommendations:** Some of Sentinel's optional recommendations help you
> *disable* Windows or NVIDIA telemetry services. That is a privacy feature that reduces what
> *other* software collects about you. It is unrelated to Sentinel's own data practices —
> Sentinel itself collects nothing.

## Future: signed rule updates (currently disabled)

Sentinel contains the groundwork for downloading **cryptographically signed** recommendation
rule files in the future. This capability is **disabled** in the current build and performs no
network activity. If it is ever enabled, it would only **download** signed rule files to keep
recommendations current — it would **never upload** information about you or your PC. Any such
change will be reflected in an updated version of this policy before it ships.

## Administrator access

Some actions (and the FPS capture helper) require Windows Administrator permission and will
prompt you (UAC). Sentinel uses these rights only to read state and to apply/undo the specific
change you requested. It installs no kernel driver and injects nothing into your games.

## Children's privacy

Sentinel is a PC utility, not directed at children, and collects no personal information from
anyone.

## Changes to this policy

If Sentinel's data behavior ever changes, this policy will be updated and dated, and shipped
with the corresponding version.

## Contact

**Pootytxng** (Sentinel). Privacy questions or concerns: please open an issue on the
project's GitHub issues page — https://github.com/Pootytxng/sentinel/issues
Project: https://github.com/Pootytxng/sentinel
