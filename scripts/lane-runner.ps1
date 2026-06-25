#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Resilient LANE_BUS runner — keeps a Compy build lane alive ACROSS API errors / rate-limits.

.DESCRIPTION
  The problem: an API error (e.g. "Server is temporarily limiting requests · Rate limited") kills a
  lane's loop tick, and nothing re-fires it — so the lane just halts. docs/LANE_BUS.md's RECOVER-FIRST
  protocol is "what to do on wake"; it cannot *cause* a halted session to wake. THIS script is the wake
  mechanism: it runs the lane headlessly (`claude --print`) in a backoff-retry loop. A rate-limited tick
  exits non-zero → the wrapper waits (exponential backoff) and fires the next tick. Because RECOVER-FIRST
  + LANE_BUS make a lane STATELESS (every tick reconciles from git + the bus), each tick is a fresh cold
  run that resumes exactly where the lane left off — nothing is lost or duplicated.

  Resilience levers used:
   - exponential backoff on failure (transient rate-limits clear in seconds-to-minutes)
   - --fallback-model : on a primary-model rate-limit, Claude auto-falls back instead of dying

.PARAMETER Lane       Lane name as it appears in LANE_BUS §④ (backend|measurement|peripheral|content|honesty).
.PARAMETER Worktree   Absolute path to that lane's git worktree.
.PARAMETER FallbackModel  Model to fall back to on a rate-limit (default: claude-sonnet-4-6). '' to disable.
.PARAMETER BypassPermissions  OWNER OPT-IN: run fully unattended (--dangerously-skip-permissions). OFF by
                              default — without it, headless ticks pause on tool-permission prompts, so for
                              true hands-off operation either set this OR pre-allow the lane's command set in
                              the worktree's .claude/settings.json. This is an autonomy escalation: the lane
                              builds + pushes to main with no per-action approval. Reversible work only — the
                              bus excludes all gated (mutation/telemetry/money) items.

.EXAMPLE
  pwsh scripts/lane-runner.ps1 -Lane peripheral -Worktree C:/Users/Kuya/code/sentinel-worktrees/agent
.EXAMPLE
  pwsh scripts/lane-runner.ps1 -Lane measurement -Worktree C:/Users/Kuya/code/sentinel-worktrees/benchmark -BypassPermissions
#>
param(
  [Parameter(Mandatory)] [string]$Lane,
  [Parameter(Mandatory)] [string]$Worktree,
  [string]$Model = '',
  [string]$FallbackModel = 'claude-sonnet-4-6',
  [int]$MinBackoffSec = 30,
  [int]$MaxBackoffSec = 600,
  [int]$PaceSec = 30,
  [switch]$BypassPermissions
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path $Worktree)) { throw "Worktree not found: $Worktree" }

# Self-contained, IDEMPOTENT lane prompt. Every tick reconciles from git + LANE_BUS, so a cold re-fire
# after an API-halt resumes correctly (RECOVER-FIRST §⑦).
$prompt = @"
You are the $Lane lane for Compy (repo sentinel). FIRST RECOVER (docs/LANE_BUS.md section 7): run git status
— if there is uncommitted WIP from a prior API-halted tick, finish+verify+commit it or stash it with a note
(never abandon or blindly redo); read your last commit + the section-8 checkpoint for the item you were on;
rebase onto origin/main; re-run cargo+npm to confirm a GREEN baseline. THEN run the SELF-CONTINUATION
PROTOCOL (section 1): take the top unchecked item in your lane's queue (section 4) or claim one from the pool
(section 5), build it in YOUR file domain ONLY with full rigor (spec, TDD, /check, /security, self-review if
visual). When cargo+npm are green, LAND IT ON MAIN: git add your files + commit (after a branch+status check),
then git fetch origin, git rebase origin/main, re-confirm cargo+npm green, and push with: git push origin
HEAD:main . If that push is REJECTED because another lane landed first, re-run git fetch origin + git rebase
origin/main + the tests, then retry git push origin HEAD:main — repeat until it lands. (Pushing HEAD:main is a
fast-forward after the rebase; your branch name does not matter.) On any rebase conflict in docs/BACKLOG.md or
docs/LANE_BUS.md, UNION both sides — never delete another lane's line (section 3). After it lands, update your
section-8 checkpoint, tick it in BACKLOG + your queue, and post any cross-lane signal to section 6. Then
continue to your next item. Only stop on the section-1 stop conditions, posting the reason to section 6 first.
This prompt is IDEMPOTENT and safe to re-fire at any point.
"@

$logDir = Join-Path $Worktree '.lane-runner'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir "$Lane.log"

$claudeArgs = @('--print', '--add-dir', $Worktree)
if ($Model)             { $claudeArgs += @('--model', $Model) }
if ($FallbackModel)     { $claudeArgs += @('--fallback-model', $FallbackModel) }
if ($BypassPermissions) { $claudeArgs += '--dangerously-skip-permissions' }

Write-Host "lane-runner: $Lane @ $Worktree | fallback=$FallbackModel | bypass=$BypassPermissions"
Write-Host "lane-runner: backoff $MinBackoffSec..$MaxBackoffSec s, pace $PaceSec s. Ctrl+C to stop. Log: $log"

$backoff = $MinBackoffSec
$tick = 0
while ($true) {
  $tick++
  $stamp = (Get-Date).ToString('s')
  "[$stamp] tick $tick START (lane=$Lane)" | Tee-Object -FilePath $log -Append | Write-Host

  Push-Location $Worktree
  try {
    $prompt | & claude @claudeArgs 2>&1 | Tee-Object -FilePath $log -Append
    $code = $LASTEXITCODE
  } catch {
    "$_" | Tee-Object -FilePath $log -Append | Write-Host
    $code = 1
  } finally { Pop-Location }

  if ($code -eq 0) {
    "[$stamp] tick $tick OK — pacing ${PaceSec}s" | Tee-Object -FilePath $log -Append | Write-Host
    $backoff = $MinBackoffSec
    Start-Sleep -Seconds $PaceSec
  } else {
    "[$stamp] tick $tick FAILED (exit $code) — likely rate-limit/API error; backing off ${backoff}s" | Tee-Object -FilePath $log -Append | Write-Host
    Start-Sleep -Seconds $backoff
    $backoff = [Math]::Min($backoff * 2, $MaxBackoffSec)
  }
}
