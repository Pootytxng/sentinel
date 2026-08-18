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

**NONE OPEN.** `fix/owner-decision-conformance-guards` merged as `dbf174d2` (PR
[#136](https://github.com/Pootytxng/sentinel/pull/136)) and the ref is pruned. Do not read "none
open" as "nothing in flight" — `docs/WORK_CONTROL.md` and `git branch -a` are what say that.

**What that lane was, because the reason outlives it:** the owner opened his own desk build and
found three defects in ONE screenshot that 167 green guards had all missed. Every one was already a
recorded decision. Landed: the `compy_home_intake` flag gates the QUESTION again (he removed that box
on sight in `4d1afa92`; UX-1 put it back as the screen's largest button) · nine stale room names out
of Rust copy · the topbar tagline dropped, decided 2026-08-11 and never built · the checks strip
dissolved from a bordered `16/16 measured · 1 flagged` panel into one plain sentence. Plus an
honesty fix: `measured/total` used to render identically whether a check FAILED or could not be
READ, and a PC doctor that conflates unknown with broken is not honest.

**Guards that came with it, so the same class cannot silently revert again:**
`src/room-name-copy-guard.test.ts` · `src/side-stripe-guard.test.ts` (three pre-existing offenders
baselined BY NAME) · the `.v2-crumb` regression test in `ShellV2.test.tsx` · the intake question
pinned absent across all three OFF states · **self-review rubric item 10 — prior owner decisions**,
the check whose absence let UX-1 through. `affordance-census` had *certified* that regression: it
rewards KEEPING affordances, and his decision was to remove one.

## Next — the conformance queue

`docs/CONFORMANCE_AUDIT_2026-08-18.md` (Cowork lane) graded 26 recorded decisions against
`main@e6feb861`: **9 HONORED · 1 SILENTLY REVERSED · 9 NEVER BUILT · 4 PARTIAL · 1 DOC DRIFT.** It
reached C-01/C-02/C-03 independently as its own top three — the same three the owner found by eye.
The survivors are queued in `docs/BACKLOG.md` § *Conformance queue* in owner-value order, starting
C-04, C-05, C-08. Take from there, not from this file.

Also open, owner-flagged as optional: 15 bare `.btn-small` buttons hover `--danger` red on 5
surfaces that destroy nothing (baseline in `src/button-legibility-guard.test.ts`).

**Delegated — do NOT duplicate:** Cowork owes an adversarial audit of the EEE rollback-script change
in `actions.rs` (#135). Queued: extend the Codex weekly automation with product-conformance scope and
make it write INTO the repo (today it is coordination-only and writes to `$CODEX_HOME`, where no lane
can read it) — that is the mechanism that would have caught this drift without the owner's eyes.

## Carried forward — these outlive the lane

- **The installed build carries `data_root.rs`** (desk `421657a9`, v0.9.25, unsigned/desk-only), so
  the Trust Ledger can no longer split by launch path and the "Desktop / Start menu only"
  restriction is LIFTED. The FLEET is still on published `efde8310` and does NOT have it — a publish
  re-cut from `main` with the signing key closes that.
- **Do not touch `C:\Users\Kuya\code\compy-data-root-recovery\`.** Only copies of the pre-merge
  ledgers and the archived overlay (58 files). No deletes, no pruning, not even of "duplicates".
- **§A0 is the owner's to run, and it is 2 minutes.** `pwsh scripts/backup-updater-key.ps1`, then
  `pwsh scripts/restore-updater-key.ps1 -BackupPath <the .txt> -Verify`, passphrase into his password
  manager. Details in `docs/OWNER_ACTION_CHECKLIST.md` §A0.
- **Nice-to-have, unbuilt:** a Settings row surfacing `get_data_root_report()`.

## Verification at the merge head

`#136` at `ec88cfa3`, `scripts/verify-local.ps1` via `.githooks/pre-push` → **PASS**. Corroborated
in-session: vitest 337 files / 4972 tests green · `tsc --noEmit` clean · `doc-budget.ps1` ALL PASS ·
`branch-disposition-audit` OK. Self-review **PASS**, 10/10, before/after captures in
`docs/ui-sweep/shots/`.

**The merge receipt records a WARNING, not a pass, on the final independent review** — no non-writing
model (Codex) was reachable from the merging session, so that review is *unverified*, not
self-approved. Same condition as the `#131`/`#132` heads. **A Codex pass over `dbf174d2` is still
owed**; the in-lane self-review does not substitute for it.

## Do NOT

- Do not append to this file — replace it. It is the *current* lane's state, never a log.
- Do not `gh api -X DELETE` a ref — policy blocks it here. `git push origin --delete <branch>` works
  and correctly skips the gate (`pre-push: deletion-only push, nothing to verify`).
- Do not pass `--delete-branch` to `gh pr merge`; land it without the flag. That flag once set
  `core.bare=true` repo-wide and corrupted every worktree. Prune the ref separately afterwards.
- Do not `git push` casually — `.githooks/pre-push` runs the full local gate (~4 minutes). Background
  it rather than letting it time out, and never pipe it through `tail` (SSH idle drop).
