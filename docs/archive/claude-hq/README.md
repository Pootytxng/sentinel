# Claude-HQ Project documents - archive

**Historical / reference evidence only.** Nothing in this directory is current law, state, priority,
or authorization. It does not override, amend, or reopen any of:

- `docs/PRODUCT_CONSTITUTION.md`
- `docs/ARCHITECTURE_LOCKS.md`
- `docs/RELEASE_STATE.md`
- `docs/WORK_CONTROL.md`
- `docs/product/ROADMAP.md`
- `docs/product/MONETIZATION.md`

Where a document here disagrees with one of those, the live document wins and the archived one is a
record of what was believed at the time. Do not derive current product, release, or work-control
truth from this directory, and do not "fix" an archived file to match today - rewriting a record to
agree with the present falsifies it.

These files are the documents that lived in the Claude Project "Co work Global Project folder (HQ)"
(project paths `claude/*.md`). They are preserved here so the record survives cleanup of that
Project. Filenames are kept exactly as they were in the Project; each dated subdirectory is one
preservation event, so a later version of a same-named file gets its own dated directory instead of
overwriting an earlier one.

Tracked by #415.

## `2026-09-10-pre-cleanup/`

The 27 original `claude/*.md` documents as they stood before the 2026-09-10/11 HQ cleanup, plus the
`MANIFEST.sha256` taken at export time.

- Source: `C:\Users\Kuya\Documents\Compy-HQ-Archive\2026-09-10\` (28 files: 27 `.md` + manifest),
  exported from the Claude Project on 2026-09-10.
- Re-verified 2026-09-11 before copying: 27 OK, 0 mismatch, 0 missing.
- Copied byte-for-byte. These are the originals, not rewritten or current versions. All are LF, so
  the repo's `eol=lf` normalization stores them unchanged.
- Notable: `HQ_DECISION_LEDGER.md` and `HQ_RESUME.md` here are the PRE-split originals; the split
  archives below are later documents, not replacements for them.

Verify from a checkout:

```bash
cd docs/archive/claude-hq/2026-09-10-pre-cleanup && sha256sum -c MANIFEST.sha256
```

## `2026-09-11-ledger-split/`

The two archives produced by the HQ Step-5 split on 2026-09-11, when the live HQ ledger and resume
were cut down and their history moved out:

- `ARCHIVE_HQ_DECISION_LEDGER_2026-09-11.md` (Project path `claude/ARCHIVE_HQ_DECISION_LEDGER_2026-09-11.md`)
- `ARCHIVE_HQ_RESUME_2026-09-11.md` (Project path `claude/ARCHIVE_HQ_RESUME_2026-09-11.md`)

Kept verbatim under their Project filenames.

- Source: `C:\Users\Kuya\Documents\Compy-HQ-Archive\2026-09-11-ledger-split\`, exported from the
  Claude Project on 2026-09-11.
- Copied byte-for-byte; the staged Git blobs were checked against the export before commit. Both are
  LF with no CR and no BOM, so no path-specific `.gitattributes` rule is needed.

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `ARCHIVE_HQ_DECISION_LEDGER_2026-09-11.md` | 80827 | `ebb56f8bda58a041adcac76a8c57a29245f1d363a563d62459dde408139682b5` |
| `ARCHIVE_HQ_RESUME_2026-09-11.md` | 10995 | `9fb4d070bf7e0046065b89128a07d3493a83936fe40a05106516fcdd6118cdb5` |
