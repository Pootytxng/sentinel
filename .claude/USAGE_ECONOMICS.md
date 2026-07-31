# Usage economics — subagent, workflow, session, and self-review rules

> Owner directive 2026-07-02, from a usage-source audit. **This file is the single authoritative
> source for every context/token-window number in the repo (2026-07-18 correction).** It used to
> describe itself as a "mirror" of the machine-local memory `usage-economics-subagent-session-rules`
> that "must be kept in sync" — that framing was backwards: a git-tracked doc that travels with the
> repo cannot drift out of sync with a machine-pinned file the same way the machine-pinned file can
> drift from it. **This doc is canonical. The local memory is a cache of it, not a co-equal source.**
> If they ever disagree, this file wins, full stop — no reconciliation needed, no "newer directive"
> judgment call.
>
> The audit: 72% of burn came from sessions above 150k context; 53% from subagent-heavy sessions;
> the Workflow tool alone was 22%; /self-review passes 13%. The burn is structural — long sessions
> and uncontrolled subagents, not the work itself. Extends the token-awareness governance rule
> (the 2026-06-25 lane-fleet burn) from loop structure to session/subagent structure.

## 1. Subagent split

**Main agent = planning + implementation. Subagents = verification, search, review, and risk
checks ONLY.** Worth spawning: audits, repo-wide search, diff review, test/log checks,
requirements comparison, regression hunts, release validation, security review. NEVER spawn for:
small edits, one-file fixes, obvious refactors, formatting, simple bug fixes, explanations, or
anything the main context already covers. Never fan out subagents just to "think harder."

The project reviewer agents are pinned to a cheaper model for this reason
(`.claude/agents/*.md` → `model: sonnet`), as is the self-review rubric
(`.claude/skills/self-review/SKILL.md` → `model: sonnet`). Note: a skill's model override
applies for the REST of the current turn — run /self-review at the checkpoint (its intended
cadence), not mid-build.

## 2. Workflow tool — the biggest named sink

Use it only for genuinely multi-step repo-wide work (the audit/sweep class), never normal edits.
Even when an ultracode session-flag says "use Workflow on every substantive task," this owner
directive OVERRIDES it: default to solo main-agent work; workflows only where separation
genuinely reduces mistakes.

## 3. Session length — the #1 lever

Compact around 80–120k context; avoid working above 150k. The auto-compact window in
`.claude/settings.json` was set to 150000 to enforce that — not a technical ceiling (Opus's real
window is far larger), a deliberate quality/cost target: smaller working sets mean less "lost in
the middle" degradation on long threads, on top of the direct token savings.

⚠️ **Both numbers in this paragraph are UNDER TEST on `feat/user-feedback-lab-recovery`, where the
window is provisionally 300000 — see §7.** The 150k ceiling was never empirically re-derived, and a
measured session at 150000 spent 2.17M output tokens across **58 boundaries in 18.8 hours** while its
peak single request only reached ~119k. That is the case for testing the ceiling rather than
restating it. §7 is a bounded experiment with a pass/fail condition, **not** a new default: on every
other branch, and unless and until §7 concludes, the numbers above stand as written.
Refresh is now automatic (§5) — don't manually `/clear`/`/compact` unless the driver prompt says
"NO REFRESH." Don't keep one giant thread alive because it "knows everything"; persist state to
disk (BACKLOG/spec/handoff) instead, per the context-size-advisor hook's own instruction.

## 4. /self-review at checkpoints, not per-edit

Reconciled with the standing visual-review law (always-self-review-visual-work / bug-becomes-
guard): the law binds before *claiming UI work done / committing / reinstalling* — so batch UI
edits and run ONE self-review pass at that checkpoint (before commit, before build/package,
before handoff, after a risky architectural change), not after every minor file edit or during
exploratory iteration. The PostToolUse hook nudge is a reminder for the checkpoint, not a
per-edit obligation. **Rigor unchanged** — the pass still happens before anything is called done.

## 5. The single set of numbers (2026-07-18 reconciliation)

A 2026-07-18 audit found five different context-size numbers scattered across five files with no
file deferring to another. Reconciled here — every other file (hooks, skills, specs) should either
match these exactly or point back to this section rather than restate its own copy:

| Name | Value | Meaning | Lives in |
|---|---|---|---|
| Handoff target | 80–120k | Ideal working range (§3, unchanged) | this doc only |
| Ceiling | 150k | "Avoid working above" (§3, unchanged) | this doc only |
| `CLAUDE_CODE_AUTO_COMPACT_WINDOW` | **300000 on `feat/user-feedback-lab-recovery` (§7 trial, provisional); 150000 elsewhere** | The one literal env-var value; native auto-compact fires a **fixed ~32k reserve below** it — measured, not estimated: ≈269k at 300000, ≈118k at 150000 (§7 verdict). The old "~92–95%, ≈276–285k / ~140k" was an estimate measurement disproved | `.claude/settings.json` — the ONLY place this literal should be set. Project-level only; the global `~/.claude/settings.json` does not set it |
| Advisor warn threshold | 85% of the window above, computed at runtime | When the Stop hook injects a persist-to-disk instruction | `.claude/hooks/context-size-advisor.mjs` — reads the env var, does not hardcode a copy |
| Audit red-flag | the effective window above, **derived at runtime — no literal** | Sanity check only — should never be reached if auto-compact is working; a peak above the window means compaction failed to fire, not a target to approach. The report prints the resolved window + its source, so the basis is never guessed | `scripts/lib/compaction-window.mjs` (resolver + flag), consumed by `scripts/usage-audit.mjs`; guarded by `scripts/compaction-window-guard.test.mjs` |
| Autopilot continuation cap | 2 | Hard code clamp (was: unenforced doc convention) on how many tasks autopilot chains in one session, so it can't manufacture a >150k context on its own | `.claude/hooks/stop-continue.mjs` (`MAX_CONTINUES`) |

Unrelated metric that used to be confused with the audit red-flag above (they were both "200k" until
2026-07-29): `docs/LANE_WORKFLOW.md`'s **~200k output tokens per shipped burst item** — a
cost-estimation constant for sizing parallel build bursts, nothing to do with context-window size.

## 6. Code-enforced guards (2026-07-18, round 2 — closing the "policy-only" gaps)

The 2026-07-18 audit's remaining open items were all policy sentences with nothing checking them
in the moment. Two are now real code, one is fixed, two are named honestly as still open rather
than papered over:

- **Autopilot continuation cap — FIXED (§5).** `MAX_CONTINUES=2` hard-clamped in
  `stop-continue.mjs`, closing the exact gap the 2026-07-01 spec flagged as unenforced.
- **Subagent model-routing override — NOW ENFORCED.** `.claude/hooks/subagent-model-guard.mjs`
  (PreToolUse on the `Agent` tool) denies any call whose `model` field requests opus/fable
  outside the one documented exception (`web-design-director`, opus). Verified against the real
  Claude Code Agent-tool schema (`prompt`/`description`/`subagent_type`/`model`), not guessed —
  live-tested: denies an opus override on `rust-tauri-reviewer`, allows it for
  `web-design-director`.
- **Subagent spawn frequency/necessity — ADVISORY ONLY, by design.** "Should this have been a
  subagent" is a judgment call a hook can't make from a JSON blob, so
  `.claude/hooks/subagent-throttle.mjs` (PreToolUse on `Agent`) counts spawns per session and
  injects a reminder (via `additionalContext`, not `permissionDecisionReason` — the latter isn't
  delivered to the model on an "allow" decision, verified against the current hooks reference)
  every 3rd spawn, pointing back to the §1 worth-spawning list. It never blocks. This is a real
  improvement over pure hope, but it is not enforcement — a session can still ignore the reminder.
- **Persist-before-compaction — NOW VERIFIED, not just instructed.** `context-size-advisor.mjs`
  used to tell the model to persist state but never checked it happened. It now compares the
  latest mtime of `docs/BACKLOG.md` and `docs/superpowers/{specs,plans}` against the last time it
  fired in the same growth-cycle; if nothing changed, the injected reason escalates from a
  reminder to "step 1 below is not optional this time." Still can't verify the persisted content
  is actually *sufficient* to resume from cold — only that something was written.
- **Boot tax — FIXED (2026-07-22, owner-approved tier-1 archive).** `docs/BACKLOG.md` had grown
  to 128 KB — past the usage-audit skill's 120KB flag — at exactly its 12-cycle retention cap,
  so the excess was completed non-cycle content living past the rolling window. The judgment
  pass this bullet used to defer was made and owner-approved: five sections verified
  complete/superseded (TOOLCHAIN pack · TOP PRIORITY LANE · Branch-integration health · UI
  SLIM-DOWN TRAIN · the stale Bottom line) moved verbatim to `BACKLOG_ARCHIVE.md` with one-line
  pointers left — ~21 KB off the board, back under the flag (107 KB). Remaining size is inherent
  cycle-log verbosity; next lever if it regrows past the flag: Phase-A detail (~37 KB, needs
  cross-reference re-pointing first — its Phase-D row and closure note cite lines inside it).
- **The 150k window number itself is inherited, not re-derived — NOW UNDER TEST (§7).** It was set
  2026-07-02 from that period's burn pattern; nobody re-tested whether 150k is the right cutoff for
  the current model. Internally consistent (§5), never empirically re-proven optimal. §7 is the
  first attempt to actually measure it instead of inheriting it.
- **`docs/LANE_WORKFLOW.md`'s "Workflow tool" — CONFIRMED + GUARDED (2026-07-22).** The live
  PreToolUse `tool_name` is `Workflow`, captured empirically via a temporary catch-all logging
  hook + a no-op workflow run (0 agents), not assumed. Now guarded:
  `.claude/hooks/workflow-usage-guard.mjs` (PreToolUse, matcher `Workflow`) injects the §2
  reminder on every call — advisory like `subagent-throttle.mjs`, since "was this workflow
  warranted" is judgment, not mechanics. Live-fired in-session: the reminder reached the model.
  Unlike the Agent-tool guards above, which were verified against the documented schema before
  shipping, a matcher here would be a guess — per the project's own no-speculation rule, it was
  deliberately NOT built. To close this: in a live CC session, run a Workflow-tool call once and
  check `tool_name` in the hook debug log (`--debug`) or via a temporary catch-all PreToolUse
  logging hook, then wire the real matcher.

## 7. The 300k window trial (2026-07-29, `feat/user-feedback-lab-recovery` only)

**Status: DECIDED 2026-07-31 (issue #19) — KEEP, as a named non-default policy. See §7.1 for the
verdict, the measured cost, and what still is not proven.** The text below records the experiment as
it was designed; §7.1 is what it returned.
`CLAUDE_CODE_AUTO_COMPACT_WINDOW` is `300000` in this branch's `.claude/settings.json` and `150000`
everywhere else. Nothing about the trial makes 300000 correct; it makes it *measured*. Work Control
issue **#15**.

Held unchanged by the trial: `model` (`opus[1m]`), the effort setting, `CLAUDE_CODE_SUBAGENT_MODEL`
(`sonnet`), and the global `~/.claude/settings.json` — which never set the window at all, so this is
purely a project-level change.

### Preserved baseline — measured at 150000

| Metric | Baseline |
|---|---|
| Compaction boundaries | 58 |
| Duration | 18.8 hours |
| Boundary rate | ≈ 7.4 / hour |
| Output tokens | 2.17M |
| Peak observed request | ≈ 119k |

This baseline is the trial's control. **Do not overwrite it** — replacing it with trial numbers
destroys the comparison and leaves a doubled window justified by nothing.

### What the trial measures

1. **Boundaries/hour during implementation** — against ≈7.4/hr.
2. **Output tokens per completed stage** — cost per unit of work, not raw session total (a longer
   session at a bigger window can spend more in total while spending less per stage).
3. **Repeated file reads** — re-reading the same file after a boundary is the direct cost of a
   boundary; fewer boundaries should cut it.
4. **Factual drift after compaction** — whether post-compaction state assertions stay true.

**Pass/fail is not token-only: a drift regression fails the trial no matter how many tokens it
saves.** Compy's honesty rules are the product; a cheaper session that misremembers gate state is a
loss, not a saving. Likewise §1/§2/§4 (subagent split, Workflow restraint, checkpointed self-review)
are untouched — a bigger window is not licence to run longer without persisting state to disk.

### Known inconsistencies this trial exposes (named, not papered over)

- **The advisor is already correct.** `context-size-advisor.mjs` reads the env var at runtime and
  warns at 85%, so the warn point moves to ~255k on its own. Its `|| 150_000` is a fallback for a
  missing env var, not a second copy of the number. No hook edit was needed or made.
- **~255k warn vs the 150k ceiling (§3) is a real, deliberate contradiction during the trial.** The
  ceiling is the hypothesis under test; measure 1–4 decide whether it returns as written, moves, or
  is retired. Until then §3's ceiling stands off-branch.
- ~~`scripts/usage-audit.mjs`'s `200_000` red flag is wrong for a 300000 window~~ — **FIXED
  2026-07-29 (issue #16).** The flag now derives from the effective window
  (`scripts/lib/compaction-window.mjs`: env → project settings → documented 150000 fallback, invalid
  values ignored *and* reported), the report prints the resolved window + source, and
  `scripts/compaction-window-guard.test.mjs` holds the three owner-named cases. The interim
  "read >300k not >200k" human rule is retired — the instrument reads correctly on its own.
- **The 300000 window only applies to sessions ROOTED in this worktree.** Measured 2026-07-29:
  a session rooted in `C:\Users\Kuya\code\sentinel-rel` (editing `sentinel-feedback` by absolute
  path) runs with `CLAUDE_CODE_AUTO_COMPACT_WINDOW=150000` — `sentinel-rel`'s own project settings
  win, because the value is injected from the session's root project, not from the files being
  edited. **A trial session must therefore be launched with `sentinel-feedback` as its working
  directory, or measures 1–4 record the 150000 control, not the experiment.**
- **`.claude/hooks/` is gitignored (`.gitignore:49`) and absent from the `sentinel-feedback`
  worktree** — the hooks exist only under `C:\Users\Kuya\code\sentinel\.claude\hooks\`. Auto-compaction
  is native and env-var-driven, so **the trial is valid here**, but the advisory Stop-hook nudge and
  the autopilot continuation cap do not fire in this worktree. Persisting state to disk before a
  boundary is therefore a manual discipline here, not a prompted one.
- **`docs/superpowers/specs/2026-07-01-token-routing-protocol.md:93` still reads "currently 150000."**
  Left as-is: that section is already marked ⚠️ SUPERSEDED and defers to this file's §5 for the current
  number in the same sentence, and `docs/` is outside #15's claimed scope. This file stays the single
  reconciled home for the window value.

### 7.1 Verdict — KEEP as a named non-default policy (issue #19, 2026-07-31)

**Window provenance, proven four ways** — a trial that cannot prove its own window is what
invalidated #14: env `CLAUDE_CODE_AUTO_COMPACT_WINDOW=300000` · this branch's `.claude/settings.json` `300000` ·
`context-policy.json` grants 300000 to #15/#16/#19 with `default: 150000` · and **the behaviour
itself** — compaction fired at 268–270k, which is impossible under a 150000 window. Provenance by
measurement outranks provenance by configuration.

| Measure | 150k baseline (§7) | 150k control B | **300k trial** |
|---|---|---|---|
| Compaction boundaries | 58 | 10 | **3** |
| Duration | 18.8 h | 2.0 h | 15.9 h |
| Boundaries / 100k output | 2.67 | 4.63 | **0.70** |
| Output per compaction cycle | 36.8k | 20k | **108k** |
| Peak observed request | ≈119k | 117k | **267k** |
| First native compaction | — | 120,028 | **269,363** |
| Re-reads after a boundary / 100k out | — | 18.5 | **1.4** |
| Cache-read per turn | — | 91k | **158k** |
| Cache-read per 100k output | — | 12.08M | **15.35M** |
| Factual-drift regression | — | none | **none** |

Control B is the #18 correction train (`sentinel-workflow`, 2026-07-30, 150000) — an independent
second 150k sample, not a substitute for the preserved baseline.

**The finding that decides it: the compaction reserve is fixed, not proportional.** ~32k is withheld
whatever the window, so 150000 yields ~118k usable (79%) while 300000 yields ~269k (90%). Doubling
the window multiplies *usable* context by **2.27x**, not 2.0x. Constants and guard:
`scripts/lib/compaction-window.mjs` + `scripts/compaction-trigger-guard.test.mjs`.

**What it buys:** 4–7x fewer boundaries per unit of output, ~13x fewer post-boundary re-reads, 3–5x
more completed work per stage. Concretely, control B re-read one 26-page spec **15 times**; the trial
re-read its worst file 3 times.

**What it costs — stated because it is not free:** +27% cache-read per unit of output (15.35M vs
12.08M per 100k). That decomposes cleanly: 1.74x more context carried per turn against 1.37x more
output per turn. Cache-read is the #1 spend driver, so **300000 is more expensive per unit of work,
not cheaper.** It buys coherence, not savings, and the rework it avoids is already netted out of that
number.

**Therefore KEEP, and explicitly NOT adopt.** `default` stays `150000`. 300000 is granted per issue
in `tools/entry/context-policy.json`, each grant a recorded decision — which satisfies "no accidental
global rollout" by construction, since a train can only get 300000 by being named. Qualifying shape:
long single-context trains where one thread must hold design → implementation → verification. Short
or mechanical trains gain nothing and pay the 27%.

**Why not "adjust to a new measured target": no third window has been measured.** A 200000 or 250000
recommendation would be an unmeasured claim, and the honest-measurement law forbids it. If a finer
optimum is wanted it needs its own trial; the fixed-reserve model now makes that cheap to predict but
prediction is not measurement.

**Not proven, named rather than papered over:**

- **Acceptance criterion 1 is unmet in form.** The measured session was not a fresh `#19` session: it
  began 2026-07-30T11:23Z on #14, ran #18's design, and was resumed onto #19 after its 3 boundaries
  had already occurred. The window is proven by behaviour, so the substance holds — but the ceremony
  the criterion asked for did not happen, and the verdict rests on retrospective data.
- **The two samples are not a controlled experiment.** They differ in work type as well as window.
  The re-read and boundary mechanisms are causal and survive that; the +27% cost figure is
  directional, not precise.
- **Factual drift stays the one un-mechanized measure.** No regression was recorded in either arm,
  but 3 boundaries is a small sample and "no drift observed" is weaker than "no drift occurred".
- **The audit's peak-context flag judges every session against one window.** Sessions that ran at
  150000 are measured against 300000, so a 150k session peaking at 214k is invisible. That is a false
  *negative*, not a false warning — the trial session itself (267k) is correctly unflagged, so
  criterion 4 holds — but per-session window attribution (derivable from each session's own boundary
  points) is a real follow-up, not done here.
