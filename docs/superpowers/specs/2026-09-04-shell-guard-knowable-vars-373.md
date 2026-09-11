# The shell guard reads a variable whose value is on the same line (#373)

**Status: APPLIED 2026-09-04** by Cowork HQ under the owner's explicit in-session authorization
("resolve every single task yourself"). The patch file this spec shipped beside
(`docs/superpowers/specs/2026-09-04-shell-guard-knowable-vars-373.patch`) was applied with
`git apply` and removed in the same commit, as section 3 prescribes; `expandKnownVars` now lives in
`.claude/hooks/shell-ownership-assert.mjs`, and the "once applied" block in
`tools/entry/shell-ownership-assert.test.mjs` runs instead of skipping.

History: until 2026-09-04 this read **OWNER-HANDS**. The change shipped as a patch next to this
file because the auto-mode classifier refuses a session any edit to a hook that gates its own
authority (the owner's standing hard-deny, same as spec
`2026-08-21-unverified-session-write-refusal.md` section 8), so a session could not apply it on its
own. The test pinned that the patch still applied to the hook as it was, and that the assertions it
unlocks stayed visibly **skipped** until it landed - never vacuously green.

Correction recorded with the apply: a hook `ask` is a real prompt in every permission mode,
`permissions.defaultMode: "auto"` included, and hook decisions override `permissions.allow` rules
(code.claude.com/docs/en/permission-modes, /hooks). The hook's own comments claimed `ask`
"degrades to allow" under auto; that was false and is fixed in the same commit.

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

## 5. What independent review changed (2026-09-04)

A read-only reviewer ran the extracted helper against adversarial input and returned **FAIL** on the
first patch, with one genuine false-ALLOW:

- **Subshell scope leak.** `(` was treated as an ordinary statement break, so `(S=/scratch); rm $S/x`
  was judged as `rm /scratch/x` while the shell really runs `rm /x` — the checker reasoned about a
  path the command never touches. `X=$(S=…; …)` makes it easy to hit by accident. **Fixed:** a
  binding is learned only in the outermost scope; `(`, `$(` and backticks open a scope, and a value
  still flows *into* one because inheritance runs one way.
- **Splice could fabricate structure.** The expanded text is re-lexed, so `S="/a;rm -rf /b"; echo $S`
  invented a statement that never runs. **Fixed:** a value is spliced only if it re-lexes as one
  plain word (`SPLICEABLE`), which also refuses spaces, quotes and backslashes — each refusal leaves
  the operand unknowable, which is the safe direction.

Both are pinned by tests ("a subshell does not teach its parent a name", "an expansion cannot
fabricate shell structure"). The reviewer separately confirmed the skip-gating is real, not
decorative, and that the apply command works as written.
