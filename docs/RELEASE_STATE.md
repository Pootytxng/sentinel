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
<!-- STATE:source_main_commit=5d21961a -->
<!-- STATE:latest_release_version=0.9.25 -->
<!-- STATE:candidate_version=0.9.26 -->
<!-- STATE:candidate_branch=main -->
<!-- STATE:candidate_published=no-preparing -->
<!-- STATE:candidate_installed=no-not-yet -->
<!-- STATE:aborted_source_only_release=v0.9.9-664aa5e -->
<!-- STATE:v0910_release_debris=deleted-2026-07-28 -->
<!-- STATE:v0910_source_tag=92c7608-preserved -->
<!-- STATE:v0910_local_evidence=preserved -->
<!-- STATE:published_release_version=0.9.25 -->
<!-- STATE:published_release_commit=efde8310 -->
<!-- STATE:published_release_id=370249321 -->
<!-- STATE:published_installer_sha256=72a04a15c56c72369e4e1fd7a82b0aba5bf9f3acfbc143c928e2aeed73db2203 -->
<!-- STATE:published_manifest_sha256=cb1c18f72542cce8680762119f79a1b499fc67995d1a7410a1026b1cc0ef34dc -->
<!-- STATE:release_transaction_stages=9-of-9 -->
<!-- STATE:owner_installed_version=0.9.25 -->
<!-- STATE:owner_installed_stamp=75880de1 -->
<!-- STATE:manifest_version=0.9.25 -->
<!-- STATE:hosted_ci=off-by-owner-decision-2026-07-16 -->
<!-- STATE:zh_cn_localization=base-and-vocabulary-on-main-d000295 -->
<!-- STATE:tester_distributed_version=0.9.0 -->
<!-- STATE:canary_status=pass-on-0.9.11 -->
<!-- STATE:public_artifact=releases-repo-public -->
<!-- STATE:code_signing=open -->
<!-- STATE:legal=open -->
<!-- STATE:capability_exception_gate=approved-2026-08-09-runtime-unchanged -->
<!-- STATE:case_intelligence_tier1=discovery-shipped-2026-08-12-catalog-not-built -->

| Identity | Current truth | How to re-verify |
|---|---|---|
| **Source `main` baseline** | The repair began from synchronized local/origin `main` at `92c7608` (`release: v0.9.10`) and advanced by fast-forward through the release commit `7ba5fb6` to the post-release tooling repairs (`c0fed45`). Annotated source tags are immutable: local-only `v0.9.8` → `d9ced24`; origin `v0.9.9` → `664aa5e`; origin `v0.9.10` → `92c7608`; origin `v0.9.11` → tag object `7d57446` peeling to commit `7ba5fb6`. Recovery branches for the 0.9.8 and both failed 0.9.9 candidates remain local and on origin. | `git rev-parse HEAD origin/main` · `git rev-parse v0.9.11^{commit}` · `git ls-remote --tags origin` |
| **v0.9.9 — aborted source-only release** | **Source-tagged and installed on the owner machine, but NEVER published to the fleet because the release-repository existence probe failed closed.** The publish transaction stopped at `scripts/release.ps1` immediately after pushing the source tag: an expected GitHub 404 from the releases-repo tag probe was promoted into a terminating `NativeCommandError` by Windows PowerShell 5.1. Three stages completed (source push, source tag push, releases-main lookup); six never started (releases tag, draft, asset upload, manifest, publish, verify). **Not a public release. Not republishable** — the signed receipt, installer and stamp are bound to `664aa5e`, and the pipeline requires an exact-HEAD match. Full byte-level evidence: `C:\Users\Kuya\code\compy-release-evidence\2026-07-28-v0.9.9-aborted-source-only-664aa5e\EVIDENCE.txt`. | `gh release list --repo Pootytxng/compy-releases` · `git ls-remote --tags https://github.com/Pootytxng/compy-releases.git` |
| **v0.9.10 — abandoned; release debris DELETED 2026-07-28** | The partial train created immutable source tag `v0.9.10` at `92c7608`, pushed source `main` and that tag, created a releases-repository tag and a **private draft**, uploaded installer + `latest.json`, and installed/runtime-proved 0.9.10 locally. It was **never published to the updater fleet**, and v0.9.11 superseded it. Under explicit owner authorization the abandoned **release debris was removed**: private draft release `360948018` deleted (HTTP 204, both assets with it) and releases-repository tag `v0.9.10` deleted (HTTP 204) after confirming no release depended on it — every releases-repo tag points at the same content commit `a628c9b`, so no commit was removed and no other release was affected. **Provenance is preserved and untouched:** the source tag `v0.9.10` → `92c7608` in `Pootytxng/sentinel` still exists, as do the recovery branches and the full local evidence directory `C:\Users\Kuya\code\compy-release-evidence\2026-07-28-v0.9.10-private-draft-92c7608\`. | `gh api repos/Pootytxng/compy-releases/releases --jq '[.[]\|select(.tag_name=="v0.9.10")]\|length'` (→ `0`) · `git rev-parse v0.9.10^{commit}` (→ `92c7608`) |
| **v0.9.11 — PUBLISHED (2026-07-28)** | Cut from `main` after the autonomy, native-process, resumable-transaction, simulation, and static-guard repairs, then published under owner GO. Public release id **`361056355`**, tag `v0.9.11`, `draft: false`, `prerelease: false`, published `2026-07-28T14:44:17Z`. Public installer `Compy_0.9.11_x64-setup.exe` SHA-256 **`bb2b85a43c2bf5119666f7b0709e7cee0409e0eb5ed7c4da2e4998da5438384f`**; public `latest.json` SHA-256 `6bcd6cea96bd610e8be1c44765cfc4e6f3b8c2b4e4594774251fa3cceb76b007`; both byte-match the signed receipt and the updater signature verifies against the pinned key. Releases-repository tag `v0.9.11` → `a628c9b`. The resumable transaction is **complete: 9 of 9 stages**, closing on `public_assets_verified` after the `/releases/latest/download/` aliases converged. | `gh release view v0.9.11 --repo Pootytxng/compy-releases --json id,isDraft,isPrerelease,publishedAt` · `src-tauri/target/release/bundle/nsis/release-transaction-v0.9.11.json` |
| **Configured build version (this tree)** | Carried by the `STATE:latest_release_version` anchor above — check (1) pins that anchor to `src-tauri/tauri.conf.json`'s version, and the release pipeline moves both in the same commit as the bump. This is what the tree *would* build — it is **not** a released version (published truth is the row below). Do not restate the number here; it would drift. | `grep '"version"' src-tauri/tauri.conf.json package.json` |
| **Latest PUBLISHED release + source commit** | **v0.9.25**, source `efde8310`, published tag `v0.9.25` on `Pootytxng/compy-releases`, release id **`370249321`**, published `2026-08-13T22:34:15Z` under owner GO (chat, 2026-08-13 — "lets get as much of the important stuff done that we can and the update sent to the testers"), `draft: false`, `prerelease: false`. Installer `Compy_0.9.25_x64-setup.exe` SHA-256 **`72a04a15c56c72369e4e1fd7a82b0aba5bf9f3acfbc143c928e2aeed73db2203`**; public `latest.json` SHA-256 `cb1c18f72542cce8680762119f79a1b499fc67995d1a7410a1026b1cc0ef34dc` — both byte-match the signed receipt, transaction **complete 9 of 9** closing on `public_assets_verified`, and the `/releases/latest/download/` alias converged on **attempt 1**. **This is a stability release, not a feature one**, and both items in it were found by people rather than by the suite: the update-pill LED no longer animates `box-shadow` forever in the shell topbar (a main-thread repaint per frame on every screen, live only in the update-AVAILABLE branch — which is precisely the state every out-of-date tester sits in, so the update offer was taxing the people it was built to help), and a written feedback draft now survives leaving Settings (tester Jaikaran reported it on v0.9.12; it was **still reproducible on v0.9.24**). Both were LOOKED at on the installed binary and both new guards were falsified before being trusted. **The owner's own report that the app "runs a lot slower than before" is NOT closed by this release** — the pill fix cannot explain it, because he is on the newest build and his pill never enters the available state. Ranked remaining candidates live in the HQ ledger; `scripts/q7-probe.mjs attribute` is the tool to settle it. It supersedes **v0.9.24**, source `289c658d`, published tag `v0.9.24` on `Pootytxng/compy-releases`, release id **`370225167`**, published `2026-08-13T21:29:49Z` under owner GO (chat, 2026-08-13 — "send out the most current working version of the app to the tester"), `draft: false`, `prerelease: false`. Installer `Compy_0.9.24_x64-setup.exe` SHA-256 **`c0d3b7511941c9aefdb5e5caedafcdbb275d6ebb573724fb7fa2708adf5bbbec`**; public `latest.json` SHA-256 `fc23172530abb784d66b3014688009dc1005d8080596e17e4ba1311d6837d224` — both byte-match the signed receipt, updater signature verifies against the pinned key, transaction **complete 9 of 9**, and the `/releases/latest/download/` alias converged on **attempt 1 in 3.5s** (no edge-cache wait this time). **This is the biggest jump the fleet has ever been offered: six candidate numbers in one release.** It carries design-foundation **step ② UX-1** — the Home front door is now a verdict at 40px with one primary action, and the room title is gone — **visually reviewed on the installed binary, twice, because the first review FAILED** (v0.9.23's verdict rendered a step small; see the owner-installed row) — on top of step ① **TYPE-1 + COLOR-1** (six-step type scale, 13px floor, rooms give up their hue), the update-pill attention state, the in-app What's-new list, and the arc-gauge ring-overflow fix. **v0.9.19 through v0.9.23 were never published** (desk-only or burned by failed re-prepares); v0.9.22's open GO was folded into this one. It supersedes **v0.9.18**, source `cfc0c4b7`, release id **`369720195`**, published `2026-08-13T06:57:36Z` under owner GO (chat, 2026-08-12 ~23:45 PT). Installer SHA-256 `61acde41dce19554a93644177435c38ca89f9bf470f513c8fdb833ca32969183`; `latest.json` SHA-256 `a616c050834cbdb55b0b087c2f6df7b565b1fd28951a5f8b22d03b6338fa9924`; transaction 9 of 9. It carried the intake band default OFF (`4d1afa92`), the popout modal-contract guard (`b44ec358`), the three-popouts-onto-one-`Sheet` convergence (#119), and the #121 quiet-launch SW_MAXIMIZE fix — **visually reviewed on the installed binary before publish** (the mid-apply consent panel remains the one unseen surface, see the row below). It supersedes v0.9.17 (`a614744c`, id `369614201` — **marathon Trains 1–3** and the first published build LOOKED at before shipping), which superseded v0.9.15 (`1b437785`, id `369480816`, published the same day), which superseded v0.9.12 (`a1be896`) and v0.9.11 (`7ba5fb6`). No v0.9.8, v0.9.9, v0.9.10, v0.9.13, v0.9.14 or v0.9.16 release exists — those were desk-only or abandoned. **A stale alias read is not drift:** `/releases/latest/download/latest.json` served the previous body from an edge cache for minutes after the v0.9.15 publish; the versioned URL is correct immediately. Re-fetch with a cache-buster before calling the alias wrong. (For v0.9.17 and v0.9.18 the alias converged on the first check.) | `gh release view --repo Pootytxng/compy-releases --json tagName,isDraft,publishedAt` · `Get-FileHash` on the re-downloaded public assets |
| **Owner-installed version + embedded stamp** | **0.9.25 DESK BUILD**, embedded stamp **`75880de1`** (built 2026-08-19 from branch `perf/idle-127-ambient-raster`; installed silently by Claude, installer SHA-256 **`E4A1301FD9F62FA38507ABD2320B20A1ECD7D4B67B26E538BDA1B078FFBFFC2A`**, one installer on the Desktop). **LIVE-proved by `scripts/ship-reinstall.ps1 -VerifyRuntime -ExpectedCommit`** -- runtime proof `75880de1 · release · shell 0.9.25`, attempt 1 (0 expected transient). It carries the **#127 idle-CPU fix**, and it is the first measured answer to the owner's standing "runs a lot slower than before" report recorded in the published-release row above. **Whole-app idle on Home: 19.632 -> 10.483 percent of one core**, measured with `scripts/q7-probe.mjs attribute` against the installed binary before and after (`docs/perf/raw/idle-attribution-2026-08-19-{A-rig-on,D-installed-fix}.json`). **#127's own diagnosis did NOT reproduce:** the rAF band is 0.201 points and fired ZERO frames, so the 3D rig was never the cost, and the dependency-bump hypothesis is dead (r3f/drei/three identical in the lockfile at the baseline commit, at `efde8310`, at HEAD and on disk). The real cost was two decorative CSS animations that the ambient-cost guard considered free because they animate `transform`: `aurora` on `body::before` at 13.257 points (a `scale()` animation re-rasters the whole layer every frame -- the 2026-08-06 teardown removed the blur and left the trigger) and the two `.stl-ring` pulses on every Home at 4.156 (measured 4.156 shipped, 4.001 promoted with `will-change`, 4.721 as opacity-only -- **running forever was the cost, not the property**). Both guards are new and both were **falsified on purpose** by re-introducing the defects on disk. **Scope stated:** the update-pill LED got the same bounded treatment but was **NOT separately measured** (no update was available during the runs), and the post-fix baseline is noisy (8s windows swing 4.8-15.2), so the total is quotable and the per-animation splits inside a single post-fix run are not. It supersedes desk build **`2f79febb`** (built 2026-08-18 from `main` at the merge of PR [#139](https://github.com/Pootytxng/sentinel/pull/139); installed silently by Claude, installer SHA-256 **`668BB5E4725E1EE613603BA1230629159D6AD90AB5E1E4F9246E44EEC62E6E6D`**, one installer on the Desktop). **LIVE-proved by `scripts/ship-reinstall.ps1 -VerifyRuntime -ExpectedCommit`** — runtime proof `2f79febb · release · shell 0.9.25`, attempt 2 (1 expected transient). **Self-review VERDICT: PASS (10/10)** on the live app, and the code carries **three independent review rounds** (REQUEST CHANGES at `5d572db6` → APPROVE at `f88b25db` → APPROVE at `640fb78e`). It carries **conformance C-10 / C-11 / C-17**: the last five native `<select>`s are gone (their popup was drawn by Windows, so it ignored every token in the room) and the element is banned outright by `no-raw-select-guard`; repeated ledger applies collapse into one row (his history is 64 applies, **37 of them the same tweak** — the 30-row tape was one sentence printed over and over, now 17 rows / 13 change rows); and the mono-is-for-machine-values law became a census with a down-only ratchet. **Reachability was measured, not inferred:** `document.querySelectorAll('select').length === 0` on Home, Live, History and all six Test-room instrument tabs; the SessionInvestigator Picker renders `null` on his machine today (its guard needs two sessions of the SAME game) — recorded unreachable-today rather than claimed verified. **Two guard defects the review caught, both fixed here:** the select guard could not see a `<select` that ended a line (its own mutation test proved a code path the real sweep never ran), and the launch-focus classifier had been split on a false premise — a 5ms timing lead that is the probe's own poll ordering, not evidence the OS fronted the launch; it now needs a full poll of margin and says `unattributable-at-launch` when it cannot tell. **Scope stated, not hidden:** the census recorded 12 mono-on-prose violations and this build restyles NONE of them (C-17b), and the pre-existing ~120ms in-process window raise under load (#121) is NOT closed — see `docs/BACKLOG.md`. Supersedes desk build **`7f151d2c`**. | `node scripts/verify-release-state.mjs` (check 7) · `Select-String -Path "$env:LOCALAPPDATA\Compy\compy.exe" -Pattern 2f79febb` · HKCU uninstall `DisplayVersion` |
| **Latest updater manifest version** | **v0.9.25** — `latest.json` at `releases/latest/download/` reports `"version": "0.9.25"` and names the v0.9.25 asset; the body byte-matches the signed receipt (`cb1c18f72542cce8680762119f79a1b499fc67995d1a7410a1026b1cc0ef34dc`) and the signature verifies against the pinned minisign key. The alias was re-read and verified at publish time on the first attempt (3.5s). Its notes are written for TESTERS, not the repo, and render as the in-app **What's new** list. | unauthenticated cache-busted fetch of `latest.json` + `scripts/verify-updater-signature.mjs` |
| **Hand-distributed tester version** | **0.9.0** — the `37a166c` NSIS (SHA-256 `6BC2F7DF…F5A2C4`) is what the six invitees were sent (Drive link). That remains the only hand-send; nothing has been mailed out since. | `BETA_DISTRIBUTION_RECORD.md` |
| **A0 single-tester canary** | **PASS.** A tester completed the canary through Compy's **normal public updater** and is **currently running v0.9.11**; **no updater failure was reported.** That is the whole recorded result — the tester's prior version, the update timestamp, and any per-step detail were never captured, so they are not reconstructible and must not be inferred. | owner report only |
| **Known tester installation state** | **At least two, possibly three, testers are on 0.9.12** — the owner reported on 2026-08-05 that they auto-updated to the latest published build on 2026-08-03/04, which is v0.9.12. **Two is the floor; the third and the exact identities were not captured and must not be inferred.** Separately, the canary tester was last confirmed on 0.9.11 and may be among them. The remaining invitees stay **UNKNOWN** — no telemetry, no remote inventory by design; six hold the 0.9.0 link and what each installed is owner-confirmable only. | owner report only |
| **Public artifact exposure** | **YES — `Pootytxng/compy-releases` is a PUBLIC repo.** Every updater installer + `latest.json` is unauthenticated-downloadable (required for the updater; same discoverability as a shared link). **Source repo `Pootytxng/sentinel` stays PRIVATE.** No store listing, no marketing page, no Authenticode-signed public artifact. | `gh repo view Pootytxng/compy-releases --json visibility` |
| **Code-signing status** | **OPEN** — installers are Authenticode **NotSigned**. Gates a PUBLIC (store/marketing) release, not the private-beta updater. | `Get-AuthenticodeSignature` on the NSIS |
| **Legal status** | **OPEN** — EULA + privacy are DRAFTS only. Gates a PUBLIC release. | `docs/` legal drafts |

**Bottom line:** the newest **published** release and the public updater manifest are both
**v0.9.25 (`efde8310`)**, published 2026-08-13T22:34Z under owner GO — a stability release carrying
the update-pill repaint fix and the feedback-draft persistence fix, both LOOKED at on the installed
binary and both guarded by checks proven able to fail. It replaced v0.9.24
(`289c658d`), published 2026-08-13T21:29Z, which replaced v0.9.18
(`cfc0c4b7`), which had replaced v0.9.17 (`a614744c`), v0.9.15 (`1b437785`) and v0.9.12
(`a1be896`), as the fleet-visible build. **Desk and fleet now DIVERGE by design** — as of 2026-08-18 the owner desk
runs the unsigned desk build `555e2996` (same 0.9.25 version string, different bytes) so that the
`data_root.rs` canonical-root resolver and the Q9c CPU-temp offer are in a binary he actually launches; the fleet stays on
published `efde8310`. The next publish re-cuts from `main` with the signing key and closes the gap. Versions and stamps
are carried by the anchors and the rows above, not restated here. v0.9.24 is the first fleet build
carrying the **design foundation**: step ① TYPE-1 + COLOR-1 (six-step type scale with a 13px floor,
rooms give up their hue so green/amber/blue mean one thing app-wide) and step ② **UX-1 — the front
door is a verdict + one action** (the Home h1 is the answer at 40px, the room title is gone, and
"What are you here to do?" is the screen's single primary button, opening the intent panel in
place). It also carries the update-pill attention state and the in-app What's-new list — the exact
fix for the tester who never noticed his update — plus the arc-gauge ring-overflow fix.
**v0.9.19–v0.9.23 were never published:** desk-only or burned by failed re-prepares. Two of those
desk builds were caught by LOOKING at them (v0.9.19's ring overflow, v0.9.23's undersized verdict),
neither by a test. What is *offered* is not what is taken — no tester is known to have updated past
0.9.12 yet, and this is a six-number jump for whoever takes it.
Further back, v0.9.12 carries the
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
fleet reaches every build only through the consent-first updater, and **the A0 single-tester canary
PASSED** on that path for v0.9.11: the tester updated in-app and reported no updater failure. **The
fleet path has since carried real traffic — the owner reports at least two testers auto-updated onto
0.9.12 on 2026-08-03/04.** The v0.9.15 release transaction is **complete: 9 of 9 stages**,
**no active release blocker remains, and normal product development may resume.**

## Gate matrix

> `scripts/verify-release-state.mjs` FAILS if this section, CURRENT STATE, or Release blockers is
> missing, or if the file carries zero `file:line` citations — the f21c170 diet-cut class (a doc
> trim silently gutting the live matrix) can't recur silently.

| Gate / capability | State | Source | Notes |
|---|---|---|---|
| **Gaming Mode (F1)** | **LIVE** (`true`) | `gaming_mode_gate()` — `lib.rs:536` | Flipped 2026-06-18 w/ owner sign-off. §7 QA harness passed; **GAMING_MODE_QA.md 10/10 PASSED 2026-07-14**; **owner SIGNED OFF 2026-07-14** — field-proven for 1.0. |
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
| **Compy Care case intelligence — Tier 1** | **The signed catalog capability: OWNER-APPROVED DIRECTION; NOT BUILT / NO RUNTIME TRAFFIC.** Its DISCOVERY half — the Home Care entry only — **SHIPPED 2026-08-12** | issue [#91](https://github.com/Pootytxng/sentinel/issues/91) · `docs/ARCHITECTURE_LOCKS.md` §1.8 · `homeCareEntry` — `home-intake-data.ts:95`; guards `src/surfaces/care-home-route-guard.test.ts` | **What shipped is the visible half ONLY: a Home Care entry ("Crash & Freeze Rescue") that always renders, independent of `compy_home_intake` in every state including the `"0"` Settings failsafe, and deep-links to the existing local crash-evidence station.** It reads nothing new, sends nothing, and adds no module — it is a sign pointing at a reader Compy already had. The crash door was previously an intake ROW, so switching the optimization band off in Settings switched crash rescue off with it; extracting it fixed that and removed the duplicate door. **Nothing of the dark half exists**: no catalog, no endpoint, no key, no cache, no `case_intelligence.rs` runtime traffic. Separate key/schema/domain/cache from privileged remote rules; no machine-derived upload; no CSP widening. Dark implementation may begin only after PR #90 is merged/dispositioned. Exact endpoint, signing custody, disclosure and runtime arming remain later review points. |
| **Auto-updater** | **LIVE** (2026-07-22, owner-directed) | `plugins.updater` — `tauri.conf.json:73` (pubkey `:75`, endpoints `:76`); `tauri-plugin-updater` — `Cargo.toml:37`; capability `capabilities/updater.json` (main window ONLY, `updater:allow-check` + `allow-download-and-install`) | Consent-first: check on launch + every 4h; nothing downloads until the user clicks Update now. **Automatic checks are switchable OFF (2026-08-03)** — Settings → About → Automatic update checks (`compy_update_autocheck`, default ON); off means no launch check and no interval, with "Check now" still available. Signature verification is unaffected by the switch. Minisign-verified against the pinned key before install; private key outside the repo. **E2E-witnessed 0.9.4→0.9.7 this session** (CDP stamp transitions, no reinstall between); GitHub asset counters corroborate. |
| **Hosted CI (GitHub Actions)** | **OFF — by standing owner decision (2026-07-16), now enforced in the workflow files themselves (2026-08-10); not a defect and not an open owner obligation** | `ci.yml` + `ci-health.yml` are `workflow_dispatch:` only · `audit.yml` weekly · `deploy-site.yml` path-scoped · guard `scripts/ci-budget-guard.test.mjs` | **Corrected 2026-08-10 — the old claim "workflows present but never start" was false.** The monthly included minutes reset on 1 Aug and CI ran **111 real times in six days** (~570/month, against a budget guard that assumed 122), exhausting them again by ~06:00 UTC on 7 Aug; every job since is rejected before runner startup. Cause was run VOLUME from the parallel agent lanes, not per-run cost. Nothing now starts itself, so the decision holds by construction rather than by the account being blocked. **GitHub's rejection annotation mentions failed payments — it is generic and wrong here:** no failed payment, billed $0, deliberate $0 Actions budget with stop-usage on. The owner declined the spend under the zero-budget law and directed that it never be re-asked. **The everyday gate is now `npm run verify:local`** (`scripts/verify-local.ps1`, wired via `.githooks/pre-push`, pinned by `scripts/local-gate-guard.test.mjs`). **The full gate set runs locally instead** (encoding guard · release-state verifier · hook self-tests · doc budget · tsc · vitest · frontend build · cargo test · clippy `-D warnings` · release-pipeline guards · updater-signature verify). A red/absent CI badge is the expected steady state. |
| **zh-CN localization** | **Base AND verdict vocabulary both MERGED on `main` (`d000295`)** | `src/i18n/locales/zh-CN/` · guard `src/i18n/zh-cn-verdict-vocabulary-guard.test.ts` | The zh-CN base translation and the verdict-chip vocabulary finish (真有效 / 安慰剂 / 有风险 — 已拒绝, integrated from `2461106`) are both on `main` — nothing zh-CN is pending a merge. The guard test pins the vocabulary. |
| **Outbound network** | **ONE surface: signed update check/download** (2026-07-22) | `tauri-plugin-updater` (`Cargo.toml:37`) fetches the pinned endpoint (`tauri.conf.json:76`) Rust-side; **production CSP `connect-src` UNCHANGED** (`tauri.conf.json:47` — `'self' ipc:`; no webview-reachable HTTP) | Supersedes the 2026-07-11 zero-outbound audit BY OWNER DECISION. Receipts + remote-rules fetch stay dark; Tier 1 case intelligence is approved design only and has no runtime module or endpoint; Export leaves only by the user's hand. **Copy/doc truth closed 2026-08-03:** the absolute "nothing leaves your PC" claims that survived the 2026-07-22 arming are gone from both locales, `docs/PRIVACY.md` is at v0.3, and `src/outbound-claim-guard.test.ts` now fails the build if any absolute offline claim ships while ANY outbound surface is live (was receipts-only, which is why the updater arming fired nothing). |
| **Local support evidence (Q5)** | **BACKEND + UI ON `main`, no gate flag — the record is always written. SIGNED OFF 2026-08-04:** the surface's visual self-review PASSed on the installed `5ff6963` release build (9/9 rubric items, live captures at the owner's real resolution). The first review FAILed item 6 — the always-visible meta line rendered the internal `<path>` redaction mask as if it were a location, because the location went through the same aggressive `redact_paths()` as free-text detail; `display_location` now emits `%APPDATA%\Compy\support`, pinned by a Rust guard **and** by `SupportEvidence.test.tsx`'s "names a location the user can open" test. One noted non-defect: **clear** is not preview-gated the way **export** is — it substitutes a stated consequence plus a two-step confirm (pre-existing design, unchanged). | `record` — `support_evidence.rs:408`; caps `MAX_BYTES` — `support_evidence.rs:58`; `preview_support_evidence` — `support_evidence.rs:702`, `export_support_evidence` — `support_evidence.rs:728`, `clear_support_evidence` — `support_evidence.rs:765`; `SupportEvidence` — `SupportEvidence.tsx:26` | Bounded rotating JSONL at `%APPDATA%\Compy\support\evidence.jsonl` — a NEW data location, hard-capped at 400 records / 250 KiB (`MAX_EVENTS × MAX_RECORD_BYTES`), redacted at write **and** again at export. **Not a new outbound surface:** there is no transport at all; export writes a file the user hands over by their own action, and `src/support-evidence-outbound-guard.test.ts` fails the build if a send path appears. Export is preview-gated in Rust (refuses until `preview_support_evidence` ran this session); the UI mirrors that by not rendering the save control until a preview returns. Published caps in `docs/PRIVACY.md` + `site/privacy.html` are pinned to the constants by `src/privacy-data-dir-guard.test.ts`. |

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
- Rollback resolves from `history.json` alone, never the live catalog (`resolve_rollback` — `actions.rs:4684`).
- Ledger save is crash-safe atomic temp-write+rename, test-pinned (`save_history_to` — `history.rs:390`).
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
| Publish of the current fleet build | **CLOSED for v0.9.24 - published 2026-08-13T21:29Z under explicit owner GO ("send out the most current working version of the app to the tester"), transaction 9/9, alias verified on attempt 1 in 3.5s; `published_*` anchors carry the artifact truth. First fleet build carrying the design foundation (TYPE-1 + COLOR-1 + UX-1), and the second in a row where the desk look FAILED first and was fixed before anything shipped.** Prior close, v0.9.18: **published 2026-08-13T06:57Z under explicit owner GO ("go"), transaction 9/9, alias converged after the documented edge-cache delay.** Prior close, v0.9.17: **CLOSED — published 2026-08-12** under owner GO ("i permit you to proceed with everything yourself"). Transaction complete 9/9; public installer + `latest.json` byte-match the signed receipt; updater signature verifies against the pinned key; the latest-alias converged on the first check. **First published build that was visually reviewed on the installed binary before shipping** — and the first review round FAILED, which is the only reason that step is worth having. Supersedes the v0.9.15 publish (also closed 2026-08-12), v0.9.12 (2026-08-03) and v0.9.11 (2026-07-28). Any *future* candidate still needs its own owner GO/NO-GO after local preparation. |
| Tester distribution of the published build | **CLOSED — A0 canary PASS.** A tester updated through the normal public updater and runs v0.9.11 with no reported failure, proving the fleet path end-to-end on a machine that is not the owner's. Widening to the remaining invitees is an owner distribution call, not a blocker. |
| Hosted CI | **NOT A BLOCKER — settled OFF by owner decision (2026-07-16).** Listed here only so its absence is never re-read as an unresolved gate. Local gates are the verification path. |
| Data-root integrity (#130) | **RESOLVER LANDED, OWNER DESK RECOVERED 2026-08-18.** `src-tauri/src/data_root.rs` resolves the persistence root by where it LANDS (final path + NTFS identity), not by the `APPDATA` string, and issues `MutationRoot` - the capability `history.rs`/`actions.rs` now require - only for a verified canonical root. The owner-approved option-B recovery RAN on 2026-08-18: union merge of the split Trust Ledger (3 + 61 -> **64 receipts**, zero id collisions, both inputs hash-verified and backed up to `C:UsersKuyacodecompy-data-root-recovery`), then the packaged-Claude overlay `Compy` folder MOVED (never deleted) to `overlay-Compy` in the same archive. The resolver re-run on the desk now returns **`Canonical`**, so applies and rollbacks are unblocked here. Guards: 17 unit + `scripts/data-root-guard.test.mjs` + PowerShell preflight parity (`scripts/lib/canonical-data-root.ps1`, verified passing on the desk post-merge) + 15 merge-tool guards. Not a publish blocker. **SHIPPED to the desk 2026-08-18** in the `421657a9` build - the resolver is present in the installed `%LOCALAPPDATA%\Compy\compy.exe`, so the interim "launch from Desktop/Start menu only" restriction is LIFTED. |
| Code signing | **OPEN** — gates PUBLIC release (Azure Trusted Signing route, owner/$-gated). |
| Legal (EULA + privacy) | **OPEN** — gates PUBLIC release. DRAFTS only. |
| Receipts security review + consent UI + payload preview + kill switch | **OPEN** — gates arming Receipts telemetry. |
| Preload-app removal live QA + owner-curated list | **OPEN** — gates arming preload-app removal (built DARK, not a ship blocker). |
| Aggregate-stack trial live QA | **OPEN** — gates arming the §2a stack trial (built DARK, not a ship blocker). |
| Remote-rules production key + CDN + staged rollout | **OPEN** — gates arming remote fetch. |
| v0.9.10 release debris | **CLOSED — deleted 2026-07-28** under owner authorization (draft `360948018` + releases-repo tag). Source tag `92c7608`, recovery branches and local evidence preserved. |

**No active blocker remains on the v0.9.15 release train** — it is complete 9/9, the v0.9.11 canary
passed on the same updater path, and the debris is cleared, so **normal product development may
resume.** Every row still marked OPEN above gates a *future* PUBLIC (store/marketing) release or the
arming of a dark feature; none of them blocks the shipped v0.9.15 build or the work that follows it.

**✅ VERSION DEBT — PAID 2026-08-12.** The debt was a tree declaring a version no signed cut existed
for, so desk work could not reach a tester. It is closed: v0.9.15 was built **with**
`TAURI_SIGNING_PRIVATE_KEY`, published, and the updater manifest now offers it. The debt reopens the
moment the next bump lands without a publish — the honest name for that state is a *candidate*, and
`STATE:candidate_published` is the anchor that says which it is.

## Required owner decisions (live)

**Closed 2026-08-13 (UTC):** candidate v0.9.18's publish GO/NO-GO. The owner said "go" with the
desk-ship evidence in front of him (screenshots of the look, the #121 record, the runtime proof) and
v0.9.18 published at 06:57 UTC on 2026-08-13, transaction closed - `published_*` anchors above carry
the truth. (Written date-first with no ISO zulu suffix on purpose: the checker's decisions-section
regex ends the section at the first zulu letter it meets - issue #123 has the fix-forward.) The one
deferred look (the mid-apply consent panel, unreachable at 9/9-applied) transfers to the first real
apply, not to a decision.

1. **Candidate v0.9.26 publish GO/NO-GO - GO GIVEN 2026-08-19 in chat ("the fleet-move GO"), OPEN until the transaction closes.**
   The fleet has been three lanes behind the
   desk since v0.9.25 (published `efde8310`) while the desk ran unsigned builds carrying the
   data-root resolver, the CPU-temp offer, the C-10/C-11/C-17 conformance work and the #127 idle-CPU
   fix. This candidate re-cuts from `main` with the signing key and closes that gap. What the owner
   is saying yes to, in his words back to him: testers get a build that costs about half as much CPU
   sitting idle, a front door that answers what is wrong with the PC, CPU temperature out from
   behind Advanced, and a Trust Ledger that can no longer split across two folders. The GO covers
   the publish; it does not waive any gate, and the transaction still has to close 9 of 9 on its own
   evidence.

2. **Candidate v0.9.25 publish GO/NO-GO - CLOSED 2026-08-13, published 22:34Z, transaction 9 of 9.**
   (Date-first, no zulu suffix, per #123.) Two defects neither the suite nor a reviewer caught, both
   found by people: the owner reported v0.9.24 "runs a lot slower than before", and tester Jaikaran
   reported on v0.9.12 that written feedback vanishes when he leaves Settings - still reproducible in
   v0.9.24 source. `36d3a0c7` fixes both. The update-pill LED animated `box-shadow` forever in the
   shell topbar, in the update-AVAILABLE branch that is every out-of-date tester's resting state, so
   the main thread repainted every frame on every screen; it now rides an `::after` layer on
   transform+opacity. The feedback draft now persists through safe-storage and survives the Settings
   unmount. Both guards were proven able to FAIL by reintroducing each defect before the fix landed.
   The owner's GO for this lane was "lets get as much of the important stuff done that we can and
   the update sent to the testers", and both look captures went to him before the publish ran.
   Release id `370249321`, alias attempt 1; `published_*` above carries the artifact truth.
   **What this release does NOT close: the owner's own slowdown report.** He is on the newest build,
   so his update pill never enters the AVAILABLE state and never pulsed - the fix cannot be the
   cause of what he felt. That remains open with ranked candidates (the app-wide switch to the
   bundled Geist variable font plus the 14px->15px base bump is the best fit) and a named tool to
   settle it: `node scripts/q7-probe.mjs attribute`. Do not report it as fixed.
2. **Candidate v0.9.24 publish GO/NO-GO - CLOSED 2026-08-13, published 21:29Z, transaction 9 of 9.**
   (Date-first, no zulu suffix, per #123.) The owner's GO was "send out the most current working
   version of the app to the tester"; both look captures, the runtime proof and the note that the
   FIRST look had failed went to him before the publish ran, and the alias verified on attempt 1.
   `published_*` above carries the artifact truth. This also closed **v0.9.22's** GO, which was
   still open when UX-1 superseded it. Kept here for the record — it was
   the cumulative front-door candidate. It carries design-foundation **step ②, UX-1** (the Home h1 is
   now the verdict at 40px, the room title "Home" is deleted, the because-line moved directly
   beneath it, and "What are you here to do?" became the screen's single primary button opening the
   intent panel in place) **on top of everything v0.9.22 already held**: step ① TYPE-1 (six-step
   type scale, 13px floor) + COLOR-1 (rooms give up their hue), the update-pill attention state,
   the in-app What's-new list, and the arc-gauge ring-overflow fix the v0.9.19 desk look caught
   (`64fe3579`). **v0.9.22 was never published** — it was installed, proved and visually reviewed
   PASS on the desk, and its GO was still open when UX-1 landed, so this candidate supersedes it
   and one GO now covers both. **v0.9.23 is desk-only and spent: it shipped UX-1 and the look
   FAILED on the verdict's type step** (a `home-hud.css` selector outranked the console's own h1 —
   see the owner-installed row); the fix plus its static guard ride v0.9.24, and v0.9.23 is never
   published. v0.9.19 is desk-only and spent; **0.9.20 and 0.9.21 were burned by failed
   re-prepares** (each prepare mints configured+1 — a re-prepare after a failure must pre-declare
   the NEXT number, not reuse one; nothing of 0.9.20/21 was installed or published). Desk ship +
   visual review first; publish only on an explicit owner GO given to exactly ONE lane.
3. **Widening the invitee fleet onto the published build (now v0.9.18)** — the publishes themselves are **CLOSED** (v0.9.17 then v0.9.18, both 9/9). What is left
   was never a pipeline question: **whether/when the remaining invitees move onto the updater path.** Six people hold the hand-sent
   0.9.0 link and would each have to install once by hand to join it; everyone already on it is offered v0.9.18 automatically. Every
   stated precondition is met — the v0.9.11 canary PASSED on the normal updater path and at least two testers auto-updated onto
   v0.9.12 unaided — so this is a distribution call, not a readiness one. **Owner territory: it means naming humans and messaging
   them.** Worth saying when you do: v0.9.17 renamed three rooms a returning tester already learned and nothing in the app
   tells them the names changed.
4. Code-signing route + legal finalization (PUBLIC gates).
5. When/whether to arm Receipts (its own security review + owner sign-off).
6. Tier 1 case-intelligence direction is approved. Do not re-ask that product decision; bring back
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
