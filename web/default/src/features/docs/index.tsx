/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { createContext, useContext, useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import {
  AppWindow,
  Check,
  Copy,
  ExternalLink,
  MessageSquareCode,
  MonitorSmartphone,
  SquareTerminal,
  TriangleAlert,
  WandSparkles,
  type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { getStatus, getUserGroups } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createApiKey, fetchTokenKey, searchApiKeys } from '../keys/api'
import type { ApiResponse, CreatedApiKey } from '../keys/types'

const OPENAI_BASE = 'https://api.anyrouters.com/v1'
const ANTHROPIC_BASE = 'https://api.anyrouters.com'
const CODEX_OFFICIAL_URL =
  'https://developers.openai.com/codex/quickstart?setup=app'
const CODEX_CLI_OFFICIAL_URL =
  'https://developers.openai.com/codex/quickstart?setup=cli'
const CLAUDE_OFFICIAL_URL = 'https://code.claude.com/docs/en/setup'
const KEY = 'YOUR_ANYROUTERS_API_KEY'
const CODEX_DEFAULT_MODEL = 'gpt-5.6-sol'
const CLAUDE_DEFAULT_MODEL = 'claude-sonnet-4-6'
const ANYROUTERS_IMAGE_SKILL_URL = '/install/anyrouters-image.zip'

type GuideProps = {
  apiKey: string
  onApiKeyChange: (v: string) => void
}

type OS = 'mac' | 'windows' | 'linux'

const OS_LABELS: Record<OS, string> = {
  mac: 'macOS',
  windows: 'Windows',
  linux: 'Linux',
}

const KeyContext = createContext('')
const useApiKey = () => useContext(KeyContext)

const OsChoiceContext = createContext<{
  os: OS
  setOs: (o: OS) => void
  withLinux: boolean
} | null>(null)

function withKey(code: string, key: string): string {
  const trimmed = key.trim()
  return trimmed ? code.split(KEY).join(trimmed) : code
}

function normalizeApiKey(key: string) {
  const trimmed = key.trim()
  if (!trimmed) return ''
  return trimmed.startsWith('sk-') ? trimmed : `sk-${trimmed}`
}

function apiKeyName(toolName: string) {
  return `${toolName} 请勿轻易删除`.slice(0, 50)
}

async function fetchFullApiKey(tokenId: number, message: string) {
  const full = await fetchTokenKey(tokenId)
  const key = normalizeApiKey(full.data?.key || '')
  if (!full.success || !key) {
    throw new Error(full.message || message)
  }
  return key
}

async function fetchExistingKeyByTool(toolName: string) {
  const generatedName = apiKeyName(toolName)
  const candidates = [generatedName, toolName]
  for (const keyword of candidates) {
    const found = await searchApiKeys({ keyword, p: 1, size: 20 })
    if (!found.success) {
      throw new Error(found.message || 'API Key 查询失败')
    }

    const token = found.data?.items?.find(
      (item) =>
        item.status === 1 &&
        (item.name === generatedName || item.name === toolName)
    )
    if (token) {
      return fetchFullApiKey(token.id, '已找到 API Key，但读取完整 key 失败')
    }
  }

  return ''
}

async function readCreatedApiKey(created: ApiResponse<CreatedApiKey>) {
  const key = normalizeApiKey(created.data?.key || '')
  if (key) return key

  if (created.data?.id) {
    return fetchFullApiKey(
      created.data.id,
      'API Key 已创建，但读取完整 key 失败'
    )
  }

  return ''
}

async function getDefaultApiKeyGroup() {
  try {
    const [status, groups] = await Promise.all([getStatus(), getUserGroups()])
    const groupMap = groups.success ? (groups.data ?? {}) : {}
    if (status?.default_use_auto_group === true && groupMap.auto) {
      return { group: 'auto', crossGroupRetry: true }
    }
    if (groupMap.default) {
      return { group: 'default', crossGroupRetry: false }
    }
  } catch {
    // Keep the tutorial usable even if optional status/group lookups fail.
  }

  return { group: 'default', crossGroupRetry: false }
}

async function getOrCreateApiKey(toolName: string) {
  const existing = await fetchExistingKeyByTool(toolName)
  if (existing) return { key: existing, reused: true }

  const name = apiKeyName(toolName)
  const { group, crossGroupRetry } = await getDefaultApiKeyGroup()
  const created = await createApiKey({
    name,
    remain_quota: 0,
    expired_time: -1,
    unlimited_quota: true,
    model_limits_enabled: false,
    model_limits: '',
    allow_ips: '',
    group,
    cross_group_retry: crossGroupRetry,
  })
  if (!created.success) {
    throw new Error(created.message || 'API Key 创建失败')
  }

  const createdKey = await readCreatedApiKey(created)
  if (createdKey) return { key: createdKey, reused: false }

  const key = await fetchExistingKeyByTool(toolName)
  if (!key) {
    throw new Error('API Key 已创建，但创建接口未返回完整 key，且回读失败')
  }
  return { key, reused: false }
}

function OsProvider({
  withLinux = false,
  children,
}: {
  withLinux?: boolean
  children: ReactNode
}) {
  const [os, setOs] = useState<OS>(() => {
    if (typeof navigator === 'undefined') return 'mac'
    const platform =
      `${navigator.userAgent} ${navigator.platform}`.toLowerCase()
    if (platform.includes('win')) return 'windows'
    if (withLinux && platform.includes('linux')) return 'linux'
    return 'mac'
  })

  return (
    <OsChoiceContext.Provider value={{ os, setOs, withLinux }}>
      {children}
    </OsChoiceContext.Provider>
  )
}

function useOsChoice() {
  return (
    useContext(OsChoiceContext) ?? {
      os: 'mac' as OS,
      setOs: () => {},
      withLinux: false,
    }
  )
}

function OsToggle() {
  const { os, setOs, withLinux } = useOsChoice()
  const items: OS[] = withLinux
    ? ['mac', 'windows', 'linux']
    : ['mac', 'windows']

  return (
    <div className='flex flex-wrap gap-2'>
      {items.map((item) => (
        <button
          key={item}
          type='button'
          onClick={() => setOs(item)}
          className={cn(
            'rounded-md border px-4 py-2 text-sm font-medium transition-colors',
            os === item
              ? 'border-neutral-300 bg-neutral-200 text-neutral-950 shadow-sm hover:bg-neutral-200 dark:border-neutral-600 dark:bg-neutral-700 dark:text-neutral-50'
              : 'border-border bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground'
          )}
        >
          {OS_LABELS[item]}
        </button>
      ))}
    </div>
  )
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className='text-lg font-semibold tracking-tight'>{children}</h2>
}

function StepTitle({ children }: { children: ReactNode }) {
  return <h3 className='text-sm font-semibold tracking-tight'>{children}</h3>
}

function CodexUpdateNotice() {
  return (
    <div className='rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-950 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-100'>
      <p className='font-semibold'>当前版本更新于：2026年7月11日</p>
      <ol className='mt-1 list-decimal pl-5'>
        <li>支持 ChatGPT 5.6 全系列</li>
        <li>修复部分兼容问题。</li>
      </ol>
    </div>
  )
}

function ApiTakeoverNotice({
  tool,
}: {
  tool: 'codex' | 'codex-config' | 'claude'
}) {
  const toolName = tool === 'claude' ? 'Claude Code' : 'Codex'

  return (
    <div className='flex gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950 dark:border-amber-800 dark:bg-amber-950/35 dark:text-amber-100'>
      <TriangleAlert className='mt-0.5 size-4 shrink-0' />
      <div className='min-w-0 text-sm leading-6'>
        <p className='font-semibold'>运行前请注意</p>
        <p className='mt-1 text-amber-900/85 dark:text-amber-100/80'>
          这条命令会把 {toolName} 切换到 AnyRouters，自动覆盖当前接口和 API
          Key，并清理会导致调用串线的同类旧环境变量/旧配置；此前接入的其他 API
          将退出。不会删除系统代理、AWS
          凭据或其他工具配置，被覆盖的配置文件会先备份。
        </p>
      </div>
    </div>
  )
}

function ManualStep({
  index,
  title,
  children,
}: {
  index: number
  title: string
  children: ReactNode
}) {
  return (
    <div className='space-y-3'>
      <StepTitle>
        {index}. {title}
      </StepTitle>
      {children}
    </div>
  )
}

function CodeBlock({ code }: { code: string }) {
  const apiKey = useApiKey()
  const { copyToClipboard } = useCopyToClipboard()
  const [copied, setCopied] = useState(false)
  const resolved = withKey(code, apiKey)
  const highlight = apiKey.trim() || KEY
  const parts = resolved.split(highlight)

  const copy = () => {
    copyToClipboard(resolved)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  return (
    <div className='mt-3 min-w-0 rounded-lg border'>
      <pre className='max-w-full overflow-x-auto px-4 py-3 text-[13px] leading-6'>
        <code className='font-mono'>
          {parts.map((part, index) => (
            <span key={index}>
              {part}
              {index < parts.length - 1 && (
                <span className='rounded bg-red-500/10 px-1 font-semibold text-red-600'>
                  {highlight}
                </span>
              )}
            </span>
          ))}
        </code>
      </pre>
      <div className='border-t px-3 py-2'>
        <Button size='sm' variant='outline' onClick={copy}>
          {copied ? <Check className='size-4' /> : <Copy className='size-4' />}
          {copied ? '已复制' : '复制'}
        </Button>
      </div>
    </div>
  )
}

function TerminalResult({ output }: { output: string }) {
  return (
    <div className='mt-3 overflow-hidden rounded-lg border bg-neutral-950 text-neutral-100'>
      <div className='flex items-center gap-1 border-b border-white/10 px-3 py-2'>
        <span className='size-2.5 rounded-full bg-red-400' />
        <span className='size-2.5 rounded-full bg-yellow-400' />
        <span className='size-2.5 rounded-full bg-green-400' />
      </div>
      <pre className='max-w-full overflow-x-auto px-4 py-3 text-[13px] leading-6'>
        <code className='font-mono whitespace-pre-wrap'>{output}</code>
      </pre>
    </div>
  )
}

function ApiKeyStep({
  apiKey,
  onApiKeyChange,
  toolName,
}: {
  apiKey: string
  onApiKeyChange: (v: string) => void
  toolName: string
}) {
  const [creating, setCreating] = useState(false)

  const createKey = async () => {
    setCreating(true)
    try {
      const { key, reused } = await getOrCreateApiKey(toolName)
      onApiKeyChange(key)
      toast.success(reused ? '已填入已有 API Key' : 'API Key 已创建')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'API Key 创建失败')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className='space-y-3'>
      <StepTitle>第一步：创建 API Key</StepTitle>
      <div className='flex flex-col gap-2 lg:flex-row lg:items-center'>
        <Button
          onClick={createKey}
          disabled={creating}
          className='border-0 bg-gradient-to-r from-violet-600 via-indigo-600 to-blue-600 text-white shadow-sm hover:brightness-105'
        >
          {creating ? '创建中' : '自动创建'}
          <WandSparkles className='size-4' />
        </Button>
        <Button variant='outline' render={<Link to='/keys' />}>
          手动创建 API Key
          <ExternalLink className='size-3.5' />
        </Button>
        <Input
          type='text'
          spellCheck={false}
          autoComplete='off'
          placeholder='粘贴 API Key'
          value={apiKey}
          onChange={(e) => onApiKeyChange(e.target.value)}
          className='h-10 min-w-0 flex-1 font-mono text-sm'
        />
      </div>
      {apiKey.trim().toLowerCase().startsWith('sk-anyrouters-') && (
        <p className='text-sm text-red-600'>
          不要额外加 sk-anyrouters-，请粘贴完整 API Key
        </p>
      )}
      {!apiKey.trim() && (
        <p className='text-sm font-medium text-red-600'>
          必须配置完 API Key 才能进行后续步骤哦
        </p>
      )}
    </div>
  )
}

function installCommand({
  os,
  tool,
  key,
}: {
  os: OS
  tool: 'codex' | 'codex-config' | 'claude'
  key: string
}) {
  const endpoint = `https://anyrouters.com/install/${tool}`
  if (os === 'windows') {
    return `[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12; $env:ANYROUTERS_KEY="${key}"; irm ${endpoint}.ps1 | iex`
  }
  return `curl -fsSL ${endpoint}.sh | bash -s -- "${key}"`
}

function toolLaunchCommand(tool: 'codex' | 'codex-config' | 'claude') {
  if (tool === 'codex-config') return ''
  return tool === 'codex' ? 'codex' : 'claude'
}

function successOutput({
  os,
  tool,
}: {
  os: OS
  tool: 'codex' | 'codex-config' | 'claude'
}) {
  const home = os === 'windows' ? 'C:\\Users\\YourName' : '/Users/mini'
  const savedKey =
    os === 'windows'
      ? ''
      : os === 'mac'
        ? `Saved OPENAI_API_KEY to: ${home}/.zshrc
Saved OPENAI_API_KEY to: ${home}/.zprofile
`
        : `Saved OPENAI_API_KEY to: ${home}/.bashrc
Saved OPENAI_API_KEY to: ${home}/.bash_profile
`
  if (tool === 'codex-config') {
    const backup = `${home}${os === 'windows' ? '\\.codex\\anyrouters-reset-20260706-162020' : '/.codex/anyrouters-reset-20260706-161441'}`
    return `Backed up old Codex config to: ${backup}
${savedKey}

${os === 'windows' ? 'Done' : 'OK Done'}! Fully quit and reopen Codex desktop, then send a message.`
  }
  if (tool === 'codex') {
    const backup = `${home}${os === 'windows' ? '\\.codex\\anyrouters-reset-20260706-162020' : '/.codex/anyrouters-reset-20260706-161441'}`
    return `Installing Codex CLI ...
Backed up old Codex config to: ${backup}
${savedKey}

${os === 'windows' ? 'Done' : 'OK Done'}! Open a NEW terminal window and run:  codex`
  }
  return `Resetting AnyRouters Claude Code environment ...
Installing Claude Code ...

${os === 'windows' ? 'Done' : 'OK Done'}! Open a NEW PowerShell or cmd.exe window and run:  claude`
}

function UserFlow({
  apiKey,
  onApiKeyChange,
  tool,
  toolName,
  desktopDownload = false,
}: {
  apiKey: string
  onApiKeyChange: (v: string) => void
  tool: 'codex' | 'codex-config' | 'claude'
  toolName: string
  desktopDownload?: boolean
}) {
  const { os } = useOsChoice()
  const key = apiKey.trim() || KEY
  const command = installCommand({ os, tool, key })
  const shellName = os === 'windows' ? 'PowerShell' : '终端'
  const openShellText =
    os === 'windows'
      ? desktopDownload
        ? '完全退出 Codex 桌面版，再按 Win 键搜索 PowerShell 打开'
        : '按 Win 键搜索 PowerShell 打开'
      : desktopDownload
        ? '完全退出 Codex 桌面版，再打开终端'
        : '打开终端'

  return (
    <section className='border-b pb-10'>
      <SectionTitle>普通用户</SectionTitle>
      <div className='mt-6 space-y-8'>
        <ApiKeyStep
          apiKey={apiKey}
          onApiKeyChange={onApiKeyChange}
          toolName={toolName}
        />

        <div className='space-y-3'>
          <StepTitle>第二步：选择电脑型号</StepTitle>
          <OsToggle />
        </div>

        <div className='space-y-3'>
          <StepTitle>
            {tool === 'codex' || tool === 'codex-config'
              ? '第三步：快速安装与升级'
              : '第三步：快速安装'}
          </StepTitle>
          {(tool === 'codex' || tool === 'codex-config') && (
            <CodexUpdateNotice />
          )}
          <ApiTakeoverNotice tool={tool} />
          {desktopDownload && (
            <p className='text-sm'>
              前提条件：
              <a
                href={CODEX_OFFICIAL_URL}
                target='_blank'
                rel='noopener noreferrer'
                className='inline-flex items-center gap-1 font-medium underline underline-offset-4'
              >
                安装 Codex 桌面版
                <ExternalLink className='size-3.5' />
              </a>
            </p>
          )}
          <ol className='text-muted-foreground list-decimal space-y-3 pl-5 text-sm'>
            <li>{openShellText}</li>
            <li>
              <span>
                {tool === 'codex' || tool === 'codex-config'
                  ? '粘贴运行命令（版本更新后再次执行命令即可升级）'
                  : '粘贴这行命令'}
              </span>
              <CodeBlock code={command} />
            </li>
            <li>看到{shellName}里出现这行命令后，按回车键</li>
            <li>
              <span>出现下面提示就是成功</span>
              <TerminalResult output={successOutput({ os, tool })} />
            </li>
            {desktopDownload && <li>等待完成后，重新打开 Codex 桌面版</li>}
            {!desktopDownload && (
              <li>
                <span>
                  等待完成后，打开新终端
                  {os === 'windows' && tool === 'claude'
                    ? '（PowerShell 或 cmd.exe 都可以）运行'
                    : '运行'}
                </span>
                <CodeBlock
                  code={
                    os === 'windows' && tool === 'claude'
                      ? 'where claude\nclaude --version\nclaude'
                      : toolLaunchCommand(tool)
                  }
                />
              </li>
            )}
          </ol>
          {os === 'windows' && (
            <p className='text-muted-foreground text-sm'>
              Windows 下载阶段如果提示“基础连接已经关闭”，通常是当前 PowerShell
              的 TLS/系统网络握手问题，不是 API Key 或安装包损坏；访问
              AnyRouters 本身不需要代理。
            </p>
          )}
          <p className='text-muted-foreground text-sm'>如有问题，请联系客服</p>
        </div>
      </div>
    </section>
  )
}

function codexConfig(model = CODEX_DEFAULT_MODEL) {
  return `model = "${model}"
model_provider = "anyrouters"
model_reasoning_effort = "medium"
disable_response_storage = true

[model_providers.anyrouters]
name = "AnyRouters"
base_url = "${OPENAI_BASE}"
wire_api = "responses"
env_key = "OPENAI_API_KEY"`
}

function codexConfigWriteCommand(os: OS) {
  if (os === 'windows') {
    return `New-Item -ItemType Directory -Force -Path "$HOME\\.codex" | Out-Null
if (Test-Path "$HOME\\.codex\\config.toml") {
  Copy-Item "$HOME\\.codex\\config.toml" "$HOME\\.codex\\config.toml.anyrouters.bak" -Force
}
$Utf8NoBom = New-Object System.Text.UTF8Encoding -ArgumentList $false
$ConfigToml = @'
${codexConfig()}
'@
[System.IO.File]::WriteAllText("$HOME\\.codex\\config.toml", $ConfigToml, $Utf8NoBom)`
  }

  return `mkdir -p ~/.codex
[ -f ~/.codex/config.toml ] && cp ~/.codex/config.toml ~/.codex/config.toml.anyrouters.bak
cat > ~/.codex/config.toml <<'EOF'
${codexConfig()}
EOF
chmod 600 ~/.codex/config.toml`
}

function CodexConfigCommands() {
  const { os } = useOsChoice()
  return <CodeBlock code={codexConfigWriteCommand(os)} />
}

function CodexKeyCommands() {
  const { os } = useOsChoice()

  if (os === 'windows') {
    return (
      <CodeBlock
        code={`$Key = "${KEY}"
New-Item -ItemType Directory -Force -Path "$HOME\\.codex" | Out-Null
if (Test-Path "$HOME\\.codex\\auth.json") {
  Copy-Item "$HOME\\.codex\\auth.json" "$HOME\\.codex\\auth.json.anyrouters.bak" -Force
}
$Utf8NoBom = New-Object System.Text.UTF8Encoding -ArgumentList $false
$AuthJson = @{ OPENAI_API_KEY = $Key } | ConvertTo-Json
[System.IO.File]::WriteAllText("$HOME\\.codex\\auth.json", $AuthJson + [Environment]::NewLine, $Utf8NoBom)
[Environment]::SetEnvironmentVariable("OPENAI_API_KEY", $Key, "User")`}
      />
    )
  }

  if (os === 'mac') {
    return (
      <CodeBlock
        code={`mkdir -p ~/.codex
KEY="${KEY}"
[ -f ~/.codex/auth.json ] && cp ~/.codex/auth.json ~/.codex/auth.json.anyrouters.bak
printf '{\\n  "OPENAI_API_KEY": "%s"\\n}\\n' "$KEY" > ~/.codex/auth.json
chmod 600 ~/.codex/auth.json
PROFILE="\${ZDOTDIR:-$HOME}/.zshrc"
touch "$PROFILE"
cp "$PROFILE" "$PROFILE.anyrouters.bak" 2>/dev/null || true
sed -i.bak '/^export OPENAI_API_KEY=/d' "$PROFILE" 2>/dev/null || true
printf '\\nexport OPENAI_API_KEY="%s"\\n' "$KEY" >> "$PROFILE"
launchctl setenv OPENAI_API_KEY "$KEY"
source "$PROFILE"`}
      />
    )
  }

  return (
    <CodeBlock
      code={`mkdir -p ~/.codex
KEY="${KEY}"
[ -f ~/.codex/auth.json ] && cp ~/.codex/auth.json ~/.codex/auth.json.anyrouters.bak
printf '{\\n  "OPENAI_API_KEY": "%s"\\n}\\n' "$KEY" > ~/.codex/auth.json
chmod 600 ~/.codex/auth.json
PROFILE="$HOME/.bashrc"
touch "$PROFILE"
cp "$PROFILE" "$PROFILE.anyrouters.bak" 2>/dev/null || true
sed -i.bak '/^export OPENAI_API_KEY=/d' "$PROFILE" 2>/dev/null || true
printf '\\nexport OPENAI_API_KEY="%s"\\n' "$KEY" >> "$PROFILE"
source "$PROFILE"`}
    />
  )
}

function ClaudeEnvCommands() {
  const { os } = useOsChoice()
  if (os === 'windows') {
    return (
      <CodeBlock
        code={`$Key = "${KEY}"
$Conflicting = @(
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_SMALL_FAST_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_BEDROCK_BASE_URL",
  "ANTHROPIC_VERTEX_BASE_URL",
  "ANTHROPIC_VERTEX_PROJECT_ID",
  "CLOUD_ML_REGION",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
  "CLAUDE_CODE_USE_MANTLE",
  "CLAUDE_CODE_USE_ANTHROPIC_AWS",
  "ANTHROPIC_AWS_WORKSPACE_ID"
)
foreach ($Name in $Conflicting) {
  [Environment]::SetEnvironmentVariable($Name, $null, "User")
  Remove-Item "Env:$Name" -ErrorAction SilentlyContinue
}
$SettingsDir = Join-Path $env:USERPROFILE ".claude"
$SettingsPath = Join-Path $SettingsDir "settings.json"
New-Item -ItemType Directory -Force -Path $SettingsDir | Out-Null
$Settings = if (Test-Path $SettingsPath) {
  try { Get-Content -Raw $SettingsPath | ConvertFrom-Json } catch { [pscustomobject]@{} }
} else { [pscustomobject]@{} }
if (-not $Settings.PSObject.Properties["env"]) {
  $Settings | Add-Member -NotePropertyName env -NotePropertyValue ([pscustomobject]@{})
}
foreach ($Name in ($Conflicting + @("ANTHROPIC_AUTH_TOKEN"))) {
  if ($Settings.env.PSObject.Properties[$Name]) {
    $Settings.env.PSObject.Properties.Remove($Name)
  }
}
$Settings.env | Add-Member -Force -NotePropertyName ANTHROPIC_BASE_URL -NotePropertyValue "${ANTHROPIC_BASE}"
$Settings.env | Add-Member -Force -NotePropertyName ANTHROPIC_MODEL -NotePropertyValue "${CLAUDE_DEFAULT_MODEL}"
if (Test-Path $SettingsPath) { Copy-Item $SettingsPath "$SettingsPath.anyrouters.bak" -Force }
$Settings | ConvertTo-Json -Depth 32 | Set-Content -Path $SettingsPath -Encoding UTF8
[Environment]::SetEnvironmentVariable("ANTHROPIC_BASE_URL", "${ANTHROPIC_BASE}", "User")
[Environment]::SetEnvironmentVariable("ANTHROPIC_AUTH_TOKEN", $Key, "User")
[Environment]::SetEnvironmentVariable("ANTHROPIC_MODEL", "${CLAUDE_DEFAULT_MODEL}", "User")`}
      />
    )
  }

  if (os === 'mac') {
    return (
      <CodeBlock
        code={`KEY="${KEY}"
PROFILE="\${ZDOTDIR:-$HOME}/.zshrc"
touch "$PROFILE"
cp "$PROFILE" "$PROFILE.anyrouters.bak" 2>/dev/null || true
sed -i.bak '/# anyrouters-managed-begin/,/# anyrouters-managed-end/d' "$PROFILE" 2>/dev/null || true
sed -i.bak '/^export ANTHROPIC_BASE_URL=/d;/^export ANTHROPIC_AUTH_TOKEN=/d;/^export ANTHROPIC_MODEL=/d' "$PROFILE" 2>/dev/null || true
cat >> "$PROFILE" <<EOF
# anyrouters-managed-begin
export ANTHROPIC_BASE_URL=${ANTHROPIC_BASE}
export ANTHROPIC_AUTH_TOKEN=$KEY
export ANTHROPIC_MODEL=${CLAUDE_DEFAULT_MODEL}
# anyrouters-managed-end
EOF
source "$PROFILE"`}
      />
    )
  }

  return (
    <CodeBlock
      code={`KEY="${KEY}"
PROFILE="$HOME/.bashrc"
touch "$PROFILE"
cp "$PROFILE" "$PROFILE.anyrouters.bak" 2>/dev/null || true
sed -i.bak '/# anyrouters-managed-begin/,/# anyrouters-managed-end/d' "$PROFILE" 2>/dev/null || true
sed -i.bak '/^export ANTHROPIC_BASE_URL=/d;/^export ANTHROPIC_AUTH_TOKEN=/d;/^export ANTHROPIC_MODEL=/d' "$PROFILE" 2>/dev/null || true
cat >> "$PROFILE" <<EOF
# anyrouters-managed-begin
export ANTHROPIC_BASE_URL=${ANTHROPIC_BASE}
export ANTHROPIC_AUTH_TOKEN=$KEY
export ANTHROPIC_MODEL=${CLAUDE_DEFAULT_MODEL}
# anyrouters-managed-end
EOF
source "$PROFILE"`}
    />
  )
}

function CodexCliInstallCommands() {
  const { os } = useOsChoice()
  if (os === 'windows') {
    return (
      <CodeBlock code='powershell -ExecutionPolicy ByPass -c "[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12; irm https://chatgpt.com/codex/install.ps1 | iex"' />
    )
  }
  return (
    <CodeBlock code='curl -fsSL https://chatgpt.com/codex/install.sh | sh' />
  )
}

function ClaudeInstallCommands() {
  const { os } = useOsChoice()
  if (os === 'windows') {
    return (
      <CodeBlock
        code={`[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$NpmPrefix = if ($env:ANYROUTERS_NPM_PREFIX) { $env:ANYROUTERS_NPM_PREFIX } else { Join-Path $env:LOCALAPPDATA "AnyRouters\\npm" }
function Add-UserPath([string]$PathToAdd, [bool]$Prefer = $false) {
  if (-not $PathToAdd -or -not (Test-Path $PathToAdd)) { return }
  $current = [Environment]::GetEnvironmentVariable("Path", "User")
  if (-not $current) { $current = [Environment]::GetEnvironmentVariable("PATH", "User") }
  $parts = if ($current) { $current -split ';' | Where-Object { $_ -and ($_ -ine $PathToAdd) } } else { @() }
  $parts = if ($Prefer) { @($PathToAdd) + $parts } else { $parts + @($PathToAdd) }
  [Environment]::SetEnvironmentVariable("Path", ($parts -join ';'), "User")
  $envParts = if ($env:PATH) { $env:PATH -split ';' | Where-Object { $_ -and ($_ -ine $PathToAdd) } } else { @() }
  $env:PATH = (@($PathToAdd) + $envParts) -join ';'
}
function Test-ClaudeCommandWorks([string]$CommandPath) {
  if (-not $CommandPath -or -not (Test-Path $CommandPath)) { return $false }
  try {
    & $CommandPath --version *> $null
    return $LASTEXITCODE -eq 0
  } catch {
    return $false
  }
}
function Get-AnyRoutersClaudeDirs {
  @(
    $NpmPrefix,
    (Join-Path $NpmPrefix "bin"),
    (Join-Path $NpmPrefix "node_modules\\.bin")
  ) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique
}
function Add-AnyRoutersClaudePaths {
  $dirs = @(Get-AnyRoutersClaudeDirs)
  [Array]::Reverse($dirs)
  foreach ($dir in $dirs) { Add-UserPath $dir $true }
}
function Get-LegacyClaudeLaunchers {
  @(
    (Join-Path $env:USERPROFILE ".local\\cmd-shims\\claude.cmd"),
    (Join-Path $env:USERPROFILE ".local\\bin\\claude.cmd"),
    (Join-Path $env:USERPROFILE ".local\\bin\\claude.exe"),
    (Join-Path $env:APPDATA "npm\\claude.cmd"),
    (Join-Path $env:APPDATA "npm\\claude.ps1"),
    (Join-Path $env:APPDATA "npm\\claude")
  ) | Where-Object { $_ } | Select-Object -Unique
}
function Remove-LegacyClaudeLaunchers {
  foreach ($launcher in (Get-LegacyClaudeLaunchers)) {
    if (Test-Path $launcher) {
      Remove-Item -Path $launcher -Force -ErrorAction SilentlyContinue
      if (-not (Test-Path $launcher)) {
        Write-Host "Removed old Claude launcher: $launcher"
      }
    }
  }
}
function Test-IsUserPath([string]$PathValue) {
  if (-not $PathValue) { return $false }
  $roots = @($env:USERPROFILE, $env:LOCALAPPDATA, $env:APPDATA) | Where-Object { $_ }
  foreach ($root in $roots) {
    if ($PathValue.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
      return $true
    }
  }
  return $false
}
function Get-CmdClaudePaths {
  $output = @(cmd.exe /d /c "where claude 2>nul")
  if ($LASTEXITCODE -ne 0) { return @() }
  return $output | Where-Object { $_ -and $_.Trim() } | ForEach-Object { $_.Trim() }
}
function Test-CmdClaudeWorks {
  cmd.exe /d /c "claude --version >nul 2>nul"
  return $LASTEXITCODE -eq 0
}
function Remove-BrokenCmdClaudeLaunchers {
  foreach ($launcher in (Get-CmdClaudePaths)) {
    if (-not (Test-Path $launcher)) { continue }
    if (-not (Test-IsUserPath $launcher)) { continue }
    if (Test-ClaudeCommandWorks $launcher) { continue }
    Remove-Item -Path $launcher -Force -ErrorAction SilentlyContinue
    if (-not (Test-Path $launcher)) {
      Write-Host "Removed broken Claude launcher from cmd PATH: $launcher"
    }
  }
}
function Get-ClaudeCandidateDirs {
  @(
    $NpmPrefix,
    (Join-Path $NpmPrefix "bin"),
    (Join-Path $NpmPrefix "node_modules\\.bin"),
    (Join-Path $env:APPDATA "npm"),
    (Join-Path $env:LOCALAPPDATA "Programs\\Claude"),
    (Join-Path $env:USERPROFILE ".claude\\local"),
    (Join-Path $env:USERPROFILE ".claude\\local\\bin"),
    (Join-Path $env:USERPROFILE ".local\\bin")
  ) | Where-Object { $_ } | Select-Object -Unique
}
function Add-ClaudeCandidatePaths {
  Add-AnyRoutersClaudePaths
}
function Repair-CmdClaudePath {
  Add-ClaudeCandidatePaths
  if (Test-CmdClaudeWorks) { return $true }
  Remove-BrokenCmdClaudeLaunchers
  Add-ClaudeCandidatePaths
  if (Test-CmdClaudeWorks) { return $true }
  $anyRoutersCommand = $null
  foreach ($dir in (Get-AnyRoutersClaudeDirs)) {
    foreach ($file in @("claude.cmd", "claude.exe", "claude.ps1", "claude")) {
      $candidate = Join-Path $dir $file
      if (Test-ClaudeCommandWorks $candidate) {
        $anyRoutersCommand = $candidate
        break
      }
    }
    if ($anyRoutersCommand) { break }
  }
  if ($anyRoutersCommand) {
    Remove-LegacyClaudeLaunchers
    Add-ClaudeCandidatePaths
  }
  return (Test-CmdClaudeWorks)
}
function Find-ClaudeCommand {
  foreach ($dir in (Get-ClaudeCandidateDirs)) {
    foreach ($file in @("claude.cmd", "claude.exe", "claude.ps1", "claude")) {
      $candidate = Join-Path $dir $file
      if (Test-ClaudeCommandWorks $candidate) { return $candidate }
    }
  }
  foreach ($cmd in @(Get-Command claude -All -ErrorAction SilentlyContinue)) {
    if ($cmd -and $cmd.Source -and (Test-ClaudeCommandWorks $cmd.Source)) {
      return $cmd.Source
    }
  }
  return $null
}
$installed = $false
try {
  $installer = Invoke-RestMethod -Uri "https://claude.ai/install.ps1" -ErrorAction Stop
  if ($installer.Substring(0, [Math]::Min(512, $installer.Length)) -match "(?is)<!doctype html|<html|</html") {
    throw "Official installer returned HTML"
  }
  Invoke-Expression $installer
  $claudePath = Find-ClaudeCommand
  if ($claudePath) {
    Add-UserPath (Split-Path -Parent $claudePath) $true
    $installed = $true
  } else {
    Write-Host "Official installer finished, but claude is not on PATH. Falling back to npm install."
  }
} catch {
  Write-Host "Official installer failed or returned HTML. Using the official npm package in a user-writable directory ..."
}
if (-not $installed) {
  if (-not (Get-Command node -ErrorAction SilentlyContinue) -or -not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "Install Node.js from https://nodejs.org first, then re-run this command."
  }
  New-Item -ItemType Directory -Force -Path $NpmPrefix | Out-Null
  npm install -g --prefix "$NpmPrefix" @anthropic-ai/claude-code
  Add-ClaudeCandidatePaths
  Remove-LegacyClaudeLaunchers
}
$claudePath = Find-ClaudeCommand
if ($claudePath) {
  Add-UserPath (Split-Path -Parent $claudePath) $true
  & $claudePath --version
}
if (Repair-CmdClaudePath) {
  Write-Host "Done. Open a NEW PowerShell or cmd.exe, then run: claude"
} else {
  Write-Host "cmd.exe still cannot run claude. Close all terminals and open a NEW cmd.exe, then run: where claude"
  if ($claudePath) {
    Write-Host "Detected claude at: $claudePath"
    Write-Host "Add this folder to User Path if needed: $(Split-Path -Parent $claudePath)"
  }
  $cmdPaths = @(Get-CmdClaudePaths)
  if ($cmdPaths.Count -gt 0) {
    Write-Host "cmd.exe currently finds:"
    foreach ($path in $cmdPaths) { Write-Host "  $path" }
  }
}`}
      />
    )
  }
  return (
    <CodeBlock
      code={`NPM_PREFIX="\${ANYROUTERS_NPM_PREFIX:-$HOME/.anyrouters/npm}"
install_claude_with_user_npm() {
  if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    if command -v brew >/dev/null 2>&1; then
      brew install node
    else
      echo "Install Node.js from https://nodejs.org first, then re-run this command."
      return 1
    fi
  fi
  mkdir -p "$NPM_PREFIX"
  npm install -g --prefix "$NPM_PREFIX" @anthropic-ai/claude-code
  export PATH="$NPM_PREFIX/bin:$PATH"
}
tmp_installer="$(mktemp)"
official_installed=0
if curl -fsSL https://claude.ai/install.sh -o "$tmp_installer"; then
  if LC_ALL=C head -c 512 "$tmp_installer" | grep -Eiq '<!doctype html|<html|</html'; then
    echo "Official installer returned HTML. Skipping it."
  elif bash "$tmp_installer"; then
    official_installed=1
  fi
fi
rm -f "$tmp_installer"
if [ "$official_installed" -ne 1 ]; then
  echo "Official installer failed or returned HTML. Using the official npm package in a user-writable directory ..."
  install_claude_with_user_npm
fi
if command -v claude >/dev/null 2>&1; then
  claude --version
else
  echo "Claude Code is installed, but the claude command may require opening a new terminal."
fi`}
    />
  )
}

function OfficialInstallLink({
  href,
  children,
}: {
  href: string
  children: ReactNode
}) {
  return (
    <p className='mt-2 text-sm'>
      <a
        href={href}
        target='_blank'
        rel='noopener noreferrer'
        className='inline-flex items-center gap-1 font-medium underline underline-offset-4'
      >
        {children}
        <ExternalLink className='size-3.5' />
      </a>
    </p>
  )
}

function DeveloperFlow({
  kind,
}: {
  kind: 'codex-desktop' | 'codex-cli' | 'claude'
}) {
  const isCodex = kind !== 'claude'
  const isDesktop = kind === 'codex-desktop'
  const needsInstallCheck = !isDesktop
  const keyStep = isDesktop ? 3 : needsInstallCheck ? 3 : 2
  const configStep = isDesktop ? 4 : 4
  const restartStep = isDesktop ? 5 : isCodex ? 5 : 4
  const startStep = isDesktop ? 6 : isCodex ? 6 : 5
  const verifyStep = isDesktop ? 7 : isCodex ? 7 : 6

  return (
    <section className='pt-10'>
      <SectionTitle>开发者</SectionTitle>
      <div className='mt-6 space-y-8'>
        <ManualStep
          index={1}
          title={
            kind === 'claude'
              ? '安装 Claude Code'
              : isDesktop
                ? '安装 Codex 桌面版'
                : '安装 Codex 终端版'
          }
        >
          {isDesktop ? (
            <OfficialInstallLink href={CODEX_OFFICIAL_URL}>
              打开 Codex 下载页
            </OfficialInstallLink>
          ) : kind === 'codex-cli' ? (
            <>
              <OfficialInstallLink href={CODEX_CLI_OFFICIAL_URL}>
                查看 Codex CLI 官方安装页
              </OfficialInstallLink>
              <CodexCliInstallCommands />
            </>
          ) : (
            <>
              <OfficialInstallLink href={CLAUDE_OFFICIAL_URL}>
                查看 Claude Code 官方安装页
              </OfficialInstallLink>
              <ClaudeInstallCommands />
            </>
          )}
        </ManualStep>

        {needsInstallCheck && (
          <ManualStep
            index={2}
            title={
              kind === 'codex-cli' ? '确认 Codex 可用' : '确认 Claude Code 可用'
            }
          >
            <CodeBlock
              code={
                kind === 'codex-cli' ? 'codex --version' : 'claude --version'
              }
            />
          </ManualStep>
        )}

        {isDesktop && (
          <ManualStep index={2} title='完全退出 Codex 桌面版'>
            <p className='text-muted-foreground text-sm'>
              退出后再执行下面的配置命令
            </p>
          </ManualStep>
        )}

        <ManualStep
          index={keyStep}
          title={isCodex ? '写入 API Key' : '写入环境变量'}
        >
          {isCodex ? <CodexKeyCommands /> : <ClaudeEnvCommands />}
        </ManualStep>

        {isCodex && (
          <ManualStep index={configStep} title='写入 Codex 配置'>
            <CodexConfigCommands />
          </ManualStep>
        )}

        {!isDesktop && (
          <ManualStep index={restartStep} title='打开新终端'>
            <p className='text-muted-foreground text-sm'>
              关闭当前终端窗口，再打开一个新终端
            </p>
          </ManualStep>
        )}

        <ManualStep
          index={startStep}
          title={isDesktop ? '重新打开 Codex 桌面版' : '启动'}
        >
          {isDesktop ? (
            <p className='text-muted-foreground text-sm'>打开 Codex 桌面版</p>
          ) : (
            <CodeBlock code={kind === 'codex-cli' ? 'codex' : 'claude'} />
          )}
        </ManualStep>

        <ManualStep index={verifyStep} title='验证'>
          <p className='text-muted-foreground text-sm'>发送 hello</p>
        </ManualStep>
      </div>
    </section>
  )
}

function ToolGuide({
  title,
  description,
  tool,
  toolName,
  desktopDownload,
  developerKind,
  withLinux = false,
  apiKey,
  onApiKeyChange,
}: GuideProps & {
  title: string
  description: string
  tool: 'codex' | 'codex-config' | 'claude'
  toolName: string
  desktopDownload?: boolean
  developerKind: 'codex-desktop' | 'codex-cli' | 'claude'
  withLinux?: boolean
}) {
  return (
    <OsProvider withLinux={withLinux}>
      <div>
        <h1 className='text-2xl font-semibold tracking-tight'>{title}</h1>
        <p className='text-muted-foreground mt-2 text-sm'>{description}</p>
        <div className='mt-8'>
          <UserFlow
            apiKey={apiKey}
            onApiKeyChange={onApiKeyChange}
            tool={tool}
            toolName={toolName}
            desktopDownload={desktopDownload}
          />
          <DeveloperFlow kind={developerKind} />
        </div>
      </div>
    </OsProvider>
  )
}

function CcSwitchGuide({ apiKey, onApiKeyChange }: GuideProps) {
  return (
    <div>
      <h1 className='text-2xl font-semibold tracking-tight'>cc-switch</h1>
      <div className='mt-8 space-y-8'>
        <section className='border-b pb-10'>
          <SectionTitle>普通用户</SectionTitle>
          <div className='mt-6 space-y-8'>
            <ApiKeyStep
              apiKey={apiKey}
              onApiKeyChange={onApiKeyChange}
              toolName='cc-switch'
            />
            <div className='space-y-3'>
              <StepTitle>第二步：添加 AnyRouters</StepTitle>
              <CodeBlock
                code={`Name: AnyRouters
Base URL: ${ANTHROPIC_BASE}
Token: ${KEY}
Model: ${CLAUDE_DEFAULT_MODEL}`}
              />
            </div>
          </div>
        </section>
        <DeveloperFlow kind='claude' />
      </div>
    </div>
  )
}

function CherryStudioGuide({ apiKey, onApiKeyChange }: GuideProps) {
  return (
    <div>
      <h1 className='text-2xl font-semibold tracking-tight'>Cherry Studio</h1>
      <div className='mt-8 space-y-8'>
        <section className='border-b pb-10'>
          <SectionTitle>普通用户</SectionTitle>
          <div className='mt-6 space-y-8'>
            <ApiKeyStep
              apiKey={apiKey}
              onApiKeyChange={onApiKeyChange}
              toolName='Cherry Studio'
            />
            <div className='space-y-3'>
              <StepTitle>第二步：添加 OpenAI 兼容服务</StepTitle>
              <CodeBlock
                code={`API Host: ${OPENAI_BASE}
API Key: ${KEY}`}
              />
            </div>
          </div>
        </section>
        <section className='pt-10'>
          <SectionTitle>开发者</SectionTitle>
          <div className='mt-6'>
            <CodeBlock
              code={`from openai import OpenAI

client = OpenAI(base_url="${OPENAI_BASE}", api_key="${KEY}")
resp = client.chat.completions.create(
    model="${CODEX_DEFAULT_MODEL}",
    messages=[{"role": "user", "content": "Hello"}],
)
print(resp.choices[0].message.content)`}
            />
          </div>
        </section>
      </div>
    </div>
  )
}

function codexImageInstallCommand(os: OS) {
  if (os === 'windows') {
    return `$SkillRoot = Join-Path $HOME ".codex\\skills"
New-Item -ItemType Directory -Force -Path $SkillRoot | Out-Null
Expand-Archive -Force "$HOME\\Downloads\\anyrouters-image.zip" $SkillRoot
python -m pip install --upgrade openai`
  }

  return `mkdir -p ~/.codex/skills
unzip -o ~/Downloads/anyrouters-image.zip -d ~/.codex/skills
python3 -m pip install --upgrade openai`
}

function CodexImageGuide() {
  const { os } = useOsChoice()

  return (
    <div>
      <h1 className='text-2xl font-semibold tracking-tight'>Codex-生图</h1>
      <p className='text-muted-foreground mt-2 text-sm'>
        给 Codex 安装 AnyRouters 生图技能后，可以用同一把 API Key 调用
        gpt-image-2 生成真实图片，也支持参考图改风格、透明背景和局部重绘。
      </p>
      <div className='mt-8 space-y-8'>
        <section className='border-b pb-10'>
          <SectionTitle>普通用户</SectionTitle>
          <div className='mt-6 space-y-8'>
            <ManualStep index={1} title='先完成 Codex 桌面版配置'>
              <p className='text-muted-foreground text-sm'>
                在左侧 Codex-桌面版完成配置，确认可以正常发送 hello
                后，再安装生图技能。
              </p>
            </ManualStep>

            <ManualStep index={2} title='下载技能包'>
              <Button
                variant='outline'
                render={
                  <a
                    href={ANYROUTERS_IMAGE_SKILL_URL}
                    download='anyrouters-image.zip'
                  />
                }
              >
                下载 anyrouters-image 技能包
                <WandSparkles className='size-4' />
              </Button>
            </ManualStep>

            <ManualStep index={3} title='交给 Codex 安装'>
              <p className='text-muted-foreground text-sm'>
                把下载好的 zip 文件拖进 Codex 对话框，然后发送这句话：
              </p>
              <CodeBlock
                code={`帮我安装这个 anyrouters-image 技能。请把它解压到 Codex skills 目录，安装 Python openai SDK。装好后提醒我完全退出并重启 Codex。`}
              />
            </ManualStep>

            <ManualStep index={4} title='重启 Codex'>
              <p className='text-muted-foreground text-sm'>
                完全退出 Codex 桌面版，再重新打开；技能只会在重启后稳定生效。
              </p>
            </ManualStep>

            <ManualStep index={5} title='试一下'>
              <CodeBlock
                code={`生成一张图：一只极简风格的 AnyRouters 机器人头像
画一张海报：未来感 API 中转站，深色科技风
帮我做个 logo：AnyRouters，简洁、可信、适合网站导航栏
anyrouters-image 生成一张 16:9 的产品宣传图
把这张图改成水彩风
局部重绘这个区域：把绿色区域改成一个发光的按钮`}
              />
            </ManualStep>
          </div>
        </section>

        <section className='pt-10'>
          <SectionTitle>手动安装备用</SectionTitle>
          <div className='mt-6 space-y-6'>
            <OsToggle />
            <CodeBlock code={codexImageInstallCommand(os)} />
            <p className='text-muted-foreground text-sm'>
              手动安装后同样需要完全退出并重启 Codex。Windows 如果提示没有
              python，请先从 Python 官网安装后再运行上面的命令。
            </p>
          </div>
        </section>
      </div>
    </div>
  )
}

type GuideEntry = {
  id: string
  label: string
  icon: LucideIcon
  render: (props: GuideProps) => ReactNode
}

const GUIDES: GuideEntry[] = [
  {
    id: 'claude-code',
    label: 'Claude Code-终端版',
    icon: SquareTerminal,
    render: (props) => (
      <ToolGuide
        {...props}
        title='Claude Code-终端版'
        description=''
        tool='claude'
        toolName='Claude Code'
        developerKind='claude'
        withLinux
      />
    ),
  },
  {
    id: 'codex-desktop',
    label: 'Codex-桌面版',
    icon: AppWindow,
    render: (props) => (
      <ToolGuide
        {...props}
        title='Codex-桌面版'
        description=''
        tool='codex-config'
        toolName='Codex Desktop'
        developerKind='codex-desktop'
        desktopDownload
      />
    ),
  },
  {
    id: 'codex-cli',
    label: 'Codex-终端版',
    icon: MessageSquareCode,
    render: (props) => (
      <ToolGuide
        {...props}
        title='Codex-终端版'
        description=''
        tool='codex'
        toolName='Codex CLI'
        developerKind='codex-cli'
        withLinux
      />
    ),
  },
  {
    id: 'codex-image',
    label: 'Codex-生图',
    icon: WandSparkles,
    render: () => (
      <OsProvider>
        <CodexImageGuide />
      </OsProvider>
    ),
  },
  {
    id: 'cc-switch',
    label: 'cc-switch切换器',
    icon: SquareTerminal,
    render: (props) => <CcSwitchGuide {...props} />,
  },
  {
    id: 'cherry-studio',
    label: 'Cherry Studio聊天',
    icon: MonitorSmartphone,
    render: (props) => <CherryStudioGuide {...props} />,
  },
]

export function Docs() {
  const [active, setActive] = useState('codex-desktop')
  const [apiKey, setApiKey] = useState('')
  const activeGuide = GUIDES.find((guide) => guide.id === active) ?? GUIDES[0]

  return (
    <div className='h-full overflow-y-auto'>
      <div className='mx-auto flex w-full max-w-6xl gap-8 px-6 py-10'>
        <nav className='hidden w-52 shrink-0 sm:block'>
          <p className='text-muted-foreground px-2 text-xs font-medium'>
            快速接入：
          </p>
          <div className='mt-3 space-y-1'>
            {GUIDES.map((guide) => {
              const Icon = guide.icon
              return (
                <button
                  key={guide.id}
                  type='button'
                  onClick={() => setActive(guide.id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors',
                    active === guide.id
                      ? 'bg-foreground text-background'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <Icon className='size-4 shrink-0' />
                  <span className='truncate'>{guide.label}</span>
                </button>
              )
            })}
          </div>
        </nav>

        <main className='min-w-0 flex-1'>
          <div className='mb-6 flex flex-wrap gap-2 sm:hidden'>
            {GUIDES.map((guide) => (
              <button
                key={guide.id}
                type='button'
                onClick={() => setActive(guide.id)}
                className={cn(
                  'rounded-md border px-3 py-1.5 text-xs transition-colors',
                  active === guide.id
                    ? 'border-foreground bg-foreground text-background'
                    : 'text-muted-foreground'
                )}
              >
                {guide.label}
              </button>
            ))}
          </div>
          <KeyContext.Provider value={apiKey}>
            {activeGuide.render({
              apiKey,
              onApiKeyChange: setApiKey,
            })}
          </KeyContext.Provider>
        </main>
      </div>
    </div>
  )
}
