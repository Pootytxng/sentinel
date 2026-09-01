# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the
codebase. **Layout: single-context.**

## Before exploring, read these

- **`CONTEXT.md`** at the repo root.
- **`docs/adr/`**: read ADRs that touch the area you're about to work in.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest
creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and
`/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.
Neither exists yet as of 2026-08-31 — that is expected, not a gap to fill on sight.

## File structure

```
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-....md
│   └── 0002-....md
└── src/
```

This repo is single-context: one root `CONTEXT.md`, one `docs/adr/`. There is no `CONTEXT-MAP.md`
and no per-package layout, because there are no workspaces — `src/` (React/TypeScript) and
`src-tauri/` (Rust) are two halves of one application, not two contexts.

## The domain docs that already exist

`CONTEXT.md` is not the only source of project vocabulary here, and it is not the authoritative one.
Read these first, and defer to them:

- **`CLAUDE.md`** (repo root, auto-loaded) — the project brief, LOCKED safety rules, and the module
  map. **`docs/RELEASE_STATE.md` is authoritative on current gate state**; `docs/BACKLOG.md` is the
  living status ledger.
- **`src-tauri/CLAUDE.md`** — the read-only half of the Rust module map, auto-loaded for `src-tauri/` work.
- **`docs/ARCHITECTURE_LOCKS.md`** — the standing architectural decisions. In this repo it plays the
  role `docs/adr/` plays elsewhere; treat a lock as an ADR you may not silently override.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test
name), use the term as defined in `CONTEXT.md` — or, until one exists, as defined in `CLAUDE.md`.
Don't drift to synonyms the project explicitly avoids. Two live examples: the product is **Compy**,
not Sentinel (the crate, the WSL path and pre-2026-06-04 history still say `sentinel` — expected);
and user-facing room names are **Health · Live · History · Test**, never the nav ids
`home`/`play`/`learn`/`lab`.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language
the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR or architecture lock, surface it explicitly rather than
silently overriding:

> _Contradicts ARCHITECTURE_LOCKS §1.8 (Capability Exception Gate), but worth reopening because…_
