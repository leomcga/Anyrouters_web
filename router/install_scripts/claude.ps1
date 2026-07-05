# AnyRouters one-line installer - Claude Code. Safe to run more than once.
$Key = $env:ANYROUTERS_KEY
if (-not $Key) {
  Write-Host "X No API key. Run:  `$env:ANYROUTERS_KEY='YOUR_KEY'; irm https://anyrouters.com/install/claude.ps1 | iex"
  return
}
$Reset = $env:ANYROUTERS_RESET -eq "1"
if ($Reset) {
  Write-Host "Resetting AnyRouters Claude Code environment ..."
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "X Node.js is required. Install it from https://nodejs.org then re-run."
  return
}
Write-Host "Installing @anthropic-ai/claude-code ..."
npm install -g @anthropic-ai/claude-code
[Environment]::SetEnvironmentVariable("ANTHROPIC_BASE_URL", "https://api.anyrouters.com", "User")
[Environment]::SetEnvironmentVariable("ANTHROPIC_AUTH_TOKEN", $Key, "User")
[Environment]::SetEnvironmentVariable("ANTHROPIC_MODEL", "claude-sonnet-4-6", "User")
$env:ANTHROPIC_BASE_URL = "https://api.anyrouters.com"
$env:ANTHROPIC_AUTH_TOKEN = $Key
$env:ANTHROPIC_MODEL = "claude-sonnet-4-6"
Write-Host ""
Write-Host "Done! Open a NEW terminal window, then:  cd your-project; claude"
