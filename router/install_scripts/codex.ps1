# AnyRouters one-line installer - Codex CLI. Safe to run more than once.
$Key = $env:ANYROUTERS_KEY
if (-not $Key) {
  Write-Host "X No API key. Run:  `$env:ANYROUTERS_KEY='YOUR_KEY'; irm https://anyrouters.com/install/codex.ps1 | iex"
  return
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
if (-not $Key -or $Key -match "YOUR_KEY|YOUR_ANYROUTERS_API_KEY") {
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

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "X Node.js is required. Install it from https://nodejs.org then re-run."
  return
}
Write-Host "Installing @openai/codex ..."
npm install -g @openai/codex
$dir = "$HOME\.codex"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
if ($env:ANYROUTERS_RESET -eq "1") {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $backupDir = "$dir\anyrouters-reset-$stamp"
  New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
  foreach ($file in @("config.toml", "auth.json")) {
    $path = "$dir\$file"
    if (Test-Path $path) {
      Move-Item $path "$backupDir\$file" -Force
    }
  }
  Write-Host "Backed up old Codex config to: $backupDir"
} else {
  if (Test-Path "$dir\config.toml") { Copy-Item "$dir\config.toml" "$dir\config.toml.anyrouters.bak" -Force }
  if (Test-Path "$dir\auth.json") { Copy-Item "$dir\auth.json" "$dir\auth.json.anyrouters.bak" -Force }
}
@'
model = "gpt-5.5"
model_provider = "anyrouters"
model_reasoning_effort = "medium"
disable_response_storage = true
cli_auth_credentials_store = "file"

[model_providers.anyrouters]
name = "AnyRouters"
base_url = "https://api.anyrouters.com/v1"
wire_api = "responses"
requires_openai_auth = true
'@ | Set-Content -Encoding UTF8 "$dir\config.toml"
"{`n  ""OPENAI_API_KEY"": ""$Key""`n}" | Set-Content -Encoding UTF8 "$dir\auth.json"
Write-Host ""
Write-Host "Done! Open a NEW terminal window and run:  codex"
