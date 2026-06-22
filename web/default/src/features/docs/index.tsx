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
import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  ArrowRight,
  BookOpen,
  Boxes,
  Check,
  Copy,
  KeyRound,
  MessageSquareCode,
  MonitorSmartphone,
  Sparkles,
  SquareTerminal,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

// Public developer endpoints. OpenAI-compatible carries the /v1 suffix; the
// Anthropic-native base (used by Claude Code) does not.
const OPENAI_BASE = 'https://api.anyrouters.com/v1'
const ANTHROPIC_BASE = 'https://api.anyrouters.com'
const KEY = 'sk-anyrouters-YOUR_KEY'

// ----------------------------------------------------------------------------
// Building blocks
// ----------------------------------------------------------------------------

/** Renders code with a copy button; the API-key placeholder is shown in red so
 *  users immediately see what they must replace with their own key. */
function CodeBlock({ code }: { code: string }) {
  const { t } = useTranslation()
  const { copyToClipboard } = useCopyToClipboard()
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    copyToClipboard(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const segments = code.split(KEY)

  return (
    <div className='group relative'>
      <pre className='overflow-x-auto rounded-xl border bg-muted/40 p-4 pr-12 text-[13px] leading-relaxed'>
        <code className='font-mono'>
          {segments.map((seg, i) => (
            <span key={i}>
              {seg}
              {i < segments.length - 1 && (
                <span className='rounded bg-red-500/10 px-1 font-semibold text-red-600 dark:text-red-400'>
                  {KEY}
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

/** Calls-out the "let AI write the install script" flow on each coding-tool
 *  page. The prompt is copyable; the button opens the workspace chat where the
 *  assistant writes a runnable script (Run code -> downloadable file). */
function AiScriptCallout({ prompt }: { prompt: string }) {
  const { t } = useTranslation()
  const { copyToClipboard } = useCopyToClipboard()
  const [copied, setCopied] = useState(false)
  return (
    <div className='mt-6 rounded-xl border border-violet-500/30 bg-violet-500/[0.04] p-4'>
      <div className='flex items-center gap-2'>
        <Sparkles className='size-4 text-violet-500' />
        <h3 className='text-sm font-semibold tracking-tight'>
          {t('Too long? Let AI write the install script for you')}
        </h3>
      </div>
      <Note>
        {t(
          'Open the workspace chat, paste the prompt below, and the assistant writes a one-click install script you can run and download. It runs on your own balance.'
        )}
      </Note>
      <div className='mt-3'>
        <CodeBlock code={prompt} />
      </div>
      <div className='mt-3 flex gap-2'>
        <Button
          size='sm'
          variant='outline'
          onClick={() => {
            copyToClipboard(prompt)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
        >
          {copied ? (
            <Check className='size-4 text-emerald-500' />
          ) : (
            <Copy className='size-4' />
          )}
          {t('Copy prompt')}
        </Button>
        <Button size='sm' render={<Link to='/playground' />}>
          <MessageSquareCode className='size-4' />
          {t('Open chat')}
        </Button>
      </div>
    </div>
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
    model="claude-sonnet-4-6",  # or gemini-2.5-pro, claude-opus-4-8
    messages=[{"role": "user", "content": "Hello"}],
)
print(resp.choices[0].message.content)`}
      />

      <Step n={4} title={t('Available models')} />
      <Note>
        {t('Claude, Gemini and (soon) ChatGPT — first-party, never throttled.')}
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

function ClaudeCodeGuide() {
  const { t } = useTranslation()
  return (
    <div>
      <h1 className='text-2xl font-semibold tracking-tight'>Claude Code</h1>
      <p className='text-muted-foreground mt-2 text-sm'>
        {t("Anthropic's official terminal coding agent, on AnyRouters.")}
      </p>

      <Step n={1} title={t('Install')} />
      <CodeBlock code={`npm install -g @anthropic-ai/claude-code`} />

      <Step n={2} title={t('Point it at AnyRouters')} />
      <Note>
        {t('Set these environment variables (replace the key in red):')}
      </Note>
      <CodeBlock
        code={`export ANTHROPIC_BASE_URL=${ANTHROPIC_BASE}
export ANTHROPIC_AUTH_TOKEN=${KEY}
export ANTHROPIC_MODEL=claude-sonnet-4-6`}
      />
      <Note>
        {t(
          'To make it permanent, append these lines to ~/.zshrc (macOS/Linux) and restart the terminal.'
        )}
      </Note>

      <Step n={3} title={t('Run')} />
      <CodeBlock code={`cd your-project\nclaude`} />

      <AiScriptCallout
        prompt={t(
          'I use macOS. Write a one-click shell script that installs Claude Code and configures it to use AnyRouters (ANTHROPIC_BASE_URL=https://api.anyrouters.com, model claude-sonnet-4-6). Output it as a downloadable .command file and remind me to replace the key with my own.'
        )}
      />
    </div>
  )
}

function CodexGuide() {
  const { t } = useTranslation()
  return (
    <div>
      <h1 className='text-2xl font-semibold tracking-tight'>Codex</h1>
      <p className='text-muted-foreground mt-2 text-sm'>
        {t("OpenAI's coding CLI via the OpenAI-compatible endpoint.")}
      </p>

      <Step n={1} title={t('Install')} />
      <CodeBlock code={`npm install -g @openai/codex`} />

      <Step n={2} title={t('Point it at AnyRouters')} />
      <CodeBlock
        code={`export OPENAI_BASE_URL=${OPENAI_BASE}
export OPENAI_API_KEY=${KEY}`}
      />
      <Note>
        {t(
          'Or add a provider in ~/.codex/config.toml with base_url and the same key.'
        )}
      </Note>

      <Step n={3} title={t('Run')} />
      <CodeBlock code={`codex`} />
      <Note>
        {t(
          'ChatGPT (GPT-5.5) lands soon via Azure; until then point Codex at an available model name.'
        )}
      </Note>

      <AiScriptCallout
        prompt={t(
          'I use macOS. Write a one-click shell script that installs the Codex CLI and configures OPENAI_BASE_URL=https://api.anyrouters.com/v1. Output it as a downloadable .command file and remind me to replace the key with my own.'
        )}
      />
    </div>
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

      <Step n={1} title={t('Add AnyRouters as a provider')} />
      <Note>
        {t(
          'In cc-switch, add a new provider profile with these values:'
        )}
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

      <AiScriptCallout
        prompt={t(
          'Explain step by step how to add AnyRouters (base URL https://api.anyrouters.com, model claude-sonnet-4-6) as a provider in cc-switch, and write a config snippet I can paste.'
        )}
      />
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
          'Turn the provider on, add models like claude-sonnet-4-6 or gemini-2.5-pro, and start chatting.'
        )}
      </Note>
    </div>
  )
}

// ----------------------------------------------------------------------------
// Page
// ----------------------------------------------------------------------------

const GUIDES = [
  { id: 'overview', label: 'Overview', icon: BookOpen, render: OverviewGuide },
  {
    id: 'claude-code',
    label: 'Claude Code',
    icon: SquareTerminal,
    render: ClaudeCodeGuide,
  },
  { id: 'codex', label: 'Codex', icon: MessageSquareCode, render: CodexGuide },
  { id: 'cc-switch', label: 'cc-switch', icon: Boxes, render: CcSwitchGuide },
  {
    id: 'cherry-studio',
    label: 'Cherry Studio',
    icon: MonitorSmartphone,
    render: CherryStudioGuide,
  },
] as const

export function Docs() {
  const { t } = useTranslation()
  const [active, setActive] = useState<string>('overview')
  const ActiveGuide =
    GUIDES.find((g) => g.id === active)?.render ?? OverviewGuide

  return (
    <div className='h-full overflow-y-auto'>
      <div className='mx-auto flex w-full max-w-5xl gap-8 px-6 py-10'>
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
          <ActiveGuide />
        </main>
      </div>
    </div>
  )
}
