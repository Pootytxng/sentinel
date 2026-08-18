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

**NONE OPEN.** Everything below is on `origin/main`; no branch, no PR, nothing half-landed.

Shipped this session, newest first: **the ship path repaired** (below) · **C-06 + C-08** the
plain-English copy pass and the guard that holds it (`4c9e440e`) · **the launch-focus diagnostics**
(`dc01f330`) · **the Home finding and the gate flake written into tracking** (`d9923c66`) · **C-09**
build identifiers out of consumer chrome (`6d047c2a`, `00d7020e`).

**The finding that matters more than the copy:** `src/plain-language-guard.test.ts` scanned
`/\.(tsx?)$/` — 199 files, and NONE of the 18 locale files holding 237,925 bytes of the consumer copy
it exists to police. Its own header says it mirrors `voice-guard.test.ts`, which has scanned
`tsx?|css|json` all along. Two sibling guards, one blind, both green for months. That is the
mechanism behind "we decided this already and it came back" — nothing was ever looking at the file
the copy lives in. Fixed; 27 English + 12 zh-CN engineer-speak hits are now 2 and 1, both allowlisted
with a stated reason (LOCKED rule 5's NVIDIA line, and Expert View naming the registry key it exists
to name). When you find the next silent revert, check the guard's FILE FILTER before its rules.

**Two of three is not three, and only looking caught it.** The owner named three Home controls as
clutter; #136 was reported as clearing all three. A capture of the shipped build showed the bordered
"Re-run check" button still standing. **4,979 green tests could not see it — every pin asserted the
button was PRESENT**, so the suite was defending the old intent perfectly. Fixed in `436818c2` by
DEMOTING it to an inline text link, never deleting it: that control is the only entry point to
`<FirstCheck>`, so a delete would have stranded a flow to satisfy a look. Self-review PASS 10/10 on
the installed binary, all three items now confirmed absent from the live DOM. **Rule of thumb this
earned: when a report says a visual item is fixed, the pins that would prove it are the same pins
that were written when it was wanted — capture the screen, do not re-read the tests.**

**The ship path was dead and nothing said so** — found by running it, not by a test. Two independent
breaks in `scripts/ship-reinstall.ps1`, the LAW-mandated post-build step:
1. `scripts/lib/canonical-data-root.ps1` shipped BOM-less in #130. PowerShell 5.1 decodes a BOM-less
   file as ANSI, an em-dash becomes mojibake ending in a SMART QUOTE, and 5.1 honours that as a
   string delimiter — one em-dash inside a string parse-errors the whole file, and the dot-source
   killed the entry script. Guard C existed for exactly this and covered only `ship-reinstall.ps1`,
   never the libs it loads. **Now walks every `scripts/**/*.ps1`;** five more offenders were fixed
   with it, including `backup-updater-key.ps1` — the owner's own §A0 task.
2. C-09 moved build identifiers out of the rail, and `runtime-proof.ps1` read the version off that
   rail. Rather than drop the check (it is what catches a stale frontend beside a fresh binary), the
   bundle now publishes `__COMPY_UI_VERSION__` on mount and the proof compares THAT. Guard E pins
   both ends so they fail together. **Lesson: a green suite proved nothing here — no test ran the
   ship script.**

## Next — the conformance queue

`docs/CONFORMANCE_AUDIT_2026-08-18.md` (Cowork lane) graded 26 recorded decisions against
`main@e6feb861`: **9 HONORED · 1 SILENTLY REVERSED · 9 NEVER BUILT · 4 PARTIAL · 1 DOC DRIFT.** It
reached C-01/C-02/C-03 independently as its own top three — the same three the owner found by eye.
The survivors are queued in `docs/BACKLOG.md` § *Conformance queue* in owner-value order, starting
C-04, C-05, C-19, C-10 (C-06/C-08/C-09 are shipped). Take from there, not from this file.

**C-19 is new this session, from the owner's own question.** He was told the CPU-temperature
work would show up under "Monitor → CPU". There is no Monitor room — the rooms are Home · Check ·
Live · Tune · History · Test — and the reading actually sits at **Live → Advanced → CPU card → open
detail**. The wrong name is the small half; the real finding is that "is my CPU running hot" is a
front-door question for a PC doctor and its answer is three clicks deep behind a mode the user
must know to switch into. Surfacing decision, not a sensor one — the reading already works.

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

`main` at `256264ad`, `scripts/verify-local.ps1` via `.githooks/pre-push` → **PASS** (as did every
push this session: `80397326`, `3e7648c8`, `436818c2`, `1664f0e1`, `88292929`). Corroborated
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
