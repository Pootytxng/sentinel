# Preload-app removal (Phase-B bloat removal) — BUILT DARK

**Owner nod: 2026-07-06** ("Build it — scope accepted"), after a scope discussion that settled three things:

1. **The `HKCU\Run` half of the roadmap item is DROPPED.** Startup enable/disable already ships
   (`set_startup_entry_enabled`, `lib.rs` — the same StartupApproved flag Task Manager flips,
   perfectly reversible). Deleting the leftover Run *line* adds tidiness, not performance, at real
   rollback cost. Not built.
2. **The new mutation is per-user UWP preload-app removal only.** `Remove-AppxPackage` for the
   current user — never `-AllUsers`, never deprovisioning, never DISM.
3. **The rollback caveat is accepted with eyes open:** app uninstall cannot restore byte-identical
   like every registry/service mutation shipped so far. The honest undo is a two-tier reinstall
   (below). The allowlist rules exist to make that weaker undo acceptable.

## Allowlist rules (what may EVER appear in `KnownPreloadApp`)

- Still published in the Microsoft Store → genuinely re-gettable. (Deprecated apps — 3D Viewer,
  Paint 3D, Mixed Reality Portal, Teams-personal — are permanently excluded.)
- No meaningful local user data (Mail / Photos / Sticky Notes / OneNote excluded forever;
  Clipchamp + To Do deliberately left OFF the starter list as data-adjacent).
- Never frameworks/dependencies, never the Store itself, never Xbox Game Bar / Gaming Services
  (games need them), never anything security-related.
- Exact typed-enum match (`from_id`), unknown input rejected — the `KnownBloatTask` pattern.
- The list is owner-curated before arming (starter set is a proposal, not a shipped judgment).

**Starter set (5):** Solitaire Collection · Feedback Hub · Microsoft News · Microsoft 365 (Office)
hub · Spotify preload. Store ProductIds are carried as consts and MUST be live-verified during the
arming QA (each `ms-windows-store://pdp/` link opened + confirmed) — they are curated data, not
runtime reads.

## Rollback contract (two honest tiers)

Snapshot at apply time = the package's **PackageFullName + PackageFamilyName + Version read from
the live system** (ground truth, never a const). If that read fails → REFUSE before any mutation
([[mutation-snapshot-failsafe-idiom]]).

1. **Tier 1 — silent re-register:** `Add-AppxPackage -RegisterByFamilyName -MainPackage <PFN>`
   (works when the package is still staged on disk). Success is VERIFIED by re-reading the
   installed state — never assumed from exit status.
2. **Tier 2 — Store hand-off:** if re-register fails, open the app's Store page and return `Err`
   with plain-English instructions ("press Install"). The ledger entry stays ACTIVE (honest: not
   yet rolled back); pressing Roll back again after the Store install verifies and closes it.
   Already-installed at rollback time → `Ok` (idempotent).

## Gate

`preload_removal_gate()` — **DARK (`false`)** until: own live QA (remove→reinstall round-trip on
this rig, off-list rejected, not-installed refused, Store links verified) + owner curates the final
list + explicit arming sign-off. Command `remove_known_preload_app` refuses while dark. The FE card
(`PreloadApps`, Fix surface) renders nothing unless the backend reports armed + at least one listed
app installed — zero visual delta while dark.

## Elevation

None. Per-user Appx removal and re-registration run unelevated (`elevation_used: false`).
