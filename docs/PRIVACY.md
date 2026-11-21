# Compy — Privacy Policy

**Status: DRAFT v0.7 (2026-11-21).** v0.7 is a correction pass: every sentence was checked against the
code on `main`. It adds the stored files, the process-handling facts and the exact list of what can
leave your PC that earlier versions did not give in full, and it removes sentences the code does not
support. **Results sharing ("Receipts")**, signed advisory downloads and signed rule updates
have code in the source but are **switched off in code**, so no build sends anything through them; they
are described here so they can never arrive unannounced. It is **not legal advice** — the owner should
still have it reviewed by a qualified professional before public distribution. Owner/contact identity:
Pootytxng — GitHub issues, or compysupport@gmail.com.

> **Doctrine pointer (updated 2026-08-25):** This policy describes current runtime behavior.
> Receipts is **built but disabled**: the send path exists in source as of 2026-08-25, and its gate
> is fixed to *off* in code, so a shipped build has no way to reach the network through it. Arming
> that gate is a separate, owner-signed change that cannot land without this policy already
> describing it — which, as of v0.6, it does. Even armed, sharing stays **opt-in and off by default**
> (owner ruling 2026-08-24, issue #207). Tier 1 signed case intelligence is **built but
> unreachable**: as of 2026-08-25 its module exists in source behind three independent locks —
> a gate fixed to *off*, an all-zero trust key, and an empty endpoint list — so it has
> no endpoint, no key and no traffic today. Before any Capability Exception Gate outbound tier
> is armed, this policy
> and generated site copy must be updated in the SAME release with its exact endpoint, payload,
> consent, retention/deletion and off-switch behavior; Tier 1 cannot authorize Tier 2 or 3.
> `src/outbound-claim-guard.test.ts` enforces the current outbound claims.

---

## The short version

**Compy's analysis and saved history stay on your PC.** It does not send, sell, or
share your data — no accounts, no telemetry, no analytics, no advertising, and no upload of
your hardware, sessions, or results. Its one automatic network use is an **update check to
GitHub**, which carries none of your data, is on by default and can be switched off in Settings; an
installer downloads only after you approve it, and is installed only if its signature matches the key
built into Compy. A second path — **results sharing** — is written into
the software but switched off in code, sends nothing in any build you can install, and would stay off
for you until you switched it on; it is described in full below so it can never arrive unannounced.
**The only personal data we collect is on our website and in emails you choose to send us:** if you join
the launch waitlist, we store your email (to send one launch message), the time you joined and a hashed
version of your IP (for spam prevention) — nothing else, and no third-party trackers. Details below.

## What Compy reads

To give hardware-aware, per-rig recommendations, Compy reads information **locally on your
machine**, including:

- Hardware inventory (CPU, GPU, RAM, disks, displays) via standard Windows APIs and vendor
  libraries (AMD ADLX / NVIDIA NVML).
- Current Windows configuration relevant to its recommendations (e.g. power plan, certain
  services, registry values it knows how to read).
- Live performance sensors while you have monitoring open (GPU/CPU usage, temperatures where
  available, RAM, and FPS/frametime for a running game). Compy does not read CPU temperature itself:
  if you run HWiNFO, LibreHardwareMonitor or OpenHardwareMonitor, it displays the value that tool
  publishes. Compy installs no driver for this; any driver in that picture belongs to the tool you chose
  to install.
- **Windows' own records about this PC.** Each time Compy starts (and at most every five minutes after that), it
  reads Windows' crash and reliability records (Windows Error Reporting files, the Reliability history, the event
  log and the list of crash dump files) to notice crashes and freezes, including of other programs. To answer
  "what changed on this PC", it reads the dates of driver and Windows updates from the event log, the list of
  installed programs with their install dates, and the files Steam keeps about when a game last updated. It also
  reads your startup entries and network adapters. These are read on your PC. Crash notes keep the program's name
  (never its path), the kind of crash, its time and a one-line headline; the "what changed" readings are shown on
  screen and are not saved by Compy.
- **Which applications start, while — and only while — a capture session is running.** Once per
  second Compy compares the list of running process names against the previous second, so that a
  stutter can be explained by "something else just launched" instead of left a mystery. Only the
  *newly started* names are noted, as a line reading `<name> starting`; routine Windows background
  processes are skipped, and a large burst of launches (a login or a boot) is ignored rather than
  blamed on one app. Only the program's file name is taken: Compy does not read what those applications
  are doing. The notes are kept in the local session record described below and are not uploaded.
- **Which known programs were already running when a session began.** At the start of a session Compy
  checks the running names against a reviewed list of known programs (recorders, overlays, launchers,
  browsers, chat and meeting apps, a torrent client, developer tools and similar) and keeps, in the local
  session record, the list's own ids and categories for the ones it found plus a count of all running
  programs. A program that is not on the list is counted and never named. These fields are left out of
  the exported report described below.
- **What is running right now, in the first look.** The first look names the programs from that same
  reviewed list that are running at that moment, and only on your screen: that listing is not stored, not
  exported and not sent.

**How Compy looks at programs.** Compy's own code does not open other programs. The list of running programs, and
the check whether your game is still running, come from one Windows process snapshot (the list Task Manager also
shows: names, ids and start times), which is read without opening any program. Compy reads no program's memory and
holds no handle to your game. Frame timing comes from Windows' event tracing (ETW): while the frame-rate graph runs,
Compy's capture helper (a second copy of Compy that Windows starts with administrator rights after you approve the
prompt) receives Windows' frame events from every program that draws through DirectX, which can include a browser
or chat app as well as your game. It uses them to find the program drawing the most frames and keeps only that
program's name and id. The only processes Compy holds handles to are ones it starts itself: that helper and the
Windows tools it runs, such as PowerShell, powercfg, netsh and wevtutil. A test fails the build if Compy's own
source code gains a call that opens another process; that test checks Compy's code, not the third-party libraries
or Windows components Compy uses.

This information is **displayed to you and used only on your device**. Compy does not include it
in the update request, and does not upload it anywhere.

## What Compy stores (locally)

Everything below stays on your PC. The complete list of what the code writes is kept in
`src-tauri/src/data_inventory.rs`, and a test fails when a new file is added without a row there.

- **Change history / "Trust Ledger":** a local audit log of changes you chose to apply, so
  they can be rolled back. Stored at `%APPDATA%\Compy\history.json`. It records what was
  changed, the prior value (so it can be restored), and a timestamp. Compy keeps one backup copy beside
  it (`history.json.bak`), made when Compy starts if none exists and refreshed each time the ledger is
  saved, plus short-lived working files and, if a file cannot be read, a damaged copy — all named
  `history.json...`.
- **Session history:** when a monitoring session ends, Compy writes a summary of it to
  `%APPDATA%\Compy\sessions.json`, keeping up to the 100 most recent. Each entry records **the
  executable name of the game or app that was presenting frames** (for example `game.exe`), the
  start time and duration, the FPS / frametime / 1%-low figures, peak GPU temperature and usage,
  peak RAM, whether Gaming Mode was on, the known-program fields described above, and the rig
  fingerprint described below. For the most
  recent sessions it also keeps the per-second stutter timeline and the events behind it —
  including the application-start notes described above; older sessions shed those when the file is
  saved. This is a record of what you played and when, and Compy keeps it so it can compare a bad
  session against a good one. It stays on your device: there is no path in the software that sends
  it (apart from the switched-off results sharing below), and deleting the file simply starts a new empty history. A `sessions.json` Compy cannot read is
  kept as `sessions.json.corrupt` rather than deleted.
- **Trials, benchmarks and comparisons:** `experiments.json` (each Trial: which game, the measured
  before and after figures, a link to the ledger entry), `benchmark.json`, `scoreboard.json`,
  `noise_floors.json` (how much a game's results vary on this PC) and `compy_comparison.json` /
  `compy_comparison_result.json` (a before/after comparison and its result). They name the games you
  tested and describe this PC's hardware.
- **Hardware and driver history:** `hardware-fingerprint.json` (the GPU models and RAM size Compy last
  saw, so it can say "your hardware changed") and `intelligence.json` (a timeline of driver versions,
  Windows build and power plan).
- **Drift and crash notes:** `drift.json` (which checks were last good and when a change was noticed;
  it also keeps the last value a setting was seen with, which can include a power plan name you typed)
  and `care\incident-observer.json` (crashes and freezes Compy noticed in Windows' own records,
  including the name of the application involved).
- **Choices you made:** `readiness_dismissals.json` (readiness items you dismissed) and
  `receipts-consent.json` (your answer about sharing results; a missing file means off).
- **Gaming Mode file:** `gaming-session.json` exists only while Gaming Mode is on, or if it was left
  unfinished; it lists the temporary changes made and how to restore each one.
- **Saved reports:** every report you export is a file in `%APPDATA%\Compy\exports\`. Compy does not
  delete or shorten that folder; reports stay until you delete them.
- **Rig fingerprint (`hw_fingerprint`):** a short label stamped onto Trust Ledger entries and
  session summaries so Compy can tell "this rig" from "a rig you used to have" — which is what lets
  it say *"applied before your hardware changed"* instead of guessing. **It is deliberately not a
  machine ID.** It is the first 8 bytes of a SHA-256 of exactly four spec strings — GPU model, GPU
  driver version, whole gigabytes of RAM, and display resolution/refresh rate — and nothing else:
  no serial number, no MAC address, no Windows installation ID, no disk ID, no username. It is the
  same for every PC with the same four values; an unusual combination can be rare. It stays on your disk.
- **Licence file (only if a licence key is entered):** a licence is saved as
  `%APPDATA%\Compy\license.key`. Licensing is switched off in current builds and the app hides key entry, so
  none is written today; if one were entered, the file would hold exactly the text entered, saved before it is
  checked. The signed token inside it carries a **one-way hash of the email address you purchased
  with** — not the address itself — along with the tier name and the issue and expiry dates. Compy
  reads it locally to decide whether Pro features are unlocked; nothing sends it back out.
- **FPS monitoring working files:** temporary data under `%APPDATA%\Compy\runtime\`
  (`fps.json`, `fps.alive`) used to pass live capture data between Compy and its local
  capture helper. `fps.json` contains the name and id of the game process being measured. Local only.
- **Temporary and leftover files:** while Compy works it writes short-lived files in
  `%APPDATA%\Compy\` (`.tmp` copies beside a file being replaced, the elevated helper's result files and
  one-time launch tickets). They are normally deleted when the operation ends; a crash can leave one
  behind. While the disk benchmark runs it writes and deletes a test-data file in the Windows temp folder.
- **The app window's own storage.** The window is Microsoft Edge WebView2, which keeps this window's
  storage under `%LOCALAPPDATA%\gg.compy.app\`. Compy keeps small entries there: your appearance and
  feature choices, the language, which intro and tour screens you have seen, recommendations you
  dismissed, which crash reports you marked helpful, which care steps were shown and where you stopped a guided
  journey (these name the game or program involved), saved GPU settings snapshots and your monitor's refresh rate.
  **It also holds text you type:** an unsent feedback note (kept until
  you empty the box; Compy has no way to send it on its own), parts you add to the rig model by hand and,
  for the current window session only, text you paste into the Learn autopsy. Compy does not send any
  of it. WebView2 also keeps its own browser cache there.
- **Window size and position:** saved by the window-state component in
  `%APPDATA%\gg.compy.app\.window-state.json`.
- **An older Compy folder:** a PC that ran Compy before its rename may still have `%APPDATA%\Sentinel`.
  Whenever Compy starts and finds no Compy folder but finds this one, it copies it into a new Compy folder (and
  never changes or deletes it); that copy brings back the old Trust Ledger as it was.  Delete it yourself if you do not want the old data.
- **Developer builds only:** a debug build writes `launch-debug.log` (the command-line arguments of each
  launch, which can include file paths containing your Windows user name) into a `Compy` folder directly under
  `%LOCALAPPDATA%` (the per-user install folder, not the data folder above). Release builds do not.
- **Support record:** a short rolling log of what Compy itself did — app starts, reads and writes of
  the Trust Ledger, the FPS capture helper starting and stopping, and whether each apply or rollback
  succeeded, failed, or was declined at the Windows admin prompt. Stored at
  `%APPDATA%\Compy\support\evidence.jsonl`, capped at 400 entries (about 250 KB); older entries drop
  off as new ones arrive. It is **redacted as it is written and again when you export it** —
  usernames, your computer name, file paths, IP addresses, license keys and hardware serials are
  replaced with `<user>`, `<host>`, `<path>`, `<ip>`, `<key>`, `<serial>`. It records outcomes, not
  content: no file contents, no keystrokes, no browsing. A detail line is free text written by Compy's code and can
  mention a program's name; paths and names are masked as above.

**Nothing sends the support record.** Compy has no way to upload it. You can read it in the app,
export it to a file under `%APPDATA%\Compy\exports\`, and attach that file to a support conversation
yourself — you are the transport, and you can read exactly what you are sending before you send it.

**The diagnostic report ("Export Snapshot", Settings, Feedback & help)** is built on your PC and saved
as a Markdown file and a JSON file under `%APPDATA%\Compy\exports\`. Compy never sends it; you choose
whether to share it, and you can read it first. It is a detailed record and is meant to be: it holds your
hardware and driver names, your network adapters (an adapter's name can name a VPN you use), the
changes Compy made, and, for each recorded session, the game's program name, when you played and how it
ran. Before the report is written, Compy changes these things in the copy it exports:

- Programs that started during a game session, and startup entries you changed through Compy, are named
  only when they are on Compy's reviewed list of known programs (recorders, overlays, launchers, browsers,
  chat and meeting apps, a torrent client, developer tools, Windows Update). Any other program is shown as "other
  program 1", "other program 2" and so on, the same program keeping its number within one report, with
  counts and timing kept.
- Your Windows user name and your computer name are replaced with `<user>` and `<host>` (as whole
  words; a name shorter than three letters, or one of 28 common words Compy will not replace in text (for example
  Admin, User, Owner, Max, Gamer), is left alone except in file paths, so such a name can still appear in text that is not a path). In any path under
  `C:\Users\<name>` the name is always replaced. QoS policy
  names are replaced by a numbered label. A power plan with a name you or your PC maker chose is shown
  as "a custom power plan" (Windows' own plans, and copies of them such as the Ultimate Performance
  plan Compy creates, keep their names), and the ids of custom power plans and network interfaces are
  replaced by numbered labels.
- The list of known programs that were already running when a game started, the computer-name field and
  any game-state field a newer Compy adds without being reviewed are left out.

What stays: the game's program name, hardware and network adapter names, the stock Windows power plan
names, the hardware fingerprint (a short code made from the hardware names that are already in the
report), and anything you type into the note box, exactly as you wrote it. The last lines of the Markdown,
and a `redaction` section in the JSON, say how many names, ids and paths were changed. Nothing changes in
what Compy records on your PC or shows you in the app; only the exported copy is altered. Read a report
before you post it in public: it is made to help someone diagnose your PC, not to be anonymous.

The **Email it to me** button in the same place opens a draft in your own mail program, addressed to
compysupport@gmail.com, holding your note and a short snapshot summary. Compy does not send it: nothing
leaves until you press send in your mail program, and you can edit or delete the draft first. If you send it,
the message, your email address and the summary reach the owner's Gmail inbox (hosted by Google) and stay there
until deleted.

**Deleting files by hand.** The FPS working files, the temporary files, the saved reports, the support
record and the damaged `.corrupt` copies of the stores other than the ledger are not needed to keep
Compy working; delete them while Compy is closed and it recreates what it needs. Deleting a store such as
`sessions.json` simply starts a new empty history. Deleting `history.json` is different: it erases your
Trust Ledger, so past changes stop being reversible from it. Compy also keeps one backup copy of the
ledger beside it, `history.json.bak`, and if `history.json` is missing or damaged it restores the ledger
from that copy (leaving a small `history.json.restored` note that it did), so deleting only
`history.json` brings the old ledger back. To erase your change history for good, undo the changes you
want undone first, close Compy, and delete every file in that folder whose name starts with `history.json`
(the ledger, its `.bak` backup copy, and any `.restored`, `.tmp` or `.corrupt` files); Compy then starts a
fresh, empty ledger. The support record can be cleared or deleted at any time and Compy simply starts a
new empty one; the only consequence is that if you later ask for help with something that already went
wrong, there is no record of it left to show — so clear it *after* a support conversation, not before.

Compy has no "delete my data" button yet. To remove its data by hand, close Compy and delete the files
above. Deleting the whole `%APPDATA%\Compy` folder removes what Compy stored there, with one catch: if
an older `%APPDATA%\Sentinel` folder exists, Compy copies it back in at its next start, so delete that
folder as well. The window's storage under `%LOCALAPPDATA%\gg.compy.app\` and the window-state file are
outside that folder. Uninstalling Compy does not undo changes it made to Windows, and this policy does
not say what the uninstaller does with the data folder, because that has not been tested.

## What Compy does NOT do

- No telemetry, usage analytics, or crash reporting. (Three clarifications, so this can't be
  misread: Compy does ask GitHub whether a newer version exists — see **Network use**
  below — but that request carries nothing about you or your PC, and you can switch it off. And
  Compy does keep the **local support record** described above — that is a file on your disk that
  only you can read or send, not reporting, because nothing transmits it. Third: the **anonymous
  results sharing** path described under **Network use** is present in the source code but switched
  off at the source, so no build sends anything; if it is ever switched on, it stays off for you
  until you turn it on.)
- No account, login, or cloud sync.
- No advertising or tracking identifiers.
- No selling or sharing of data with third parties.
- No background uploads: the only request Compy makes on its own is the update check below. Compy does record
  locally without you opening a screen: at start-up and periodically it checks Windows' crash records and its own
  drift checks, and while monitoring or a capture runs it records the session. All of it stays in the files listed
  above.

## Network use

**What can leave this PC from Compy's own code, in full:**

1. **The update check** (automatic and on by default; you can switch it off in Settings, but the first check runs
   as soon as Compy's main window opens on first launch, before you can reach the setting): a request to GitHub
   for a release file.
2. **The update download**, only after you press **Update now**.
3. **Things you open yourself:** a link you click opens in your default browser, **Email it to me** opens
   a draft in your mail program, and a guided step can open a Windows Settings page. In each case your
   browser, mail program or Windows does the rest.

Nothing else from Compy's own code. Everything else in the software that could reach the network is switched off in
code and is described below. The app window is Microsoft Edge WebView2, a Microsoft component, and the installer
may download it from Microsoft if Windows lacks it (the installer settings name no other mode, so Tauri's default
applies); this policy covers what Compy's code does and does not describe what Microsoft itself collects.

Compy makes **one kind of automatic network request: an update check.** (A second path exists
in the source but is switched off in every build — see **Results sharing** at the end of
this section.)

- **What it asks.** Whether a newer signed version of Compy exists, by fetching a fixed release
  manifest from GitHub:
  `https://github.com/Pootytxng/compy-releases/releases/latest/download/latest.json`. That URL is a
  redirect, so the check reaches `github.com` and then the GitHub file-download host it redirects to; Compy's
  code names only `github.com`. If you choose **Update now**, the installer is downloaded from the address
  written in that release file.
- **When.** Once when the app starts, and about every four hours while it stays open.
- **What it sends about you.** Nothing. The address is fixed and holds no version, system or
  identifier, the request names only the update component and its version, and the request carries no hardware inventory, no sessions, no Trust Ledger, no
  settings, and no account — there is no account. As with any ordinary web request, GitHub does see
  connection metadata such as your IP address, under GitHub's own privacy terms.
- **Nothing is downloaded automatically.** If a newer version exists, Compy shows you the version
  and its notes. The installer downloads only after you choose **Update now**, and it must pass
  cryptographic signature verification against the public key built into Compy before it installs. The release
  file that describes the update is fetched over HTTPS; it is the installer, not that file, that is signature-checked.
  The update component saves the installer to a temporary place it chooses; Compy's code does not
  name that place.
- **You can turn it off.** It is on by default, and the first check runs as soon as Compy's main window opens on first
  launch, before you can reach the setting. *Settings → About → Automatic update checks.* With it off, Compy makes
  no network request at all on its own; **Check now** in the same row runs a single check when you
  ask for one. Turning checks off never weakens signature verification.

Separately, some advisory recommendations may **open a link in your default web browser** (for
example, a GPU driver download page or the HWiNFO and LibreHardwareMonitor download pages) — but only
when you click the link. Once a link opens, your browser, not Compy, handles it under your browser's
own privacy terms.

### Results sharing ("Receipts") — built, switched off, and opt-in if it is ever switched on

Compy's source code contains a second network path, which **sends nothing in any build you can
install today.** It is disclosed here in full, ahead of ever running, so that it can never appear on
your PC as a surprise. Two independent switches stand in front of it:

- **A switch in the code, currently fixed to off.** Compy is built with sharing disabled at the
  source; there is no setting, file, or command that can turn it on in a shipped build. Enabling it
  requires a change to the code and a new release.
- **Your switch, which starts off.** If the first switch is ever enabled, sharing is still **off
  until you turn it on**. Compy will tell you it exists on first run and show you exactly what a
  receipt contains before you decide. Turning it off later stops it, permanently and immediately —
  it is not a one-time choice.

**Exactly what one receipt would contain, and nothing else:**

- **Your PC's class, not your PC.** GPU maker and retail model name (e.g. "AMD", "Radeon RX 9070
  XT"), CPU family, and a RAM **range** such as "17-24" GB. Ranges, not exact numbers, because an
  exact byte count can single out an unusual machine.
- **One result.** The game's executable name with its folder path removed (so a Windows username
  embedded in a path cannot survive), average FPS, estimated 1% low, a session-length **range** such
  as "<15min", and the **ID numbers** of the Compy recommendations that were active — the IDs only,
  never their values, registry data, or file paths.
- **A schema version number.**

**What a receipt never contains:** your name, email, IP address, Windows username, machine name,
serial numbers, hardware IDs, file paths, installed program lists, browsing data, or any account or
machine identifier. There is no account, so there is nothing to attach it to. (A receipt is not proof of
anonymity: a rare GPU model and a game name can point to few PCs.)

- **Where it would go.** One address, `compy-bd6.pages.dev/api/usage` (the future `compy.gg`), which
  we operate. No third party, no analytics provider, no ad network.
- **When.** At most once when a monitored gaming session ends.
- **What we would keep.** The receipt itself, with no network identifier stored beside it. To stop
  flooding, the server counts submissions using a **hashed** form of your IP address held in a
  separate table; the server deletes entries older than an hour each time it receives a receipt, so an entry can
  outlive the hour if no later receipt arrives. It is never written next to a receipt.
- **Why it exists.** To learn whether a recommendation actually helps on hardware like yours, so the
  advice you get is measured rather than guessed.

> **About "telemetry" recommendations:** Some of Compy's optional recommendations help you
> *disable* Windows or NVIDIA telemetry services. That is a privacy feature that reduces what
> *other* software collects about you. It is unrelated to Compy's own data practices —
> Compy itself sends nothing about you.

## The Compy website & waitlist (separate from the app)

Everything above describes the **app**. The Compy **website** (the Pages site / future compy.gg) is
separate, and one part of it collects data — **only if you choose to give it:**

- **Waitlist email.** If you submit your email to the launch waitlist, we store that email address
  for one purpose: to send you a single message when the public beta opens. We do **not** sell it,
  share it with third parties, add you to other lists, or use it to track you.
- **Hashed IP (spam prevention).** When you submit the form, your IP address is converted to a
  one-way cryptographic hash (SHA-256 with a server-side value added) **before** it is stored — the raw IP
  address is never written to our records. The hash lets us limit spam without keeping your actual IP.
  It is stored in the same row as your email and the time you joined, and the site's code has no step that deletes it.
- **Where it's stored.** In a database (Cloudflare D1) on the site's hosting backend. The website
  itself loads **no third-party trackers, analytics, advertising scripts, or social pixels** — the
  page is built to make zero third-party requests.
- **Retention & deletion.** We intend to keep your email only until the launch message is sent (or until
  you ask us to remove it). The site's code has no automatic deletion, so removal is done by hand. To
  have your email removed at any time, contact us (below).

This website data collection is separate from the app. The installed Compy app does not send the
website — or anyone else — your hardware, session history, Trust Ledger, or settings. Its only
automatic connection from Compy's own code is the update check described above.

## Future: signed rule updates (currently disabled)

Compy contains the groundwork for downloading **cryptographically signed** recommendation
rule files in the future. This capability is **disabled** in the current build and performs no
network activity of its own — it is separate from the update check described above. If it is ever
enabled, it would only **download** signed rule files to keep
recommendations current — it would **never upload** information about you or your PC. Any such
change will be reflected in an updated version of this policy before it ships.

## Administrator access

Some actions (and the FPS capture helper) require Windows Administrator permission and will
prompt you (UAC). Compy asks for these rights to read state and to apply or undo the specific change
you requested. It installs no kernel driver of its own and does not inject code into your games.

## Children's privacy

Compy is a PC utility and is not directed at children. The app sends no personal information to us. The website
waitlist collects an email address; it is not meant for children.

## Changes to this policy

If Compy's data behavior ever changes, this policy will be updated and dated, and shipped
with the corresponding version.

## Contact & governing law

**Pootytxng** (Compy). Privacy questions, concerns, or a request to delete your waitlist email:
reply directly to any email you receive from the waitlist — replies reach the owner.

This policy, and any dispute relating to it, is governed by the laws of the **United States** and the
owner's state of residence (see the EULA's governing-law clause for the specific venue).
