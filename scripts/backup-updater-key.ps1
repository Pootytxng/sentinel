<#
.SYNOPSIS
  Make an ENCRYPTED, off-machine-safe backup of the Compy updater signing key (checklist §A0).

.DESCRIPTION
  The fleet anchor `43711DD10AAB67D7` is PASSWORDLESS (see scripts/release.ps1's
  GRANDFATHERED FLEET ANCHOR note). That means the 348 bytes of compy-updater.key ARE the whole
  secret: whoever holds them can sign an update that every installed Compy applies silently.
  A plaintext copy in a phone's notes app, an email, or a cloud drive is therefore a fleet-level
  exposure, not a backup.

  This script wraps the key in AES-256-GCM under a passphrase YOU type, and writes a single
  armored text file. That file is safe to email to yourself, drop in your phone's Files app, or
  store in any cloud -- it is useless without the passphrase.

  It never prints key material, never writes plaintext key material anywhere, and verifies the
  backup by decrypting it back in memory and comparing byte-for-byte before it reports success.

  Restore with: scripts/restore-updater-key.ps1

.PARAMETER KeyPath
  The private key to back up. Default: $env:USERPROFILE\.tauri\compy-updater.key

.PARAMETER OutPath
  Where to write the encrypted backup. Default: Desktop\compy-updater-key.ENCRYPTED-BACKUP.txt
#>
[CmdletBinding()]
param(
  [string]$KeyPath = (Join-Path $env:USERPROFILE ".tauri\compy-updater.key"),
  [string]$OutPath = (Join-Path ([Environment]::GetFolderPath('Desktop')) "compy-updater-key.ENCRYPTED-BACKUP.txt")
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# --- crypto parameters. Recorded verbatim in the output file header so a future restore never
# --- depends on this repo still existing.
$KDF_ITERATIONS = 600000
$SALT_BYTES     = 16
$NONCE_BYTES    = 12
$TAG_BYTES      = 16
$KEY_BYTES      = 32
$FORMAT_ID      = 'COMPY-UPDATER-KEY-BACKUP-v1'

function Test-BytesEqual([byte[]]$A, [byte[]]$B) {
  # Written out rather than [System.Linq.Enumerable]::SequenceEqual: PowerShell's generic-method
  # inference on that overload is not dependable across hosts, and this comparison decides whether
  # a fleet-critical backup is trusted.
  if ($A.Length -ne $B.Length) { return $false }
  $diff = 0
  for ($i = 0; $i -lt $A.Length; $i++) { $diff = $diff -bor ($A[$i] -bxor $B[$i]) }
  return ($diff -eq 0)
}

function New-AesGcm([byte[]]$Key) {
  # .NET 8 made tagSizeInBytes required; .NET 6/7 has the single-arg ctor. Support both.
  try { return [System.Security.Cryptography.AesGcm]::new($Key, $script:TAG_BYTES) }
  catch { return [System.Security.Cryptography.AesGcm]::new($Key) }
}

if (-not (Test-Path -LiteralPath $KeyPath -PathType Leaf)) {
  throw "No key at $KeyPath. Pass -KeyPath if yours lives elsewhere."
}

# --- Confirm this really is the LIVE fleet key before backing it up. Public half only: the
# --- private half is never inspected, only copied.
$repo    = Split-Path -Parent $PSScriptRoot
$pubPath = "$KeyPath.pub"
$anchorMatched = $false
if (Test-Path -LiteralPath $pubPath -PathType Leaf) {
  $confPath = Join-Path $repo "src-tauri\tauri.conf.json"
  if (Test-Path -LiteralPath $confPath -PathType Leaf) {
    $conf = Get-Content -LiteralPath $confPath -Raw | ConvertFrom-Json
    $confPub = [Text.Encoding]::UTF8.GetString(
      [Convert]::FromBase64String($conf.plugins.updater.pubkey)).Trim()
    $filePub = (Get-Content -LiteralPath $pubPath -Raw).Trim()
    $anchorMatched = ($confPub -replace '\s','') -eq ($filePub -replace '\s','')
    if (-not $anchorMatched) {
      Write-Warning "This key's PUBLIC half does not match plugins.updater.pubkey in tauri.conf.json."
      Write-Warning "You may be backing up a key the fleet does not trust. Continuing anyway."
    }
  }
}
if ($anchorMatched) {
  Write-Host "Verified: this is the live fleet key (public half matches tauri.conf.json)." -ForegroundColor Green
}

# --- Passphrase. Typed twice, never echoed, never stored.
Write-Host ""
Write-Host "Choose a passphrase for this backup." -ForegroundColor Cyan
Write-Host "  * If you lose it, the backup is unrecoverable. Put it in your password manager NOW."
Write-Host "  * The key on this PC is untouched, so a forgotten passphrase costs you nothing today"
Write-Host "    -- it just means this backup was never a backup."
Write-Host ""
$p1 = Read-Host -AsSecureString "Passphrase"
$p2 = Read-Host -AsSecureString "Passphrase (again)"

function ConvertFrom-SecureStringToBytes([System.Security.SecureString]$Secure) {
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToGlobalAllocUnicode($Secure)
  try { $plain = [Runtime.InteropServices.Marshal]::PtrToStringUni($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeGlobalAllocUnicode($bstr) }
  return ,[Text.Encoding]::UTF8.GetBytes($plain)
}

$pw1 = ConvertFrom-SecureStringToBytes $p1
$pw2 = ConvertFrom-SecureStringToBytes $p2
try {
  if (-not (Test-BytesEqual ([byte[]]$pw1) ([byte[]]$pw2))) {
    throw "The two passphrases do not match. Nothing was written."
  }
  if ($pw1.Length -lt 12) {
    throw "Passphrase is under 12 characters. This key can sign silent updates to every install -- use a longer one. Nothing was written."
  }

  $plain = [IO.File]::ReadAllBytes($KeyPath)
  $salt  = [Security.Cryptography.RandomNumberGenerator]::GetBytes($SALT_BYTES)
  $nonce = [Security.Cryptography.RandomNumberGenerator]::GetBytes($NONCE_BYTES)

  $kdf = [Security.Cryptography.Rfc2898DeriveBytes]::new(
    [byte[]]$pw1, $salt, $KDF_ITERATIONS, [Security.Cryptography.HashAlgorithmName]::SHA256)
  try { $dek = $kdf.GetBytes($KEY_BYTES) } finally { $kdf.Dispose() }

  $cipher = [byte[]]::new($plain.Length)
  $tag    = [byte[]]::new($TAG_BYTES)
  $gcm = New-AesGcm $dek
  try { $gcm.Encrypt($nonce, $plain, $cipher, $tag) } finally { $gcm.Dispose() }

  # --- Round-trip: decrypt back in memory and compare. A backup that has not been restored
  # --- is a guess, not a backup.
  $check = [byte[]]::new($cipher.Length)
  $gcm2 = New-AesGcm $dek
  try { $gcm2.Decrypt($nonce, $cipher, $tag, $check) } finally { $gcm2.Dispose() }
  if (-not (Test-BytesEqual ([byte[]]$check) ([byte[]]$plain))) {
    throw "Round-trip verification FAILED. Nothing was written."
  }
  [Array]::Clear($check, 0, $check.Length)
  [Array]::Clear($plain, 0, $plain.Length)
  [Array]::Clear($dek, 0, $dek.Length)

  $blob = [byte[]]::new($salt.Length + $nonce.Length + $tag.Length + $cipher.Length)
  [Array]::Copy($salt,   0, $blob, 0, $salt.Length)
  [Array]::Copy($nonce,  0, $blob, $salt.Length, $nonce.Length)
  [Array]::Copy($tag,    0, $blob, $salt.Length + $nonce.Length, $tag.Length)
  [Array]::Copy($cipher, 0, $blob, $salt.Length + $nonce.Length + $tag.Length, $cipher.Length)
  $armor = [Convert]::ToBase64String($blob)

  $wrapped = ($armor -split '(.{72})' | Where-Object { $_ }) -join "`n"
  $stamp = (Get-Date).ToString('yyyy-MM-dd')

  $doc = @"
$FORMAT_ID
Compy updater signing key -- ENCRYPTED backup. Created $stamp.

WHAT THIS IS
  The Ed25519/minisign private key Compy signs its updates with (fleet anchor 43711DD10AAB67D7).
  Lose it and the fleet can never receive another update without a one-time manual re-send.
  It is encrypted here, so this file is safe to email to yourself, keep in your phone, or put in
  any cloud drive. It is useless to anyone without the passphrase.

TO RESTORE
  Easiest: run  scripts/restore-updater-key.ps1  from the Compy repo and point it at this file.

  Without the repo, any AI or developer can rebuild it from these exact parameters:
    format      $FORMAT_ID
    body        base64 of:  salt(${SALT_BYTES}B) || nonce(${NONCE_BYTES}B) || tag(${TAG_BYTES}B) || ciphertext
    kdf         PBKDF2-HMAC-SHA256, $KDF_ITERATIONS iterations, ${KEY_BYTES}-byte derived key
    cipher      AES-256-GCM, no additional authenticated data
    plaintext   the raw bytes of compy-updater.key, restored verbatim
  Restore the plaintext to  %USERPROFILE%\.tauri\compy-updater.key

  The restored key itself has NO password of its own -- the passphrase you chose protects only
  this file. Treat the restored plaintext accordingly.

-----BEGIN COMPY UPDATER KEY BACKUP-----
$wrapped
-----END COMPY UPDATER KEY BACKUP-----
"@

  [IO.File]::WriteAllText($OutPath, $doc)
}
finally {
  if ($null -ne $pw1) { [Array]::Clear($pw1, 0, $pw1.Length) }
  if ($null -ne $pw2) { [Array]::Clear($pw2, 0, $pw2.Length) }
}

Write-Host ""
Write-Host "Encrypted backup written:" -ForegroundColor Green
Write-Host "  $OutPath"
Write-Host ""
Write-Host "Next, and this is the part that matters:" -ForegroundColor Cyan
Write-Host "  1. Put the PASSPHRASE in your password manager. Not on this PC as a file."
Write-Host "  2. Get this file OFF this machine -- email it to yourself, or save it to your"
Write-Host "     phone's Files app, or your cloud drive. Encrypted, so any of those is fine."
Write-Host "  3. Delete it from the Desktop once it is somewhere else."
Write-Host ""
Write-Host "Prove it works before you trust it:" -ForegroundColor Cyan
Write-Host "  pwsh scripts/restore-updater-key.ps1 -BackupPath `"$OutPath`" -Verify"
