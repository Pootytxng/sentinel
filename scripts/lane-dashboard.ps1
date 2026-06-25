#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Live, read-only view of the Compy lane fleet — see at a glance which lanes are actively
  building (animated spinner), what each just shipped, and what's landing on main in real time.
  Pure observation: only runs `git status` / `git log` / `git fetch`. Ctrl+C to exit.
.EXAMPLE
  pwsh C:\Users\Kuya\code\sentinel\scripts\lane-dashboard.ps1
  pwsh C:\Users\Kuya\code\sentinel\scripts\lane-dashboard.ps1 -RefreshSec 2
#>
param([int]$RefreshSec = 3)

$repo  = 'C:\Users\Kuya\code\sentinel'
$lanes = [ordered]@{
  backend     = 'C:\Users\Kuya\code\sentinel-worktrees\svc'
  measurement = 'C:\Users\Kuya\code\sentinel-worktrees\benchmark'
  peripheral  = 'C:\Users\Kuya\code\sentinel-worktrees\agent'
  content     = 'C:\Users\Kuya\code\sentinel-worktrees\content'
  honesty     = 'C:\Users\Kuya\code\sentinel-honesty'
}

# git format strings held in variables so the % chars never sit in native-command-arg position
# (PowerShell's parser mishandles --format='%h|...' inline; via a variable it's passed literally).
$FMT_ONE = '%h|%cr|%s'
$FMT_TIP = '%h %s'
$FMT_LOG = '%h  %s'

$spin    = @('|','/','-','\')
$prev    = @{}
$shipped = @{}
foreach ($l in $lanes.Keys) { $shipped[$l] = 0 }
$i = 0

function Clip([string]$s,[int]$n){ if (-not $s){ return '' }; if ($s.Length -gt $n){ $s.Substring(0,$n) } else { $s } }

while ($true) {
  $i++
  $sp = $spin[$i % $spin.Count]
  if ($i % 5 -eq 1) { git -C $repo fetch origin --quiet 2>$null }
  $mainTip = git -C $repo log -1 --format=$FMT_TIP origin/main 2>$null

  Clear-Host
  Write-Host ""
  Write-Host "   COMPY LANE FLEET   $sp   $(Get-Date -Format 'HH:mm:ss')" -ForegroundColor Cyan
  Write-Host "   main:  $(Clip $mainTip 70)" -ForegroundColor DarkGray
  Write-Host ("   " + ('=' * 74)) -ForegroundColor DarkGray
  Write-Host ("   {0,-12} {1,-18} {2,-5} {3}" -f 'LANE','STATUS','SHIP','LAST COMMIT') -ForegroundColor DarkGray

  foreach ($lane in $lanes.Keys) {
    $wt = $lanes[$lane]
    if (-not (Test-Path $wt)) { Write-Host ("   {0,-12} worktree missing" -f $lane) -ForegroundColor DarkRed; continue }
    $wip = (git -C $wt status --short 2>$null | Measure-Object).Count
    $c   = git -C $wt log -1 --format=$FMT_ONE 2>$null
    $p   = $c -split '\|',3
    $hash = $p[0]; $age = $p[1]; $subj = $p[2]
    $justShipped = ($prev[$lane] -and $prev[$lane] -ne $hash)
    if ($justShipped) { $shipped[$lane]++ }
    $prev[$lane] = $hash

    if     ($wip -gt 0)   { $status = "$sp building ($wip)"; $col = 'Green' }
    elseif ($justShipped) { $status = "^ just shipped!";     $col = 'Cyan'  }
    else                  { $status = ". idle";              $col = 'DarkGray' }

    Write-Host ("   {0,-12} {1,-18} {2,-5} {3}" -f $lane, $status, $shipped[$lane], (Clip "$subj  ($age)" 42)) -ForegroundColor $col
  }

  Write-Host ("   " + ('=' * 74)) -ForegroundColor DarkGray
  Write-Host "   latest on main:" -ForegroundColor DarkGray
  git -C $repo log -6 --format=$FMT_LOG origin/main 2>$null | ForEach-Object { Write-Host ("      " + (Clip $_ 72)) -ForegroundColor DarkGray }
  Write-Host ""
  Write-Host "   read-only  ::  spinner moving = dashboard live  ::  green = lane building  ::  refresh ${RefreshSec}s  ::  Ctrl+C to exit" -ForegroundColor DarkGray
  Start-Sleep -Seconds $RefreshSec
}
