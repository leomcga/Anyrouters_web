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
  WandSparkles,
  type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createApiKey, fetchTokenKey, searchApiKeys } from '../keys/api'

const OPENAI_BASE = 'https://api.anyrouters.com/v1'
const ANTHROPIC_BASE = 'https://api.anyrouters.com'
const CODEX_OFFICIAL_URL = 'https://developers.openai.com/codex'
const KEY = 'YOUR_ANYROUTERS_API_KEY'
const CODEX_DEFAULT_MODEL = 'gpt-5.5'
const CLAUDE_DEFAULT_MODEL = 'claude-sonnet-4-6'

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

async function fetchExistingKeyByTool(toolName: string) {
  const found = await searchApiKeys({ keyword: toolName, p: 1, size: 20 })
  const token = found.data?.items?.find(
    (item) =>
      item.status === 1 &&
      (item.name === toolName || item.name.startsWith(toolName))
  )
  if (!token) return ''
  const full = await fetchTokenKey(token.id)
  return full.success ? normalizeApiKey(full.data?.key || '') : ''
}

async function getOrCreateApiKey(toolName: string) {
  const existing = await fetchExistingKeyByTool(toolName)
  if (existing) return { key: existing, reused: true }

  const name = apiKeyName(toolName)
  const created = await createApiKey({
    name,
    remain_quota: 0,
    expired_time: -1,
    unlimited_quota: true,
    model_limits_enabled: false,
    model_limits: '',
    allow_ips: '',
    group: 'default',
    cross_group_retry: false,
  })
  if (!created.success) {
    throw new Error(created.message || 'API Key 创建失败')
  }

  const key = await fetchExistingKeyByTool(toolName)
  if (!key) throw new Error('API Key 已创建，但读取完整 key 失败')
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
    const platform = `${navigator.userAgent} ${navigator.platform}`.toLowerCase()
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
  const items: OS[] = withLinux ? ['mac', 'windows', 'linux'] : ['mac', 'windows']

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
    return `$env:ANYROUTERS_KEY="${key}"; irm ${endpoint}.ps1 | iex`
  }
  return `curl -fsSL ${endpoint}.sh | bash -s -- "${key}"`
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
          <StepTitle>第三步：快速安装</StepTitle>
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
            <li>
              {desktopDownload
                ? `完全退出 Codex 桌面版，再${os === 'windows' ? '打开 PowerShell' : '打开终端'}`
                : os === 'windows'
                  ? '打开 PowerShell'
                  : '打开终端'}
            </li>
            <li>
              <span>粘贴这行</span>
              <CodeBlock code={command} />
            </li>
            <li>回车</li>
            {desktopDownload && <li>等待完成后，重新打开 Codex 桌面版</li>}
          </ol>
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
@'
${codexConfig()}
'@ | Set-Content -Encoding UTF8 "$HOME\\.codex\\config.toml"`
  }

  return `mkdir -p ~/.codex && cat > ~/.codex/config.toml <<'EOF'
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
@"
{
  "OPENAI_API_KEY": "$Key"
}
"@ | Set-Content -Encoding UTF8 "$HOME\\.codex\\auth.json"
[Environment]::SetEnvironmentVariable("OPENAI_API_KEY", $Key, "User")`}
      />
    )
  }

  if (os === 'mac') {
    return (
      <CodeBlock
        code={`mkdir -p ~/.codex
KEY="${KEY}"
printf '{\\n  "OPENAI_API_KEY": "%s"\\n}\\n' "$KEY" > ~/.codex/auth.json
chmod 600 ~/.codex/auth.json
launchctl setenv OPENAI_API_KEY "$KEY"
printf '\\nexport OPENAI_API_KEY="%s"\\n' "$KEY" >> ~/.zshrc`}
      />
    )
  }

  return (
    <CodeBlock
      code={`mkdir -p ~/.codex
KEY="${KEY}"
printf '{\\n  "OPENAI_API_KEY": "%s"\\n}\\n' "$KEY" > ~/.codex/auth.json
chmod 600 ~/.codex/auth.json
printf '\\nexport OPENAI_API_KEY="%s"\\n' "$KEY" >> ~/.bashrc`}
    />
  )
}

function ClaudeEnvCommands() {
  const { os } = useOsChoice()
  if (os === 'windows') {
    return (
      <CodeBlock
        code={`$Key = "${KEY}"
[Environment]::SetEnvironmentVariable("ANTHROPIC_BASE_URL", "${ANTHROPIC_BASE}", "User")
[Environment]::SetEnvironmentVariable("ANTHROPIC_AUTH_TOKEN", $Key, "User")
[Environment]::SetEnvironmentVariable("ANTHROPIC_MODEL", "${CLAUDE_DEFAULT_MODEL}", "User")`}
      />
    )
  }

  if (os === 'mac') {
    return (
      <CodeBlock
        code={`cat >> ~/.zshrc <<'EOF'
export ANTHROPIC_BASE_URL=${ANTHROPIC_BASE}
export ANTHROPIC_AUTH_TOKEN=${KEY}
export ANTHROPIC_MODEL=${CLAUDE_DEFAULT_MODEL}
EOF
source ~/.zshrc`}
      />
    )
  }

  return (
    <CodeBlock
      code={`cat >> ~/.bashrc <<'EOF'
export ANTHROPIC_BASE_URL=${ANTHROPIC_BASE}
export ANTHROPIC_AUTH_TOKEN=${KEY}
export ANTHROPIC_MODEL=${CLAUDE_DEFAULT_MODEL}
EOF
source ~/.bashrc`}
    />
  )
}

function DeveloperFlow({
  kind,
}: {
  kind: 'codex-desktop' | 'codex-cli' | 'claude'
}) {
  const isCodex = kind !== 'claude'
  const isDesktop = kind === 'codex-desktop'
  const keyStep = isDesktop ? 3 : 2
  const configStep = isDesktop ? 4 : 3
  const startStep = isCodex ? (isDesktop ? 5 : 4) : 3
  const verifyStep = isCodex ? (isDesktop ? 6 : 5) : 4

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
            <p className='mt-2 text-sm'>
              <a
                href={CODEX_OFFICIAL_URL}
                target='_blank'
                rel='noopener noreferrer'
                className='inline-flex items-center gap-1 font-medium underline underline-offset-4'
              >
                打开 Codex 下载页
                <ExternalLink className='size-3.5' />
              </a>
            </p>
          ) : kind === 'codex-cli' ? (
            <CodeBlock code='npm install -g @openai/codex' />
          ) : (
            <CodeBlock code='npm install -g @anthropic-ai/claude-code' />
          )}
        </ManualStep>

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

        <ManualStep
          index={startStep}
          title={isDesktop ? '重新打开 Codex 桌面版' : '启动'}
        >
          {isDesktop ? (
            <p className='text-muted-foreground text-sm'>
              打开 Codex 桌面版
            </p>
          ) : (
            <CodeBlock code={kind === 'codex-cli' ? 'codex' : 'cd your-project\nclaude'} />
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

function CcSwitchGuide() {
  return (
    <div>
      <h1 className='text-2xl font-semibold tracking-tight'>cc-switch</h1>
      <div className='mt-8 space-y-8'>
        <section className='border-b pb-10'>
          <SectionTitle>普通用户</SectionTitle>
          <div className='mt-6 space-y-3'>
            <StepTitle>添加 AnyRouters</StepTitle>
            <CodeBlock
              code={`Name: AnyRouters
Base URL: ${ANTHROPIC_BASE}
Token: ${KEY}
Model: ${CLAUDE_DEFAULT_MODEL}`}
            />
          </div>
        </section>
        <DeveloperFlow kind='claude' />
      </div>
    </div>
  )
}

function CherryStudioGuide() {
  return (
    <div>
      <h1 className='text-2xl font-semibold tracking-tight'>Cherry Studio</h1>
      <div className='mt-8 space-y-8'>
        <section className='border-b pb-10'>
          <SectionTitle>普通用户</SectionTitle>
          <div className='mt-6 space-y-3'>
            <StepTitle>添加 OpenAI 兼容服务</StepTitle>
            <CodeBlock
              code={`API Host: ${OPENAI_BASE}
API Key: ${KEY}`}
            />
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
    id: 'cc-switch',
    label: 'cc-switch切换器',
    icon: SquareTerminal,
    render: () => <CcSwitchGuide />,
  },
  {
    id: 'cherry-studio',
    label: 'Cherry Studio聊天',
    icon: MonitorSmartphone,
    render: () => <CherryStudioGuide />,
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
