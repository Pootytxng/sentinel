# user-hooks — mirrors of hooks that must live in `~/.claude/`

These files are **not loaded from here.** They are the versioned copy of hooks installed at
`C:\Users\Kuya\.claude\hooks\`, mirrored into the repo so they are reviewable, testable and
restorable if that profile is lost.

A hook belongs here — rather than in `.claude/hooks/` — only when it guards something that a
project-level hook cannot guard by construction. Today that is one file:

| file | guards |
| --- | --- |
| `unloaded-project-config.mjs` | editing a project whose CLAUDE.md / settings / hooks did **not** load, because the session is rooted elsewhere. A project hook cannot warn about this: it is one of the things that failed to load. |

**Install / re-install:**

```bash
cp tools/entry/user-hooks/unloaded-project-config.mjs ~/.claude/hooks/
```

`unloaded-project-config.test.mjs` (one directory up) tests behaviour against the mirror and pins
the installed copy equal to it, so drift in either direction fails the build.
