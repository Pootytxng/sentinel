# The shell guard reads a variable whose value is on the same line (#373)

**Status: OWNER-HANDS.** The change is one patch, next to this file:
`docs/superpowers/specs/2026-09-04-shell-guard-knowable-vars-373.patch`. The auto-mode classifier
refuses a session any edit to a hook that gates its own authority (the owner's standing hard-deny,
same as spec `2026-08-21-unverified-session-write-refusal.md` §8), so a session cannot apply it.
`tools/entry/shell-ownership-assert.test.mjs` pins that the patch still applies to the hook as it is,
and that the assertions it unlocks stay visibly **skipped** until it lands — never vacuously green.

## 1. What is measured

Transcript hook decisions for 2026-09-03 → 2026-09-04, every `PreToolUse:Bash` that was not
`allow`: 40. Of those, 33 came from `.claude/hooks/shell-ownership-assert.mjs` returning `ask`
because a write operand was "not knowable from the text", and in every one of the 33 the operand was
a `$S`, `$TEMP`, `$LOCALAPPDATA` or `$APPDATA` path — a value stated in an assignment earlier on the
same line, or a directory the process environment names. The lexer reads `$` and stops. That is the
stream of prompts the owner was pressing *Allow* on in his other session.

## 2. The change

`analyze()` runs one pass before lexing — `expandKnownVars(text, { env, dialect })` — that replaces
a variable with its value when, and only when, the value is already stated:

1. a plain assignment at the head of a statement (`S=…`, `export S=…`, `local S=…`) whose value is
   itself fully known teaches a name; `S=$(…)`, `S=$OTHER` with `OTHER` unknown, `read S`, and every
   other binding form leave it unknown — so `rm -rf $TARGET` still takes the approval path;
2. the environment is read for six directory names only (`TEMP`, `TMP`, `LOCALAPPDATA`, `APPDATA`,
   `USERPROFILE`, `HOME`), and only when the value is an absolute path; `$PATH`, `$RANDOM` and every
   user variable stay unknowable;
3. single quotes are honoured (`'$S'` is the text `$S`); heredoc bodies are stripped first, so a line
   inside one cannot teach a name;
4. PowerShell is untouched — `$env:TEMP` and `$s = …` have their own rules and no measured cost.

A name resolved this way is then judged exactly as the literal would be: `WT="…/sentinel";
rm "$WT/package.json"` is a **deny** into a sibling checkout, where before it was an `ask`.
`decideShell` passes its existing `env` through; nothing else in the decision changes.

## 3. How to apply (owner)

From a terminal at the repository root:

```bash
git apply docs/superpowers/specs/2026-09-04-shell-guard-knowable-vars-373.patch && git rm -q docs/superpowers/specs/2026-09-04-shell-guard-knowable-vars-373.patch && npx vitest run tools/entry/shell-ownership-assert.test.mjs
```

Then tell any session: *"commit the applied #373 patch"*. The test that pinned the patch flips to
demanding its absence, and the nine assertions under "once applied" start running.

## 4. Proof before landing

The patched hook was exercised in a scratch mirror of `.claude/hooks/` + `tools/entry/` with the
same test file (the mirror is the only place a session may run the patched code); the in-repo run
shows the "once applied" block skipped and the apply-check green. Both runs are quoted on the PR.
