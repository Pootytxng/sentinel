# SESSION_HANDOFF history archive - retired cycle notes

> MOVED here byte-for-byte from docs/SESSION_HANDOFF.md (line budget, token-efficiency decree).
> THE LIVE POINTER lives in docs/SESSION_HANDOFF.md; this file is the reverse-chron record.
> APPEND new dated sections at the TOP, directly below this header.


## Slice 2 (Health) — the eleven self-review rounds, moved verbatim 2026-08-23

_Was `docs/SESSION_HANDOFF.md`; moved when slice 4 landed. Paths below are repo-root-relative._

### Eleven self-review rounds, ten FAILs, eleven guards — slice 2 IS DONE

Every round was a complete fresh review against `01-health-approved.png` on the INSTALLED build, and
every fix was proven to FAIL on the pre-fix source first. All four findings were honest-measurement
failures wearing layout clothes — a reading nobody can read is a reading that came back empty. R1
and R2 are landed and written up in `docs/UI_VISION_BACKLOG.md` §FOUR-ROOM.

1. **R1 → `7cb43840`.** The 40px verdict read "Applied Compy changes", a filing-cabinet tab: the
   name-it law was guarded with a SYNTHETIC fixture the Rust catalog never matched. All ten
   `Attention` labels now name the finding. Guard `readiness-attention-label-guard.test.ts`.
2. **R2 → `d5bff77e`.** The viewport-fixed `.hud-frame-readout` was a curtain over live readings:
   its clearance was a `padding-bottom`, which clears only a document's END, where `margin-bottom`
   shortens the scroll viewport itself. Same commit: it named the CPU/GPU a THIRD time on Health, so
   the rig segment stands down. Guards `hud-frame-clearance-guard`, `hud-readout-no-duplicate-guard`.
3. **R3+R4 → `2ea9683d`, `cbb36365`. At 1280×720 the readout strip was sliced** — five labels, none
   of their values. A floor ALONE does nothing; only an authoritative height breaks the r3f canvas's
   measure-my-parent circle.
4. **R5 → `8fd043d1`. Those two shipped as an `@media` block the approved handoff forbids** — *"no
   responsive media queries."* Guard bans `@media`; verified breakpoint-free in every round since.
5. **R6 → R11, ONE collision in the readout strip, six rounds — each fix released the side the last
   one clamped.** `1.4fr` (automatic minimum = min-content) → `auto` → `auto` IS max-content and the
   TRANSLATED note runs 187px → flooring the readings at max-content starved the instrument to
   26.4px. **Every one of those numbers was a `scrollWidth` read inside a box an earlier round had
   clamped, which is not max-content.** R9 deleted the CLASS: the panel measures ITSELF, every track
   is `minmax(<px floor>, <n>fr)`, `overflow-y: auto` is the net. R10 hit the same class one axis
   over (a wrapping label moved its own value) → the cells **subgrid onto one shared set of rows**.
   R11 PASSED. Residual ACCEPTED: at 720p the panel's bottom PADDING lands ~18px under the lane's
   clip (last text 12px above it, lane scrolls). Do NOT grow `--hc-chrome-top` to close it.

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

## 2026-09-01 — the self-review row leaves the live handoff

Moved out of `SESSION_HANDOFF.md` to pay for the `lane/wrapper-allowlist-308` carrier name that
rule C began demanding the moment `sentinel-atomic-281` was repurposed onto that branch. The doc
was at 120/120 with zero headroom and the bullet was already wrapped tight at 118 columns, so the
line could not be recovered by reflowing; widening the wrap would have shed lines without shedding
content, which games the metric rather than paying it.

This row is a point-in-time verdict for work that has already landed. It is evidence of a passed
gate, not state anyone needs to resume from — which is what makes it archive material rather than
live-doc material. Verbatim:

| Self-review | PASS 12/12 at `39f23847` over all six fixture states at 1484px, 200% zoom and 420px; nothing rendered has changed since |
