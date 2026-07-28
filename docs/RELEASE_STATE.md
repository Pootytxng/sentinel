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
<!-- STATE:source_main_commit=71bbb1d -->
<!-- STATE:latest_release_version=0.9.10 -->
<!-- STATE:candidate_version=0.9.10 -->
<!-- STATE:candidate_branch=main -->
<!-- STATE:candidate_published=no -->
<!-- STATE:candidate_installed=no -->
<!-- STATE:aborted_source_only_release=v0.9.9-664aa5e -->
<!-- STATE:published_release_version=0.9.7 -->
<!-- STATE:published_release_commit=1d9bad6 -->
<!-- STATE:owner_installed_version=0.9.9 -->
<!-- STATE:owner_installed_stamp=664aa5e -->
<!-- STATE:manifest_version=0.9.7 -->
<!-- STATE:hosted_ci=off-by-owner-decision-2026-07-16 -->
<!-- STATE:zh_cn_localization=base-and-vocabulary-on-main-d000295 -->
<!-- STATE:tester_distributed_version=0.9.0 -->
<!-- STATE:public_artifact=releases-repo-public -->
<!-- STATE:code_signing=open -->
<!-- STATE:legal=open -->

| Identity | Current truth | How to re-verify |
|---|---|---|
| **Source `main` commit** | `71bbb1d` "route every release-critical native call through one capture helper" = local `main`, pushed to `origin/main`. Its parent `664aa5e` is the **v0.9.9 release commit**. ⚠️ The annotated tag **`v0.9.9` IS on origin** (tag object `531cf07` → `664aa5e`) — it is a **source** tag only; no release, asset, or tag for it exists in `compy-releases`. The annotated tag **`v0.9.8` is LOCAL-ONLY** (points at `d9ced24`); moving or pushing it is an owner call. | `git rev-parse HEAD` · `git rev-list --left-right --count origin/main...main` · `git ls-remote --tags origin` |
| **v0.9.9 — aborted source-only release** | **Source-tagged and installed on the owner machine, but NEVER published to the fleet because the release-repository existence probe failed closed.** The publish transaction stopped at `scripts/release.ps1` immediately after pushing the source tag: an expected GitHub 404 from the releases-repo tag probe was promoted into a terminating `NativeCommandError` by Windows PowerShell 5.1. Three stages completed (source push, source tag push, releases-main lookup); six never started (releases tag, draft, asset upload, manifest, publish, verify). **Not a public release. Not republishable** — the signed receipt, installer and stamp are bound to `664aa5e`, and the pipeline requires an exact-HEAD match. Full byte-level evidence: `C:\Users\Kuya\code\compy-release-evidence\2026-07-28-v0.9.9-aborted-source-only-664aa5e\EVIDENCE.txt`. | `gh release list --repo Pootytxng/compy-releases` · `git ls-remote --tags https://github.com/Pootytxng/compy-releases.git` |
| **Next publishable candidate** | **v0.9.10**, from `main` at or after `71bbb1d`. Carries everything in the v0.9.9 candidate (release integrity, encoding, zh-CN vocabulary, Learn-screen work) **plus** the generalized native-process repair that makes the publish transaction survivable. **Not yet tagged, built, published or installed.** The updater only offers a version strictly greater than the installed one, and the owner box already runs 0.9.9 — so 0.9.10 is the lowest version that can reach both the public fleet (on 0.9.7) and the owner. | `git log --oneline 664aa5e..origin/main` |
| **Configured build version (this tree)** | Carried by the `STATE:latest_release_version` anchor above — check (1) pins that anchor to `src-tauri/tauri.conf.json`'s version, and the release pipeline moves both in the same commit as the bump. This is what the tree *would* build — it is **not** a released version (published truth is the row below). Do not restate the number here; it would drift. | `grep '"version"' src-tauri/tauri.conf.json package.json` |
| **Latest PUBLISHED release + source commit** | **v0.9.7**, source `1d9bad6` (tag `v0.9.7` on `Pootytxng/compy-releases`). **Nothing newer is published** — the releases repo carries tags v0.9.2–v0.9.7 only, its newest release is "Compy v0.9.7" (2026-07-23), and **there is no v0.9.8, v0.9.9 or v0.9.10 release, draft, asset or tag anywhere public.** | `gh release list --repo Pootytxng/compy-releases`; tag → commit |
| **Owner-installed version + embedded stamp** | **0.9.9**, embedded stamp **`664aa5e`** — present exactly once in the exe, no `-dirty` suffix (exe `ProductVersion`/`FileVersion` 0.9.9, registry `DisplayVersion` 0.9.9, mtime 2026-07-27). Built and locally runtime-proven from the v0.9.9 release commit, then **never published** (see the aborted-release row) — so the live app corresponds to **no published release** and is ahead of every public user, who are on 0.9.7. The older local 0.9.8 (`d9ced24`) is gone from the box; the installed exe contains `664aa5e` and no other candidate hash. Earlier updater-delivered chain (0.9.4→0.9.7) is history — see [archive](archive/RELEASE_STATE_HISTORY.md). | `Select-String compy.exe <shorthash>` + HKCU uninstall `DisplayVersion` (read-only) |
| **Latest updater manifest version** | **v0.9.7** — `latest.json` at `releases/latest/download/` names the v0.9.7 asset; signature verifies against the pinned minisign key; installer + `latest.json` match GitHub's bytes. | unauthenticated fetch of `latest.json` + `scripts/verify-updater-signature.mjs` |
| **Tester-distributed version** | **0.9.0** — the `37a166c` NSIS (SHA-256 `6BC2F7DF…F5A2C4`) is what the six invitees were sent (Drive link). **NO updater-enabled build has been sent to any tester** (owner hold). | `BETA_DISTRIBUTION_RECORD.md` |
| **Known tester installation state** | **UNKNOWN.** No telemetry, no remote inventory by design. Six invitees hold the 0.9.0 link; what each actually installed is owner-confirmable only. | owner report only |
| **Public artifact exposure** | **YES — `Pootytxng/compy-releases` is a PUBLIC repo.** Every updater installer + `latest.json` is unauthenticated-downloadable (required for the updater; same discoverability as a shared link). **Source repo `Pootytxng/sentinel` stays PRIVATE.** No store listing, no marketing page, no Authenticode-signed public artifact. | `gh repo view Pootytxng/compy-releases --json visibility` |
| **Code-signing status** | **OPEN** — installers are Authenticode **NotSigned**. Gates a PUBLIC (store/marketing) release, not the private-beta updater. | `Get-AuthenticodeSignature` on the NSIS |
| **Legal status** | **OPEN** — EULA + privacy are DRAFTS only. Gates a PUBLIC release. | `docs/` legal drafts |

**Bottom line:** the newest **published** thing is **v0.9.7 (`1d9bad6`)**, and the updater manifest still points there — **nothing newer is published anywhere.** **v0.9.9 is a source-only checkpoint, not a release:** it is tagged on the source remote and installed on the owner's box (`664aa5e`), but its publish transaction failed closed at the releases-repo probe, so it never reached the public releases repo and cannot be republished from a later HEAD. The owner's box therefore runs **0.9.9 (`664aa5e`)** while every public user is on **0.9.7**. The next publishable candidate is **v0.9.10** from `main` (`71bbb1d`), which adds the native-process repair that broke v0.9.9's publish — **not** tagged, **not** built, **not** published, **not** installed. The releases repo is **public**, so published installers are downloadable by anyone with the URL; what stays private is the **source**. Nothing newer than the 0.9.0 kit has been **sent** to a tester. Hosted CI is intentionally off (owner's $0-budget decision, 2026-07-16) — the full gate set runs locally. Public/store release stays blocked on **Code signing + Legal**.

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
| **zh-CN localization** | **Base AND verdict vocabulary both MERGED on `main` (`d000295`)** | `src/i18n/locales/zh-CN/` · guard `src/i18n/zh-cn-verdict-vocabulary-guard.test.ts` | The zh-CN base translation and the verdict-chip vocabulary finish (真有效 / 安慰剂 / 有风险 — 已拒绝, integrated from `2461106`) are both on `main` — nothing zh-CN is pending a merge. The guard test pins the vocabulary. |
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
| Publish of v0.9.10 | **OPEN — owner GO/NO-GO.** `main` (`71bbb1d`) passes the full local gate set but is **unpublished, unbuilt as an installer, and not installed**. v0.9.9 already consumed its version number as an aborted source-only checkpoint and is not republishable, so the next public build is **v0.9.10**; the next tester artifact would be that build, single-tester canary first. |
| Hosted CI | **NOT A BLOCKER — settled OFF by owner decision (2026-07-16).** Listed here only so its absence is never re-read as an unresolved gate. Local gates are the verification path. |
| Code signing | **OPEN** — gates PUBLIC release (Azure Trusted Signing route, owner/$-gated). |
| Legal (EULA + privacy) | **OPEN** — gates PUBLIC release. DRAFTS only. |
| Receipts security review + consent UI + payload preview + kill switch | **OPEN** — gates arming Receipts telemetry. |
| Preload-app removal live QA + owner-curated list | **OPEN** — gates arming preload-app removal (built DARK, not a ship blocker). |
| Aggregate-stack trial live QA | **OPEN** — gates arming the §2a stack trial (built DARK, not a ship blocker). |
| Remote-rules production key + CDN + staged rollout | **OPEN** — gates arming remote fetch. |

## Required owner decisions (live)

1. **Publish GO/NO-GO for the next release (v0.9.10)** — `main` (`71bbb1d`) is verified against the
   full local gate set but **unpublished, unbuilt, and not installed**. GO means: prepare → build →
   tag → publish (publish = owner action, via `scripts/release-publish.ps1`). The previous candidate
   is **not** the pending one: it is an aborted source-only checkpoint (source-tagged,
   owner-installed, never published) whose signed receipt is bound to `664aa5e` and cannot be
   published from a later HEAD — it is recorded in CURRENT STATE and in the history archive. The
   updater only offers a version strictly greater than the one installed on the owner box, which is
   why the next publishable candidate is **v0.9.10**. The local-only legacy release tag and its
   target are recorded in CURRENT STATE; moving or pushing it is an owner call.
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
