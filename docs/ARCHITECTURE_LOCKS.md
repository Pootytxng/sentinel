# Architecture Locks

Decisions that are hard to change once users are in the wild. Future contributors (including future Claude sessions) must respect these. Breaking them silently is a "users-can't-update-or-rollback" class incident.

---

## Tier 1 — Immutable forever (changing breaks already-installed users)

### Rec IDs

Every `Recommendation.id` shipped in a release is a **permanent contract**.

- `id: "game-mode"` will be `game-mode` forever.
- Renames are not allowed. Even capitalization changes are not allowed.
- If you need to retire a rec, mark it removed in the code but **keep the apply/rollback handlers for its id** — users may still have history entries referencing it.

Reason: `%APPDATA%\Sentinel\history.json` stores `rec_id` strings. `rollback_change` dispatches on `rec_id` via match. A renamed id means the user's existing applied changes become unrollback-able — Sentinel can't restore the prior state on their machine.

### Snapshot JSON shapes per rec

The structure of `AppliedChange.snapshot` for each rec is also a permanent contract.

- Fields can be **added** as `Option<>` with a sane default for missing values.
- Fields can **never be renamed or removed** without permanently breaking rollback of older history entries.
- If you must change a field's semantic meaning, version it: add a new field with the new meaning, keep the old field's handler for legacy entries.

Reason: same as above. Rollback functions consume the snapshot JSON; if the shape changes, they can't restore state for entries written before the change.

### `AppliedChange` struct fields

The persisted history file uses these field names. Adding new fields is fine (use `#[serde(default)]` for backward compat). Renaming or removing is not.

```rust
struct AppliedChange {
    id: String,
    rec_id: String,
    rec_title: String,
    applied_at: String,
    snapshot: serde_json::Value,
    status: String, // "applied" | "rolled_back"
}
```

`AppliedChangeView` is the runtime-only enriched form sent to the frontend; the on-disk format stays minimal.

### Bundle identifier

Currently `com.sentinel.app` in `src-tauri/tauri.conf.json`. Once installed by users, Windows uses this as the application's identity. Changing it after shipping means existing installations cannot update through any normal mechanism — they remain as ghost installations alongside the new one.

**Confirm before public release.** Pre-release we can change freely.

### AppData directory name

`%APPDATA%\Sentinel\` — see `sentinel_data_dir()` in lib.rs. History persistence and any future user state lives here. Renaming requires migration code.

---

## Tier 2 — Schema-versioned (changing requires a new schema version)

### Remote rules JSON schema (Step B)

When we ship Step B, the JSON file at the CDN URL has a fixed schema. Once any released Sentinel build fetches and parses this URL, the schema is locked for that URL.

**Lock-in mitigation built into the design:**

1. **Versioned URLs.** `rules-v1.json`, `rules-v2.json`. The Rust client has a constant `RULES_SCHEMA_VERSION: u32 = 1` and constructs the URL as `https://<cdn>/sentinel/rules-v{version}.json`. When we need a breaking schema change, we bump to v2 — old clients keep working off v1 until they update.
2. **`schema_version` field inside each JSON.** Belt-and-suspenders against serving the wrong file at the wrong URL.
3. **No code in the JSON.** `apply_kind` is a string that names a Rust function (e.g. `"registry-write-hkcu"`, `"service-disable"`). Apply logic stays in audited Rust; remote JSON only selects which Rust function runs with which parameters. A malicious/buggy remote JSON cannot execute arbitrary code on a user's machine.

### Rec category strings

`"Windows" | "Power" | "GPU" | "Display" | "Storage" | "Network"` — used in `rec.category`, in CSS class names (`rec-cat-windows`), and to drive tab visibility in the frontend.

Adding new categories is supported (frontend `REC_CATEGORIES` array + new CSS class). Renaming is messy: it requires a coordinated change across Rust + TS + CSS *and* breaks any cached remote rules pointing at the old name.

Treat additions as routine; rename only as part of a deliberate schema version bump.

---

## Tier 3 — Worth being careful about, but recoverable

- **History JSON file format**: additive evolution via `#[serde(default)]` works fine. Old history loads with new fields defaulted.
- **`runas` crate** for UAC elevation: swappable for a custom helper if needed.
- **WMI / DXGI / SMBIOS detection sources**: implementation details; we already use fallbacks.

---

## What is *not* an architecture lock (despite sounding scary)

- Adding new recs — additive, never a problem.
- Adding new appliable-rec IDs to `APPLIABLE_REC_IDS` — additive.
- Adding new fields to `HardwareInfo` — additive.
- Changing the UI layout (tabs, cards, etc.) — frontend-only, no persistence implications.
- Adding new categories — covered in Tier 2; treated as additive.

---

## Pre-launch checklist (separate from this doc)

Things that must be done before public release but aren't yet decided:

- [ ] Trademark check on "Sentinel" against the optimization-software space
- [ ] Final bundle identifier confirmed
- [ ] EV code-signing certificate purchased and integrated into the build pipeline
- [ ] Tauri 2 built-in updater configured (`tauri.conf.json` `updater` section + signing key)
- [ ] LICENSE replaced from the placeholder with the final commercial license
- [ ] Privacy policy + EULA + clear disclaimers about reboot-required tweaks
