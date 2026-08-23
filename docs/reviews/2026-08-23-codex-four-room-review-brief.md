# Codex review brief — four-room visual direction (issue #49)

**Head under review:** `438890fc` on `feat/four-room-visual-direction`, worktree
`C:\Users\Kuya\code\sentinel-fourroom`. **Unpushed and unmerged**, deliberately — #49 authorized
local implementation and its verification, explicitly not release.
**Installed build:** `0c550138` (the last code commit; `cddf58be` and `438890fc` are docs only).
Stamp verified over CDP: `0c550138 · release · shell 0.9.26`.

**Your role here** is the one `docs/WORK_CONTROL.md#roles` gives you: independent read-only auditor,
advisory, no jurisdiction over building or decisions. Report findings; do not write in this
worktree. It is a claimed lane.

## What was built

Seven slices converging four rooms onto one approved composition, each room matched against its own
1550px comp (a 1550px render of a 1500px design — **divide every comp measurement by 1.0333** before
comparing to app pixels):

| Room | id | Comp | Family |
|---|---|---|---|
| Health | `home` | `01-health-approved.png` | panelled (aside) |
| Live | `play` | `02-live-approved.png` | wide |
| History | `learn` | `03-history-approved.png` | wide |
| Test | `lab` | `04-test-approved.png` | panelled (aside) |

Design source of truth: the approved handoff at
`C:\Users\Kuya\.codex\visualizations\2026\08\23\01a02bee-5474-7961-b05a-e674fb8bb165\compy-four-room-handoff\HANDOFF.md`.

## The two review questions

**1. Visual — does the built app match its comps?** Self-review round 16 says yes on all eleven
rubric items, measured live at the owner's 1500×980 with 1280×720 and 1920×1080 spot-checked. Treat
that as a claim to re-prove, not as a result. The measurements it rests on:

- `.v2-verdict` on Health computes `column` / `nowrap`, every child's right edge inside the parent's
  721.6px. Round 15 measured a child at 749.6, clipped behind the rig panel.
- h1 sizes **52 · 52 · 40 · 40** (Health · Test · Live · History); all four `.v2-verdict-sub` at 15px.
- eyebrow → headline gap 16px in all four rooms; 6/6 Test station subtitles verbatim from the comp.
- zero `HudMasthead` references left anywhere in `src/`.

**Colour is deliberately not chased.** The PNGs are uniformly contrast-lifted — gamma, not a
different palette — so a brightness delta is not a finding. A **hue** or **semantic-role** delta is.

**2. Frontend contract — did anything cross the IPC boundary?** The branch adds and removes **zero**
`invoke` call sites (`git diff origin/main..HEAD -- 'src/**/*.ts*' | grep invoke` → empty). That is
the mechanical claim; the audit of whether existing calls still match their `#[tauri::command]`
shapes after 7606 insertions across 90 files is what is actually owed.

## Constraints the work was held to — flag any violation, do not relitigate the rule

- **No new IPC, backend data source, room, network behaviour, Windows mutation, or feature flag.**
- **Tokens only.** Every v2 selector scopes under `:root[data-v2="on"]`; `tokens-v2-guard.test.ts`
  fails any colour literal in v2 surface CSS. Font sizes may be declared only in
  `src/design/type-scale.css`.
- **No breakpoints.** The two layout families key off `[data-room]`, never a media query.
- **Honest measurement.** null / unreadable / unsupported / not-yet-measured are four distinct
  states, none renders as zero, and a grade may never render over an absent measurement.
- **The green / amber / red grade ladder stays** (owner, 2026-08-23: *"what should remain is the
  color coded system we have for alert levels"*). Pinned by `comp-fidelity-guard.test.ts`.

## Three deviations from the comps, logged and awaiting the owner — not defects

1. **Test's bench strip** reads *Proven · Noise floor · Safe stack · Instruments read*, not the
   comp's *READINESS · AVG FPS · 1% LOW · SAFE STACK*. The handoff itself calls those "the older
   duplicated Health metrics shown in an early generated draft". Moving Health's verdict into Test
   was refused and is now guarded against in `lab-console.test.tsx`.
2. **Health's h1** names the flagged check rather than printing the comp's generic "One thing needs
   your attention". The comp is one machine-state snapshot; the h1 varies with state.
3. **Live's trace** is the live 1 Hz buffer, not a persisted per-sample series. **Unfixable inside
   this brief** — it would need a new backend data source, which #49 forbids.

## Verification already on the record (re-run, don't trust)

```
npm run build          # tsc && vite build — the typecheck of record. EXIT 0.
npx vitest run         # 369 files, 4948 passed, 6 skipped. EXIT 0.
node scripts/verify-release-state.mjs    # 31 citations: 31 ok, 0 drift, 0 broken
npx vitest run scripts/markdown-link-guard.test.mjs      # 5 passed
powershell -File scripts/doc-budget.ps1                  # ALL PASS
```

`npx tsc --noEmit` returns a **false green** in this repo — several guards resolve paths
repo-root-relative rather than from `__dirname`. `npm run build` is the typecheck.

Guards added or strengthened on this branch, worth auditing for whether they can actually fail:
`comp-fidelity-guard.test.ts` (+3 cascade guards that walk **every** `.css` under `src/`),
`readiness-attention-label-guard.test.ts`, `mono-law-guard`, `a11y-census-guard`, `one-hero-guard`,
`type-scale-guard`. The three cascade guards exist because round 14's single-file source-text guard
read `flex-wrap: nowrap` in `shell-v2.css`, passed green, and shipped a broken room — **a
source-text guard cannot see a cascade.** If you find a guard that cannot fail, that is a finding.
