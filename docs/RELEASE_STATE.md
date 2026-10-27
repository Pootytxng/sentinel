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
<!-- STATE:source_main_commit=71b8e1b9 -->
<!-- STATE:latest_release_version=0.9.26 -->
<!-- STATE:candidate_version=0.9.26 -->
<!-- STATE:candidate_branch=main -->
<!-- STATE:candidate_published=yes-2026-08-19 -->
<!-- STATE:candidate_installed=yes-owner-desk -->
<!-- STATE:aborted_source_only_release=v0.9.9-664aa5e -->
<!-- STATE:v0910_release_debris=deleted-2026-07-28 -->
<!-- STATE:v0910_source_tag=92c7608-preserved -->
<!-- STATE:v0910_local_evidence=preserved -->
<!-- STATE:published_release_version=0.9.26 -->
<!-- STATE:published_release_commit=5e64074c -->
<!-- STATE:published_release_id=372920800 -->
<!-- STATE:published_installer_sha256=4b72d68120f2a2601d87b814accdb25c0e18b20aa79adb63c9040bf9a9294e98 -->
<!-- STATE:published_manifest_sha256=c9d3347063da8b8946e694e6947a61f5743df420fb096979ccf4a6d6e3ea48b1 -->
<!-- STATE:release_transaction_stages=9-of-9 -->
<!-- STATE:owner_installed_version=0.9.26 -->
<!-- STATE:owner_installed_stamp=71b8e1b9 -->
<!-- STATE:desk_fleet_relation=desk-ahead -->
<!-- STATE:manifest_version=0.9.26 -->
<!-- STATE:hosted_ci=off-by-owner-decision-2026-07-16 -->
<!-- STATE:zh_cn_localization=base-and-vocabulary-on-main-d000295 -->
<!-- STATE:tester_distributed_version=0.9.0 -->
<!-- STATE:canary_status=pass-on-0.9.11 -->
<!-- STATE:public_artifact=releases-repo-public -->
<!-- STATE:code_signing=open -->
<!-- STATE:legal=open -->
<!-- STATE:capability_exception_gate=approved-2026-08-09-runtime-unchanged -->
<!-- STATE:case_intelligence_tier1=built-dark-2026-08-25-three-locks-nothing-armed -->

| Identity | Current truth | How to re-verify |
|---|---|---|
| **Source `main` baseline** | The repair began from synchronized local/origin `main` at `92c7608` (`release: v0.9.10`) and advanced by fast-forward through the release commit `7ba5fb6` to the post-release tooling repairs (`c0fed45`). Annotated source tags are immutable: local-only `v0.9.8` → `d9ced24`; origin `v0.9.9` → `664aa5e`; origin `v0.9.10` → `92c7608`; origin `v0.9.11` → tag object `7d57446` peeling to commit `7ba5fb6`. Recovery branches for the 0.9.8 and both failed 0.9.9 candidates remain local and on origin. | `git rev-parse HEAD origin/main` · `git rev-parse v0.9.11^{commit}` · `git ls-remote --tags origin` |
| **v0.9.9 / v0.9.10 / v0.9.11 — the July release-repair arc** | Spent history, not current state: an aborted source-only release, an abandoned train whose debris was deleted, and the first clean publish after the repairs. All three rows are byte-preserved in [archive/RELEASE_STATE_HISTORY.md](archive/RELEASE_STATE_HISTORY.md). The fleet has been **v0.9.26** since 2026-08-19. | `git tag -l 'v0.9.*'` · the archive file |
| **Configured build version (this tree)** | Carried by the `STATE:latest_release_version` anchor above — check (1) pins that anchor to `src-tauri/tauri.conf.json`'s version, and the release pipeline moves both in the same commit as the bump. This is what the tree *would* build — it is **not** a released version (published truth is the row below). Do not restate the number here; it would drift. | `grep '"version"' src-tauri/tauri.conf.json package.json` |
| **Latest PUBLISHED release + source commit** | **v0.9.26**, source `5e64074c`, published tag `v0.9.26` on `Pootytxng/compy-releases`, release id **`372920800`**, published `2026-08-19T09:14:02Z` under owner GO (chat, 2026-08-19 — "the fleet-move GO"), `draft: false`, `prerelease: false`. Installer `Compy_0.9.26_x64-setup.exe` SHA-256 **`4b72d68120f2a2601d87b814accdb25c0e18b20aa79adb63c9040bf9a9294e98`**; public `latest.json` SHA-256 `c9d3347063da8b8946e694e6947a61f5743df420fb096979ccf4a6d6e3ea48b1` — both byte-match the signed receipt, the updater signature verifies against the pinned key, transaction **complete 9 of 9** closing on `public_assets_verified` (**stage counts here are NOT re-verifiable — see #199**), and the `/releases/latest/download/` alias converged on **attempt 1 in 3.7s**. **It carried the three-lane backlog to the fleet**: the fleet now has the `data_root.rs` canonical-root resolver, the Q9c CPU-temp offer, the C-10/C-11/C-17 conformance work and the **#127 idle-CPU fix** (whole-app idle on Home **19.632 → 10.483 percent of one core**; method, evidence files and stated scope are in the owner-installed row below). Four latent release-pipeline defects were found and fixed by this run itself — a stale receipt bound to an older commit now reports PENDING rather than FAIL, and a dot-sourced library no longer makes the whole pipeline strict-mode. It supersedes **v0.9.25**, source `efde8310`, release id **`370249321`**, published `2026-08-13T22:34:15Z` — a stability release whose two items were both found by people rather than by the suite (the update-pill `box-shadow` repaint, and a written feedback draft vanishing on leaving Settings), installer SHA-256 `72a04a15c56c72369e4e1fd7a82b0aba5bf9f3acfbc143c928e2aeed73db2203`, `latest.json` SHA-256 `cb1c18f72542cce8680762119f79a1b499fc67995d1a7410a1026b1cc0ef34dc`, transaction 9 of 9, alias attempt 1. It supersedes **v0.9.18** (`cfc0c4b7`, id `369720195`) and the full v0.9.17 → v0.9.11 published chain, byte-preserved in [archive/RELEASE_STATE_HISTORY.md](archive/RELEASE_STATE_HISTORY.md) — including the standing caution that **a stale alias read is not drift** (the `/releases/latest/download/` alias can serve an edge-cached body for minutes; re-fetch with a cache-buster before calling it wrong). No v0.9.8, v0.9.9, v0.9.10, v0.9.13, v0.9.14 or v0.9.16 release exists — those were desk-only or abandoned. | `gh release view --repo Pootytxng/compy-releases --json tagName,isDraft,publishedAt` · `Get-FileHash` on the re-downloaded public assets |
| **Owner-installed version + embedded stamp** | **0.9.26 desk build, embedded stamp `71b8e1b9`** — built 2026-10-27 (about 07:00 local) from `main` itself at `71b8e1b9` (`docs(work-train): verification receipt for ac58379a`, after the P4-exit-truth-f3 merge `3de75240`), in the main checkout, via `npm run tauri build` then `scripts/ship-reinstall.ps1 -VerifyRuntime -ExpectedCommit 71b8e1b9…`. Installer `Compy_0.9.26_x64-setup.exe` SHA-256 **`A7E858DA587486B511FC2D83A79C297490C3AB43E989DAE8B31CF8CED4080EBE`**. **Live == build proved by the embedded stamp** — runtime proof `71b8e1b9 · release · shell 0.9.26`, proof attempt 1 of 1; installed version 0.9.26. Pushed to GitHub first (`cdf0c2d8..71b8e1b9`, pre-push gate passed); the tree carries a clean full-suite receipt (tsc 0; vitest 521 files / 10020 tests). **Visible delta vs `9712572d`:** Care timeline and "Did this help?" lines in the viewer's language (P6-changed-f1, P6-next-f3); a shown stutter step stays the next step and compares rigs by hardware (P6-next-f2); a hurt change that was put back is not red Critical (P7-severity); Home interview answers land on the journey that answers them (P7-route); the four truthful-completion rounds (P4-exit-truth, -f1, -f2, -f3): an attempt is not a test, a stale or unverified result is not a current one, the newest session is "now", completion is counted per change, one retest budget across every unusable attempt, the retest headline names the reasons present, the context line is "Last recorded context (<date>)", and Home says "testing is off" / "couldn't read" instead of "nothing measured". Installed for the owner-and-friend walkthrough. UNDISTRIBUTED, unsigned by construction (`TAURI_SIGNING_PRIVATE_KEY` absent; the build's final step errors after both bundles are written). It supersedes **`9712572d`** (installed 2026-10-25 about 14:45, after P6-unknown), whose row is byte-preserved in [archive/RELEASE_STATE_HISTORY.md](archive/RELEASE_STATE_HISTORY.md). | `node scripts/verify-release-state.mjs` (check 7) · `Select-String -Path "$env:LOCALAPPDATA\Compy\compy.exe" -Pattern 71b8e1b9` · HKCU uninstall `DisplayVersion` — **both from a non-containerized session only** (a packaged host sees `%LOCALAPPDATA%`/`HKCU` through an overlay) |
| **Latest updater manifest version** | **v0.9.26** — `latest.json` at `releases/latest/download/` reports `"version": "0.9.26"` and names the v0.9.26 asset; the body byte-matches the signed receipt (`c9d3347063da8b8946e694e6947a61f5743df420fb096979ccf4a6d6e3ea48b1`) and the signature verifies against the pinned minisign key. The alias was re-read and verified at publish time on the first attempt (3.7s). Its notes are written for TESTERS, not the repo, and render as the in-app **What's new** list. | unauthenticated cache-busted fetch of `latest.json` + `scripts/verify-updater-signature.mjs` |
| **Hand-distributed tester version** | **0.9.0** — the `37a166c` NSIS (SHA-256 `6BC2F7DF…F5A2C4`) is what the six invitees were sent (Drive link). That remains the only hand-send; nothing has been mailed out since. | `BETA_DISTRIBUTION_RECORD.md` |
| **A0 single-tester canary** | **PASS.** A tester completed the canary through Compy's **normal public updater** and is **currently running v0.9.11**; **no updater failure was reported.** That is the whole recorded result — the tester's prior version, the update timestamp, and any per-step detail were never captured, so they are not reconstructible and must not be inferred. | owner report only |
| **Known tester installation state** | **At least two, possibly three, testers are on 0.9.12** — the owner reported on 2026-08-05 that they auto-updated to the latest published build on 2026-08-03/04, which is v0.9.12. **Two is the floor; the third and the exact identities were not captured and must not be inferred.** Separately, the canary tester was last confirmed on 0.9.11 and may be among them. The remaining invitees stay **UNKNOWN** — no telemetry, no remote inventory by design; six hold the 0.9.0 link and what each installed is owner-confirmable only. | owner report only |
| **Public artifact exposure** | **YES — `Pootytxng/compy-releases` is a PUBLIC repo.** Every updater installer + `latest.json` is unauthenticated-downloadable (required for the updater; same discoverability as a shared link). **Source repo `Pootytxng/sentinel` stays PRIVATE.** No store listing, no marketing page, no Authenticode-signed public artifact. | `gh repo view Pootytxng/compy-releases --json visibility` |
| **Code-signing status** | **OPEN** — installers are Authenticode **NotSigned**. Gates a PUBLIC (store/marketing) release, not the private-beta updater. | `Get-AuthenticodeSignature` on the NSIS |
| **Legal status** | **OPEN** — EULA + privacy are DRAFTS only. Gates a PUBLIC release. | `docs/` legal drafts |

**Bottom line:** the newest **published** release and the public updater manifest are both
**v0.9.26 (`5e64074c`)**, published 2026-08-19T09:14Z under owner GO ("the fleet-move GO"). **The
owner's desk does NOT run those bytes.** It runs a newer, unreleased v0.9.26 desk build stamped
**`71b8e1b9`** (built and installed 2026-10-27 from `main` itself, after P4-exit-truth-f3; its full delta is in the owner-installed
row above, and everything earlier is carried forward).
The earlier desk rows, `9712572d`, `7aa8e810`, `f6736154`, `791babf2`, `2afd7471`, `d4de0021`, `9470b437`, `e9727c04`, `a76e4189`, `d7fed835`, `c82440a1`, `090bc58b`, `73b629ed`, `380f98ca`, `1703be9f`, `b21bc18b` and `72efd7e6`
included, are byte-preserved in [archive/RELEASE_STATE_HISTORY.md](archive/RELEASE_STATE_HISTORY.md).
**Installing is not releasing** — nothing was published). Same
version number, different commit — never read byte equivalence out of a matching version string.
It replaced v0.9.25 (`efde8310`), which replaced v0.9.24 (`289c658d`), v0.9.18 (`cfc0c4b7`),
v0.9.17 (`a614744c`), v0.9.15 (`1b437785`) and v0.9.12 (`a1be896`) as the fleet-visible build.
Versions and stamps are carried by the anchors and the rows above, not restated here. v0.9.26 is the
first fleet build carrying the **#127 idle-CPU fix** (idle on Home 19.632 → 10.483 percent of one
core), the `data_root.rs` canonical-root resolver, the Q9c CPU-temp offer and the C-10/C-11/C-17
conformance work. v0.9.24 was the first carrying the **design foundation**: step ① TYPE-1 + COLOR-1
(six-step type scale with a 13px floor, rooms give up their hue so green/amber/blue mean one thing
app-wide) and step ② **UX-1 — the front door is a verdict + one action**, plus the update-pill
attention state, the in-app What's-new list and the arc-gauge ring-overflow fix.
**v0.9.19–v0.9.23 were never published:** desk-only or burned by failed re-prepares. Two of those
desk builds were caught by LOOKING at them (v0.9.19's ring overflow, v0.9.23's undersized verdict),
neither by a test. What is *offered* is not what is taken — no tester is known to have updated past
0.9.12 yet, and this is a six-number jump for whoever takes it.
The v0.9.12 updater/privacy fix and the v0.9.8–v0.9.10 recovery provenance are in [archive/RELEASE_STATE_HISTORY.md](archive/RELEASE_STATE_HISTORY.md). Remote Actions execution is currently
unavailable (jobs refused before runner startup under the $0 budget); the local gate is the proof
authority, and the sandboxed publish simulation is operative. **No build has been distributed to another person by hand since the 0.9.0 link** — the
fleet reaches every build only through the consent-first updater, and **the A0 single-tester canary
PASSED** on that path for v0.9.11: the tester updated in-app and reported no updater failure. **The
fleet path has since carried real traffic — the owner reports at least two testers auto-updated onto
0.9.12 on 2026-08-03/04.** The v0.9.15 release transaction is **complete: 9 of 9 stages** (**NOT re-verifiable — see #199**),
**no active release blocker remains, and normal product development may resume.**

## Gate matrix

> `scripts/verify-release-state.mjs` FAILS if this section, CURRENT STATE, or Release blockers is
> missing, or if the file carries zero `file:line` citations — the f21c170 diet-cut class (a doc
> trim silently gutting the live matrix) can't recur silently.

| Gate / capability | State | Source | Notes |
|---|---|---|---|
| **Gaming Mode (F1)** | **LIVE** (`true`) | `gaming_mode_gate()` — `lib.rs:595` | Flipped 2026-06-18 w/ owner sign-off. §7 QA harness passed; **GAMING_MODE_QA.md 10/10 PASSED 2026-07-14**; **owner SIGNED OFF 2026-07-14** — field-proven for 1.0. |
| **Service-suspend** | **ARMED** (`true`) | `service_suspend_gate()` — `actions.rs:2280` | Armed 2026-06-25. Live exact-restore + UAC-cancel=no-partial + critical-service block proven. Session start/restore ride the ONE batched elevation (T6/T6b). |
| **Debloat (telemetry task disable)** | **ARMED** (`true`) | `bloat_removal_gate()` — `actions.rs:2353` | Armed 2026-06-26. Live exact disable→enable restore + off-list/Defender rejected. |
| **Benchmark tweak A/B trial** | **LIVE / UI-reachable, NO dedicated gate** | `start_tweak_trial` — `benchmark_trial.rs:183` | REAL mutation via the audited `apply_recommendation` path, protected by a `RollbackGuard` (auto-rollback on every exit). |
| **Preload-app removal** | **DARK** (`false`) | `preload_removal_gate()` — `actions.rs:2566` | Built dark 2026-07-06. Command refuses while dark; FE renders nothing. Arming needs live remove→reinstall QA + owner sign-off. |
| **Aggregate-stack A/B trial (§2a)** | **DARK** (`false`) | `stack_trial_gate()` — `benchmark_trial.rs:280` | Built dark 2026-07-09 (reuses audited batch path; multi-change Drop-guard rollback; corrupt-ledger read ABORTS pre-mutation). No FE surface. |
| **Experiment engine + simulator (Intelligence P3)** | **ARMED** (`true`, 2026-07-17) | `experiment_gate()` — `experiment.rs:59` | Armed after owner sign-off + live apply→rollback round-trip. No new mutation primitive; resolve stays history-only; simulator reads catalog READ-ONLY. |
| **Leftovers restore** | **ARMED** (`true`, 2026-07-16) | `restore_gate()` — `leftovers.rs:730` | Armed after owner-present live-UAC QA (3 loops PASS); receipts ride the Trust Ledger (`leftover_adopted`). |
| **Receipts telemetry** | **DARK** (`false`) — **path BUILT 2026-08-25** | `receipts_gate()` — `receipts.rs:28` | Q9a (#217) built the Tier 2 path dark: receiver `functions/api/usage.ts` (D1 `compy_reports`, no per-row ip_hash, rate hash self-deletes in 1h), sender `receipts.rs` (`send_decision` refuses in order gate → disclosure → opt-in; `post_receipt` via the crate's one `reqwest`), consent store `receipts-consent.json`. Receiver **DEPLOYED 2026-08-25** (`compy_reports` migration 0001 applied, `IP_PEPPER` set; `/api/usage` answers GET 405, junk POST 400) and **empty** — standing it up before the arming commit is the sequence it was designed around. **Gate still hard-false — nothing sends, preview refuses.** Sharing is **opt-in, default OFF even after arming** (#207). Disclosed ahead of arming in `PRIVACY.md` v0.6. Arming = its own security review + owner sign-off. |
| **License / Pro enforcement** | **DISARMED — nothing enforced** | `licensing_armed()` — `license.rs:40` (all-zeros key) | Plumbing wired but inert; `ProGate` renders everything free. No Windows mutation, no phone-home. |
| **Signed remote rules / fetch** | **OFF** (`false`) | `remote_fetch_enabled()` — `remote_rules.rs:97`; all-zeros pubkey `remote_rules.rs:85` | Double-gated: `verify_chain` (`remote_rules.rs:231`) hard-fails on the placeholder key. Never runs in shipped builds. |
| **Compy Care case intelligence — Tier 1** | **BUILT DARK AND ON `main` 2026-08-26, PR [#221](https://github.com/Pootytxng/sentinel/pull/221) / #220 (`d83c6f04`) — NO RUNTIME TRAFFIC, NOTHING ARMED.** Its DISCOVERY half — the Home Care entry — **SHIPPED 2026-08-12**, and its LOCAL half — the exact-incident deep-link plus the persisted incident observer (plan tasks 8–9) — **ON `main` 2026-08-26, PR [#223](https://github.com/Pootytxng/sentinel/pull/223) / #222 (`0e8f7835`)** | issue [#91](https://github.com/Pootytxng/sentinel/issues/91) · `docs/ARCHITECTURE_LOCKS.md` §1.8 · `homeCareEntry` — `home-intake-data.ts:63`; observer `src-tauri/src/incident_observer.rs`; guards `src/surfaces/care-home-route-guard.test.ts` + `src/care-incident-observer-contract.test.ts` | **What shipped is the visible half ONLY: a Home Care entry ("Crash & Freeze Rescue") that always renders, independent of the Home interview flag `compy_home_interview` in every state including the `"0"` failsafe (and, before 2026-08-20, of the deleted `compy_home_intake` band), and deep-links to the existing local crash-evidence station.** It reads nothing new, sends nothing, and adds no module — it is a sign pointing at a reader Compy already had. The crash door was previously an intake ROW, so switching the optimization band off in Settings switched crash rescue off with it; extracting it fixed that and removed the duplicate door. **The dark half now EXISTS and is unreachable.** `case_intelligence.rs` carries the schema, trust root, cache, matcher and pull path, and `KnownIssueBlock` (`src/surfaces/BlackBox.tsx`) is its only visible surface — attached to a crash incident as an optional field that a shipped build omits entirely. **Three INDEPENDENT locks, any one of which refuses on its own:** `case_intelligence_gate()` is hard-false · `CASE_SIGNING_PUBKEY` is an all-zero placeholder · `CASE_CATALOG_ENDPOINTS` **and** `CASE_CATALOG_ORIGINS` are both empty, so there is nowhere to ask and nowhere a manifest may point. A local deny-only `fetch-disabled` file refuses on top of that; its ABSENCE enables nothing. `refresh_case_catalog` is not registered as a command and nothing calls it. Self-reviewed PASS 12/12 on the fixture rig (the block is unreachable in any build). **The observer is LOCAL, not outbound, and is not part of the dark half:** it reads Windows' own crash record through the existing Black Box path on three named moments (launch · main-window foreground · session finalized) and **no timer, service, scheduled task, watcher or poll exists**; it persists one small JSON file, mints no identity, states no cause, and its dismiss deletes no Windows record. **Arming is plan tasks 10–11 and remains owner territory.** Separate key/schema/domain/cache from privileged remote rules; no machine-derived upload; no CSP widening. Exact endpoint, signing custody, disclosure and runtime arming remain later review points, all of them owner territory and filed in `docs/OWNER_ACTION_CHECKLIST.md` §C. |
| **Auto-updater** | **LIVE** (2026-07-22, owner-directed) | `plugins.updater` — `tauri.conf.json:73` (pubkey `:75`, endpoints `:76`); `tauri-plugin-updater` — `Cargo.toml:37`; capability `capabilities/updater.json` (main window ONLY, `updater:allow-check` + `allow-download-and-install`) | Consent-first: check on launch + every 4h; nothing downloads until the user clicks Update now. **Automatic checks are switchable OFF (2026-08-03)** — Settings → About → Automatic update checks (`compy_update_autocheck`, default ON); off means no launch check and no interval, with "Check now" still available. Signature verification is unaffected by the switch. Minisign-verified against the pinned key before install; private key outside the repo. **E2E-witnessed 0.9.4→0.9.7 this session** (CDP stamp transitions, no reinstall between); GitHub asset counters corroborate. |
| **Hosted CI (GitHub Actions)** | **Remote execution UNAVAILABLE — every job is refused before runner startup (since ~06:00 UTC 2026-08-07); the local gate is the proof authority. Not a defect and not an open owner obligation: the $0 Actions budget (owner, 2026-07-16) stands and is not to be re-asked** | `ci.yml` + `ci-health.yml` are `workflow_dispatch:` only · `audit.yml` weekly · `deploy-site.yml` path-scoped · guard `scripts/ci-budget-guard.test.mjs` · availability measured by `scripts/actions-health.mjs` (row below) | **Corrected 2026-09-02 — "nothing now starts itself" (the 2026-08-10 wording) was false:** `audit.yml` still starts on its weekly schedule, is refused, and its `continue-on-error` job reports the run as **success with 0 steps** — so a green workflow status here is NOT evidence its job ran, and a red/absent badge is not the only steady state. How the minutes were exhausted (111 real runs in six days from the parallel lanes) and why GitHub's "failed payment" annotation is generic and wrong here: `archive/RELEASE_STATE_HISTORY.md` §2026-09-02. **The everyday gate is `npm run verify:local`** (`scripts/verify-local.ps1`, wired via `.githooks/pre-push`, pinned by `scripts/local-gate-guard.test.mjs`); the full gate set is whatever that script runs. |
| **Remote CI availability (measured)** | **UNAVAILABLE — last measured 2026-09-02: `Dependency audit` run `33405544287` (2026-08-31) = `success`, its only job = `failure` with **0 steps**** | `scripts/actions-health.mjs` — on demand `node scripts/actions-health.mjs`; weekly as the second action of the `CompyUsageAudit` scheduled task (`--report` → `docs/usage-audit/ACTIONS-HEALTH.md`, gitignored) · judgment pinned by `scripts/actions-health.test.mjs` · residency `scripts/gate-residency-guard.test.mjs` | Fails on any completed job with 0 steps (`HOLLOW-JOB`), any completed run with no jobs, and any `success` run carrying a `failure` job (`GREEN-OVER-FAILURE`); `UNKNOWN` (exit 2) when the API cannot be asked — never folded into either answer. Deliberately not in `npm test`: its answer changes with GitHub's billing state, not with a commit. When this row reads AVAILABLE again, hosted results may be cited as evidence; until then only the local gate is. Tracked as #321. |
| **zh-CN localization** | **Base AND verdict vocabulary both MERGED on `main` (`d000295`)** | `src/i18n/locales/zh-CN/` · guard `src/i18n/zh-cn-verdict-vocabulary-guard.test.ts` | The zh-CN base translation and the verdict-chip vocabulary finish (真有效 / 安慰剂 / 有风险 — 已拒绝, integrated from `2461106`) are both on `main` — nothing zh-CN is pending a merge. The guard test pins the vocabulary. |
| **Outbound network** | **ONE surface: signed update check/download** (2026-07-22) | `tauri-plugin-updater` (`Cargo.toml:37`) fetches the pinned endpoint (`tauri.conf.json:76`) Rust-side; **production CSP `connect-src` UNCHANGED** (`tauri.conf.json:47` — `'self' ipc:`; no webview-reachable HTTP) | Supersedes the 2026-07-11 zero-outbound audit BY OWNER DECISION. Receipts + remote-rules fetch stay dark; Tier 1 case intelligence now HAS a module on `main` (#221, 2026-08-26) and still has no endpoint, no trust key and no traffic — three independent locks, any one of which refuses alone; Export leaves only by the user's hand. **Copy/doc truth closed 2026-08-03:** the absolute "nothing leaves your PC" claims that survived the 2026-07-22 arming are gone from both locales, `docs/PRIVACY.md` is at v0.3, and `src/outbound-claim-guard.test.ts` now fails the build if any absolute offline claim ships while ANY outbound surface is live (was receipts-only, which is why the updater arming fired nothing). |
| **Local support evidence (Q5)** | **BACKEND + UI ON `main`, no gate flag — the record is always written. SIGNED OFF 2026-08-04:** the surface's visual self-review PASSed on the installed `5ff6963` release build (9/9 rubric items, live captures at the owner's real resolution). The first review FAILed item 6 — the always-visible meta line rendered the internal `<path>` redaction mask as if it were a location, because the location went through the same aggressive `redact_paths()` as free-text detail; `display_location` now emits `%APPDATA%\Compy\support`, pinned by a Rust guard **and** by `SupportEvidence.test.tsx`'s "names a location the user can open" test. One noted non-defect: **clear** is not preview-gated the way **export** is — it substitutes a stated consequence plus a two-step confirm (pre-existing design, unchanged). | `record` — `support_evidence.rs:408`; caps `MAX_BYTES` — `support_evidence.rs:58`; `preview_support_evidence` — `support_evidence.rs:720`, `export_support_evidence` — `support_evidence.rs:746`, `clear_support_evidence` — `support_evidence.rs:783`; `SupportEvidence` — `SupportEvidence.tsx:26` | Bounded rotating JSONL at `%APPDATA%\Compy\support\evidence.jsonl` — a NEW data location, hard-capped at 400 records / 250 KiB (`MAX_EVENTS × MAX_RECORD_BYTES`), redacted at write **and** again at export. **Not a new outbound surface:** there is no transport at all; export writes a file the user hands over by their own action, and `src/support-evidence-outbound-guard.test.ts` fails the build if a send path appears. Export is preview-gated in Rust (refuses until `preview_support_evidence` ran this session); the UI mirrors that by not rendering the save control until a preview returns. Published caps in `docs/PRIVACY.md` + `site/privacy.html` are pinned to the constants by `src/privacy-data-dir-guard.test.ts`. |

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
- Rollback resolves from `history.json` alone, never the live catalog (`resolve_rollback` — `actions.rs:5123`).
- Ledger save is crash-safe atomic temp-write+rename, test-pinned (`save_history_to` — `history.rs:649`).
- Elevation: relaunch `compy.exe --run-elevated <hex> <ticket>` (windowless), 4-way honest UAC
  attribution (`elevation_outcome` — `actions.rs:1100`); helper runs ONLY hex byte-matching the
  one-time ticket (`mint_elevation_ticket` — `actions.rs:1336`).
- Gaming-session advanced tier batches to ONE elevation per session start and per restore
  (`apply_elevated_tier` — `gaming_orchestrator.rs:202`); no-partial abort+restore contract;
  UAC-decline drops only verifiably-never-ran staged entries (`elevation_error_nothing_ran` — `actions.rs:1236`).

## Release blockers

| Item | Status |
|---|---|
| Private-beta functional blockers | **NONE** — Gaming Mode signed off; installed-build QA + runtime closure done; the updater path is live and owner-proven. |
| Publish of the current fleet build | **Every transaction count in this row is NOT re-verifiable — see #199.** **CLOSED for v0.9.26 - published 2026-08-19T09:14Z under explicit owner GO ("the fleet-move GO"), release id `372920800`, transaction 9/9, alias verified on attempt 1 in 3.7s; `published_*` anchors carry the artifact truth. The desk has since moved ahead of it again to the unreleased, unpushed `acdb93c2`; that is a candidate, not a publish, and it needs its own GO.** Prior close, v0.9.24: **published 2026-08-13T21:29Z under explicit owner GO ("send out the most current working version of the app to the tester"), transaction 9/9, alias verified on attempt 1 in 3.5s; `published_*` anchors carry the artifact truth. First fleet build carrying the design foundation (TYPE-1 + COLOR-1 + UX-1), and the second in a row where the desk look FAILED first and was fixed before anything shipped.** Prior close, v0.9.18: **published 2026-08-13T06:57Z under explicit owner GO ("go"), transaction 9/9, alias converged after the documented edge-cache delay.** Prior close, v0.9.17: **CLOSED — published 2026-08-12** under owner GO ("i permit you to proceed with everything yourself"). Transaction complete 9/9; public installer + `latest.json` byte-match the signed receipt; updater signature verifies against the pinned key; the latest-alias converged on the first check. **First published build that was visually reviewed on the installed binary before shipping** — and the first review round FAILED, which is the only reason that step is worth having. Supersedes the v0.9.15 publish (also closed 2026-08-12), v0.9.12 (2026-08-03) and v0.9.11 (2026-07-28). Any *future* candidate still needs its own owner GO/NO-GO after local preparation. |
| Tester distribution of the published build | **CLOSED — A0 canary PASS.** A tester updated through the normal public updater and runs v0.9.11 with no reported failure, proving the fleet path end-to-end on a machine that is not the owner's. Widening to the remaining invitees is an owner distribution call, not a blocker. |
| Hosted CI | **NOT A BLOCKER — remote execution is currently unavailable** (jobs refused before runner startup under the owner's $0 budget, 2026-07-16). Listed here only so it is never re-read as an unresolved gate. The local gate is the proof authority; a green workflow status is not evidence its job ran — see the "Remote CI availability (measured)" row. |
| Data-root integrity (#130) | **RESOLVED — resolver landed + owner desk recovered 2026-08-18, shipped in `421657a9`; not a publish blocker.** Full record moved to `docs/archive/RELEASE_STATE_HISTORY.md` (2026-08-25). |
| Code signing | **OPEN** — gates PUBLIC release (Azure Trusted Signing route, owner/$-gated). |
| Legal (EULA + privacy) | **OPEN** — gates PUBLIC release. DRAFTS only. |
| Receipts security review + consent UI + payload preview + kill switch | **OPEN** — gates arming Receipts telemetry. Payload preview + the consent/off-switch commands and the privacy disclosure exist as of Q9a (2026-08-25); the independent security review and the first-run consent UI do not. |
| Preload-app removal live QA + owner-curated list | **OPEN** — gates arming preload-app removal (built DARK, not a ship blocker). |
| Aggregate-stack trial live QA | **OPEN** — gates arming the §2a stack trial (built DARK, not a ship blocker). |
| Remote-rules production key + CDN + staged rollout | **OPEN** — gates arming remote fetch. **Also a precondition (added 2026-08-31, #286):** the crash-recoverable generation + anti-rollback floor protocol in [`docs/superpowers/specs/2026-08-31-remote-rules-cache-generation-recovery.md`](superpowers/specs/2026-08-31-remote-rules-cache-generation-recovery.md) must be implemented and fixture-proven before fetch is armed. Today the cache's three files are written independently, so a crash after the pair lands but before the floor advances leaves a floor that would later accept a signed *older* ruleset. Unreachable while `remote_fetch_enabled()` is false; arming is what would make it reachable. |
| v0.9.10 release debris | **CLOSED — deleted 2026-07-28** under owner authorization (draft `360948018` + releases-repo tag). Source tag `92c7608`, recovery branches and local evidence preserved. |

**No active blocker remains on the v0.9.26 release train** — it is complete 9/9 (**NOT re-verifiable — see #199**), published
2026-08-19, and the fleet is on it, so **normal product development may resume.** Every row still
marked OPEN above gates a *future* PUBLIC (store/marketing) release or the arming of a dark feature;
none of them blocks the shipped v0.9.26 build, the newer desk candidate `acdb93c2`, or the work
that follows them.

**✅ VERSION DEBT — PAID 2026-08-12.** The debt was a tree declaring a version no signed cut existed
for, so desk work could not reach a tester. It is closed and has stayed closed through v0.9.26,
which was built **with** `TAURI_SIGNING_PRIVATE_KEY`, published, and is what the updater manifest
now offers. The debt reopens the
moment the next bump lands without a publish — the honest name for that state is a *candidate*, and
`STATE:candidate_published` is the anchor that says which it is.

## Required owner decisions (live)

**Everything already CLOSED, ANSWERED or DONE has left this section** — it is named *(live)* and a
closed decision sitting in it is drift by definition. **One structural exception:**
`verify-release-state.mjs` requires decision **1** to name the current `candidate_version`, so the
newest publish GO stays here after it closes — it is the version anchor, not an open question.
Everything else that closes leaves. v0.9.25's and v0.9.24's GOs, v0.9.18's publish GO, the 2026-08-21 "runs a lot
slower than before" investigation (answered: not measurably slower; the ambient backdrop was ~88% of
idle CPU, and two of #127's measurements had never settled) and the backdrop fix that followed are
byte-preserved in [archive/RELEASE_STATE_HISTORY.md](archive/RELEASE_STATE_HISTORY.md).

> Write dates in this section date-first with **no ISO zulu suffix** — the checker's decisions-section
> regex ends the section at the first zulu letter it meets (#123 carries the fix-forward).

1. **Candidate v0.9.26 publish GO/NO-GO - CLOSED 2026-08-19, published 09:14Z, transaction 9 of 9.**
   (Date-first, no zulu suffix, per #123.) The GO was given in chat ("the fleet-move GO") to close a
   three-lane gap: the fleet had sat on v0.9.25 (`efde8310`) since 2026-08-13 while the desk ran
   unsigned builds carrying the data-root resolver, the CPU-temp offer, the C-10/C-11/C-17
   conformance work and the #127 idle-CPU fix. It re-cut from `main` with the signing key. What the
   owner said yes to, in his words back to him: testers get a build that costs about half as much
   CPU sitting idle, a front door that answers what is wrong with the PC, CPU temperature out from
   behind Advanced, and a Trust Ledger that can no longer split across two folders. No gate was
   waived - the transaction closed 9 of 9 on its own evidence (**NOT re-verifiable — see #199**), release id `372920800`, alias attempt
   1; `published_*` above carries the artifact truth. Four latent pipeline defects surfaced and were
   fixed with guards during the run (`5d21961a`, `b8e31e67`, `0e885823`); the consolidated
   fail-in-seconds preflight for `release.ps1` is still owed - see `docs/BACKLOG.md`.

2. **Widening the invitee fleet onto the published build (now v0.9.26)** — the publishes themselves are **CLOSED** (through v0.9.26, 9/9 — **NOT re-verifiable, see #199**). What is left
   was never a pipeline question: **whether/when the remaining invitees move onto the updater path.** Six people hold the hand-sent
   0.9.0 link and would each have to install once by hand to join it; everyone already on it is offered v0.9.26 automatically. Every
   stated precondition is met — the v0.9.11 canary PASSED on the normal updater path and at least two testers auto-updated onto
   v0.9.12 unaided — so this is a distribution call, not a readiness one. **Owner territory: it means naming humans and messaging
   them.** Worth saying when you do: v0.9.17 renamed three rooms a returning tester already learned and nothing in the app
   tells them the names changed.
3. Code-signing route + legal finalization (PUBLIC gates).
4. When/whether to arm Receipts (its own security review + owner sign-off).
5. Tier 1 case-intelligence direction is approved. Do not re-ask that product decision; bring back
   only the exact endpoint, signing custody, disclosure, security review and measured dark/canary
   evidence required to arm real traffic.

**Closed 2026-07-28:** the v0.9.10 private-draft cleanup decision — the owner authorized deletion and
the abandoned release debris (draft `360948018` + releases-repo tag `v0.9.10`) is gone; source tag,
recovery branches and local evidence were preserved. It is no longer an open decision.

**Not** an owner decision: hosted CI. Remote execution is unavailable under the 2026-07-16 zero-budget
decision; the local gate is the proof authority and a green workflow status is not evidence its job
ran. Never surface it as an open obligation — see the two Gate matrix rows.

## Snapshot history — in archive

The full reverse-chronological banner log (every dated train, byte-preserved) lives in
[archive/RELEASE_STATE_HISTORY.md](archive/RELEASE_STATE_HISTORY.md). APPEND new dated banners to the
TOP of the archive; keep THIS file to CURRENT STATE only (budget: 300 lines, `scripts/doc-budget.ps1`).
