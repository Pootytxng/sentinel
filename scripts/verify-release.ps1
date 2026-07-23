# verify-release.ps1 - one canonical pre-release proof gate.
# ASCII only for Windows PowerShell 5.1 compatibility.
param()

$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

function Invoke-Native([string]$Label, [scriptblock]$Command) {
  Write-Host "VERIFY: $Label"
  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw "$Label failed (exit $LASTEXITCODE)"
  }
}

Push-Location $repo
try {
  Invoke-Native "git diff check" { git diff --check }
  Invoke-Native "frontend tests" { npm test }
  Invoke-Native "TypeScript" { node node_modules/typescript/bin/tsc --noEmit }
  Invoke-Native "frontend production build" { npm run build }
  Invoke-Native "Rust tests" { cargo test --manifest-path src-tauri/Cargo.toml }
  Invoke-Native "Rust clippy" { cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings }
  Invoke-Native "strict release-state citations" { node scripts/verify-release-state.mjs --strict }
  Invoke-Native "documentation budget" { powershell -NoProfile -File scripts/doc-budget.ps1 }
} finally {
  Pop-Location
}

Write-Host "VERIFY COMPLETE: all release gates passed."
