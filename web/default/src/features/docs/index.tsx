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
import { createContext, useContext, useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  AppWindow,
  ArrowRight,
  BookOpen,
  Boxes,
  Check,
  ChevronDown,
  Copy,
  Download,
  Info,
  KeyRound,
  MessageSquareCode,
  MonitorSmartphone,
  Sparkles,
  SquareTerminal,
  TriangleAlert,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { createApiKey, fetchTokenKey, searchApiKeys } from '../keys/api'
import { toast } from 'sonner'

// Public developer endpoints. OpenAI-compatible carries the /v1 suffix; the
// Anthropic-native base (used by Claude Code) does not.
const OPENAI_BASE = 'https://api.anyrouters.com/v1'
const ANTHROPIC_BASE = 'https://api.anyrouters.com'
const CODEX_OFFICIAL_URL = 'https://developers.openai.com/codex'
// The placeholder shown (in red) wherever the user must drop in their own key.
// When the user pastes a real key into the KeyBar, we swap this out everywhere.
const KEY = 'YOUR_ANYROUTERS_API_KEY'

const CODEX_MODELS = [
  'gpt-5.5',
  'gpt-5.4',
  'claude-sonnet-4-6',
  'gemini-3.5-flash',
]

const CLAUDE_MODELS = ['claude-sonnet-4-6', 'claude-opus-4-8']

type GuideProps = {
  apiKey: string
  onApiKeyChange: (v: string) => void
}

// ----------------------------------------------------------------------------
// Key context — the user pastes their key once at the top; every code block and
// downloadable file below is then rendered with the real key already filled in,
// so a non-technical user never has to hand-edit a command.
// ----------------------------------------------------------------------------

const KeyContext = createContext<string>('')
const useApiKey = () => useContext(KeyContext)

/** Replace the placeholder key with the user's real one (or leave the
 *  placeholder if they haven't pasted anything yet). */
function withKey(code: string, key: string): string {
  const trimmed = key.trim()
  return trimmed ? code.split(KEY).join(trimmed) : code
}

function apiKeyName(toolName: string, model: string) {
  return `${toolName}-${model}`.slice(0, 50)
}

async function fetchExistingKeyByName(name: string) {
  const found = await searchApiKeys({ keyword: name, p: 1, size: 20 })
  const token = found.data?.items?.find((item) => item.name === name)
  if (!token) return ''
  const full = await fetchTokenKey(token.id)
  return full.success ? full.data?.key || '' : ''
}

async function createOrReuseApiKey(toolName: string, model: string) {
  const name = apiKeyName(toolName, model)
  const existing = await fetchExistingKeyByName(name)
  if (existing) return existing

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

  const key = await fetchExistingKeyByName(name)
  if (!key) throw new Error('API Key 已创建，但读取完整 key 失败')
  return key
}

/** Trigger a browser download of a text file (script / config), with the user's
 *  key already substituted in. Pure client-side, no backend. */
function downloadTextFile(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ----------------------------------------------------------------------------
// Building blocks
// ----------------------------------------------------------------------------

/** The paste-your-key bar. Sits at the top of every tool guide; once filled, all
 *  code blocks / downloads on the page use the real key automatically. */
function KeyBar({
  apiKey,
  onChange,
}: {
  apiKey: string
  onChange: (v: string) => void
}) {
  const { t } = useTranslation()
  const filled = !!apiKey.trim()
  const hasWrongPrefix = apiKey
    .trim()
    .toLowerCase()
    .startsWith('sk-anyrouters-')
  return (
    <div
      className={cn(
        'mb-5 rounded-xl border p-3 transition-colors',
        filled
          ? 'border-emerald-500/30 bg-emerald-500/[0.05]'
          : 'border-border bg-muted/30'
      )}
    >
      <div className='flex items-center gap-2'>
        <KeyRound
          className={cn(
            'size-4 shrink-0',
            filled ? 'text-emerald-500' : 'text-muted-foreground'
          )}
        />
        <label className='text-sm font-medium'>
          {t('Paste your API key once — we fill it into every step below')}
        </label>
      </div>
      <div className='mt-2 flex flex-wrap items-center gap-2'>
        <Input
          type='text'
          spellCheck={false}
          autoComplete='off'
          placeholder='粘贴完整 API Key，例如 sk-xxxxxxxx'
          value={apiKey}
          onChange={(e) => onChange(e.target.value)}
          className='h-9 max-w-md font-mono text-sm'
        />
        {filled ? (
          <span className='flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400'>
            <Check className='size-3.5' />
            {t('Filled in — copy any command as-is')}
          </span>
        ) : (
          <Button variant='outline' size='sm' render={<Link to='/keys' />}>
            <KeyRound className='size-4' />
            {t("Don't have a key? Create one")}
          </Button>
        )}
      </div>
      {hasWrongPrefix && (
        <div className='mt-2 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/[0.06] px-3 py-2 text-xs text-red-700 dark:text-red-300'>
          <TriangleAlert className='mt-0.5 size-3.5 shrink-0' />
          <span>
            这个 key 前缀不对。请复制 AnyRouters「创建 API Key」弹窗里的完整
            key，不要在前面额外加 `sk-anyrouters-`。
          </span>
        </div>
      )}
    </div>
  )
}

/** Renders code with a copy button; the API-key placeholder is shown in red so
 *  users immediately see what they must replace — unless they've already pasted
 *  their key above, in which case the real key is shown filled in. */
function CodeBlock({ code }: { code: string }) {
  const { t } = useTranslation()
  const apiKey = useApiKey()
  const { copyToClipboard } = useCopyToClipboard()
  const [copied, setCopied] = useState(false)

  const resolved = withKey(code, apiKey)
  const handleCopy = () => {
    copyToClipboard(resolved)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  // Split on whichever token is actually present so we can highlight it.
  const highlightToken = apiKey.trim() ? apiKey.trim() : KEY
  const segments = resolved.split(highlightToken)

  return (
    <div className='group relative min-w-0'>
      <pre className='max-w-full overflow-x-auto rounded-xl border bg-muted/40 p-4 pr-12 text-[13px] leading-relaxed'>
        <code className='font-mono'>
          {segments.map((seg, i) => (
            <span key={i}>
              {seg}
              {i < segments.length - 1 && (
                <span className='rounded bg-red-500/10 px-1 font-semibold text-red-600 dark:text-red-400'>
                  {highlightToken}
                </span>
              )}
            </span>
          ))}
        </code>
      </pre>
      <button
        type='button'
        onClick={handleCopy}
        title={t('Copy')}
        className='text-muted-foreground hover:text-foreground hover:bg-background absolute top-2.5 right-2.5 rounded-md border bg-background/60 p-1.5 opacity-0 transition-opacity group-hover:opacity-100'
      >
        {copied ? (
          <Check className='size-3.5 text-emerald-500' />
        ) : (
          <Copy className='size-3.5' />
        )}
      </button>
    </div>
  )
}

function CopyCommandButton({ command }: { command: string }) {
  const { t } = useTranslation()
  const apiKey = useApiKey()
  const { copyToClipboard } = useCopyToClipboard()
  const [copied, setCopied] = useState(false)
  const resolved = withKey(command, apiKey)
  return (
    <Button
      size='sm'
      className='mt-3'
      onClick={() => {
        copyToClipboard(resolved)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
    >
      {copied ? (
        <Check className='size-4 text-emerald-500' />
      ) : (
        <Copy className='size-4' />
      )}
      {copied ? t('Copied') : '复制这一行'}
    </Button>
  )
}

/** A "download this file (with your key already filled in)" button — for config
 *  files (e.g. Codex config.toml) so a beginner doesn't have to create the file
 *  by hand. */
function DownloadFileButton({
  content,
  filename,
  label,
}: {
  content: string
  filename: string
  label?: string
}) {
  const { t } = useTranslation()
  const apiKey = useApiKey()
  return (
    <Button
      size='sm'
      variant='outline'
      className='mt-3'
      onClick={() => downloadTextFile(withKey(content, apiKey), filename)}
    >
      <Download className='size-4' />
      {label || t('Download {{filename}}', { filename })}
    </Button>
  )
}

type OS = 'mac' | 'windows' | 'linux'

const OS_LABELS: Record<OS, string> = {
  mac: 'macOS',
  windows: 'Windows',
  linux: 'Linux',
}

// One shared OS choice per guide: the reader picks their system ONCE at the top
// and every OS-specific block below shows only their steps — no scrolling past
// the other system's instructions. Falls back to macOS when used outside a
// provider so components stay safe to render anywhere.
const OsChoiceContext = createContext<{
  os: OS
  setOs: (o: OS) => void
  withLinux: boolean
} | null>(null)

function OsProvider({
  withLinux = false,
  children,
}: {
  withLinux?: boolean
  children: React.ReactNode
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

// Prominent segmented control — the reader taps their system and the whole page
// follows. Deliberately eye-catching so it reads as "choose here first".
function OsToggle() {
  const { t } = useTranslation()
  const { os, setOs, withLinux } = useOsChoice()
  const list: OS[] = withLinux ? ['mac', 'windows', 'linux'] : ['mac', 'windows']
  return (
    <div className='bg-muted/40 mt-4 flex flex-wrap items-center gap-2 rounded-xl border p-2.5'>
      <span className='text-muted-foreground pl-1 text-xs font-medium'>
        {t('Your system:')}
      </span>
      <div className='flex gap-1'>
        {list.map((o) => (
          <button
            key={o}
            type='button'
            onClick={() => setOs(o)}
            className={cn(
              'rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
              os === o
                ? 'border-foreground bg-foreground text-background'
                : 'text-muted-foreground hover:bg-background'
            )}
          >
            {OS_LABELS[o]}
          </button>
        ))}
      </div>
    </div>
  )
}

function Step({ n, title }: { n: number; title: string }) {
  return (
    <div className='mt-5 flex items-center gap-2'>
      <span className='bg-foreground text-background flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold'>
        {n}
      </span>
      <h3 className='text-sm font-semibold tracking-tight'>{title}</h3>
    </div>
  )
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className='text-muted-foreground mt-2 text-[13px] leading-relaxed'>
      {children}
    </p>
  )
}

/** A plain-language aside explaining, in one friendly sentence, what a command
 *  actually does — so a non-technical user isn't staring at jargon. */
function Plain({ children }: { children: React.ReactNode }) {
  return (
    <p className='text-muted-foreground/80 mt-1.5 text-[12px] leading-relaxed italic'>
      {children}
    </p>
  )
}

/** A highlighted box for a must-know setup detail. `warn` (amber) marks the one
 *  spot people commonly get wrong; `tip` (blue) is a helpful aside. */
function Callout({
  tone = 'warn',
  children,
}: {
  tone?: 'warn' | 'tip'
  children: React.ReactNode
}) {
  const warn = tone === 'warn'
  return (
    <div
      className={cn(
        'mt-3 flex gap-2.5 rounded-xl border p-3',
        warn
          ? 'border-amber-500/30 bg-amber-500/[0.06]'
          : 'border-sky-500/30 bg-sky-500/[0.06]'
      )}
    >
      {warn ? (
        <TriangleAlert className='mt-0.5 size-4 shrink-0 text-amber-500' />
      ) : (
        <Info className='mt-0.5 size-4 shrink-0 text-sky-500' />
      )}
      <div className='text-foreground/80 text-[13px] leading-relaxed'>
        {children}
      </div>
    </div>
  )
}

function GuideLayer({
  label,
  title,
  description,
  tone = 'default',
  children,
}: {
  label: string
  title: string
  description?: string
  tone?: 'default' | 'primary' | 'warn' | 'violet'
  children: React.ReactNode
}) {
  const toneClass = {
    default: 'border-border bg-background',
    primary: 'border-emerald-500/30 bg-emerald-500/[0.05]',
    warn: 'border-amber-500/30 bg-amber-500/[0.06]',
    violet: 'border-violet-500/30 bg-violet-500/[0.05]',
  }[tone]
  return (
    <section className={cn('mt-6 rounded-xl border p-5', toneClass)}>
      <div className='flex flex-wrap items-start gap-3'>
        <span className='bg-foreground text-background rounded-full px-2.5 py-1 text-[11px] font-semibold'>
          {label}
        </span>
        <div className='min-w-0 flex-1'>
          <h2 className='text-lg font-semibold tracking-tight'>{title}</h2>
          {description && (
            <p className='text-muted-foreground mt-1 text-sm leading-relaxed'>
              {description}
            </p>
          )}
        </div>
      </div>
      <div className='mt-4'>{children}</div>
    </section>
  )
}

/** Common-error reference at the bottom of each tool page: the handful of
 *  mistakes that actually break setup, each with the symptom and the fix. */
function Troubleshooting({
  items,
}: {
  items: { symptom: string; fix: string }[]
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <Collapsible open={open} onOpenChange={setOpen} className='mt-8'>
      <CollapsibleTrigger className='text-muted-foreground hover:text-foreground flex w-full items-center gap-2 text-[13px] font-medium transition-colors'>
        <ChevronDown
          className={cn(
            'size-4 transition-transform',
            open ? 'rotate-0' : '-rotate-90'
          )}
        />
        {t('Something went wrong? Common fixes')}
      </CollapsibleTrigger>
      <CollapsibleContent className='mt-2 space-y-2'>
        {items.map((it, i) => (
          <div key={i} className='rounded-xl border p-3'>
            <p className='text-[13px] font-medium'>{it.symptom}</p>
            <p className='text-muted-foreground mt-1 text-[13px] leading-relaxed'>
              <span className='text-emerald-600 dark:text-emerald-400'>
                {t('Fix')}:
              </span>{' '}
              {it.fix}
            </p>
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}

// ----------------------------------------------------------------------------
// Guides
// ----------------------------------------------------------------------------

function OverviewGuide() {
  const { t } = useTranslation()
  return (
    <div>
      <h1 className='text-2xl font-semibold tracking-tight'>
        {t('Quickstart')}
      </h1>
      <p className='text-muted-foreground mt-2 text-sm'>
        {t('One OpenAI- and Anthropic-compatible endpoint for every model.')}
      </p>

      {/* Beginner router: send non-coders straight to the no-terminal path. */}
      <div className='mt-5 grid gap-3 sm:grid-cols-2'>
        <div className='rounded-xl border p-4'>
          <div className='flex items-center gap-2'>
            <MessageSquareCode className='size-4 text-violet-500' />
            <h3 className='text-sm font-semibold'>
              {t('I just want to chat or write')}
            </h3>
          </div>
          <Note>
            {t(
              'No installing, no commands. Use it right here in your browser, or in a desktop app like Cherry Studio.'
            )}
          </Note>
          <div className='mt-3 flex flex-wrap gap-2'>
            <Button size='sm' render={<Link to='/playground' />}>
              {t('Open chat')}
            </Button>
          </div>
        </div>
        <div className='rounded-xl border p-4'>
          <div className='flex items-center gap-2'>
            <SquareTerminal className='size-4 text-sky-500' />
            <h3 className='text-sm font-semibold'>
              {t('I want to code on my computer')}
            </h3>
          </div>
          <Note>
            {t(
              'Use Claude Code or Codex. Pick your tool on the left — each guide has a three-step setup and one copyable command.'
            )}
          </Note>
        </div>
      </div>

      <Step n={1} title={t('Get your API key')} />
      <Note>
        {t('Create a key in the console, then use it as the Bearer token.')}
      </Note>
      <div className='mt-3'>
        <Button size='sm' render={<Link to='/keys' />}>
          <KeyRound className='size-4' />
          {t('Create API Keys')}
        </Button>
      </div>

      <Step n={2} title={t('Base URLs')} />
      <Note>{t('Use the OpenAI-compatible base for most tools:')}</Note>
      <CodeBlock code={OPENAI_BASE} />
      <Note>{t('Use the Anthropic-native base for Claude Code:')}</Note>
      <CodeBlock code={ANTHROPIC_BASE} />

      <Step n={3} title={t('First request')} />
      <CodeBlock
        code={`curl ${OPENAI_BASE}/chat/completions \\
  -H "Authorization: Bearer ${KEY}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "claude-sonnet-4-6",
    "messages": [{"role": "user", "content": "Hello"}]
  }'`}
      />
      <CodeBlock
        code={`from openai import OpenAI

client = OpenAI(base_url="${OPENAI_BASE}", api_key="${KEY}")
resp = client.chat.completions.create(
    model="claude-sonnet-4-6",  # or gemini-3.5-flash, claude-opus-4-8, gpt-5.4
    messages=[{"role": "user", "content": "Hello"}],
)
print(resp.choices[0].message.content)`}
      />

      <Step n={4} title={t('Available models')} />
      <Note>
        {t(
          'Claude, Gemini and ChatGPT (incl. gpt-image-2) — all first-party, never throttled.'
        )}
      </Note>
      <div className='mt-3'>
        <Button variant='outline' size='sm' render={<Link to='/pricing' />}>
          {t('Model Marketplace')}
          <ArrowRight className='size-4' />
        </Button>
      </div>
    </div>
  )
}

// The RECOMMENDED install path: one line the reader pastes into their terminal.
// Piping to bash/PowerShell dodges every download-permission problem — no
// Gatekeeper quarantine (macOS), no execution-policy block (Windows), no
// "double-click does nothing". It also overwrites the config, so it repairs a
// stale setup (e.g. an old env_key line) on the way in.
function OneLineInstall({
  tool,
  model,
  mode = 'install',
}: {
  tool: 'codex' | 'claude' | 'codex-config'
  model?: string
  mode?: 'install' | 'reset'
}) {
  const { t } = useTranslation()
  const { os } = useOsChoice()
  const apiKey = useApiKey()
  const key = apiKey.trim() || '先在本页顶部输入 API 密钥'
  const base = 'https://anyrouters.com/install'
  const endpoint = tool === 'codex-config' ? 'codex-config' : tool
  const isReset = mode === 'reset'
  const modelPrefix =
    model && os === 'windows'
      ? `$env:ANYROUTERS_MODEL="${model}"; `
      : model
        ? `export ANYROUTERS_MODEL="${model}"; `
        : ''
  const cmd =
    os === 'windows'
      ? `${isReset ? '$env:ANYROUTERS_RESET="1"; ' : ''}${modelPrefix}$env:ANYROUTERS_KEY="${key}"; irm ${base}/${endpoint}.ps1 | iex`
      : `${modelPrefix}curl -fsSL ${base}/${endpoint}.sh | bash -s -- "${key}"${isReset ? ' --reset' : ''}`
  const openHint =
    os === 'windows'
      ? t(
          'Open PowerShell (Start menu → type "PowerShell" → Enter), paste the line, press Enter.'
        )
      : t(
          'Open Terminal (press Cmd+Space, type "Terminal", Enter), paste the line, press Enter.'
        )
  return (
    <div className='border-primary/30 bg-primary/[0.05] mt-4 min-w-0 rounded-xl border p-4'>
      <div className='flex items-center gap-2'>
        <Sparkles className='text-primary size-4' />
        <h3 className='text-sm font-semibold tracking-tight'>
          {isReset ? '一行深度修复' : '最快：一行搞定'}
        </h3>
      </div>
      <Note>{openHint}</Note>
      <div className='mt-2'>
        <CodeBlock code={cmd} />
      </div>
      <CopyCommandButton command={cmd} />
      {!apiKey.trim() && (
        <Callout>
          {t(
            'Paste your API key in the box at the top of this page first — it drops straight into the command.'
          )}
        </Callout>
      )}
      <p className='text-muted-foreground/80 mt-1.5 text-[12px] leading-relaxed'>
        {isReset
          ? tool === 'claude'
            ? '会备份 shell profile，移除旧的 AnyRouters 管理块并重写 ANTHROPIC_* 环境变量，用来修复 URL、模型或密钥写错。'
            : '会备份并重写 AnyRouters 相关配置，重新设置 OPENAI_API_KEY，用来修复旧配置、装错模型、密钥写错、Codex 仍发送旧登录 token 等问题。'
          : tool === 'codex-config'
            ? '它会写 Codex 桌面版配置，并设置 OPENAI_API_KEY 用户环境变量；不下载安装包。'
            : t(
                'It installs everything and writes the config for you. Nothing to download, no permission prompts, no “blocked by the system”.'
              )}
      </p>
    </div>
  )
}

function ModelSelect({
  value,
  options,
  onChange,
}: {
  value: string
  options: string[]
  onChange: (v: string) => void
}) {
  return (
    <div className='flex flex-wrap gap-2'>
      {options.map((model) => (
        <button
          key={model}
          type='button'
          onClick={() => onChange(model)}
          className={cn(
            'rounded-full border px-3 py-1.5 font-mono text-xs transition-colors',
            value === model
              ? 'border-foreground bg-foreground text-background'
              : 'text-muted-foreground hover:bg-muted/60'
          )}
        >
          {model}
        </button>
      ))}
    </div>
  )
}

function BeginnerSetup({
  apiKey,
  onApiKeyChange,
  toolName,
  tool,
  model,
  modelOptions,
  onModelChange,
  desktopDownload = false,
}: {
  apiKey: string
  onApiKeyChange: (v: string) => void
  toolName: string
  tool: 'codex' | 'claude' | 'codex-config'
  model: string
  modelOptions: string[]
  onModelChange: (v: string) => void
  desktopDownload?: boolean
}) {
  const { os } = useOsChoice()
  const [creating, setCreating] = useState(false)
  const hasKey = !!apiKey.trim()
  const wrongPrefix = apiKey.trim().toLowerCase().startsWith('sk-anyrouters-')

  const createKey = async () => {
    setCreating(true)
    try {
      const key = await createOrReuseApiKey(toolName, model)
      onApiKeyChange(key)
      toast.success('API Key 已填入')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'API Key 创建失败')
    } finally {
      setCreating(false)
    }
  }

  return (
    <section className='mt-5 space-y-0 border-y bg-background'>
      <div className='grid gap-3 px-5 md:grid-cols-[180px_1fr] md:items-center'>
        <div className='pt-5 text-sm font-semibold md:py-5'>
          第一步：创建 API Key
        </div>
        <div className='flex min-w-0 flex-col gap-2 lg:flex-row lg:items-center'>
          <Button onClick={createKey} disabled={creating} className='w-fit'>
            <KeyRound className='size-4' />
            {creating ? '创建中' : '自动创建'}
          </Button>
          <div className='flex min-w-0 flex-1 items-center gap-2'>
            <Input
              type='text'
              spellCheck={false}
              autoComplete='off'
              placeholder='或粘贴已有 API Key'
              value={apiKey}
              onChange={(e) => onApiKeyChange(e.target.value)}
              className='h-9 min-w-0 font-mono text-sm'
            />
            {hasKey && (
              <span className='hidden items-center gap-1 text-xs font-medium text-emerald-600 sm:flex'>
                <Check className='size-3.5' />
                已填入
              </span>
            )}
          </div>
        </div>
        {wrongPrefix && (
          <div className='md:col-start-2'>
            <div className='rounded-lg border border-red-500/30 bg-red-500/[0.06] px-3 py-2 text-xs text-red-700 dark:text-red-300'>
              不要额外加 sk-anyrouters-，请复制弹窗里的完整 key。
            </div>
          </div>
        )}
      </div>

      <div className='grid gap-3 border-t px-5 py-5 md:grid-cols-[180px_1fr] md:items-center'>
        <div className='text-sm font-semibold'>第二步：选择电脑和模型</div>
        <div className='min-w-0 space-y-3'>
          <OsToggle />
          <ModelSelect
            value={model}
            options={modelOptions}
            onChange={onModelChange}
          />
        </div>
      </div>

      <div className='grid gap-3 border-t px-5 py-5 md:grid-cols-[180px_1fr]'>
        <div className='text-sm font-semibold'>第三步：一键安装</div>
        <div className='min-w-0'>
          {desktopDownload && (
            <div className='mb-3'>
              <Button
                size='sm'
                variant='outline'
                render={
                  <a
                    href={CODEX_OFFICIAL_URL}
                    target='_blank'
                    rel='noopener noreferrer'
                  />
                }
              >
                <Download className='size-4' />
                先安装 Codex 桌面版
              </Button>
            </div>
          )}
          <p className='text-muted-foreground mb-2 text-sm'>
            {os === 'windows'
              ? '打开 PowerShell，粘贴下面命令，回车。'
              : '打开终端，粘贴下面命令，回车。'}
          </p>
          <OneLineInstall tool={tool} model={model} />
          {!hasKey && (
            <p className='mt-2 text-xs text-red-600'>
              先在第一步自动创建或粘贴 API Key，再复制命令。
            </p>
          )}
        </div>
      </div>
    </section>
  )
}

// The env-var step for Claude Code, showing only the selected OS's commands
// (macOS/Linux use export in ~/.zshrc; Windows uses setx in PowerShell).
function ClaudeEnvStep({ model }: { model: string }) {
  const { t } = useTranslation()
  const { os } = useOsChoice()
  if (os === 'windows') {
    return (
      <>
        <Note>
          {t(
            'Run these once in PowerShell (they stick for every NEW window you open afterwards):'
          )}
        </Note>
        <CodeBlock
          code={`setx ANTHROPIC_BASE_URL ${ANTHROPIC_BASE}
setx ANTHROPIC_AUTH_TOKEN ${KEY}
setx ANTHROPIC_MODEL ${model}`}
        />
      </>
    )
  }
  return (
    <>
      <Note>
        {t(
          'Add these lines to the end of ~/.zshrc, then open a new terminal (replace the key):'
        )}
      </Note>
      <CodeBlock
        code={`export ANTHROPIC_BASE_URL=${ANTHROPIC_BASE}
export ANTHROPIC_AUTH_TOKEN=${KEY}
export ANTHROPIC_MODEL=${model}`}
      />
    </>
  )
}

function ClaudeCodeGuide({ apiKey, onApiKeyChange }: GuideProps) {
  const { t } = useTranslation()
  const [model, setModel] = useState(CLAUDE_MODELS[0])
  return (
    <OsProvider withLinux>
    <div>
      <h1 className='text-2xl font-semibold tracking-tight'>
        Claude Code-终端版
      </h1>
      <p className='text-muted-foreground mt-2 mb-5 text-sm'>
        三步完成安装。下方保留完整手动教程，给需要检查脚本细节的人看。
      </p>

      <BeginnerSetup
        apiKey={apiKey}
        onApiKeyChange={onApiKeyChange}
        toolName='Claude Code终端版'
        tool='claude'
        model={model}
        modelOptions={CLAUDE_MODELS}
        onModelChange={setModel}
      />

      <GuideLayer
        label='遇到问题'
        title='一行深度修复'
        description='如果以前装过、URL 写错、模型写错、密钥写错，复制这一行重新修复。'
        tone='warn'
      >
        <OneLineInstall tool='claude' model={model} mode='reset' />
        <Troubleshooting
          items={[
            {
              symptom: t('It says the URL is not found, or every request fails.'),
              fix: t(
                'Your base URL probably ends in /v1. Remove it — for Claude Code the URL must end at api.anyrouters.com.'
              ),
            },
            {
              symptom: t('It replies with a 503 or "model not available" error.'),
              fix: t(
                'The model name is wrong. Use an exact id from the Model Marketplace such as claude-sonnet-4-6 or claude-opus-4-8.'
              ),
            },
          ]}
        />
      </GuideLayer>

      <GuideLayer
        label='完整'
        title='完整手动教程'
        description='给程序员检查脚本细节。普通用户只需要用上面的三步。'
      >
        <Step n={1} title={t('Get your API key')} />
        <Note>
          {t('Create a key in the console, then use it as the Bearer token.')}
        </Note>
        <div className='mt-3'>
          <Button size='sm' render={<Link to='/keys' />}>
            <KeyRound className='size-4' />
            {t('Create API Keys')}
          </Button>
        </div>

        <Step n={2} title={t('Install')} />
        <CodeBlock code={`npm install -g @anthropic-ai/claude-code`} />
        <Plain>
          {t(
            'This downloads the Claude Code program onto your computer. Node.js must be installed first (nodejs.org).'
          )}
        </Plain>

        <Step n={3} title={t('Point it at AnyRouters')} />
        <Plain>
          {t(
            'This tells Claude Code to send its requests to AnyRouters (using your key) instead of the default service.'
          )}
        </Plain>
        <ClaudeEnvStep model={model} />
        <Callout>
          {t(
            'The base URL ends at the domain — do not add /v1. Claude Code appends /v1/messages on its own, so a URL ending in /v1 will fail.'
          )}
        </Callout>

        <Step n={4} title={t('Run')} />
        <CodeBlock code={`cd your-project\nclaude`} />
        <Callout tone='tip'>
          {t(
            'Type /model inside Claude Code to switch models. This endpoint serves Claude models (for Gemini, use Codex). Web search is built in — just ask it to look something up.'
          )}
        </Callout>
      </GuideLayer>
    </div>
    </OsProvider>
  )
}

// The image-generation helper Codex runs to draw pictures. Codex itself can't
// generate images; this tiny script calls AnyRouters' gpt-image-2 (OpenAI-
// compatible /v1/images) using the SAME key Codex uses — read from
// OPENAI_API_KEY first, then ~/.codex/auth.json as a fallback.
const GEN_IMAGE_PY = `#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen_image.py —— gpt-image-2 完整画图工具（给 Codex 调用），走 anyrouters 中转

最正规方案：用 OpenAI 官方 SDK（base_url 指向 anyrouters），完整运用 gpt-image-2 的能力：
  1) 文生图        images.generations —— 全参数（尺寸/质量/透明背景/格式/审核/张数）
  2) 图生图/参考图  images.edits       —— 一张或多张参考图，做风格迁移/合成
  3) 局部重绘(inpaint) images.edits + mask —— 只改 mask 透明区域，其余像素不动

用你 Codex 已有的同一个 anyrouters key（优先读取 OPENAI_API_KEY，自动回退 ~/.codex/auth.json），
计费统一走中转、不暴露上游 key。

安装（一次）：  pip install --upgrade openai

用法示例：
  # 文生图
  python3 gen_image.py "一只圆润可爱的水杯吉祥物，扁平风格" 水杯.png
  # 透明背景贴纸（png/webp 才支持透明）
  python3 gen_image.py "史莱姆怪物精灵图，侧视" slime.png --background transparent --format png
  # 高质量、竖图
  python3 gen_image.py "赛博朋克城市海报" poster.png --size 1024x1536 --quality high
  # 图生图：给一张参考图改风格
  python3 gen_image.py "把这张照片改成水彩画风格" out.png --edit 原图.jpg
  # 多参考图合成
  python3 gen_image.py "把第二张的图案印到第一张的T恤上，保持真实光影" out.png --edit 人物.png 图案.png
  # 局部重绘：只改 mask 透明区域
  python3 gen_image.py "把这块区域改成一个游泳池" out.png --edit 房间.png --mask mask.png

参数：
  位置1 prompt      画什么 / 怎么改
  位置2 outfile     输出文件名（可选，默认时间戳；统一存到 桌面/AnyRouters图片/）
  --size     1024x1024 | 1024x1536 | 1536x1024 | auto（默认 1024x1024）
  --quality  low | medium | high | auto（默认 medium）
  --n        一次生成几张（默认 1）
  --model    默认 gpt-image-2（也可 gemini-3-pro-image，人脸更稳）
  --background auto | transparent | opaque（透明需配 --format png/webp）
  --format   png | webp | jpeg（默认 png）
  --moderation auto | low
  --edit  参考图 [参考图...]   走图生图/编辑端点
  --mask  蒙版.png            局部重绘，透明区=要改处（需配 --edit）

Windows 上把命令里的 python3 换成 python（或 py）。
"""

import os
import sys
import json
import base64
import argparse
from datetime import datetime

try:
    from openai import OpenAI
except ImportError:
    print("✗ 缺少 openai SDK。先运行：pip install --upgrade openai", file=sys.stderr)
    sys.exit(1)


# key 复用 Codex 的同一个 anyrouters 密钥：先看环境变量，再回退到
# ~/.codex/auth.json（安装脚本也会写一份，方便旧工具复用）。
def _load_key():
    k = os.environ.get("ANYROUTERS_KEY") or os.environ.get("OPENAI_API_KEY")
    if k:
        return k
    auth_path = os.path.join(os.path.expanduser("~"), ".codex", "auth.json")
    try:
        with open(auth_path, "r", encoding="utf-8") as f:
            return json.load(f).get("OPENAI_API_KEY", "")
    except Exception:
        return ""


# 走 anyrouters 中转（OpenAI 兼容）
BASE_URL = os.environ.get("ANYROUTERS_BASE", "https://api.anyrouters.com/v1")
API_KEY = _load_key()

# 固定存到「桌面/AnyRouters图片」——好找、和 Codex 技能包统一。
# 桌面路径优先取常见位置；找不到就回退到用户主目录。
def _pick_output_dir():
    home = os.path.expanduser("~")
    for desktop in (os.path.join(home, "Desktop"), os.path.join(home, "桌面")):
        if os.path.isdir(desktop):
            return os.path.join(desktop, "AnyRouters图片")
    return os.path.join(home, "AnyRouters图片")


OUT_DIR = os.environ.get("ANYROUTERS_OUT_DIR") or _pick_output_dir()


def build_client():
    if not API_KEY:
        print("✗ 没读到 anyrouters key。", file=sys.stderr)
        print("  已配好 Codex 的话，key 会自动从 OPENAI_API_KEY 或 ~/.codex/auth.json 读取。", file=sys.stderr)
        print("  没配 Codex 的话，可临时设环境变量 ANYROUTERS_KEY=你的anyrouters密钥。", file=sys.stderr)
        sys.exit(1)
    return OpenAI(base_url=BASE_URL, api_key=API_KEY, timeout=600)


def save_b64(items, out_path, n):
    os.makedirs(OUT_DIR, exist_ok=True)
    saved = []
    for i, item in enumerate(items):
        b64 = getattr(item, "b64_json", None)
        if not b64:
            url = getattr(item, "url", None)
            if url:
                print("  返回了 URL（非 b64）：" + url, file=sys.stderr)
            continue
        if n == 1:
            fp = out_path
        else:
            root, ext = os.path.splitext(out_path)
            fp = root + "_" + str(i + 1) + ext
        with open(fp, "wb") as f:
            f.write(base64.b64decode(b64))
        saved.append(fp)
    for fp in saved:
        print("✓ 已生成：" + fp)
    if not saved:
        print("✗ 返回里没有图片数据。", file=sys.stderr)
        sys.exit(1)
    return saved


def do_generate(client, args, out_path):
    kw = dict(
        model=args.model,
        prompt=args.prompt,
        size=args.size,
        quality=args.quality,
        n=args.n,
        output_format=args.format,
        moderation=args.moderation,
    )
    if args.background != "auto":
        kw["background"] = args.background
    resp = client.images.generate(**kw)
    return save_b64(resp.data, out_path, args.n)


def do_edit(client, args, out_path):
    images = [open(p, "rb") for p in args.edit]
    mask_f = open(args.mask, "rb") if args.mask else None
    kw = dict(
        model=args.model,
        image=images if len(images) > 1 else images[0],
        prompt=args.prompt,
        size=args.size,
        quality=args.quality,
        n=args.n,
    )
    if mask_f:
        kw["mask"] = mask_f
    try:
        resp = client.images.edit(**kw)
    finally:
        for f in images:
            f.close()
        if mask_f:
            mask_f.close()
    return save_b64(resp.data, out_path, args.n)


def main():
    ap = argparse.ArgumentParser(description="gpt-image-2 完整画图工具（走 anyrouters）")
    ap.add_argument("prompt", help="画什么 / 怎么改")
    ap.add_argument("outfile", nargs="?", default=None, help="输出文件名（默认时间戳）")
    ap.add_argument("--size", default="1024x1024",
                    help="1024x1024 | 1024x1536 | 1536x1024 | auto")
    ap.add_argument("--quality", default="medium", help="low | medium | high | auto")
    ap.add_argument("--n", type=int, default=1, help="一次生成几张")
    ap.add_argument("--model", default="gpt-image-2",
                    help="gpt-image-2 | gemini-3-pro-image")
    ap.add_argument("--background", default="auto",
                    help="auto | transparent | opaque")
    ap.add_argument("--format", default="png", help="png | webp | jpeg")
    ap.add_argument("--moderation", default="auto", help="auto | low")
    ap.add_argument("--edit", nargs="+", default=None, help="图生图/编辑：一或多张参考图")
    ap.add_argument("--mask", default=None, help="局部重绘蒙版 png（需配 --edit）")
    args = ap.parse_args()

    if args.mask and not args.edit:
        print("✗ --mask 必须和 --edit 一起用。", file=sys.stderr)
        sys.exit(1)
    if args.background == "transparent" and args.format == "jpeg":
        print("✗ 透明背景不支持 jpeg，请用 --format png 或 webp。", file=sys.stderr)
        sys.exit(1)

    if args.outfile:
        out_path = args.outfile if os.path.isabs(args.outfile) \\
            else os.path.join(OUT_DIR, args.outfile)
    else:
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        out_path = os.path.join(OUT_DIR, "img_" + stamp + ".png")

    client = build_client()
    try:
        if args.edit:
            do_edit(client, args, out_path)
        else:
            do_generate(client, args, out_path)
    except Exception as e:
        msg = str(e)
        print("✗ 请求失败：" + msg[:600], file=sys.stderr)
        low = msg.lower()
        if "401" in msg or "403" in msg:
            print("  → anyrouters key 无效/无权限，检查 OPENAI_API_KEY 或 ~/.codex/auth.json 里的 key。", file=sys.stderr)
        elif "404" in msg:
            print("  → 模型 " + args.model + " 在中转站不存在，换 --model。", file=sys.stderr)
        elif "429" in msg:
            print("  → 触发限速，等一会再试。", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
`

function codexConfigToml(model: string) {
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

// Per-OS "how to open the hidden .codex folder in your home directory", written
// for people who have never touched a config folder before. Codex reads its
// files from ~/.codex (Windows: %USERPROFILE%\.codex).
function CodexOpenFolder() {
  const { t } = useTranslation()
  const { os } = useOsChoice()
  return (
    <div className='mt-3 space-y-2'>
      <Note>
        {t(
          'Codex keeps its settings in a folder called .codex in your home directory. Open it like this (create it if it is not there yet):'
        )}
      </Note>
      {os === 'windows' && (
        <>
          <p className='text-[13px] leading-relaxed'>
            {t('Press Win+R, paste the line below, and press Enter.')}
          </p>
          <CodeBlock code={'%USERPROFILE%\\.codex'} />
        </>
      )}
      {os === 'mac' && (
        <>
          <p className='text-[13px] leading-relaxed'>
            {t(
              'In Finder press Cmd+Shift+G, paste the line below, and press Enter.'
            )}
          </p>
          <CodeBlock code={'~/.codex'} />
        </>
      )}
      {os === 'linux' && (
        <>
          <p className='text-[13px] leading-relaxed'>
            {t('Run this in a terminal, then open that folder in your file manager.')}
          </p>
          <CodeBlock code={'mkdir -p ~/.codex && cd ~/.codex'} />
        </>
      )}
    </div>
  )
}

function CodexEnvStep() {
  const { os } = useOsChoice()
  if (os === 'windows') {
    return (
      <>
        <Note>在 PowerShell 里运行一次。新打开的 Codex/终端会自动读取。</Note>
        <CodeBlock
          code={`[Environment]::SetEnvironmentVariable("OPENAI_API_KEY", "${KEY}", "User")
$env:OPENAI_API_KEY="${KEY}"`}
        />
      </>
    )
  }
  if (os === 'mac') {
    return (
      <>
        <Note>
          在终端里运行一次。第一行给 Codex 桌面版读取，第二行给终端版读取。
        </Note>
        <CodeBlock
          code={`launchctl setenv OPENAI_API_KEY "${KEY}"
printf '\\nexport OPENAI_API_KEY="${KEY}"\\n' >> ~/.zshrc
export OPENAI_API_KEY="${KEY}"`}
        />
      </>
    )
  }
  return (
    <>
      <Note>在终端里运行一次。重新打开终端后继续。</Note>
      <CodeBlock
        code={`printf '\\nexport OPENAI_API_KEY="${KEY}"\\n' >> ~/.bashrc
export OPENAI_API_KEY="${KEY}"`}
      />
    </>
  )
}

// The image-generation add-on (gen_image.py) is identical for both the desktop
// and terminal Codex, so it lives in one shared block. `runner` is the shell
// verb the reader uses to invoke the script ("python3" on the terminal page,
// "python" on the desktop/Windows page).
function CodexImageSection() {
  const { t } = useTranslation()
  const { os } = useOsChoice()
  // Windows' launcher is "python"; macOS/Linux use "python3".
  const runner = os === 'windows' ? 'python' : 'python3'
  return (
    <div className='mt-10 border-t pt-6'>
      <div className='flex items-center gap-2'>
        <Sparkles className='size-4 text-violet-500' />
        <h2 className='text-lg font-semibold tracking-tight'>
          {t('Let Codex generate images')}
        </h2>
      </div>
      <Note>
        {t(
          "Codex writes and runs code, but it can't draw pictures on its own. Give it this tiny script and it will call AnyRouters' gpt-image-2 to produce real image assets — using the very same OPENAI_API_KEY you set above. Chat and images bill to one AnyRouters key."
        )}
      </Note>

      <Step n={1} title={t('Download the image script')} />
      <Note>
        {t(
          'Save gen_image.py into your project (or any folder). No key is written into the file — it reads OPENAI_API_KEY at runtime and falls back to ~/.codex/auth.json.'
        )}
      </Note>
      <DownloadFileButton
        content={GEN_IMAGE_PY}
        filename='gen_image.py'
        label={t('Download gen_image.py')}
      />

      <Step n={2} title={t('Install the one dependency')} />
      <CodeBlock code={`pip install --upgrade openai`} />

      <Step n={3} title={t('Test it once yourself')} />
      <CodeBlock
        code={`${runner} gen_image.py "a round cute water-bottle mascot, flat style" mascot.png`}
      />
      <Plain>
        {t(
          'The image is saved to a “AnyRouters图片” folder on your Desktop — easy to find, same place as the Codex skill uses. The script prints the full path when it finishes.'
        )}
      </Plain>

      <Step n={4} title={t('Ask Codex to use it')} />
      <Note>
        {t(
          'Inside Codex, just describe what you need in plain language — it will run the script for you:'
        )}
      </Note>
      <CodeBlock
        code={t(
          'Use gen_image.py in this folder to generate a water-bottle mascot icon, save it as mascot.png, then place it into assets/.'
        )}
      />
      <Callout tone='tip'>
        {t(
          'gen_image.py can do more than text-to-image: transparent backgrounds (--background transparent), image-to-image and multi-reference compositing (--edit a.png b.png), and mask inpainting (--mask). For faces in busy scenes, add --model gemini-3-pro-image. Run gen_image.py -h for all options.'
        )}
      </Callout>
    </div>
  )
}

function CodexDesktopGuide({ apiKey, onApiKeyChange }: GuideProps) {
  const { t } = useTranslation()
  const [model, setModel] = useState(CODEX_MODELS[0])
  const configToml = codexConfigToml(model)
  return (
    <OsProvider>
    <div>
      <h1 className='text-2xl font-semibold tracking-tight'>
        Codex-桌面版
      </h1>
      <p className='text-muted-foreground mt-2 mb-5 text-sm'>
        适合不常用终端的人。三步完成：创建 API Key、选择电脑和模型、一键写入配置。
      </p>

      <BeginnerSetup
        apiKey={apiKey}
        onApiKeyChange={onApiKeyChange}
        toolName='Codex桌面版'
        tool='codex-config'
        model={model}
        modelOptions={CODEX_MODELS}
        onModelChange={setModel}
        desktopDownload
      />

      <GuideLayer
        label='遇到问题'
        title='遇到问题：重置桌面版配置'
        description='如果 App 仍然让你登录、没走 AnyRouters、401 Invalid token，复制这一行强制重写 AnyRouters 配置。'
        tone='warn'
      >
        <OneLineInstall tool='codex-config' model={model} mode='reset' />
        <Troubleshooting
          items={[
            {
              symptom: t(
                'The desktop app ignores the config / still asks to sign in.'
              ),
              fix: t(
                'Quit the app COMPLETELY and reopen it. On Windows, end Codex from Task Manager if needed. The app only reads config and environment variables at launch.'
              ),
            },
            {
              symptom: t('Codex says «wire_api chat is no longer supported».'),
              fix: t(
                'Add the line wire_api = "responses" to the [model_providers.anyrouters] section of ~/.codex/config.toml, then restart the app.'
              ),
            },
            {
              symptom: 'Codex 提示 401 Unauthorized / Invalid token。',
              fix: '重新运行上面的重置命令，让 config.toml 使用 env_key = "OPENAI_API_KEY"，并重新设置 Windows 用户环境变量。然后彻底退出 Codex 再打开；仍不行就更新 Codex 到最新版。',
            },
          ]}
        />
      </GuideLayer>

      <GuideLayer
        label='完整'
        title='完整手动教程'
        description='给程序员检查脚本细节。普通用户只需要用上面的三步。'
      >
        <Callout tone='tip'>
          {t(
            'The desktop app and the terminal CLI share the SAME ~/.codex/config.toml. The API key is read from OPENAI_API_KEY.'
          )}
        </Callout>

        <Step n={1} title={t('Get your API key')} />
        <Note>
          {t('Create a key in the console, then use it as the Bearer token.')}
        </Note>
        <div className='mt-3'>
          <Button size='sm' render={<Link to='/keys' />}>
            <KeyRound className='size-4' />
            {t('Create API Keys')}
          </Button>
        </div>

        <Step n={2} title={t('Install the desktop app')} />
        <Note>
          {t(
            "Download the installer from OpenAI's official Codex page (the download itself needs access to openai.com), then install it. After installing, QUIT it completely — the config below must be in place before its first real launch."
          )}
        </Note>

        <Step n={3} title='Set OPENAI_API_KEY' />
        <CodexEnvStep />

        <Step n={4} title={t('Create config.toml in your .codex folder')} />
        <CodexOpenFolder />
        <CodeBlock code={configToml} />
        <Plain>
          {t(
            'Create a file named config.toml inside that .codex folder and paste this in — or download it and move it into the folder.'
          )}
        </Plain>
        <DownloadFileButton
          content={configToml}
          filename='config.toml'
          label={t('Download config.toml')}
        />
        <Callout>
          保留 wire_api = "responses" 和 env_key = "OPENAI_API_KEY"。这样
          Codex 会发送 AnyRouters API Key，而不是发送旧的 Codex 登录 token。
        </Callout>

        <Step n={5} title={t('Launch and chat')} />
        <Note>
          {t(
            'Start (or fully restart) the Codex desktop app and just chat. If it was open during setup, quit it completely and reopen it.'
          )}
        </Note>
        <Callout tone='tip'>
          {t(
            'Works with any model AnyRouters serves — Claude and Gemini included — because the Responses API is bridged to each upstream.'
          )}
        </Callout>
      </GuideLayer>

      <CodexImageSection />
    </div>
    </OsProvider>
  )
}

function CodexTerminalGuide({ apiKey, onApiKeyChange }: GuideProps) {
  const { t } = useTranslation()
  const [model, setModel] = useState(CODEX_MODELS[0])
  const configToml = codexConfigToml(model)
  return (
    <OsProvider withLinux>
    <div>
      <h1 className='text-2xl font-semibold tracking-tight'>
        Codex-终端版
      </h1>
      <p className='text-muted-foreground mt-2 mb-5 text-sm'>
        给会用终端的用户。三步完成安装，接入 AnyRouters 后可以使用 ChatGPT、Claude、Gemini。
      </p>

      <BeginnerSetup
        apiKey={apiKey}
        onApiKeyChange={onApiKeyChange}
        toolName='Codex终端版'
        tool='codex'
        model={model}
        modelOptions={CODEX_MODELS}
        onModelChange={setModel}
      />

      <GuideLayer
        label='遇到问题'
        title='遇到问题：一行深度修复'
        description='如果以前装过旧版、密钥写错、模型名错、401 Invalid token，跑这一层。它会备份旧文件，再重写全新配置。'
        tone='warn'
      >
        <OneLineInstall tool='codex' model={model} mode='reset' />
        <Troubleshooting
          items={[
            {
              symptom: t(
                'Codex says «Missing environment variable: OPENAI_API_KEY».'
              ),
              fix: t(
                'The environment variable was not set for this terminal. Reopen the terminal, or rerun the one-line install command above.'
              ),
            },
            {
              symptom: t('Codex says «wire_api chat is no longer supported».'),
              fix: t(
                'Add the line wire_api = "responses" to the [model_providers.anyrouters] section of ~/.codex/config.toml.'
              ),
            },
            {
              symptom: t('Requests fail with an authentication error.'),
              fix: t(
                'Your OPENAI_API_KEY is missing or wrong. Paste the full AnyRouters key at the top of this page and rerun the install command.'
              ),
            },
            {
              symptom: 'Codex 提示 401 Unauthorized / Invalid token。',
              fix: '重新运行上面的重置命令，让 config.toml 使用 env_key = "OPENAI_API_KEY"，并重新设置环境变量。然后打开新终端运行 codex；桌面版需要彻底退出再打开。',
            },
            {
              symptom: t('The codex command is not found after installing.'),
              fix: t(
                'Node.js is missing or the terminal was not restarted. Install Node.js from nodejs.org, close and reopen the terminal, then try again.'
              ),
            },
          ]}
        />
      </GuideLayer>

      <GuideLayer
        label='完整'
        title='完整手动教程'
        description='给程序员检查脚本细节。普通用户只需要用上面的三步。'
      >
        <Callout tone='tip'>
          {t(
            'The terminal CLI and the desktop app share the SAME ~/.codex/config.toml. The API key is read from OPENAI_API_KEY.'
          )}
        </Callout>

        <Step n={1} title={t('Get your API key')} />
        <Note>
          {t('Create a key in the console, then use it as the Bearer token.')}
        </Note>
        <div className='mt-3'>
          <Button size='sm' render={<Link to='/keys' />}>
            <KeyRound className='size-4' />
            {t('Create API Keys')}
          </Button>
        </div>

        <Step n={2} title={t('Install')} />
        <Note>{t('One command (needs Node.js from nodejs.org):')}</Note>
        <CodeBlock code={`npm install -g @openai/codex`} />

        <Step n={3} title='Set OPENAI_API_KEY' />
        <CodexEnvStep />

        <Step n={4} title={t('Create config.toml in your .codex folder')} />
        <CodexOpenFolder />
        <CodeBlock code={configToml} />
        <Plain>
          {t(
            'Create a file named config.toml inside that .codex folder and paste this in — or just download it and move it into the folder.'
          )}
        </Plain>
        <DownloadFileButton
          content={configToml}
          filename='config.toml'
          label={t('Download config.toml')}
        />
        <Callout>
          保留 wire_api = "responses" 和 env_key = "OPENAI_API_KEY"。这样
          Codex 会发送 AnyRouters API Key，而不是发送旧的 Codex 登录 token。
        </Callout>

        <Step n={5} title={t('Run')} />
        <Note>{t('Open a NEW terminal window and run:')}</Note>
        <CodeBlock code={`codex`} />
        <Callout tone='tip'>
          {t(
            'Works with any model AnyRouters serves — Claude and Gemini included — because the Responses API is bridged to each upstream.'
          )}
        </Callout>
      </GuideLayer>

      <CodexImageSection />
    </div>
    </OsProvider>
  )
}

function CcSwitchGuide() {
  const { t } = useTranslation()
  return (
    <div>
      <h1 className='text-2xl font-semibold tracking-tight'>cc-switch</h1>
      <p className='text-muted-foreground mt-2 text-sm'>
        {t('Switch Claude Code between providers in one click.')}
      </p>

      <GuideLayer
        label='推荐'
        title='添加 AnyRouters 配置'
        description='按下面两步填入配置即可。API Key 会自动从页面顶部输入框带入。'
        tone='primary'
      >
        <Step n={1} title={t('Add AnyRouters as a provider')} />
        <Note>
          {t('In cc-switch, add a new provider profile with these values:')}
        </Note>
        <CodeBlock
          code={`Name:      AnyRouters
Base URL:  ${ANTHROPIC_BASE}
Token:     ${KEY}
Model:     claude-sonnet-4-6`}
        />

        <Step n={2} title={t('Switch to it')} />
        <Note>
          {t(
            'Select the AnyRouters profile; cc-switch rewrites your Claude Code settings so the next session uses AnyRouters.'
          )}
        </Note>
      </GuideLayer>
    </div>
  )
}

function CherryStudioGuide() {
  const { t } = useTranslation()
  return (
    <div>
      <h1 className='text-2xl font-semibold tracking-tight'>Cherry Studio</h1>
      <p className='text-muted-foreground mt-2 text-sm'>
        {t('A desktop chat client — add AnyRouters as a custom provider.')}
      </p>
      <Callout tone='tip'>
        {t(
          'No terminal or commands needed — this is the easiest option if you just want to chat.'
        )}
      </Callout>

      <Step n={1} title={t('Add a custom provider')} />
      <Note>
        {t(
          'Settings -> Model Providers -> Add. Choose the OpenAI-compatible type and fill in:'
        )}
      </Note>
      <CodeBlock
        code={`API Host:  ${OPENAI_BASE}
API Key:   ${KEY}`}
      />

      <Step n={2} title={t('Enable models')} />
      <Note>
        {t(
          'Turn the provider on, add models like claude-sonnet-4-6 or gemini-3.5-flash, and start chatting.'
        )}
      </Note>
    </div>
  )
}

// ----------------------------------------------------------------------------
// Page
// ----------------------------------------------------------------------------

type GuideEntry = {
  id: string
  label: string
  icon: typeof BookOpen
  render: (props: GuideProps) => React.ReactNode
}

const GUIDES: GuideEntry[] = [
  {
    id: 'overview',
    label: '新手概览',
    icon: BookOpen,
    render: () => <OverviewGuide />,
  },
  {
    id: 'claude-code',
    label: 'Claude Code-终端版',
    icon: SquareTerminal,
    render: (props: GuideProps) => <ClaudeCodeGuide {...props} />,
  },
  {
    id: 'codex-desktop',
    label: 'Codex-桌面版',
    icon: AppWindow,
    render: (props: GuideProps) => <CodexDesktopGuide {...props} />,
  },
  {
    id: 'codex-cli',
    label: 'Codex-终端版',
    icon: MessageSquareCode,
    render: (props: GuideProps) => <CodexTerminalGuide {...props} />,
  },
  {
    id: 'cc-switch',
    label: 'cc-switch切换器',
    icon: Boxes,
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
  const { t } = useTranslation()
  const [active, setActive] = useState<string>('overview')
  const [apiKey, setApiKey] = useState('')
  const activeGuide = GUIDES.find((g) => g.id === active) ?? GUIDES[0]
  const hasInlineKeyStep = ['claude-code', 'codex-desktop', 'codex-cli'].includes(
    active
  )

  return (
    <div className='h-full overflow-y-auto'>
      <div className='mx-auto flex w-full max-w-6xl gap-8 px-6 py-10'>
        <nav className='hidden w-48 shrink-0 sm:block'>
          <p className='text-muted-foreground/70 px-2 text-[10px] font-medium tracking-wider uppercase'>
            {t('Guides')}
          </p>
          <div className='mt-2 space-y-0.5'>
            {GUIDES.map((g) => {
              const Icon = g.icon
              return (
                <button
                  key={g.id}
                  type='button'
                  onClick={() => setActive(g.id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors',
                    active === g.id
                      ? 'bg-muted font-medium text-foreground'
                      : 'text-muted-foreground hover:bg-muted/50'
                  )}
                >
                  <Icon className='size-4 shrink-0' />
                  <span className='truncate'>{g.label}</span>
                </button>
              )
            })}
          </div>
        </nav>

        <main className='min-w-0 flex-1'>
          {/* Mobile guide picker */}
          <div className='mb-6 flex flex-wrap gap-1.5 sm:hidden'>
            {GUIDES.map((g) => (
              <button
                key={g.id}
                type='button'
                onClick={() => setActive(g.id)}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs transition-colors',
                  active === g.id
                    ? 'border-foreground bg-foreground text-background'
                    : 'text-muted-foreground'
                )}
              >
                {g.label}
              </button>
            ))}
          </div>
          <KeyContext.Provider value={apiKey}>
            {!hasInlineKeyStep && (
              <KeyBar apiKey={apiKey} onChange={setApiKey} />
            )}
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
