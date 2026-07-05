# AnyRouters one-line config writer - Codex desktop/app. Safe to run more than once.
$Key = $env:ANYROUTERS_KEY
if (-not $Key) {
  Write-Host "X No API key. Run:  `$env:ANYROUTERS_KEY='YOUR_KEY'; irm https://anyrouters.com/install/codex-config.ps1 | iex"
  return
}

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

[model_providers.anyrouters]
name = "AnyRouters"
base_url = "https://api.anyrouters.com/v1"
wire_api = "responses"
'@ | Set-Content -Encoding UTF8 "$dir\config.toml"

"{`n  ""OPENAI_API_KEY"": ""$Key""`n}" | Set-Content -Encoding UTF8 "$dir\auth.json"

Write-Host ""
Write-Host "Done! Fully quit and reopen Codex desktop, then send a message."
