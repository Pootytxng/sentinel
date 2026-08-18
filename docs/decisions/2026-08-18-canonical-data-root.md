# Canonical data root — design decision (2026-08-18)

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

### Detection — three independent predicates, all must hold for `Canonical`

1. **No inherited package identity.** `GetCurrentPackageFamilyName` (kernel32, `appmodel.h`) must
   return `APPMODEL_ERROR_NO_PACKAGE` (15700). Compy ships as a per-user NSIS install and has no
   package identity of its own, so *any* package family name means Compy is running inside somebody
   else's container. This is the direct, documented, deterministic test for the failure that
   actually occurred — it does not depend on inspecting paths the container is already lying about.
2. **`APPDATA` is where it should be.** It must equal `%USERPROFILE%\AppData\Roaming`
   case-insensitively, and must not lie under `...\AppData\Local\Packages\`.
3. **The resolved root's final path agrees.** `GetFinalPathNameByHandle` on the opened directory must
   not resolve under `...\AppData\Local\Packages\`.

Predicate 1 catches container inheritance; 2 catches env tampering; 3 catches a host that redirects
by junction rather than by container. Any predicate failing produces `Redirected` with the evidence
that failed — never a silent correction, never a "best guess" root.

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

`scripts/release.ps1` and `scripts/ship-reinstall.ps1` stop composing `Join-Path $env:APPDATA "Compy"`
and instead consume the same contract. Until they do, both must **refuse** rather than pass when the
host has a package identity — a Gaming Mode gate that cannot see the real contract must fail closed,
not open.

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

## Deliberately out of scope here

Recovery and migration of the existing split on this desk. That needs the canonical side read by an
out-of-container instrument first (#130), and it is owner-gated.
