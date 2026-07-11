param(
  [string]$ClaudeConfigDir = "$HOME\.claude",
  [string]$AccountName = ""
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$captureScript = Join-Path $repoRoot "scripts\claude-statusline.js"
$settingsPath = Join-Path $ClaudeConfigDir "settings.json"

if (-not (Test-Path $captureScript)) {
  throw "Missing statusline script: $captureScript"
}

New-Item -ItemType Directory -Force -Path $ClaudeConfigDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $HOME ".ai-usage\claude-status") | Out-Null

if (Test-Path $settingsPath) {
  $backupPath = Join-Path $HOME (".ai-usage\claude-settings.backup.{0}.json" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
  Copy-Item -LiteralPath $settingsPath -Destination $backupPath -Force
  Write-Host "Backed up existing settings to $backupPath"
}

function Convert-ToHashtable {
  param([Parameter(ValueFromPipeline)]$InputObject)

  process {
    if ($null -eq $InputObject) {
      return $null
    }

    if ($InputObject -is [System.Collections.IDictionary]) {
      $hash = @{}
      foreach ($key in $InputObject.Keys) {
        $hash[$key] = Convert-ToHashtable $InputObject[$key]
      }
      return $hash
    }

    if ($InputObject -is [System.Collections.IEnumerable] -and $InputObject -isnot [string]) {
      $items = @()
      foreach ($item in $InputObject) {
        $items += Convert-ToHashtable $item
      }
      return $items
    }

    if ($InputObject.PSObject.Properties.Count -gt 0 -and $InputObject.GetType().Name -eq "PSCustomObject") {
      $hash = @{}
      foreach ($property in $InputObject.PSObject.Properties) {
        $hash[$property.Name] = Convert-ToHashtable $property.Value
      }
      return $hash
    }

    return $InputObject
  }
}

$captureScriptForShell = $captureScript.Replace('\', '/')
$command = 'node "{0}"' -f $captureScriptForShell
if ($AccountName.Trim().Length -gt 0) {
  $safeAccountName = $AccountName.Trim().Replace('"', '')
  $command = '{0} --account "{1}"' -f $command, $safeAccountName
}

$statusLine = @{
  type = "command"
  command = $command
  padding = 1
  refreshInterval = 15
}

if ((Test-Path $settingsPath) -and ((Get-Content -Raw -LiteralPath $settingsPath).Trim().Length -gt 0)) {
  $rawSettings = Get-Content -Raw -LiteralPath $settingsPath
  try {
    $settings = Convert-ToHashtable ($rawSettings | ConvertFrom-Json)
    $settings["statusLine"] = $statusLine
    $nextSettings = $settings | ConvertTo-Json -Depth 20
  } catch {
    $repairScript = Join-Path $repoRoot "scripts\repair-claude-settings.js"
    throw "settings.json is invalid JSON. Run: node `"$repairScript`" --write ; then run this installer again."
  }
} else {
  $settings = @{
    statusLine = $statusLine
  }
  $nextSettings = $settings | ConvertTo-Json -Depth 20
}

$tmpPath = "$settingsPath.tmp"
$nextSettings | Set-Content -LiteralPath $tmpPath -Encoding UTF8
Move-Item -LiteralPath $tmpPath -Destination $settingsPath -Force

Write-Host "Installed Claude Code statusLine in $settingsPath"
Write-Host "Command: $command"
Write-Host "After this, restart Claude Code and send one message so rate_limits are captured."
