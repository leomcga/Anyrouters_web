# AnyRouters one-line config writer - Codex desktop/app. Safe to run more than once.
$ErrorActionPreference = "Stop"
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch {}

$Key = $env:ANYROUTERS_KEY
if (-not $Key) {
  Write-Host "X No API key. Run:  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12; `$env:ANYROUTERS_KEY='YOUR_KEY'; irm https://anyrouters.com/install/codex-config.ps1 | iex"
  return
}
$Model = $env:ANYROUTERS_MODEL
if (-not $Model) {
  $Model = "gpt-5.6-sol"
}
$ConflictingCodexEnvNames = @(
  "OPENAI_BASE_URL",
  "OPENAI_API_BASE",
  "OPENAI_API_HOST",
  "OPENAI_ORG_ID",
  "OPENAI_ORGANIZATION",
  "OPENAI_PROJECT",
  "CODEX_API_KEY"
)

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

function Write-Utf8NoBom([string]$Path, [string]$Content) {
  $encoding = New-Object System.Text.UTF8Encoding -ArgumentList $false
  [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

function Resolve-CodexExecutable([bool]$PreferDesktop) {
  if ($env:ANYROUTERS_CODEX_BIN -and (Test-Path $env:ANYROUTERS_CODEX_BIN)) {
    return $env:ANYROUTERS_CODEX_BIN
  }
  $desktopRoots = @(
    "$env:LOCALAPPDATA\Programs\ChatGPT",
    "$env:LOCALAPPDATA\OpenAI",
    "$env:ProgramFiles\ChatGPT",
    "$env:ProgramFiles\OpenAI"
  ) | Where-Object { $_ -and (Test-Path $_) }
  try {
    $desktopRoots += Get-AppxPackage -Name "*ChatGPT*" -ErrorAction SilentlyContinue |
      ForEach-Object { $_.InstallLocation } |
      Where-Object { $_ -and (Test-Path $_) }
  } catch {}

  if ($PreferDesktop) {
    foreach ($root in $desktopRoots) {
      $match = Get-ChildItem -Path $root -Filter "codex.exe" -File -Recurse -ErrorAction SilentlyContinue |
        Select-Object -First 1
      if ($match) { return $match.FullName }
    }
  }

  $command = Get-Command codex -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  $localCodex = "$HOME\.local\bin\codex.exe"
  if (Test-Path $localCodex) { return $localCodex }

  if (-not $PreferDesktop) {
    foreach ($root in $desktopRoots) {
      $match = Get-ChildItem -Path $root -Filter "codex.exe" -File -Recurse -ErrorAction SilentlyContinue |
        Select-Object -First 1
      if ($match) { return $match.FullName }
    }
  }
  return $null
}

function Move-AtomicFile([string]$Source, [string]$Destination) {
  if (Test-Path $Destination) {
    [System.IO.File]::Replace($Source, $Destination, $null)
  } else {
    [System.IO.File]::Move($Source, $Destination)
  }
}

function Install-Gpt56CompatibilityCatalog(
  [string]$Dir,
  [string]$CodexExe,
  [string]$SelectedModel,
  [string]$ApiKey
) {
  $catalogPath = [System.IO.Path]::GetFullPath((Join-Path $Dir "model-catalog-anyrouters-gpt56.json"))
  $workDir = Join-Path $Dir (".anyrouters-gpt56-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Force -Path $workDir | Out-Null
  $temporaryCodexHome = Join-Path $workDir "codex-home"
  New-Item -ItemType Directory -Force -Path $temporaryCodexHome | Out-Null
  $hadCodexHome = Test-Path Env:CODEX_HOME
  $oldCodexHome = $env:CODEX_HOME

  try {
    Write-Host "Reading the current complete Codex model catalog ..."
    $env:CODEX_HOME = $temporaryCodexHome
    $rawCatalog = (& $CodexExe debug models 2>$null) -join [Environment]::NewLine
    if ($LASTEXITCODE -ne 0 -or -not $rawCatalog) {
      throw "X Codex could not export its current model catalog. Existing configuration was not changed."
    }
    try {
      $catalog = $rawCatalog | ConvertFrom-Json
    } catch {
      throw "X Codex returned an invalid model catalog. Existing configuration was not changed."
    }

    $wanted = @("gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna")
    $patched = @()
    foreach ($entry in @($catalog.models)) {
      if ($entry.slug -in $wanted) {
        $entry | Add-Member -NotePropertyName use_responses_lite -NotePropertyValue $false -Force
        $entry | Add-Member -NotePropertyName multi_agent_version -NotePropertyValue $null -Force
        $entry | Add-Member -NotePropertyName tool_mode -NotePropertyValue $null -Force
        $patched += $entry.slug
      }
    }
    $missing = @($wanted | Where-Object { $_ -notin $patched })
    if ($missing.Count -gt 0) {
      throw ("X Current Codex model catalog is missing: " + ($missing -join ", ") + ". Existing configuration was not changed.")
    }

    $catalogStage = Join-Path $workDir "model-catalog.json"
    $configStage = Join-Path $workDir "config.toml"
    $authStage = Join-Path $workDir "auth.json"
    Write-Utf8NoBom $catalogStage (($catalog | ConvertTo-Json -Depth 100) + [Environment]::NewLine)

    $modelLiteral = $SelectedModel | ConvertTo-Json -Compress
    $catalogLiteral = $catalogPath | ConvertTo-Json -Compress
    $configToml = @"
model = $modelLiteral
model_provider = "anyrouters"
model_reasoning_effort = "medium"
disable_response_storage = true
model_catalog_json = $catalogLiteral

[model_providers.anyrouters]
name = "AnyRouters"
base_url = "https://api.anyrouters.com/v1"
wire_api = "responses"
env_key = "OPENAI_API_KEY"
"@
    Write-Utf8NoBom $configStage ($configToml + [Environment]::NewLine)
    $authJson = @{ OPENAI_API_KEY = $ApiKey } | ConvertTo-Json -Depth 10
    Write-Utf8NoBom $authStage ($authJson + [Environment]::NewLine)

    $stamp = Get-Date -Format "yyyyMMdd-HHmmss-fff"
    $backupDir = Join-Path $Dir "anyrouters-backup-$stamp"
    New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
    foreach ($file in @("config.toml", "auth.json", "model-catalog-anyrouters-gpt56.json")) {
      $path = Join-Path $Dir $file
      if (Test-Path $path) { Copy-Item $path (Join-Path $backupDir $file) -Force }
    }
    Write-Host "Backed up old Codex files to: $backupDir"
    Write-Host "Restore files from this directory if you need to roll back."

    Move-AtomicFile $catalogStage $catalogPath
    Move-AtomicFile $configStage (Join-Path $Dir "config.toml")
    Move-AtomicFile $authStage (Join-Path $Dir "auth.json")
    Write-Host ("Patched GPT-5.6 compatibility metadata: " + (($patched | Sort-Object) -join ", "))
  } finally {
    if ($hadCodexHome) { $env:CODEX_HOME = $oldCodexHome } else { Remove-Item Env:CODEX_HOME -ErrorAction SilentlyContinue }
    Remove-Item $workDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Clear-CodexConflictingEnv {
  foreach ($name in $ConflictingCodexEnvNames) {
    [Environment]::SetEnvironmentVariable($name, $null, "User")
    Remove-Item "Env:$name" -ErrorAction SilentlyContinue
  }
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

$dir = "$HOME\.codex"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$codexExe = Resolve-CodexExecutable $true
if (-not $codexExe) {
  throw "X Could not find Codex. Install the desktop app (or Codex CLI), then re-run this command."
}
Install-Gpt56CompatibilityCatalog $dir $codexExe $Model $Key
Clear-CodexConflictingEnv
[Environment]::SetEnvironmentVariable("OPENAI_API_KEY", $Key, "User")
$env:OPENAI_API_KEY = $Key
setx OPENAI_API_KEY "$Key" | Out-Null

Write-Host "Cleared old Codex/OpenAI-compatible settings that could override AnyRouters."
Write-Host ""
Write-Host "Done! Fully quit Codex desktop, reopen it, and start a NEW task."
Write-Host "GPT-5.6 compatibility mode disables native collaboration/subagents for Sol, Terra, and Luna."
Write-Host "Normal chat, shell commands, and file tools remain available. Re-run after every Codex upgrade."
