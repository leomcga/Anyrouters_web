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

/** Thin labelled separator between the AI-assisted path (top) and the manual
 *  step-by-step instructions below it. */
function ManualDivider() {
  const { t } = useTranslation()
  return (
    <div className='mt-8 mb-1 flex items-center gap-3'>
      <span className='text-muted-foreground/60 text-[11px] font-medium tracking-wider uppercase'>
        {t('Or set it up manually')}
      </span>
      <span className='bg-border h-px flex-1' />
    </div>
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
    <div className='rounded-xl border border-violet-500/30 bg-violet-500/[0.05] p-4'>
      <div className='flex items-center gap-2'>
        <Sparkles className='size-4 text-violet-500' />
        <h3 className='text-sm font-semibold tracking-tight'>
          {t('Fastest: let AI set it up for you')}
        </h3>
      </div>
      <Note>
        {t(
          'New to this? Open the chat, switch the model to the most capable one — Claude Opus 4.8 — then paste the prompt below. It walks you through everything and writes a one-click setup script tailored to your computer. It runs on your own balance.'
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
      <p className='text-muted-foreground mt-2 mb-5 text-sm'>
        {t("Anthropic's official terminal coding agent, on AnyRouters.")}
      </p>

      <AiScriptCallout
        prompt={t(
          'Help me connect Claude Code to AnyRouters on my own computer, step by step. First ask me two things and wait for my answers: (1) my operating system — macOS, Windows, or Linux; and (2) whether I have already created an AnyRouters API key — if I have not, tell me to create one on the Create API Keys page first. Then give me ONE copy-paste block for my OS that: installs Node.js if it is missing, runs npm install -g @anthropic-ai/claude-code, and persistently sets these environment variables in my shell profile — ANTHROPIC_BASE_URL=https://api.anyrouters.com (important: end at the domain, do NOT add /v1), ANTHROPIC_AUTH_TOKEN=my key, ANTHROPIC_MODEL=claude-sonnet-4-6. Use an obvious placeholder for the key and remind me to replace it with my own. Finally, tell me how to verify it works.'
        )}
      />

      <ManualDivider />

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

      <Step n={3} title={t('Point it at AnyRouters')} />
      <Note>
        {t('Set these environment variables (replace the key in red):')}
      </Note>
      <CodeBlock
        code={`export ANTHROPIC_BASE_URL=${ANTHROPIC_BASE}
export ANTHROPIC_AUTH_TOKEN=${KEY}
export ANTHROPIC_MODEL=claude-sonnet-4-6`}
      />
      <Callout>
        {t(
          'The base URL ends at the domain — do not add /v1. Claude Code appends /v1/messages on its own, so a URL ending in /v1 will fail.'
        )}
      </Callout>
      <Note>
        {t(
          'To make it permanent, append these lines to ~/.zshrc (macOS/Linux) and restart the terminal.'
        )}
      </Note>

      <Step n={4} title={t('Run')} />
      <CodeBlock code={`cd your-project\nclaude`} />
      <Callout tone='tip'>
        {t(
          'Type /model inside Claude Code to switch models. This endpoint serves Claude models (for Gemini, use Codex). Web search is built in — just ask it to look something up.'
        )}
      </Callout>
    </div>
  )
}

function CodexGuide() {
  const { t } = useTranslation()
  return (
    <div>
      <h1 className='text-2xl font-semibold tracking-tight'>Codex</h1>
      <p className='text-muted-foreground mt-2 mb-5 text-sm'>
        {t("OpenAI's coding CLI. On AnyRouters it drives Claude and Gemini too.")}
      </p>

      <AiScriptCallout
        prompt={t(
          'Help me connect the Codex CLI to AnyRouters on my own computer, step by step. First ask me two things and wait for my answers: (1) my operating system — macOS, Windows, or Linux; and (2) whether I have already created an AnyRouters API key — if I have not, tell me to create one on the Create API Keys page first. Then give me ONE copy-paste block for my OS that: installs Node.js if it is missing, runs npm install -g @openai/codex, creates ~/.codex/config.toml with model = "claude-sonnet-4-6", model_provider = "anyrouters", and a [model_providers.anyrouters] section containing name = "AnyRouters", base_url = "https://api.anyrouters.com/v1", env_key = "OPENAI_API_KEY" and wire_api = "responses" (this exact wire_api line is required — Codex 0.142+ removed the old "chat" mode), and persistently exports OPENAI_API_KEY in my shell profile. Use an obvious placeholder for the key and remind me to replace it. Finally, tell me how to verify it by running codex.'
        )}
      />

      <ManualDivider />

      <Callout>
        {t(
          'Use the terminal CLI only. The Codex desktop app and IDE plugin have known issues with custom endpoints — avoid them.'
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
      <CodeBlock code={`npm install -g @openai/codex`} />

      <Step n={3} title={t('Configure ~/.codex/config.toml')} />
      <CodeBlock
        code={`model = "claude-sonnet-4-6"
model_provider = "anyrouters"

[model_providers.anyrouters]
name = "AnyRouters"
base_url = "${OPENAI_BASE}"
env_key = "OPENAI_API_KEY"
wire_api = "responses"`}
      />
      <Callout>
        {t(
          'Keep the last line wire_api = "responses". Codex 0.142+ dropped the old "chat" mode, so without it Codex fails with «wire_api chat is no longer supported».'
        )}
      </Callout>

      <Step n={4} title={t('Set your key')} />
      <Note>
        {t(
          'Codex reads the key from this environment variable — make it permanent in ~/.zshrc:'
        )}
      </Note>
      <CodeBlock code={`export OPENAI_API_KEY=${KEY}`} />

      <Step n={5} title={t('Run')} />
      <CodeBlock code={`codex`} />
      <Callout tone='tip'>
        {t(
          'Works with any model AnyRouters serves — Claude and Gemini included — because the Responses API is bridged to each upstream.'
        )}
      </Callout>
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
          'I want to add AnyRouters to cc-switch. First ask me which operating system I use and whether I have already created an AnyRouters API key (if not, tell me to create one first). After I reply, walk me through adding AnyRouters (base URL https://api.anyrouters.com, model claude-sonnet-4-6) as a provider and give me a config snippet I can paste.'
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
