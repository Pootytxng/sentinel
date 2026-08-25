# Durable release receipts (issue #199)

One JSON file per published release, named by its tag: `v0.9.30.json`.

**Why this directory exists.** `docs/RELEASE_STATE.md` used to cite release-transaction journals as
the re-verification evidence for its "transaction complete, 9 of 9" claims. Those journals are
written under `src-tauri/target/release/bundle/nsis/`, which `src-tauri/.gitignore:3` ignores by
construction — so no journal has ever been committed, and `target/` has since been cleaned. The
nine INTERNAL pipeline stages of every past release are therefore not re-verifiable by anyone.
GitHub still proves publication, assets, asset hashes, manifest hash and release identity; it
cannot know about the stages.

**What is here and what is not.** Files appear only for releases published after
`scripts/emit-release-receipt.mjs` landed (2026-08-25). #199 is explicit: *"Do not fabricate or
regenerate historical journals."* This directory will never contain a receipt for v0.9.26 or
anything before it, and the claims about those releases carry an honest not-re-verifiable caveat in
the matrix instead.

**How a file gets here.** `scripts/release.ps1` runs the emitter after the transaction completes and
before it prints `PUBLISHED:`. The emitter derives a sanitized summary from the journal plus the
signed staged receipt — version, tag, source commit, release id, installer name and hashes, the
stage list, and a SHA-256 of the journal bytes. It refuses to write anything containing a path, a
UNC share, an environment expansion, a `file://` URL, or this machine's user name or hostname. The
operator commits the file in a follow-up commit; a failure to emit is a loud warning, never a
release failure, because publication has already happened by then.

**What enforces it.** `scripts/release-receipt-guard.test.mjs`: every stage-completion claim in
`docs/RELEASE_STATE.md` must either be backed by a receipt here for every version it names, or say
in the same breath that it is not re-verifiable and cite #199.
