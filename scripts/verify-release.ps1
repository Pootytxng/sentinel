# verify-release.ps1 - one canonical pre-release proof gate.
# ASCII only for Windows PowerShell 5.1 compatibility (see scripts/lib/native-process.ps1).
#
# These gates are long-running and their output is the point: the owner watches vitest, tsc, cargo
# and clippy scroll past. Invoke-StreamedProcess launches the real executable with an argument array,
# inherited console handles, explicit exit data, and timeout-tree cleanup. Batch shims are forbidden.
param()

$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
. (Join-Path $PSScriptRoot "lib\native-process.ps1")
$npm = Get-NpmCliInvocation

function Invoke-Gate([string]$Label, [string]$Command, [string[]]$Arguments) {
  Write-Host "VERIFY: $Label"
  Invoke-StreamedProcess $Label $Command $Arguments -WorkingDirectory $repo -TimeoutMs 3600000 | Out-Null
}

Invoke-Gate "git diff check" "git" @("-C", $repo, "diff", "--check")
Invoke-Gate "frontend tests" $npm.Command (@($npm.ArgumentPrefix) + @("test"))
Invoke-Gate "TypeScript" "node" @("node_modules/typescript/bin/tsc", "--noEmit")
Invoke-Gate "frontend production build" $npm.Command (@($npm.ArgumentPrefix) + @("run", "build"))
Invoke-Gate "Rust tests" "cargo" @("test", "--manifest-path", "src-tauri/Cargo.toml")
Invoke-Gate "Rust clippy" "cargo" @("clippy", "--manifest-path", "src-tauri/Cargo.toml", "--all-targets", "--all-features", "--", "-D", "warnings")
Invoke-Gate "strict release-state citations" "node" @("scripts/verify-release-state.mjs", "--strict")
Invoke-Gate "documentation budget" "powershell" @("-NoProfile", "-File", "scripts/doc-budget.ps1")

Write-Host "VERIFY COMPLETE: all release gates passed."
exit 0
