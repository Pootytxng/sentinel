# RELEASE_STATE.md — Compy single-source-of-truth gate matrix

> **This file is the AUTHORITATIVE current-truth snapshot of every gate, artifact, and release
> blocker.** When any other doc (CLAUDE.md, GATE_DECISIONS.md, OWNER_ACTION_CHECKLIST.md) disagrees
> with this file about *current state*, **this file wins** — fix the other doc. Created 2026-06-26
> after an external audit named state/doc drift the project's #1 risk. Keep it current: update the
> rows below in the SAME commit that flips a source-controlled gate or arms a feature. External
> build/install/draft/publication outcomes first enter the receipt-bound journal, then this file in
> the first normal follow-up source commit; the immutable release-source tag stays on its exact
> receipt commit. Every gate row
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
<!-- STATE:source_main_commit=92c7608 -->
<!-- STATE:latest_release_version=0.9.10 -->
<!-- STATE:candidate_version=0.9.11 -->
<!-- STATE:candidate_branch=main -->
<!-- STATE:candidate_published=no -->
<!-- STATE:candidate_installed=no -->
<!-- STATE:aborted_source_only_release=v0.9.9-664aa5e -->
<!-- STATE:preserved_private_draft=v0.9.10-92c7608 -->
<!-- STATE:published_release_version=0.9.7 -->
<!-- STATE:published_release_commit=1d9bad6 -->
<!-- STATE:owner_installed_version=0.9.10 -->
<!-- STATE:owner_installed_stamp=92c7608 -->
<!-- STATE:manifest_version=0.9.7 -->
<!-- STATE:hosted_ci=off-by-owner-decision-2026-07-16 -->
<!-- STATE:zh_cn_localization=base-and-vocabulary-on-main-d000295 -->
<!-- STATE:tester_distributed_version=0.9.0 -->
<!-- STATE:public_artifact=releases-repo-public -->
<!-- STATE:code_signing=open -->
<!-- STATE:legal=open -->

| Identity | Current truth | How to re-verify |
|---|---|---|
| **Source `main` baseline** | The repair began from synchronized local/origin `main` at `92c7608` (`release: v0.9.10`); subsequent infrastructure commits advance from it by normal fast-forward. Annotated source tags are immutable: local-only `v0.9.8` → `d9ced24`; origin `v0.9.9` → `664aa5e`; origin `v0.9.10` → `92c7608`. Recovery branches for the 0.9.8 and both failed 0.9.9 candidates remain local and on origin. | `git rev-parse HEAD origin/main` · `git merge-base --is-ancestor 92c7608 HEAD` · `git ls-remote --tags origin` |
| **v0.9.9 — aborted source-only release** | **Source-tagged and installed on the owner machine, but NEVER published to the fleet because the release-repository existence probe failed closed.** The publish transaction stopped at `scripts/release.ps1` immediately after pushing the source tag: an expected GitHub 404 from the releases-repo tag probe was promoted into a terminating `NativeCommandError` by Windows PowerShell 5.1. Three stages completed (source push, source tag push, releases-main lookup); six never started (releases tag, draft, asset upload, manifest, publish, verify). **Not a public release. Not republishable** — the signed receipt, installer and stamp are bound to `664aa5e`, and the pipeline requires an exact-HEAD match. Full byte-level evidence: `C:\Users\Kuya\code\compy-release-evidence\2026-07-28-v0.9.9-aborted-source-only-664aa5e\EVIDENCE.txt`. | `gh release list --repo Pootytxng/compy-releases` · `git ls-remote --tags https://github.com/Pootytxng/compy-releases.git` |
| **v0.9.10 — preserved private-draft checkpoint** | The partial train already created immutable source tag `v0.9.10` at `92c7608`, pushed source `main` and that tag, created the releases-repository tag and a **private draft**, uploaded installer + `latest.json`, downloaded them once, and installed/runtime-proved 0.9.10 locally. Draft asset digests exactly match the staged receipt. It was **never published to the updater fleet**. The pre-repair pipeline cannot resume it because its first collision check rejects its own compatible draft. Complete evidence is preserved at `C:\Users\Kuya\code\compy-release-evidence\2026-07-28-v0.9.10-private-draft-92c7608\`; no ref, draft, or asset may be moved, deleted, or overwritten. | `gh release view v0.9.10 --repo Pootytxng/compy-releases --json isDraft,assets` · `git rev-parse v0.9.10^{commit}` |
| **Next publishable candidate** | **v0.9.11**, from `main` after the autonomy, native-process, resumable-transaction, simulation, and static-guard repairs. v0.9.10 cannot be recut after its source tag: the release infrastructure must land after immutable `92c7608`, so advancing SemVer is the only provenance-correct path. **Not yet prepared, tagged, built, installed, or represented in `compy-releases`.** | `git log --oneline 92c7608..origin/main` · `git tag -l v0.9.11` |
| **Configured build version (this tree)** | Carried by the `STATE:latest_release_version` anchor above — check (1) pins that anchor to `src-tauri/tauri.conf.json`'s version, and the release pipeline moves both in the same commit as the bump. This is what the tree *would* build — it is **not** a released version (published truth is the row below). Do not restate the number here; it would drift. | `grep '"version"' src-tauri/tauri.conf.json package.json` |
| **Latest PUBLISHED release + source commit** | **v0.9.7**, source `1d9bad6` (published tag `v0.9.7` on `Pootytxng/compy-releases`). **Nothing newer is published to the updater.** There is no v0.9.8 or v0.9.9 release/tag in the releases repository. A releases-repository tag and private draft exist for v0.9.10, but `publishedAt` is null and public `releases/latest` remains v0.9.7. | `gh release view --repo Pootytxng/compy-releases --json tagName,isDraft,publishedAt` · `gh release view v0.9.10 --repo Pootytxng/compy-releases --json isDraft,publishedAt` |
| **Owner-installed version + embedded stamp** | **0.9.10**, embedded stamp **`92c7608`** — present exactly once with no dirty suffix; exe `ProductVersion`/`FileVersion` and registry `DisplayVersion` all read 0.9.10. It was installed and runtime-proved from the preserved private-draft checkpoint but never published to the fleet. | binary short-stamp count · HKCU uninstall `DisplayVersion` · local runtime proof |
| **Latest updater manifest version** | **v0.9.7** — `latest.json` at `releases/latest/download/` names the v0.9.7 asset; signature verifies against the pinned minisign key; installer + `latest.json` match GitHub's bytes. | unauthenticated fetch of `latest.json` + `scripts/verify-updater-signature.mjs` |
| **Tester-distributed version** | **0.9.0** — the `37a166c` NSIS (SHA-256 `6BC2F7DF…F5A2C4`) is what the six invitees were sent (Drive link). **NO updater-enabled build has been sent to any tester** (owner hold). | `BETA_DISTRIBUTION_RECORD.md` |
| **Known tester installation state** | **UNKNOWN.** No telemetry, no remote inventory by design. Six invitees hold the 0.9.0 link; what each actually installed is owner-confirmable only. | owner report only |
| **Public artifact exposure** | **YES — `Pootytxng/compy-releases` is a PUBLIC repo.** Every updater installer + `latest.json` is unauthenticated-downloadable (required for the updater; same discoverability as a shared link). **Source repo `Pootytxng/sentinel` stays PRIVATE.** No store listing, no marketing page, no Authenticode-signed public artifact. | `gh repo view Pootytxng/compy-releases --json visibility` |
| **Code-signing status** | **OPEN** — installers are Authenticode **NotSigned**. Gates a PUBLIC (store/marketing) release, not the private-beta updater. | `Get-AuthenticodeSignature` on the NSIS |
| **Legal status** | **OPEN** — EULA + privacy are DRAFTS only. Gates a PUBLIC release. | `docs/` legal drafts |

**Bottom line:** the newest **published** release and public updater manifest remain **v0.9.7
(`1d9bad6`)**. v0.9.8 (`d9ced24`) was owner-installed unpublished provenance; the failed v0.9.9
candidate (`2bd649d`) is preserved; v0.9.9 (`664aa5e`) is source-tagged and was owner-installed but
never reached `compy-releases`. v0.9.10 (`92c7608`) advanced to an immutable source tag, a
releases-repository tag, byte-correct private draft assets, and the owner install, but was never
published to the updater. The owner box runs 0.9.10 while the fleet remains on 0.9.7. Because the
release-infrastructure repair must land after immutable v0.9.10, the next provenance-correct
publishable candidate is **v0.9.11**. Hosted Actions remain intentionally off under the owner's
$0-budget decision; local gates plus the sandboxed publish simulation are operative. No newer build
has been distributed to another person.

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
| Publish of the next candidate | **OPEN — owner GO/NO-GO after local preparation.** v0.9.10 is preserved as an unpublished private-draft checkpoint and cannot absorb later source changes. The next public build is therefore v0.9.11; the next tester artifact would be that exact receipt-bound build, single-tester canary first. |
| Hosted CI | **NOT A BLOCKER — settled OFF by owner decision (2026-07-16).** Listed here only so its absence is never re-read as an unresolved gate. Local gates are the verification path. |
| Code signing | **OPEN** — gates PUBLIC release (Azure Trusted Signing route, owner/$-gated). |
| Legal (EULA + privacy) | **OPEN** — gates PUBLIC release. DRAFTS only. |
| Receipts security review + consent UI + payload preview + kill switch | **OPEN** — gates arming Receipts telemetry. |
| Preload-app removal live QA + owner-curated list | **OPEN** — gates arming preload-app removal (built DARK, not a ship blocker). |
| Aggregate-stack trial live QA | **OPEN** — gates arming the §2a stack trial (built DARK, not a ship blocker). |
| Remote-rules production key + CDN + staged rollout | **OPEN** — gates arming remote fetch. |

## Required owner decisions (live)

1. **Publish GO/NO-GO for the next prepared release (v0.9.11)** — the infrastructure train
   autonomously prepares, builds, signs, tags locally, installs, and runtime-proves the exact
   candidate, then stops. GO is the single fleet-visible action through
   `scripts/release-publish.ps1`. v0.9.9 and v0.9.10 are preserved unpublished checkpoints whose
   signed receipts and immutable tags bind older commits; neither may be rewritten or republished
   from later `main`.
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
