# Resumable release transaction

This document is the technical companion to [RELEASE_AUTONOMY.md](RELEASE_AUTONOMY.md). The policy
defines authority and owner boundaries; this document defines the publication state machine.

## Production path

`scripts/release.ps1` validates the signed staged receipt, constructs the production adapter in
`scripts/lib/release-publish-adapter.ps1`, and executes
`Invoke-ReleaseTransaction` from `scripts/lib/release-transaction.ps1`.

The fixed order is:

1. `receipt_verified`
2. `runtime_proved`
3. `source_main_pushed`
4. `source_tag_pushed`
5. `releases_tag_created`
6. `draft_created`
7. `draft_assets_verified`
8. `release_published`
9. `public_assets_verified`

`release_published` is the only fleet-visible mutation. The engine refuses it unless the invocation
explicitly carries publication authority, and its position is statically guarded.

## Journal contract

Each candidate uses `release-transaction-vX.Y.Z.json` beside its staged receipt. The journal is
bound to:

- receipt schema;
- version and full release commit;
- immutable source tag;
- installer SHA-256;
- updater-signature SHA-256; and
- manifest SHA-256.

Completed stages must form an exact, duplicate-free prefix of the fixed stage list. Writes use a
same-directory temporary file followed by replacement. A different binding, malformed journal,
duplicate stage, or out-of-order stage is fatal and is preserved for diagnosis.

The journal is evidence, never authority. Every invocation inspects the actual installed payload,
Git remotes, GitHub objects, downloaded assets, public manifest, and cryptographic bindings again.
A journaled stage whose real state is absent or incompatible is fatal. Compatible state created by
an earlier interrupted attempt is adopted only after re-verification.

## Retry rules

- Source `main` may be the exact release commit or a descendant containing it. A fast-forwardable
  older remote may be advanced. Divergence is fatal.
- The remote source tag must be the exact annotated tag object and peel to the receipt commit.
- A releases-repository tag may be created only after a confirmed HTTP 404. Authentication,
  permission, rate-limit, network, timeout, empty, and malformed results are fatal.
- An existing draft must match tag, title, notes, prerelease state, and receipt source.
- Present draft assets are downloaded and byte-verified. Missing assets are uploaded individually;
  partial exact uploads resume without overwrite. Any mismatch, duplicate, or foreign asset is fatal.
- Publication occurs only after exact draft-asset verification.
- Public verification downloads the tag-specific installer and manifest plus the fleet `latest`
  manifest, checks receipt hashes and manifest binding, and verifies the updater signature.

No retry moves a tag, replaces source history, rebuilds a receipt-bound artifact, clobbers an asset,
or treats an unreadable external result as absence.

## Offline integration proof

`scripts/release-transaction-harness.ps1` runs the production transaction engine and adapter with a
complete injected sandbox backend. It uses temporary files and real PowerShell 5.1 native children;
it never contacts production GitHub, changes the installed app, reads the real signing key, or
touches the public manifest.

The suite covers first-publish 404, every compatible resume boundary, failure after an external side
effect but before journaling, partial asset upload, authentication/permission/network failures,
source-tag and artifact mismatches, signature failure, public collision/version disagreement,
downloaded draft/public byte mismatch, owner-boundary refusal, journal binding/tamper/order failures,
and a complete first-publish transaction.

`scripts/production-adapter-native-sandbox.ps1` additionally drives all nine real production adapter
handlers through fake native Git/GitHub transports, then retries from a source-main descendant and
proves that no mutation repeats. Its production-handler fault matrix covers authentication,
permission, network, source-tag, receipt-hash, updater-signature, collision, and downloaded-asset
mismatches.

`scripts/release-powershell-static-guard.mjs` scans the full production PowerShell surface. Its
self-test injects both historical `NativeCommandError` patterns and proves they fail the guard.
