# AnyRouters one-line installer - Claude Code. Safe to run more than once.
$Key = $env:ANYROUTERS_KEY
if (-not $Key) {
  Write-Host "X No API key. Run:  `$env:ANYROUTERS_KEY='YOUR_KEY'; irm https://anyrouters.com/install/claude.ps1 | iex"
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
Write-Host "Installing Claude Code ..."
$installed = $false
try {
  $installer = Invoke-RestMethod -Uri "https://claude.ai/install.ps1" -ErrorAction Stop
  Invoke-Expression $installer
  $installed = $true
} catch {
  Write-Host "Official installer failed. Trying npm ..."
}
if (-not $installed) {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "X Node.js is required. Install it from https://nodejs.org then re-run."
    return
  }
  npm install -g @anthropic-ai/claude-code
}
[Environment]::SetEnvironmentVariable("ANTHROPIC_BASE_URL", "https://api.anyrouters.com", "User")
[Environment]::SetEnvironmentVariable("ANTHROPIC_AUTH_TOKEN", $Key, "User")
[Environment]::SetEnvironmentVariable("ANTHROPIC_MODEL", $Model, "User")
$env:ANTHROPIC_BASE_URL = "https://api.anyrouters.com"
$env:ANTHROPIC_AUTH_TOKEN = $Key
$env:ANTHROPIC_MODEL = $Model
Write-Host ""
Write-Host "Done! Open a NEW terminal window, then:  cd your-project; claude"
