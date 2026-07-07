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

function Test-InstallerHtml([string]$Content) {
  if (-not $Content) {
    return $true
  }
  return $Content.Substring(0, [Math]::Min(512, $Content.Length)) -match "(?is)<!doctype html|<html|</html"
}

function Add-UserPath([string]$PathToAdd) {
  if (-not $PathToAdd) {
    return
  }

  $currentUserPath = [Environment]::GetEnvironmentVariable("Path", "User")
  if (-not $currentUserPath) {
    $currentUserPath = [Environment]::GetEnvironmentVariable("PATH", "User")
  }

  $parts = @()
  if ($currentUserPath) {
    $parts = $currentUserPath -split ';' | Where-Object { $_ }
  }
  if (-not ($parts | Where-Object { $_ -ieq $PathToAdd })) {
    $nextPath = if ($currentUserPath) { "$currentUserPath;$PathToAdd" } else { $PathToAdd }
    [Environment]::SetEnvironmentVariable("Path", $nextPath, "User")
  }
  if (-not (($env:PATH -split ';') | Where-Object { $_ -ieq $PathToAdd })) {
    $env:PATH = "$PathToAdd;$env:PATH"
  }
}

function Install-ClaudeWithUserNpm {
  if (-not (Get-Command node -ErrorAction SilentlyContinue) -or -not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "X Node.js and npm are required. Install Node.js from https://nodejs.org then re-run."
    return $false
  }

  $npmPrefix = if ($env:ANYROUTERS_NPM_PREFIX) { $env:ANYROUTERS_NPM_PREFIX } else { Join-Path $env:LOCALAPPDATA "AnyRouters\npm" }
  New-Item -ItemType Directory -Force -Path $npmPrefix | Out-Null
  Write-Host "Installing Claude Code with npm into: $npmPrefix"
  npm install -g --prefix "$npmPrefix" @anthropic-ai/claude-code
  if ($LASTEXITCODE -ne 0) {
    return $false
  }

  Add-UserPath $npmPrefix
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
    if (Get-Command claude -ErrorAction SilentlyContinue) {
      $installed = $true
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
[Environment]::SetEnvironmentVariable("ANTHROPIC_BASE_URL", "https://api.anyrouters.com", "User")
[Environment]::SetEnvironmentVariable("ANTHROPIC_AUTH_TOKEN", $Key, "User")
[Environment]::SetEnvironmentVariable("ANTHROPIC_MODEL", $Model, "User")
$env:ANTHROPIC_BASE_URL = "https://api.anyrouters.com"
$env:ANTHROPIC_AUTH_TOKEN = $Key
$env:ANTHROPIC_MODEL = $Model
Write-Host ""
if (Get-Command claude -ErrorAction SilentlyContinue) {
  claude --version
} else {
  Write-Host "Claude Code is installed, but the claude command is not on this terminal's PATH yet."
  Write-Host "Close this terminal and open a NEW PowerShell or cmd.exe, then run:  claude --version"
}
Write-Host "Done! Open a NEW PowerShell or cmd.exe window and run:  claude"
