# Sub-agent brief template (one per crew)

Fill the angle-bracket slots and hand the whole thing to a `general-purpose` sub-agent. Launch all
crews in ONE message so they run in parallel. Keep each crew's files disjoint from every other crew's.

---

You are test-authoring Crew <X> for "Compy," a Windows gaming-optimizer (Tauri + React/TypeScript).
This is a TEST-ONLY task: you create new test file(s). NEVER modify production source, and NEVER write
into the repo at <repo path> (you may READ from it freely).

## Your target
READ this source first: <repo>/<module path>
It exports: <list the real exports + signatures — read them, don't guess>.
Why it matters: <one line — e.g. "the rollback promise, in data" / "the ms-settings: security allowlist">.

## House conventions (match exactly)
- Start with `import { describe, it, expect } from "vitest";` (add `vi` if you mock).
- Reference style: READ <repo>/src/surfaces/system-posture.test.ts.
- GOTCHA: doctrine guards grep all of src/**/*.{ts,tsx} for banned phrases. Do NOT embed these literals
  anywhere: "probably fine", "nothing to sell you here", "already where it should be",
  "nothing worth fixing today".
- Sibling naming: foo.ts -> foo.test.ts. Append-only; never edit an existing test.

## Assertions to write (~6-10 it() cases)
<the specific assertions — derive concrete expected values BY READING the source>
- Cover the happy path AND the rejection/edge path (a null result proving a guard works is high value).

## Mocking (if the module imports Tauri)
`vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));` then `vi.mocked(openUrl)`.
For `@tauri-apps/api/core`, stub `invoke` similarly. Reset with `beforeEach(() => vi.clearAllMocks())`.

## Where to write
Use the Write tool (or the sandbox mount if Write is scoped to the repo) to create:
<deliverable path>

## Self-verify
A ready test harness is at <mirror path or the repo itself>. Run only your own target:
  <e.g. cd /tmp/cv && npx vitest run src/<subpath>/<file>>
Iterate until GREEN. On any change, edit the DELIVERABLE first, then re-run.

## Return
- Final pass count + confirmation green.
- Any real BUG/edge-case you found in the source (report it; do NOT fix production code).

---

## Notes for the integrator
- Rust crews can't run `cargo` in the Cowork sandbox (no toolchain). They author + statically review;
  runtime verification is pending the in-repo `cargo test --manifest-path src-tauri/Cargo.toml <module>::`.
- Tier crews by stakes. High-stakes (rollback/security/safety) wait for the owner nod; low-stakes
  (pure formatters, parsers) proceed on the Ring-2 green suite.
