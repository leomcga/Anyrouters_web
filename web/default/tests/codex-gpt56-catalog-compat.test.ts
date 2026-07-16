import { afterEach, expect, test } from 'bun:test'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const scriptsDir = resolve(import.meta.dir, '../../../router/install_scripts')
const tempDirs: string[] = []
const pwshBin =
  process.env.PWSH_BIN ||
  spawnSync('/bin/sh', ['-lc', 'command -v pwsh'], { encoding: 'utf8' }).stdout.trim()

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function source(name: string) {
  return readFileSync(join(scriptsDir, name), 'utf8')
}

function fixture(
  options: {
    includeLuna?: boolean
    nativeCapabilities?: boolean
    emptyNativeCapabilities?: boolean
  } = {}
) {
  const includeLuna = options.includeLuna ?? true
  const nativeCapabilities = options.nativeCapabilities ?? true
  return {
    generated_at: 'native-fixture',
    models: [
      {
        slug: 'gpt-5.5',
        use_responses_lite: false,
        multi_agent_version: null,
        tool_mode: null,
      },
      {
        slug: 'gpt-5.6-sol',
        use_responses_lite: true,
        multi_agent_version: options.emptyNativeCapabilities
          ? ''
          : nativeCapabilities
            ? 'v2'
            : null,
        tool_mode: options.emptyNativeCapabilities
          ? ''
          : nativeCapabilities
            ? 'code_mode_only'
            : null,
      },
      {
        slug: 'gpt-5.6-terra',
        use_responses_lite: true,
        multi_agent_version: 'v2',
        tool_mode: 'code_mode_only',
      },
      ...(includeLuna
        ? [
            {
              slug: 'gpt-5.6-luna',
              use_responses_lite: true,
              multi_agent_version: 'v1',
              tool_mode: 'code_mode_only',
            },
          ]
        : []),
    ],
  }
}

function isolatedShellFixture(
  options: {
    includeLuna?: boolean
    nativeCapabilities?: boolean
    emptyNativeCapabilities?: boolean
  } = {}
) {
  const root = mkdtempSync(join(tmpdir(), 'anyrouters-codex-native-'))
  tempDirs.push(root)
  const home = join(root, 'home')
  const bin = join(root, 'bin')
  mkdirSync(home)
  mkdirSync(bin)
  const fixturePath = join(root, 'catalog.json')
  const codexLog = join(root, 'codex.log')
  writeFileSync(fixturePath, JSON.stringify(fixture(options)))

  const codex = join(bin, 'codex')
  writeFileSync(
    codex,
    `#!/bin/sh
printf '%s|%s|%s %s|%s\n' "\${CODEX_HOME:-missing}" "\${CODEX_NON_INTERACTIVE:-missing}" "\${1:-}" "\${2:-}" "\${OPENAI_BASE_URL:-missing}" >> "$CODEX_LOG"
if [ "\${1:-}" = "--version" ]; then echo 'codex-cli test'; exit 0; fi
if [ "\${1:-}" = "debug" ] && [ "\${2:-}" = "models" ]; then
  if [ -f "\${CODEX_HOME:-}/config.toml" ] && grep -q 'BROKEN_CONFIG' "\${CODEX_HOME}/config.toml"; then exit 9; fi
  exec /bin/cat "$CATALOG_FIXTURE"
fi
exit 2
`
  )
  chmodSync(codex, 0o755)

  const curl = join(bin, 'curl')
  writeFileSync(
    curl,
    `#!/bin/sh
case "$*" in
  *api.anyrouters.com/v1/models*) printf '200'; exit 0 ;;
  *chatgpt.com/codex/install.sh*)
    previous=''
    for argument in "$@"; do
      if [ "$previous" = '-o' ]; then printf '#!/bin/sh\nexit 0\n' > "$argument"; exit 0; fi
      previous="$argument"
    done
    ;;
esac
exit 3
`
  )
  chmodSync(curl, 0o755)

  const env = {
    ...process.env,
    HOME: home,
    SHELL: '/bin/bash',
    PATH: `${bin}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`,
    CODEX_HOME: join(root, 'external-codex-home-must-survive'),
    OPENAI_API_KEY: 'old-env-key',
    OPENAI_BASE_URL: 'https://old-relay.invalid/v1',
    CODEX_API_KEY: 'old-codex-key',
    ANYROUTERS_CODEX_BIN: codex,
    CATALOG_FIXTURE: fixturePath,
    CODEX_LOG: codexLog,
  }

  return {
    root,
    home,
    codexLog,
    env,
    run(script: 'codex.sh' | 'codex-config.sh', key = 'sk-test-native') {
      return spawnSync('bash', [join(scriptsDir, script), key], {
        env,
        encoding: 'utf8',
      })
    },
  }
}

function isolatedPowerShellFixture() {
  const root = mkdtempSync(join(tmpdir(), 'anyrouters-codex-native-pwsh-'))
  tempDirs.push(root)
  const home = join(root, 'home')
  const bin = join(root, 'bin')
  const codexDir = join(home, '.codex')
  mkdirSync(home)
  mkdirSync(bin)
  mkdirSync(codexDir)
  const fixturePath = join(root, 'catalog.json')
  const codexLog = join(root, 'codex.log')
  const statePath = join(root, 'state.txt')
  const wrapperPath = join(root, 'wrapper.ps1')
  writeFileSync(fixturePath, JSON.stringify(fixture()))

  const codex = join(bin, 'codex')
  writeFileSync(
    codex,
    `#!/bin/sh
printf '%s|%s|%s %s|%s\n' "\${CODEX_HOME:-missing}" "\${CODEX_NON_INTERACTIVE:-missing}" "\${1:-}" "\${2:-}" "\${OPENAI_BASE_URL:-missing}" >> "$CODEX_LOG"
if [ "\${1:-}" = "--version" ]; then echo 'codex-cli pwsh-test'; exit 0; fi
if [ "\${1:-}" = "debug" ] && [ "\${2:-}" = "models" ]; then exec /bin/cat "$CATALOG_FIXTURE"; fi
exit 2
`
  )
  chmodSync(codex, 0o755)

  writeFileSync(
    wrapperPath,
    `param([string]$ScriptPath, [string]$StatePath)
function Invoke-RestMethod {
  param(
    [string]$Method,
    [string]$Uri,
    [hashtable]$Headers,
    [int]$TimeoutSec,
    [string]$ErrorAction
  )
  if ($Uri -like '*chatgpt.com/codex/install.ps1') {
    return '$global:AnyRoutersInstallerStubRan = $true'
  }
  return [pscustomobject]@{}
}
. $ScriptPath
$legacyBaseUrl = [Environment]::GetEnvironmentVariable('OPENAI_BASE_URL', 'Process')
if (-not $legacyBaseUrl) { $legacyBaseUrl = 'missing' }
[System.IO.File]::WriteAllText(
  $StatePath,
  "$($env:CODEX_HOME)|$($env:CODEX_NON_INTERACTIVE)|$legacyBaseUrl",
  [System.Text.UTF8Encoding]::new($false)
)
`
  )

  const oldConfig = `model = "old-model"
model_provider = "old-provider"
model_reasoning_effort = "xhigh"
model_catalog_json = "old-catalog.json"

[mcp_servers.notion]
url = "https://mcp.notion.com/mcp"

[model_providers.anyrouters]
name = "Replace Me"
`
  writeFileSync(join(codexDir, 'config.toml'), oldConfig)
  writeFileSync(join(codexDir, 'auth.json'), 'desktop-login')
  writeFileSync(join(codexDir, 'anyrouters-api-key'), 'old-key\n')
  writeFileSync(join(codexDir, 'model-catalog-anyrouters-gpt56.json'), 'old-catalog')

  const env = {
    ...process.env,
    HOME: home,
    ANYROUTERS_KEY: 'sk-pwsh-native',
    ANYROUTERS_CODEX_BIN: codex,
    CATALOG_FIXTURE: fixturePath,
    CODEX_LOG: codexLog,
    CODEX_HOME: join(root, 'external-codex-home-must-survive'),
    CODEX_NON_INTERACTIVE: 'keep-existing-value',
    OPENAI_API_KEY: 'old-env-key',
    OPENAI_BASE_URL: 'https://old-relay.invalid/v1',
    CODEX_API_KEY: 'old-codex-key',
  }

  return {
    home,
    codexDir,
    codexLog,
    statePath,
    run(script: 'codex.ps1' | 'codex-config.ps1') {
      return spawnSync(
        pwshBin,
        ['-NoLogo', '-NoProfile', '-File', wrapperPath, join(scriptsDir, script), statePath],
        { env, encoding: 'utf8' }
      )
    },
  }
}

function assertNativeConfig(home: string, key = 'sk-test-native') {
  const codexDir = join(home, '.codex')
  const config = readFileSync(join(codexDir, 'config.toml'), 'utf8')
  const keyPath = join(codexDir, 'anyrouters-api-key')
  expect(config).toContain('model = "gpt-5.6-sol"')
  expect(config).toContain('model_provider = "anyrouters"')
  expect(config).toContain('[model_providers.anyrouters.auth]')
  expect(config).toContain('command = "/bin/cat"')
  expect(config).toContain(JSON.stringify(keyPath))
  expect(config).not.toContain('model_catalog_json')
  expect(config).not.toContain('model_reasoning_effort = "medium"')
  expect(config).not.toContain('env_key = "OPENAI_API_KEY"')
  expect(readFileSync(keyPath, 'utf8')).toBe(`${key}\n`)
  expect(statSync(keyPath).mode & 0o777).toBe(0o600)
  expect(existsSync(join(codexDir, 'model-catalog-anyrouters-gpt56.json'))).toBe(false)
  expect(readdirSync(codexDir).some((name) => name.startsWith('.anyrouters-native.'))).toBe(
    false
  )
  expect(existsSync(join(codexDir, '.anyrouters-native.lock'))).toBe(false)
}

for (const script of ['codex.sh', 'codex-config.sh'] as const) {
  test(`${script} uses the native catalog without forcing reasoning or patching metadata`, () => {
    const run = isolatedShellFixture()
    const result = run.run(script)
    expect(result.status, result.stderr + result.stdout).toBe(0)
    assertNativeConfig(run.home)
    const calls = readFileSync(run.codexLog, 'utf8').trim().split('\n')
    expect(calls.length).toBeGreaterThanOrEqual(2)
    expect(calls.every((line) => !line.startsWith(run.env.CODEX_HOME))).toBe(true)
    expect(calls.every((line) => line.includes('|1|debug models'))).toBe(true)
    expect(calls.every((line) => line.endsWith('|missing'))).toBe(true)
  })

  test(`${script} migrates the legacy override while preserving user configuration`, () => {
    const run = isolatedShellFixture()
    const codexDir = join(run.home, '.codex')
    mkdirSync(codexDir)
    const oldCatalogPath = join(codexDir, 'model-catalog-anyrouters-gpt56.json')
    const oldConfig = `model = "old-model"
model_provider = "old-provider"
model_reasoning_effort = "xhigh"
disable_response_storage = true
model_catalog_json = ${JSON.stringify(oldCatalogPath)}
approval_policy = "on-request"

[mcp_servers.notion]
url = "https://mcp.notion.com/mcp"

[features]
apps = true

[model_providers.anyrouters]
name = "Replace Me"
base_url = "https://old.invalid/v1"

[model_providers.anyrouters.auth]
command = "old-helper"

[model_providers.old-provider]
name = "Keep Me"
`
    const oldAuth = '{"auth_mode":"chatgpt","tokens":{"access_token":"keep"}}'
    writeFileSync(join(codexDir, 'config.toml'), oldConfig)
    writeFileSync(join(codexDir, 'auth.json'), oldAuth)
    writeFileSync(join(codexDir, 'anyrouters-api-key'), 'old-key\n')
    writeFileSync(oldCatalogPath, 'old-catalog')
    const oldProfile = `keep-profile-line
export OPENAI_BASE_URL="https://old-relay.invalid/v1"
OPENAI_API_KEY="old-key"
export AWS_ACCESS_KEY_ID="keep-aws"
export HTTPS_PROXY="http://keep-proxy.invalid"
`
    writeFileSync(join(run.home, '.bashrc'), oldProfile)

    const result = run.run(script, 'sk-new-native')
    expect(result.status, result.stderr + result.stdout).toBe(0)
    const config = readFileSync(join(codexDir, 'config.toml'), 'utf8')
    expect(config).toContain('model_reasoning_effort = "xhigh"')
    expect(config).toContain('disable_response_storage = true')
    expect(config).toContain('approval_policy = "on-request"')
    expect(config).toContain('[mcp_servers.notion]')
    expect(config).toContain('[features]')
    expect(config).toContain('[model_providers.old-provider]')
    expect(config).not.toContain('model_catalog_json')
    expect(config).not.toContain('https://old.invalid/v1')
    expect(readFileSync(join(codexDir, 'auth.json'), 'utf8')).toBe(oldAuth)
    expect(readFileSync(oldCatalogPath, 'utf8')).toBe('old-catalog')
    const updatedProfile = readFileSync(join(run.home, '.bashrc'), 'utf8')
    expect(updatedProfile).toContain('keep-profile-line')
    expect(updatedProfile).toContain('AWS_ACCESS_KEY_ID="keep-aws"')
    expect(updatedProfile).toContain('HTTPS_PROXY="http://keep-proxy.invalid"')
    expect(updatedProfile).not.toContain('https://old-relay.invalid/v1')
    expect(updatedProfile).not.toContain('OPENAI_API_KEY="old-key"')
    expect(updatedProfile).toContain('# anyrouters-codex-managed-begin')
    expect(updatedProfile).toContain('unset OPENAI_BASE_URL')
    expect(updatedProfile).toContain('unset OPENAI_API_KEY')
    expect(readFileSync(join(run.home, '.bashrc.anyrouters.bak'), 'utf8')).toBe(oldProfile)
    expect(existsSync(join(run.home, '.bash_profile'))).toBe(false)
    expect(readFileSync(join(run.home, '.profile'), 'utf8')).toContain(
      'unset OPENAI_BASE_URL'
    )
    expect(readFileSync(join(codexDir, 'anyrouters-api-key'), 'utf8')).toBe('sk-new-native\n')

    const backups = readdirSync(codexDir).filter((name) =>
      name.startsWith('anyrouters-native-backup-')
    )
    expect(backups).toHaveLength(1)
    const backup = join(codexDir, backups[0])
    expect(readFileSync(join(backup, 'config.toml'), 'utf8')).toBe(oldConfig)
    expect(readFileSync(join(backup, 'auth.json'), 'utf8')).toBe(oldAuth)
    expect(readFileSync(join(backup, 'anyrouters-api-key'), 'utf8')).toBe('old-key\n')
    expect(readFileSync(join(backup, 'model-catalog-anyrouters-gpt56.json'), 'utf8')).toBe(
      'old-catalog'
    )
  })

  test(`${script} fails closed when a required native model is missing`, () => {
    const run = isolatedShellFixture({ includeLuna: false })
    const result = run.run(script)
    const codexDir = join(run.home, '.codex')
    expect(result.status).not.toBe(0)
    expect(result.stderr + result.stdout).toContain('gpt-5.6-luna')
    expect(existsSync(join(codexDir, 'config.toml'))).toBe(false)
    expect(existsSync(join(codexDir, 'anyrouters-api-key'))).toBe(false)
    expect(readdirSync(codexDir).some((name) => name.startsWith('anyrouters-native-backup-'))).toBe(
      false
    )
  })

  test(`${script} fails closed when native collaboration or tools are unavailable`, () => {
    const run = isolatedShellFixture({ nativeCapabilities: false })
    const result = run.run(script)
    expect(result.status).not.toBe(0)
    expect(result.stderr + result.stdout).toContain('native collaboration/tool metadata')
    expect(existsSync(join(run.home, '.codex', 'config.toml'))).toBe(false)
  })

  test(`${script} rejects empty native collaboration or tool metadata`, () => {
    const run = isolatedShellFixture({ emptyNativeCapabilities: true })
    const result = run.run(script)
    expect(result.status).not.toBe(0)
    expect(result.stderr + result.stdout).toContain('native collaboration/tool metadata')
    expect(existsSync(join(run.home, '.codex', 'config.toml'))).toBe(false)
  })

  test(`${script} is idempotent when configuration and key are unchanged`, () => {
    const run = isolatedShellFixture()
    const first = run.run(script)
    expect(first.status, first.stderr + first.stdout).toBe(0)
    const second = run.run(script)
    expect(second.status, second.stderr + second.stdout).toBe(0)
    expect(second.stdout).toContain('already up to date')
    const backups = readdirSync(join(run.home, '.codex')).filter((name) =>
      name.startsWith('anyrouters-native-backup-')
    )
    expect(backups).toHaveLength(1)
  })

  test(`${script} leaves an invalid existing configuration byte-for-byte unchanged`, () => {
    const run = isolatedShellFixture()
    const codexDir = join(run.home, '.codex')
    mkdirSync(codexDir)
    writeFileSync(join(codexDir, 'config.toml'), 'BROKEN_CONFIG')
    writeFileSync(join(codexDir, 'auth.json'), 'desktop-login')
    writeFileSync(join(codexDir, 'anyrouters-api-key'), 'old-key\n')
    const result = run.run(script)
    expect(result.status).not.toBe(0)
    expect(result.stderr + result.stdout).toContain('config.toml is invalid')
    expect(readFileSync(join(codexDir, 'config.toml'), 'utf8')).toBe('BROKEN_CONFIG')
    expect(readFileSync(join(codexDir, 'auth.json'), 'utf8')).toBe('desktop-login')
    expect(readFileSync(join(codexDir, 'anyrouters-api-key'), 'utf8')).toBe('old-key\n')
    expect(readdirSync(codexDir).some((name) => name.startsWith('anyrouters-native-backup-'))).toBe(
      false
    )
  })
}

const powerShellTest = pwshBin ? test : test.skip
powerShellTest('PowerShell installers execute safely in an isolated Codex home', () => {
  for (const script of ['codex.ps1', 'codex-config.ps1'] as const) {
    const run = isolatedPowerShellFixture()
    const first = run.run(script)
    expect(first.status, first.stderr + first.stdout).toBe(0)
    const config = readFileSync(join(run.codexDir, 'config.toml'), 'utf8')
    expect(config).toContain('model = "gpt-5.6-sol"')
    expect(config).toContain('model_provider = "anyrouters"')
    expect(config).toContain('model_reasoning_effort = "xhigh"')
    expect(config).toContain('[mcp_servers.notion]')
    expect(config).toContain('[model_providers.anyrouters.auth]')
    expect(config).toContain('command = "powershell.exe"')
    expect(config).not.toContain('model_catalog_json')
    expect(readFileSync(join(run.codexDir, 'auth.json'), 'utf8')).toBe('desktop-login')
    expect(readFileSync(join(run.codexDir, 'anyrouters-api-key'), 'utf8')).toBe(
      'sk-pwsh-native\n'
    )
    expect(readFileSync(run.statePath, 'utf8')).toContain(
      'external-codex-home-must-survive|keep-existing-value|missing'
    )
    const codexCalls = readFileSync(run.codexLog, 'utf8').split('\n').filter(Boolean)
    expect(codexCalls.every((line) => line.includes('|1|'))).toBe(true)
    expect(codexCalls.every((line) => line.endsWith('|missing'))).toBe(true)

    const second = run.run(script)
    expect(second.status, second.stderr + second.stdout).toBe(0)
    expect(second.stdout).toContain('already up to date')
    expect(
      readdirSync(run.codexDir).filter((name) =>
        name.startsWith('anyrouters-native-backup-')
      )
    ).toHaveLength(1)
    expect(existsSync(join(run.codexDir, '.anyrouters-native.lock'))).toBe(false)
  }
})

test('PowerShell installers validate native capabilities and preserve unrelated settings', () => {
  for (const name of ['codex.ps1', 'codex-config.ps1']) {
    const script = source(name)
    expect(script).toContain('debug models')
    expect(script).toContain('System.Diagnostics.ProcessStartInfo')
    expect(script).toContain('ReadToEndAsync')
    expect(script).toContain('Convert-CodexCatalogJson')
    expect(script).toContain('gpt-5.6-sol')
    expect(script).toContain('gpt-5.6-terra')
    expect(script).toContain('gpt-5.6-luna')
    expect(script).toContain('multi_agent_version')
    expect(script).toContain('tool_mode')
    expect(script).toContain('anyrouters-api-key')
    expect(script).toContain('[model_providers.anyrouters.auth]')
    expect(script).toContain('command = "powershell.exe"')
    expect(script).toContain('anyrouters-native-backup-')
    expect(script).toContain('[System.IO.File]::Replace')
    expect(script).toContain('CODEX_NON_INTERACTIVE')
    expect(script).toContain('Protect-PrivatePath')
    expect(script).toContain('icacls.exe')
    expect(script).toContain('Test-FileContentEqual')
    expect(script).toContain('Preserve-McpAndUnrelatedCodexConfig')
    expect(script).not.toContain('Set-JsonField $entry "multi_agent_version" $null')
    expect(script).not.toContain('Set-JsonField $entry "tool_mode" $null')
    expect(script).not.toContain('model_reasoning_effort = "medium"')
    expect(script).not.toContain('model_catalog_json = $catalogLiteral')
    expect(script).not.toContain('env_key = "OPENAI_API_KEY"')
    expect(script).not.toContain('setx OPENAI_API_KEY')
    expect(script).not.toContain('SetEnvironmentVariable("OPENAI_API_KEY"')
  }
})
