<#
.SYNOPSIS
  Restore (or just VERIFY) an encrypted Compy updater signing key backup made by
  scripts/backup-updater-key.ps1.

.DESCRIPTION
  -Verify is the mode you want the day you make the backup: it decrypts the file in memory,
  proves the passphrase works, and writes NOTHING to disk. A backup nobody has ever opened is
  a guess.

  Without -Verify it writes the recovered key to -OutPath. It refuses to overwrite an existing
  key file unless -Force is given, so a mistyped restore cannot clobber a working key.

  Never prints key material.

.PARAMETER BackupPath
  The .txt produced by backup-updater-key.ps1.

.PARAMETER OutPath
  Where to write the recovered key. Default: $env:USERPROFILE\.tauri\compy-updater.key

.PARAMETER Verify
  Decrypt and check only. Writes nothing.

.PARAMETER Force
  Allow overwriting an existing key file.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$BackupPath,
  [string]$OutPath = (Join-Path $env:USERPROFILE ".tauri\compy-updater.key"),
  [switch]$Verify,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# Must match backup-updater-key.ps1 exactly.
$KDF_ITERATIONS = 600000
$SALT_BYTES     = 16
$NONCE_BYTES    = 12
$TAG_BYTES      = 16
$KEY_BYTES      = 32
$FORMAT_ID      = 'COMPY-UPDATER-KEY-BACKUP-v1'

function New-AesGcm([byte[]]$Key) {
  try { return [System.Security.Cryptography.AesGcm]::new($Key, $script:TAG_BYTES) }
  catch { return [System.Security.Cryptography.AesGcm]::new($Key) }
}

if (-not (Test-Path -LiteralPath $BackupPath -PathType Leaf)) {
  throw "No backup file at $BackupPath"
}

$text = Get-Content -LiteralPath $BackupPath -Raw
if ($text -notmatch [regex]::Escape($FORMAT_ID)) {
  throw "$BackupPath is not a $FORMAT_ID file."
}
if ($text -notmatch '(?s)-----BEGIN COMPY UPDATER KEY BACKUP-----(.*?)-----END COMPY UPDATER KEY BACKUP-----') {
  throw "Could not find the armored block in $BackupPath. Was the file truncated in transit?"
}
$blob = [Convert]::FromBase64String(($Matches[1] -replace '\s',''))

$minimum = $SALT_BYTES + $NONCE_BYTES + $TAG_BYTES
if ($blob.Length -le $minimum) { throw "Armored block is too short to contain a key." }

$salt   = $blob[0..($SALT_BYTES - 1)]
$nonce  = $blob[$SALT_BYTES..($SALT_BYTES + $NONCE_BYTES - 1)]
$tag    = $blob[($SALT_BYTES + $NONCE_BYTES)..($minimum - 1)]
$cipher = $blob[$minimum..($blob.Length - 1)]

$plain = $null
$secure = Read-Host -AsSecureString "Passphrase for this backup"
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToGlobalAllocUnicode($secure)
try { $pwText = [Runtime.InteropServices.Marshal]::PtrToStringUni($bstr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeGlobalAllocUnicode($bstr) }
$pw = [Text.Encoding]::UTF8.GetBytes($pwText)

try {
  $kdf = [Security.Cryptography.Rfc2898DeriveBytes]::new(
    [byte[]]$pw, [byte[]]$salt, $KDF_ITERATIONS, [Security.Cryptography.HashAlgorithmName]::SHA256)
  try { $dek = $kdf.GetBytes($KEY_BYTES) } finally { $kdf.Dispose() }

  $plain = [byte[]]::new($cipher.Length)
  $gcm = New-AesGcm $dek
  try {
    # AES-GCM authenticates: a wrong passphrase throws here rather than yielding garbage.
    $gcm.Decrypt([byte[]]$nonce, [byte[]]$cipher, [byte[]]$tag, $plain)
  }
  catch {
    throw "Decryption failed. Wrong passphrase, or the file was altered in transit. Nothing was written."
  }
  finally { $gcm.Dispose() }
  [Array]::Clear($dek, 0, $dek.Length)

  if ($Verify) {
    Write-Host ""
    Write-Host "VERIFIED. The passphrase is correct and the backup decrypts to a $($plain.Length)-byte key." -ForegroundColor Green
    Write-Host "Nothing was written to disk. This backup is real." -ForegroundColor Green
    return
  }

  if ((Test-Path -LiteralPath $OutPath) -and -not $Force) {
    throw "A key already exists at $OutPath. Re-run with -Force if you really mean to replace it."
  }
  $dir = Split-Path -Parent $OutPath
  if ($dir -and -not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }
  [IO.File]::WriteAllBytes($OutPath, $plain)
  Write-Host ""
  Write-Host "Key restored to $OutPath ($($plain.Length) bytes)." -ForegroundColor Green
  Write-Host "This file is now PLAINTEXT signing material. Do not copy it anywhere casually." -ForegroundColor Yellow
}
finally {
  if ($null -ne $pw) { [Array]::Clear($pw, 0, $pw.Length) }
  if ($null -ne $plain) { [Array]::Clear($plain, 0, $plain.Length) }
}
