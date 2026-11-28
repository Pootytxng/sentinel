# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

This repo is **single-context**: one `GLOSSARY.md` at the root, and ADRs in `docs/adr/` once the first one is written. `src/` (React/TypeScript) and `src-tauri/` (Rust) are two halves of one application, not two contexts.

## Before exploring, read these

- **`GLOSSARY.md`** at the repo root, or
- **`GLOSSARY-MAP.md`** at the repo root if it exists: it points at one `GLOSSARY.md` per context. Read each one relevant to the topic.
- **`docs/adr/`**, once it exists: read ADRs that touch the area you're about to work in. In multi-context repos, also check `src/<context>/docs/adr/` for context-scoped decisions.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached through the grilling flows, `/triage`, `/wayfinder`, and `/improve-architecture`, or directly) creates them lazily when terms or decisions actually get resolved.

## The domain docs that already exist

`GLOSSARY.md` holds the project vocabulary. `docs/adr/` doesn't exist yet; until it does, decisions live in the documents below. Where the glossary and these documents disagree, these win and the glossary gets fixed:

- **`CLAUDE.md`** (auto-loaded): product brief, locked safety rules, module map. **`docs/RELEASE_STATE.md`** is authoritative on what is built and released; **`docs/QUEUE.md`** is the work list.
- **`docs/PRODUCT_CONSTITUTION.md`**: product identity; §38 wins over earlier sections.
- **`docs/ARCHITECTURE_LOCKS.md`**: plays the role `docs/adr/` plays elsewhere. Treat a lock as an ADR you may not silently override; crossing one needs the owner.
- **`src-tauri/CLAUDE.md`**: read-only half of the Rust module map.

Two live vocabulary rules: the product is **Compy**, not Sentinel (the repo, crate and pre-2026-06-04 history still say `sentinel`, which is expected), and the user-facing room names are the rail labels: **Health · Games · Problems · Live · History · Test** (source: `HOME_RAIL` in `src/design/homeRail.ts`, via `railFor(true, true)`), never the nav ids `home`/`play`/`learn`/`lab`. The retired room names Home, Monitor, Blackbook and Lab are guarded by `src/room-name-copy-guard.test.ts`.

## File structure

Single-context repo (most repos):

```
/
├── GLOSSARY.md
├── docs/adr/
│   ├── 0001-event-sourced-orders.md
│   └── 0002-postgres-for-write-model.md
└── src/
```

Multi-context repo (presence of `GLOSSARY-MAP.md` at the root):

```
/
├── GLOSSARY-MAP.md
├── docs/adr/                          ← system-wide decisions
└── src/
    ├── ordering/
    │   ├── GLOSSARY.md
    │   └── docs/adr/                  ← context-specific decisions
    └── billing/
        ├── GLOSSARY.md
        └── docs/adr/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `GLOSSARY.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders), but worth reopening because…_
