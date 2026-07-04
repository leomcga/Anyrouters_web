# AnyRouters one-line installer - Codex CLI. Safe to run more than once.
$Key = $env:ANYROUTERS_KEY
if (-not $Key) {
  Write-Host "X No API key. Run:  `$env:ANYROUTERS_KEY='YOUR_KEY'; irm https://anyrouters.com/install/codex.ps1 | iex"
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
if (Test-Path "$dir\config.toml") { Copy-Item "$dir\config.toml" "$dir\config.toml.anyrouters.bak" -Force }
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
if (Test-Path "$dir\auth.json") { Copy-Item "$dir\auth.json" "$dir\auth.json.anyrouters.bak" -Force }
"{`n  ""OPENAI_API_KEY"": ""$Key""`n}" | Set-Content -Encoding UTF8 "$dir\auth.json"
Write-Host ""
Write-Host "Done! Open a NEW terminal window and run:  codex"
