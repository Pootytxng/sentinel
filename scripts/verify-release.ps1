# verify-release.ps1 - one canonical pre-release proof gate.
# ASCII only for Windows PowerShell 5.1 compatibility (see scripts/lib/native-process.ps1).
#
# These gates are long-running and their output is the point: the owner watches vitest, tsc, cargo
# and clippy scroll past. So they run through Invoke-StreamedProcess, which uses Start-Process (a
# CMDLET, immune to PowerShell 5.1's NativeCommandError promotion) and lets each child write
# straight to this console. The previous local Invoke-Native wrapper invoked each tool as a
# PowerShell NATIVE command and inspected $LASTEXITCODE afterwards - the same shape that killed two
# v0.9.9 publish attempts. It never detonated here only because nothing redirected these streams;
# that is luck, not a design, and it is now gone.
param()

$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
. (Join-Path $PSScriptRoot "lib\native-process.ps1")

function Invoke-Gate([string]$Label, [string]$Command, [string[]]$Arguments) {
  Write-Host "VERIFY: $Label"
  Invoke-StreamedProcess $Label $Command $Arguments -WorkingDirectory $repo -TimeoutMs 3600000 | Out-Null
}

Invoke-Gate "git diff check" "git" @("-C", $repo, "diff", "--check")
Invoke-Gate "frontend tests" "npm.cmd" @("test")
Invoke-Gate "TypeScript" "node" @("node_modules/typescript/bin/tsc", "--noEmit")
Invoke-Gate "frontend production build" "npm.cmd" @("run", "build")
Invoke-Gate "Rust tests" "cargo" @("test", "--manifest-path", "src-tauri/Cargo.toml")
Invoke-Gate "Rust clippy" "cargo" @("clippy", "--manifest-path", "src-tauri/Cargo.toml", "--all-targets", "--all-features", "--", "-D", "warnings")
Invoke-Gate "strict release-state citations" "node" @("scripts/verify-release-state.mjs", "--strict")
Invoke-Gate "documentation budget" "powershell" @("-NoProfile", "-File", "scripts/doc-budget.ps1")

Write-Host "VERIFY COMPLETE: all release gates passed."
exit 0
