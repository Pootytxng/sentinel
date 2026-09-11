# #205 SCOPED — MSIX / MICROSOFT STORE — **NO-GO ON MSIX**, 2026-08-23

**Why this exists:** the owner was told #205 was *"the one with real upside and no cost — free Store
registration, free signing, no SmartScreen."* **That sentence was wrong and this document retracts
it.** The registration is free. The free signing is real. **Compy cannot have it**, for a reason that
has nothing to do with the risk everyone was watching.

**Method:** three parallel research briefs (Store policy · Tauri/MSIX engineering · Compy's own code
on the desk), plus one narrow pricing check. Every load-bearing claim below is sourced. Where the
research could not settle something it is marked UNVERIFIED and is **not** treated as known.

---

## ⛔ THE DECISIVE FINDING — the Store rejects apps that need elevation, and free signing is MSIX-only

Microsoft, verbatim, on the MSIX packaging prerequisites page:

> *"If you plan on publishing your app to the Microsoft Store, **apps that require elevation for any
> part of their functionality won't be accepted into the Store**."*
> — https://learn.microsoft.com/windows/msix/desktop/desktop-to-uwp-prepare

**Compy requires elevation for most of what it is for.** Measured on the desk, not assumed:
`actions.rs:918` `elevate_and_wait` runs `ShellExecuteExW` with the `runas` verb (`:930`);
`run_elevated_powershell` (`actions.rs:1036`) re-launches Compy's own exe via
`std::env::current_exe()` (`actions.rs:1105`) as `--run-elevated`, handled at `main.rs:12-18`. That
path is what serves HKLM writes (`actions.rs:3562-3587`, `:3657-3703`, `:3834-3891`, `:4053-4065`,
`:4181-4234`, `:4374-4458`), service config, scheduled tasks, preload-app removal, and ~60 `powercfg`
sites (`actions.rs:2852-4122`).

The only sanctioned escape is the **`allowElevation` restricted capability**, and its own
documentation names an audience Compy is not in:

> *"enables apps developed by **Microsoft partners or enterprise organizations** to maintain existing
> desktop functionality that depends on auto-elevation… For Microsoft Store submissions, this
> capability is **subject to approval under strict criteria**. If you intend to use this capability,
> contact reportapp@microsoft.com in advance with a detailed justification."*
> — https://learn.microsoft.com/windows/apps/package-and-deploy/app-capability-declarations

**And the free signing does not exist outside MSIX.** Confirmed both directions:

- MSIX: *"You don't need to purchase a CA-trusted code signing certificate for MSIX/AppX Store
  submissions"* — the Store re-signs after certification.
  https://learn.microsoft.com/windows/apps/publish/publish-your-app/msix/app-package-requirements
- Unpackaged EXE/MSI: *"The Store does **not** re-sign MSI or EXE installers. If you submit an MSI or
  EXE installer, you must Authenticode-sign it yourself."*
  https://learn.microsoft.com/windows/apps/publish/faq/get-started-with-the-microsoft-store

**So the two prizes never arrive together.** The format that signs for free is the format Compy is
excluded from; the format Compy fits is the one where you buy the certificate anyway.

| | Free Microsoft signing | SmartScreen exemption | Can Compy actually function? |
|---|---|---|---|
| **MSIX** | ✅ | ✅ absolute | ❌ elevation rule + `allowElevation` gate |
| **Unpackaged EXE (policy 10.2.9)** | ❌ buy a cert | ⚠️ Store-flow installs only | ✅ UAC explicitly permitted |

## 🔁 THE RISK WE WERE WATCHING WAS THE WRONG ONE — 10.2.8 is survivable

Policy 10.2.8, current text (Store Policies **v7.19, effective 2025-10-14**):

> *"You are required to use supported methods and must obtain user consent to change any user's
> Windows settings, preferences, settings UI, or modify the user's Windows experience in any way.
> Unsupported methods include but are not limited to use of accessibility APIs or undocumented or
> unsupported APIs in unsupported ways."*

**Read literally, 10.2.8 does not ban changing Windows settings.** It imposes two conditions —
*supported methods* and *user consent* — and Compy's receipts-and-rollback design answers the consent
half about as well as anything could. Compy uses documented APIs and CLI surfaces, not accessibility
driving. **10.2.8 was never the load-bearing risk. The elevation rule is, and it is not a judgement
call — it is a stated exclusion.**

**Precedent search returned nothing in either direction.** No public account of a tweaking utility
being rejected *or* approved under 10.2.8. Process Lasso, O&O ShutUp10, FanControl, CCleaner and
Ashampoo WinOptimizer have **no Store listing at all**. The only optimizer-shaped listings found are
lightweight RAM cleaners of unverified package format. **The absence is the finding.**

## 🧨 SECOND, INDEPENDENT BLOCKER — Compy's own resolver kills a packaged Compy

Even setting Microsoft aside, **a self-packaged MSIX Compy disables itself**, and #130's design is
why. Measured on the desk:

- `data_root.rs:346` (predicate P3) canonicalizes `%APPDATA%\Compy` and returns `Redirected` if the
  real path contains `\appdata\local\packages\` (`PACKAGES_SEGMENT`, `data_root.rs:72`). **A genuine
  MSIX Compy resolves to exactly that path.**
- `MutationRoot::from_decision` (`data_root.rs:241-246`) yields `Some` **only** from `Canonical`;
  everything else is `None` (`:245`).
- `history.rs:450` `begin_mutation()` is the single token acquisition point. Without it: apply (single
  and batch), rollback, every receipt/ledger write (`history.rs:316`, `:383`, `:428`), leftover
  restore, service suspend, startup toggle, bloat-task disable, preload removal — **all dead**, and
  Gaming-Mode orchestration dies with them (`gaming_orchestrator.rs:462,523,534`).

Note the shape of this: **package identity alone was deliberately not a halt** (`data_root.rs:38-46`)
— the halt comes from the *path*, which is precisely what self-packaging changes. Fixing it means
teaching the resolver a "packaged-self vs packaged-host" distinction it was written not to need.
**That is surgery on the exact module that closed #130, for a build that cannot be accepted anyway.**

**Third-order, and worth knowing:** `license.rs:183` writes `license.key` through `compy_data_dir()`
with **no root gate**, so under any non-`Canonical` decision the key silently lands in a sandbox root.
That is a real latent defect independent of MSIX — see NEXT ACTION.

## 🛠️ WHAT MSIX WOULD HAVE COST, IF IT WERE POSSIBLE

Recorded so nobody re-scopes it. **Tauri v2 has no MSIX bundler** — `bundle.targets` offers only
`msi` and `nsis` on Windows; tauri#8548 (*"generate .msix or .appx"*) is **CLOSED as not planned**,
tauri#4818 is open and unassigned. Tauri's own Store guidance points at EXE/MSI, not MSIX. Packaging
would be hand-rolled `makeappx`/`makepri`/`signtool`, or the unvalidated third-party
`Choochmeque/tauri-windows-bundle`.

- **First MSIX that installs and launches: 3–6 engineer-days.**
- **Store-submittable: 10–25 engineer-days, and materially at risk of never passing.**
- **Ongoing: 0.5–1.5 engineer-days per release**, plus Store certification calendar lag versus an
  instant GitHub release.

Breakage along the way: **the updater is structurally dead** in MSIX (it works by running the NSIS
installer; *"the package is read-only"* and tampered package files block launch), so the MSIX build
needs the updater compiled out — a build-time feature flag threaded through Rust. WebView2 needs a
relocated user-data folder (default is the exe directory, read-only under MSIX). `%LOCALAPPDATA%\Compy`
ceases to exist, breaking `release-publish-adapter.ps1:194-205`, `ship-reinstall.ps1` and the HKCU
uninstall-key proof. And **tauri#14935 is open**: a *stock* Tauri v2 project fails the Windows App
Certification Kit on blocked `CreateProcessW` / `ShellExecuteW` / `cmd.exe` references, with no
documented workaround.

## 💵 WHAT SIGNING ACTUALLY COSTS — the only real decision left, and it is the owner's

If SmartScreen is to be beaten, it is bought. Verified prices:

- **Azure Artifact Signing** (renamed from Azure Trusted Signing) — **$9.99/month, up to 5,000
  signatures ≈ $119.88/yr**, no hardware token. **Individual developers are eligible and must be in
  the US or Canada** — *"Individual developers must be located in the United States or Canada"*
  (https://learn.microsoft.com/azure/artifact-signing/quickstart). Requires a government ID with an
  address plus a utility bill or bank statement issued within 12 months. **The old 3-year business-age
  rule never applied to the individual path** (Microsoft staff answer; secondary source, so treat as
  strong-but-not-doc).
- **Certum Open Source Code Signing** — from **€49**, but revocable if *"used to sign software
  distributed commercially."* **Compy is commercial. This path is closed.**
- **SignPath Foundation — free**, but requires *"an OSI-approved Open Source license without
  commercial dual-licensing for all components."* **Closed for the same reason.**
- SSL.com ≈ $369/yr all-in with cloud HSM; Sectigo ≈ $220/yr plus token. **Both worse than Azure.**
- **Hardware/HSM is now mandatory for every code-signing certificate** (CA/B CS-BR v3.11.0, effective
  2026-06-16), which is why Azure's cloud-HSM model is the cheap one.

**⚠️ AND A CERTIFICATE DOES NOT SWITCH SMARTSCREEN OFF.** Microsoft: reputation is *file-hash* plus
*publisher identity*, and *"reputation cannot transfer from previous versions unless both were signed
using the same publisher identity."* Build-up takes *"several weeks and hundreds of clean installs
from a wide audience."* **Signing does not remove the warning; it makes the warning able to go away,
and only once real download volume exists.** Compy has no download volume yet. **Buying the
certificate today buys nothing today.**

**⛔ RE-CONFIRMED, do not re-propose:** EV certificates. *"That behavior was removed in 2024."*

## ✅ WHAT SURVIVES #205

1. **Free Microsoft Store individual registration is real** ($19 waived since 2025-09-10, ID + selfie,
   ~200 markets, must start at `storedeveloper.microsoft.com`). It costs nothing to hold. **It is not
   worth acting on yet**, because every Store path for Compy is gated behind a paid certificate.
2. **The Store's unpackaged EXE path (10.2.9) stays open** and is where Compy would go *if* it ever
   goes. Requirements Compy does not currently meet: **silent install** (NSIS `/S` — satisfied) and
   *"not a downloader stub/web installer."* **`tauri.conf.json` has no `bundle.windows` block at all
   (`:56-70`)**, so WebView2 defaults to the download bootstrapper — **that would have to become the
   offline installer before submission.** One config change, but a real one.
3. **The elevation finding is durable.** It rules out MSIX for as long as Compy elevates, which is
   for as long as Compy is Compy.

## 🏁 THE CALL

**NO-GO on MSIX.** Not deferred — the blocker is a stated Store exclusion plus Compy's own resolver,
and neither moves on effort. Reversible only by Microsoft granting `allowElevation` to a solo
publisher, which its own documentation describes as a different audience.

**#205 was two questions wearing one number, and they should not have been bundled:** *"should Compy
be in the Store"* (answer: not until it is signed, and then only unpackaged) and *"should Compy buy a
certificate"* (a $119.88/yr recurring decision that is the owner's alone, and which buys nothing until
there is download volume to build reputation against).

**The unblocked work is #206, and it needs neither.** WinGet, Chocolatey, Scoop `extras` and a real
public releases repo impose **no signing requirement** and cost nothing. FanControl has 20,500 stars
on a repo carrying no source. **Discoverability is available now; the signature is not, and the
signature is worth less until the discoverability exists.**

---

**Sources:** Store Policies v7.19 · MSIX `desktop-to-uwp-prepare` · app-capability-declarations ·
MSIX + MSI/EXE app-package-requirements · smartscreen-reputation · code-signing-options ·
free individual registration (Windows Dev Blog 2025-09-10) · Azure Artifact Signing product +
quickstart · CA/B Forum CS-BR v3.11.0 · Tauri v2 config/updater/Store docs · tauri#8548 / #4818 /
#14935 · Certum + SignPath Foundation terms · desk read of `sentinel` @ `b6727dfc`.
