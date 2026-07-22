# RELEASE_STATE.md â€” Compy single-source-of-truth gate matrix

> **This file is the AUTHORITATIVE current-truth snapshot of every gate, artifact, and release
> blocker.** When any other doc (CLAUDE.md banners, RELEASE_QA.md, PACKAGING_SIGNING_PLAN.md,
> GATE_DECISIONS.md) disagrees with this file about *current state*, **this file wins** â€” fix the
> other doc. Created 2026-06-26 in response to an external source-level audit that flagged
> state/documentation drift as the project's #1 risk. Keep it current: update it in the SAME commit
> that flips any gate, arms any feature, or rebuilds the installer. Every row carries a `file:line`
> so it can be re-verified in seconds, never asserted from memory.

## CURRENT STATE (authoritative â€” read this first)

> This block is the single reconciled current-truth summary. It deliberately keeps **five distinct
> identities** that an earlier revision of this block collapsed into one "HEAD" line:
> **(1) newest locally verified installed build** (a static fact about the exe on the OWNER's disk) Â·
> **(2) current corrective source train** (a static, reviewed commit) Â· **(3) historically distributed
> private-beta artifact(s)** (more than one private build has left this machine â€” at least the `fc940fe`
> kit AND the frozen `16069fa` source ref; `16069fa` was **not** the only one) Â· **(4) current
> tester installs + old share-link reachability** (**UNKNOWN** â€” owner-confirmable only; no telemetry to
> read it from here) Â· **(5) `origin/main` tracking ref vs the remote server** (a LOCAL cached pointer
> that can lag the server until `git fetch`; the ahead/behind counts are *derived by running git* and go
> stale the instant anyone commits or pushes). **No static hash in this block is "the current HEAD."** A
> commit hash names a fixed point in history; "current HEAD" is a *live* pointer you learn only by
> running `git rev-parse HEAD` at read time. **The row-5 ahead/behind integers are deliberately NOT
> committed here** â€” they are volatile and were stale within one commit last time; **derive them live on
> read, and `git fetch` before trusting the `origin/main` comparison.** The dated `UPDATE â€¦` banners in archive/RELEASE_STATE_HISTORY.md are a reverse-chronological LOG
> of individual trains, **not** current state; where a banner disagrees with THIS block, this block wins.
> Reconciled 2026-07-20: the audit-corrective train (`c1071c1..05f0ce4`) was **pushed to `origin/main`
> via fast-forward** this date â€” an **AUDIT-CORRECTIVE closure, NOT a release closure**: no gate flipped,
> no build, no ship to another machine, no Windows-state change. Push â‰  ship.
> **Updated 2026-07-20b (release-validation build):** HEAD `37a166c` â€” which now subsumes that train and the
> whole `75c38c6..37a166c` accumulation (Measurement Platform 2.0 + Home masthead/intake, 20 commits) â€” was
> **release-built AND silently reinstalled onto the OWNER's own machine** via `scripts/ship-reinstall.ps1`.
> So the row-2 code is **no longer "NOT built"**: it is **built + installed on the owner's machine, still
> NOT distributed** to any other machine (directive step 12 held â€” no tester send, no share-link change). The
> installed build (row 1) now **EQUALS** HEAD. This was a **release-VALIDATION** pass on the owner's box, not
> a tester/public release: no gate flipped, no new outbound boundary, the mutation/rollback modules
> byte-identical across the delta, and no live apply/rollback exercised *in that pass* (closed later the same
> date â€” next paragraph).
> **Updated 2026-07-20c (RUNTIME CLOSURE â€” this update ships as a DOCS-ONLY commit):** the two runtime items
> 20b left open are **CLOSED on the installed `37a166c` build itself**: the **orphaned Gaming Mode session**
> `gm-1784436112238` was recovered through the app's own **Restore** path (owner-clicked; restore completed
> clean â€” session file cleared, no quarantine, ledger consistent), and a **live rollback â†’ reapply cycle ran through
> the installed release UI** on the benign Windows Game Mode rec (HKCU, non-elevated, zero UAC; ledger 55 â†’ 56,
> new entry `game-mode-1784599052740` with the full typed rollback contract; machine left in its original
> Game-Mode-ON state). **Private beta = GO for invite-only distribution** (the send itself stays an owner
> action â€” nothing has been distributed); **public release stays BLOCKED** on Code signing + Legal. This
> closure commit is **documentation-only**: it advances HEAD one commit past `37a166c` with zero
> source/product/version/gate delta â€” the **validated binary source remains `37a166c`**, the installed NSIS
> SHA-256 `6BC2F7DFâ€¦F5A2C4` is unchanged, and **no rebuild/reinstall is warranted by a docs-only HEAD
> advance**. Still open, honestly: elevated mutation/rollback not exercised this pass Â· NVIDIA sensor lane not
> hardware-verified Â· multi-rec batch apply not runtime-exercised Â· live Codex hook activation pending
> (unrelated to the Compy binary). Full evidence: the 2026-07-20c snapshot entry (archive/RELEASE_STATE_HISTORY.md).
> **Updated 2026-07-22b (LIVE Â§6 SMOKE CATCH â†’ FIX SHIPPED TO THE OWNER'S BOX):** during the owner's live
> Marvel Rivals Â§6 sitting on `37a166c`, HQ caught the FPS dominant-presenter picker attributing capture to an
> empty-named elevated `dwm.exe` presenter at fabricated rates (OpenProcess failure â†’ `""` name â†’ bypassed the
> name-keyed denylist). Fixed in **`f96347d`** (`select_game_presenter` excludes empty-named candidates + 2
> regression tests; cargo 858/858), ship-script elevated-helper kill-denial fixed in **`970f801`**, rebuilt +
> silently reinstalled same day â€” **the owner's live build is now `970f801`** (row 1). Helper self-exit
> verified live after a real stop (Â§6 exit box: PASS). **The DISTRIBUTED artifact stays the `37a166c` NSIS**
> (rows 3â€“4 â€” the link the six invitees hold) â€” no send, no link change; refreshing the kit is an owner send
> decision. Secondary finding (BACKLOG `34bd173`): between matches, desktop DXGI presenters (Discord etc.) can
> win attribution â€” **CLOSED 2026-07-22c:** the fail-closed sticky-attachment fix shipped in `775c9bb`
> (positive window-evidence game ID + attach hysteresis; ambiguous/non-game presenters emit NOTHING;
> attachment releases only on process death/pid-recycle; 8 guard tests) — riding the 0.9.1 train, not
> yet built/installed anywhere (row 2).

| # | Identity (kept distinct on purpose) | Current truth | How verified |
|---|---|---|---|
| 1 | **Newest locally verified installed build** â€” static fact about the exe on the OWNER's disk | `970f801` â†’ **`Compy_0.9.0_x64-setup.exe`**, installer SHA-256 `4B59783069EB7C4C878D2D088A62FF9A1FF621FAA1BC62486328FC5AAF4E64DB` (3,825,592 B). **Built + silently reinstalled 2026-07-22** via `scripts/ship-reinstall.ps1`; the installed exe (`%LOCALAPPDATA%\Compy\compy.exe`) byte-embeds `970f801`; ONE Compy installer on the Desktop. Delta vs the prior installed `37a166c`: the Â§6 presenter-picker fix `f96347d` (empty-named/dwm presenter can no longer win dominant-presenter attribution â€” caught live during the owner's Marvel Rivals smoke sitting; 2 regression tests, cargo 858/858) + the ship-script drain fix `970f801` + docs/BACKLOG commits. **This reinstall creates a deliberate split: the owner's box runs `970f801`, but the DISTRIBUTED 0.9.0 artifact (rows 3â€“4, the link the six invitees hold) is still the `37a166c` NSIS SHA-256 `6BC2F7DFâ€¦F5A2C4`** â€” refreshing the kit/link is an owner send decision, not implied by this reinstall. The 2026-07-20c runtime closure (live rollback â†’ reapply + orphan Restore) was performed on the superseded `37a166c` build â€” see snapshot history. This row is **NOT** a claim about what any *other* machine runs (rows 3â€“4). | Embedded-hash byte-scan of the installed exe (read-only, `Select-String` for the shorthash) + `ship-reinstall OK` output with installer SHA-256 |
| 2 | **Current corrective source train** â€” static; a *reviewed* commit, NOT a live pointer | **Updated 2026-07-22c:** the newest reviewed code is the **0.9.1 correction train** — `775c9bb` (fail-closed FPS sticky-attachment fix + monitoring freshness gate + CPU thermal-peak; cargo 869/869 · vitest 1777/1777 claimed at commit, re-verify on the reconciled tree) plus **two parallel 0.9.1 version-bump commits**: `5ed7d4e` (local `main`) and `5d396f9` (pushed to `origin/main` from the rel091 worktree) — the lanes bumped independently, so local and remote main have DIVERGED; reconcile by **merge, never force-push**, then re-derive row 5 live. **NOT built, NOT installed, NOT distributed:** the owner's box stays `970f801` (row 1) and the distributed artifact stays the `37a166c` NSIS (rows 3–4) until the 0.9.1 build passes its own smoke. *Superseded record (2026-07-20b/c):* `37a166c` — then HEAD = `origin/main`, the newest *reviewed* code on `main` (subsumes the audit-corrective train **and** the `75c38c6..37a166c` Measurement-Platform-2.0 / Home-masthead-intake accumulation â€” 20 commits). **As of 2026-07-20b it is BUILT + installed on the owner's machine (row 1) â€” still NOT distributed to any other machine (step 12 held).** **As of 2026-07-20c the newest commit on `main` is a DOCUMENTATION-ONLY runtime-closure commit stacked ONE past `37a166c`** (this file's closure records; zero source/product/version/gate delta) â€” **`37a166c` remains the validated binary source**, and a docs-only HEAD advance does **NOT** obligate a rebuild/reinstall (row 1 unchanged). | `git log --oneline origin/main..HEAD` (empty â‡’ in sync; read at review time) |
| 3 | **Historically distributed private-beta artifact(s)** â€” what other machines were actually handed | The repo records prove **more than one** private build left this machine: `16069fa` / `beta/private-beta-001` (the OLD verified **unsigned** private beta, frozen ref, never to be moved) **AND** a later kit cut from **`fc940fe`** â€” an NSIS `Compy_0.1.0_x64-setup.exe`, SHA-256 `5F2549E7EDD6BC94440D3C24ECCC0CB784005DAC520DE2490BB81F3260021F18`, hosted on Google Drive and DM'd to testers (`docs/CHANGELOG.md:378-391`, `docs/archive/cowork-handoff-board-2026-06.md:354-356`); `fc940fe` is 349 commits after `16069fa`. So the earlier claim that `16069fa` was the *only* build ever handed to another machine is **FALSE**. A frozen *source* ref does not prove which *binary* a tester received; the **exact last artifact each tester installed is UNKNOWN pending owner reconciliation** (row 4). **2026-07-22: the `37a166c` 0.9.0 NSIS (SHA-256 `6BC2F7DFâ€¦F5A2C4`) was DISTRIBUTED invite-only** â€” the owner sent the recorded Drive link to six invitees (Matcher Â· Chinaman Â· J Â· Zoid Â· Sultan Â· Majin; `BETA_DISTRIBUTION_RECORD.md`), after the same-morning wrong-link send of the stale kit was corrected (old link killed + file renamed; sent link re-verified unauthenticated post-send, hash exact). **Public:** **NONE** â€” no public download, store listing, or signed public artifact (gated on **Code signing** + **Legal**, both OPEN in *Release blockers*). | Repo records (CHANGELOG + archived handoff board) + frozen ref; exact tester binary owner-confirmable only |
| 4 | **Current tester installs + old share-link reachability** â€” old link RE-KILLED 2026-07-22 AM (first kill did not hold); tester installs still UNKNOWN | **Old share-link: RE-KILLED 2026-07-22 AM â€” the first (2026-07-21) restriction did NOT hold.** The `fc940fe`-era `Compy-Beta-Kit.zip` (fileId `1dphNbBkoJSbCPOWiUVy-y6iz25t9nMEO`) was confirmed still shared **anyone-with-link** (direct-download endpoint HTTP 200) as of 2026-07-21/22, then link-sharing was removed 2026-07-22 (`General access: Restricted`, confirmed via Drive UI + `get_file_permissions`) â€” the stale build can no longer be installed from that link. **INCIDENT ADDENDUM 2026-07-22 AM:** that restriction did NOT hold â€” Drive Activity shows a re-share (anyone-viewer) at 9:16 PM on 2026-07-21 (API-corroborated) which stayed open overnight — measured OPEN ~8:10 AM PDT 2026-07-22 (the Activity entries that appeared to show a same-night re-restrict were display-mislabels of the morning kill itself; that panel's timestamps proved untrustworthy — see the distribution record's corrected incident block) (`anyone:reader`; unauthenticated download served the zip bytes), during which window the stale link was sent out as the beta link (the wrong-build alert). Re-killed ~8:30 AM PDT 2026-07-22, verified 3 independent ways, and the file renamed in place to `RETIRED-DO-NOT-SEND_Compy-Beta-Kit_OLD-0.1.0-June.zip` (same fileId, dead link) â€” full incident + the new MANDATORY SEND RULE live in `BETA_DISTRIBUTION_RECORD.md`. **What any private-beta tester currently runs is still NOT knowable from here** â€” no telemetry (zero-outbound), no local record, still pending owner confirmation; do not assert testers are on any specific build. **2026-07-22 ~9 AM PDT: six invitees (distribution record) now HOLD the verified 0.9.0 link** â€” the owner's correction DM went to all six and the exact sent link re-verified unauthenticated post-send (SHA-256 exact); what each has actually *installed* stays unknown until they report. | Live Drive API check (`get_file_permissions`) + unauthenticated `curl` before/after (2026-07-22); tester-install state still unknowable without an owner report |
| 5 | **`origin/main` tracking ref vs the remote server** â€” LOCAL cache; may lag the server | **Post-push (2026-07-20):** the audit-corrective train `c1071c1..05f0ce4` **landed on the server via fast-forward** (`408c860..05f0ce4`, no force); `origin/main` advanced from `408c860` to `05f0ce4` and HEAD is **in sync** at that tip. Numbers still go stale on the next commit â€” `git fetch` and re-derive live before trusting. **As of 2026-07-20b, HEAD `37a166c` = `origin/main` = the installed build (row 1)** â€” the prior "HEAD ahead of the installed build (`75c38c6`)" gap is **closed** (verified live: `git rev-list --left-right --count origin/main...HEAD` = `0  0`; `75c38c6..HEAD` = 20). **As of 2026-07-20c HEAD advances ONE docs-only closure commit past `37a166c`** â€” committed locally; the push follows owner approval of that exact diff, so `origin/main` stays `37a166c` until it lands; the installed build (row 1) stays `37a166c` either way. **The exact ahead / installed-distance integers are deliberately NOT committed here** â€” they are volatile (they change on every commit and push) and were stale within one commit the last time this row baked them. Derive them live at read time with the commands at right; tie any snapshot you record to the exact `HEAD` commit it was taken at, and `git fetch` before trusting the `origin/main` comparison. **2026-07-22c: the 0.9.1 train DIVERGED local-vs-remote** (`5ed7d4e` local · `5d396f9` on the server — parallel lanes, same version files); reconcile by merge (no force-push) and re-derive the counts live — do not trust any baked integer from before the merge. | `git rev-parse origin/main` (local ref) Â· `git rev-list --left-right --count origin/main...HEAD` (ahead/behind) Â· `git rev-list --count 75c38c6..HEAD` (installed distance) â€” **`git fetch` first to compare to the server** |

**Bottom line â€” 2026-07-22b update first:** the owner's live installer is now **`970f801`** (the Â§6 presenter-picker fix + ship-script drain fix â€” see the 22b paragraph above); the paragraph below describes the superseded `37a166c` state and stays as the record of that pass. The distributed artifact (rows 3â€“4) is unchanged by the 22b reinstall. **22c:** the 0.9.1 correction train (`775c9bb` + the two parallel bump commits, row 2) is reviewed-and-committed but **NOT yet built/installed/distributed** — rows 1 and 3â€“4 stand until the 0.9.1 build passes its own reinstall + smoke and the owner gives the replacement-send GO.

**Bottom line (updated 2026-07-20b):** the owner's live installer is now **`37a166c`** â€” HEAD = `origin/main` = the installed build are all the **same** commit; the `75c38c6`â†’`37a166c` accumulation (20 commits: Measurement Platform 2.0 + Home masthead/intake) was **release-built AND silently reinstalled onto the owner's machine** this date. So the older "nothing newer than `75c38c6` has been built" line is **retired** â€” `37a166c` IS built + installed here. **Distribution is still ZERO, though:** nothing newer than the historical private-beta kits (row 3) has been sent to any *other* machine â€” this was a release-VALIDATION pass on the owner's own box (step 12 held: no tester send, no share-link change). The earlier audit-corrective train (`c1071c1..05f0ce4`) **was pushed to `origin/main` via fast-forward on 2026-07-20** and is now subsumed by `37a166c` â€” that push was an **audit-corrective closure, NOT a release closure** (push â‰  ship); the subsequent 2026-07-20b build is what put this code on the owner's disk, and it too shipped to **no other machine**. At least **two** private builds were handed to other machines historically â€” the frozen unsigned private beta `16069fa` **AND** a later kit cut from `fc940fe` (row 3) â€” so `16069fa` was **not** the only one; **what testers currently run and whether the old share link still resolves are UNKNOWN pending owner confirmation.** `origin/main` (`37a166c`) is a LOCAL tracking ref that may lag the server until a `git fetch`. **No gate flipped and no new outbound boundary across `75c38c6..37a166c`:** the verified zero-outbound property and every LOCKED gate still hold (delta confirmed: 11 mutation modules byte-identical, IPC `#[tauri::command]` count 90â†’90, no capabilities/CSP change, no new outbound-network code). All ahead/behind numbers are tooling-derived â€” re-run the commands above (and `git fetch` for the server) rather than trusting them. **Update THIS block in the same commit that ships or flips a gate; a PUSH is verified/refreshed AFTER it lands** â€” re-derive the row-5 counts (and `git fetch`) once the remote has the commit, since the tracking ref only advances post-push. **2026-07-20c runtime closure:** the installed `37a166c` build itself passed the two live checks 20b had deferred â€” the orphaned Gaming Mode session `gm-1784436112238` recovered through the app's own Restore path (owner-clicked), and a live **rollback â†’ reapply** cycle ran through the installed UI on the Windows Game Mode rec with a field-perfect Trust-Ledger round-trip (55 â†’ 56 entries, zero UAC, machine left in its original Game-Mode-ON state). **Private beta: GO for invite-only distribution** â€” the send itself remains an owner action (ships-to-others stop; step 12 still held, nothing distributed). **Public release: still BLOCKED** on Code signing + Legal (Release blockers). The closure lands as a **documentation-only commit** advancing HEAD one past `37a166c` with zero product delta â€” the validated binary source and the installed NSIS SHA-256 (`6BC2F7DFâ€¦F5A2C4`) are unchanged, and **no rebuild/reinstall follows from a docs-only HEAD advance**.

## Gate matrix

> **Restored 2026-07-22c.** The same-day diet (`f21c170`) cut this matrix and the Release-blockers
> section along with the history — the diet's job was history only; the live matrix is required
> content (CURRENT STATE row 3 and the bottom line both reference it). Restored from the pre-diet
> copy (`181be2a`) and **re-verified at source this date: all 10 gate functions re-read, every state
> unchanged** (no gate module was touched by any commit since `181be2a` — the deltas were docs +
> the fps/monitoring/sessions 0.9.1 feature train). `scripts/verify-release-state.mjs` now FAILS
> if this section, CURRENT STATE, or Release blockers is missing, or if the file carries zero
> `file:line` citations — the diet-cut class can't silently recur.

| Gate / capability | State | Source | Notes |
|---|---|---|---|
| **Gaming Mode (F1)** | **LIVE** (`true`) | `gaming_mode_gate()` — `lib.rs:518` | Flipped on 2026-06-18 w/ owner sign-off. §7 QA harness (6 scenarios) passed; **GAMING_MODE_QA.md live checklist 10/10 PASSED 2026-07-14**. **Owner SIGNED OFF 2026-07-14** — F1 is field-proven for 1.0. |
| **Service-suspend** | **ARMED** (`true`) | `service_suspend_gate()` — `actions.rs:2029` | Armed 2026-06-25. Live running-service exact-restore + UAC-cancel=no-partial + critical-service block proven. Session-start suspends and restores both ride the ONE batched elevation (T6/T6b). |
| **Debloat (telemetry task disable)** | **ARMED** (`true`) | `bloat_removal_gate()` — `actions.rs:2102` | Armed 2026-06-26. Live exact disable→enable restore + off-list/Defender rejected. Fix-surface UI `DebloatTasks`. |
| **Benchmark tweak A/B trial** | **LIVE / UI-reachable, NO dedicated gate** | `start_tweak_trial` — `benchmark_trial.rs:170` | Performs a REAL mutation via the audited `apply_recommendation` path, protected by a `RollbackGuard` (auto-rollback on every exit). |
| **Preload-app removal** | **DARK** (`false`) | `preload_removal_gate()` — `actions.rs:2251` | Built dark 2026-07-06. Command `remove_known_preload_app` refuses while dark; FE card renders nothing (test-pinned). Arming needs live remove→reinstall QA + Store links verified + owner-curated list + sign-off. |
| **Aggregate-stack A/B trial (§2a)** | **DARK** (`false`) | `stack_trial_gate()` — `benchmark_trial.rs:274` | Built dark 2026-07-09 (reuses audited `apply_recommendations_batch` — no new mutation primitive; multi-change Drop-guard rollback; corrupt-ledger read ABORTS pre-mutation). Commands refuse while dark; no FE surface. Arming needs live apply→rollback QA + owner sign-off. |
| **Experiment engine + simulator (Intelligence P3)** | **ARMED** (`true`, 2026-07-17) | `experiment_gate()` — `experiment.rs:55` | Armed after owner sign-off + live apply→rollback round-trip on this rig. Orchestrates the audited mutation boundary — no new apply/rollback primitive; resolve stays history-only. Simulator reads the catalog READ-ONLY; unknown rec ⇒ honest insufficient-evidence. |
| **Leftovers restore** | **ARMED** (`true`, 2026-07-16) | `restore_gate()` — `leftovers.rs:730` | Armed after owner-present live-UAC QA (all 3 loops PASS); receipts ride the Trust Ledger with provenance `leftover_adopted`. No FE caller yet. |
| **Receipts telemetry** | **DARK** (`false`) | `receipts_gate()` — `receipts.rs:18` | No send path/endpoint/queue; preview refuses; payload sanitized+bucketed. New outbound boundary → own security review + owner sign-off before arming. |
| **License / Pro enforcement** | **DISARMED — nothing enforced** | `licensing_armed()` — `license.rs:40` (all-zeros key) | Plumbing wired end-to-end but inert; `ProGate` renders everything free. No Windows mutation, no phone-home. |
| **Signed remote rules / fetch** | **OFF** (`false`) | `remote_fetch_enabled()` — `remote_rules.rs:97`; all-zeros pubkey `remote_rules.rs:85` | Double-gated: `verify_chain` (`remote_rules.rs:231`) ALSO hard-fails on the placeholder key. Ed25519 verify is real but never runs in shipped builds. |
| **Auto-updater** | **OFF / absent** | no `plugins`/`updater` block in `tauri.conf.json`; no updater dep in `Cargo.toml` | — |
| **Outbound network** | **NONE** | no HTTP client anywhere in `src-tauri/src` or `Cargo.toml` (2026-07-11 whole-tree audit); **production** CSP `connect-src` (`tauri.conf.json:46`) is `'self' ipc: http://ipc.localhost` — dev-only `devCsp` (`tauri.conf.json:51`) not shipped | Verified-zero-outbound property holds while Receipts + remote-fetch stay dark. |

## Mutation safety posture (unchanged LOCKED rules)

- No kernel driver · no game injection · rollback-first · typed mutation allowlist
  (`KnownService`/`KnownBloatTask`/`AppliedAction`/`RollbackAction`/`Snapshot`, unknown inputs rejected).
- Rollback resolves from `history.json` alone, never the live catalog (`history.rs:818`→`actions::resolve_rollback`).
- Ledger save is crash-safe atomic temp-write+rename, test-pinned (`save_history_to` — `history.rs:332`).
- Elevation: relaunch `compy.exe --run-elevated <hex> <ticket>` (windowless), 4-way honest UAC
  outcome attribution (`elevation_outcome` — `actions.rs:964`); the helper runs ONLY hex
  byte-matching the one-time dispatch ticket (`mint_elevation_ticket` — `actions.rs:1149` ·
  `consume_elevation_ticket` — `actions.rs:1171` · `run_elevated_helper` — `lib.rs:76`).
- Gaming-session advanced tier batches to ONE elevation per session start and per restore
  (T6/T6b; `apply_elevated_tier` — `gaming_orchestrator.rs:201`). No-partial abort+restore
  contract unchanged; UAC-decline drops only verifiably-never-ran staged entries
  (`elevation_error_nothing_ran` — `actions.rs:988`).

## Release blockers

| Item | Status |
|---|---|
| Private-beta functional blockers | **NONE** — the installed-build QA + runtime closure (2026-07-20b/c, on `37a166c`) ⇒ **GO for invite-only private beta**; the 0.9.0 send happened 2026-07-22 (rows 3–4). The 0.9.1 correction train needs its own build/install/smoke before any replacement send. |
| Code signing | **OPEN** — gates PUBLIC release (Azure Trusted Signing route, owner/$-gated). |
| Legal (EULA + privacy) | **OPEN** — gates PUBLIC release. DRAFTS only. |
| Receipts security review + consent UI + payload preview + kill switch | **OPEN** — gates arming Receipts telemetry. |
| Preload-app removal live QA + owner-curated list | **OPEN** — gates arming preload-app removal (built DARK, not a ship blocker). |
| Aggregate-stack trial live QA | **OPEN** — gates arming the §2a stack trial (built DARK, not a ship blocker). |
| Remote-rules production key + CDN + staged rollout | **OPEN** — gates arming remote fetch. |

## Required owner decisions (live)

1. **0.9.1 replacement send** — after the 0.9.1 build passes its smoke: GO/NO-GO on sending the
   corrected installer to the six 0.9.0 invitees (send = owner action, always).
2. Code-signing route + legal finalization (PUBLIC gates).
3. When/whether to arm Receipts (its own security review + owner sign-off).

## Snapshot history - MOVED to archive (2026-07-22)

The full reverse-chronological UPDATE-banner log (every dated banner, byte-preserved) lives in
[archive/RELEASE_STATE_HISTORY.md](archive/RELEASE_STATE_HISTORY.md). It had grown to 1,300+ lines of
pure history - explicitly superseded by CURRENT STATE above - re-read and re-cached by every session
that touched this file. APPEND new dated banners to the TOP of the archive; keep THIS file to CURRENT
STATE only (budget: 300 lines, enforced by scripts/doc-budget.ps1 - run it in every verify pass).
