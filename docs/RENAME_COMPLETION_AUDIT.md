# Rename Completion Audit — Sentinel → Compy

*Written 2026-06-04 by the outside-review session (Cowork). Status of the in-flight, **uncommitted**
rename found in the working tree, audited against the one-shot rename requirements. The repo is
being actively edited by HQ — treat file:line anchors as point-in-time and re-verify before editing.
Nothing in this doc is committed; git stays HQ-owned.*

---

## TL;DR

The load-bearing rename is **done and done correctly**: app identity, data-dir, and migration are
all in place. What remains is **one high-visibility string surface (the Export report), a handful of
deliberate identifier decisions, and a mechanical comment/docs sweep.** One small hardening
suggestion on the migration. Verification (tests/build/installer/smoke) must run on the Windows
side — none of it is possible from this Linux sandbox.

---

## ✅ Verified done (read directly from the working tree)

| Area | State |
|---|---|
| `tauri.conf.json` | `productName: "Compy"`, identifier **`gg.compy.app`**, window title `Compy`, homepage `https://compy.gg`, descriptions rewritten, publisher/copyright kept |
| `Cargo.toml` | package `compy`, lib `compy_lib` |
| `main.rs` | `compy_lib::run()`; debug log → `%LOCALAPPDATA%\Compy` |
| `lib.rs` | `compy_data_dir()` → `%APPDATA%\Compy` with **copy-not-move** legacy migration (`migrate_legacy_data_once`, OnceLock + exists-guard, original `Sentinel` dir preserved as safety net) |
| `index.html` | `<title>Compy — Performance Command Center</title>` |
| Frontend visible text | No user-visible "Sentinel" strings found in JSX text (remaining hits are localStorage keys / variable names — see Tier 2) |
| FPS helper self-spawn | `monitoring.rs:665` uses `current_exe()` → exe rename to `compy.exe` is name-agnostic ✓ |
| `baseline-rules-v1.json` | Clean (no sentinel references) |

---

## 🔴 Tier 1 — user-visible strings (finish BEFORE any build reaches another human)

**`export.rs` — the highest-visibility straggler.** The export report is the artifact users share
publicly; it still says Sentinel everywhere:

- `:102` `# Sentinel Report` (report title)
- `:105` `Exported {} · Sentinel v{}` (stamp line)
- `:111`, `:313`, `:369` privacy lines ("Sentinel collects no telemetry…")
- `:198`, `:216`, `:242` ledger annotations ("applied by Sentinel", "changed outside Sentinel")
- `:354`, `:359` output filenames `sentinel-report-{stamp}.md/.json` → `compy-report-…`
- `:362` JSON key `sentinel_version` → `compy_version` (exports are fresh artifacts; nothing parses old ones — safe)
- `:402`, `:405`, `:434` test assertions (update with the strings)

**`readiness.rs`** — advisory copy: `:20` (disclaimer), `:407` (power-plan advice), `:441/:444-445/:457/:459/:465` ("Applied Sentinel changes" check name + messages).

**`actions.rs`** — user-facing messages: `:748` (rollback plan-missing message), `:828` (EEE adapter message).

**`remote_rules.rs:158`** — error display string ("…current Sentinel app version").

---

## 🟡 Tier 2 — identifiers that need a deliberate decision (behavior-adjacent)

1. **`sessions.rs` serde field `sentinel_changes_active`** (persisted in sessions.json, mirrored in
   `App.tsx:375/:447`, and visible inside exported JSON). Recommended: rename to
   `compy_changes_active` **with `#[serde(alias = "sentinel_changes_active")]`** so migrated
   sessions.json files still parse, updating the TS interface in the same commit. Alternative:
   keep the old name forever (zero risk, mild export-cosmetics debt).
2. **`fps.rs:48` ETW session name `"Sentinel-FPS"` → `"Compy-FPS"`.** Safe (ETW sessions don't
   survive reboot); avoids colliding with a stale old-named session. Stop any running old session
   (or reboot) before the post-rename FPS smoke.
3. **localStorage keys ×5** (`sentinel-theme` main.tsx:25, App.tsx:587/595; `sentinel_onboarded_v1`
   Onboarding.tsx:8; `sentinel_score_face` Benchmark.tsx:36/128; `sentinel_overlay_corner`
   App.tsx:1595/1622; `sentinel_gaming_consent_v1` GamingMode.tsx:12). Invisible to users; renaming
   now resets prefs/onboarding/consent **only on the dev machine** (user count = 1). Recommended:
   rename now while that's true — the consent modal reappearing once is acceptable. (Note: the new
   identifier already gives the packaged app a fresh WebView2 profile, so packaged-build
   localStorage starts empty regardless.)
4. **`package.json` `"name": "sentinel"` → `"compy"`** (+ regenerate package-lock). npm-internal,
   zero runtime impact, do it for coherence.
5. **Temp-file prefixes** — hygiene, zero risk: `benchmark.rs:392` (`sentinel_bench_`), `:1194`
   (`sentinel_disktest_`), test temp names in `sessions.rs:224/:241/:245`, `history.rs:381/:398/:409/:432`.

---

## 🟢 Tier 3 — mechanical comment sweep (find-replace, zero risk)

Narrative comments across `actions.rs`, `monitoring.rs`, `history.rs`, `hardware.rs`,
`benchmark.rs`, `gaming_session.rs`, `readiness.rs`, `remote_rules.rs:123/:313`, `main.rs:6`,
`fps.rs` header. Two are **factually wrong post-rename** (fix first):

- `amd_freesync.rs:242` — says `cargo test -p sentinel` → now `-p compy`
- `monitoring.rs:721` / `fps.rs:3` — reference `sentinel.exe` → `compy.exe`

---

## 📄 Docs sweep (242 hits across 30 files — batch, in this order)

1. **Human-bound at beta time:** `BETA_TESTER_README.md`, `BETA_INVITE_MESSAGE.md`, `PRIVACY.md`,
   `EULA.md`, `README.md`.
2. **Living operational docs:** `CLAUDE.md` (resume-point banner must announce the rename),
   `PACKAGING_SIGNING_PLAN.md` (artifact names → `Compy_0.1.0_x64_en-US.msi` / `Compy_0.1.0_x64-setup.exe`),
   `PRODUCT_DIRECTION.md`, `RELEASE_QA.md`, `ARCHITECTURE_LOCKS.md`, `Roadmap.md`, `MONETIZATION.md`.
3. **`SENTINEL_OVERVIEW.md`** — being rewritten around diagnosis anyway (priority #3); rename the
   file (`COMPY_OVERVIEW.md`) as part of that rewrite, not before.
4. **Leave as historical record:** dated `docs/superpowers/specs|plans/*` (they describe the past;
   renaming history is revisionism and churn for nothing).

**Deliberately out of scope for the one-shot:** local folder name `C:\Users\Kuya\code\sentinel` and
GitHub repo `Pootytxng/sentinel`. GitHub renames auto-redirect, but do it as its own calm step
later — never mid-flight with active worktrees pointing at the path.

---

## 🛡 Migration assessment + one hardening suggestion

What's right: copy-never-move ✓, legacy dir preserved as safety net ✓, idempotent across runs
(exists-guard) and within a process (OnceLock) ✓, `%LOCALAPPDATA%\Sentinel` intentionally not
migrated (ephemeral IPC/debug) ✓.

**Hardening (recommended, ~6 lines):** the copy is non-atomic. If `copy_dir_recursive` fails
mid-way, `%APPDATA%\Compy` exists partially → every later run skips migration → silently partial
Trust Ledger. Fix: copy into `%APPDATA%\Compy.migrating`, then `fs::rename` to `%APPDATA%\Compy`
on success (atomic on same volume). Failure then leaves no `Compy` dir → clean retry next launch.
Add a migration unit test (nested legacy dir incl. `exports\` → verify full copy + legacy intact).

**Coexistence note:** the new identifier makes Compy a *different app* to Windows. The old
Sentinel install remains installed and runnable — two apps with mutation rights and separate
ledgers. Uninstall the old Sentinel build on the dev machine after the new installer passes smoke.
Leave `%APPDATA%\Sentinel` in place as the safety net for now; schedule its manual deletion weeks
later, not in this pass.

---

## 🧪 Windows-side verification checklist (the half this session cannot run)

1. `cargo test --manifest-path src-tauri/Cargo.toml` — full suite green.
2. `npm test` · `tsc` · `vite build` — green/clean.
3. `npm run tauri build` → confirm artifacts are **Compy_0.1.0_x64_en-US.msi / Compy_0.1.0_x64-setup.exe**, NotSigned (expected), no updater.
4. **Migration smoke (the critical one):** on a machine with the real `%APPDATA%\Sentinel` ledger →
   install + first-launch → `%APPDATA%\Compy` fully populated; ledger renders with all entries;
   **rollback of a pre-rename applied change executes correctly**; `%APPDATA%\Sentinel` untouched.
5. Single-instance lock (second launch focuses, no respawn).
6. Export → file named `compy-report-*`, title "Compy Report", UTF-8 BOM (`EF BB BF`) intact.
7. FPS helper: elevated, headless, IPC under the new runtime dir, clean exit; ETW session shows new name if renamed.
8. Zero outbound network (existing harness).
9. Uninstall/reinstall → Compy data persists.

**Constraints unchanged by this pass:** `gaming_mode_gate()` stays `false` · remote fetch stays
disabled · no updater · catalog frozen · no monetization code · no behavior change beyond
identity + migration.

---

## Name-decision record (for the file)

Compy was selected 2026-06-04 after collision-vetting 8+ candidates. The later FramePilot
suggestion was evaluated and rejected on evidence: framepilot.app (Samsung Frame TV app) and
getframepilot.com (AI real-estate photo editor) are both live products; SignalForge has 4+ active
products; RigPilot sits next to Nacon's RIG gaming-peripherals brand (same-category trademark
adjacency); PrimeRig collides with Prime Gaming mindshare. Compy remains the only candidate with a
clean in-category collision field and a confirmed-clear flagship domain (compy.gg — NXDOMAIN at the
.gg registry as of 2026-06-04). **Register compy.gg before this branch goes anywhere public.**
