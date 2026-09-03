#!/usr/bin/env pwsh
# Installs the UsageHalo logon task (Windows Task Scheduler). Least privilege.
$ErrorActionPreference = 'Stop'
$taskName = 'UsageHalo'
$xml = Join-Path $PSScriptRoot 'UsageHalo.xml'
if (-not (Test-Path $xml)) { throw "Missing $xml" }
# Stamp the real working directory into a copy of the task definition.
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$tmp = Join-Path ([IO.Path]::GetTempPath()) 'UsageHalo.task.xml'
(Get-Content $xml -Raw).Replace('%USERPROFILE%/SideProjects/UsageHaloo', $repo) |
  Set-Content $tmp -Encoding Unicode
schtasks /create /tn $taskName /xml $tmp /f | Out-Null
Remove-Item $tmp
Write-Host "Task '$taskName' installed. It starts 'node prototype/server.mjs' at logon."
Write-Host "Uninstall: schtasks /delete /tn $taskName /f"
