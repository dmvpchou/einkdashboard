param(
  [string]$TaskName = "Leaf2 Dashboard"
)

$ErrorActionPreference = "Stop"
$watcher = Join-Path $PSScriptRoot "keep-dashboard-connected.ps1"
if (-not (Test-Path -LiteralPath $watcher)) {
  throw "Watcher script not found: $watcher"
}

$powershell = Join-Path $PSHOME "powershell.exe"
$arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$watcher`""
$action = New-ScheduledTaskAction -Execute $powershell -Argument $arguments
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 99 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -MultipleInstances IgnoreNew

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "Start the Leaf2 dashboard and restore ADB reverse after reconnects." `
  -Force | Out-Null

Start-ScheduledTask -TaskName $TaskName
Write-Host "Installed and started scheduled task: $TaskName"
