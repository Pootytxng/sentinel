# SESSION_HANDOFF history archive - retired cycle notes

> MOVED here byte-for-byte from docs/SESSION_HANDOFF.md (line budget, token-efficiency decree).
> THE LIVE POINTER lives in docs/SESSION_HANDOFF.md; this file is the reverse-chron record.
> APPEND new dated sections at the TOP, directly below this header.

### 2026-09-15 — closed records moved out of the live pointer (line budget)

Moved verbatim from `docs/SESSION_HANDOFF.md` when it stood at 119/120 lines; the cap ratcheted 120 -> 116 in the same commit. Rows and paragraphs below are exactly as they stood; only their live replacements were rewritten.

**"Where the train is standing" — the three closed rows:**

| | |
|---|---|
| Shipped | Q9b Stage 2 (#258): `src/surfaces/CaseEvidenceConsent.tsx` — the local preview/edit/one-submission-consent screen over Stage 1's canonical bytes, fixture-only, no command/HTTP/queue/persistence, gate still hard-false. Its guard now strips NOTHING and reads every byte: three independent reviews each defeated a comment-stripper and hid a real `invoke()`. Before it: Stage 1 (#252), rule D (#243), the Q9b contract (#247/#248/#249) |
| Self-review | PASS 12/12 at `39f23847` over all six fixture states at 1484px, 200% zoom and 420px; nothing rendered has changed since |
| Harvest | Wave 1 Lane B (#224/#225) LANDED: PR #401 merged to `main` at `3fe7a029` (receipt `.claude/work-control/2026-09-07-merge-pr-401.json`, independent review APPROVE at `aed5bcac`); PR #294 closed as superseded and its ref pruned, so its content is on `main` and no ref carries it. Acceptance stays the owner's: look at Health/Test in the installed `d7fed835` build, accept or veto (#224 proof boundary, #225 step 7). |

**"The rule that came out of the walk" — the DIR-1a record:**

**DIR-1a: offering help is conditional on evidence** — a front door built only out of symptoms tells
a healthy PC's owner they are in the wrong place, and *"i want more fps"* is a legitimate reason to be
here. The shipped implementation must still answer *"is this framing earned?"* because the evidence-first and no-scareware laws in `docs/PRODUCT_CONSTITUTION.md` now supply the product authority.
Historical rationale is preserved at `docs/UI_VISION_BACKLOG.md` §"⭐ DIR-1a"; it is evidence, not
priority or work authorization. Shipped `b21bc18b`; guard
`src/surfaces/home-console-front-door-gate.test.tsx`, falsified three ways. **DIR-1b:** the attention
state carries a one-line ROUTE to the room that acts on it (#180 §C untouched — the detail paragraph
still does not render on Health).

**"SOURCE-reachability is not USER-reachability" — the three cases:**

**SOURCE-reachability is not USER-reachability.** A component can be dark one level up while **three
guards stay green** (vendor-honesty proved only "not wrapped in a condition"; the affordance census
counted 80 unreachable strings as live; the mono census described CSS nothing rendered). When a guard
certifies a surface, check a route reaches it — and **an audit is not a work order.**

### 2026-09-03 — #304 control-character incident detail, moved verbatim (line budget)

`docs/SESSION_HANDOFF.md`'s gate-traps bullet kept the full incident narrative for #304 alongside
the rule it produced. The rule stays live; the incident is preserved here. Six literal 0x08 bytes
stood in for `\b` in two test regexes, so both assertions matched a byte no tracked file contains
and could never fail; a separate `sed -i` `\U`/`\c` escape wrote a raw 0x0F into a doc.
`scripts/source-control-characters.test.mjs` ROOTS now covers `src`, `docs` and `src-tauri/src` too,
not just `scripts`/`tools`.

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

### 2026-09-03 — #291's price for the old fleet bullet, moved verbatim (line budget)

`docs/SESSION_HANDOFF.md` used to carry a live worktree/branch inventory — every checkout on the
machine, every lane still ahead of `main`, spelled out by name. #291 measured what that cost:
**eight of eight open PRs on 2026-09-02 edited this file, almost none of them about their own
subject** — one lane adding a worktree made the stated total false for every other lane's gate, so
whoever pushed next paid for it, then rebased because someone else had just paid for it too. The
live file now only states the rule (`node scripts/fleet-snapshot.mjs` measures the fleet; nothing
is stored here); this paragraph is the incident that justified it.
