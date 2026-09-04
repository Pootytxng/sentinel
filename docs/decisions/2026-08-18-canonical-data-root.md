# Canonical data root — design decision (2026-08-18)

> **PRODUCT DIRECTION AUTHORITY RETIRED 2026-09-04 (#369).** This record remains technical data-root,
> rollback, and recovery provenance where it conforms to current architecture and release truth; it
> does not define current product direction. Product decisions route through
> `docs/PRODUCT_CONSTITUTION.md` and its derived roadmap.

Issue: #130. Supersedes the mechanism stated in #129.

## The defect

`src-tauri/src/lib.rs` `compy_data_dir()`:

```rust
pub(crate) fn compy_data_dir() -> PathBuf {
    let app_data = std::env::var("APPDATA").unwrap_or_else(|_| "C:\\Temp".into());
    let dir = PathBuf::from(&app_data).join("Compy");
    migrate_legacy_data_once(std::path::Path::new(&app_data), &dir);
    dir
}
```

`history.rs:302-312`, `:359-362`, `:920-946` make whatever this returns the sole apply/rollback
contract. `scripts/release.ps1:100` and `scripts/ship-reinstall.ps1:118` build their Gaming Mode
preflight path the same way (`Join-Path $env:APPDATA "Compy"`).

Three distinct ways this resolves somewhere other than the machine's Compy root:

1. **Container inheritance (the one that fired).** A process launched by an MSIX-packaged host —
   here `Claude_1.32352.0.0_x64__pzs8sxrjxfjjc` — inherits that package's filesystem and
   `HKCU`/`HKLM\Software` overlay. `APPDATA` is **not** rewritten; it still reads
   `C:\Users\Kuya\AppData\Roaming`. The *path resolution* is redirected, not the variable. Any check
   that validates the `APPDATA` string passes and still writes into the sandbox.
2. **Env tampering.** A parent that does rewrite `APPDATA`.
3. **The `C:\Temp` fallback.** With `APPDATA` unset, Compy silently persists the Trust Ledger to
   `C:\Temp\Compy` — a third silent root, on a shared path.

### Why this is P0 rather than cosmetic

Compy's mutations land on surfaces that MSIX does **not** virtualize — the SCM, the power subsystem,
Task Scheduler, `HKLM\SYSTEM`. Twelve of the redirected ledger's 38 applied receipts were confirmed
live on the real machine (see #130's inventory). So the redirected ledger is the **only** record of
real, still-live Windows changes, and a normally-launched Compy cannot see it — therefore cannot
offer or perform their rollback. That breaks LOCKED rule 3 (rollback-first integrity).

The release/ship preflights fail the same way, and they fail **open**: run from a packaged host they
inspect the sandbox root, find no `gaming-session*` contract, and permit a release over a real
pending Gaming Mode session whose Windows changes are still un-restored.

## The contract

One resolver, one decision value, consumed by every persistence and preflight caller.

```rust
pub enum DataRootDecision {
    /// The machine's own root, verified unredirected. The only variant that can mutate Windows.
    Canonical { root: PathBuf },
    /// Explicit measurement sandbox. Mutation is structurally impossible from this variant.
    Sandbox { root: PathBuf },
    /// Resolution is redirected by a host package or a rewritten environment. Halt.
    Redirected { effective: PathBuf, evidence: RedirectEvidence },
    /// Canonical root and one or more foreign package roots both hold receipts. Halt.
    Conflict { canonical: PathBuf, foreign: Vec<PathBuf> },
    /// No root can be resolved at all (e.g. APPDATA unset). Halt. Never falls back to C:\Temp.
    Unavailable { reason: String },
}
```

### Detection — one decisive predicate, three corroborating (AMENDED 2026-08-18, implementation)

> **Predicate 1 was falsified during implementation and is DEMOTED.** It said package identity was
> decisive: *"any family name means it is inside somebody else's container."* The session that built
> this ran in Store PowerShell (`WindowsApps\Microsoft.PowerShell_...\pwsh.exe`) — a packaged app
> **with** package identity and with **no filesystem redirection at all**: it read the canonical
> ledger and the overlay as two distinct files. Package identity and container redirection are
> independent properties. As originally specified the resolver would return `Redirected` on a clean
> machine and halt Compy for a user whose only sin is a Store terminal. **A halt on a false positive
> in the persistence layer is worse than the bug it guards against**, so identity became evidence,
> not a verdict. Kept in `get_data_root_report()` and used as the overlay lookup key for P4; never
> sufficient alone to force `Redirected`.

**P3 is now the decisive test** — it measures the thing that actually matters, where the opened root
*lands*, and it discriminated correctly in both directions on every piece of evidence gathered.

1. **Package identity** (`GetCurrentPackageFamilyName`) — *evidence only*. Recorded, reported, and
   used to locate the host's own overlay for P4. Never a halt on its own.
2. **`APPDATA` is where it should be.** Equal to `%USERPROFILE%\AppData\Roaming` case-insensitively,
   and not under `...\AppData\Local\Packages\`. Cheap; catches env tampering. Failing => `Redirected`.
3. **DECISIVE — the resolved final path.** `std::fs::canonicalize` (`GetFinalPathNameByHandle`) on
   the opened root must not resolve under `...\AppData\Local\Packages\`. Catches container
   inheritance *and* junction redirection, and stays quiet on a merely-packaged, unredirected host.
4. **NEW — NTFS identity vs the host's overlay.** If this process has a package family name, resolve
   that package's `LocalCache\Roaming\Compy` and compare `(volume serial, file id)` with the root we
   opened. Same file => our "canonical" root *is* the overlay => `Redirected`. This is the identity
   form of the owner's observation that `Get-Item` on the redirected ledger returns a populated
   `Target` pointing into `LocalCache\Roaming` — the same resolution, taken by handle rather than
   through .NET's weaker `LinkTarget`, which has no direct Rust equivalent.

Any of P2–P4 failing produces `Redirected` with the evidence that failed — never a silent
correction, never a best-guess root.

### Conflict detection belongs on the clean side

From inside a container, the canonical root is shadowed and unreadable — the overlay wins. From a
clean host, both are visible. So the conflict probe runs only when predicates 1–3 pass: enumerate
`%LOCALAPPDATA%\Packages\*\LocalCache\Roaming\Compy\history.json`; if any exists **and** is nonempty
while the canonical ledger is also nonempty, return `Conflict`.

`Conflict` and `Redirected` both mean: **stop, show the user both paths, their receipt counts and
their last-write times, and explain what is safe to do next.** No automatic merge, overwrite,
deduplication, rollback, copy, rename or quarantine — ever, in either direction. Recovery is an
owner-gated, explicit, one-direction-at-a-time operation designed separately.

### Mutation capability is a type, not a runtime check

```rust
/// Constructible only from DataRootDecision::Canonical. There is no other constructor.
pub struct MutationRoot(PathBuf);

impl MutationRoot {
    pub fn from_decision(d: &DataRootDecision) -> Option<Self> { /* Canonical => Some, else None */ }
}
```

`actions.rs`, `history.rs` apply/rollback, and `gaming_orchestrator.rs` take `&MutationRoot`, not
`&Path`. A sandbox or redirected root then cannot reach a mutation path by construction rather than
by remembering to check — which is the same discipline as the mutation-boundary guard.

Read-only surfaces (reports, viewing history, support export) take `&DataRootDecision` and render
the effective root and the decision variant alongside whatever they show.

### Measurement sandbox override

One variable, `COMPY_MEASUREMENT_DATA_ROOT`. Its presence yields `Sandbox`, which cannot produce a
`MutationRoot`. There is deliberately no second "and allow mutations" flag to get wrong. This is what
`launch-focus-guard` and the Q7 probes use, so they stay hermetic without touching the real ledger.

### Exposure

`get_data_root_report()` — a read-only Tauri command returning the decision variant, the effective
root, the three predicate results, and any foreign roots found. Surfaced in Settings and included in
the support export, so "which ledger am I looking at" is answerable without a debugger.

### Preflight parity

**Done.** `scripts/lib/canonical-data-root.ps1` is the same decision in PowerShell:
`Get-CanonicalCompyDataRoot -Phase <name>` returns a *proven* root or throws. `release.ps1` and
`ship-reinstall.ps1` dot-source it and no longer compose `Join-Path $env:APPDATA "Compy"`.

Both previously failed open **twice**: they joined the path blind, then returned early when the
directory was absent — so from a redirected shell each would inspect an overlay, find no pending
Gaming Mode contract, and report PASS about a folder it had never looked at. The helper needs no
`MutationRoot` (there is no capability to hand out, only a path or a refusal), and it carries two
refusal tails on purpose: a wrong shell is fixed by relaunching, a real split is not, and telling
the operator to retry would send them round a loop that cannot close.

*Verified on the owner's desk 2026-08-18: it refuses, naming both roots — parity with the Rust
`Conflict`.*

## Guards (each falsified before being trusted, per the standing law)

1. Package identity present → resolver returns `Redirected`; no directory is created and
   `migrate_legacy_data_once` does **not** run. (Today the migration would COPY the entire legacy
   `%APPDATA%\Sentinel` tree into the sandbox.)
2. `APPDATA` rewritten to a `...\AppData\Local\Packages\...` path → `Redirected`.
3. Canonical ledger nonempty **and** a package-root ledger nonempty → `Conflict`, and no file under
   either root is opened for writing during the probe.
4. `APPDATA` unset → `Unavailable`, never `C:\Temp\Compy`.
5. `COMPY_MEASUREMENT_DATA_ROOT` set → `Sandbox`, and `MutationRoot::from_decision` returns `None`.
6. Static guard: no source file outside the resolver module composes a data path from `APPDATA`
   directly — the same shape as `mutation-boundary-guard`, extended to persistence roots.
7. **NEW (P4)** — a probe whose package overlay shares our root's `(volume serial, file id)` =>
   `Redirected`; and package identity **alone**, on a root that resolves cleanly, => `Canonical`.
   The second half is the falsification of demoted predicate 1 and must never regress.

**Shipped as:** 16 unit guards in `src-tauri/src/data_root.rs` (pure `resolve()` over synthetic
probes — every variant falsifiable without a container or a second data root), plus
`scripts/data-root-guard.test.mjs`, the static guard, which covers Rust *and* the PowerShell
preflights and was itself falsified in both languages before being trusted. Legitimate non-root
reads (the support-header path scrubber, the install-dir debug log) carry a greppable
`data-root-allow` marker with its reason, block-form above the line.

**One test-build escape, stated plainly.** The pre-existing mutation/rollback suites drive the real
gateways against the real `%APPDATA%\Compy` ledger, and this desk is *currently in the `Conflict`
state this module detects* — so under the shipped rule all ten would refuse, replacing real
assertions with a tautology. `mutation_root()` is therefore `#[cfg(test)]`-overridden to issue the
token for the effective root, preserving exactly their prior behavior. **Release builds have no such
path**, and nothing is left unproven: refusal is falsified variant-by-variant through the pure
`mutation_root_from()`, and `begin_mutation()` remains the single place any gateway obtains a token.

## Deliberately out of scope here

Recovery and migration of the existing split on this desk. The out-of-container read is now
**done** (#130, 2026-08-18: canonical = 3 receipts, overlay = 61, zero ID overlap), so recovery is
unblocked *technically* — and stays owner-gated. It is proposed on #130, never performed.
