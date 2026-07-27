# Task 2 — repository hygiene guard report

Date: 2026-07-26

## Scope completed

- Removed the stale contradiction from `.claude/USAGE_ECONOMICS.md`: Workflow matcher evidence and its wired guard remain documented as empirically confirmed.
- Hardened the hygiene process classifier: it resolves the standalone `claude` application through `Get-Command`, normalizes executable paths, compares them with ordinal case-insensitive equality, skips every nonmatching `claude.exe`, and preserves the no-path, newest-session, and age safeguards.
- Added dependency-free `scripts/markdown-link-guard.mjs` and invoked it from `scripts/repo-hygiene.ps1`; a broken local link now fails the hygiene command immediately.
- Corrected only the six specified archived-document destinations.

## Red to green evidence

After adding the guard and before changing the six Markdown targets, the guard failed exactly as expected:

```text
BROKEN docs/archive/Roadmap.md -> PRD.md
BROKEN docs/archive/Roadmap.md -> PRODUCT_DIRECTION.md
BROKEN docs/archive/Roadmap.md -> RELEASE_STATE.md
BROKEN docs/archive/Roadmap.md -> BACKLOG.md
BROKEN docs/archive/Roadmap.md -> RECEIPTS_DOCTRINE.md
BROKEN docs/archive/cowork-cc-relay/2026-06-15-funnel-golive-todo.cc.md -> src/data/site.ts
markdown-link-guard: FAIL 6 broken link(s) (103 checked)
```

After applying those six target corrections:

```text
markdown-link-guard: PASS 103 local link(s) checked
```

## Link-guard behavior reviewed

The guard uses tracked Markdown paths from `git ls-files`. It handles inline and reference-style links, optional titles, angle-bracket destinations, fragments, URL-encoded path segments, and paths relative to the source document. It ignores external schemes, protocol-relative URLs, fragment-only links, image destinations, data URLs, and fenced-code examples. For a destination with a fragment, it checks the file path only.

## Validation

| Command | Result |
| --- | --- |
| `node scripts/markdown-link-guard.mjs` | PASS: 103 local links checked |
| `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/repo-hygiene.ps1` | PASS: doc budget all pass; link guard pass; all 15 observed nonmatching `claude.exe` processes skipped; no warnings |
| `node scripts/verify-release-state.mjs --strict` | PASS: 24 citations, 24 ok, 0 near-drift, 0 broken, 0 missing sections, 0 state-drift |
| `node .codex/hooks/hooks-selftest.mjs` | PASS: 38 checks passed, 0 failed; POSIX shell leg noted unavailable |
| `git diff --check` | PASS: exit 0 |

## Process-safety review

The process-classification diff was inspected after validation. It has no `Stop-Process`, `taskkill`, or equivalent execution path. The only remaining uses of the word “kill” are human guidance in warning/documentation text. No process was killed or otherwise altered during implementation or tests.

## Self-review

This task changes no UI surface, so the visual self-review skill is not applicable. Manual review confirmed the diff stays within the brief: no runtime source, manifests, capabilities, installer, release gates, networking, telemetry, credentials, or machine settings were changed.
