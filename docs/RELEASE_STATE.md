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
<!-- STATE:source_main_commit=c0fed45 -->
<!-- STATE:latest_release_version=0.9.11 -->
<!-- STATE:candidate_version=0.9.11 -->
<!-- STATE:candidate_branch=main -->
<!-- STATE:candidate_published=yes-2026-07-28 -->
<!-- STATE:candidate_installed=yes -->
<!-- STATE:aborted_source_only_release=v0.9.9-664aa5e -->
<!-- STATE:v0910_release_debris=deleted-2026-07-28 -->
<!-- STATE:v0910_source_tag=92c7608-preserved -->
<!-- STATE:v0910_local_evidence=preserved -->
<!-- STATE:published_release_version=0.9.11 -->
<!-- STATE:published_release_commit=7ba5fb6 -->
<!-- STATE:published_release_id=361056355 -->
<!-- STATE:published_installer_sha256=bb2b85a43c2bf5119666f7b0709e7cee0409e0eb5ed7c4da2e4998da5438384f -->
<!-- STATE:published_manifest_sha256=6bcd6cea96bd610e8be1c44765cfc4e6f3b8c2b4e4594774251fa3cceb76b007 -->
<!-- STATE:release_transaction_stages=9-of-9 -->
<!-- STATE:owner_installed_version=0.9.11 -->
<!-- STATE:owner_installed_stamp=7ba5fb6 -->
<!-- STATE:manifest_version=0.9.11 -->
<!-- STATE:hosted_ci=off-by-owner-decision-2026-07-16 -->
<!-- STATE:zh_cn_localization=base-and-vocabulary-on-main-d000295 -->
<!-- STATE:tester_distributed_version=0.9.0 -->
<!-- STATE:canary_status=pass-on-0.9.11 -->
<!-- STATE:public_artifact=releases-repo-public -->
<!-- STATE:code_signing=open -->
<!-- STATE:legal=open -->

| Identity | Current truth | How to re-verify |
|---|---|---|
| **Source `main` baseline** | The repair began from synchronized local/origin `main` at `92c7608` (`release: v0.9.10`) and advanced by fast-forward through the release commit `7ba5fb6` to the post-release tooling repairs (`c0fed45`). Annotated source tags are immutable: local-only `v0.9.8` → `d9ced24`; origin `v0.9.9` → `664aa5e`; origin `v0.9.10` → `92c7608`; origin `v0.9.11` → tag object `7d57446` peeling to commit `7ba5fb6`. Recovery branches for the 0.9.8 and both failed 0.9.9 candidates remain local and on origin. | `git rev-parse HEAD origin/main` · `git rev-parse v0.9.11^{commit}` · `git ls-remote --tags origin` |
| **v0.9.9 — aborted source-only release** | **Source-tagged and installed on the owner machine, but NEVER published to the fleet because the release-repository existence probe failed closed.** The publish transaction stopped at `scripts/release.ps1` immediately after pushing the source tag: an expected GitHub 404 from the releases-repo tag probe was promoted into a terminating `NativeCommandError` by Windows PowerShell 5.1. Three stages completed (source push, source tag push, releases-main lookup); six never started (releases tag, draft, asset upload, manifest, publish, verify). **Not a public release. Not republishable** — the signed receipt, installer and stamp are bound to `664aa5e`, and the pipeline requires an exact-HEAD match. Full byte-level evidence: `C:\Users\Kuya\code\compy-release-evidence\2026-07-28-v0.9.9-aborted-source-only-664aa5e\EVIDENCE.txt`. | `gh release list --repo Pootytxng/compy-releases` · `git ls-remote --tags https://github.com/Pootytxng/compy-releases.git` |
| **v0.9.10 — abandoned; release debris DELETED 2026-07-28** | The partial train created immutable source tag `v0.9.10` at `92c7608`, pushed source `main` and that tag, created a releases-repository tag and a **private draft**, uploaded installer + `latest.json`, and installed/runtime-proved 0.9.10 locally. It was **never published to the updater fleet**, and v0.9.11 superseded it. Under explicit owner authorization the abandoned **release debris was removed**: private draft release `360948018` deleted (HTTP 204, both assets with it) and releases-repository tag `v0.9.10` deleted (HTTP 204) after confirming no release depended on it — every releases-repo tag points at the same content commit `a628c9b`, so no commit was removed and no other release was affected. **Provenance is preserved and untouched:** the source tag `v0.9.10` → `92c7608` in `Pootytxng/sentinel` still exists, as do the recovery branches and the full local evidence directory `C:\Users\Kuya\code\compy-release-evidence\2026-07-28-v0.9.10-private-draft-92c7608\`. | `gh api repos/Pootytxng/compy-releases/releases --jq '[.[]\|select(.tag_name=="v0.9.10")]\|length'` (→ `0`) · `git rev-parse v0.9.10^{commit}` (→ `92c7608`) |
| **v0.9.11 — PUBLISHED (2026-07-28)** | Cut from `main` after the autonomy, native-process, resumable-transaction, simulation, and static-guard repairs, then published under owner GO. Public release id **`361056355`**, tag `v0.9.11`, `draft: false`, `prerelease: false`, published `2026-07-28T14:44:17Z`. Public installer `Compy_0.9.11_x64-setup.exe` SHA-256 **`bb2b85a43c2bf5119666f7b0709e7cee0409e0eb5ed7c4da2e4998da5438384f`**; public `latest.json` SHA-256 `6bcd6cea96bd610e8be1c44765cfc4e6f3b8c2b4e4594774251fa3cceb76b007`; both byte-match the signed receipt and the updater signature verifies against the pinned key. Releases-repository tag `v0.9.11` → `a628c9b`. The resumable transaction is **complete: 9 of 9 stages**, closing on `public_assets_verified` after the `/releases/latest/download/` aliases converged. | `gh release view v0.9.11 --repo Pootytxng/compy-releases --json id,isDraft,isPrerelease,publishedAt` · `src-tauri/target/release/bundle/nsis/release-transaction-v0.9.11.json` |
| **Configured build version (this tree)** | Carried by the `STATE:latest_release_version` anchor above — check (1) pins that anchor to `src-tauri/tauri.conf.json`'s version, and the release pipeline moves both in the same commit as the bump. This is what the tree *would* build — it is **not** a released version (published truth is the row below). Do not restate the number here; it would drift. | `grep '"version"' src-tauri/tauri.conf.json package.json` |
| **Latest PUBLISHED release + source commit** | **v0.9.11**, source `7ba5fb6` (full `7ba5fb63750265c03e67783edfa0b52cbe1208bb`), published tag `v0.9.11` on `Pootytxng/compy-releases`, release id `361056355`. It supersedes v0.9.7 (`1d9bad6`) as the public release. There is no v0.9.8, v0.9.9, or v0.9.10 release or tag in the releases repository — the abandoned v0.9.10 draft and its tag were deleted 2026-07-28. | `gh release view --repo Pootytxng/compy-releases --json tagName,isDraft,publishedAt` · `gh api repos/Pootytxng/compy-releases/git/refs/tags/v0.9.10` (→ 404) |
| **Owner-installed version + embedded stamp** | **0.9.11**, embedded stamp **`7ba5fb6`** — runtime proof reads `7ba5fb6 · release · shell 0.9.11`; exe `ProductVersion`/`FileVersion` and registry `DisplayVersion` all read 0.9.11 (Windows Apps: 0.9.11). Installed from the exact receipt-bound installer that was published. | binary short-stamp count · HKCU uninstall `DisplayVersion` · local runtime proof |
| **Latest updater manifest version** | **v0.9.11** — `latest.json` at `releases/latest/download/` names the v0.9.11 asset (`.../releases/download/v0.9.11/Compy_0.9.11_x64-setup.exe`); signature verifies against the pinned minisign key; installer + `latest.json` match GitHub's bytes and the receipt digests. | unauthenticated fetch of `latest.json` + `scripts/verify-updater-signature.mjs` |
| **Hand-distributed tester version** | **0.9.0** — the `37a166c` NSIS (SHA-256 `6BC2F7DF…F5A2C4`) is what the six invitees were sent (Drive link). That remains the only hand-send; nothing has been mailed out since. | `BETA_DISTRIBUTION_RECORD.md` |
| **A0 single-tester canary** | **PASS.** A tester completed the canary through Compy's **normal public updater** and is **currently running v0.9.11**; **no updater failure was reported.** That is the whole recorded result — the tester's prior version, the update timestamp, and any per-step detail were never captured, so they are not reconstructible and must not be inferred. | owner report only |
| **Known tester installation state** | **One confirmed: the canary tester on 0.9.11** (owner-reported). The other invitees remain **UNKNOWN** — no telemetry, no remote inventory by design; six invitees hold the 0.9.0 link and what each actually installed is owner-confirmable only. | owner report only |
| **Public artifact exposure** | **YES — `Pootytxng/compy-releases` is a PUBLIC repo.** Every updater installer + `latest.json` is unauthenticated-downloadable (required for the updater; same discoverability as a shared link). **Source repo `Pootytxng/sentinel` stays PRIVATE.** No store listing, no marketing page, no Authenticode-signed public artifact. | `gh repo view Pootytxng/compy-releases --json visibility` |
| **Code-signing status** | **OPEN** — installers are Authenticode **NotSigned**. Gates a PUBLIC (store/marketing) release, not the private-beta updater. | `Get-AuthenticodeSignature` on the NSIS |
| **Legal status** | **OPEN** — EULA + privacy are DRAFTS only. Gates a PUBLIC release. | `docs/` legal drafts |

**Bottom line:** the newest **published** release and the public updater manifest are both
**v0.9.11 (`7ba5fb6`)**, released 2026-07-28 — it replaced v0.9.7 (`1d9bad6`) as the fleet-visible
build, and the owner box runs the same 0.9.11 bytes it published. The recovery provenance behind it
is intact and unaltered: v0.9.8 (`d9ced24`) owner-installed unpublished; the failed v0.9.9 candidate
(`2bd649d`) preserved; v0.9.9 (`664aa5e`) source-tagged, owner-installed, never in `compy-releases`;
v0.9.10 (`92c7608`) an immutable source tag whose abandoned **release debris (private draft
`360948018` + releases-repo tag) was deleted 2026-07-28** under owner authorization, leaving the
source tag, recovery branches and local evidence intact. Hosted Actions remain intentionally off
under the owner's $0-budget decision; local gates plus the sandboxed publish simulation are
operative. **No build has been distributed to another person by hand since the 0.9.0 link** — the
fleet reaches 0.9.11 only through the consent-first updater, and **the A0 single-tester canary has
PASSED** on that path: the tester updated in-app, runs v0.9.11, and reported no updater failure.
The v0.9.11 release transaction is **complete: 9 of 9 stages**, **no active release blocker
remains, and normal product development may resume.**

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
| Publish of v0.9.11 | **CLOSED — published 2026-07-28** under owner GO; transaction complete 9/9, public assets and manifest verified against the signed receipt. Any *future* candidate still needs its own owner GO/NO-GO after local preparation. |
| Tester distribution of the published build | **CLOSED — A0 canary PASS.** A tester updated through the normal public updater and runs v0.9.11 with no reported failure, proving the fleet path end-to-end on a machine that is not the owner's. Widening to the remaining invitees is an owner distribution call, not a blocker. |
| Hosted CI | **NOT A BLOCKER — settled OFF by owner decision (2026-07-16).** Listed here only so its absence is never re-read as an unresolved gate. Local gates are the verification path. |
| Code signing | **OPEN** — gates PUBLIC release (Azure Trusted Signing route, owner/$-gated). |
| Legal (EULA + privacy) | **OPEN** — gates PUBLIC release. DRAFTS only. |
| Receipts security review + consent UI + payload preview + kill switch | **OPEN** — gates arming Receipts telemetry. |
| Preload-app removal live QA + owner-curated list | **OPEN** — gates arming preload-app removal (built DARK, not a ship blocker). |
| Aggregate-stack trial live QA | **OPEN** — gates arming the §2a stack trial (built DARK, not a ship blocker). |
| Remote-rules production key + CDN + staged rollout | **OPEN** — gates arming remote fetch. |
| v0.9.10 release debris | **CLOSED — deleted 2026-07-28** under owner authorization (draft `360948018` + releases-repo tag). Source tag `92c7608`, recovery branches and local evidence preserved. |

**No active blocker remains on the v0.9.11 release train** — it is complete 9/9, the canary passed,
and the debris is cleared, so **normal product development may resume.** Every row still marked OPEN
above gates a *future* PUBLIC (store/marketing) release or the arming of a dark feature; none of them
blocks the shipped v0.9.11 build or the work that follows it.

## Required owner decisions (live)

1. **Fleet expansion beyond the passed v0.9.11 canary** — publish is done (GO given, 9/9 stages,
   public assets verified) and the single-tester canary **PASSED** on the normal updater path, which
   was the stated precondition for widening. The remaining call is whether/when the other invitees
   move onto the updater-enabled build — a distribution decision, owner territory. Publish GO/NO-GO
   returns as a decision only for the *next* prepared candidate.
2. Code-signing route + legal finalization (PUBLIC gates).
3. When/whether to arm Receipts (its own security review + owner sign-off).

**Closed 2026-07-28:** the v0.9.10 private-draft cleanup decision — the owner authorized deletion and
the abandoned release debris (draft `360948018` + releases-repo tag `v0.9.10`) is gone; source tag,
recovery branches and local evidence were preserved. It is no longer an open decision.

**Not** an owner decision: hosted CI. It is settled OFF under the 2026-07-16 zero-budget decision and
must never be surfaced as an open obligation — see the Gate matrix row.

## Snapshot history — in archive

The full reverse-chronological banner log (every dated train, byte-preserved) lives in
[archive/RELEASE_STATE_HISTORY.md](archive/RELEASE_STATE_HISTORY.md). APPEND new dated banners to the
TOP of the archive; keep THIS file to CURRENT STATE only (budget: 300 lines, `scripts/doc-budget.ps1`).
