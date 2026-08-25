# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the
codebase. **Layout: single-context** (one `CONTEXT.md` + `docs/adr/` at the repo root).

## Before exploring, read these

- **`CONTEXT.md`** at the repo root (the domain glossary).
- **`docs/adr/`**: read ADRs that touch the area you're about to work in.

If either doesn't exist yet, **proceed silently**. Don't flag their absence; don't suggest creating
them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and
`/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

```
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-....md
│   └── 0002-....md
└── src/
```

## This repo's pre-existing canonical docs

`CONTEXT.md` and `docs/adr/` do not exist yet. Until they do, the load-bearing sources of truth are
`CLAUDE.md` (product identity, LOCKED safety rules, module map), `docs/ARCHITECTURE_LOCKS.md`
(frozen architectural boundaries — the closest thing this repo has to ADRs), and
`docs/RELEASE_STATE.md` (live gate state). A new `CONTEXT.md` or ADR must not contradict those; if
it would, that is the conflict to surface, not to silently resolve.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a
test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly
avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language
the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR (or a lock in `docs/ARCHITECTURE_LOCKS.md`), surface it
explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders), but worth reopening because…_
