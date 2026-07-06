# AnyRouters one-line installer - Codex CLI. Safe to run more than once.
$Key = $env:ANYROUTERS_KEY
if (-not $Key) {
  Write-Host "X No API key. Run:  `$env:ANYROUTERS_KEY='YOUR_KEY'; irm https://anyrouters.com/install/codex.ps1 | iex"
  return
}
$Model = $env:ANYROUTERS_MODEL
if (-not $Model) {
  $Model = "gpt-5.5"
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

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "X Node.js is required. Install it from https://nodejs.org then re-run."
  return
}
Write-Host "Installing @openai/codex ..."
npm install -g @openai/codex
$dir = "$HOME\.codex"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
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
@"
model = "$Model"
model_provider = "anyrouters"
model_reasoning_effort = "medium"
disable_response_storage = true

[model_providers.anyrouters]
name = "AnyRouters"
base_url = "https://api.anyrouters.com/v1"
wire_api = "responses"
env_key = "OPENAI_API_KEY"
"@ | Set-Content -Encoding UTF8 "$dir\config.toml"
"{`n  ""OPENAI_API_KEY"": ""$Key""`n}" | Set-Content -Encoding UTF8 "$dir\auth.json"
[Environment]::SetEnvironmentVariable("OPENAI_API_KEY", $Key, "User")
setx OPENAI_API_KEY "$Key" | Out-Null
Write-Host ""
Write-Host "Done! Open a NEW terminal window and run:  codex"
