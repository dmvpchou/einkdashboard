param(
  [int]$Port = 8765,
  [int]$RetrySeconds = 15,
  [switch]$Once
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$dataDir = Join-Path $repoRoot "data"

function Find-Adb {
  $fromPath = Get-Command adb.exe -ErrorAction SilentlyContinue
  if ($fromPath) { return $fromPath.Source }

  $candidates = @(
    (Join-Path $env:LOCALAPPDATA "Android\Sdk\platform-tools\adb.exe"),
    $(if ($env:ANDROID_HOME) { Join-Path $env:ANDROID_HOME "platform-tools\adb.exe" }),
    $(if ($env:ANDROID_SDK_ROOT) { Join-Path $env:ANDROID_SDK_ROOT "platform-tools\adb.exe" })
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

  if (-not $candidates) { throw "adb.exe not found" }
  return $candidates[0]
}

function Test-Dashboard {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 "http://127.0.0.1:$Port/"
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Start-DashboardIfNeeded {
  if (Test-Dashboard) { return }

  $node = (Get-Command node.exe -ErrorAction Stop).Source
  New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
  Start-Process -FilePath $node `
    -ArgumentList "server.js" `
    -WorkingDirectory $repoRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $dataDir "dashboard.out.log") `
    -RedirectStandardError (Join-Path $dataDir "dashboard.err.log")
}

function Get-ConnectedDevices($adb) {
  & $adb devices 2>$null | ForEach-Object {
    if ($_ -match "^(\S+)\s+device$") { $Matches[1] }
  }
}

function Repair-Reverse($adb, $serial) {
  $rules = & $adb -s $serial reverse --list 2>$null
  if ($rules -notmatch "tcp:$Port\s+tcp:$Port") {
    & $adb -s $serial reverse "tcp:$Port" "tcp:$Port" | Out-Null
  }
}

$adb = Find-Adb
while ($true) {
  try {
    Start-DashboardIfNeeded
    foreach ($serial in @(Get-ConnectedDevices $adb)) {
      Repair-Reverse $adb $serial
    }
  } catch {
    New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
    "$(Get-Date -Format o) $($_.Exception.Message)" | Add-Content (Join-Path $dataDir "dashboard-watch.err.log")
  }
  if ($Once) { break }
  Start-Sleep -Seconds $RetrySeconds
}
