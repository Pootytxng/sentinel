# RELEASE_STATE.md — Compy single-source-of-truth gate matrix

> **This file is the AUTHORITATIVE current-truth snapshot of every gate, artifact, and release
> blocker.** When any other doc (CLAUDE.md, GATE_DECISIONS.md, OWNER_ACTION_CHECKLIST.md) disagrees
> with this file about *current state*, **this file wins** — fix the other doc. Created 2026-06-26
> after an external audit named state/doc drift the project's #1 risk. Keep it current: update the
> rows below in the SAME commit that flips a gate, arms a feature, or cuts a release. Every gate row
> carries a `file:line` for re-verification. The CURRENT STATE table carries machine-readable
> `<!-- STATE:… -->` anchors that `scripts/verify-release-state.mjs` enforces against live source:
> app-version drift, a stacked banner, an undisclosed public endpoint, a stale owner decision, a
> second bottom-line section, or a `source_main_commit` that is unresolvable / off-mainline / more
> than 10 commits behind the mainline all FAIL the gate.

## CURRENT STATE (authoritative — read this first)

> **One table. No banner stack.** The dated per-train banners that used to live here are a LOG, not
> state — they live in [archive/RELEASE_STATE_HISTORY.md](archive/RELEASE_STATE_HISTORY.md). Do NOT
> stack a new banner on this file; update the rows below in place. Static commit hashes name fixed
> points in history; the *live* `main` pointer is whatever `git rev-parse HEAD` returns at read time.

<!-- latest_release_version is enforced by check (1) to equal src-tauri/tauri.conf.json's version, so it
     means "the version THIS TREE is configured to build" — NOT "the newest published release".
     Published truth is carried separately by published_release_* below. Do not conflate them. -->
<!-- STATE:source_main_commit=20306bc -->
<!-- STATE:latest_release_version=0.9.9 -->
<!-- STATE:candidate_branch=integration/v0.9.8-hardened -->
<!-- STATE:candidate_published=no -->
<!-- STATE:candidate_installed=no -->
<!-- STATE:published_release_version=0.9.7 -->
<!-- STATE:published_release_commit=1d9bad6 -->
<!-- STATE:owner_installed_version=0.9.8 -->
<!-- STATE:owner_installed_stamp=d9ced24 -->
<!-- STATE:manifest_version=0.9.7 -->
<!-- STATE:hosted_ci=off-by-owner-decision-2026-07-16 -->
<!-- STATE:zh_cn_localization=base-on-main-20306bc-vocabulary-on-candidate -->
<!-- STATE:tester_distributed_version=0.9.0 -->
<!-- STATE:public_artifact=releases-repo-public -->
<!-- STATE:code_signing=open -->
<!-- STATE:legal=open -->

| Identity | Current truth | How to re-verify |
|---|---|---|
| **Source `main` commit** | `20306bc` = **published** `origin/main` (zh-CN base merge). A dated marker, not the live pointer. ⚠️ **Local `main` is 1 commit AHEAD and unpushed: `d9ced24` "release: v0.9.8", plus a LOCAL-ONLY annotated tag `v0.9.8` → `d9ced24`** (no `v0.9.8` tag on origin). `d9ced24` is the source of the owner's live app (row below) and exists **only in this clone**. Push/tag = owner-gated, deliberately not done. | `git rev-parse HEAD` · `git rev-list --left-right --count origin/main...main` · `git ls-remote --tags origin v0.9.8` |
| **Hardened integration candidate** | Branch **`integration/v0.9.8-hardened`** = `d9ced24` + the encoding/state-truth hardening (`15efc54`, `27c5f4b`, `85d5034`) + the zh-CN vocabulary completion (from `2461106`) + this truth pass. **NOT on `main`, NOT tagged, NOT built into an installer, NOT published, NOT installed.** It is an integration candidate only; its embedded build stamp will differ from `d9ced24`. | `git log --oneline origin/main..integration/v0.9.8-hardened` · `git ls-remote --tags origin` (no `v0.9.8`) |
| **Configured build version (this tree)** | **0.9.8** in `tauri.conf.json` / `package.json` / `Cargo.toml`. This is what the tree *would* build — it is **not** a released version. The `STATE:latest_release_version` anchor tracks THIS value (check (1) pins it to `tauri.conf.json`), not the published release. | `grep '"version"' src-tauri/tauri.conf.json package.json` |
| **Latest PUBLISHED release + source commit** | **v0.9.7**, source `1d9bad6` (tag `v0.9.7` on `Pootytxng/compy-releases`). **Nothing 0.9.8 is published** — no release, no asset, no tag on any remote. | `gh release list --repo Pootytxng/compy-releases`; tag → commit |
| **Owner-installed version + embedded stamp** | **0.9.8**, embedded stamp **`d9ced24`** (exe `ProductVersion`/`FileVersion` 0.9.8, mtime 2026-07-24). Built from the **unpushed** local-`main` commit above, so the live app corresponds to **no published release**. ⚠️ Registry `DisplayVersion` still reads **0.9.7** — the uninstall entry is stale vs the running binary; trust the embedded stamp, not the registry. Earlier updater-delivered chain (0.9.4→0.9.7) is history — see [archive](archive/RELEASE_STATE_HISTORY.md). ⚠️ **The hardened candidate is NOT this build** — it is not installed anywhere and carries a different embedded stamp; only `d9ced24` is resident on the owner's box (verified: the installed exe contains `d9ced24` and no other candidate hash). | `Select-String compy.exe <shorthash>` + HKCU uninstall `DisplayVersion` (read-only) |
| **Latest updater manifest version** | **v0.9.7** — `latest.json` at `releases/latest/download/` names the v0.9.7 asset; signature verifies against the pinned minisign key; installer + `latest.json` match GitHub's bytes. | unauthenticated fetch of `latest.json` + `scripts/verify-updater-signature.mjs` |
| **Tester-distributed version** | **0.9.0** — the `37a166c` NSIS (SHA-256 `6BC2F7DF…F5A2C4`) is what the six invitees were sent (Drive link). **NO updater-enabled build has been sent to any tester** (owner hold). | `BETA_DISTRIBUTION_RECORD.md` |
| **Known tester installation state** | **UNKNOWN.** No telemetry, no remote inventory by design. Six invitees hold the 0.9.0 link; what each actually installed is owner-confirmable only. | owner report only |
| **Public artifact exposure** | **YES — `Pootytxng/compy-releases` is a PUBLIC repo.** Every updater installer + `latest.json` is unauthenticated-downloadable (required for the updater; same discoverability as a shared link). **Source repo `Pootytxng/sentinel` stays PRIVATE.** No store listing, no marketing page, no Authenticode-signed public artifact. | `gh repo view Pootytxng/compy-releases --json visibility` |
| **Code-signing status** | **OPEN** — installers are Authenticode **NotSigned**. Gates a PUBLIC (store/marketing) release, not the private-beta updater. | `Get-AuthenticodeSignature` on the NSIS |
| **Legal status** | **OPEN** — EULA + privacy are DRAFTS only. Gates a PUBLIC release. | `docs/` legal drafts |

**Bottom line:** the newest **published** thing is **v0.9.7 (`1d9bad6`)**, and the updater manifest still points there — **nothing 0.9.8 exists outside this clone.** The owner's box runs a locally-built **0.9.8 (`d9ced24`)** that was never pushed, tagged on a remote, or published, so his live app is ahead of everything public and reproducible only from here. The hardened **`integration/v0.9.8-hardened`** candidate is a further step ahead of that: it is **not** the installed build, **not** tagged, **not** built into an installer, and **not** published — it exists as a branch awaiting the owner's GO. The releases repo is **public**, so published installers are downloadable by anyone with the URL; what stays private is the **source**. Nothing newer than the 0.9.0 kit has been **sent** to a tester. Hosted CI is intentionally off (owner's $0-budget decision, 2026-07-16) — the full gate set runs locally. Public/store release stays blocked on **Code signing + Legal**.

## Gate matrix

> `scripts/verify-release-state.mjs` FAILS if this section, CURRENT STATE, or Release blockers is
> missing, or if the file carries zero `file:line` citations — the f21c170 diet-cut class (a doc
> trim silently gutting the live matrix) can't recur silently.

| Gate / capability | State | Source | Notes |
|---|---|---|---|
| **Gaming Mode (F1)** | **LIVE** (`true`) | `gaming_mode_gate()` — `lib.rs:518` | Flipped 2026-06-18 w/ owner sign-off. §7 QA harness passed; **GAMING_MODE_QA.md 10/10 PASSED 2026-07-14**; **owner SIGNED OFF 2026-07-14** — field-proven for 1.0. |
| **Service-suspend** | **ARMED** (`true`) | `service_suspend_gate()` — `actions.rs:2029` | Armed 2026-06-25. Live exact-restore + UAC-cancel=no-partial + critical-service block proven. Session start/restore ride the ONE batched elevation (T6/T6b). |
| **Debloat (telemetry task disable)** | **ARMED** (`true`) | `bloat_removal_gate()` — `actions.rs:2102` | Armed 2026-06-26. Live exact disable→enable restore + off-list/Defender rejected. |
| **Benchmark tweak A/B trial** | **LIVE / UI-reachable, NO dedicated gate** | `start_tweak_trial` — `benchmark_trial.rs:170` | REAL mutation via the audited `apply_recommendation` path, protected by a `RollbackGuard` (auto-rollback on every exit). |
| **Preload-app removal** | **DARK** (`false`) | `preload_removal_gate()` — `actions.rs:2251` | Built dark 2026-07-06. Command refuses while dark; FE renders nothing. Arming needs live remove→reinstall QA + owner sign-off. |
| **Aggregate-stack A/B trial (§2a)** | **DARK** (`false`) | `stack_trial_gate()` — `benchmark_trial.rs:274` | Built dark 2026-07-09 (reuses audited batch path; multi-change Drop-guard rollback; corrupt-ledger read ABORTS pre-mutation). No FE surface. |
| **Experiment engine + simulator (Intelligence P3)** | **ARMED** (`true`, 2026-07-17) | `experiment_gate()` — `experiment.rs:55` | Armed after owner sign-off + live apply→rollback round-trip. No new mutation primitive; resolve stays history-only; simulator reads catalog READ-ONLY. |
| **Leftovers restore** | **ARMED** (`true`, 2026-07-16) | `restore_gate()` — `leftovers.rs:730` | Armed after owner-present live-UAC QA (3 loops PASS); receipts ride the Trust Ledger (`leftover_adopted`). |
| **Receipts telemetry** | **DARK** (`false`) | `receipts_gate()` — `receipts.rs:18` | No send path/endpoint/queue; preview refuses. Arming = its own security review + owner sign-off. |
| **License / Pro enforcement** | **DISARMED — nothing enforced** | `licensing_armed()` — `license.rs:40` (all-zeros key) | Plumbing wired but inert; `ProGate` renders everything free. No Windows mutation, no phone-home. |
| **Signed remote rules / fetch** | **OFF** (`false`) | `remote_fetch_enabled()` — `remote_rules.rs:97`; all-zeros pubkey `remote_rules.rs:85` | Double-gated: `verify_chain` (`remote_rules.rs:231`) hard-fails on the placeholder key. Never runs in shipped builds. |
| **Auto-updater** | **LIVE** (2026-07-22, owner-directed) | `plugins.updater` — `tauri.conf.json:73` (pubkey `:75`, endpoints `:76`); `tauri-plugin-updater` — `Cargo.toml:37`; capability `capabilities/updater.json` (main window ONLY, `updater:allow-check` + `allow-download-and-install`) | Consent-first: check on launch + every 4h; nothing downloads until the user clicks Update now. Minisign-verified against the pinned key before install; private key outside the repo. **E2E-witnessed 0.9.4→0.9.7 this session** (CDP stamp transitions, no reinstall between); GitHub asset counters corroborate. |
| **Hosted CI (GitHub Actions)** | **OFF — by standing owner decision (2026-07-16), not a defect and not an open owner obligation** | `.github/workflows/` (workflows present but never start) | GitHub refuses every job **before runner startup** under the account's $0 Actions budget (~$12 of the free minutes already burned). The owner declined the spend under the zero-budget law and directed that it never be re-asked. **The full gate set runs locally instead** (encoding guard · release-state verifier · hook self-tests · doc budget · tsc · vitest · frontend build · cargo test · clippy `-D warnings` · release-pipeline guards · updater-signature verify). A red/absent CI badge is the expected steady state. |
| **zh-CN localization** | **Base MERGED on `main` (`20306bc`); verdict vocabulary completed ON THE CANDIDATE only** | `src/i18n/locales/zh-CN/` · guard `src/i18n/zh-cn-verdict-vocabulary-guard.test.ts` | The zh-CN base translation is already on `main` — nothing about it is pending a merge. What is **not** on `main` is the verdict-chip vocabulary finish (真有效 / 安慰剂 / 有风险 — 已拒绝) integrated from `2461106`; it lives only on `integration/v0.9.8-hardened`, pinned by the guard test. |
| **Outbound network** | **ONE surface: signed update check/download** (2026-07-22) | `tauri-plugin-updater` (`Cargo.toml:37`) fetches the pinned endpoint (`tauri.conf.json:76`) Rust-side; **production CSP `connect-src` UNCHANGED** (`tauri.conf.json:47` — `'self' ipc:`; no webview-reachable HTTP) | Supersedes the 2026-07-11 zero-outbound audit BY OWNER DECISION. Receipts + remote-fetch stay dark; Export leaves only by the user's hand. |

## Mutation safety posture (unchanged LOCKED rules)

- No kernel driver · no game injection · rollback-first · typed mutation allowlist
  (`KnownService`/`KnownBloatTask`/`AppliedAction`/`RollbackAction`/`Snapshot`, unknown inputs rejected).
- Rollback resolves from `history.json` alone, never the live catalog (`actions::resolve_rollback` — `history.rs:818`).
- Ledger save is crash-safe atomic temp-write+rename, test-pinned (`save_history_to` — `history.rs:332`).
- Elevation: relaunch `compy.exe --run-elevated <hex> <ticket>` (windowless), 4-way honest UAC
  attribution (`elevation_outcome` — `actions.rs:964`); helper runs ONLY hex byte-matching the
  one-time ticket (`mint_elevation_ticket` — `actions.rs:1149`).
- Gaming-session advanced tier batches to ONE elevation per session start and per restore
  (`apply_elevated_tier` — `gaming_orchestrator.rs:201`); no-partial abort+restore contract;
  UAC-decline drops only verifiably-never-ran staged entries (`elevation_error_nothing_ran` — `actions.rs:988`).

## Release blockers

| Item | Status |
|---|---|
| Private-beta functional blockers | **NONE** — Gaming Mode signed off; installed-build QA + runtime closure done; the updater path is live and owner-proven. |
| Publish of the hardened candidate | **OPEN — owner GO/NO-GO.** `integration/v0.9.8-hardened` passes the full local gate set but is **unpublished, untagged on any remote, unbuilt as an installer, and not installed**. Nothing ships until the owner runs the publish step; the next tester artifact would be this candidate, single-tester canary first. |
| Hosted CI | **NOT A BLOCKER — settled OFF by owner decision (2026-07-16).** Listed here only so its absence is never re-read as an unresolved gate. Local gates are the verification path. |
| Code signing | **OPEN** — gates PUBLIC release (Azure Trusted Signing route, owner/$-gated). |
| Legal (EULA + privacy) | **OPEN** — gates PUBLIC release. DRAFTS only. |
| Receipts security review + consent UI + payload preview + kill switch | **OPEN** — gates arming Receipts telemetry. |
| Preload-app removal live QA + owner-curated list | **OPEN** — gates arming preload-app removal (built DARK, not a ship blocker). |
| Aggregate-stack trial live QA | **OPEN** — gates arming the §2a stack trial (built DARK, not a ship blocker). |
| Remote-rules production key + CDN + staged rollout | **OPEN** — gates arming remote fetch. |

## Required owner decisions (live)

1. **Hardened v0.9.8 candidate GO/NO-GO** — `integration/v0.9.8-hardened` is verified against the
   full local gate set but **unpublished, untagged on any remote, unbuilt, and not installed**.
   GO means: merge to `main` → build → tag → publish (publish = owner action, via
   `scripts/release-publish.ps1`). Until then the local `v0.9.8` tag still points at the older
   `d9ced24`, and moving it is an owner call — see the tag note in CURRENT STATE.
2. **Single-tester canary** — after publish + the owner-box updater proof, choose the ONE tester to
   receive the updater-enabled build first; expand to the rest only after that tester completes the
   core path.
3. Code-signing route + legal finalization (PUBLIC gates).
4. When/whether to arm Receipts (its own security review + owner sign-off).

**Not** an owner decision: hosted CI. It is settled OFF under the 2026-07-16 zero-budget decision and
must never be surfaced as an open obligation — see the Gate matrix row.

## Snapshot history — in archive

The full reverse-chronological banner log (every dated train, byte-preserved) lives in
[archive/RELEASE_STATE_HISTORY.md](archive/RELEASE_STATE_HISTORY.md). APPEND new dated banners to the
TOP of the archive; keep THIS file to CURRENT STATE only (budget: 300 lines, `scripts/doc-budget.ps1`).
