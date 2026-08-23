# SESSION_HANDOFF history archive - retired cycle notes

> MOVED here byte-for-byte from docs/SESSION_HANDOFF.md (line budget, token-efficiency decree).
> THE LIVE POINTER lives in docs/SESSION_HANDOFF.md; this file is the reverse-chron record.
> APPEND new dated sections at the TOP, directly below this header.

### 2026-08-23 - the two 2026-08-22 cycle notes, moved verbatim (line budget)

## Cycle note — 2026-08-22, third pass — BACKLOG section caps (landed; the guard now says it)

`docs/BACKLOG.md`'s three append-only queues each got a byte cap in `scripts/doc-budget.ps1`
(`$sectionByteBudgets`) mirrored by `scripts/doc-budget-guard.test.mjs`, which PARSES them rather
than restating them — a file budget could see the total but never WHICH queue grew. 7 closed rows
archived to `BACKLOG_ARCHIVE.md` §`2026-08-22b`. Also corrected: `license.rs` is 380 finished lines
behind an all-zeros key, already recorded built-dark at `RELEASE_STATE.md:125` — what is left on
Pro is the owner's entity/merchant errands, not code.

## Cycle note — 2026-08-22, `lane/train-2026-08-22` — CLOSED (detail in git, not here)

Landed and reported: pricing evidence + the owner's **$4.99/mo · $39/yr · $89 lifetime** ruling
(`55ecb642`, `c796875b`; priced, NOT published — nothing goes on the site until Pro exists) · PR
#193 (`d5571766`) · C-14 GPU screen mounted in the Lab (`b9ce8354`) · the #125 write refusal ARMED
(`d5a6a630`) · five stale owner sign-offs archived. Desk build `0.9.26` / stamp **`d5a6a630`**,
`self-review` PASS 11/11.

**Still open, and NOT an agent's to move here:** Codex weekly automation → product-conformance scope
is the Codex lane's. **Compy Pro itself is unbuilt.** Recorded closed but not *solved*: #121's cause
stays unattributable at 100 ms poll resolution, and #128's **release** mutex has never been held
during a real publish.
