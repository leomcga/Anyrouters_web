# Restore Codex CLI/Desktop to the built-in OpenAI provider without reinstalling Codex.
$ErrorActionPreference = "Stop"

function Write-Utf8NoBom([string]$Path, [string]$Content) {
  $encoding = New-Object System.Text.UTF8Encoding -ArgumentList $false
  [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

function New-CodexProcessStartInfo([string]$CodexExe, [string]$Arguments) {
  $info = New-Object System.Diagnostics.ProcessStartInfo
  $extension = [System.IO.Path]::GetExtension($CodexExe).ToLowerInvariant()
  if ($extension -eq ".cmd" -or $extension -eq ".bat") {
    $info.FileName = $env:ComSpec
    $escaped = $CodexExe.Replace('"', '""')
    $info.Arguments = '/d /s /c ""' + $escaped + '" ' + $Arguments + '"'
  } elseif ($extension -eq ".ps1") {
    $hostExe = Join-Path $PSHOME "powershell.exe"
    if (-not (Test-Path $hostExe)) {
      $hostExe = (Get-Process -Id $PID).Path
    }
    $info.FileName = $hostExe
    $escaped = $CodexExe.Replace('"', '`"')
    $info.Arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $escaped + '" ' + $Arguments
  } else {
    $info.FileName = $CodexExe
    $info.Arguments = $Arguments
  }
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $utf8 = New-Object System.Text.UTF8Encoding -ArgumentList $false
  if ($info.PSObject.Properties.Name -contains "StandardOutputEncoding") {
    $info.StandardOutputEncoding = $utf8
    $info.StandardErrorEncoding = $utf8
  }
  return $info
}

function Invoke-CodexCaptured([string]$CodexExe, [string]$Arguments) {
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = New-CodexProcessStartInfo $CodexExe $Arguments
  try {
    if (-not $process.Start()) {
      throw "Codex process did not start."
    }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $process.WaitForExit()
    return [pscustomobject]@{
      ExitCode = $process.ExitCode
      Stdout = $stdoutTask.Result
      Stderr = $stderrTask.Result
    }
  } finally {
    $process.Dispose()
  }
}

function Resolve-CodexExecutable {
  if ($env:ANYROUTERS_CODEX_BIN -and (Test-Path $env:ANYROUTERS_CODEX_BIN)) {
    return $env:ANYROUTERS_CODEX_BIN
  }
  if ($env:ALLROUTERS_CODEX_BIN -and (Test-Path $env:ALLROUTERS_CODEX_BIN)) {
    return $env:ALLROUTERS_CODEX_BIN
  }
  $command = Get-Command codex -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  foreach ($root in @(
    "$env:LOCALAPPDATA\Programs\ChatGPT",
    "$env:LOCALAPPDATA\OpenAI",
    "$env:ProgramFiles\ChatGPT",
    "$env:ProgramFiles\OpenAI"
  )) {
    if (-not $root -or -not (Test-Path $root)) { continue }
    $match = Get-ChildItem -Path $root -Filter "codex.exe" -File -Recurse -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if ($match) { return $match.FullName }
  }
  return $null
}

function Remove-RouterConfig([string]$Current) {
  $officialResetKeys = @{
    model = $true
    model_provider = $true
    model_catalog_json = $true
    profile = $true
    openai_base_url = $true
    chatgpt_base_url = $true
    experimental_realtime_ws_base_url = $true
  }
  $kept = New-Object System.Collections.Generic.List[string]
  $atRoot = $true
  $skipProvider = $false
  $lines = [System.Text.RegularExpressions.Regex]::Split($Current, "(?<=`n)")

  foreach ($line in $lines) {
    $trimmed = $line.Trim()
    $header = [System.Text.RegularExpressions.Regex]::Match(
      $trimmed,
      '^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(?:#.*)?$'
    )
    if ($header.Success) {
      $section = $header.Groups[1].Value.Trim()
      $skipProvider = (
        $section -in @("model_providers.anyrouters", "model_providers.allrouters") -or
        $section.StartsWith("model_providers.anyrouters.") -or
        $section.StartsWith("model_providers.allrouters.")
      )
      $atRoot = $false
      if ($skipProvider) { continue }
    } elseif ($skipProvider) {
      continue
    }
    if ($atRoot) {
      $assignment = [System.Text.RegularExpressions.Regex]::Match($trimmed, '^([A-Za-z0-9_-]+)\s*=')
      if (
        $assignment.Success -and
        $officialResetKeys.ContainsKey($assignment.Groups[1].Value)
      ) {
        continue
      }
    }
    $kept.Add($line)
  }

  return ([string]::Concat($kept.ToArray())).Trim()
}

function Remove-RouterProfileOverrides([string]$Path) {
  if (-not $Path -or -not (Test-Path $Path)) { return }

  $names = @(
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "OPENAI_API_BASE",
    "OPENAI_API_HOST",
    "OPENAI_ORG_ID",
    "OPENAI_ORGANIZATION",
    "OPENAI_PROJECT",
    "CODEX_API_KEY"
  )
  $namePattern = ($names | ForEach-Object {
    [System.Text.RegularExpressions.Regex]::Escape($_)
  }) -join "|"
  $directAssignment = '^\s*\$env:(?:{0})\s*=' -f $namePattern
  $setItemAssignment = '^\s*Set-Item\s+(?:-Path\s+)?["'']?Env:(?:{0})\b' -f $namePattern
  $setxAssignment = '^\s*setx(?:\.exe)?\s+(?:{0})\b' -f $namePattern
  $blockEnds = @{
    "# anyrouters-codex-managed-begin" = "# anyrouters-codex-managed-end"
    "# allrouters-codex-managed-begin" = "# allrouters-codex-managed-end"
  }

  $current = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
  $kept = New-Object System.Collections.Generic.List[string]
  $expectedEnd = $null
  $changed = $false
  foreach ($line in [System.Text.RegularExpressions.Regex]::Split($current, "(?<=`n)")) {
    $logical = $line.TrimEnd("`r", "`n")
    if ($blockEnds.ContainsKey($logical)) {
      $expectedEnd = $blockEnds[$logical]
      $changed = $true
      continue
    }
    if ($expectedEnd -and $logical -eq $expectedEnd) {
      $expectedEnd = $null
      continue
    }
    if ($expectedEnd) { continue }
    if (
      $logical -match $directAssignment -or
      $logical -match $setItemAssignment -or
      $logical -match $setxAssignment
    ) {
      $changed = $true
      continue
    }
    $kept.Add($line)
  }
  if (-not $changed) { return }

  $backupPath = "$Path.router-official.bak"
  if (-not (Test-Path $backupPath)) {
    Copy-Item $Path $backupPath -Force
  }
  $updated = ([string]::Concat($kept.ToArray())).TrimEnd("`r", "`n")
  if ($updated) { $updated += [Environment]::NewLine }
  $stagePath = "$Path.router-official-$([guid]::NewGuid().ToString("N")).tmp"
  try {
    Write-Utf8NoBom $stagePath $updated
    Move-Item $stagePath $Path -Force
  } finally {
    Remove-Item $stagePath -Force -ErrorAction SilentlyContinue
  }
}

function Test-RestoredConfig([string]$CodexExe, [string]$ConfigPath) {
  $configDir = Split-Path -Parent $ConfigPath
  $validateHome = Join-Path $configDir (".codex-official-validate-" + [guid]::NewGuid().ToString("N"))
  $hadCodexHome = Test-Path Env:CODEX_HOME
  $oldCodexHome = $env:CODEX_HOME
  $hadCodexNonInteractive = Test-Path Env:CODEX_NON_INTERACTIVE
  $oldCodexNonInteractive = $env:CODEX_NON_INTERACTIVE
  $conflictingNames = @(
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "OPENAI_API_BASE",
    "OPENAI_API_HOST",
    "OPENAI_ORG_ID",
    "OPENAI_ORGANIZATION",
    "OPENAI_PROJECT",
    "CODEX_API_KEY"
  )
  $oldConflictingEnv = @{}
  foreach ($name in $conflictingNames) {
    $existing = Get-Item "Env:$name" -ErrorAction SilentlyContinue
    if ($existing) { $oldConflictingEnv[$name] = $existing.Value }
  }
  try {
    New-Item -ItemType Directory -Force -Path $validateHome | Out-Null
    Copy-Item $ConfigPath (Join-Path $validateHome "config.toml") -Force
    foreach ($name in $conflictingNames) {
      [Environment]::SetEnvironmentVariable($name, $null, "Process")
    }
    $env:CODEX_HOME = $validateHome
    $env:CODEX_NON_INTERACTIVE = "1"
    $result = Invoke-CodexCaptured $CodexExe "debug models"
    return $result.ExitCode -eq 0
  } finally {
    if ($hadCodexHome) { $env:CODEX_HOME = $oldCodexHome } else { Remove-Item Env:CODEX_HOME -ErrorAction SilentlyContinue }
    if ($hadCodexNonInteractive) { $env:CODEX_NON_INTERACTIVE = $oldCodexNonInteractive } else { Remove-Item Env:CODEX_NON_INTERACTIVE -ErrorAction SilentlyContinue }
    foreach ($name in $conflictingNames) {
      if ($oldConflictingEnv.ContainsKey($name)) {
        [Environment]::SetEnvironmentVariable($name, $oldConflictingEnv[$name], "Process")
      } else {
        [Environment]::SetEnvironmentVariable($name, $null, "Process")
      }
    }
    Remove-Item $validateHome -Recurse -Force -ErrorAction SilentlyContinue
  }
}

$codexDir = "$HOME\.codex"
$configPath = Join-Path $codexDir "config.toml"
New-Item -ItemType Directory -Force -Path $codexDir | Out-Null

if (Test-Path $configPath) {
  $current = [System.IO.File]::ReadAllText($configPath, [System.Text.Encoding]::UTF8)
  $restored = Remove-RouterConfig $current
  $stagePath = Join-Path $codexDir (".codex-official-" + [guid]::NewGuid().ToString("N") + ".toml")
  Write-Utf8NoBom $stagePath $(if ($restored) { $restored + [Environment]::NewLine } else { "" })
  try {
    $codexExe = Resolve-CodexExecutable
    if (-not $codexExe) {
      throw "X Could not find Codex. Existing configuration was not changed."
    }
    if (-not (Test-RestoredConfig $codexExe $stagePath)) {
      throw "X The restored official config did not validate; existing configuration was not changed."
    }
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss-fff"
    $backupDir = Join-Path $codexDir "codex-official-backup-$stamp"
    New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
    Copy-Item $configPath (Join-Path $backupDir "config.toml") -Force
    [System.IO.File]::Replace(
      $stagePath,
      $configPath,
      (Join-Path $backupDir "config.replace-backup.toml")
    )
    Write-Host "Backed up the previous config to: $backupDir"
  } finally {
    Remove-Item $stagePath -Force -ErrorAction SilentlyContinue
  }
}

foreach ($name in @(
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_API_BASE",
  "OPENAI_API_HOST",
  "OPENAI_ORG_ID",
  "OPENAI_ORGANIZATION",
  "OPENAI_PROJECT",
  "CODEX_API_KEY"
)) {
  [Environment]::SetEnvironmentVariable($name, $null, "Process")
  if ($env:OS -eq "Windows_NT") {
    [Environment]::SetEnvironmentVariable($name, $null, "User")
  }
}

$profilePaths = [System.Collections.Generic.HashSet[string]]::new(
  [System.StringComparer]::OrdinalIgnoreCase
)
foreach ($candidate in @(
  $PROFILE.CurrentUserCurrentHost,
  $PROFILE.CurrentUserAllHosts,
  (Join-Path $HOME "Documents/PowerShell/Microsoft.PowerShell_profile.ps1"),
  (Join-Path $HOME "Documents/PowerShell/profile.ps1"),
  (Join-Path $HOME "Documents/WindowsPowerShell/Microsoft.PowerShell_profile.ps1"),
  (Join-Path $HOME "Documents/WindowsPowerShell/profile.ps1")
)) {
  if ($candidate) { [void]$profilePaths.Add($candidate) }
}
foreach ($profilePath in $profilePaths) {
  Remove-RouterProfileOverrides $profilePath
}

Write-Host ""
Write-Host "Done! Active third-party/OpenAI API routing overrides were removed; Codex now uses the built-in OpenAI provider."
Write-Host "Unselected third-party provider definitions were preserved and are no longer active."
Write-Host "Codex was not uninstalled, and auth.json, MCP, plugins, tools, and chat history were preserved."
Write-Host "Open a NEW PowerShell window and run: codex login status"
Write-Host "If it does not show ChatGPT sign-in, run: codex logout"
Write-Host "Then run: codex login"
