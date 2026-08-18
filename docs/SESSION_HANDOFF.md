# Session Handoff

> **REPLACE this file's content every time you write it — never append.** It holds only the
> *current* lane's state, not a log. One lane at a time. When the lane lands (merged + branch
> deleted), clear this file back to the template in git history.
>
> Written by `.claude/hooks/context-size-advisor.mjs` when it detects context-thrash (fast
> drop→refill cycles with no real headroom gained — see `scripts/lib/context-thrash.mjs`), and by
> any session that sees its own context filling fast. Read this FIRST on a fresh session that
> mentions "continue" or "resume" with no other lead. Budget: 120 lines
> (`scripts/doc-budget.ps1`) — if you're about to blow it, cut detail, don't skip the write.

## Lane

**OPEN — `fix/owner-decision-conformance-guards` (`8db70795`+), product-conformance repair.**
Opened 2026-08-18 after the owner opened his own desk build and found three defects in one screenshot
that 167 green guards had all missed.

**Landed in `8db70795`:**
- `compy_home_intake` gates the QUESTION again, not just the panel it opens (`HomeConsole.tsx`,
  `intakeAvailable` leads with `intakeOn`). He removed that box on sight 2026-08-12 (`4d1afa92`);
  UX-1 (`f1766e86`) put it back as the screen's largest button while the flag still read off.
- Nine user-facing Rust strings renamed off retired rooms (Monitor→Live, Blackbook→History,
  Lab→Test): `readiness.rs` ×2, `intelligence_patterns.rs` ×5, `experiment.rs` ×1, plus the
  assertion in `readiness.rs` that was pinning `"the Lab"` in place.
- `src/room-name-copy-guard.test.ts` — new, driven off `HOME_RAIL`, **carries its own disarm proof**
  (it silently false-greened twice while being written: one lost backslash level, one rewritten
  directory walk).
- Self-review **rubric item 10 — prior owner decisions** (`.claude/agents/self-reviewer.md`), the
  check whose absence let UX-1 through. `affordance-census` had *certified* the regression: it
  rewards KEEPING affordances and his decision was to remove one.

**Next in this lane (item 4 of the owner's approved four):** the Home front-door restructure —
verdict → one action → hero. Fold the drift paragraph + "16/16 measured · 1 flagged" into one plain
sentence with its fix inline, de-stripe the Crash & Freeze row, drop the topbar taglines (UX-1
decision ②, still live at `ShellV2.tsx:45`). **Ships with a viewable before/after via `SendUserFile`,
per the taste decree — prose describing a look does not count.** Self-review is mandatory before any
done-claim, and rubric item 10 now applies to this diff too.

**Delegated, do not duplicate:** the owner pasted a read-only product-conformance audit brief into
**Cowork** on 2026-08-18 — every decision in `docs/UI_VISION_BACKLOG.md` + `docs/decisions/*` vs live
code, output to `docs/CONFORMANCE_AUDIT_2026-08-18.md`. Also queued: extend the Codex weekly
automation with that scope and make it write INTO the repo (today it is coordination-only and writes
to `$CODEX_HOME`, where no lane can read it).

## Carried forward — these outlive the lane

- **RETIRED 2026-08-18 — the installed build now carries `data_root.rs`.** The desk build `421657a9`
  (v0.9.25, unsigned/desk-only) was built and silently installed, and the resolver's strings are
  present in `%LOCALAPPDATA%\Compy\compy.exe`. The Trust Ledger can no longer split by launch path,
  so the "Desktop / Start menu only" restriction is LIFTED. The FLEET is still on published
  `efde8310` and does not have it — a publish re-cut from `main` with the signing key closes that.
- **Do not touch `C:\Users\Kuya\code\compy-data-root-recovery\`.** It holds the only copies of the
  pre-merge ledgers and the archived overlay (58 files). No deletes, no pruning, not even of
  "duplicates".
- **§A0 is now the owner's to run, and it is 2 minutes.** `pwsh scripts/backup-updater-key.ps1`,
  then `pwsh scripts/restore-updater-key.ps1 -BackupPath <the .txt> -Verify`, passphrase into his
  password manager. Details in `docs/OWNER_ACTION_CHECKLIST.md` §A0.
- **Nice-to-have, unbuilt:** a Settings row surfacing `get_data_root_report()`. The command and the
  support-export line exist, and the halt text already explains itself at the point of failure.

## Verification at the merge heads

`#132` at `8aeacf45` and `#131` at `18685d21`, both `scripts/verify-local.ps1` → **PASS**:
vitest 334 files / 4311 passed · tsc + build clean · cargo 946 passed / 0 failed · clippy clean.
Merge receipts recorded a **warning, not a pass**, on the final independent review: no non-writing
model (Codex) was reachable from the merging session, so that review is unverified rather than
self-approved.

## Do NOT

- Do not append to this file — replace it. It is the *current* lane's state, never a log.
- Do not treat this "none open" note as evidence that nothing is in flight: `docs/WORK_CONTROL.md`
  and `git branch -a` are what say whether another lane holds a claim.
- Do not `git push` casually — `.githooks/pre-push` runs the full local gate (~4 minutes), including
  for a `--delete` refspec. Background it rather than letting it time out.
