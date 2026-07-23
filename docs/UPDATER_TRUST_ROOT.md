# Updater trust root

## Current fleet anchor

Compy clients through v0.9.4 that contain the signed updater trust Minisign key
`43711DD10AAB67D7`. The machine-readable anchor lives at
`scripts/updater-trust-root.json`; its public-key SHA-256 is
`a9b2df7ea775a4a3a095791222e781b2629ef2bafa077d2f0e89be99bf50662e`.

Normal staging and publishing must fail if `tauri.conf.json` drifts from this anchor. Changing the
source key and the external private key together is **not** a valid normal release: existing clients
would reject the next update and become stranded.

## Rotation is a separate owner/security train

Do not rotate this key inside an ordinary release. A planned rotation requires:

1. Protect and retain the old private key; generate and protect the new key outside Git.
2. Build a bridge release that embeds the **new public key** but whose updater package is signed by
   the **old private key**, so the existing fleet can accept it.
3. Verify that bridge end to end and leave it available long enough for the intended private fleet
   to install it. Record which clients moved. A single `latest.json` endpoint has no atomic dual-key
   transition, so stragglers need an explicit manual/legacy recovery path before proceeding.
4. Only after owner approval and recorded bridge coverage, publish a later release signed by the new
   key and update the machine-readable anchor plus its guard in one reviewed rotation commit.

Emergency key compromise is not a normal release. Stop publishing, preserve evidence, warn the
private fleet through a channel outside the updater, and design a manual recovery installer.
