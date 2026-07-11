import { afterEach, expect, test } from 'bun:test'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const scriptsDir = resolve(import.meta.dir, '../../../router/install_scripts')
const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function source(name: string) {
  return readFileSync(join(scriptsDir, name), 'utf8')
}

function fixture(includeLuna = true) {
  return {
    generated_at: 'dynamic-fixture',
    models: [
      {
        slug: 'gpt-5.5',
        display_name: 'GPT-5.5',
        use_responses_lite: false,
        multi_agent_version: null,
        tool_mode: null,
        untouched: 'keep-me',
      },
      {
        slug: 'gpt-5.6-sol',
        display_name: 'GPT-5.6 Sol',
        use_responses_lite: true,
        multi_agent_version: 'v2',
        tool_mode: 'code_mode_only',
      },
      {
        slug: 'gpt-5.6-terra',
        display_name: 'GPT-5.6 Terra',
        use_responses_lite: true,
        multi_agent_version: 'v2',
        tool_mode: 'code_mode_only',
      },
      ...(includeLuna
        ? [
            {
              slug: 'gpt-5.6-luna',
              display_name: 'GPT-5.6 Luna',
              use_responses_lite: true,
              multi_agent_version: 'v1',
              tool_mode: 'code_mode_only',
            },
          ]
        : []),
    ],
  }
}

function isolatedShellRun(script: 'codex.sh' | 'codex-config.sh', includeLuna = true) {
  const root = mkdtempSync(join(tmpdir(), 'anyrouters-codex-catalog-'))
  tempDirs.push(root)
  const home = join(root, 'home')
  const bin = join(root, 'bin')
  mkdirSync(home)
  mkdirSync(bin)
  const fixturePath = join(root, 'catalog.json')
  const codexLog = join(root, 'codex.log')
  writeFileSync(fixturePath, JSON.stringify(fixture(includeLuna)))

  const codex = join(bin, 'codex')
  writeFileSync(
    codex,
    `#!/bin/sh
printf '%s\n' "\${CODEX_HOME:-missing}" >> "$CODEX_LOG"
if [ "\${1:-}" = "--version" ]; then echo 'codex-cli test'; exit 0; fi
if [ "\${1:-}" = "debug" ] && [ "\${2:-}" = "models" ]; then exec /bin/cat "$CATALOG_FIXTURE"; fi
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
  const launchctl = join(bin, 'launchctl')
  writeFileSync(launchctl, '#!/bin/sh\nexit 0\n')
  chmodSync(launchctl, 0o755)

  const env = {
    ...process.env,
    HOME: home,
    SHELL: '/bin/bash',
    PATH: `${bin}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`,
    CODEX_HOME: join(root, 'external-codex-home-must-survive'),
    ANYROUTERS_CODEX_BIN: codex,
    CATALOG_FIXTURE: fixturePath,
    CODEX_LOG: codexLog,
  }
  const result = spawnSync('bash', [join(scriptsDir, script), 'sk-test-isolated'], {
    env,
    encoding: 'utf8',
  })
  return { root, home, codexLog, result, env }
}

function assertSuccessfulCatalog(home: string) {
  const codexDir = join(home, '.codex')
  const catalogPath = join(codexDir, 'model-catalog-anyrouters-gpt56.json')
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
  const models = Array.isArray(catalog) ? catalog : catalog.models
  expect(models).toHaveLength(4)
  expect(models.find((item: { slug: string }) => item.slug === 'gpt-5.5')).toMatchObject({
    untouched: 'keep-me',
  })
  for (const slug of ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']) {
    expect(models.find((item: { slug: string }) => item.slug === slug)).toMatchObject({
      use_responses_lite: false,
      multi_agent_version: null,
      tool_mode: null,
    })
  }
  const config = readFileSync(join(codexDir, 'config.toml'), 'utf8')
  expect(config).toContain(`model_catalog_json = ${JSON.stringify(catalogPath)}`)
  expect(config).toContain('model = "gpt-5.6-sol"')
  expect(JSON.parse(readFileSync(join(codexDir, 'auth.json'), 'utf8'))).toEqual({
    OPENAI_API_KEY: 'sk-test-isolated',
  })
  expect(readdirSync(codexDir).some((name) => name.startsWith('.anyrouters-gpt56.'))).toBe(false)
}

for (const script of ['codex.sh', 'codex-config.sh'] as const) {
  test(`${script} exports, patches, backs up, and repeats in an isolated HOME`, () => {
    const first = isolatedShellRun(script)
    expect(first.result.status, first.result.stderr + first.result.stdout).toBe(0)
    assertSuccessfulCatalog(first.home)
    const codexHomes = readFileSync(first.codexLog, 'utf8').trim().split('\n')
    expect(codexHomes).toHaveLength(1)
    expect(codexHomes[0]).not.toBe(first.env.CODEX_HOME)

    const codexDir = join(first.home, '.codex')
    writeFileSync(join(codexDir, 'config.toml'), 'old-config')
    writeFileSync(join(codexDir, 'auth.json'), 'old-auth')
    writeFileSync(join(codexDir, 'model-catalog-anyrouters-gpt56.json'), 'old-catalog')
    const second = spawnSync('bash', [join(scriptsDir, script), 'sk-test-isolated'], {
      env: first.env,
      encoding: 'utf8',
    })
    expect(second.status, second.stderr + second.stdout).toBe(0)
    assertSuccessfulCatalog(first.home)
    const backups = readdirSync(codexDir).filter((name) => name.startsWith('anyrouters-backup-'))
    expect(backups.length).toBeGreaterThanOrEqual(2)
    const latest = backups.sort().at(-1)!
    expect(readFileSync(join(codexDir, latest, 'config.toml'), 'utf8')).toBe('old-config')
    expect(readFileSync(join(codexDir, latest, 'auth.json'), 'utf8')).toBe('old-auth')
    expect(readFileSync(join(codexDir, latest, 'model-catalog-anyrouters-gpt56.json'), 'utf8')).toBe(
      'old-catalog'
    )
  })

  test(`${script} fails before writing when one GPT-5.6 model is missing`, () => {
    const run = isolatedShellRun(script, false)
    const codexDir = join(run.home, '.codex')
    expect(run.result.status).not.toBe(0)
    expect(run.result.stderr + run.result.stdout).toContain('gpt-5.6-luna')
    expect(existsSync(join(codexDir, 'config.toml'))).toBe(false)
    expect(existsSync(join(codexDir, 'auth.json'))).toBe(false)
    expect(existsSync(join(codexDir, 'model-catalog-anyrouters-gpt56.json'))).toBe(false)
    expect(readdirSync(codexDir).some((name) => name.startsWith('anyrouters-backup-'))).toBe(false)
  })
}

test('PowerShell installers use native JSON, full-catalog validation, backups, and atomic replacement', () => {
  for (const name of ['codex.ps1', 'codex-config.ps1']) {
    const script = source(name)
    expect(script).toContain('debug models')
    expect(script).toContain('System.Diagnostics.ProcessStartInfo')
    expect(script).toContain('ReadToEndAsync')
    expect(script).toContain('StandardOutputEncoding')
    expect(script).toContain('Remove-TerminalSequences')
    expect(script).toContain('Get-BalancedJsonAt')
    expect(script).toContain('Convert-CodexCatalogJson')
    expect(script).toContain('ConvertFrom-Json')
    expect(script).toContain('System.Web.Script.Serialization.JavaScriptSerializer')
    expect(script).toContain('MaxJsonLength = [int]::MaxValue')
    expect(script).toContain('RecursionLimit = 256')
    expect(script).toContain('System.Collections.IDictionary')
    expect(script).toContain('System.Collections.IEnumerable')
    expect(script).toMatch(/ConvertTo-Json -Depth 100/)
    expect(script).toContain('model-catalog-anyrouters-gpt56.json')
    expect(script).toContain('model_catalog_json = $catalogLiteral')
    expect(script).toContain('[System.IO.File]::Replace')
    expect(script).toContain('Existing configuration was not changed')
    expect(script).toContain('gpt-5.6-sol')
    expect(script).toContain('gpt-5.6-terra')
    expect(script).toContain('gpt-5.6-luna')
    expect(script).toContain('collaboration/subagents')
    expect(script).not.toMatch(/HTTP_PROXY|HTTPS_PROXY|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY/)
  }
})

test('PowerShell installers run in an isolated HOME when pwsh is available', () => {
  const probe = spawnSync('sh', ['-c', 'command -v pwsh'], { encoding: 'utf8' })
  if (probe.status !== 0) return

  const variants = [
    { name: 'pure-object', mode: 'pure', catalog: fixture() },
    { name: 'ansi-logs-object', mode: 'noisy', catalog: fixture() },
    { name: 'top-level-array', mode: 'pure', catalog: fixture().models },
    {
      name: 'large-object',
      mode: 'noisy',
      catalog: { ...fixture(), padding: 'x'.repeat(2 * 1024 * 1024) },
    },
  ]

  for (const script of ['codex.ps1', 'codex-config.ps1']) {
    for (const variant of variants) {
      const root = mkdtempSync(join(tmpdir(), `anyrouters-codex-pwsh-${variant.name}-`))
      tempDirs.push(root)
      const home = join(root, 'home')
      mkdirSync(home)
      const fixturePath = join(root, 'catalog.json')
      writeFileSync(fixturePath, JSON.stringify(variant.catalog))
      const codex = join(root, 'codex-fixture.ps1')
      writeFileSync(
        codex,
        `param([Parameter(ValueFromRemainingArguments = $true)][string[]]$CodexArgs)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding -ArgumentList $false
if ($CodexArgs.Count -eq 1 -and $CodexArgs[0] -eq '--version') {
  [Console]::Out.WriteLine('codex-cli windows-fixture')
  exit 0
}
if ($CodexArgs.Count -eq 2 -and $CodexArgs[0] -eq 'debug' -and $CodexArgs[1] -eq 'models') {
  $json = [System.IO.File]::ReadAllText($env:CATALOG_FIXTURE, [System.Text.Encoding]::UTF8)
  if ($env:CATALOG_OUTPUT_MODE -eq 'noisy') {
    [Console]::Out.Write([char]27 + '[33mstartup log' + [char]27 + '[0m' + [Environment]::NewLine)
    [Console]::Out.Write([char]0xFEFF + $json + [Environment]::NewLine + 'after log')
  } elseif ($env:CATALOG_OUTPUT_MODE -eq 'corrupt') {
    [Console]::Out.Write('startup log {"models": [broken')
  } else {
    [Console]::Out.Write($json)
  }
  exit 0
}
exit 2
`
      )

      const prelude = `
function global:Invoke-RestMethod {
  param($Method, $Uri, $Headers, $TimeoutSec, $ErrorAction)
  if ($Uri -like '*install.ps1') { return 'Write-Output "" | Out-Null' }
  return @{}
}
function global:setx { return }
. '${join(scriptsDir, script).replaceAll("'", "''")}'
`
      const result = spawnSync(
        probe.stdout.trim(),
        ['-NoProfile', '-NonInteractive', '-Command', prelude],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            HOME: home,
            USERPROFILE: home,
            ANYROUTERS_KEY: 'sk-test-isolated',
            ANYROUTERS_CODEX_BIN: codex,
            CATALOG_FIXTURE: fixturePath,
            CATALOG_OUTPUT_MODE: variant.mode,
            CODEX_HOME: join(root, 'external-codex-home-must-survive'),
          },
        }
      )
      expect(result.status, `${variant.name}: ${result.stderr}${result.stdout}`).toBe(0)
      assertSuccessfulCatalog(home)
    }
  }
}, 60_000)

test('PowerShell installers leave existing files unchanged on invalid catalogs when pwsh is available', () => {
  const probe = spawnSync('sh', ['-c', 'command -v pwsh'], { encoding: 'utf8' })
  if (probe.status !== 0) return

  const variants = [
    { name: 'corrupt-json', mode: 'corrupt', catalog: fixture() },
    { name: 'missing-luna', mode: 'pure', catalog: fixture(false) },
  ]

  for (const script of ['codex.ps1', 'codex-config.ps1']) {
    for (const variant of variants) {
      const root = mkdtempSync(join(tmpdir(), `anyrouters-codex-pwsh-failure-${variant.name}-`))
      tempDirs.push(root)
      const home = join(root, 'home')
      const codexDir = join(home, '.codex')
      mkdirSync(codexDir, { recursive: true })
      const fixturePath = join(root, 'catalog.json')
      writeFileSync(fixturePath, JSON.stringify(variant.catalog))
      writeFileSync(join(codexDir, 'config.toml'), 'old-config')
      writeFileSync(join(codexDir, 'auth.json'), 'old-auth')
      writeFileSync(join(codexDir, 'model-catalog-anyrouters-gpt56.json'), 'old-catalog')
      const codex = join(root, 'codex-fixture.ps1')
      writeFileSync(
        codex,
        `param([Parameter(ValueFromRemainingArguments = $true)][string[]]$CodexArgs)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding -ArgumentList $false
if ($CodexArgs.Count -eq 1 -and $CodexArgs[0] -eq '--version') {
  [Console]::Out.WriteLine('codex-cli windows-fixture')
  exit 0
}
if ($CodexArgs.Count -eq 2 -and $CodexArgs[0] -eq 'debug' -and $CodexArgs[1] -eq 'models') {
  if ($env:CATALOG_OUTPUT_MODE -eq 'corrupt') {
    [Console]::Out.Write('startup log {"models": [broken')
  } else {
    [Console]::Out.Write([System.IO.File]::ReadAllText($env:CATALOG_FIXTURE, [System.Text.Encoding]::UTF8))
  }
  exit 0
}
exit 2
`
      )

      const prelude = `
function global:Invoke-RestMethod {
  param($Method, $Uri, $Headers, $TimeoutSec, $ErrorAction)
  if ($Uri -like '*install.ps1') { return 'Write-Output "" | Out-Null' }
  return @{}
}
function global:setx { return }
. '${join(scriptsDir, script).replaceAll("'", "''")}'
`
      const result = spawnSync(
        probe.stdout.trim(),
        ['-NoProfile', '-NonInteractive', '-Command', prelude],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            HOME: home,
            USERPROFILE: home,
            ANYROUTERS_KEY: 'sk-test-isolated',
            ANYROUTERS_CODEX_BIN: codex,
            CATALOG_FIXTURE: fixturePath,
            CATALOG_OUTPUT_MODE: variant.mode,
            CODEX_HOME: join(root, 'external-codex-home-must-survive'),
          },
        }
      )
      expect(result.status).not.toBe(0)
      expect(result.stderr + result.stdout).toContain('configuration was not changed')
      expect(readFileSync(join(codexDir, 'config.toml'), 'utf8')).toBe('old-config')
      expect(readFileSync(join(codexDir, 'auth.json'), 'utf8')).toBe('old-auth')
      expect(readFileSync(join(codexDir, 'model-catalog-anyrouters-gpt56.json'), 'utf8')).toBe(
        'old-catalog'
      )
      expect(readdirSync(codexDir).some((name) => name.startsWith('anyrouters-backup-'))).toBe(false)
    }
  }
}, 60_000)
