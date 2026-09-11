# Compy — handoff, end of 2026-08-12

Paste this into a fresh session. It is written to be read cold.

---

## READ THIS FIRST

1. `project_read claude/HQ_DECISION_LEDGER.md` — standing laws, owner directives, ship procedure,
   known flakes. It overrides your defaults.
2. `project_read claude/COMPY_MARATHON_PLAN.md` — the sprint this all came from.
3. On the machine: `docs/RELEASE_STATE.md` is the authoritative state doc. **Never assert current
   state from memory — run `node scripts/verify-release-state.mjs --strict` first.**

Repo `C:\Users\Kuya\code\sentinel`, branch `main`. Reach it from Cowork with the **Desktop Commander
MCP** (`start_process` / `read_process_output`; no folder grant needed). Poll in ≤55s slices — the
bridge times out at 60s.

---

## WHERE THINGS STAND

**Published to the fleet: v0.9.17** (`a614744c`, release id 369614201, transaction 9/9).
**Owner's desk also runs v0.9.17.**

All four marathon trains are done:

| Train | What | State |
|---|---|---|
| 1 | Add-a-part form reachable by a real user | shipped + published |
| 2 | Room renames Blackbook→**History**, Lab→**Test**, Monitor→**Live** | shipped + published |
| 3 | Compy Care — the always-on crash-rescue entry on Home (visible half) | shipped + published |
| 4 | Fleet publish | discharged twice (v0.9.15, then v0.9.17) |

The fleet had been stuck on v0.9.12 from Aug 3. It is current now.

### Landed on main AFTER v0.9.17 was published — NOT yet in any build

These three are on `main` and green, but no installed or published build contains them:

1. **The Home intake band is now DEFAULT OFF** (`4d1afa92`). Owner saw it on a real build and said
   "the what are you here to do text box was ugly looks cleaner without it". `readHomeIntake` is now
   `=== "1"`. The one-tap fast path leaves Home with it (it still lives in Test → Optimize). Crash
   rescue does **not** leave — that is guarded.
2. **The popout's modal contract is guarded** (`b44ec358`) — `sheet-contract-guard.test.tsx`, 17
   cases. It had zero before.
3. **The three popouts are converged onto one** (PR #119, merged as `6e7d9669`). `ActionDrawer` and
   the hand-rolled apply-all popout in `Fix.tsx` are deleted; both now render the canonical `Sheet`.
   `Sheet` gained one option, `dismissible`, so a consent panel can refuse to close mid-apply.

**→ The next desk ship carries all three. That ship has not happened.**

---

## DO THIS NEXT, IN ORDER

### 1. Ship a desk build and LOOK at it (highest priority)

Three user-visible changes are unshipped, and one of them — the popout convergence — **has never
been seen by human or model eyes.** The subagent that did it flagged one deliberate visual
consequence: the consent panel no longer inherits the room's HUD "squared-up" skin, because it now
portals out of the room. That is reasoned, not verified.

Ship v0.9.18 to the desk, then **look at it**:

```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9333"
Start-Process "$env:LOCALAPPDATA\Compy\compy.exe"     # wait ~18s
node docs\ui-sweep\cdp-shot.mjs 9333 out.png "optional JS to run first"
```

Copy the PNGs to `C:\Users\Kuya\code\compy-visual-review\` (**Cowork holds a standing folder grant
there**), `device_stage_files` them, then `Read` the image — you can see it.
`navExpr` can set localStorage + `location.reload()` to capture a flag state, or click a rail item
by text to change room.

**Check specifically:** Home with the band gone (does the Care entry still look deliberate with
nothing under it?), and the converged consent popout inside Test → Optimize.

**This step has teeth.** On 2026-08-12 a build passed 326 test files and still looked wrong — the
Care entry had no card treatment and its text was stranded 130px out in open space. Nothing but
looking caught it. **A verification step that has only ever passed has not been shown to be able
to fail.**

### 2. TYPE-1 and COLOR-1 — the actual agreed build order

`docs/decisions/2026-08-11-design-foundation.md` sets a five-step order:
**① type + colour ② the front door ③ the interview ④ wording ⑤ instruments behind a door.**

**None of the five is done.** TYPE-1, COLOR-1 and UX-1 are all still 🔴 OPEN in
`docs/UI_VISION_BACKLOG.md`. The bento conversion — the biggest UI change of the last two days —
was not one of the five steps, and shipped with no plan and no spec doc.

Start at ①. The doc specifies a 6-step type scale with a 13px floor, and rooms giving up their hue.

### 3. Train 3's dark half (issue #91 Tier 1 catalog)

The signed pull-only catalog, Rust-side. **Gated:** `docs/ARCHITECTURE_LOCKS.md` §1.8, and "dark
implementation may begin only after PR #90 is merged/dispositioned" — **check #90's state first.**
Nothing of it exists yet: no catalog, no endpoint, no key, no cache.

### 4. Owner decision — the only one live

**Whether to widen the six hand-sent invitees onto the updater path.** Everyone already on the
updater gets v0.9.17 automatically; the six who only ever got the 0.9.0 link must install once by
hand. Every technical precondition is met. This is messaging humans, not readiness — it is his call.

Say with it: **v0.9.17 renamed three rooms a returning tester already learned, and nothing in the
app tells them the names changed.** That is an unaddressed gap.

---

## THINGS THAT WILL BITE YOU

**The desk is shared.** Another lane installed its own branch build over the published one with no
doc-sync, and the version number stayed the same across the swap. `check (7)` caught it by reading
the commit stamp out of the binary. Always run the strict verifier before asserting desk state.

**`release-prove.ps1`'s CDP probe crashes intermittently** — `probe exit -1073740791`, libuv
`UV_HANDLE_CLOSING`. Hit twice today, both times a plain rerun answered on attempt 1. **Retry once
before investigating.**

**`/releases/latest/download/latest.json` can serve a STALE body for minutes after publish** (edge
cache). The versioned `/download/vX.Y.Z/latest.json` is correct immediately. Re-fetch with a
cache-buster before ever calling the alias wrong.

**Run every long pipeline command DETACHED.** The Cowork bridge dropped mid-run three times today.
A detached `Start-Process … -RedirectStandardOutput "$env:TEMP\x.log" -WindowStyle Hidden -PassThru`
survives; an attached one was killed at stage 3 of a 9-stage publish. Pass `-Notes` from inside a
wrapper `.ps1` — `Start-Process -ArgumentList` splits on spaces.

**The branch-disposition audit fails for EVERY lane when ANY origin ref lacks a row** in
`docs/BRANCH_DISPOSITIONS.md`. It blocked this lane twice. Fix: `git fetch --prune` for stale
tracking refs; otherwise write a CLAIMED row from read-only evidence and say in the row that the
owning lane should replace the text.

**PowerShell 5.1 turns stderr into a fake `NativeCommandError`.** A `git push` exiting 1 usually
still pushed. Read the real result lines.

---

## HOW THE OWNER WANTS TO BE WORKED WITH

Verbatim, 2026-08-12: *"please do everything you can yourself if you need me here to just click
something then i will but you do it and proceed"* and *"i permit you to proceed with everything
yourself. and yes you can do it all yourself use your eyes"*, plus standing merge permission:
*"youre allowed to merge you always have my permission to do that"*.

Treat a named blocker as GO **unless** it spends money, names humans, or is irreversible in a way he
has not seen. He keeps no notes — the ledger is the memory. Challenge duty is real: facts over tact,
one default over a menu, never phrase an observation as a to-do for him, and execute instead of
handing him click-paths.

He decides with his eyes, not with arguments. The intake band was argued ON with good reasoning and
then removed on sight in one sentence. **Show him a screenshot before you defend a position.**

---

## STANDING LAWS WORTH NOT RELEARNING

- **Evidence before done.** A claim without named evidence is a guess wearing a claim's clothes.
- **bug → guard.** Every caught defect becomes a permanent guard *before* the fix counts.
- **No new guards without a caught defect** — with one earned exception: an absent guard on a
  contract this repo pins elsewhere (the Sheet vs ConfirmDialog case) is itself the defect.
- **State truth.** `docs/RELEASE_STATE.md` wins over every other doc. Prose that restates a value an
  anchor already carries is drift waiting to happen — point at the anchor instead.
- **Marathon law: product-first.** Governance work belongs in the last 10% of a session.
