# Archived from docs/BACKLOG.md — the P0 block, all three shipped 2026-08-03

Moved out of the live ledger on 2026-08-18 under the TOKEN LAW (docs carry CURRENT STATE only;
history moves to archive, never deleted). Point-in-time record; do not treat as current state.

- [x] **P0 before the next release or wider beta — ALL THREE LANDED 2026-08-03.**
  - **Q1 privacy/storage/trust-copy truth** — shipped as v0.9.12 (issue
    [#59](https://github.com/Pootytxng/sentinel/issues/59)): absolute offline claims gone from both
    locales, the legal documents and the marketing site; `docs/PRIVACY.md` at v0.3; automatic update
    checks switchable off; `src/outbound-claim-guard.test.ts` fails the build on any absolute claim
    while an outbound surface is live. **Acceptance-list pass done 2026-08-04 (Cowork):**
    `docs/PRIVACY.md`/`site/privacy.html` wrongly named `%LOCALAPPDATA%\Compy\` for FPS runtime
    files (`fps_dir()` is `compy_data_dir().join("runtime")` = `%APPDATA%\Compy\runtime\`) and
    blanketed "Compy will recreate what it needs" over `history.json`, hiding that deleting it
    erases the Trust Ledger. Both fixed in both files; pinned by
    `src/privacy-data-dir-guard.test.ts`. **en↔zh-CN parity now fully diffed (2026-08-04),
    closing the spot-check gap this line used to admit** — all **9** file pairs (the old "8" was
    miscounted), 2234 en keys. The 59 keys zh-CN "lacks" are all `_one` plural variants Chinese
    has no grammatical category for — correct by design, so the guard derives categories from
    `Intl.PluralRules` rather than demanding raw key equality. 0 extra keys. The one REAL defect
    was a placeholder, not a missing string: the regression debrief splits a sentence across five
    keys, English trails `{{game}}` and Chinese leads with it, and `SessionDebrief.tsx` fed the
    var to the trailing segment only — Chinese users saw literal `你在 {{game}} 中的`. Fixed by
    feeding every prose segment the same bag; pinned by `src/i18n/locale-parity-guard.test.ts`.
  - **Q2 main-vs-overlay command authority** — owner GO 2026-08-03, merged as
    [#62](https://github.com/Pootytxng/sentinel/pull/62). The overlay held all 91 custom commands
    and needed 3; `build.rs` now declares them via `AppManifest::commands` and the two capability
    files split main from overlay. Guard: `src/command-authority-guard.test.ts`. *Deferred by
    decision:* the per-command main-window caller check (the ACL already rejects before the body
    runs) — see #62 for the reasoning.
  - **Q3 FPS PID-recycle attribution** — merged as
    [#34](https://github.com/Pootytxng/sentinel/pull/34). Candidates must match pid AND name,
    `alive` is consulted on the frame path, and our pid under a foreign name is a recycle. Merged on
    code evidence (3 red → green, mutation-proven both directions, 891 cargo). *Open, owner/native:*
    a real game-close probe against an INSTALLED build carrying the fix — attempted 2026-08-03 and
    not possible, `compy.exe` was not running and `fps.json` was 12 hours stale. Rides the next
    install rather than blocking the merge.
