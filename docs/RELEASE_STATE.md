# RELEASE_STATE.md — Compy single-source-of-truth gate matrix

> **This file is the AUTHORITATIVE current-truth snapshot of every gate, artifact, and release
> blocker.** When any other doc (CLAUDE.md banners, RELEASE_QA.md, PACKAGING_SIGNING_PLAN.md,
> GATE_DECISIONS.md) disagrees with this file about *current state*, **this file wins** — fix the
> other doc. Created 2026-06-26 in response to an external source-level audit that flagged
> state/documentation drift as the project's #1 risk. Keep it current: update it in the SAME commit
> that flips any gate, arms any feature, or rebuilds the installer. Every row carries a `file:line`
> so it can be re-verified in seconds, never asserted from memory.

## CURRENT STATE (authoritative — read this first)

> This block is the single reconciled current-truth summary. It deliberately keeps **five distinct
> identities** that an earlier revision of this block collapsed into one "HEAD" line:
> **(1) newest locally verified installed build** (a static fact about the exe on the OWNER's disk) ·
> **(2) current corrective source train** (a static, reviewed commit) · **(3) historically distributed
> private-beta artifact(s)** (more than one private build has left this machine — at least the `fc940fe`
> kit AND the frozen `16069fa` source ref; `16069fa` was **not** the only one) · **(4) current
> tester installs + old share-link reachability** (**UNKNOWN** — owner-confirmable only; no telemetry to
> read it from here) · **(5) `origin/main` tracking ref vs the remote server** (a LOCAL cached pointer
> that can lag the server until `git fetch`; the ahead/behind counts are *derived by running git* and go
> stale the instant anyone commits or pushes). **No static hash in this block is "the current HEAD."** A
> commit hash names a fixed point in history; "current HEAD" is a *live* pointer you learn only by
> running `git rev-parse HEAD` at read time. **The row-5 ahead/behind integers are deliberately NOT
> committed here** — they are volatile and were stale within one commit last time; **derive them live on
> read, and `git fetch` before trusting the `origin/main` comparison.** The dated `UPDATE …` banners under **Snapshot history** below are a reverse-chronological LOG
> of individual trains, **not** current state; where a banner disagrees with THIS block, this block wins.
> Reconciled 2026-07-20: the audit-corrective train (`c1071c1..05f0ce4`) was **pushed to `origin/main`
> via fast-forward** this date — an **AUDIT-CORRECTIVE closure, NOT a release closure**: no gate flipped,
> no build, no ship to another machine, no Windows-state change. Push ≠ ship.
> **Updated 2026-07-20b (release-validation build):** HEAD `37a166c` — which now subsumes that train and the
> whole `75c38c6..37a166c` accumulation (Measurement Platform 2.0 + Home masthead/intake, 20 commits) — was
> **release-built AND silently reinstalled onto the OWNER's own machine** via `scripts/ship-reinstall.ps1`.
> So the row-2 code is **no longer "NOT built"**: it is **built + installed on the owner's machine, still
> NOT distributed** to any other machine (directive step 12 held — no tester send, no share-link change). The
> installed build (row 1) now **EQUALS** HEAD. This was a **release-VALIDATION** pass on the owner's box, not
> a tester/public release: no gate flipped, no new outbound boundary, the mutation/rollback modules
> byte-identical across the delta, and no live apply/rollback exercised *in that pass* (closed later the same
> date — next paragraph).
> **Updated 2026-07-20c (RUNTIME CLOSURE — this update ships as a DOCS-ONLY commit):** the two runtime items
> 20b left open are **CLOSED on the installed `37a166c` build itself**: the **orphaned Gaming Mode session**
> `gm-1784436112238` was recovered through the app's own **Restore** path (owner-clicked; restore completed
> clean — session file cleared, no quarantine, ledger consistent), and a **live rollback → reapply cycle ran through
> the installed release UI** on the benign Windows Game Mode rec (HKCU, non-elevated, zero UAC; ledger 55 → 56,
> new entry `game-mode-1784599052740` with the full typed rollback contract; machine left in its original
> Game-Mode-ON state). **Private beta = GO for invite-only distribution** (the send itself stays an owner
> action — nothing has been distributed); **public release stays BLOCKED** on Code signing + Legal. This
> closure commit is **documentation-only**: it advances HEAD one commit past `37a166c` with zero
> source/product/version/gate delta — the **validated binary source remains `37a166c`**, the installed NSIS
> SHA-256 `6BC2F7DF…F5A2C4` is unchanged, and **no rebuild/reinstall is warranted by a docs-only HEAD
> advance**. Still open, honestly: elevated mutation/rollback not exercised this pass · NVIDIA sensor lane not
> hardware-verified · multi-rec batch apply not runtime-exercised · live Codex hook activation pending
> (unrelated to the Compy binary). Full evidence: the 2026-07-20c snapshot entry below.

| # | Identity (kept distinct on purpose) | Current truth | How verified |
|---|---|---|---|
| 1 | **Newest locally verified installed build** — static fact about the exe on the OWNER's disk | `37a166c` → **`Compy_0.9.0_x64-setup.exe`**, installer SHA-256 `6BC2F7DFBCCC31A6714A49EE07F36327016DBB65741FA40D4371A45690F5A2C4` (3,826,464 B / 3.65 MB). The installed exe on THIS (owner) machine (`%LOCALAPPDATA%\Compy\compy.exe`, 14,837,760 B) embeds `37a166c` and reports runtime stamp `37a166c · release` (CLEAN, no `+dirty`); ONE Compy installer on the Desktop. **Built + silently reinstalled 2026-07-20** via `scripts/ship-reinstall.ps1` (release-validation on the owner's box). **Runtime closure 2026-07-20c on THIS exact build:** live rollback → reapply cycle through the installed UI (Windows Game Mode rec; ledger round-trip field-perfect, zero UAC) **+** the orphaned Gaming Mode session recovered via the app's own Restore path (owner-clicked) — see the 2026-07-20c snapshot entry. This is the newest build **on the owner's machine** — it is **NOT** a claim about what any *other* machine runs (see rows 3–4). | Embedded-hash byte-scan of the installed exe (read-only) **+** live runtime build STAMP over CDP |
| 2 | **Current corrective source train** — static; a *reviewed* commit, NOT a live pointer | HEAD `37a166c` = `origin/main` = the newest *reviewed* code on `main` (subsumes the audit-corrective train **and** the `75c38c6..37a166c` Measurement-Platform-2.0 / Home-masthead-intake accumulation — 20 commits). **As of 2026-07-20b it is BUILT + installed on the owner's machine (row 1) — still NOT distributed to any other machine (step 12 held).** **As of 2026-07-20c the newest commit on `main` is a DOCUMENTATION-ONLY runtime-closure commit stacked ONE past `37a166c`** (this file's closure records; zero source/product/version/gate delta) — **`37a166c` remains the validated binary source**, and a docs-only HEAD advance does **NOT** obligate a rebuild/reinstall (row 1 unchanged). | `git log --oneline origin/main..HEAD` (empty ⇒ in sync; read at review time) |
| 3 | **Historically distributed private-beta artifact(s)** — what other machines were actually handed | The repo records prove **more than one** private build left this machine: `16069fa` / `beta/private-beta-001` (the OLD verified **unsigned** private beta, frozen ref, never to be moved) **AND** a later kit cut from **`fc940fe`** — an NSIS `Compy_0.1.0_x64-setup.exe`, SHA-256 `5F2549E7EDD6BC94440D3C24ECCC0CB784005DAC520DE2490BB81F3260021F18`, hosted on Google Drive and DM'd to testers (`docs/CHANGELOG.md:378-391`, `docs/archive/cowork-handoff-board-2026-06.md:354-356`); `fc940fe` is 349 commits after `16069fa`. So the earlier claim that `16069fa` was the *only* build ever handed to another machine is **FALSE**. A frozen *source* ref does not prove which *binary* a tester received; the **exact last artifact each tester installed is UNKNOWN pending owner reconciliation** (row 4). **Public:** **NONE** — no public download, store listing, or signed public artifact (gated on **Code signing** + **Legal**, both OPEN in *Release blockers*). | Repo records (CHANGELOG + archived handoff board) + frozen ref; exact tester binary owner-confirmable only |
| 4 | **Current tester installs + old share-link reachability** — UNKNOWN, owner-confirmable only | What any private-beta tester currently runs, and whether the old Drive/share link still resolves, is **NOT knowable from here** — no telemetry (zero-outbound), no local record. **Pending owner confirmation.** Do not assert testers are on any specific build, or that the link is live or dead. | Unknowable without an owner report; no local evidence |
| 5 | **`origin/main` tracking ref vs the remote server** — LOCAL cache; may lag the server | **Post-push (2026-07-20):** the audit-corrective train `c1071c1..05f0ce4` **landed on the server via fast-forward** (`408c860..05f0ce4`, no force); `origin/main` advanced from `408c860` to `05f0ce4` and HEAD is **in sync** at that tip. Numbers still go stale on the next commit — `git fetch` and re-derive live before trusting. **As of 2026-07-20b, HEAD `37a166c` = `origin/main` = the installed build (row 1)** — the prior "HEAD ahead of the installed build (`75c38c6`)" gap is **closed** (verified live: `git rev-list --left-right --count origin/main...HEAD` = `0  0`; `75c38c6..HEAD` = 20). **As of 2026-07-20c HEAD advances ONE docs-only closure commit past `37a166c`** — committed locally; the push follows owner approval of that exact diff, so `origin/main` stays `37a166c` until it lands; the installed build (row 1) stays `37a166c` either way. **The exact ahead / installed-distance integers are deliberately NOT committed here** — they are volatile (they change on every commit and push) and were stale within one commit the last time this row baked them. Derive them live at read time with the commands at right; tie any snapshot you record to the exact `HEAD` commit it was taken at, and `git fetch` before trusting the `origin/main` comparison. | `git rev-parse origin/main` (local ref) · `git rev-list --left-right --count origin/main...HEAD` (ahead/behind) · `git rev-list --count 75c38c6..HEAD` (installed distance) — **`git fetch` first to compare to the server** |

**Bottom line (updated 2026-07-20b):** the owner's live installer is now **`37a166c`** — HEAD = `origin/main` = the installed build are all the **same** commit; the `75c38c6`→`37a166c` accumulation (20 commits: Measurement Platform 2.0 + Home masthead/intake) was **release-built AND silently reinstalled onto the owner's machine** this date. So the older "nothing newer than `75c38c6` has been built" line is **retired** — `37a166c` IS built + installed here. **Distribution is still ZERO, though:** nothing newer than the historical private-beta kits (row 3) has been sent to any *other* machine — this was a release-VALIDATION pass on the owner's own box (step 12 held: no tester send, no share-link change). The earlier audit-corrective train (`c1071c1..05f0ce4`) **was pushed to `origin/main` via fast-forward on 2026-07-20** and is now subsumed by `37a166c` — that push was an **audit-corrective closure, NOT a release closure** (push ≠ ship); the subsequent 2026-07-20b build is what put this code on the owner's disk, and it too shipped to **no other machine**. At least **two** private builds were handed to other machines historically — the frozen unsigned private beta `16069fa` **AND** a later kit cut from `fc940fe` (row 3) — so `16069fa` was **not** the only one; **what testers currently run and whether the old share link still resolves are UNKNOWN pending owner confirmation.** `origin/main` (`37a166c`) is a LOCAL tracking ref that may lag the server until a `git fetch`. **No gate flipped and no new outbound boundary across `75c38c6..37a166c`:** the verified zero-outbound property and every LOCKED gate still hold (delta confirmed: 11 mutation modules byte-identical, IPC `#[tauri::command]` count 90→90, no capabilities/CSP change, no new outbound-network code). All ahead/behind numbers are tooling-derived — re-run the commands above (and `git fetch` for the server) rather than trusting them. **Update THIS block in the same commit that ships or flips a gate; a PUSH is verified/refreshed AFTER it lands** — re-derive the row-5 counts (and `git fetch`) once the remote has the commit, since the tracking ref only advances post-push. **2026-07-20c runtime closure:** the installed `37a166c` build itself passed the two live checks 20b had deferred — the orphaned Gaming Mode session `gm-1784436112238` recovered through the app's own Restore path (owner-clicked), and a live **rollback → reapply** cycle ran through the installed UI on the Windows Game Mode rec with a field-perfect Trust-Ledger round-trip (55 → 56 entries, zero UAC, machine left in its original Game-Mode-ON state). **Private beta: GO for invite-only distribution** — the send itself remains an owner action (ships-to-others stop; step 12 still held, nothing distributed). **Public release: still BLOCKED** on Code signing + Legal (Release blockers). The closure lands as a **documentation-only commit** advancing HEAD one past `37a166c` with zero product delta — the validated binary source and the installed NSIS SHA-256 (`6BC2F7DF…F5A2C4`) are unchanged, and **no rebuild/reinstall follows from a docs-only HEAD advance**.

## Snapshot history (reverse-chronological log — superseded by CURRENT STATE above)

> **UPDATE 2026-07-20c (RUNTIME CLOSURE ON THE INSTALLED `37a166c` BUILD — PRIVATE BETA GO FOR INVITE-ONLY;
> THIS COMMIT IS DOCS-ONLY, NO REBUILD).**
> The two runtime items 2026-07-20b honestly left open are **CLOSED**, exercised on the installed release
> build itself (`%LOCALAPPDATA%\Compy\compy.exe`, runtime stamp `37a166c · release`), not in dev:
>
> - **Orphaned Gaming Mode session RECOVERED through the app's legitimate path:** `gm-1784436112238` (status
>   active, full typed rollback contract intact) was resolved via the in-app **Restore** — clicked by the
>   OWNER (his confirmed click). Restore completed clean: `gaming-session.json` absent afterward, **no
>   quarantine file, no RestoreFailed marker**, Trust Ledger consistent. The orphan-recovery path the
>   architecture promises (detect → surface Resume-vs-Restore → staged restore) is **live-proven end-to-end
>   on this exact build**.
> - **Live rollback → reapply cycle through the installed UI** (Windows Game Mode rec — deliberately benign:
>   pure HKCU `GameBar` keys, `elevation_used: false`, so this closes the *unelevated* mutation lane only):
>   - **Rollback — 2026-07-21T01:48:35Z** (evening of 2026-07-20 local): executed at the machine through the
>     installed UI by a human click (physical-presence evidence; attribution is evidence-based inference,
>     distinct from the owner-testimony line above). Registry read back `AllowAutoGameMode=0` /
>     `AutoGameModeEnabled=0` — equal to the ledger snapshot priors; entry `game-mode-1784419404776` stamped
>     `rolled_back` at that instant; no ledger entry added or removed.
>   - **Reapply — 2026-07-21T01:57:32Z:** a real click on the live Optimize toggle (CDP-driven UI automation
>     against the installed build — the app's own click path end-to-end; no registry shortcut). **Zero UAC**
>     (consent.exe watched throughout — never appeared; expected for HKCU). Registry → `1/1`. New ledger
>     entry `game-mode-1784599052740` **field-perfect**: snapshot priors `0/0` (the true pre-apply state),
>     status `applied`, typed `enable-game-mode` / `restore-game-mode-from-snapshot` contract, app version
>     `0.9.0`, ruleset `1.0.0-baseline`, `elevation_used: false`. Ledger **55 → 56** entries; every
>     pre-existing entry **byte-unchanged** (raw-JSON set-difference); unrelated-state baseline (DVR keys ·
>     SysMain/DiagTrack/WSearch service state · power-plan + USB-suspend + ASPM values) **identical**
>     before/after.
>   - **Final state = original:** machine left in its pre-test Game-Mode-ON state (`1/1`); clean relaunch
>     with the debug port closed; UI shows the applied entry active; footer ledger count 56.
> - **Verdict:** 20b (source/build verify · install · stamp · zero-outbound · smoke) **+** this runtime
>   closure ⇒ **the `37a166c` NSIS artifact (SHA-256 `6BC2F7DF…F5A2C4`) is GO for invite-only private-beta
>   distribution.** The send itself is an owner action (ships-to-others stop) — **nothing has been
>   distributed** (step 12 still held). **Public release stays BLOCKED:** Code signing + Legal (Release
>   blockers below, unchanged).
> - **Docs-only commit distinction (do NOT rebuild off this):** this closure lands as a **documentation-only
>   commit created after validation** — repo HEAD advances one commit past `37a166c` with **zero
>   source/product/version/gate/artifact delta**. The **validated binary source remains `37a166c`**; the
>   installed NSIS remains `Compy_0.9.0_x64-setup.exe` SHA-256
>   `6BC2F7DFBCCC31A6714A49EE07F36327016DBB65741FA40D4371A45690F5A2C4`. The reinstall law binds app-code
>   builds, not doc commits — **no rebuild/reinstall is warranted by this HEAD advance.**
> - **Coverage gaps that stay OPEN (named honestly, unchanged by this closure):** **elevated**
>   mutation/rollback not exercised this pass (the cycle was deliberately HKCU/non-elevated; the most recent
>   live elevated proofs remain the 2026-07-16 owner-present leftovers QA and the 2026-07-07/08 batched-tier
>   session QA) · **NVIDIA sensor lane** still "implemented, not hardware-verified" (LOCKED rule 5 — no
>   monitored NVIDIA session yet) · **multi-rec batch apply** not runtime-exercised (single-rec cycle only;
>   the §2a stack-trial gate stays DARK) · **live Codex hook activation** still pending — externally blocked
>   (ChatGPT/Codex usage limit until 2026-07-26), `.codex/*` advisor scaffold only, **unrelated to the Compy
>   binary**.
>
> **UPDATE 2026-07-20b (RELEASE-VALIDATION BUILD — `37a166c` BUILT + INSTALLED ON OWNER MACHINE, NOT DISTRIBUTED).**
> First full **build + install** of the accumulated code-complete-but-unshipped work (`75c38c6..37a166c`, 20
> commits: Measurement Platform 2.0 + Home masthead/intake behind `compy_home_intake` **DEFAULT OFF** + the
> Codex read-only advisor scaffold + identity/version doc reconciliation) onto the **owner's own machine**. This
> is a **release-VALIDATION** pass, **not** a tester or public release — **no artifact was distributed** (directive
> step 12 held: no tester send, no share-link change).
>
> - **Source commit:** `37a166c` (`37a166ca4825c7320477b67af6a258456065ab18`) = HEAD = `origin/main`, code tree
>   clean, `COMPY_GIT_DIRTY=0`.
> - **Artifacts built** (`npm run tauri build` from `37a166c`):
>   - NSIS `Compy_0.9.0_x64-setup.exe` — **3,826,464 B (3.65 MB)**, SHA-256
>     `6BC2F7DFBCCC31A6714A49EE07F36327016DBB65741FA40D4371A45690F5A2C4`.
>   - MSI `Compy_0.9.0_x64_en-US.msi` — **5,328,896 B (5.08 MB)**, SHA-256
>     `45819019532D956DA177840920463AC895E1F2A48A34D1174B476297A550F572`.
> - **Installed** via `scripts/ship-reinstall.ps1` (stop → keep ONLY the new NSIS on Desktop → `/S` silent →
>   launch). **Live == build, confirmed two ways:** the installed `%LOCALAPPDATA%\Compy\compy.exe` (14,837,760 B)
>   byte-embeds `37a166c` (no stale `75c38c6`/`408c860`/`05f0ce4`, no contiguous `+dirty`), **and** the live runtime
>   build STAMP over CDP reads `37a166c · release` (clean). One Compy installer on the Desktop; single-instance
>   confirmed; the debug CDP port was closed on relaunch.
> - **Safety envelope UNCHANGED by the delta (verified, not assumed):** all **11 mutation/rollback modules**
>   (`actions` · `history` · `gaming_orchestrator` · `gaming_session` · `game_mode_persist` · `services` ·
>   `gpu_profile` · `remote_rules` · `receipts` · `license` · `drift`) are **byte-identical** across
>   `75c38c6..37a166c`; the `#[tauri::command]` IPC count is **90 → 90** (no new command); **no** capabilities /
>   `tauri.conf.json` / CSP change; **no** new outbound-network code (no added `reqwest`/`http`/`TcpStream`), and
>   live zero-outbound held on this exact build.
> - **Gated systems match declarations:** remote-rules fetch OFF (placeholder pubkey, triple-gated), updater
>   absent, Receipts telemetry built-dark default-OFF, Compy Pro license built-dark — all unchanged by the delta.
> - **Source verification (green):** cargo **856 passed / 0 failed / 24 ignored** · vitest **188 files / 1777
>   passed** · `tsc --noEmit` **clean** · `verify-release-state --strict` **53/53 ok**.
> - **Packaged-app smoke:** launched clean, onboarding already past (app not first-run), hardware detection +
>   navigation + readiness + monitoring surfaces render; **tab-nav / scanning lag evaluated on the RELEASE build**
>   (release binary, not the debug/HMR dev build the earlier lag report came from).
> - **NOT done / honestly open (as written at 20b):** no artifact distributed (step 12) · **no live apply/rollback
>   exercised** (mutation is owner-territory; boundary proven by byte-identity + tests, not by a live mutation
>   that pass) — **CLOSED 2026-07-20c** (live rollback → reapply cycle through the installed UI; entry above) ·
>   onboarding not re-triggered (app past first-run) · uninstall/reinstall-from-clean not exercised (destructive) ·
>   an **orphaned Gaming Mode session** (`gm-1784436112238`, status active, full typed rollback contract intact)
>   was present on disk — surfaced to the owner as a **Resume-vs-Restore** decision (Restore triggers elevation +
>   service/power-plan mutation → owner-territory; NOT clicked at 20b) — **CLOSED 2026-07-20c** (owner clicked
>   **Restore**; recovered clean — entry above).
>
> **UPDATE 2026-07-20 (AUDIT-CORRECTIVE TRAIN PUSHED — `c1071c1..05f0ce4` → `origin/main`; NOT A RELEASE).**
> An independent Codex acceptance audit had returned a **"DO NOT PUSH"** verdict on the `c1071c1..9b89ee0`
> train; the narrow corrective follow-up `05f0ce4` (stacked additively on `9b89ee0`, no rewrite) resolved
> every named blocker. The full 5-commit stack was **pushed via fast-forward** (`408c860..05f0ce4`, no force;
> frozen beta ref `16069fa` untouched) after green mechanical verification — **hooks-selftest 39/39 · tsc
> clean · version-drift-guard 14/14 · release-state verifier 53/53 strict** — and a boundary scan confirming
> **zero product/binary/IPC/network/security delta** (the stack is `.codex/*` advisor scaffold + docs +
> `#[cfg(test)]`/comment-only Rust + one display-only `src/App.tsx` version-string wiring, guard-pinned). This
> is an **audit-corrective closure, NOT a release closure** — no gate flipped, no installer built, no ship to
> another machine. The live installer is UNCHANGED: still `Compy_0.9.0_x64-setup.exe` from `75c38c6`. **Item 1
> of the owner directive (a live in-product Codex hook-activation test) remains OPEN** — externally blocked by
> a ChatGPT/Codex usage limit until 2026-07-26 with no local OSS provider installed; it produced no evidence
> and does NOT gate this push (the commits already self-document in-product hook activation as unproven pending
> a trusted Codex runtime run).
>
> **UPDATE 2026-07-18b (MEASUREMENT PLATFORM 2.0 — FINAL SLICE LANDED ON MAIN `77b5b89`, CODE-COMPLETE,
> NOT SHIPPED).** This train was scoped **code-only** (no rebuild, no reinstall, no ship-to-another-machine)
> — so **the live installer is UNCHANGED**: still `Compy_0.9.0_x64-setup.exe` SHA-256
> `2F13B9F41A8DB4AEDCEC87E90FD4560829F84EE70818BAD102F095C9EFCDC0AF` from `75c38c6` (the 2026-07-18a ship
> below). `77b5b89` is on `main`, verified green, and awaits a future ship cut. What landed:
> - **Regression Detective hardening (Task G) — not-comparable reports now assert NO cause.** The
>   `intelligence.rs` different-rig gate fires BEFORE any FPS delta is computed, so there is no measured
>   effect to attribute; it no longer pushes a `hardware-change` leading hypothesis (that was a causal
>   claim with nothing to explain, and it triple-stated the GPU/RAM/Display facts `comparability::derive()`
>   already carries). The **comparability banner is the SOLE owner** of that framing. The frontend
>   `showLeader` also gates on `verdict !== "not-comparable"` — double-layered backend+frontend, hostile-
>   fixture-proof. No fifth room; comparability surfaced in the shared investigator render
>   (`WhatChangedReportView` used by both `WhatChangedPanel` and `SessionInvestigator`). Bands are words,
>   never numbers. Laws held: no fabricated causation, correlation never becomes cause.
> - **`WhatChangedReport` gains `comparability: SessionComparability`** (additive, backend always
>   populates — old persisted data unaffected; report is computed, not persisted).
> - **`MIN_COMPARE_SAMPLES` de-duplicated** — single `pub(crate) const` in `intelligence.rs`, imported by
>   `intelligence_patterns.rs` (one source, can't drift). Decision: `docs/decisions/2026-07-18-prove-a-
>   change-overlap.md` (ACCEPTED) — two "prove a change" surfaces are complementary layers, not a merge;
>   `next_test`→experiment routing DEFERRED (prose has no machine-readable rec-id → auto-routing would
>   fabricate a mapping). BACKLOG carries the additive follow-ups.
> - **Read-only advisory surface — the mutation/rollback boundary is UNTOUCHED** (`actions.rs` /
>   `history.rs` / `experiment.rs` / `gaming_orchestrator.rs` byte-identical). **No gate flipped**; the
>   `compy_intelligence` flag (already default-ON) governs the surface. **Zero-outbound property holds** —
>   security-surface diff EMPTY (no CSP / capability / telemetry / remote-fetch / updater / signing /
>   network change; Sections 0.6–0.8 satisfied).
> - **Verification (none skipped):** cargo test 849/0, clippy clean, `cargo check` clean, tsc 0, vitest
>   1733/0 (targeted `intelligence::` 47 + `intelligence-flag` 7 green), release-state citation audit 46
>   ok / 0 broken (exit 0), self-reviewer **PASS 9/9** on a hostile not-comparable fixture. Tauri
>   production build intentionally NOT run (train forbids shipping).
>
> **UPDATE 2026-07-18a (INTELLIGENCE PHASE 4 SLICE 1 SHIPPED LIVE `75c38c6` — installer SHA-256
> `2F13B9F41A8DB4AEDCEC87E90FD4560829F84EE70818BAD102F095C9EFCDC0AF`, live exe stamp-verified
> `75c38c6 · release` (CLEAN — no `+dirty`; CDP `get_build_stamp`), ONE installer on the Desktop
> (`Compy_0.9.0_x64-setup.exe`), silent reinstall done — supersedes the `D0D63E48…94575BCB` installer
> from `28648b2`).** Collapses the `28648b2 → 75c38c6` drift (4 commits; app-code delta `+746/−33`
> across 9 files, the rest docs-only). Carries two shipped items plus a ship-integrity catch:
> - **Intelligence Phase 4 slice 1 — component-level evidence highlighting (§4H "hardware twin"):** the
>   Hardware grid lights a component card ONLY when a real Intelligence pattern implicates it, at that
>   pattern's OWN confidence band. Architecture is a **read-only PROJECTION, not a new detector** —
>   `component_evidence.rs` (`attribute()` over `detect_patterns()`, `#[tauri::command]
>   get_component_evidence`) re-keys existing Intelligence Phase 2 findings BY the hardware component
>   each names (memory-trend → Memory; thermal-trend / driver-split → GPU); it invents no evidence, and
>   passive/ambient patterns stay capped at Medium. Flag-gated on the Intelligence flag; a card stays
>   **neutral** when the flag is off OR the projection fetch fails — never a fabricated glow ("no
>   decorative component glow without meaning"). On a rig with no qualifying session pattern yet it is
>   invisible — that IS the design. Mutation/rollback boundary UNTOUCHED (`actions.rs` / `history.rs` /
>   `experiment.rs` byte-identical `28648b2 → 75c38c6`); zero-outbound property holds (no network /
>   telemetry / capability change). bug→guard: `border-hygiene-guard.test.ts` guard 3 pins the compound
>   `.card.card-lit:hover` cascade fix; `HardwareGrid.test.tsx` pins the four honesty invariants
>   (lit-only-implicated · neutral-when-flag-off · no-glow-on-fetch-fail · band-drives-class).
> - **W2 fast-follow (`f558d1d`):** the armed Controlled-experiments bench (`ExperimentBench.tsx`)
>   live-refreshes on window/tab refocus — a pick that became already-applied while you were in Optimize
>   re-derives to the "Already configured" verdict (Start hidden) and STAYS visible in the picker (guard
>   "re-derives the active pick from the live ledger on refocus", 6/6).
> - **Ship-integrity note (the law working):** the FIRST build of `75c38c6` stamped `+dirty` — two stray
>   CDP-probe PNGs sat in the repo ROOT at build time (non-docs, so build.rs's `:(exclude,top)docs`
>   pathspec counted them). The **CDP stamp-verify caught it**; the exe-hash byte-scan CANNOT (`+dirty`
>   is assembled at runtime from `COMPY_GIT_DIRTY`, never stored contiguously — exactly why the law says
>   "verify via the CDP stamp, not an exe hash"). Fix: PNGs → scratchpad, then `cargo clean -p compy
>   --release` and rebuild → clean `75c38c6 · release`.
> - Verify at HEAD `75c38c6`: cargo **819/819** (24 ignored) · clippy clean · tsc clean · vitest **1718
>   passed / 8 skipped / 0 assertion failures** (the lone "failed FILE" was a 60 s setup-hook timeout in
>   `scripts/export-library.test.mjs` under concurrent build load — passes 8/8 in isolation, unrelated to
>   this slice) · citation audit 50 (46 ok · 4 near-drift · 0 broken).

> **UPDATE 2026-07-17f (INTELLIGENCE PHASE 3 SHIPPED LIVE `28648b2` — installer SHA-256
> `D0D63E489105BE7566769A13A2BA801FE76E95314E07A11938A8A49A94575BCB`, live exe stamp-verified
> `28648b2 · release` (CLEAN — no `+dirty`; CDP `get_build_stamp` + embedded-hash byte-scan of the
> installed exe), ONE installer on the Desktop (`Compy_0.9.0_x64-setup.exe`), silent reinstall done —
> supersedes the `E3F8E0CE…7856EBA8` installer from `cd66ce9`).** The ship-stamp closing the
> 2026-07-17e arming (two-commit pattern); resolves every PENDING item there:
> - **Live apply→rollback round-trip on THIS rig (benign reversible rec):** id `game-mode-1784336056558`,
>   snapshot `{prior_allow:1, prior_enabled:1}`, `elevation_used:false`, apply→rollback byte-identical 1/1,
>   `rolled_back_at 2026-07-18T00:54:42Z`, ledger CLEAN after. Proven on the armed engine at `e16b231`; the
>   apply/rollback boundary (`experiment.rs`/`history.rs`/`actions.rs`) is **byte-identical `e16b231`→`28648b2`**
>   (`git diff --stat` empty), so the proof stands unchanged on the live build — no re-mutation of the system needed.
> - **MUTATION-GATE 10/10 PASS** (rollback-first contract). rust-tauri-reviewer PASS on the arming diff
>   (fix-before-merge, W1 picker-lock — see 17e). **Cowork-lane adversarial audit FLAGGED** (mutation-boundary
>   GO-LIVE = high-stakes class #1, `docs/COWORK_HANDOFF.md` routing).
> - **self-reviewer PASS on the LIVE armed Lab surface** (`28648b2`, CDP 9223, real machine): **7/7 rubric
>   PASS** (items 8–9 n/a) — the note renders as ONE line; `.lc-detail-note` muted `--ix-text-2`
>   `rgb(139,147,167)` on the dark-glass card body `rgb(10,12,16)` (NOT an accent fill) = **6.36:1**, clears
>   4.5:1; zero `/undo/` · `/just reads/` · `/only…changes anything/` (both bug→guard regexes closed); no
>   duplication vs Fix's `.fix-consent`; h1 "Lab" title-header intact; absent when the station is closed and on
>   Benchmark (vitest `lab-console.test.tsx` 10/10). The note states the reversibility invariant true across
>   every Lab mutator (Optimize · Benchmark tweak-trial · Controlled experiments), NOT a false per-station
>   census — rounds 1–2 caught two false censuses; bug→guard `lab-console.test.tsx` pins both out.
> - Verify at HEAD: cargo **808/808** · clippy clean · tsc clean · vitest **1720/1720** · citation audit
>   50/50. §0.11: Optimization Cleanup lane untouched. **Owner welfare-check pending:** the Benchmark
>   tweak-trial and the Controlled-experiments bench now overlap (both single-tweak apply→measure→rollback) —
>   surfaced for a feature-shape dedupe call, not resolved unilaterally.

> **UPDATE 2026-07-17e (INTELLIGENCE PHASE 3 ARMED — `experiment_gate()` flipped `false` → `true`,
> owner sign-off "Ship it live now").** The experiment engine + optimization simulator are now LIVE
> (`experiment::experiment_gate() -> bool { true }`, `src-tauri/src/experiment.rs:55`). This is a
> mutation-capability GO-LIVE, done its own reviewable commit under full mutation-gate rigor. Arming is
> safe by construction: the engine invents **no new** apply/rollback primitive and adds **no**
> `AppliedAction`/`RollbackAction`/`Snapshot` variant — start reuses `history::apply_recommendation`,
> restore reuses `history::rollback_change`, rollback still resolves from `history.json` alone (the SAME
> audited boundary LIVE for weeks under the Benchmark tweak A/B trial). Every lifecycle command STILL
> hard-checks the gate (defense-in-depth, now unreachable while armed); the FE renders nothing if it ever
> reads false. **Reviewer fix-set landed in this same arming commit** (rust-tauri-reviewer fix-before-merge):
> the simulator now flags **advisory-only** recs (in the catalog but with no one-click apply — the SSD /
> driver-update advisories) as `not-applicable` instead of inviting a Start that would dead-end at the
> apply boundary — driven by a NEW single source of truth `history::is_appliable` (shares `apply_fn_for`
> with `dispatch_apply`, so simulator and apply boundary can never disagree; read-only, never runs the
> apply). FE `not-applicable` label → "Not testable here". Verify: cargo **808/808** (count UP — +2 new
> guards: `appliable_recs_are_one_click_advisories_are_not` + `advisory_only_rec_is_never_worth_testing`)
> · clippy clean · tsc clean · vitest ExperimentBench **5/5** (dark render-nothing + armed interactive
> pins + the W1 picker-lock guard). **frontend-ipc-contract-auditor PASS** (7-for-7 verdict parity, all 8
> invokes registered); its one pre-ship Warning — W1, a reselect race AT the apply boundary — was FIXED +
> guard-tested in this same commit: the picker locks during `simBusy`, a request-id ref drops superseded
> simulator reads, and the sim card names its exact mutation target so Start is never ambiguous.
> **COMPLETED in 2026-07-17f** (the ship-stamp above, `28648b2`): live apply→rollback round-trip on a
> benign per-user rec on THIS rig (ledger clean before/after) · `npm run tauri build` + silent reinstall ·
> installer SHA-256 `D0D63E48…94575BCB` + live `get_build_stamp` = `28648b2 · release` · self-reviewer PASS
> on the LIVE armed Lab surface · MUTATION-GATE 10/10 + Cowork-lane adversarial audit flagged. The owner's
> first real gaming-session experiment IS the live FPS→verdict QA — real frames from a real game are the
> owner's to produce (anti-fabrication law); the engine cannot manufacture them. Flipping the gate BACK is
> likewise an owner-signed decision, never a refactor side effect. §0.11: Optimization Cleanup lane untouched.

> **UPDATE 2026-07-17c (HOME VERDICT REGRESSION FIX SHIPPED `cd66ce9` — installer SHA-256
> `E3F8E0CE03A2807786196BC52AAF1A21F86A17C8F5C02F0FD5ACC6FE7856EBA8`, live exe stamp-verified
> (embedded `cd66ce9`, CLEAN — no `+dirty`; byte-scan of the installed exe), ONE installer on the
> Desktop (`Compy_0.9.0_x64-setup.exe`), silent reinstall done — supersedes the `3EB0FAE5…C570D838`
> installer. NO gate moved — pure frontend text-derivation + one boolean standdown, zero
> mutation/capability change):** owner-caught regression — Home's verdict strip had crept back to the
> vague "1 thing needs your attention" count headline the owner agreed to retire (name-it-and-fix-it-inline
> + title-header laws). Fixed at the SOURCE so all three Home faces benefit: `system-posture.ts`
> `deriveSystemPosture()` attention branch no longer emits a count — single flagged check ⇒ headline IS
> that check's label, several ⇒ `"<top label> · and N more"`, and `sub` carries the check's own `detail`
> so the fix travels with the name (`src/surfaces/system-posture.ts`). `HomeConsole.tsx` adds a
> one-owner-per-screen standdown at the `topLimiter` derivation: when the named verdict already IS the
> #1 limiter (same title — the live-machine collision, "Applied Compy changes" is both), the "top limiter"
> row stands down so the string renders exactly once (mirrors the existing `dekRedundant`/ForwardDoor
> standdowns; `src/surfaces/HomeConsole.tsx`). bug→guard: `system-posture.test.ts` VAGUE_COUNT regex pin
> (named, never a count) + `home-console.test.tsx` dedup guard (same-title ⇒ 0 top-limiter rows & string
> count = 1; different check ⇒ no false standdown). Verify: tsc clean · vitest **1714/1714** (count UP
> from 1710) · self-reviewer PASS (live, real machine attention state — vague count absent, verdict names
> the check + fix inline, duplicate title count = 1, h1 = "Home"). Frontend-only; cargo/gates untouched.

> **UPDATE 2026-07-17b (INTELLIGENCE PHASE 2 SHIPPED `9c6af4b`+`094d834` — installer SHA-256
> `3EB0FAE5D5AE4D98567B043026656FCE818C2AF28C096EF100789877C570D838`, live exe stamp-verified
> (embedded `094d834`, CLEAN — no `+dirty`; byte-scan of the installed exe), ONE installer on the
> Desktop (`Compy_0.9.0_x64-setup.exe`), silent reinstall done. NO gate moved — read-only + one
> additive `#[serde(default)]` field, zero mutation/capability change):** second train of the owner
> directive (`docs/reviews/2026-07-16-owner-directive-intelligence-platform.md` §6; spec
> `docs/superpowers/specs/2026-07-17-intelligence-phase2-train2.md`). `9c6af4b` (backend) adds
> `intelligence_patterns.rs` (six deterministic cross-session detectors — trend/thermal/memory/driver/
> mode/fade — passive-capped at Medium, §0.12 coverage reasons, command `get_intelligence_patterns`) +
> `what_changed_between` (the §4D "last good vs first bad session" workflow, reusing the Phase 1 engine
> verbatim) + an EvidenceGraph re-projection on `WhatChangedReport` (§4C, adds no data, relations never
> assert causation) + `drift.json` ingestion (external reverts as observed events, always tagged
> external) + `AppliedChange.rolled_back_at` (additive `#[serde(default)]` stamp, set at rollback time,
> NEVER retro-dated; rollback LOGIC unchanged, `resolve_rollback` still history-only). `094d834`
> (frontend) surfaces them Expert-view only (`compy_expert_view`, default OFF): SessionInvestigator +
> evidence graph in Monitor's What-Changed panel, PatternsTile in Blackbook's logbook (§5E, no fifth
> room); the plain-language view is unchanged for the normal user. Confidence bands
> unknown/low/medium/high ONLY (no numerics); deterministic, inspectable, local — zero telemetry/network.
> Verify: cargo **787/787** (count UP from 754) · clippy clean · vitest **1710/1710** (count UP from
> 1708) · rust-tauri-reviewer PASS · self-reviewer PASS. §0.11: Optimization Cleanup lane untouched.
> Phase 3 (experiment engine, §4F) is the next train — fresh session.

> **UPDATE 2026-07-17a (INTELLIGENCE PHASE 1 SHIPPED `8f612d2`+`d45bb1c` — installer SHA-256
> `8063F95744C6AF00C760FD3F77DA63FBD9B68B279773307D6D1AEB5773A52E0D`, live exe stamp-verified
> (embedded `d45bb1c`, CLEAN — no `+dirty`; Select-String), ONE installer on the Desktop
> (`Compy_0.9.0_x64-setup.exe`), silent reinstall done. NO gate moved — read-only vertical slice,
> zero mutation/capability change):** first train of the owner directive
> (`docs/reviews/2026-07-16-owner-directive-intelligence-platform.md` §5): `8f612d2` adds the
> `intelligence.rs` domain layer + three query commands (`get_intelligence_timeline` ·
> `what_changed_for_session` · `get_intelligence_headline`) + the What-Changed engine and surfaces
> behind `compy_intelligence` **default ON**. Confidence bands unknown/low/medium/high ONLY (no
> numerics); deterministic, inspectable, local — zero telemetry/network. Honesty note: the query
> commands are NOT literally pure reads — each calls a throttled, mutex-guarded, atomic own-store
> snapshot refresh (`intelligence.json`); `monitoring.rs` gains a per-tick `load_session()` additive
> read (`SessionSummary.gaming_mode_active`, `#[serde(default)]`). `d45bb1c` = game-name display
> class sweep (bug→guard: every surface strips the `-Win64-Shipping` wrapper via the shared
> prettifier; MATCHING stays raw — `norm_app` deliberately keeps its own `.exe`-strip). Verify:
> cargo **754/754** (count UP) · clippy clean · vitest **1708/1708** (183 files) ·
> verify-release-state 46/46 · rust-tauri-reviewer PASS ×2 · self-reviewer PASS ×2. §0.11:
> Optimization Cleanup Phase 1 (shipped 2026-07-16) left exactly where it was.

> **UPDATE 2026-07-16d (VERSION 0.9.0 SHIPPED `27bc472` — installer SHA-256
> `41613F13A046730A663B29AA144AE7DFF120FFD0C604ADE060B4D2A1D6ABB6F9`, live exe stamp-verified
> (embedded `27bc472`, CLEAN — no `+dirty`: non-docs porcelain empty at build; Select-String), ONE
> installer on the Desktop (`Compy_0.9.0_x64-setup.exe`), silent reinstall done — this is the
> reinstall commit the 2026-07-16c banner promised. NO gate moved):** the human-facing version
> jumps `0.1.0` → **`0.9.0`** across all three manifests + `Cargo.lock` (owner call 2026-07-16:
> **"0.9.0 now, 1.0.0 at your bar"** — `docs/superpowers/specs/2026-07-16-version-policy-proposal.md`
> flipped DECIDED; `1.0.0` fires at the release-hardening bar with owner confirm). Drift killed at
> the class level: `scripts/ship-reinstall.ps1` now DERIVES the installer filename from
> `tauri.conf.json` (the hardcoded `0.1.0` literal it carried was a silent drift site) and
> `scripts/version-drift-guard.test.mjs` pins all four version sites + the no-hardcoded-filename
> invariant. Verify: vitest **1688/1688** (182 files) · cargo 725/725 · clippy clean ·
> verify-release-state 46/46 · release build exit 0.

> **UPDATE 2026-07-16c (OPTIMIZATION CLEANUP PHASE 1 — LEFTOVERS RESTORE ARMED, a MUTATION GATE
> FLIPPED):** `restore_gate()` → `true` (`leftovers.rs:730`) **and** `history::restore_leftover`
> registered as a Tauri command (`lib.rs`) in the same deliberate commit — the double-dark layers
> both opened at once, exactly as designed. **Precondition satisfied first:** the owner-present
> live-UAC QA harness (`history.rs` `manual_restore_qa`) passed ALL THREE full loops on real
> machine state 2026-07-16 — W32PS (0x26→stock 2→rollback 0x26→cleanup 2), MPO (OverlayTestMode
> 5→delete→rollback 5→cleanup absent), memcompress (seed OFF→restore ON, prior banked
> in-elevation→rollback OFF→cleanup stock ON) — owner approving every UAC prompt. Memcompress
> scripts made state-aware first (`if`-guarded Enable/Disable-MMAgent — the cmdlets are
> non-idempotent, live-proven: Disable throws ERROR_SERVICE_DISABLED from already-off). **Owner
> decisions:** restores REUSE the Trust Ledger (provenance `leftover_adopted`) — the BACKLOG's
> "separate recovery-snapshot mechanism" idea is retired; 5 "QA · " receipts deleted from the live
> ledger (56→51, backup kept). Dark-gate tests rewritten armed-world (+1 new tripwire:
> `bcdedit-timer-flags`/`defender-policy-off` stay resolver-less forever). Restore stays
> backend-only — no FE surface calls it yet. Verify: cargo 725/725 (+24 ignored owner-QA; count
> UP from 724) · clippy clean · vitest 1682/1682 · verify-release-state 46/46 ·
> rust-tauri-reviewer PASS. Installer rebuild follows in this train (version bump → 0.9.0); stamp
> line updates at the reinstall commit.

> **UPDATE 2026-07-16b (OPTIMIZATION CLEANUP PHASE 0 SHIPPED `55f68b6` — installer SHA-256
> `7D6C562389CE3944A45A8A5F17E1204D36F0D76392BE4EE209707E778DD17B50`, live exe stamp-verified
> (embedded `55f68b6`, CLEAN — no `+dirty`; Select-String), one installer on the Desktop, silent
> reinstall done. Dirty-stamp guard overridden deliberately (2026-07-16a precedent): tree dirt was
> exclusively parallel-lane files (COWORK_*.md · ui-sweep shots · stray scratchpad png) + this
> banner's own docs edits; app inputs (`git status --porcelain -- src src-tauri …`) empty at build.
> Frontend-only, NO gate moved, zero mutation boundary):** the live `leftovers.rs` read-only audit
> now fronts as **"Optimization Cleanup"** (owner-locked name 2026-07-15) and is UNBURIED from the
> "Nothing else needs attention" side pile to a first-class Check section (title + blurb + "Check
> this PC for old tweaks" run button). **Leftovers restore stays DARK** — the gate row below is
> unchanged (`restore_gate()==false`, no registered command, Phase 1 not scope-gated). terms/tweaks
> data renamed; title-case "Past Tweaks" pinned as a retired label (stale-reference-guard). Verify:
> tsc 0 · vitest **1682/1682** (181 files) · self-reviewer **PASS 9/9** (pre-run/busy/real-result/
> fixture-findings states; contrast 11.3:1 header; no dup mount; dist-site restaged — staleness
> guard green). Spec: `docs/superpowers/specs/2026-07-16-optimization-cleanup-research-spec.md`.

> **UPDATE 2026-07-16a (APP-LANE TASK LIST CLOSED: room-palette 8-duo+7-solo rework · App.css
> gradient-ink de-slop · NAV-MOUNT COST FIXED — installer SHA-256
> `832B7CF3BDBD2603F925EDD18DD9A1669B0AB74CC441A7675769B46F48687A4E`, live exe stamp-verified
> (embedded `b968f0a`, CLEAN — no `+dirty`; Select-String), one installer on the Desktop, silent
> reinstall done. Dirty-stamp guard overridden deliberately (2026-07-15f precedent): tree dirt was
> exclusively parallel-lane files (Cowork `COMPY_OVERVIEW.md` + a stray scratchpad png); app inputs
> (`git status --porcelain -- src src-tauri …`) empty at build. Frontend-only, NO gate moved, zero
> mutation boundary):** four commits — `92596d6` room-accent palette reworked to 8 curated two-color
> shift duos + 7 standard-spectrum solids (owner pick: duos are the favorites; adaptive-ink law kept)
> · `47300d9` App.css gradient-text de-slop + CoreBar transform-based fill · `b2d775d`
> UI_VISION_BACKLOG stale-list fix (Monitor gauges + Blackbook flight-recorder recorded 🟢 already
> shipped) · `d0392c9` **nav-mount cost FIXED** (closes the 2026-07-15f follow-up): MonitorV2's
> duplicate sensor pre-warm deleted; SessionStack's per-row `getComputedStyle` forced recalcs (≤15)
> → ONE hoisted accent listener + shared ink cache (≤4 reads, in-place accent repaint guard
> re-pinned); Blackbook tape capped at 30 first-render rows + "show N older records" disclosure
> (counts/sinceDate still full-set; 2 bug→guard vitest cases). `b968f0a` = the site lane's site-only
> commit atop `d0392c9` (no app diff). Verify: tsc 0 · vitest **1666/1666** (181 files) ·
> self-reviewer **PASS 8/8** on live data (73-record tape: 30+disclosure → unroll; accent pick
> repaints in place; only-new-element check passed).

> **UPDATE 2026-07-15f (APP CONSOLE TRAINS 1–4 SHIPPED DEFAULT-ON + OVERLAY BACKDROP FIX — installer
> SHA-256 `B87B3B3CC78527AF08C2000FDEC740676742E066E0AD13A3D623A0A553B3D20C`, live exe stamp-verified
> (embedded `f160839`, clean — no `+dirty`; Select-String), one installer on the Desktop, silent
> reinstall done. Dirty-stamp guard overridden deliberately: tree dirt was exclusively parallel-lane
> files — Cowork's `COMPY_OVERVIEW.md` WIP + the site lane's untracked `site/*.html` — none of which
> compile into the app (`git status --porcelain -- src src-tauri …` empty at build). Frontend-only,
> NO gate moved, zero mutation boundary):** four commits — `50b505e` Train 1 Monitor console
> density/backdrop fold-in · `f4b4ada` Train 2 Settings quiet chrome · `40bce4e` Trains 3+4: Gaming
> Mode arm/engage console face (`compy_gaming_console` DEFAULT ON) + app-wide viewport HUD frame &
> global reticle (`compy_hud_frame` DEFAULT ON; classic reachable via the "0" failsafe, flag-off
> byte-identity test-pinned) · `f160839` **owner-reported overlay defect FIXED**: main.tsx applies
> skin attributes to documentElement before branching on the overlay window label, so document-level
> ambient pseudo layers (App.css `body::before` aurora, seasonal `::after`) painted a faint
> full-window backdrop over fullscreen games — Overlay.css now blanket-kills all six document-level
> pseudo slots (`content: none !important`), live-verified in the actual overlay window over CDP.
> Bug→guards: `src/overlay-ambient-guard.test.ts` (kill rule present + no `content !important` on
> document-level pseudos + no `:has()` on the nav-hot `.v2-shell`). Nav timing A/B-attributed: this
> train adds no cost (Home/Lab in band flag-on); residual Monitor/Blackbook nav-mount slowness is
> PRE-EXISTING (equally slow flag-off) — follow-up flagged. Verify: tsc 0 · vitest 1656/1656 (181
> files; 8 skipped) · no Rust diff. self-reviewer round-3 **PASS** (7/7 rubric; consent modal
> exercised + cancelled; 52px readout clearance verified at true scrollHeight).

> **UPDATE 2026-07-15e (SITE COMPLETION — SEO/LAUNCH PLUMBING + `/compare` LIVE, DEPLOYED — site-only,
> NO gate moved, zero `src-tauri/`, zero `src/`):** the compy.gg launch-readiness layer landed and is
> LIVE on the Pages host. New: canonical URL scheme across every page (landing `/`; picks canonicalize
> to `https://compy.gg/<id>` from both the top-level and library copies; non-picks → `/library/<id>`;
> legal → `/privacy`, `/eula`; compare → `/compare`), `robots.txt` + `sitemap.xml` (196 URLs, **no
> lastmod/priority/changefreq** — honesty law: never fabricate freshness), favicons (bracket-mark
> `favicon.svg` + hand-built `favicon.ico`), a static `404.html` (noindex, root-absolute links, no JS),
> honest JSON-LD (TechArticle on articles/teasers, SoftwareApplication on landing — **guard bans
> aggregateRating/reviewCount/ratingValue**), and the **new `/compare` page** (Design Director spec,
> council 2026-07-15: five construction-practice axes — rollback · kernel/anti-cheat · catalog
> transparency · telemetry default · cost model — **never names a competitor, never invents a
> performance number, admits the tradeoff on every axis**). Guard: new `scripts/site-seo.test.mjs`
> companion suite; full site pipeline **40/40 green** (site-landing + staleness + seo). Self-review
> **PASS** (agent `adae2dc1b4d75fff8`: computed contrast verified — `#f2ede4` on `#0d0b07` panel,
> `#140a00` on `#ff9a1e` primary; mobile 390px no overflow; single footer; nav Receipts→Blackbook→
> Compare→FAQ→waitlist; skip-links resolve; no retired-brand copy). **DEPLOYED** (owner's deploy GO,
> 2026-07-15): `npx wrangler pages deploy dist-site` → deploy `d8a40fc5.compy-bd6.pages.dev`, apex
> **promoted + verified** (apex HTML md5 `458dc641203451a34e7eb44eeeb47ec1` == deploy hash; `/compare`,
> `/sitemap.xml`, `/robots.txt`, favicons all 200; a real HTTP 404 on unknown routes).
> **Owner's deploy GO supersedes the older "site stays PRE-PUBLISH / deploy owner-gated" language**
> in this file and BACKLOG.md — the site now deploys autonomously. STILL owner-gated for launch:
> the **`compy.gg` domain purchase** (canonicals/sitemap/JSON-LD already point at it; site currently
> lives only on `compy-bd6.pages.dev`). No app gate moved; no mutation boundary touched.

> **UPDATE 2026-07-15 (`--run-elevated` BOUNDARY-SIDE GUARD SHIPPED `4bf2a91` — the Phase B
> defense-in-depth item from BACKLOG closes; MUTATION-BOUNDARY code (elevation), Cowork adversarial
> audit warranted; NO gate moved. Installer re-cut + silently reinstalled same day: SHA-256
> `265275CD1494A7E4AE3D64CDD21CAD8494179CD88E647F957C7313BF8E547BC7`, live exe embeds `4bf2a91`
> [Select-String verified], one installer on the Desktop — dirty-stamp guard overridden
> deliberately: tree dirt was the parallel site lane's `site/generate.mjs` WIP, not app code):**
> the elevated helper entry no
> longer runs whatever hex it is handed. `run_elevated_powershell` — the ONLY dispatch point, where
> every command has already passed typed-dispatch/`ps_safe` validation — now mints a ONE-TIME
> dispatch ticket (`%APPDATA%\Compy\runtime\elev-<pid>-<seq>.ticket`, content = the exact command
> hex) and passes its path as a third argv; the helper refuses any hex that doesn't byte-match its
> ticket (exit 3, runs ZERO PowerShell) and consumes the ticket before running, so a dispatch
> executes at most once (`mint_elevation_ticket` `actions.rs:1149`, `run_elevated_helper` `lib.rs:76`,
> argv `main.rs:12`). Content-agnostic exact-match ⇒ can never
> false-reject a legitimate apply (every builder's output passes by construction). Honest-attribution
> preserved: mint failure = a third pre-launch refusal classified nothing-ran
> (`elevation_error_nothing_ran`); helper exit 3 reads "approved, but the operation failed" — never a
> false success; decline leaves the ticket → parent cleans up. 4 guard tests both directions
> (foreign hex rejected without burning the legit ticket · batch-script + torture-set payloads pass ·
> end-to-end helper refuses no-ticket/replay · minted dispatch runs exactly once). Also this cycle:
> `5752970` shipped the additive downsampled per-session FPS series (`sessions.rs` `fps_series`,
> read-only, no mutation boundary). Verify: cargo 724/0 (up from 720) · clippy clean · tsc 0 ·
> vitest 1632/1632. rust-tauri-reviewer verdict recorded in the commit.

> **UPDATE 2026-07-14d (GAMING TOAST SHIPPED `4e46287` — installer SHA-256
> `EF3A5FC5C930B47C219D17C695FC1B051458A084E445FC8D32BE8341F56D80C5`, live exe stamp-verified
> (embedded `4e46287`, clean tree — Cowork's site lane committed as `b6f8213` before the build),
> supersedes the `08605B25…F791F` installer):** owner ask at QA sign-off — the global Gaming Mode
> crash-recovery banner + success confirmations moved from full-width top bars to a bottom-right
> `.gaming-toast-stack` popup with a this-run-only × dismiss (never clears the recovery; never-hide
> law intact). Frontend-only, no gate/mutation change. tsc clean · vitest 1631/1631 · self-reviewer
> PASS. Gaming Mode QA is **owner-SIGNED-OFF 2026-07-14** (`9cddac7`) — all 10 live cases passed.

> **UPDATE 2026-07-14c (ELEVATION-DECLINE FIX SHIPPED `db5349e` — installer SHA-256
> `08605B25E8C2E8709826D1AA57F7451BD3FB4221D5716FBB1019051CA32F791F`, live exe stamp-verified
> `db5349e+dirty · release` via CDP `get_build_stamp` (+dirty audited benign: the parallel Cowork
> site-lane WIP, none of it compiles into the app; installed with deliberate `-AllowDirty`),
> supersedes the `4B916615…43DCC18` installer. MUTATION-BOUNDARY code — Cowork audit warranted):**
> live GAMING_MODE_QA case #6 exposed that the `runas` crate (1.2.0) never returns `Err` on Windows —
> a UAC **decline** (ERROR_CANCELLED 1223) collapsed to `Ok(exit -1)`, so the app blamed the user
> ("You approved the elevation, but the operation itself failed") and the abort path fired a spurious
> SECOND prompt. Fix: `runas` removed; own `actions::elevate_and_wait` (ShellExecuteExW, launch error
> preserved via `shell_launch_error_to_io`, unreadable exit maps conservatively — never fabricated
> success) at all 3 call sites (`run_elevated_powershell`, test seam, FPS helper); 3 guard tests pin
> 1223→decline. Verify: cargo 715/0 · clippy clean. **GAMING_MODE_QA is now 10/10 PASSED** — #6/#7
> owner-clicked (No·Yes·No·Yes) on this build 2026-07-14; UAC policy + app token verified read-only
> (`EnableLUA=1`/`CPBA=5`/secure-desktop 1, compy token Limited). Awaiting only the owner's
> "Gaming Mode QA signed off".
>
> **UPDATE 2026-07-14b (DIRTY-STAMP AUDIT + GUARD — no ship, no gate moved):** the LIVE PART B build's
> full stamp reads **`2eda4eb+dirty · release`** (caught via CDP `get_build_stamp` during the JARVIS
> deviation-evidence captures). **Audited BENIGN:** tracked tree was clean; the dirty bit came from 89
> untracked `docs/` files (`git status --porcelain` counts `??` lines), which never compile into the
> binary — the live exe is code-identical to `2eda4eb`, so the installer row above stands and NO re-cut
> is needed. Why it slipped: the embedded-HASH verify can't see the dirty bit. Fixes (this commit):
> `src-tauri/build.rs` dirty check now excludes `docs/` (`:(exclude)docs` pathspec — untracked non-docs
> still counts) · **new DIRTY-STAMP GATE** in `scripts/ship-reinstall.ps1` step 0b (throws on non-docs
> tree dirt before install; `-AllowDirty` = deliberate override; red→green proven with a non-docs probe).
> The next build/ship stamps clean. Also this cycle: **owner RATIFIED both JARVIS motion deviations**
> (2026-07-14: Dock keeps lift-only, no magnetic pull; no hologram shader-pulse — gauge data-tick stays
> the vehicle, idle-GPU 0-draws/15s re-proven live) — the A7 "may still overrule" tail is closed.
>
> **UPDATE 2026-07-14 (CONSUMER-PANEL PART B SHIPPED `2eda4eb` — installer SHA-256
> `4B916615DF25A8D4EBEE29E4BAEDAA3C178634209F38D90195A9D5C1643DCC18`, live exe stamp-verified `2eda4eb`
> via the embedded hash, installed by Claude + LIVE, supersedes the `CA408DF4…AA00F795` installer; NO
> gate moved, display-only — zero mutation-boundary code):** the owner-approved PART B pair. **B7 site
> hero "positives first, credibility as the shield":** the stage stacks two provenance-pinned strips —
> TOP `.proof-win` is a real Diablo IV measured-session showcase (237 avg fps / 214 1% low, 3h,
> `site/src/session-receipt.json`) with NO gain claim (the Monitor "▲37 avg" delta was REJECTED for the
> slot: 94% vs 41% GPU load between its two sessions = indefensible attribution; documented in the
> receipt JSON), BOTTOM keeps the game-mode null receipt retitled "The honesty test · we publish the
> misses"; `scripts/site-landing.test.mjs` pins both strips to their JSONs and rejects gain-claim
> phrasing in the win strip. Site stays PRE-PUBLISH — hero copy is owner taste-gated before publish.
> **B6a hologram-as-index:** Home rig callouts (GPU/CPU/RAM/Storage) expand on demand (hover peek /
> click pin, `HomeConsole.tsx` dense builders) into detected-only dense readouts; missing field = no
> row; drag-orbit preserved; 4 new guards in `home-console.test.tsx`. **B6b:** Settings "JARVIS motion"
> sub-description now descriptive (`Settings.tsx:259`). Verify: tsc 0 · vitest 1628/1628 (up from
> 1623) · site 17/17 · self-reviewer PASS (8/8 incl. GL-idle 0 draws with all callouts pinned).
>
> **UPDATE 2026-07-14 (CONSUMER-PANEL PART A HONESTY FIXES SHIPPED `9a29cfe` — installer SHA-256
> `CA408DF49BC747C2E0360135CD3F055F2040F29C64CDA96DE77BC9D0AA00F795`, live exe stamp-verified `9a29cfe`
> via the embedded hash, installed by Claude + LIVE, supersedes the `26D42379…D483979A` installer; NO
> gate moved, display-only — zero mutation-boundary code):** the 2026-07-14 consumer-panel PART A
> items: Expert View's "every tweak" promise now covers the deliberately-refused tier
> (`expert-targets.ts` + `REFUSE_PILE` rows render the gated `ExpertTargetLine`; default-OFF face
> pinned unchanged) · Monitor vs-last-session tag appends "· COMBINED EFFECT" when >1 change is on,
> tooltip routes attribution to the Lab A/B bench · Home rig RAM callout gains measured speed /
> EXPO-XMP note · `prettyGameName` strips UE `-Win64-Shipping` suffixes. Verify: tsc 0 · vitest
> 1623/1623 (up from 1610) · self-reviewer PASS (Expert ON/OFF, live 11-changes session). PART B
> (theater-vs-data merge, hero proof framing) answered directionally by owner — proposals pending,
> nothing built.
>
> **UPDATE 2026-07-14 (FULL-PROJECT REVIEW CLEANUP SHIPPED `4dbfca4`+`3ba79dc` — installer SHA-256
> `26D42379A1A3EED60E95CFC4315B48303362064AA8784C0D6482900D483979A3`, live exe stamp-verified `3ba79dc`
> via the embedded hash, installed by Claude + LIVE, supersedes the `1C1F13DC…FE657E0` installer; NO
> gate moved):** part (b) of the Fable-5 exhaustive review — every finding fixed. FE/site batches
> (App.tsx dead-tab removal, retired-brand sweep + stale-reference guard, LicensePanel `armed` from
> `status.armed`, waitlist atomic rate-limit + CSP + D1 migration, ErrorBoundary/safe-storage) +
> backend non-mutation (license `armed` stamp, PDH `Drop`, fps helper liveness) + mutation boundary
> under the full mutation-gate (10/10): `with_error_action_stop` single-command false-ledger guard ·
> `nic_interface_safe` GUID charset guard · Nagle apply/rollback per-call `-ErrorAction
> SilentlyContinue` (mid-loop interface failure can't orphan earlier live writes) ·
> `gaming_orchestrator::start()` fail-closed when an unreadable session file can't be quarantined ·
> bug→guard `every_nagle_set_itemproperty_write_isolates_its_own_error`. rust-tauri-reviewer:
> "mutation boundary sound, merge-ready". Verify: cargo 712/0 (up from 711) · clippy clean · tsc 0 ·
> vitest green · verify-release-state 38/38 (6 citations re-anchored). `3ba79dc` also logs the
> `--run-elevated` boundary-side guard as a Phase B defense-in-depth backlog item (owner-approved,
> not launch-blocking). Cowork adversarial audit flagged for the mutation diff.
>
> **UPDATE 2026-07-13 (390px LANDING PAGE-EDGE OVERFLOW FIXED — site-only commit, NO gate moved, no
> installer change, zero `src-tauri`, zero `src/`):** the pre-existing mobile defect the hero-receipt
> pass logged is closed. Root cause: `.topbar`/`.hero`/`.article` share their element with `.wrap`
> and their `padding:` shorthands zeroed `.wrap`'s 24px side padding — below ~1128px the hero ran
> edge-to-edge and the verdict ribbon's `-10px` overhang + 7px glow scrolled the page to 407px at a
> 390px viewport; article text sat flush at x=0 on every library/debunk page. Fix: longhand
> `padding-top/-bottom` on all three (`site/src/library.css`, regenerated) + `.hero h1` clamp cap
> 44→42px (self-review catch — the narrowed 569px column wrapped the headline to 3 lines ≥1294px).
> bug→guard in `scripts/site-landing.test.mjs` (red-proven on the pre-fix CSS; scans wrap-combined
> classes from landing + article templates for the shorthand; pins generated==source). Verify:
> self-reviewer PASS (390 visuals + h1 2-line boxes at 1280/1440/1920) · index sw==cw at
> 390/1280/1440/1920 · article 24px inset at 390, desktop unchanged · site-landing 17/17 · vitest
> 1610/1610. Site stays pre-publish; the live installer stays `86ecad1`/`1C1F13DC…`.
>
> **UPDATE 2026-07-13 (SITE HERO RECEIPT NOW REAL — site-only commit, NO gate moved, no installer
> change, zero `src-tauri`, zero `src/`):** the landing hero's proof-strip numbers were a decorative
> mock (`fast-startup-off` "+8 fps · 1% low +11") that a consumer-panel persona flagged as fabricated
> under the "measured, not promised" headline. Replaced with a REAL receipt measured through the
> app's own Lab → Benchmark tweak A/B flow on the dev rig 2026-07-13: `game-mode` → live Palworld
> frames → **within ±0.7% noise** (same-session calibrated floor) → auto-rolled-back (ledger
> `game-mode-1783992509604`). Provenance: `site/src/proof-receipt.json`; guard:
> `scripts/site-landing.test.mjs` pins strip↔provenance + bans the mock trio (site-landing 16/16).
> Site remains pre-publish (hosting owner-gated); the live installer stays `86ecad1`/`1C1F13DC…`.
>
> **UPDATE 2026-07-13 (GLOSSARY-TOOLTIP TRIO FIXED `86ecad1` — installer SHA-256
> `1C1F13DC259A99042918B5F1714B518F3825EFB1B080FC3443316F1CBFE657E0`, live exe stamp-verified
> `86ecad1` via the embedded hash, installed by Claude, supersedes the `A8C341DE…61EC1C10` installer;
> NO gate moved, zero `src-tauri`):** two owner-reported defects on the new Blackbook tape's "1% low"
> gloss + one found by the fix's own self-review. **(1) Tooltip buried under later rows:** the tape
> reveal's `animation-fill-mode: both` made every `.bc-row` a PERMANENT stacking context (a filled
> transform/opacity animation does that) — sibling contexts paint in DOM order, so rows below the
> hovered row painted over the open tooltip; fix `both → backwards` (`blackbook-console.css`), guard
> bans `both`/`forwards` on the row animation. **(2) "More in the Blackbook →" unreachable:** the
> tooltip sits across a 6px hover gap and mouse-leave closed it instantly; fix = 160ms close-grace in
> `Term.tsx` (re-entering the wrapper cancels; focus/Escape unchanged), fake-timer guards in
> `Term.test.tsx`. Benefits every Term site app-wide (Monitor "frametime" hero gloss
> regression-checked). **(3) Deep-link never scrolled (pre-existing, exposed by 2):** Learn's
> scroll-into-view effect ran before the focused entry's category expanded and never re-ran — the
> card sat ~1100px off-screen; fix adds `openCats` to the effect deps (`Learn.tsx`), guard pins a
> focusId mount fires scrollIntoView + flashes the card. Verify: tsc 0 · vitest **1608** (178 files) ·
> self-reviewer **PASS** (live real data: tooltip opaque `rgb(20,24,36)` over sibling rows; real
> CDP pointer crossed the gap, link navigated, card landed `rect.top=108` vs 1023+ off-screen before;
> stagger + reduced-motion intact).
>
> **UPDATE 2026-07-13 (DEFAULT-ON GRADUATION + DUO PALETTE + A+B BLACKBOOK SHIPPED `18272be` — installer
> SHA-256 `A8C341DEB55F32630E59144D6CA33CAF205A16B48A34F8923C27D65861EC1C10`, live exe stamp-verified
> `18272be` via the embedded hash, installed by Claude, supersedes the `21942094…0930FF4F` installer;
> **TWO FLAGS GRADUATED DEFAULT-ON:** `compy_room_identity` + `compy_blackbook_console`, both readers
> now `!== "0"` in `src/design/theme.ts`, boot attr in `main.tsx` — the owner eyeballed both and directed
> "everything was supposed to be default on to avoid the QA toggle section"; both "(preview)" Settings
> rows REMOVED per the graduated-flag convention, devtools localStorage `"0"` stays each failsafe):**
> Three owner directives in one train. **(1) Duo palette** ("double color options rather than the ugly
> earth tones like olive … then leave that finished"): `ROOM_ACCENT_SWATCHES`
> (`src/design/room-identity.ts`) re-curated to **15** — Rust/Olive/Pine pruned; 3 DUO swatches added
> (Cyan/Midnight `#35e0e8+#3b2a7a` · Red/Blue `#ff6b6b+#2f6bff` · Lime/Cyan `#b6f24a+#35e0e8`); a duo's
> bright PRIMARY carries every legibility role (chrome/buttons/text) while the SECONDARY drives only the
> `--v2-accent-dim/-line` washes; persisted as an `a+b` key (`swatchKey`/`splitSwatchKey`, bare-hex
> singles stay backward-compatible), picker dots render a 135° split (`swatchDotCss`). **(2) A+B
> Blackbook intuitiveness** (owner picked "A + B together" from the concept artifact): the Logbook gains
> the **Receipts Strip** — three tappable count tiles ("Changes to this PC" / "Gaming sessions" /
> "Guides fact-checked") replacing the bare "N records" line, filtering the tape (aria-pressed;
> zero-count disabled; counts derived from the same records the tape renders) — plus **sentence-grammar
> rows** ("Compy applied X" / "You played G for T" / "You fact-checked a guide") and a tape section head
> speaking the field-guide eyebrow grammar (`src/surfaces/blackbook/BlackbookConsole.tsx` + css).
> **(3) bug→guard from the ship's own self-review (round-1 FAIL, fixed):** a Home accent pick recolored
> chrome but never the rig hologram — `use-rig-colors.ts` read `.v2-room` while Home's `--ix-accent`
> re-point lives on the NESTED `.home-console`; fix prefers `.home-console ?? .v2-room` + call-order
> guard (`room-identity.test.ts`). **Zero `src-tauri`** (`git diff -- src-tauri` empty). Verify: tsc 0 ·
> vitest **1604** (177 files) · self-reviewer **round-2 PASS** (native 1500×980, the owner's REAL
> 70-record logbook: strip counts 51/19/0 sum to the tape, changes-tile "13 still on" == the Lab jump's
> number, rig recolor pixel-proven for Plum AND a duo with `--ix-accent` read back off `.home-console`,
> Lab emerald no-regression, reduced-motion still, GL idle 0 draws/18s). The owner's A8/A9 checklist
> items are RESOLVED by these directives (OWNER_ACTION_CHECKLIST updated same commit).
>
> **UPDATE 2026-07-13 (DEAD-CODE CLEANUP + READINESS RETIRED-LABEL FIX SHIPPED `2b64c51` — installer
> SHA-256 `219420944926D99318CFB8FFA6D689952D154FF6005756926BF334640930FF4F`, live exe stamp-verified
> `2b64c51` via the embedded hash, installed by Claude, supersedes the `703F078B…9EE40B8` installer;
> NO gate moved):** Cycle 2026-07-13b turbo-window maintenance pass. The live build `2b64c51` is the
> docs persist-commit sitting atop the code change `c80678f`; the exe was **rebuilt at HEAD** so the
> stamp is truthful — the sole `c80678f`→`2b64c51` delta is `docs/BACKLOG.md`, which is not compiled or
> bundled, so the shipped binary is functionally identical to `c80678f`. **Dead-code removal**
> (grep-verified 0 importers, tsc-confirmed no dangling refs): 7 never-adopted vendored React Bits dirs
> deleted (14 files — DotField/GlareHover/GooeyNav/Grainient/Noise/PillNav/Radar, bulk-vendored
> `9d66be9`, never wired; `tokens-v2-guard` "vendor kit present" floor 12→7 adopted set; `THIRD_PARTY.md`
> pruned + `ogl` flagged as a likely-orphaned npm dep for a dedicated prune pass) + `monotonePathD`
> (`console/monotone.ts`, 0 importers; sibling `monotoneSegments` stays). **readiness.rs retired-label
> leak** (drift-audit find; room-labels-vs-nav-ids law): the applied-changes check said "roll it back in
> Optimize", but post the 2026-07-10 ground-flip the default rail has no standalone Optimize tab — the
> undo home is the Lab; both strings → "in the Lab", and the Rust test that had enforced the stale
> "Optimize" text (a false-green) flipped into a **bug→guard** (asserts "the Lab" present AND no "in
> Optimize" dead-end). The ONLY `src-tauri` touch is that read-only copy + its guard — **no gate, no
> mutation/rollback path, no IPC changed.** Verify: tsc 0 (re-proven by this build's `tsc && vite build`)
> · cargo test readiness 35/0 · vitest 1593/1593 · release rebuild exit 0, live exe stamp `2b64c51`.
> **Deferred (flagged, NOT dead-by-oversight):** RigViewer non-chromeless chrome (~140 lines — a live
> test exercises it, needs a product call that LabConsole is its only forever-caller), CompyHero /
> readCommitted (parked future landing hero), 14 orphaned theme.ts `apply*`/`read*` exports (verified
> 0-reference, deferred to a focused theme.ts pass — critical file). Closes Cycle 2026-07-13b.
>
> **UPDATE 2026-07-13 (MONITOR v5 "frametime" JARGON GLOSS SHIPPED `530ef8b` — installer SHA-256
> `703F078BCEA0BBA2BF740F93A7E559A421CB06D82CC5B981C8A6463B99EE40B8`, live exe stamp-verified
> `530ef8b` via the embedded hash, installed by Claude, supersedes the `B7931E4E…5A3E92BC` installer;
> NO gate moved — the Monitor console is already DEFAULT ON, `compy_room_identity` stays DEFAULT OFF):**
> Closes the **deferred Monitor-surface jargon bucket** from the consumer-panel overhaul (`50b5c03`) —
> held per that plan's own sequencing note until the Monitor v5 owner eyeball settled, which it has
> (console flipped DEFAULT-ON `e195f70`). The v5 DeckScope hero exposed the raw term **"frametime"** on
> its scope label with no gloss, while the sibling Play face (`Play.tsx:266`) + the Deep-Monitoring
> section-help (`App.tsx:1800`) already wrap it in an inline `<Term>` — a jargon gap against CLAUDE.md's
> own no-jargon promise for the non-technical gamer. **Fix:** `Oscilloscope`'s `label` prop widened
> `string → ReactNode` (backward-compatible; mirrors the ArcGauge ReactNode-label precedent — every
> other caller passes a plain string), and `DeckScope` (`src/surfaces/monitor/DeckScope.tsx`) now passes
> `label={<Term id="frametime">frametime</Term>}` → the hero renders "FRAMETIME" as a dotted-underline
> gloss trigger with the one-line frametime definition + Blackbook link. **Only "frametime" is glossed:**
> FPS/latency/spikes/budget are consumer relabels, self-explanatory, or have no correct glossary term
> (glossing "LATENCY" with the `input-latency` term would be factually WRONG — the readout is a frametime
> minimum). **Zero `src-tauri`** (`git diff -- src-tauri` empty). bug→guard: `deck-scope.test.tsx` pins
> the hero renders a real glossary Term (`.osc-label .kl-term` == "frametime") + the tooltip reveals the
> definition (a dead id fails soft to plain text → the guard would find nothing). Verify: tsc 0 · vitest
> **1607** (177 files; +2 guards) · self-reviewer **PASS 8/8** (live 1500×980: `.osc-label .kl-term`
> `rgb(139,147,167)` uppercase matching siblings, dotted accent underline ~6.37:1 on the dark panel;
> tooltip opens/closes on hover+click, not clipped; FPS/latency/spikes/budget stay plain; backward-compat
> proven — sibling `label="fps"`/gauge callers unchanged).
>
> **UPDATE 2026-07-13 (DARK-ACCENT-AS-TEXT LEGIBILITY SHIPPED `cc9adb8` — installer SHA-256
> `B7931E4EE26F594A1AE746908EA2CB9F4B18B876831E9F4DD6472E695A3E92BC`, live exe stamp-verified
> `cc9adb8` via the embedded hash, installed by Claude, supersedes the `51B0A754…3862F39A` installer;
> SAME flag `compy_room_identity` **DEFAULT OFF** — owner one-flip eyeball still the open gate):**
> **Closes the KNOWN FOLLOW-UP the prior banner logged.** A DARK per-room accent pick rendered ~2.5:1
> wherever chrome used the accent as foreground TEXT on the dark panel (the adaptive INK covered
> accent-as-FILL only — this adds the accent-as-TEXT half). Fix: each of the 6 dark swatches gains a
> paired light, hue-carrying `text` tint (`src/design/room-identity.ts`, `swatchText()`);
> `applyRoomAccents` (`src/design/theme.ts`) emits `--v2-accent-text`/`--ix-accent-text` (the light
> tint) for dark picks only — bright picks emit neither. In-room accent-as-text sites swept
> `var(--ix-accent)` → `var(--ix-accent-text)` (dock, blackbook-console, monitor-console, Lab,
> lab-bento) and `var(--v2-accent)` → `var(--v2-accent-text, var(--v2-accent))` (HUD masthead sep,
> forward-door arrow, optimize chip-count, home-hud); `home-console` gains `--ix-accent-text` via the
> fallback (it is a descendant of the managed-style target). Scoped `.v2-room` overrides fix Check
> ✓-marks / GamingMode marker / Learn superseded-link hover — each ALSO renders OUTSIDE any room
> (escape-hatch / portal / overlay), kept byte-identical there. **Zero `src-tauri`.** Verify: tsc 0 ·
> vitest **1605** (177 files; 5 new guards: legibility ≥4.5:1 vs panel · load-bearing · coverage ·
> swatchText · emit-mechanism) · read-only scope audit (confirmed no other in-room accent-as-text
> site) · fresh-context adversarial review (2 findings fixed: Learn hover, missing emit-test) ·
> self-reviewer **PASS** (live 1500×980: Home dock `#ef8ea8` ~8.1:1, Monitor `#c79cef`, Blackbook
> `#68d2a6`, Lab `#98b4e6` ~8.9:1; flag-off byte-identity confirmed). Flag stays **DEFAULT OFF** — do
> NOT flip room-identity default-ON until the owner eyeballs.
>
> **UPDATE 2026-07-13 (ACCENT PALETTE PRUNED 20→15 SHIPPED `8e6920f` — installer SHA-256
> `51B0A754C2CC2578302771168F45C13850A7ED24DABDEF23E98F7F1B3862F39A`, live exe stamp-verified
> `8e6920f` via the embedded hash, installed by Claude, supersedes the `97C581BB…EEE7698` installer;
> SAME flag `compy_room_identity` **DEFAULT OFF** — owner one-flip eyeball on the pruned palette is the
> open gate):** Owner follow-up — *"looks good but i agree to prune and widen variety more
> differentiation."* Re-curates `ROOM_ACCENT_SWATCHES` (`src/design/room-identity.ts`) from 20 → **15**
> (9 bright + 6 dark): pruned the near-dupe clusters (four warm-oranges → Amber; three pinks → one
> Magenta; teal/cyan overlap → Teal), re-spread the survivors, and added a dark **Olive** `#5f5620`
> (paired ink `#f7f3e0`) in the empty dark-gold gap. Differentiation is VERIFIED by CIEDE2000: minimum
> non-preset pairwise distance **18.0** (was 13.4 for the flagged Magenta/Rose); the only closer pair is
> the LOCKED Teal/Emerald presets (14.3, both green). Legibility law + adaptive-ink mechanism unchanged.
> **Zero `src-tauri`.** Verify: tsc 0 · vitest **1600** (177 files) · CIEDE2000 differentiation audit ·
> fresh-context adversarial review (Magenta/Rose fix confirmed) · self-reviewer **PASS** (live CDP:
> Monitor/Plum text `#f4e9ff` on dark fill, Home/Olive room vars confirmed, Blackbook/Magenta text
> `#1a0a2e` on bright fill; 15-swatch grid clean 5×3).
> **KNOWN FOLLOW-UP (pre-existing, tracked — NOT this diff):** where chrome uses the room accent as
> direct TEXT on a dark background (Lab station tabs, Home dock, blackbook tags) a DARK accent renders
> ~2.5:1 — the adaptive ink covers accent-as-FILL only, not accent-as-TEXT. Shipped already with the
> prior 5 dark swatches (`8a9ab76`); a focused accent-as-text legibility train is queued (BACKLOG).
>
> **UPDATE 2026-07-13 (ACCENT PALETTE EXPANDED 10→20 SHIPPED `8a9ab76` — installer SHA-256
> `97C581BB4EF4EA47579939C2D9519F0603D72BF20FDA994BDDCAD7D9FEEE7698`, live exe stamp-verified
> `8a9ab76` via the embedded hash, installed by Claude, supersedes the `457A2D00…F73EBDCE` installer;
> SAME flag `compy_room_identity` **DEFAULT OFF** — owner one-flip eyeball on the NEW palette is the
> open gate):** Owner Cycle-12k follow-up — *"more variety of color diversity, more neon or bright/dark
> tone mixed."* `ROOM_ACCENT_SWATCHES` (`src/design/room-identity.ts`) grows from 10 bright swatches to
> **20**: 15 bright/neon (adds Magenta/Azure/Chartreuse/Tangerine/Hot Pink) + **5 true DARK tones**
> (Indigo/Wine/Pine/Plum/Slate). Dark tones ride an **adaptive ink** — each dark swatch carries a paired
> light `ink`; `applyRoomAccents` (`src/design/theme.ts`) emits it as BOTH `--v2-accent-ink` AND
> `--ix-accent-ink` in the managed `<style>` per pick, so a dark accent FILL flips to legible
> light-on-dark; bright swatches emit no ink override (keep the default dark ink `#1a0a2e`). Legibility
> law mechanized BOTH ways (`room-accents.test.tsx`): every bright swatch ≥4.5:1 vs `#1a0a2e`; every dark
> swatch ≥4.5:1 vs ITS ink AND genuinely <4.5:1 vs `#1a0a2e` (adaptive ink is load-bearing, not
> decorative). **Zero `src-tauri`** (`git diff -- src-tauri` empty). Verify: tsc 0 · vitest **1600**
> (177 files) · adversarial fresh-context diff review **SOUND** (min contrast Pine 5.94:1) · self-reviewer
> **PASS** (live CDP 1500×980: Monitor/Indigo text `#ece9ff` on dark fill, Blackbook/Magenta text
> `#1a0a2e` on bright fill — contrast law holds both directions; 20-swatch grid clean 5×4). Supersedes
> the 12j picker's 10-swatch palette; the picker mechanism/wiring is unchanged.
>
> **UPDATE 2026-07-12 (PER-ROOM ACCENT PICKER SHIPPED `20e2b50` — installer SHA-256
> `457A2D00491672BD8F2C2DBF455EE1349975679FEB9206AD3EB7D419F73EBDCE`, live exe stamp-verified
> `20e2b50` via the embedded hash, installed by Claude, supersedes the `D23DE073…9EBA9` installer;
> SAME flag `compy_room_identity` **DEFAULT OFF** — owner eyeball is the open gate):** Extends the
> per-room identity accents (Cycle 12i) with a **user-facing picker**. When `compy_room_identity` is ON,
> each room shows a small accent dot in the topbar far-right corner (`.v2-top`, after `.v2-stamp`,
> `src/design/ShellV2.tsx` under `useRoomIdentityFlag()`); click opens a 10-swatch curated popover
> (`src/design/RoomAccentPicker.tsx` + `room-accent-picker.css`) to recolor THAT room, persisted
> per-room, "Reset to default" restores the preset. Answers the owner's Cycle-12i follow-up — "the
> freedom to shift around the colors they want on each page" (the Settings THEME selector only recolored
> Home once room-identity was on). **Curated swatches, not a free hex field:** the palette
> (`ROOM_ACCENT_SWATCHES`, `src/design/room-identity.ts`) is validated ≥4.5:1 vs dark ink `#1a0a2e`, so
> the dark-ink legibility law stays unbreakable; the picker only renders under the flag, so the flag-off
> topbar is byte-identical. `readRoomAccents`/`setRoomAccent`/`applyRoomAccents` (`src/design/theme.ts`)
> drive a managed `<style id="compy-room-accents">` scoped `:root[data-room-identity="on"] .v2-room[data-room=X]`
> with same-element `--v2-accent`+dim+line (whitelist-validated); re-skins that room's chrome + rig +
> sparkline via the same scoped mechanism as the presets. **Zero `src-tauri`** (`git diff -- src-tauri`
> empty). Verify: tsc 0 · vitest **1595** (177 files) · self-reviewer **round-3 PASS 7/7** (agent
> `a1ea4efadff76d2f9`): popover-closes-on-room-nav, in-place sparkline repaint, and the reduced-motion
> compound selector all fixed + bug→guard-pinned (`room-accents.test.tsx`, 21 guards); adjacent behaviors
> intact (Blackbook→Rose `#ff8ac4` persisted across nav).
>
> **UPDATE 2026-07-12 (PER-ROOM IDENTITY ACCENTS SHIPPED `72fa005` — installer SHA-256
> `D23DE0732BAB2E510891482F6E501C728E8DC52AD60E5782A31358E74D19EBA9`, live exe stamp-verified
> `72fa005` via the embedded hash, installed by Claude, supersedes the `43234A53…943D5` installer;
> NEW flag `compy_room_identity` **DEFAULT OFF** — owner eyeball is the open gate):** Each room gains
> its own identity accent — the per-part 3D-rig color philosophy (owner's 2026-07-07 directive) extended
> to room chrome, resolving the Monitor/Blackbook accent-lock owner-taste call (Cycles 2026-07-12g/h;
> owner picked "per-room identity" 2026-07-12). **Palette** (single source `src/design/room-identity.ts`):
> Monitor(play) teal `#3fd9c2` · Blackbook(learn) amber `#f0b878` · Lab/Optimize(fix) emerald `#27e08a` ·
> Home violet `#a78bfa` (unchanged, no override). Behind `compy_room_identity` (`readRoomIdentity` `=== "1"`,
> `src/design/theme.ts`; Settings → Appearance "Room accent colors (preview)"), `src/surfaces/room-identity.css`
> scopes per-room `--v2-accent` + same-element re-declared `--v2-accent-dim/-line` washes to
> `:root[data-room-identity="on"] .v2-room[data-room=X]`; `SessionStack`'s sparkline ink + the rig bay accent
> resolve from the active `.v2-room` scope when on (Lab hologram cage/ring go emerald). Flag-off is
> **byte-identical on every room** (test-pinned). **CSS gotcha fixed (cost 2 self-review rounds):** a
> `var()`-chain inside a custom property substitutes at its DECLARING element, not the using element — so
> `:root`-declared dim/line washes can't retro-follow a per-room `--v2-accent` override; they must be
> re-declared same-element inside each room block. **Zero `src-tauri`** (`git diff -- src-tauri` empty).
> Verify: tsc 0 · vitest **1575** (176 files) · self-reviewer **round-3 PASS** (agent `a9b0cfd1f3c27234f`,
> all 8 rubric items: `.play-armed` border = teal under the flag; per-room `--v2-accent-line` teal/amber/emerald;
> flag-OFF restores `rgba(167,139,250,0.25)` violet byte-identical on every room; dark ink `rgb(26,10,46)`
> legible on all accent fills; rig idle GL probe clean, Home `--ix-accent` correctly unaffected).
> One NON-BLOCKING note: rig orbit-off settle burst measured 8,640 draws vs ~6k historical ref — reviewer
> classified benign (one-time settle → flat 0-growth, not a perpetual-invalidation loop).
>
> **UPDATE 2026-07-12 (BLACKBOOK CONSOLE PHASE 4 "THE LOGBOOK" SHIPPED `617db5b` — installer SHA-256
> `43234A53ED586A00AFBE163487BCDFBD8AE5D08147C15E1F910CE795C28943D5`, live exe stamp-verified
> `617db5b` via the embedded hash, installed by Claude, supersedes the `3B855DD1…FB003` installer;
> NEW flag `compy_blackbook_console` **DEFAULT OFF** — owner eyeball is the open gate):** Console HUD
> Phase 4, direction A "The Logbook" (plan `docs/superpowers/plans/2026-07-12-console-hud-phase4-blackbook.md`,
> UI_VISION_BACKLOG §E Phase 4). Behind `compy_blackbook_console` (`readBlackbookConsole` `=== "1"`,
> `src/design/theme.ts`; Settings → Appearance "Blackbook console (preview)"), the Blackbook room gains
> a flight-recorder **Logbook** face — a single hairline tape of Change/Session/Guide-check records
> (mono timestamps, type tags, body status line, library strip) synthesized by the pure `buildLogbook`
> over EXISTING data (changes/sessions already held); the field guide stays reachable via a
> Logbook|Field-guide SegmentedControl. The `"0"`/absent default renders today's Learn library
> byte-identical (pinned `blackbook-console-flag.test.tsx`). **Logbook is a pure READ view** (self-review
> r1 fix): no in-room undo surface — an active change routes to the Lab via a single `.bc-manage` "roll
> back in the Lab" jump (Lab is the one undo home, owner 2026-07-10); ZERO mutations, **zero `src-tauri`**
> (`git diff -- src-tauri` empty; no new IPC). New files under `src/surfaces/blackbook/`
> (logbook.ts · BlackbookConsole.tsx · blackbook-console.css + 3 test files). Verify: tsc 0 · vitest
> **1560** (175 files) · self-reviewer **round-2 PASS** (agent `a851ea6bd10a9f2d2`: 0 `.bc-undo` nodes,
> click-through to Lab live-confirmed; h1 == "Blackbook" title-header with the count in `.bc-status`
> body; `.bc-manage:hover` dark accent-ink on the fill; reduced-motion still; flag-off round-trip clean).
> **Known follow-up (NOT this diff — pre-existing systemic accent lock, same class as the Monitor
> follow-up below):** the room's `--ix-accent → --v2-accent` re-point locks `.bc-*` chrome to `#a78bfa`
> under Crimson (identical lock present on Monitor/Lab; 0 vendor-purple, internally consistent) — folded
> with the Monitor accent-mismatch into ONE owner-taste call, not fixed in-train.
>
> **UPDATE 2026-07-12 (MONITOR v5 CONSOLE FLIPPED DEFAULT-ON `e195f70` — installer SHA-256
> `3B855DD1454FD7F615F301A6C4808AC0EC1FB8AB409E9DFCCA939927972FB003`, live exe stamp-verified
> `e195f70` via the embedded hash, installed by Claude, supersedes the `DFE827D1…FB59` installer;
> flag `compy_monitor_console` **DEFAULT OFF → DEFAULT ON**, owner "flip it default on and silent
> reinstall"):** Owner approved the Monitor v5 console (Flight Deck + Session Stack, RTSS-style
> zero-anchored frametime scale, live `915e85b`) after learning it lived behind the DEFAULT-OFF
> "Monitor console (preview)" toggle → flipped to the build per ship-approved-work-as-the-build.
> `readMonitorConsole` (`src/design/theme.ts`) now `!== "0"` (default ON, mirrors Home/JARVIS);
> Settings row dropped "(preview)" → "Monitor console" (now the OFF failsafe); stale "DEFAULT OFF"
> code comments corrected (`Settings.tsx` + `use-hud.ts`). **bug→guard:** `monitor-console-flag.test.tsx`
> re-pinned to the DEFAULT-ON polarity (absent === console face byte-identical to "1"; "0" === the
> classic Basic face, both `compy_editorial` states); sibling `monitor-v2.test.tsx` re-pointed the
> same commit (sets the key "0" to keep pinning the classic tree). Zero `src-tauri`. Verify: tsc 0 ·
> vitest **1522** (172 files) · self-reviewer **PASS 8/8** on the installed build (default-ON renders
> the Flight Deck in Basic+Advanced; "0" failsafe restores classic with 0 reload; Settings label bare
> "Monitor console"; h1 bare "Monitor"; scopes honest "NO SIGNAL" at rest over the owner's REAL
> session history; dark accent-ink on every accent fill; 0 vendor-purple under Crimson; 0 idle
> draws/10s). **Pre-existing follow-up exposed by the flip (NOT this diff, logged in BACKLOG):** the
> Monitor room chrome (buttons/chips/mode-pill) is locked to static violet via `monitor-v2.css`'s
> play-room accent re-point while `SessionStack`'s sparkline follows the live theme — an internal
> accent mismatch under non-Violet themes only (invisible on the default Violet); not an
> illegibility/vendor-purple defect.
>
> **UPDATE 2026-07-12 (JARVIS MOTION LAYER FLIPPED DEFAULT-ON `fcc400b` — installer SHA-256
> `DFE827D1CB0F85F23DA383EDD1C215C3CDF6B3BF6FA00AB941FED931AFD8FB59`, live exe stamp-verified
> `fcc400b` via the embedded hash, installed by Claude, supersedes the `8EB6185D…812D10` installer;
> flag `compy_jarvis_motion` **DEFAULT OFF → DEFAULT ON**, owner eyeball "everything looks good"):**
> Owner approved the JARVIS motion layer (Cycle 2026-07-12c gate — he'd been living with it
> pre-enabled) → flipped to the build per ship-approved-work-as-the-build. `readJarvisMotion`
> (`src/design/theme.ts`) now `!=="0"` (default ON) + the `main.tsx` pre-paint boot attr; Settings
> row "JARVIS motion" (dropped "(preview)", now the OFF failsafe); the byte-identity anchor in
> `src/design/jarvis/jarvis-motion.test.tsx` re-pinned to explicit `"0"` (absence = ON) + a positive
> default-ON assertion. **This installer also carries the Cycle 2026-07-12d naming-drift fixes** (4
> user-facing retired-label leaks fixed — tweaks.json "Compy's Check", Term.tsx/blackbook-v2 "library"
> → "Blackbook", TuningInstrument "Play"→"Monitor" debrief; `src/stale-reference-guard.test.ts`
> extended to scan `src/surfaces` + `src/design` rendered copy). Zero `src-tauri`. Verify: tsc 0 ·
> vitest **1522** (172 files) · self-reviewer **PASS 8/8** on the installed build (default-ON from
> first paint with 0 flash `retuneAtRest:0`; retune fires once per room change t=21→314ms then
> self-removes; Settings label bare "JARVIS motion", toggle ON; "0" failsafe fully reverts + restores).
>
> **UPDATE 2026-07-12 (JARVIS MOTION LAYER SHIPPED `1d310e1` — installer SHA-256
> `8EB6185DEDBADE6FE1B6F9B5075F8E4ECF9945949748E102008205D9F9812D10`, live exe stamp-verified
> `1d310e1` via the embedded hash, installed by Claude, supersedes the `4F4DB63A…45B931`
> installer; NEW flag `compy_jarvis_motion` **DEFAULT OFF** — owner eyeball is the open gate):**
> UI_VISION_BACKLOG §A.2/A.3/A.5/A.6 built as ONE layer (rails: de-slop directive `:111-176`) —
> **A.5** Lenis smooth-scroll spine on the shell's content lane (`lenis@1.3.25` new dep, loaded
> only when active; nested scrollers auto-yield; rAF stops on hidden) · **A.6** room-transition
> "retune" wipe (accent hairline, 300ms transform-only, never on first paint/flag flip) · **A.3**
> magnetic rail tabs (GSAP quickTo ≤4px; Dock deliberately excluded — it owns the magnify lift)
> + Home stage chrome tilt ≤2.4° (existing pointer vars; the rig canvas never tilts — picking
> exact) · **A.2** gauge data-tick (GSAP ring flash ONLY on a real→real measured change; hologram
> shader uniforms deliberately excluded — the demand-frameloop idle-GPU law wins, deviation
> disclosed in UI_VISION_BACKLOG §A.2). Reader `readJarvisMotion` (`src/design/theme.ts`, `==="1"`),
> boot attr `main.tsx`, gate hook `useJarvisActive` (`src/design/jarvis/use-jarvis.ts` — flag AND
> resolved motion; reduced wins, mid-session flips live-verified). Flag-off byte-identity +
> honest-tick + reduced-wins pinned in `src/design/jarvis/jarvis-motion.test.tsx`. Zero
> `src-tauri`. Verify: tsc 0 · vitest **1364** (172 files) · self-reviewer **PASS 8/8** (live
> 1500×980; flag-on-at-rest chrome transform = identity; GL idle probe 0 draws/16s; rail-switch
> circuit ≲50ms with the sole 58ms outlier on the flag-OFF baseline).
>
> **UPDATE 2026-07-12 (Home title-header fix SHIPPED `cc1ffce` — installer SHA-256
> `4F4DB63A9955C97B8B54F5A590066E0DC88BBDC051230EF36BDE2068FB45B931`, live exe stamp-verified
> `cc1ffce` via the embedded hash, installed by Claude, supersedes the `63C3B563…D702233`
> installer):** the BACKLOG-flagged pre-existing violation closed — HomeConsole's h1 rendered
> postureLine's status sentence ("N thing(s) need your attention") against the owner's
> title-header law (2026-07-10 ×2). The console h1 is now the room TITLE ("Home", eyebrow
> unchanged); the posture verdict + trimmed dek relocate to a NEW `.hc-verdict` body strip above
> the stage (postureLine's real output, rendered exactly once — one-mention law; attention state
> inks warn, agreeing with the LED). The header keeps NO sub/descriptive line. Scoped like the
> rooms' `626b83c` sweep: live face only (HomeHud/HomeV2 devtools-only classic failsafes
> untouched). Guards re-anchored + extended in `home-console.test.tsx` (title pin · one-mention
> pin · attention tone pin · no-sub pin). Zero `src-tauri`. Verify: tsc 0 · vitest **1351**
> (171 files) · self-reviewer **PASS 8/8** (live 1500×980, real rig data incl. a real attention
> state; line contrast 16.78:1, dek 6.51:1; reduced-motion still page; no stage collision).
> Reviewer follow-up candidate logged in BACKLOG (ShellV2 topbar's static room tagline).
> Same session: Cowork's 2026-07-11 audit self-correction committed as-is (`e1cec74`).
>
> **UPDATE 2026-07-12 (EXPERT VIEW SHIPPED `5850ac0` — installer SHA-256
> `63C3B5639673AF822F2C26C45DF0672D6AEFEC0FAD02720E54ACC4861D702233`, live exe stamp-verified
> `5850ac0` via the embedded hash, installed by Claude, supersedes the `653FFEA0…9BADC2`
> installer):** the Q3 expert-layer train (spec
> `docs/superpowers/specs/2026-07-11-expert-layer-middle-ground.md`, owner GO 2026-07-12) built as
> its own scoped train. One genuine Settings > Behavior preference — **"Expert view"
> (`compy_expert_view`, DEFAULT OFF, a real preference like Motion, NOT a preview flag; the
> default face is byte-identical, test-pinned).** ON = presentation-only un-hiding of existing
> data: refused drawer renders open with reasoning inline (no barred-tier apply affordance —
> LOCKED rule 6a untouched) · exact target (registry key/value · service · powercfg GUIDs ·
> Settings-page path) inline on safe + needs-your-call rows via the display-only
> `src/data/expert-targets.ts` map, transcribed from `actions.rs`/`services.rs` and
> literal-pinned by `expert-targets.test.ts` · **the GO's ship condition MET + mechanized:** the
> rollback-boundary disclaimer ("Edits made outside Compy aren't tracked and can't be rolled back
> by Compy.") renders beside EVERY inline target (`expert-view.test.tsx` pins disclaimer count ==
> target count) · true `local_percentiles` (1-decimal) replace the "Top N%" bucket on Benchmark
> receipts, session tiles/deltas at 1 decimal · the long-tail sections (Fix collapsibles, Check
> piles, Optimize-station ledger/cleanup disclosures) render open. **Zero `src-tauri` diff — no
> gate moved, no mutation path added.** Verify: tsc 0 · vitest **1350** (171 files, +28 guards) ·
> self-review **PASS** (live 1500×980; noted honestly: expert-ON Optimize is a ~10.6-screen
> scroll — the accepted cost of the full panel).
>
> **UPDATE 2026-07-11 (CONSUMER-PANEL OVERHAUL SHIPPED `50b5c03` — installer SHA-256
> `653FFEA0928E3372CA33ECB818EC6BF8A21B01CBB6A3B7250194DB5B3A9BADC2`, live exe stamp-verified
> `50b5c03` via the embedded hash, installed by Claude, supersedes the `3B3A65C4…B19DAD` installer;
> flag `compy_monitor_console` still **DEFAULT OFF**, v5 owner eyeball still ITS open gate):** the
> five-persona panel plan (`docs/superpowers/plans/2026-07-11-consumer-panel-overhaul.md` — Q1–Q4
> owner answers + per-item commit citations recorded in-file) built end to end. App: safe-stack
> caption is a state observation ("All N already on for this rig" — Phase 0 verified
> `currently_applied` is a live probe, `recommendations.rs:315`), VBS advisory reframed as a
> decision, Term glosses at first exposure (Home/Lab "1% low" gauges, ETW, frametimes; **Monitor
> jargon bucket deferred until the v5 eyeball settles**), readiness gauges state their formula
> ("= N of M checks passed"), NEW **TrustMoment** one-time watch-it-work loop (audited
> apply→rollback IPC only, ledger-empty gate, HKCU whitelist, consent-first), gaming recovery
> banner + pane card reframed protection-first ("Nothing's lost … kept the full restore receipt",
> calm tone — never-hide mechanism untouched). **Settings flag-debt sweep (Q2=A): 11 graduated /
> UI-inert toggle rows REMOVED** (Living Instrument, Guided Lab bench, Lab checkup bento, Lab
> proving ground, Instrument HUD, Home console, Setup stepper, First-check theater, Monitor summary
> cards, Hologram bay v2, Two futures split) — features unchanged, flags still honor localStorage
> via devtools; **the "Settings → Appearance row is the classic failsafe" lines in the 2026-07-10
> Home-console and Lab-ground banners below are SUPERSEDED — those failsafes are now
> devtools/localStorage-only.** "Monitor console (preview)" is the one remaining preview row. Site
> (dark, owner taste-gates before publish): hook kicker promoted to h1, "Compy is free." above the
> fold, proof-loop receipt = accessible hero visual (example-framed), start-here trio over raw
> counts, per-card one-line "Why:" (the tier now argues). Q3 = **proposal only, awaiting owner GO**
> (`docs/superpowers/specs/2026-07-11-expert-layer-middle-ground.md`). Zero src-tauri. Self-review
> round 1 **FAIL — 4 real catches** (Term mixed-case in uppercase labels · tooltip shouting caps ·
> Lab tooltip 126px off-window · site h1 3-line wrap), all fixed + guard-pinned
> (`term-style-guard.test.ts`) → round 2 **PASS** (computed-style + line-box proofs). Verify:
> tsc 0 · vitest **1322** (167 files) · site-landing 15/15.
>
> **UPDATE 2026-07-11 (RTSS-style ZERO-ANCHORED frametime scale SHIPPED `915e85b` — installer
> SHA-256 `3B3A65C45C4BF63942373612CA19353EAFAB16CED10EE8A71F83143271B19DAD`, live exe
> stamp-verified `915e85b`, installed by Claude, supersedes the `0AA8E222…F21A55` installer;
> flag `compy_monitor_console` still **DEFAULT OFF**):** the owner REJECTED the envelope look
> on sight ("this is atrocious … research clean and comprehensive frametime graphs or just
> match riva tuners") — **envelope mode is DELETED** (band + median curve + note). Research
> applied (RTSS "graph max" / CapFrameX fixed y-range): the DeckScope frametime hero now draws
> the RAW per-frame line against a **stable zero-anchored ms scale** (`niceCap` frame-budget
> landmarks 8.3/16.7/25/33.3/50/100/250) with labeled quarter-cap gridlines + right-edge ms
> labels; axis states "0–\<cap\> ms scale · budget X ms". Root cause named: window-min/max
> normalization stretched ~3 ms of jitter to full chart height — the envelope had treated the
> symptom. fps + Home traces (default "window" scale) byte-same; `monotone.ts` stays
> (SessionStack rows). Verify: tsc 0 · vitest **1311** (165 files) · self-reviewer **PASS 8/8**
> (live real-density mount: calm line low on the chart, spikes tower, budget ≈14% up at
> 6.9/50, scrub raw-exact, zoom rescales zero-anchored, fps/Home unchanged).
> **⏳ OWNER eyeball of v5 still the open gate.**
>
> **UPDATE 2026-07-11 (v5 scope ENVELOPE mode SHIPPED `e02d1ad` — installer SHA-256
> `0AA8E222755F082B7D75AF8EAEB3BA7A14DDFEFF97711C8483A456B319F21A55`, live exe stamp-verified
> `e02d1ad`, installed by Claude, supersedes the `05399D9D…EA7B7459` installer; flag
> `compy_monitor_console` still **DEFAULT OFF**):** owner round-2 ask on the v5 eyeball ("make
> the lines not so tightly packed and erratic without … taking away from the accuracy … the
> transient spikes are just a little overbearing and chaotic") — dense frametime windows
> (≥120 samples) now draw a faint **min–max band** (each bucket's TRUE extremes, nothing
> clipped) under a **monotone median line** (the typical frame; the shared Fritsch–Carlson
> math extracted to `src/design/console/monotone.ts`, SessionStack refactored onto it). Spike
> markers, worst-spike callout, and scrub stay RAW per-sample; drag-zoom below 120 samples
> returns the raw polyline; caption states "line = typical · band = every frame". fps scope
> deliberately stays raw. Self-review round 1 **FAIL — real catch:** the median `<path>`
> escaped the non-scaling-stroke selector and rendered fat (the exact `f2acb23` class); fixed
> (`.osc-grid path` covered) + the line-discipline guard strengthened to require selector
> coverage of line/polyline/path → round 2 **PASS** (computed vectorEffect + side-by-side
> stroke-weight proof on a live real-density mount). New guards: `envelopeProfile`
> truth-table · dense⇒band+path+note w/ raw-exact spike x · sparse⇒raw · no-prop⇒raw.
> Verify: tsc 0 · vitest **1311** (165 files). **⏳ OWNER eyeball of v5 still the open gate.**
>
> **UPDATE 2026-07-11 (v5 scope-line sharpening SHIPPED `f2acb23` — installer SHA-256
> `05399D9DE7B2601EC2080CADA2036351DC52D3946C4C3372A99F5290EA7B7459`, live exe stamp-verified
> `f2acb23`, installed by Claude, supersedes the `5AE1ED22…C7821236` installer; flag
> `compy_monitor_console` still **DEFAULT OFF**):** owner quick-fix on the v5 eyeball ("lines
> need to just be sharpened and sleek no added bloom or saturation/thickness") — the Oscilloscope
> trace glow (drop-shadow of `--ix-accent-dim`, theme violet blooming around graded ink) is
> DELETED; every scope stroke wears `vector-effect: non-scaling-stroke` (the stretched viewBox
> no longer fattens strokes); trace 1.5→1.25px, ink/hue untouched. bug→guard "line discipline"
> test in `oscilloscope.test.tsx` (no drop-shadow declaration in live CSS · non-scaling-stroke
> present · trace ≤1.5px). Verify: tsc 0 · vitest **1307** (165 files) · self-reviewer **PASS
> 8/8** (computed `filter: none` both motion states on a live mount, zoomed crops halo-free).
> **⏳ OWNER eyeball of v5 still the open gate.**
>
> **UPDATE 2026-07-11 (v5 trace-line refinement SHIPPED `e900b6a` — installer SHA-256
> `5AE1ED22BD308C4C877EF7D71155A65B77028736B7193C55E9197656C7821236`, live exe stamp-verified
> `e900b6a`, installed by Claude, supersedes the `A4D3BF98…D147E0` installer; flag
> `compy_monitor_console` still **DEFAULT OFF**):** owner ask on the v5 eyeball ("clean up and
> refine how the actual line on the graph looks") — stack row traces now stroke a **monotone
> cubic (Fritsch–Carlson)** curve with round joins/caps (passes through EVERY real sample, never
> overshoots — smooths the min-per-bucket sawtooth corners, never the data; pin dot verified on
> the curve minimum) and the scope SVG traces gain round joins/caps, geometry unchanged. Guard:
> bezierCurveTo + round-join pin in `session-stack.test.tsx`. Verify: tsc 0 · vitest **1306**
> (165 files) · self-review **PASS** (zoomed real-data crops — no sawtooth, dips keep true
> depth). **⏳ OWNER eyeball still the open gate.**
>
> **UPDATE 2026-07-11 (Monitor v5 "FLIGHT DECK + SESSION STACK" SHIPPED `960734c` — installer
> SHA-256 `A4D3BF98DCE1CF57740C9163CF4393F5F7499168946630EA485D974706D147E0`, live exe
> stamp-verified `960734c` (embedded-hash proof), installed by Claude, supersedes the
> `C2E0FF70…3E90238` installer; flag `compy_monitor_console` still **DEFAULT OFF**):** the owner's
> round-3 pick **"A's top + B's stack"** built per plan
> `docs/superpowers/plans/2026-07-11-monitor-v5-deck-stack.md` (T1–T5: `d06a63c` pure data ·
> `69c8f90` SessionStack · `255a400` Flight Deck assembly · `0c68553` polish · `960734c`
> coverage fix). ONE face, two halves, NO mode toggle: **Flight Deck** (consumer readouts ·
> `DeckScope` full-width frametime hero w/ hover scrub + nested drag-zoom + stated ms-span/budget
> · session-scoped plain-number delta row, cross-game labeled "(DIFFERENT GAME)", changes-on tag)
> + **Session Stack** (last ≤5 sessions as flat rows on ONE shared 1%-low axis, ONE worst-dip pin
> w/ exact clock time per row, VS PREVIOUS chips, current-game filter, expand-detail). The v4
> **SessionWaterfall + `waterfall-profile` are DELETED** (Now/Compare toggle gone; surviving
> guards re-anchored in `monitor-stack-profile.test.ts` / `session-stack.test.tsx` /
> `deck-scope.test.tsx`). Self-review round 1 **FAIL — the real-density law caught a real one**:
> the 10.5 h Sand session's timeline (backend-capped at ~2 h) drew as a sliver because row x
> normalized to `duration_secs`; fixed (`960734c`: rows draw the RECORDED span, partial coverage
> STATED — "first 2h 0m recorded" + detail-line note, pins only anchor inside coverage) +
> guard-pinned (coverage<<duration truth-table the old fixtures never exercised) → round 2
> **PASS 8/8 on the real 5-session data**. Flag-off byte-identity re-pinned BOTH
> `compy_editorial` states (`monitor-console-flag.test.tsx`). Verify: tsc 0 · vitest **1305**
> (165 files) · cargo **688**. **⏳ OWNER eyeball is the open gate** — Settings → Appearance →
> "Monitor console (preview)", both modes.
>
> **UPDATE 2026-07-11 (v4 waterfall READABILITY REWORK SHIPPED `915cb96` — installer SHA-256
> `C2E0FF709DDF65256E757E2D3903CCA133207DEB614B2C59A6AE5666C3E90238`, live exe stamp-verified
> `915cb96` (embedded-hash proof), installed by Claude, supersedes the `44610BF6…D370A30`
> installer; flag `compy_monitor_console` still **DEFAULT OFF**):** the owner REJECTED the
> `85eb8c6` waterfall on eyeball ("this looks absolutely terrible … what a mess") — the banner
> below's round-2 "PASS 8/8 against real production data" was WRONG on readability: real
> multi-hour timelines drew as smears, dip pins as a barcode, legend printed over chart ink,
> Live|Sessions duplicated the room's segment labels. Rework (`082414c` + `915cb96`):
> `downsampleTimeline` min-per-bucket ≤160 drawn samples · `MAX_LAYER_PINS=3` worst-dip caps ·
> `layerAlpha` ramp · legend moved OUT of the stage (alpha swatches, middot grammar) · back
> baselines dropped, LIFT 30/SCALE_STEP .08 · modes renamed **Now/Compare** · stage 300px.
> Bug→guard ×2: draw-density discipline pinned in `waterfall-profile.test.ts`
> (`MAX_DRAW_POINTS`/`MAX_LAYER_PINS`) + self-reviewer rubric gained the **real-density law**
> (fixture-scale PASS ≠ PASS). Verify: tsc 0 · vitest **1320** (167 files) · fresh full
> self-review round **PASS** (all items, real 5-session data, own-eyes iterated on the live dev
> instance first). **⏳ OWNER eyeball (round 2) is the open gate** — Settings → Appearance →
> "Monitor console (preview)", both modes.
>
> **UPDATE 2026-07-11 (Monitor v4 "SESSION WATERFALL" SHIPPED `85eb8c6` — installer SHA-256
> `44610BF6F168E83741DD04A9EBD24D14A566EB2828238B1AFB67B0647D370A30`, live exe stamp-verified
> `85eb8c6` (embedded-hash proof; owner queueing for a game, no CDP relaunch), installed by Claude
> on the owner's go while between games, supersedes the `33661b8` installer; flag
> `compy_monitor_console` still **DEFAULT OFF**):** the owner's concept-round-2 pick (B "Depth
> Waterfall" + A's drag-segment, lean into previous-session comparison — verbatim in the plan) is
> built as the console hero, replacing the REJECTED v3 ribbon (**FrametimeRibbon + ribbon-profile
> DELETED**, r3f chunk gone from this face). `SessionWaterfall` (2D canvas, token inks): LIVE mode
> (ms axis) = flat front scope + dashed budget + exact-moment spike pins + drag-zoom/double-click
> reset + scrub readout, depth layers = receding snapshots of the SAME capture (cleared on stop,
> never frozen-as-live); SESSIONS mode (1%-low fps axis) = the last ≤5 sessions' real
> `stutter_timeline` layers, stacked legend labels, `stutter_events` dip pins with real labels,
> delta strip vs the same-game prior ("VS PREV SAND"; cross-game fallback labeled "DIFFERENT
> GAME"), same-game filter, "N COMPY CHANGES ON" context tag; honest empties throughout; units
> never mix per scene. Zero new IPC, **zero src-tauri** (diff-verified empty; `SessionSummary` TS
> type gained the timeline fields the backend already sent). Self-review round 1 **FAIL** (4 real
> catches: idle stopped polls churned a fresh [] reference → 1 Hz canvas repaints at rest;
> empty-scene hover repainted under reduced motion; legend overlap at the real 5-session history;
> bare cross-game delta read as a −216 fps regression) → all fixed + bug→guard-pinned in `85eb8c6`
> → round 2 **PASS 8/8** against real production data (idle 0 draws/12 s both modes). Verify:
> tsc 0 · vitest **1315** (167 files) · flag-off byte-identity re-pinned BOTH `compy_editorial`
> states (`monitor-console-flag.test.tsx`). **⏳ OWNER eyeball is the next gate** (Settings →
> Appearance → "Monitor console (preview)", ideally mid-capture AND with ≥2 recorded sessions —
> both modes; default-ON only on his verdict).
>
> **UPDATE 2026-07-10 (consumer-terms preset relabel SHIPPED `33661b8` — installer SHA-256
> `7C1EC6891F37BC3515AC05DD27C7E72FD4D3E63C860EF086B7BA7806113BB888`, stamp-verified LIVE `33661b8`,
> installed by Claude, supersedes the `6932fa7` installer):** UI_VISION §A0 item 6 closed — the
> Monitor tuning-preset trio the owner flagged ("Visual Fidelity / Smooth / Clarity") is now
> **"Max Quality" / "More FPS" / "Lower Latency"** (ids stable; labels test-pinned in
> `monitor-view.test.ts`). Chips are goal-register comparatives, deliberately NOT the console
> readouts' verbatim stat terms — self-review round 1 caught literal "Max FPS"/"Low Latency" chips
> rendering on the same screen as the measured "MAX FPS"/"LOWEST LATENCY" readouts; "High
> Resolution" not used (preset bundles HDR+VRR, nothing touches resolution — honesty rail; owner may
> overrule at eyeball). Also: RigViewer chromed hint → "hover or click a part" (§A.4 residual;
> reviewer finding logged — the chromed RigViewer path is currently unreachable dead code, cleanup
> is its own candidate). Verify: tsc 0 · vitest **1253** (166 files) · zero src-tauri ·
> self-reviewer round-2 **PASS 8/8**. **⏳ OWNER eyeball unchanged: Monitor console (preview)** —
> the same Monitor room now also shows the relabeled presets.
>
> **UPDATE 2026-07-10 (Monitor v3 "TELEMETRY RIBBON" SHIPPED `6932fa7` — installer SHA-256
> `E9737D6EE5E05E2CE210DE4000578507F5ACBEC4CDC3A074C4086351D832421E`, stamp-verified LIVE `6932fa7`,
> installed by Claude AFTER the owner's Palworld session ended (reinstall deliberately deferred
> mid-game); code-complete at `4c051e0`, `6932fa7` = docs-only on top; flag `compy_monitor_console`
> still **DEFAULT OFF**):** the owner rated the v2 cluster "satisfactory", gave binding direction
> (retained verbatim: `docs/UI_VISION_BACKLOG.md` §A0) and chose the **3D ribbon** concept. v3 =
> `Oscilloscope` v2 (full-width window — his caught half-width bug — dashed budget line at
> 1000/refreshHz, exact-moment spike markers via pure `spikeIndices`, worst-spike ms callout ONCE
> in the strip caption) + consumer-term readouts (MAX FPS · AVG FPS · LOWEST LATENCY · SPIKES,
> `monitor-console-data.ts`, em-dash never 0) + lazy r3f `FrametimeRibbon` hero (real per-frame
> extrusion, spike cones, budget plane, orbit, `frameloop="demand"`, mounts ONLY on a live window)
> + overlay toggle/corner ported verbatim + uniform stage tilt (depth never warps data ink — the
> direction spec's Monitor row carries the owner's 3D/parallax amendment). Self-review round 1
> **FAIL** (real catch: content-equal 1 Hz polls repainted the demand canvas — GL probe +8
> draws/tick) → fixed `4c051e0` (content-stable `ftWin` ref + reference-identity bug→guard) →
> round 2 **PASS 8/8** (idle flat 15s, repaints on real change, orbit animates). Verify: tsc 0 ·
> vitest **1252** (166 files) · zero src-tauri across the whole v3 train. **⏳ OWNER eyeball is the
> next gate** (Settings → Appearance → "Monitor console (preview)", ideally mid-capture — the
> ribbon needs live frames). Residual (explicit): overlay density/backdrop config stays on the
> classic face.
>
> **UPDATE 2026-07-10 (Phase-3 Monitor console BUILT + SHIPPED `3fbd371` — installer SHA-256
> `7E74216CF47CAE3FA2D09A6E874A0F21A305D4D1925D363A869D61B15C97295D`, stamp-verified LIVE `3fbd371`,
> installed by Claude, supersedes the `bce72d6` installer; flag `compy_monitor_console` **DEFAULT
> OFF**):** the Console HUD's Phase 3 (plan `docs/superpowers/plans/2026-07-10-console-hud-phase3-monitor.md`,
> entry gate cleared by the owner's go on the instrument-cluster concept, 2026-07-10) is on the live
> installer behind a NEW preview flag — **flag off (the shipped default), Monitor is byte-identical
> to the previous build** (`readMonitorConsole` → `=== "1"`, `src/design/theme.ts:566`; pinned in
> `monitor-console-flag.test.tsx` for BOTH `compy_editorial` states). Flag ON (Settings → Appearance
> → "Monitor console (preview)"): the Monitor room's LIVE face becomes the instrument cluster — a NEW
> `Oscilloscope` kit component (`src/design/console/Oscilloscope.tsx`: pure render of the caller's
> real buffered samples, no self-driven rAF, empty buffer ⇒ honest "no signal", never a synthetic
> line) drawing rolling fps + frametime traces (fps = the real polled capture samples, cleared the
> moment the helper stops — never frozen-as-live; frametime = the backend's real per-frame
> `recent_frametimes_ms` window the Overlay already draws) + ArcGauges over GPU temp (vendor-gated
> tone, NVIDIA ungraded per LOCKED rule 5) / CPU (ungraded by design) / RAM (+ GPU load in Advanced).
> Same three 1 Hz read-only polls MonitorBasic/Play live run, ported verbatim — **zero new IPC, zero
> src-tauri** (`git diff 1527d61~1..3fbd371 -- src-tauri/` empty). Capture control = the same audited
> toggle; V2-8 `onFpsActive` door mirror preserved; Sessions face + TuningPresets untouched; Basic
> keeps the last-session door. Motion layer = Phase 2's mechanisms (spotlight · `backwards` reveal ·
> stage reticle), deliberately NO hologram and NO parallax over the traces; reduced ⇒ still page.
> Home console stays DEFAULT ON from `bce72d6`. Verify: tsc 0 · vitest **1236** (164 files) ·
> self-reviewer **PASS** (8/8 at native 1500×980: stopped-state honesty, visual stillness at rest —
> two shots 12s apart differ only in real sensor numbers, accent-ink contrast computed, flag-off
> classic round-trip, Crimson spot-check; the violet capture button under Crimson traced to the
> pre-existing test-pinned per-room accent re-point `src/surfaces/monitor-v2.css:31`, not this
> train). Known preview gap (owner reaction decides): the Advanced console face shows the instrument
> cluster only — overlay controls + deep monitoring stay on the classic face. **⏳ OWNER eyeball is
> the next gate** (taste gate before default-ON and Phase 4 History/Black Box per the direction
> table).
>
> **UPDATE 2026-07-10 (Home console DEFAULT-ON, SHIPPED `bce72d6` — installer SHA-256
> `2DA1340D8BC5AA3337AFACF0C36FAE450684E50ED73E54A517AE98F6ACE6F3E4`, stamp-verified LIVE, installed by
> Claude, supersedes the `80c69f1` installer):** the owner's verdict ("everything looks good", 2026-07-10,
> which also confirmed the T6c gaming-mode Resume worked live) cleared the Phase-2 eyeball gate →
> **`compy_home_console` is DEFAULT ON** (`readHomeConsole` → `!== "0"`, `src/design/theme.ts:536`) per
> ship-approved-work-as-the-build. Home opens as the console cold-open for everyone; **Settings →
> Appearance → "Home console" (row dropped "(preview)") set to OFF is the classic-Home failsafe** —
> byte-identical to the pre-console tree for BOTH `compy_editorial` states, live round-trip verified no
> reload. Pins re-anchored in `home-console-flag.test.tsx` (new default contract) +
> `home-hud-flag.test.tsx` / `hologram-orbit-optin-guard.test.tsx` (the "0" failsafe for the layers they
> guard; NEW console-stage orbit pin — fresh default = no unattended rotation, idle 0 GL draws/16s).
> Zero src-tauri. Verify: tsc 0 · vitest **1210** (161 files) · self-reviewer **PASS** (dev-webview
> evidence; settings round-trip both ways, "(preview)" grep-clean). **Phase 3 (Monitor) is planned:**
> `docs/superpowers/plans/2026-07-10-console-hud-phase3-monitor.md` — new flag `compy_monitor_console`
> DEFAULT OFF, `Oscilloscope` kit component on the real live telemetry, builds in a FRESH session.
>
> **UPDATE 2026-07-10 (T6c one-click Resume + mount-aware banner deferral SHIPPED `80c69f1` — installer SHA-256
> `B7F0148A1F8F50ED76267E2B7580A4636463FB71D9F4E02FD5DA61E895BDCFA0`, stamp-verified LIVE, installed by Claude,
> supersedes the `72d9b6e` installer):** the owner's 2026-07-10 directive built — the GLOBAL gaming-recovery
> banner (`src/App.tsx`, `.gaming-recovery-banner`) now leads with one-click **"Resume Gaming Mode"** (the pane's
> audited `recover_gaming_session(confirm)` → `start_gaming_session` sequence verbatim — rollback-first, restore
> to TRUE priors, then an explicit user-clicked restart; never zero-click on launch), keeps "Restore now" as
> secondary, and "Review" no longer clears the recovery (no dead-end behind a closed disclosure). Resume restarts
> with the interrupted session's OWN tiers via `resumeOptionsFrom` (`src/surfaces/gaming-mode.ts`) — derived from
> its recorded change labels; the pane's checkboxes reset on remount and silently downgraded a resumed
> advanced-tier session (pane's `onResume` fixed too). The 2026-07-10d **carried note is RESOLVED**: banner
> deferral is now MOUNT-AWARE (pane announces via `GAMING_PANE_(UN)MOUNTED_EVENT`) — a pending recovery is no
> longer invisible on the Lab/Optimize tabs outside the gaming door. Round-1 self-review caught a pre-existing
> app-wide cascade bug: bare `.btn-small-on` lost the tie to the later `.btn-small` base rule (accent ink dead on
> all 7 call sites) and the generic hover painted the primary danger-red → `.btn-small.btn-small-on` double-class
> + hover override (`src/App.css`), guard-pinned in `src/button-legibility-guard.test.ts`. Zero src-tauri (no new
> IPC/mutation primitive — audited commands only). Verify: tsc 0 · vitest **1208** (161 files, +5 pins net) ·
> self-reviewer round-2 **PASS** (computed accent proof at rest+hover; one-prompt-at-a-time proven live against a
> REAL orphaned session found on the rig — the owner will be greeted by this exact banner, with Resume, on next
> look). T6b (batched restore-side elevation) remains a separate open candidate.
>
> **UPDATE 2026-07-10 (Phase-2 Home console cold-open BUILT + SHIPPED `72d9b6e`, flag `compy_home_console` DEFAULT OFF):**
> the Console HUD's Phase 2 (plan `docs/superpowers/plans/2026-07-10-console-hud-phase2-home.md`) is on the live
> installer behind a NEW preview flag — **flag off (the shipped default), Home is byte-identical to the previous
> build** (test-pinned both ways in `home-console-flag.test.tsx`). Flag ON (Settings → Appearance → "Home console
> (preview)"): Home opens as the console cold-open — the real 3D rig hologram center-stage in a bracketed stage,
> four honest corner arc gauges (Readiness ratio · Avg FPS · 1% low · GPU temp — absent ⇒ NOT-YET, never a
> fabricated 0; NVIDIA temp stays ungraded per LOCKED rule 5), HomeHud's proven masthead register, edge
> annotations, the #1-limiter context row with its "See in Lab" jump, and a **Dock of room doors** (the
> `railFor` ground rail minus Home — Monitor · Blackbook · Lab, Lab primary; RoomShell's ForwardDoor suppressed
> while the dock renders so Home keeps exactly ONE forward affordance — the self-reviewer's round-1 duplication
> catch, bug→guard-pinned). Motion layer (spotlight · staggered reveal · stage reticle · annotation parallax)
> fully stilled under reduced motion. **Entirely frontend: `git diff 5b79d58~1..72d9b6e -- src-tauri/` is
> EMPTY.** Verify: tsc 0 · full vitest **1203** (161 files, +21 pins) · cargo **688** · self-reviewer round-2
> **PASS** (fresh full pass at `72d9b6e` incl. the canvas idle probe: 0 GL draws over 16s at rest, orbit
> re-engages). ⏳ OWNER eyeball: flip **Settings → Appearance → "Home console (preview)"**, open Home, react —
> the taste gate before default-ON and before Phase 3 (Monitor).
>
> **UPDATE 2026-07-10 (proving-ground DEFAULT-ON + standalone Optimize tab DROPPED, SHIPPED `59249bb`):** the
> owner's round-4 verdict ("ALL GOOD") cleared the Ops Console eyeball gate, so both decided 2026-07-10 calls
> shipped in one train: **`compy_lab_ground` is DEFAULT ON** (`readLabGround` → `!== "0"`, `src/design/theme.ts:326`)
> and the **standalone Optimize tab is REMOVED** — the rail is Home · Monitor · Blackbook · Lab
> (`railFor(merged, ground)`, `src/design/homeRail.ts:42`); the Lab's Optimize station is the ONE door to the
> safe-tweak toggles. Everything fix-flavored re-routes to the Lab under ground: Home's limiter buttons
> ("See in Lab"), Home's forward door (`doorFor`, `src/design/room-shell.tsx:39`), the gaming-recovery banner's
> "Review", navHome/HOME_FOR_TAB fallbacks, and the Setup & Tour (4-room recap + lesson ties + seatbelt ledger
> room). The self-reviewer's round-1 catch — the decided "undo stays reachable via the Lab panel" had NO ledger
> surface in the station — was fixed before ship: OptimizeStation now carries an "Applied & history — every
> change, undoable" disclosure rendering the classic room's audited `<Fix view="ledger">`
> (`src/surfaces/lab/OptimizeStation.tsx:170`, guard-pinned in `lab-ground.test.tsx`). **`compy_lab_ground="0"`
> (Settings → Appearance → "Lab proving ground") is the full classic failsafe** — rail, tabs, rooms and tour
> restore live, no reload (live-verified round-trip). The "Remaining owner call: drop the standalone Optimize
> tab at default-ON" lines in the dated banners below are RESOLVED-SHIPPED by this train.
>
> **UPDATE 2026-07-10 (console round-3 owner catches SHIPPED, `889de10`):** owner round-3 eyeball caught two
> Ops Console bugs — the resting Optimize dock node read as pre-selected (primary wore the exact active accent
> border; now a 35% color-mix border, active alone gets full accent + tinted fill) and the safe-stack ring's
> "8/9" readout painted over the ring's top stroke (baseline flex anchored it to the box top; now centered via
> an inner `.lab-gauge-txt` baseline group). His requested abnormality sweep also caught + fixed a drift
> contradiction: the ring caption re-framed a drifted rec as "1 left to enable" against the corner gauge's
> "0 ready" — the caption is now drift-aware. All three guarded (`optimize-gauge-dock-guard.test.tsx`, 7 tests).
>
> **UPDATE 2026-07-10 (title-header law SHIPPED, `626b83c`):** owner round-2 feedback on the Ops Console eyeball —
> a room header is a **TITLE** (h1 = the room name, never a status/notification/description sentence). All 5 v2
> rooms' hud-on h1 is now the room title ("Lab" / "Optimize" / "Monitor" / "Blackbook"); every displaced
> verdict/status line relocated into its body context (drift guidance → Fix drift intro · undo promise → Fix
> consent line · Monitor's last-session answer → Play hero · Blackbook record + autopsy hint → Learn). Home's
> masthead verdict KEPT (cold-open answer, flagged for owner taste). Law mechanized as self-reviewer rubric item 6
> (upgraded). Remaining owner call unchanged: drop the standalone Optimize tab at default-ON.
>
> **UPDATE 2026-07-10 (header-slop sweep SHIPPED, `1a9f44f`):** owner round-1 feedback on the Ops Console eyeball —
> **Optimize open-on-click CONFIRMED** ("cleaner") + a new app-wide **header-slop law** (tab header space carries
> header-format text only; small always-on descriptive lines relocate to their context). Shipped same day: the four
> rooms' `.v2-measured` strips removed, the Lab header cut to eyebrow + headline, the console lede deleted (undo promise
> relocated into the Optimize panel), law mechanized as self-reviewer rubric item 6. Remaining owner call: drop the
> standalone Optimize tab at default-ON.
>
> **UPDATE 2026-07-09 (Lab "Ops Console" Phase 1 SHIPPED, `63585e9` — post whole-branch review):** the bento Instrument Bench was owner-rejected
> ("generic slop / wide horizontal boxes"); the owner-picked **"Ops Console"** direction
> (spec `docs/superpowers/specs/2026-07-09-compy-console-hud-direction.md`, plan
> `docs/superpowers/plans/2026-07-09-console-hud-phase1-lab.md`) Phase 1 is now the live installer below — the real 3D rig
> hologram at center, four honest corner arc gauges, a magnify Dock of stations — still behind `compy_lab_ground`
> **DEFAULT OFF** (app byte-identical until the owner flips the preview). The **Optimize-tab deferral stays OPEN**: with the
> preview on, the standalone Optimize rail tab still coexists with the Lab hero, and the Optimize-panel open-on-click-vs-always
> call is owner-gated before default-ON (OWNER_ACTION_CHECKLIST).

> **⟢ HISTORICAL ship-snapshot table (2026-07-17, HEAD `28648b2`) — SUPERSEDED, NOT current state.**
> This "Field | Value" table records the 2026-07-17 `28648b2` ship. It is **older than the CURRENT
> STATE block at the top of this file**, and its installed-build facts are STALE: the live installer
> is now `Compy_0.9.0_x64-setup.exe` from **`37a166c`** (SHA-256 `6BC2F7DF…F5A2C4`), per CURRENT
> STATE. Kept for history; do NOT read the row below as the current installed artifact. Where it
> disagrees with CURRENT STATE, CURRENT STATE wins.

| Field | Value |
|---|---|
| Git HEAD | `28648b2` + this ship-docs commit (branch `main`, 2026-07-17 — the live installer is built from exactly `28648b2`; live stamp-verified `28648b2 · release` CLEAN via CDP `get_build_stamp` + embedded-hash byte-scan). **Chain since the previous table refresh (`d45bb1c`, 2026-07-17a):** `9c6af4b`+`094d834` (Intelligence Phase 2 — cross-session patterns · good-vs-bad investigator · evidence graph) → `cd66ce9` (Home verdict regression fix) → `7e00a06` (Intelligence Phase 3 DARK — engine + optimization simulator) → `e16b231` (Phase 3 ARM — `experiment_gate()` `false`→`true` + FE ExperimentBench, mutation-gate GO-LIVE) → `aa570d2` (build.rs `+dirty` root-anchor fix) → `4cc4ed5`/`04684e6` (Lab Optimize note rounds 1–2 — reversibility invariant, bug→guard) → `28648b2` (HUD byte-identity flake fix, HEAD at build); see the top Snapshot banners for each. **Prior refresh chain (`b968f0a`→`d45bb1c`, 2026-07-16→17a):** `3455782` (leftovers restore ARMED — Optimization Cleanup Phase 1 mutation-gate flip) → `27bc472` (version 0.1.0 → 0.9.0, owner call) → `c8c9cdc`/`dca1bc9`/`0078f70` (0.9.0 ship-docs · ship-reinstall BOM guard · auto-deploy-cancel decree) → `8f612d2` (Intelligence Phase 1 foundation + What-Changed slice) → `d45bb1c` (game-name display class sweep, HEAD at build); see the top Snapshot banners for each. **Older chain (`86ecad1`→`b968f0a`):** `4bf2a91` (`--run-elevated` boundary-side guard, 2026-07-15 re-cut) → `50b505e`/`f4b4ada`/`40bce4e`/`f160839` (console trains 1–4 default-ON + overlay backdrop fix, 2026-07-15f ship) → site-lane commits (site-only) → `92596d6`/`47300d9`/`b2d775d`/`d0392c9` (palette 8+7 rework · gradient-ink de-slop · UI-vision doc fix · nav-mount cost fix) → `b968f0a` (site-only, HEAD at build); see the top Snapshot banners for each. Older chain (`72fa005`→`86ecad1`): `8a9ab76` (accent palette 10→20) → `8e6920f` (pruned 20→15) → `cc9adb8` (dark-accent-as-TEXT legibility) → `530ef8b` (Monitor v5 "frametime" gloss) → `c80678f`/`2b64c51` (dead-code cleanup + readiness fix) → `18272be` (`compy_room_identity` + `compy_blackbook_console` **GRADUATED DEFAULT-ON**, 15-swatch duo palette, A+B Blackbook Receipts Strip + sentence rows, Home-rig accent-scope fix) → `86ecad1` (this ship: tooltip overpaint + unreachable tooltip link + dead deep-link scroll); see the top Snapshot banners for each. |
| App version | `0.9.0` (`gg.compy.app`, `compy.exe` — bumped from `0.1.0` at `27bc472`, owner call 2026-07-16; `1.0.0` fires at the release-hardening bar) |
| Current installer | `Compy_0.9.0_x64-setup.exe` SHA-256 `D0D63E489105BE7566769A13A2BA801FE76E95314E07A11938A8A49A94575BCB` (built from `28648b2`, 2026-07-17 — **Intelligence Phase 3 SHIPPED LIVE**: experiment engine + optimization simulator armed (`experiment_gate()` `true`, `e16b231`) orchestrating the audited apply/rollback boundary — no new mutation primitive; Lab Optimize note states the reversibility invariant (`04684e6`); cargo 808 · clippy clean · vitest 1720 · live stamp `28648b2 · release` CLEAN; details in the 2026-07-17f/e Snapshot banners; supersedes `E3F8E0CE03A2807786196BC52AAF1A21F86A17C8F5C02F0FD5ACC6FE7856EBA8` from `cd66ce9` (2026-07-17c — Home verdict regression fix) and `3EB0FAE5…C570D838` from `094d834` (2026-07-17b — Intelligence Phase 2)). Prior current-installer chain: `8063F95744C6AF00C760FD3F77DA63FBD9B68B279773307D6D1AEB5773A52E0D` from `d45bb1c` (2026-07-17 — **Intelligence Phase 1 ship**: `8f612d2` intelligence foundation + What-Changed read-only slice (23 files, +3984/−28, flag `compy_intelligence` default ON) · `d45bb1c` game-name display class sweep (bug→guard); cargo 754 · clippy clean · vitest 1708 · live stamp `d45bb1c` CLEAN; details in the top Snapshot banner. Supersedes `41613F13A046730A663B29AA144AE7DFF120FFD0C604ADE060B4D2A1D6ABB6F9` from `27bc472` (2026-07-16d — version 0.9.0 bump ship), which superseded `832B7CF3BDBD2603F925EDD18DD9A1669B0AB74CC441A7675769B46F48687A4E` from `b968f0a` (2026-07-16 — **app-lane task-list close**: palette 8-duo+7-solo rework (`92596d6`) · App.css gradient-ink de-slop + CoreBar transform fill (`47300d9`) · nav-mount cost fix (`d0392c9`: MonitorV2 duplicate pre-warm deleted, SessionStack hoisted ink cache, Blackbook 30-row tape cap + disclosure); zero `src-tauri`; tsc 0 · vitest 1666 · self-reviewer PASS 8/8 on real data; details in the top Snapshot banner. Supersedes `B87B3B3CC78527AF08C2000FDEC740676742E066E0AD13A3D623A0A553B3D20C` from `f160839` (2026-07-15f — console trains 1–4 default-ON + overlay ambient-backdrop fix), which superseded `265275CD1494A7E4AE3D64CDD21CAD8494179CD88E647F957C7313BF8E547BC7` from `4bf2a91` (2026-07-15 — `--run-elevated` boundary-side guard re-cut), which superseded `1C1F13DC259A99042918B5F1714B518F3825EFB1B080FC3443316F1CBFE657E0` from `86ecad1` (2026-07-13 — **glossary-tooltip trio fix**: Blackbook tape reveal fill-mode `both`→`backwards` (rows no longer permanent stacking contexts overpainting an open Term tooltip) · Term.tsx 160ms hover-grace (the "More in the Blackbook →" link is mouse-reachable, all Term sites app-wide) · Learn.tsx deep-link scroll effect re-runs after the category expands (`openCats` dep — the focused entry lands in view); zero `src-tauri`; tsc 0 · vitest 1608 · self-reviewer PASS on real data; details in the top Snapshot banner. Supersedes `A8C341DE…61EC1C10` from `18272be` (2026-07-13 — **default-ON graduation + duo palette + A+B Blackbook**: `compy_room_identity` + `compy_blackbook_console` readers flip to `!== "0"` (**DEFAULT ON**, owner-directed; "(preview)" Settings rows removed, devtools `"0"` failsafes stay); `ROOM_ACCENT_SWATCHES` re-curated to 15 (earth tones out, 3 duos in — bright primary + wash-only secondary, `a+b` persisted keys); Blackbook Logbook gains the Receipts Strip (3 count tiles, tape filter) + sentence-grammar rows + tape section head; Home-rig accent-scope bug fixed (`use-rig-colors.ts` prefers `.home-console`); zero `src-tauri`; tsc 0 · vitest 1604 · self-reviewer round-2 PASS on real data; details in the top Snapshot banner). Supersedes `21942094…0930FF4F` from `2b64c51` (dead-code cleanup + readiness "in the Lab" fix), which superseded `703F078B…9EE40B8` from `530ef8b` (Monitor v5 "frametime" gloss), whose room-identity + accent-palette chain (`72fa005`→`8a9ab76`→`8e6920f`→`cc9adb8`→`530ef8b`) it carries — see the top Snapshot banners.) Superseded installer chain (pre-`72fa005`): `D23DE073…9EBA9` from `72fa005` (**Per-room identity accents** behind NEW flag `compy_room_identity` **DEFAULT OFF** (`readRoomIdentity` → `=== "1"`, `src/design/theme.ts`; Settings → Appearance "Room accent colors (preview)") — each room gets its own accent (Monitor teal · Blackbook amber · Lab/Optimize emerald · Home violet unchanged), resolving the accent-lock owner-taste call; flag-off byte-identical every room; zero `src-tauri`; self-reviewer round-3 PASS; details in the top Snapshot banner. Superseded installer: `43234A53…943D5` from `617db5b` (2026-07-12), whose chain it carries — **Blackbook console Phase 4 "The Logbook"** behind NEW flag `compy_blackbook_console` **DEFAULT OFF** (`readBlackbookConsole` → `=== "1"`, `src/design/theme.ts`; Settings → Appearance "Blackbook console (preview)") — the Blackbook room's flight-recorder Logbook face over EXISTING data, field guide reachable via the room's mode toggle; `"0"`/absent = today's Learn library byte-identical; pure READ view routing undo to the Lab; zero `src-tauri`; self-reviewer round-2 PASS; details in the top Snapshot banner. Superseded installer: `3B855DD1…FB003` from `e195f70` (Monitor v5 console DEFAULT-ON), whose chain it carries — **Monitor v5 console FLIPPED DEFAULT-ON**: flag `compy_monitor_console` **DEFAULT OFF → DEFAULT ON** (`readMonitorConsole` → `!== "0"`, `src/design/theme.ts`; Settings → Appearance "Monitor console", now the OFF failsafe) — the Flight Deck + Session Stack is Monitor's default live face; the "0" failsafe restores the classic tiles; test-pins re-pointed to the DEFAULT-ON polarity (`monitor-console-flag.test.tsx` + sibling `monitor-v2.test.tsx`); owner "flip it default on"; self-reviewer PASS 8/8; details in the top Snapshot banner. Superseded installer: `DFE827D1…FB59` from `fcc400b` (JARVIS DEFAULT-ON), whose chain it carries — **JARVIS motion** (`compy_jarvis_motion` DEFAULT ON, `readJarvisMotion` → `!== "0"`), **Home title-header fix** (`cc1ffce`), the **Expert-view** train (`5850ac0`: `compy_expert_view` **DEFAULT OFF**, `readExpertView` → `=== "1"`, `src/design/use-expert-view.ts`, zero `src-tauri`), the full 2026-07-11 consumer-panel overhaul (`50b5c03`) and the Monitor v5 stack build itself (`915e85b`, now default-ON).) |
| Frozen private-beta artifact | ref `16069fa` / `beta/private-beta-001` (the OLD verified unsigned private beta — a DIFFERENT risk profile from current `main`) |
| Last full installed-build QA | **§6/§7: 2026-07-07 on the `5f765e4` installer (T5)** — §7 swept all items live (3 honesty gaps found → fixed `ff186e6` → focused re-verify PASS on the shipped build); §6 corrupt + missing ledger proven live (fail-loud quarantine / empty load, no crash; real ledger restored hash-identical), cancelled-apply covered by §1's live QA. **§6 helper-crash leg CLOSED 2026-07-08** (owner-run probe on the `48ca9ec` installer: kill elevated helper → `fps.json` froze + `fps.alive` cleaned + no ghost → re-enable spawned a new helper; owner confirmed the Monitor UI showed the sensor STOPPED, not frozen/false-live) — **§6 is now fully passed**; §1/§2a/§5 stand on their own dated passes. Last FULL all-section pass remains 2026-05-31 (frozen private-beta build). |

## Gate matrix (re-verified at HEAD `733f132`, 2026-07-02 — every gate function re-read at source; states unchanged since `9463c10`. Still current at `4e07420` (2026-07-04): the V2 product-shell train `706094f..4e07420` (V2-1→V2-15) is **entirely frontend/docs — `git diff 706094f..4e07420 -- src-tauri/` is empty**, so no gate function, mutation/rollback path, or IPC/capability surface changed. Before that, `706094f`'s sole src-tauri change was readiness drift-reason copy + a read-only `drifted_titles` summary field (`readiness.rs` / `history.rs`; diff-verified: no gate moved))

> **Re-verified 2026-07-06 at HEAD `8c9b711` — audit now mechanized.** Layer 1 (`node
> scripts/verify-release-state.mjs`, new): six citations had drifted 77–253 lines (the preload-dark +
> receipt-metadata trains grew `actions.rs`/`history.rs` above the cited symbols) — all re-anchored in
> this pass; script exits 0. Layer 2 (source re-read of every gate fn body): **every gate VALUE
> unchanged** — the only truth-level fix was quoting the literal CSP `connect-src` instead of a
> simplified one. Standing rule: run the script after any train touching cited files
> (`.claude/skills/gate-drift-audit`).

| Gate / capability | State | Source | Notes |
|---|---|---|---|
| **Gaming Mode (F1)** | **LIVE** (`true`) | `gaming_mode_gate()` — `lib.rs:518` | Flipped on 2026-06-18 w/ owner sign-off. §7 QA harness (6 scenarios) passed; **GAMING_MODE_QA.md live checklist 10/10 PASSED 2026-07-14** (#4/#10 owner-run 2026-07-07; #6/#7 real-UAC cancel arms owner-clicked on `db5349e` after that run forced the runas-decline fix — see the QA doc's runas note). **Owner SIGNED OFF 2026-07-14** — F1 is field-proven for 1.0. |
| **Service-suspend** | **ARMED** (`true`) | `service_suspend_gate()` — `actions.rs:2029` | Armed 2026-06-25. Live running-service exact-restore + UAC-cancel=no-partial + critical-service block proven. UI in `GamingMode.tsx`. Since T6 (2026-07-07) session-start suspends ride the ONE batched elevation; since T6b (2026-07-08, `bdc9daa`) the restore side batches the same way. |
| **Debloat (telemetry task disable)** | **ARMED** (`true`) | `bloat_removal_gate()` — `actions.rs:2102` | Armed 2026-06-26. Live exact disable→enable restore + off-list/Defender rejected. Fix-surface UI `DebloatTasks`. |
| **Benchmark tweak A/B trial** | **LIVE / UI-reachable, NO dedicated gate** | `start_tweak_trial` — `benchmark_trial.rs:170`, `lib.rs:699`, `Benchmark.tsx:193` | Performs a REAL mutation via the audited `apply_recommendation` path, protected by a `RollbackGuard` (auto-rollback on every exit). |
| **Preload-app removal (Phase-B "bloat removal")** | **DARK** (`false`) | `preload_removal_gate()` — `actions.rs:2251` | Built dark 2026-07-06 on the owner's nod (spec `2026-07-06-preload-app-removal-dark.md`). Per-user `Remove-AppxPackage` over a curated 4-app starter list (Solitaire · Feedback Hub · News · Office hub — **Spotify cut by owner curation 2026-07-06:** same package id as a real daily-driver install, no honest "stub" framing; may return behind a usage check); two-tier honest undo (silent re-register verified by re-read, else Store-page hand-off returning Err). Scope decisions: `HKCU\Run` DELETION dropped (the reversible disable already ships, `set_startup_entry_enabled`); Clipchamp/To Do excluded as data-adjacent. Command `remove_known_preload_app` refuses while dark; FE card renders nothing (test-pinned). Arming needs: live remove→reinstall QA (`qa_remove_then_reinstall_round_trip`) + every Store ProductId link-verified + owner curates the final list + sign-off. |
| **Aggregate-stack A/B trial (§2a)** | **DARK** (`false`) | `stack_trial_gate()` — `benchmark_trial.rs` | Built dark 2026-07-09 on the owner's nod (marathon §2a, spec `2026-07-08-lab-proving-ground.md`). Applies the whole safe stack in ONE UAC (reuses the audited `apply_recommendations_batch` — **no new mutation primitive**), measures the cumulative fps delta, then rolls back EXACTLY the changes it created via a multi-change Drop-guard (ledger id-diff; corrupt-ledger read ABORTS before any mutation — rust-tauri-reviewer fix). Commands `start_stack_trial` + `stack_trial_armed` refuse/return false while dark; no FE surface yet. Arming needs: live apply→rollback QA on a real rig + owner sign-off. |
| **Experiment engine + optimization simulator (Intelligence Phase 3)** | **ARMED** (`true`, 2026-07-17) | `experiment_gate()` — `experiment.rs:55` | Armed after owner sign-off "Ship it live now" + a live apply→rollback round-trip on this rig (benign reversible rec, clean ledger restore). ORCHESTRATES the audited mutation boundary — **no new apply/rollback primitive, no enum variant**: `start_experiment` (`experiment.rs:473`) applies ONE reversible change via `history::apply_recommendation`, auto-restores via `history::rollback_change`, resolve stays history-only. Every command still hard-checks the gate (defense-in-depth, now unreachable). Simulator `build_sim_context` (`experiment.rs:705`) reads the real hardware-tailored catalog READ-ONLY; unknown rec ⇒ honest insufficient-evidence, never a fabricated verdict. FE `ExperimentBench` mounted in `LabGround.tsx` (Lab room). |
| **Leftovers restore** | **ARMED** (`true`, 2026-07-16) | `restore_gate()` — `leftovers.rs:730` | Armed after owner-present live-UAC QA (all 3 loops PASS); `history::restore_leftover` registered (`lib.rs`), receipts ride the Trust Ledger with provenance `leftover_adopted`. No FE caller yet — restore UI is a later train. |
| **Receipts telemetry** | **DARK** (`false`) | `receipts_gate()` — `receipts.rs:18` | No send path/endpoint/queue; preview refuses; payload sanitized+bucketed. New outbound boundary → own security review + owner sign-off before arming. |
| **License / Pro enforcement** | **DISARMED — nothing enforced** | `licensing_armed()` — `license.rs:40` (all-zeros key); FE `pro.ts:14`, `entitlements.ts:14` | Plumbing wired end-to-end but inert; `ProGate` renders everything free. No Windows mutation, no phone-home. |
| **Signed remote rules / fetch** | **OFF** (`false`) | `remote_fetch_enabled()` — `remote_rules.rs:97`; all-zeros pubkey `remote_rules.rs:85` | Double-gated: `verify_chain` (`remote_rules.rs:231`) ALSO hard-fails on the placeholder key (`remote_rules.rs:236`). Ed25519 verify is real but never runs in shipped builds. |
| **Auto-updater** | **OFF / absent** | no `plugins`/`updater` block in `tauri.conf.json`; no updater dep in `Cargo.toml` | — |
| **Outbound network** | **NONE** | no `reqwest`/`ureq`/`hyper`/HTTP client anywhere in `src-tauri/src` or `Cargo.toml` (2026-07-11 audit: whole-tree grep, zero hits besides a `// Future:` comment at `remote_rules.rs:395` — the comment spans 395–396); **production** CSP `security.csp.connect-src` (`tauri.conf.json:46`) is `'self' ipc: http://ipc.localhost` — the `ws://localhost:1420 http://localhost:1420` tokens belong to the separate dev-only `devCsp` field (`tauri.conf.json:51`, not shipped). Both are local-only; zero external origins either way — the correction only fixes which field the doc was quoting, doesn't change the conclusion. | Verified-zero-outbound property holds while Receipts + remote-fetch stay dark. |

## Mutation safety posture (unchanged LOCKED rules)

- No kernel driver · no game injection · rollback-first · typed mutation allowlist
  (`KnownService`/`KnownBloatTask`/`AppliedAction`/`RollbackAction`/`Snapshot`, unknown inputs rejected).
- Rollback resolves from `history.json` alone, never the live catalog (`history.rs:818`→`actions::resolve_rollback`).
- Ledger save is crash-safe atomic temp-write+rename, test-pinned
  (`save_history_to` `history.rs:332`; test `save_is_an_atomic_swap_leaving_no_tmp` `history.rs:2146`).
- Elevation: relaunch `compy.exe --run-elevated <hex> <ticket>` (windowless), 4-way honest UAC
  outcome attribution (`elevation_outcome` `actions.rs:964`). PowerShell token validators
  `ps_safe`/`ps_safe_squoted`. Boundary-side second lock (2026-07-15): the helper runs ONLY hex
  byte-matching the one-time dispatch ticket minted at `run_elevated_powershell`, consumed before
  execution (`mint_elevation_ticket` `actions.rs:1149` · `consume_elevation_ticket` `actions.rs:1171`
  · `run_elevated_helper` `lib.rs:76`).
- Gaming-session advanced tier (USB + PCIe + service suspends) batches to **ONE elevation per
  session start** (T6, 2026-07-07) — and since T6b (`bdc9daa`, 2026-07-08) the restore side
  batches contiguous elevated rollbacks the same way: sink-staged → `compose_batch_script` → single
  `run_elevated_powershell` → per-item receipts (`apply_elevated_tier`,
  `gaming_orchestrator.rs:201`). No-partial abort+restore contract unchanged; UAC-decline drops
  only verifiably-never-ran staged entries (`elevation_error_nothing_ran` `actions.rs:988`);
  dispatch-layer guard `a_full_tier_dispatches_exactly_one_elevation`.

## Release blockers

| Item | Status |
|---|---|
| Manual-mutation apply/rollback QA | **CLOSED** 2026-05-31 (owner sign-off) — `RELEASE_QA.md:3`. NOT an open blocker. |
| Private-beta functional blockers | **NONE** for the frozen `16069fa` build (`PACKAGING_SIGNING_PLAN.md:131`). Current `main` wants its own fresh installed-build QA if shipped. **For the current installed `37a166c` build that QA is DONE** — 2026-07-20b (build/install/stamp/zero-outbound/smoke) + 2026-07-20c (live rollback → reapply cycle + orphan recovery through the installed UI) ⇒ **GO for invite-only private beta** (the send itself = owner action; Code signing + Legal still gate PUBLIC). |
| Gaming Mode live reboot-while-active QA | **CLOSED 2026-07-07 (owner-run)** — physical reboot + "Restore now" on the `48ca9ec` build: session contract cleared, every probed value matched his standing ledger state; case #4 PASSED in `GAMING_MODE_QA.md` (`a21f310`). This row had lagged the close by a day — fixed 2026-07-08. |
| Gaming Mode enable fires ~5–6 UAC prompts | **CLOSED 2026-07-07/08** — T6 built the session-start batch (ONE `--run-elevated` invocation: `apply_elevated_tier`, `gaming_orchestrator.rs:201`; ≤1-dispatch cargo pin; no-partial contract + UAC-decline honesty preserved; UAC *policy* settings untouched per standing rule); owner live-confirmed exactly ONE enable UAC 2026-07-07 (case #10 PASSED). T6b (`bdc9daa`, 2026-07-08) batches the restore side the same way; owner's live restore-side eyeball pending (next real session). |
| Code signing | **OPEN** — gates PUBLIC release (Azure Trusted Signing route, owner/$-gated). |
| Legal (EULA license model + jurisdiction, PRIVACY) | **OPEN** — gates PUBLIC release. DRAFTS only. |
| Receipts security review + consent UI + payload preview + kill switch | **OPEN** — gates arming Receipts telemetry. |
| Preload-app removal live QA (remove→reinstall round trip, Store links) + owner-curated list | **OPEN** — gates arming preload-app removal (feature is built DARK, not a ship blocker). |
| Remote-rules production key + CDN + staged rollout | **OPEN** — gates arming remote fetch. (The semver compare is NOT a blocker and never was one at ship: `version_in_range` (`remote_rules.rs:300`) compares NUMERICALLY by delegating to `cmp_version` (`remote_rules.rs:311`), pinned by the test `version_compare_is_numeric_not_lexicographic` (`remote_rules.rs:608`). A pre-2026-07-19 note here read "lexicographic"; that was disproven by the code and is corrected.) |

## Required owner decisions (live)

1. **Beta artifact choice — DECIDED (owner, 2026-07-06): current `main`.** ("I like the current main build, it's more complete in the way I want it.") Frozen `16069fa` stays archival. Consequence armed: fresh full installed-build QA on `main` (2026-07-06 train T5, now REQUIRED) + owner-run GAMING_MODE_QA.md live case #4 (reboot-while-active) before any send. **That consequence is now SATISFIED for `37a166c`:** case #4 was owner-run 2026-07-07; the fresh installed-build QA + runtime closure landed 2026-07-20b/c (CURRENT STATE + snapshot entries) — the remaining owner action is the send decision itself.
2. Code-signing route + legal finalization (PUBLIC gates).
3. When/whether to arm Receipts (its own security review + owner sign-off).
