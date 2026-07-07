# AnyRouters one-line installer - Claude Code. Safe to run more than once.
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch {}

$Key = $env:ANYROUTERS_KEY
if (-not $Key) {
  Write-Host "X No API key. Run:  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12; `$env:ANYROUTERS_KEY='YOUR_KEY'; irm https://anyrouters.com/install/claude.ps1 | iex"
  return
}
$Model = $env:ANYROUTERS_MODEL
if (-not $Model) {
  $Model = "claude-sonnet-4-6"
}

function Normalize-AnyRoutersKey([string]$Value) {
  $k = $Value.Trim().Trim('"').Trim("'")
  if ($k.StartsWith("Bearer ", [System.StringComparison]::OrdinalIgnoreCase)) {
    $k = $k.Substring(7).Trim()
  }
  if ($k.StartsWith("sk-anyrouters-sk-", [System.StringComparison]::OrdinalIgnoreCase)) {
    $k = "sk-" + $k.Substring(17)
  } elseif ($k.StartsWith("sk-anyrouters-", [System.StringComparison]::OrdinalIgnoreCase)) {
    $k = "sk-" + $k.Substring(14)
  } elseif ($k.StartsWith("anyrouters-sk-", [System.StringComparison]::OrdinalIgnoreCase)) {
    $k = "sk-" + $k.Substring(14)
  }
  return $k
}

$OriginalKey = $Key
$Key = Normalize-AnyRoutersKey $Key
if ($OriginalKey -ne $Key) {
  Write-Host "Fixed API key prefix: removed accidental sk-anyrouters-."
}
if (-not $Key -or $Key -match "YOUR_KEY|YOUR_ANYROUTERS_API_KEY|本页顶部|API 密钥") {
  Write-Host "X Replace the placeholder with your real AnyRouters API key."
  return
}

try {
  Invoke-RestMethod -Method Get -Uri "https://api.anyrouters.com/v1/models" -Headers @{ Authorization = "Bearer $Key" } -TimeoutSec 20 | Out-Null
} catch {
  $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { "network error" }
  Write-Host "X API key validation failed ($status)."
  Write-Host "  Copy the complete key from AnyRouters API Keys. Do not add sk-anyrouters- before it."
  return
}

$Reset = $true
if ($Reset) {
  Write-Host "Resetting AnyRouters Claude Code environment ..."
}

$NpmPrefix = if ($env:ANYROUTERS_NPM_PREFIX) { $env:ANYROUTERS_NPM_PREFIX } else { Join-Path $env:LOCALAPPDATA "AnyRouters\npm" }
$ConflictingClaudeEnvNames = @(
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_SMALL_FAST_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_BEDROCK_BASE_URL",
  "ANTHROPIC_VERTEX_BASE_URL",
  "ANTHROPIC_VERTEX_PROJECT_ID",
  "CLOUD_ML_REGION",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
  "CLAUDE_CODE_USE_MANTLE",
  "CLAUDE_CODE_USE_ANTHROPIC_AWS",
  "ANTHROPIC_AWS_WORKSPACE_ID"
)

function Test-InstallerHtml([string]$Content) {
  if (-not $Content) {
    return $true
  }
  return $Content.Substring(0, [Math]::Min(512, $Content.Length)) -match "(?is)<!doctype html|<html|</html"
}

function Clear-ClaudeConflictingEnv {
  foreach ($name in $ConflictingClaudeEnvNames) {
    [Environment]::SetEnvironmentVariable($name, $null, "User")
    Remove-Item "Env:$name" -ErrorAction SilentlyContinue
  }
}

function ConvertTo-PlainObject($Value) {
  if ($null -eq $Value) {
    return $null
  }
  if ($Value -is [System.Collections.IDictionary]) {
    $result = [ordered]@{}
    foreach ($key in $Value.Keys) {
      $result[$key] = ConvertTo-PlainObject $Value[$key]
    }
    return $result
  }
  if ($Value -is [pscustomobject]) {
    $result = [ordered]@{}
    foreach ($property in $Value.PSObject.Properties) {
      $result[$property.Name] = ConvertTo-PlainObject $property.Value
    }
    return $result
  }
  if (($Value -is [System.Collections.IEnumerable]) -and -not ($Value -is [string])) {
    $items = @()
    foreach ($item in $Value) {
      $items += ,(ConvertTo-PlainObject $item)
    }
    return $items
  }
  return $Value
}

function Update-ClaudeUserSettings {
  if (-not $env:USERPROFILE) {
    return
  }

  $settingsDir = Join-Path $env:USERPROFILE ".claude"
  $settingsPath = Join-Path $settingsDir "settings.json"
  New-Item -ItemType Directory -Force -Path $settingsDir | Out-Null

  $settings = [ordered]@{}
  if (Test-Path $settingsPath) {
    $raw = Get-Content -Raw -Path $settingsPath -ErrorAction SilentlyContinue
    if ($raw -and $raw.Trim()) {
      try {
        $settings = ConvertTo-PlainObject ($raw | ConvertFrom-Json)
      } catch {
        $backupPath = "$settingsPath.anyrouters-invalid-$(Get-Date -Format yyyyMMddHHmmss).bak"
        Copy-Item $settingsPath $backupPath -Force
        Write-Host "Backed up unreadable Claude settings to: $backupPath"
        $settings = [ordered]@{}
      }
    }
  }
  if (-not ($settings -is [System.Collections.IDictionary])) {
    $settings = [ordered]@{}
  }
  if (-not $settings.Contains("env") -or -not ($settings["env"] -is [System.Collections.IDictionary])) {
    $settings["env"] = [ordered]@{}
  }

  $envBlock = $settings["env"]
  $changed = $false
  foreach ($name in ($ConflictingClaudeEnvNames + @("ANTHROPIC_AUTH_TOKEN"))) {
    if ($envBlock.Contains($name)) {
      $envBlock.Remove($name)
      $changed = $true
    }
  }
  if (-not $envBlock.Contains("ANTHROPIC_BASE_URL") -or $envBlock["ANTHROPIC_BASE_URL"] -ne "https://api.anyrouters.com") {
    $envBlock["ANTHROPIC_BASE_URL"] = "https://api.anyrouters.com"
    $changed = $true
  }
  if (-not $envBlock.Contains("ANTHROPIC_MODEL") -or $envBlock["ANTHROPIC_MODEL"] -ne $Model) {
    $envBlock["ANTHROPIC_MODEL"] = $Model
    $changed = $true
  }

  if ($changed) {
    if (Test-Path $settingsPath) {
      Copy-Item $settingsPath "$settingsPath.anyrouters.bak" -Force
    }
    $settings | ConvertTo-Json -Depth 32 | Set-Content -Path $settingsPath -Encoding UTF8
    Write-Host "Updated Claude Code settings: $settingsPath"
  }
}

function Add-UserPath([string]$PathToAdd, [bool]$Prefer = $false) {
  if (-not $PathToAdd) {
    return
  }
  if (-not (Test-Path $PathToAdd)) {
    return
  }

  $currentUserPath = [Environment]::GetEnvironmentVariable("Path", "User")
  if (-not $currentUserPath) {
    $currentUserPath = [Environment]::GetEnvironmentVariable("PATH", "User")
  }

  $parts = @()
  if ($currentUserPath) {
    $parts = $currentUserPath -split ';' | Where-Object { $_ -and ($_ -ine $PathToAdd) }
  }
  if ($Prefer) {
    $parts = @($PathToAdd) + $parts
  } else {
    $parts = $parts + @($PathToAdd)
  }
  [Environment]::SetEnvironmentVariable("Path", ($parts -join ';'), "User")

  $envParts = @()
  if ($env:PATH) {
    $envParts = $env:PATH -split ';' | Where-Object { $_ -and ($_ -ine $PathToAdd) }
  }
  $envParts = @($PathToAdd) + $envParts
  $env:PATH = $envParts -join ';'
}

function Test-ClaudeCommandWorks([string]$CommandPath) {
  if (-not $CommandPath -or -not (Test-Path $CommandPath)) {
    return $false
  }
  try {
    & $CommandPath --version *> $null
    return $LASTEXITCODE -eq 0
  } catch {
    return $false
  }
}

function Get-AnyRoutersClaudeDirs([string]$NpmPrefix) {
  $dirs = @()
  if ($NpmPrefix) {
    $dirs += $NpmPrefix
    $dirs += (Join-Path $NpmPrefix "bin")
    $dirs += (Join-Path $NpmPrefix "node_modules\.bin")
  }
  return $dirs | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique
}

function Add-AnyRoutersClaudePaths([string]$NpmPrefix) {
  $dirs = @(Get-AnyRoutersClaudeDirs $NpmPrefix)
  [Array]::Reverse($dirs)
  foreach ($dir in $dirs) {
    Add-UserPath $dir $true
  }
}

function Get-LegacyClaudeLaunchers {
  $launchers = @()
  if ($env:USERPROFILE) {
    $launchers += (Join-Path $env:USERPROFILE ".local\cmd-shims\claude.cmd")
    $launchers += (Join-Path $env:USERPROFILE ".local\bin\claude.cmd")
    $launchers += (Join-Path $env:USERPROFILE ".local\bin\claude.exe")
  }
  if ($env:APPDATA) {
    $launchers += (Join-Path $env:APPDATA "npm\claude.cmd")
    $launchers += (Join-Path $env:APPDATA "npm\claude.ps1")
    $launchers += (Join-Path $env:APPDATA "npm\claude")
  }
  return $launchers | Where-Object { $_ } | Select-Object -Unique
}

function Remove-LegacyClaudeLaunchers {
  foreach ($launcher in (Get-LegacyClaudeLaunchers)) {
    if (Test-Path $launcher) {
      Remove-Item -Path $launcher -Force -ErrorAction SilentlyContinue
      if (-not (Test-Path $launcher)) {
        Write-Host "Removed old Claude launcher: $launcher"
      }
    }
  }
}

function Get-ClaudeCandidateDirs([string]$NpmPrefix) {
  $dirs = @()
  if ($NpmPrefix) {
    $dirs += $NpmPrefix
    $dirs += (Join-Path $NpmPrefix "bin")
    $dirs += (Join-Path $NpmPrefix "node_modules\.bin")
  }
  if ($env:APPDATA) {
    $dirs += (Join-Path $env:APPDATA "npm")
  }
  if ($env:LOCALAPPDATA) {
    $dirs += (Join-Path $env:LOCALAPPDATA "Programs\Claude")
  }
  if ($env:USERPROFILE) {
    $dirs += (Join-Path $env:USERPROFILE ".claude\local")
    $dirs += (Join-Path $env:USERPROFILE ".claude\local\bin")
    $dirs += (Join-Path $env:USERPROFILE ".local\bin")
  }
  return $dirs | Where-Object { $_ } | Select-Object -Unique
}

function Add-ClaudeCandidatePaths([string]$NpmPrefix) {
  Add-AnyRoutersClaudePaths $NpmPrefix
}

function Find-ClaudeCommand([string]$NpmPrefix) {
  foreach ($dir in (Get-ClaudeCandidateDirs $NpmPrefix)) {
    foreach ($file in @("claude.cmd", "claude.exe", "claude.ps1", "claude")) {
      $candidate = Join-Path $dir $file
      if (Test-ClaudeCommandWorks $candidate) {
        return $candidate
      }
    }
  }

  foreach ($cmd in @(Get-Command claude -All -ErrorAction SilentlyContinue)) {
    if ($cmd -and $cmd.Source -and (Test-ClaudeCommandWorks $cmd.Source)) {
      return $cmd.Source
    }
  }
  return $null
}

function Test-CmdCanFindClaude {
  cmd.exe /d /c "where claude >nul 2>nul"
  return $LASTEXITCODE -eq 0
}

function Install-ClaudeWithUserNpm {
  if (-not (Get-Command node -ErrorAction SilentlyContinue) -or -not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "X Node.js and npm are required. Install Node.js from https://nodejs.org then re-run."
    return $false
  }

  New-Item -ItemType Directory -Force -Path $NpmPrefix | Out-Null
  Write-Host "Installing Claude Code with npm into: $NpmPrefix"
  npm install -g --prefix "$NpmPrefix" @anthropic-ai/claude-code
  if ($LASTEXITCODE -ne 0) {
    return $false
  }

  Add-ClaudeCandidatePaths $NpmPrefix
  Remove-LegacyClaudeLaunchers
  return $true
}

Write-Host "Installing Claude Code ..."
$installed = $false
try {
  $installer = Invoke-RestMethod -Uri "https://claude.ai/install.ps1" -ErrorAction Stop
  if (Test-InstallerHtml $installer) {
    Write-Host "Official installer returned an HTML page. Skipping it."
  } else {
    Invoke-Expression $installer
    $claudePath = Find-ClaudeCommand $null
    if ($claudePath) {
      $installed = $true
      Add-UserPath (Split-Path -Parent $claudePath) $true
    } else {
      Write-Host "Official installer finished, but claude is not on PATH. Falling back to npm install."
    }
  }
} catch {
  Write-Host "Official installer failed."
}
if (-not $installed) {
  Write-Host "Using npm fallback without administrator permissions ..."
  if (-not (Install-ClaudeWithUserNpm)) {
    return
  }
}
Clear-ClaudeConflictingEnv
Update-ClaudeUserSettings
[Environment]::SetEnvironmentVariable("ANTHROPIC_BASE_URL", "https://api.anyrouters.com", "User")
[Environment]::SetEnvironmentVariable("ANTHROPIC_AUTH_TOKEN", $Key, "User")
[Environment]::SetEnvironmentVariable("ANTHROPIC_MODEL", $Model, "User")
$env:ANTHROPIC_BASE_URL = "https://api.anyrouters.com"
$env:ANTHROPIC_AUTH_TOKEN = $Key
$env:ANTHROPIC_MODEL = $Model
Write-Host ""
$claudeCommand = Find-ClaudeCommand $NpmPrefix
if ($claudeCommand) {
  Add-UserPath (Split-Path -Parent $claudeCommand) $true
}
if ($claudeCommand) {
  & $claudeCommand --version
}

if (Test-CmdCanFindClaude) {
  Write-Host "Done! Open a NEW PowerShell or cmd.exe window and run:  claude"
} else {
  Write-Host "Claude Code may be installed, but cmd.exe cannot find the claude command yet."
  Write-Host "Close all terminal windows, open a NEW cmd.exe, then run:  where claude"
  if ($claudeCommand) {
    Write-Host "Detected claude at: $claudeCommand"
    Write-Host "If where claude is still empty, add this folder to User Path:"
    Write-Host "  $(Split-Path -Parent $claudeCommand)"
  }
}
