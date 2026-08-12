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
> second bottom-line section, an `owner_installed_stamp` that disagrees with the build stamp embedded
> in this machine's installed `compy.exe`, or a `source_main_commit` that is unresolvable /
> off-mainline / more than 10 commits behind the mainline all FAIL the gate.

## CURRENT STATE (authoritative — read this first)

> **One table. No banner stack.** The dated per-train banners that used to live here are a LOG, not
> state — they live in [archive/RELEASE_STATE_HISTORY.md](archive/RELEASE_STATE_HISTORY.md). Do NOT
> stack a new banner on this file; update the rows below in place. Static commit hashes name fixed
> points in history; the *live* `main` pointer is whatever `git rev-parse HEAD` returns at read time.

<!-- latest_release_version is enforced by check (1) to equal src-tauri/tauri.conf.json's version, so it
     means "the version THIS TREE is configured to build" — NOT "the newest published release".
     Published truth is carried separately by published_release_* below. Do not conflate them. -->
<!-- STATE:source_main_commit=abda5ce9 -->
<!-- STATE:latest_release_version=0.9.14 -->
<!-- STATE:candidate_version=0.9.14 -->
<!-- STATE:candidate_branch=main -->
<!-- STATE:candidate_published=no-unsigned-local-only -->
<!-- STATE:candidate_installed=no-pending-prove -->
<!-- STATE:aborted_source_only_release=v0.9.9-664aa5e -->
<!-- STATE:v0910_release_debris=deleted-2026-07-28 -->
<!-- STATE:v0910_source_tag=92c7608-preserved -->
<!-- STATE:v0910_local_evidence=preserved -->
<!-- STATE:published_release_version=0.9.12 -->
<!-- STATE:published_release_commit=a1be896 -->
<!-- STATE:published_release_id=364422895 -->
<!-- STATE:published_installer_sha256=07a5f638be34607af03206f1d04263a1878b219134adad8520f0ffd367d5ceea -->
<!-- STATE:published_manifest_sha256=12d7dfe9887e5827e4cf59e839977fc27e2caac4eb2c84734e6a08f5e41272de -->
<!-- STATE:release_transaction_stages=9-of-9 -->
<!-- STATE:owner_installed_version=0.9.13 -->
<!-- STATE:owner_installed_stamp=3155c7a0 -->
<!-- STATE:manifest_version=0.9.12 -->
<!-- STATE:hosted_ci=off-by-owner-decision-2026-07-16 -->
<!-- STATE:zh_cn_localization=base-and-vocabulary-on-main-d000295 -->
<!-- STATE:tester_distributed_version=0.9.0 -->
<!-- STATE:canary_status=pass-on-0.9.11 -->
<!-- STATE:public_artifact=releases-repo-public -->
<!-- STATE:code_signing=open -->
<!-- STATE:legal=open -->
<!-- STATE:capability_exception_gate=approved-2026-08-09-runtime-unchanged -->
<!-- STATE:case_intelligence_tier1=approved-design-not-built -->

| Identity | Current truth | How to re-verify |
|---|---|---|
| **Source `main` baseline** | The repair began from synchronized local/origin `main` at `92c7608` (`release: v0.9.10`) and advanced by fast-forward through the release commit `7ba5fb6` to the post-release tooling repairs (`c0fed45`). Annotated source tags are immutable: local-only `v0.9.8` → `d9ced24`; origin `v0.9.9` → `664aa5e`; origin `v0.9.10` → `92c7608`; origin `v0.9.11` → tag object `7d57446` peeling to commit `7ba5fb6`. Recovery branches for the 0.9.8 and both failed 0.9.9 candidates remain local and on origin. | `git rev-parse HEAD origin/main` · `git rev-parse v0.9.11^{commit}` · `git ls-remote --tags origin` |
| **v0.9.9 — aborted source-only release** | **Source-tagged and installed on the owner machine, but NEVER published to the fleet because the release-repository existence probe failed closed.** The publish transaction stopped at `scripts/release.ps1` immediately after pushing the source tag: an expected GitHub 404 from the releases-repo tag probe was promoted into a terminating `NativeCommandError` by Windows PowerShell 5.1. Three stages completed (source push, source tag push, releases-main lookup); six never started (releases tag, draft, asset upload, manifest, publish, verify). **Not a public release. Not republishable** — the signed receipt, installer and stamp are bound to `664aa5e`, and the pipeline requires an exact-HEAD match. Full byte-level evidence: `C:\Users\Kuya\code\compy-release-evidence\2026-07-28-v0.9.9-aborted-source-only-664aa5e\EVIDENCE.txt`. | `gh release list --repo Pootytxng/compy-releases` · `git ls-remote --tags https://github.com/Pootytxng/compy-releases.git` |
| **v0.9.10 — abandoned; release debris DELETED 2026-07-28** | The partial train created immutable source tag `v0.9.10` at `92c7608`, pushed source `main` and that tag, created a releases-repository tag and a **private draft**, uploaded installer + `latest.json`, and installed/runtime-proved 0.9.10 locally. It was **never published to the updater fleet**, and v0.9.11 superseded it. Under explicit owner authorization the abandoned **release debris was removed**: private draft release `360948018` deleted (HTTP 204, both assets with it) and releases-repository tag `v0.9.10` deleted (HTTP 204) after confirming no release depended on it — every releases-repo tag points at the same content commit `a628c9b`, so no commit was removed and no other release was affected. **Provenance is preserved and untouched:** the source tag `v0.9.10` → `92c7608` in `Pootytxng/sentinel` still exists, as do the recovery branches and the full local evidence directory `C:\Users\Kuya\code\compy-release-evidence\2026-07-28-v0.9.10-private-draft-92c7608\`. | `gh api repos/Pootytxng/compy-releases/releases --jq '[.[]\|select(.tag_name=="v0.9.10")]\|length'` (→ `0`) · `git rev-parse v0.9.10^{commit}` (→ `92c7608`) |
| **v0.9.11 — PUBLISHED (2026-07-28)** | Cut from `main` after the autonomy, native-process, resumable-transaction, simulation, and static-guard repairs, then published under owner GO. Public release id **`361056355`**, tag `v0.9.11`, `draft: false`, `prerelease: false`, published `2026-07-28T14:44:17Z`. Public installer `Compy_0.9.11_x64-setup.exe` SHA-256 **`bb2b85a43c2bf5119666f7b0709e7cee0409e0eb5ed7c4da2e4998da5438384f`**; public `latest.json` SHA-256 `6bcd6cea96bd610e8be1c44765cfc4e6f3b8c2b4e4594774251fa3cceb76b007`; both byte-match the signed receipt and the updater signature verifies against the pinned key. Releases-repository tag `v0.9.11` → `a628c9b`. The resumable transaction is **complete: 9 of 9 stages**, closing on `public_assets_verified` after the `/releases/latest/download/` aliases converged. | `gh release view v0.9.11 --repo Pootytxng/compy-releases --json id,isDraft,isPrerelease,publishedAt` · `src-tauri/target/release/bundle/nsis/release-transaction-v0.9.11.json` |
| **Configured build version (this tree)** | Carried by the `STATE:latest_release_version` anchor above — check (1) pins that anchor to `src-tauri/tauri.conf.json`'s version, and the release pipeline moves both in the same commit as the bump. This is what the tree *would* build — it is **not** a released version (published truth is the row below). Do not restate the number here; it would drift. | `grep '"version"' src-tauri/tauri.conf.json package.json` |
| **Latest PUBLISHED release + source commit** | **v0.9.12**, source `a1be896` (full `a1be896fb5853f729d77525374a4242c6672d5a8`), published tag `v0.9.12` on `Pootytxng/compy-releases`, release id `364422895`, published `2026-08-03T18:42:41Z`, `draft: false`, `prerelease: false`. Installer `Compy_0.9.12_x64-setup.exe` SHA-256 **`07a5f638be34607af03206f1d04263a1878b219134adad8520f0ffd367d5ceea`** — re-downloaded from the public alias and byte-matched against the local receipt artifact; public `latest.json` SHA-256 `12d7dfe9887e5827e4cf59e839977fc27e2caac4eb2c84734e6a08f5e41272de`. It supersedes v0.9.11 (`7ba5fb6`, id `361056355`). There is still no v0.9.8, v0.9.9, or v0.9.10 release or tag in the releases repository — the abandoned v0.9.10 draft and its tag were deleted 2026-07-28. | `gh release view --repo Pootytxng/compy-releases --json tagName,isDraft,publishedAt` · `Get-FileHash` on the re-downloaded public assets |
| **Owner-installed version + embedded stamp** | **0.9.13**, embedded stamp **`3155c7a0`** — registry `DisplayVersion` reads 0.9.13 (Windows Apps: 0.9.13). Installer `Compy_0.9.13_x64-setup.exe` SHA-256 **`3AD4C690091031E3895D24FC025AF68156A233D270C50C5AF1D6A8AB84D0BF8E`**, **installed by Claude + LIVE** 2026-08-11, carrying the quiet-launch rebuild and the full Lab evidence-map + keyboard-picker repairs (PR #102). Stamp **CDP-runtime-proved** — `get_build_stamp` invoked in the live `main` window returned `3155c7a0 · release`, the stronger of the two proofs. It supersedes the 2026-08-06 ship at `3ad6eb48` (idle-cost teardown + both scroll-park repairs). **The desk is deliberately AHEAD of the fleet:** the owner installed the published `a1be896` on 2026-08-03, then took successive local ships off post-release `main` (`c7c60d3` → `8b7c232` → `5ff6963` → `dc4d55e`, all still declaring 0.9.12, and now `ff0ce65f` declaring 0.9.13) with no new release cut — [archive/RELEASE_STATE_HISTORY.md](archive/RELEASE_STATE_HISTORY.md) records each. So this is **not** the published artifact, and it is not evidence about what any tester runs — the fleet's published truth is the row above, and it is now a **minor version behind the desk**, not just a few commits. Enforced since 2026-08-04: check (7) reads the stamp out of the installed binary, so this row can no longer drift silently the way it did on 2026-07-31. | `node scripts/verify-release-state.mjs` (check 7) · `Select-String -Path "$env:LOCALAPPDATA\Compy\compy.exe" -Pattern 3155c7a0` · HKCU uninstall `DisplayVersion` |
| **Latest updater manifest version** | **v0.9.12** — `latest.json` at `releases/latest/download/` reports `"version": "0.9.12"` and names the v0.9.12 asset (`.../releases/download/v0.9.12/Compy_0.9.12_x64-setup.exe`); the installer alias answers HTTP 200 at 5,021,579 bytes, matching the published asset exactly; the signature verifies against the pinned minisign key. | unauthenticated fetch of `latest.json` + HEAD on the installer alias + `scripts/verify-updater-signature.mjs` |
| **Hand-distributed tester version** | **0.9.0** — the `37a166c` NSIS (SHA-256 `6BC2F7DF…F5A2C4`) is what the six invitees were sent (Drive link). That remains the only hand-send; nothing has been mailed out since. | `BETA_DISTRIBUTION_RECORD.md` |
| **A0 single-tester canary** | **PASS.** A tester completed the canary through Compy's **normal public updater** and is **currently running v0.9.11**; **no updater failure was reported.** That is the whole recorded result — the tester's prior version, the update timestamp, and any per-step detail were never captured, so they are not reconstructible and must not be inferred. | owner report only |
| **Known tester installation state** | **At least two, possibly three, testers are on 0.9.12** — the owner reported on 2026-08-05 that they auto-updated to the latest published build on 2026-08-03/04, which is v0.9.12. **Two is the floor; the third and the exact identities were not captured and must not be inferred.** Separately, the canary tester was last confirmed on 0.9.11 and may be among them. The remaining invitees stay **UNKNOWN** — no telemetry, no remote inventory by design; six hold the 0.9.0 link and what each installed is owner-confirmable only. | owner report only |
| **Public artifact exposure** | **YES — `Pootytxng/compy-releases` is a PUBLIC repo.** Every updater installer + `latest.json` is unauthenticated-downloadable (required for the updater; same discoverability as a shared link). **Source repo `Pootytxng/sentinel` stays PRIVATE.** No store listing, no marketing page, no Authenticode-signed public artifact. | `gh repo view Pootytxng/compy-releases --json visibility` |
| **Code-signing status** | **OPEN** — installers are Authenticode **NotSigned**. Gates a PUBLIC (store/marketing) release, not the private-beta updater. | `Get-AuthenticodeSignature` on the NSIS |
| **Legal status** | **OPEN** — EULA + privacy are DRAFTS only. Gates a PUBLIC release. | `docs/` legal drafts |

**Bottom line:** the newest **published** release and the public updater manifest are both
**v0.9.12 (`a1be896`)**, released 2026-08-03 — it replaced v0.9.11 (`7ba5fb6`) as the fleet-visible
build. The owner box is one step ahead by design — it runs local 0.9.13 with embedded stamp
`3155c7a0`; that build is not published and is not evidence about tester state.
v0.9.12 carries the
updater/privacy truth fix (issue #59): the absolute "nothing leaves your PC" claims are gone from
the app, both locales, the legal documents and the marketing site, automatic update checks are now
switchable off in Settings → About, and `src/outbound-claim-guard.test.ts` fails the build if an
absolute offline claim ships while any outbound surface is live. The recovery provenance behind it
is intact and unaltered: v0.9.8 (`d9ced24`) owner-installed unpublished; the failed v0.9.9 candidate
(`2bd649d`) preserved; v0.9.9 (`664aa5e`) source-tagged, owner-installed, never in `compy-releases`;
v0.9.10 (`92c7608`) an immutable source tag whose abandoned **release debris (private draft
`360948018` + releases-repo tag) was deleted 2026-07-28** under owner authorization, leaving the
source tag, recovery branches and local evidence intact. Hosted Actions remain intentionally off
under the owner's $0-budget decision; local gates plus the sandboxed publish simulation are
operative. **No build has been distributed to another person by hand since the 0.9.0 link** — the
fleet reaches 0.9.12 only through the consent-first updater, and **the A0 single-tester canary
PASSED** on that path for v0.9.11: the tester updated in-app and reported no updater failure. **The
fleet path has since carried real traffic — the owner reports at least two testers auto-updated onto
0.9.12 on 2026-08-03/04.** The v0.9.12 release transaction is **complete: 9 of 9 stages**,
**no active release blocker remains, and normal product development may resume.**

## Gate matrix

> `scripts/verify-release-state.mjs` FAILS if this section, CURRENT STATE, or Release blockers is
> missing, or if the file carries zero `file:line` citations — the f21c170 diet-cut class (a doc
> trim silently gutting the live matrix) can't recur silently.

| Gate / capability | State | Source | Notes |
|---|---|---|---|
| **Gaming Mode (F1)** | **LIVE** (`true`) | `gaming_mode_gate()` — `lib.rs:521` | Flipped 2026-06-18 w/ owner sign-off. §7 QA harness passed; **GAMING_MODE_QA.md 10/10 PASSED 2026-07-14**; **owner SIGNED OFF 2026-07-14** — field-proven for 1.0. |
| **Service-suspend** | **ARMED** (`true`) | `service_suspend_gate()` — `actions.rs:2054` | Armed 2026-06-25. Live exact-restore + UAC-cancel=no-partial + critical-service block proven. Session start/restore ride the ONE batched elevation (T6/T6b). |
| **Debloat (telemetry task disable)** | **ARMED** (`true`) | `bloat_removal_gate()` — `actions.rs:2127` | Armed 2026-06-26. Live exact disable→enable restore + off-list/Defender rejected. |
| **Benchmark tweak A/B trial** | **LIVE / UI-reachable, NO dedicated gate** | `start_tweak_trial` — `benchmark_trial.rs:170` | REAL mutation via the audited `apply_recommendation` path, protected by a `RollbackGuard` (auto-rollback on every exit). |
| **Preload-app removal** | **DARK** (`false`) | `preload_removal_gate()` — `actions.rs:2276` | Built dark 2026-07-06. Command refuses while dark; FE renders nothing. Arming needs live remove→reinstall QA + owner sign-off. |
| **Aggregate-stack A/B trial (§2a)** | **DARK** (`false`) | `stack_trial_gate()` — `benchmark_trial.rs:274` | Built dark 2026-07-09 (reuses audited batch path; multi-change Drop-guard rollback; corrupt-ledger read ABORTS pre-mutation). No FE surface. |
| **Experiment engine + simulator (Intelligence P3)** | **ARMED** (`true`, 2026-07-17) | `experiment_gate()` — `experiment.rs:55` | Armed after owner sign-off + live apply→rollback round-trip. No new mutation primitive; resolve stays history-only; simulator reads catalog READ-ONLY. |
| **Leftovers restore** | **ARMED** (`true`, 2026-07-16) | `restore_gate()` — `leftovers.rs:730` | Armed after owner-present live-UAC QA (3 loops PASS); receipts ride the Trust Ledger (`leftover_adopted`). |
| **Receipts telemetry** | **DARK** (`false`) | `receipts_gate()` — `receipts.rs:18` | No send path/endpoint/queue; preview refuses. Arming = its own security review + owner sign-off. |
| **License / Pro enforcement** | **DISARMED — nothing enforced** | `licensing_armed()` — `license.rs:40` (all-zeros key) | Plumbing wired but inert; `ProGate` renders everything free. No Windows mutation, no phone-home. |
| **Signed remote rules / fetch** | **OFF** (`false`) | `remote_fetch_enabled()` — `remote_rules.rs:97`; all-zeros pubkey `remote_rules.rs:85` | Double-gated: `verify_chain` (`remote_rules.rs:231`) hard-fails on the placeholder key. Never runs in shipped builds. |
| **Compy Care case intelligence — Tier 1** | **OWNER-APPROVED DIRECTION; NOT BUILT / NO RUNTIME TRAFFIC** | issue [#91](https://github.com/Pootytxng/sentinel/issues/91) · `docs/ARCHITECTURE_LOCKS.md` §1.8 | Planned as a separate Rust-side, signed, pull-only advisory catalog matched locally against existing crash incidents. Separate key/schema/domain/cache from privileged remote rules; no machine-derived upload; no CSP widening. Dark implementation may begin only after PR #90 is merged/dispositioned. Exact endpoint, signing custody, disclosure and runtime arming remain later review points. |
| **Auto-updater** | **LIVE** (2026-07-22, owner-directed) | `plugins.updater` — `tauri.conf.json:73` (pubkey `:75`, endpoints `:76`); `tauri-plugin-updater` — `Cargo.toml:37`; capability `capabilities/updater.json` (main window ONLY, `updater:allow-check` + `allow-download-and-install`) | Consent-first: check on launch + every 4h; nothing downloads until the user clicks Update now. **Automatic checks are switchable OFF (2026-08-03)** — Settings → About → Automatic update checks (`compy_update_autocheck`, default ON); off means no launch check and no interval, with "Check now" still available. Signature verification is unaffected by the switch. Minisign-verified against the pinned key before install; private key outside the repo. **E2E-witnessed 0.9.4→0.9.7 this session** (CDP stamp transitions, no reinstall between); GitHub asset counters corroborate. |
| **Hosted CI (GitHub Actions)** | **OFF — by standing owner decision (2026-07-16), now enforced in the workflow files themselves (2026-08-10); not a defect and not an open owner obligation** | `ci.yml` + `ci-health.yml` are `workflow_dispatch:` only · `audit.yml` weekly · `deploy-site.yml` path-scoped · guard `scripts/ci-budget-guard.test.mjs` | **Corrected 2026-08-10 — the old claim "workflows present but never start" was false.** The monthly included minutes reset on 1 Aug and CI ran **111 real times in six days** (~570/month, against a budget guard that assumed 122), exhausting them again by ~06:00 UTC on 7 Aug; every job since is rejected before runner startup. Cause was run VOLUME from the parallel agent lanes, not per-run cost. Nothing now starts itself, so the decision holds by construction rather than by the account being blocked. **GitHub's rejection annotation mentions failed payments — it is generic and wrong here:** no failed payment, billed $0, deliberate $0 Actions budget with stop-usage on. The owner declined the spend under the zero-budget law and directed that it never be re-asked. **The everyday gate is now `npm run verify:local`** (`scripts/verify-local.ps1`, wired via `.githooks/pre-push`, pinned by `scripts/local-gate-guard.test.mjs`). **The full gate set runs locally instead** (encoding guard · release-state verifier · hook self-tests · doc budget · tsc · vitest · frontend build · cargo test · clippy `-D warnings` · release-pipeline guards · updater-signature verify). A red/absent CI badge is the expected steady state. |
| **zh-CN localization** | **Base AND verdict vocabulary both MERGED on `main` (`d000295`)** | `src/i18n/locales/zh-CN/` · guard `src/i18n/zh-cn-verdict-vocabulary-guard.test.ts` | The zh-CN base translation and the verdict-chip vocabulary finish (真有效 / 安慰剂 / 有风险 — 已拒绝, integrated from `2461106`) are both on `main` — nothing zh-CN is pending a merge. The guard test pins the vocabulary. |
| **Outbound network** | **ONE surface: signed update check/download** (2026-07-22) | `tauri-plugin-updater` (`Cargo.toml:37`) fetches the pinned endpoint (`tauri.conf.json:76`) Rust-side; **production CSP `connect-src` UNCHANGED** (`tauri.conf.json:47` — `'self' ipc:`; no webview-reachable HTTP) | Supersedes the 2026-07-11 zero-outbound audit BY OWNER DECISION. Receipts + remote-rules fetch stay dark; Tier 1 case intelligence is approved design only and has no runtime module or endpoint; Export leaves only by the user's hand. **Copy/doc truth closed 2026-08-03:** the absolute "nothing leaves your PC" claims that survived the 2026-07-22 arming are gone from both locales, `docs/PRIVACY.md` is at v0.3, and `src/outbound-claim-guard.test.ts` now fails the build if any absolute offline claim ships while ANY outbound surface is live (was receipts-only, which is why the updater arming fired nothing). |
| **Local support evidence (Q5)** | **BACKEND + UI ON `main`, no gate flag — the record is always written. SIGNED OFF 2026-08-04:** the surface's visual self-review PASSed on the installed `5ff6963` release build (9/9 rubric items, live captures at the owner's real resolution). The first review FAILed item 6 — the always-visible meta line rendered the internal `<path>` redaction mask as if it were a location, because the location went through the same aggressive `redact_paths()` as free-text detail; `display_location` now emits `%APPDATA%\Compy\support`, pinned by a Rust guard **and** by `SupportEvidence.test.tsx`'s "names a location the user can open" test. One noted non-defect: **clear** is not preview-gated the way **export** is — it substitutes a stated consequence plus a two-step confirm (pre-existing design, unchanged). | `record` — `support_evidence.rs:408`; caps `MAX_BYTES` — `support_evidence.rs:58`; `preview_support_evidence` — `support_evidence.rs:692`, `export_support_evidence` — `support_evidence.rs:718`, `clear_support_evidence` — `support_evidence.rs:755`; `SupportEvidence` — `SupportEvidence.tsx:26` | Bounded rotating JSONL at `%APPDATA%\Compy\support\evidence.jsonl` — a NEW data location, hard-capped at 400 records / 250 KiB (`MAX_EVENTS × MAX_RECORD_BYTES`), redacted at write **and** again at export. **Not a new outbound surface:** there is no transport at all; export writes a file the user hands over by their own action, and `src/support-evidence-outbound-guard.test.ts` fails the build if a send path appears. Export is preview-gated in Rust (refuses until `preview_support_evidence` ran this session); the UI mirrors that by not rendering the save control until a preview returns. Published caps in `docs/PRIVACY.md` + `site/privacy.html` are pinned to the constants by `src/privacy-data-dir-guard.test.ts`. |

## Mutation safety posture (unchanged LOCKED rules)

- Current runtime ships no Compy driver and performs no game/process injection. The policy default
  remains user-mode/non-invasive; any kernel exception requires the Capability Exception Gate.
  Rollback-first + typed mutation allowlist remain unchanged
  (`KnownService`/`KnownBloatTask`/`AppliedAction`/`RollbackAction`/`Snapshot`, unknown inputs rejected).
- **ONE mutation boundary, mechanically enforced (2026-08-03):** every Windows change goes through
  `src-tauri/src/actions.rs`. `src/mutation-boundary-guard.test.ts` walks all of `src-tauri/src` and
  fails the build on a registry write, service/task change, power-plan switch or package removal
  anywhere else — `game_mode_persist.rs` is the one reasoned exception (re-asserts a change the
  ledger already owns), and copy that merely NAMES a command carries a greppable
  `mutation-boundary-allow` marker. Written after `set_startup_entry_enabled` was found writing
  `StartupApproved\Run` from `lib.rs` with a SYNTHESISED value that destroyed Windows' timestamp
  bytes; that command now routes through `Snapshot::StartupApproval` →
  `AppliedAction::SetStartupEntryEnabled` → `RollbackAction::RestoreStartupApprovalFromSnapshot`,
  refuses when the prior value is unreadable, and preserves every byte after the state flag.
- **ONE command authority, mechanically enforced (Q2, 2026-08-03):** custom commands no longer
  default to every window. `build.rs` declares all 91 via `tauri_build::AppManifest::commands`;
  `capabilities/default.json` is main-window-only and `capabilities/overlay.json` grants the
  telemetry overlay exactly its three sensor reads. Before this, the overlay held authority over all
  91 — including apply, rollback, license-key and the update-restart barrier — because custom
  commands were not in the capability system at all, which is why capability files that were
  otherwise least-privilege never showed it. `src/command-authority-guard.test.ts` keeps the
  registration, the declaration, the grants and the overlay's real `invoke()` sites in agreement.
  Owner GO given 2026-08-03. **Open sub-item:** the spec's per-command main-window caller check
  (defense in depth behind the ACL) is deliberately deferred — see the PR for the reasoning.
- Rollback resolves from `history.json` alone, never the live catalog (`resolve_rollback` — `actions.rs:4657`).
- Ledger save is crash-safe atomic temp-write+rename, test-pinned (`save_history_to` — `history.rs:377`).
- Elevation: relaunch `compy.exe --run-elevated <hex> <ticket>` (windowless), 4-way honest UAC
  attribution (`elevation_outcome` — `actions.rs:989`); helper runs ONLY hex byte-matching the
  one-time ticket (`mint_elevation_ticket` — `actions.rs:1174`).
- Gaming-session advanced tier batches to ONE elevation per session start and per restore
  (`apply_elevated_tier` — `gaming_orchestrator.rs:202`); no-partial abort+restore contract;
  UAC-decline drops only verifiably-never-ran staged entries (`elevation_error_nothing_ran` — `actions.rs:1013`).

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

**No active blocker remains on the v0.9.12 release train** — it is complete 9/9, the v0.9.11 canary
passed on the same updater path, and the debris is cleared, so **normal product development may
resume.** Every row still marked OPEN above gates a *future* PUBLIC (store/marketing) release or the
arming of a dark feature; none of them blocks the shipped v0.9.12 build or the work that follows it.

**⚠️ VERSION DEBT — half paid 2026-08-06. The manifests now declare 0.9.13; the SIGNED cut does not
exist yet.** The bump landed in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`,
so the ledger-honesty fixes (`dc4d55e` and later) and the idle-cost teardown are no longer trapped
behind a version the updater will not offer. What is still owed is the *publish*: a build made **with**
`TAURI_SIGNING_PRIVATE_KEY` (owner-held; the local dev build above is deliberately unsigned, and tauri
fails the updater-artifact step without it — expected, not a defect), then the normal publish GO/NO-GO.
Until that runs, the fleet stays on published v0.9.12 and no 0.9.13 reaches a tester.

## Required owner decisions (live)

1. **Publish GO/NO-GO for v0.9.14** — the marathon Train 4 decision (fleet publish at week's end,
   `claude/COMPY_MARATHON_PLAN.md`). Candidate v0.9.14 carries Train 1 (the add-a-part form mounted
   in the Lab's own chrome — the first ship where a user can add the PSU or cooler Compy admits it
   cannot read) on top of everything below that v0.9.13 already carried over published v0.9.12.
   Prior decision text, still operative for the publish itself:
   **(carried from v0.9.13)** — the tree declares 0.9.13 as of 2026-08-06 and the build runs
   locally, but a *publishable* one needs `TAURI_SIGNING_PRIVATE_KEY`, which is owner-held and never
   enters this repo. So the cut cannot be made without him: signed build → publish → the fleet's
   updater sees a higher number and offers it. What it would carry over published v0.9.12: the
   ledger-honesty fixes (`dc4d55e` and later) and the idle-cost teardown (idle CPU, measured — see
   `docs/perf/q7-baseline.json`). Carried forward from the v0.9.12 decision, still open and still
   owner territory: **whether/when the remaining invitees move onto the updater-enabled build.** The
   v0.9.11 canary PASSED on the normal updater path, which was the stated precondition for widening,
   and at least two testers auto-updated onto v0.9.12 unaided.
2. Code-signing route + legal finalization (PUBLIC gates).
3. When/whether to arm Receipts (its own security review + owner sign-off).
4. Tier 1 case-intelligence direction is approved. Do not re-ask that product decision; bring back
   only the exact endpoint, signing custody, disclosure, security review and measured dark/canary
   evidence required to arm real traffic.

**Closed 2026-07-28:** the v0.9.10 private-draft cleanup decision — the owner authorized deletion and
the abandoned release debris (draft `360948018` + releases-repo tag `v0.9.10`) is gone; source tag,
recovery branches and local evidence were preserved. It is no longer an open decision.

**Not** an owner decision: hosted CI. It is settled OFF under the 2026-07-16 zero-budget decision and
must never be surfaced as an open obligation — see the Gate matrix row.

## Snapshot history — in archive

The full reverse-chronological banner log (every dated train, byte-preserved) lives in
[archive/RELEASE_STATE_HISTORY.md](archive/RELEASE_STATE_HISTORY.md). APPEND new dated banners to the
TOP of the archive; keep THIS file to CURRENT STATE only (budget: 300 lines, `scripts/doc-budget.ps1`).
