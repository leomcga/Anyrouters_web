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

// Public developer endpoints. OpenAI-compatible carries the /v1 suffix; the
// Anthropic-native base (used by Claude Code) does not.
const OPENAI_BASE = 'https://api.anyrouters.com/v1'
const ANTHROPIC_BASE = 'https://api.anyrouters.com'
// The placeholder shown (in red) wherever the user must drop in their own key.
// When the user pastes a real key into the KeyBar, we swap this out everywhere.
const KEY = 'sk-anyrouters-YOUR_KEY'

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
          placeholder={KEY}
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
    <div className='group relative'>
      <pre className='overflow-x-auto rounded-xl border bg-muted/40 p-4 pr-12 text-[13px] leading-relaxed'>
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

// Install-script builders. These run entirely in the browser: the user's key is
// baked into the downloaded file locally and never sent to the chat/model — the
// safe alternative to asking AI to write the file (which refuses to embed a
// pasted key). Each script is idempotent: it backs up the profile and won't add
// duplicate lines.
const CLAUDE_ENV: Record<string, string> = {
  ANTHROPIC_BASE_URL: ANTHROPIC_BASE,
  ANTHROPIC_AUTH_TOKEN: KEY,
  ANTHROPIC_MODEL: 'claude-sonnet-4-6',
}

// Shared bash preamble: ensure Node/npm exist (auto-install via Homebrew on
// macOS when possible), pick the profile the user's LOGIN shell actually reads
// (by $SHELL, not the shell running this script — a .command double-click always
// runs under bash even when the user's shell is zsh), and export helpers.
function shProfileAndNode(os: OS, verifyCmd: string): {
  head: string
  tail: string
} {
  const brew =
    os === 'mac'
      ? `  if command -v brew >/dev/null 2>&1; then
    echo "Installing Node.js via Homebrew ..."
    brew install node
  else
    echo "Node.js is missing. Install it from https://nodejs.org (or install Homebrew first), then re-run this script."
    exit 1
  fi`
      : `  echo "Node.js is missing. Install it from https://nodejs.org (on Linux, e.g. your package manager), then re-run this script."
  exit 1`
  const head = `#!/bin/bash
# AnyRouters setup — safe to run more than once.
set -e

# 1) Make sure Node.js / npm are available.
if ! command -v node >/dev/null 2>&1; then
${brew}
fi

# 2) Pick the profile the LOGIN shell reads (by $SHELL, not the running shell).
case "\${SHELL:-}" in
  */zsh) PROFILE="$HOME/.zshrc" ;;
  */bash) PROFILE="$HOME/.bash_profile" ;;
  *) PROFILE="$HOME/.profile" ;;
esac
[ -f "$PROFILE" ] || touch "$PROFILE"
cp "$PROFILE" "$PROFILE.anyrouters.bak" 2>/dev/null || true
add_line() { grep -qF "$1" "$PROFILE" || echo "$1" >> "$PROFILE"; }
`
  const tail = `
# 4) Verify.
if command -v ${verifyCmd} >/dev/null 2>&1; then
  echo ""
  echo "✅ Setup complete. Open a NEW terminal window, then run: ${verifyCmd}"
else
  echo ""
  echo "⚠️ Installed the settings, but '${verifyCmd}' isn't on your PATH yet. Open a NEW terminal and try again; if it's still missing, make sure Node.js's global npm bin is on your PATH."
fi
`
  return { head, tail }
}

function shSetupScript(os: OS, pkg: string, env: Record<string, string>): string {
  const lines = Object.entries(env)
    .map(([k, v]) => `add_line 'export ${k}="${v}"'`)
    .join('\n')
  const { head, tail } = shProfileAndNode(os, 'claude')
  return `${head}
# 3) Install the CLI and write the environment variables.
echo "Installing ${pkg} ..."
npm install -g ${pkg}
${lines}
${tail}`
}

function ps1SetupScript(pkg: string, env: Record<string, string>): string {
  const sets = Object.entries(env)
    .map(
      ([k, v]) =>
        `[Environment]::SetEnvironmentVariable("${k}", "${v}", "User")`
    )
    .join('\n')
  return `# AnyRouters setup (PowerShell) — safe to run more than once.
Write-Host "Installing ${pkg} ..."
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Node.js not found. Install it from https://nodejs.org and re-run."
  exit 1
}
npm install -g ${pkg}
${sets}
Write-Host "Done. Close this window and open a NEW terminal."
`
}

/** Build the runnable install script for a tool + OS, key already substituted. */
function buildInstallScript(
  os: OS,
  tool: 'claude' | 'codex',
  apiKey: string
): { content: string; filename: string } {
  const key = apiKey.trim() || KEY
  if (tool === 'claude') {
    const env = { ...CLAUDE_ENV, ANTHROPIC_AUTH_TOKEN: key }
    if (os === 'windows')
      return {
        content: ps1SetupScript('@anthropic-ai/claude-code', env),
        filename: 'setup-claude-code.ps1',
      }
    return {
      content: shSetupScript(os, '@anthropic-ai/claude-code', env),
      filename: os === 'mac' ? 'setup-claude-code.command' : 'setup-claude-code.sh',
    }
  }
  // codex: install + write ~/.codex/config.toml + export OPENAI_API_KEY
  const toml = `model = "claude-sonnet-4-6"
model_provider = "anyrouters"

[model_providers.anyrouters]
name = "AnyRouters"
base_url = "${OPENAI_BASE}"
env_key = "OPENAI_API_KEY"
wire_api = "responses"`
  if (os === 'windows') {
    return {
      content: `# AnyRouters Codex setup (PowerShell) — safe to run more than once.
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Node.js not found. Install it from https://nodejs.org and re-run."
  exit 1
}
npm install -g @openai/codex
$dir = "$HOME\\.codex"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
if (Test-Path "$dir\\config.toml") { Copy-Item "$dir\\config.toml" "$dir\\config.toml.anyrouters.bak" -Force }
@'
${toml}
'@ | Set-Content -Encoding UTF8 "$dir\\config.toml"
[Environment]::SetEnvironmentVariable("OPENAI_API_KEY", "${key}", "User")
Write-Host "Done. Close this window and open a NEW terminal, then run: codex"
`,
      filename: 'setup-codex.ps1',
    }
  }
  const { head, tail } = shProfileAndNode(os, 'codex')
  return {
    content: `${head}
# 3) Install Codex, write ~/.codex/config.toml, export the key.
echo "Installing @openai/codex ..."
npm install -g @openai/codex
mkdir -p "$HOME/.codex"
[ -f "$HOME/.codex/config.toml" ] && cp "$HOME/.codex/config.toml" "$HOME/.codex/config.toml.anyrouters.bak"
cat > "$HOME/.codex/config.toml" <<'TOML'
${toml}
TOML
add_line 'export OPENAI_API_KEY="${key}"'
${tail}`,
    filename: os === 'mac' ? 'setup-codex.command' : 'setup-codex.sh',
  }
}

const OS_LABELS: Record<OS, string> = {
  mac: 'macOS',
  windows: 'Windows',
  linux: 'Linux',
}

/** One-click, local script generator: user picks their OS and downloads a
 *  ready-to-run installer with their key already filled in (all in the browser,
 *  nothing sent to the chat). Also tells them how to get past the OS security
 *  prompt, which is the step beginners trip on. */
function ScriptDownloader({ tool }: { tool: 'claude' | 'codex' }) {
  const { t } = useTranslation()
  const apiKey = useApiKey()
  const [os, setOs] = useState<OS>('mac')
  const hasKey = !!apiKey.trim()

  const runHint: Record<OS, string> = {
    mac: t(
      'macOS may block it the first time ("unidentified developer"). Right-click the downloaded file → Open → Open. If double-clicking does nothing, open Terminal and run: chmod +x the file, then run it.'
    ),
    windows: t(
      'Right-click the .ps1 file → Run with PowerShell. If Windows blocks scripts, open PowerShell and run: Set-ExecutionPolicy -Scope Process Bypass, then run the file.'
    ),
    linux: t('In a terminal: chmod +x the file, then run it.'),
  }

  return (
    <div className='rounded-xl border border-emerald-500/30 bg-emerald-500/[0.05] p-4'>
      <div className='flex items-center gap-2'>
        <Download className='size-4 text-emerald-500' />
        <h3 className='text-sm font-semibold tracking-tight'>
          {t('Or download a one-click installer (key filled in)')}
        </h3>
      </div>
      <Note>
        {t(
          'Pick your system and download a ready-to-run script — your key is written into it right here in your browser (never sent to the chat).'
        )}
      </Note>
      {!hasKey && (
        <Callout>
          {t(
            'Paste your API key in the box above first, otherwise the script downloads with a placeholder you must edit.'
          )}
        </Callout>
      )}
      <div className='mt-3 flex flex-wrap items-center gap-2'>
        <div className='flex gap-1'>
          {(['mac', 'windows', 'linux'] as OS[]).map((o) => (
            <button
              key={o}
              type='button'
              onClick={() => setOs(o)}
              className={cn(
                'rounded-md border px-2.5 py-1 text-xs transition-colors',
                os === o
                  ? 'border-foreground bg-foreground text-background'
                  : 'text-muted-foreground hover:bg-muted'
              )}
            >
              {OS_LABELS[o]}
            </button>
          ))}
        </div>
        <Button
          size='sm'
          onClick={() => {
            const { content, filename } = buildInstallScript(os, tool, apiKey)
            downloadTextFile(content, filename)
          }}
        >
          <Download className='size-4' />
          {t('Download for {{os}}', { os: OS_LABELS[os] })}
        </Button>
      </div>
      <p className='text-muted-foreground mt-3 text-[12px] leading-relaxed'>
        {runHint[os]}
      </p>
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

/** The manual step-by-step instructions. Shown expanded (not collapsed) beneath
 *  the one-click AI path — the AI setup is offered as the faster option on top,
 *  but the full manual guide stays visible for anyone who prefers to follow the
 *  steps themselves. A labelled divider separates the two. */
function ManualSection({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation()
  return (
    <div className='mt-8'>
      <div className='mb-2 flex items-center gap-3'>
        <span className='text-muted-foreground/60 text-[11px] font-medium tracking-wider uppercase'>
          {t('Or set it up manually')}
        </span>
        <span className='bg-border h-px flex-1' />
      </div>
      {children}
    </div>
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

/** Calls-out the "let AI write the install script" flow on each coding-tool
 *  page. The prompt is copyable; the button opens the workspace chat where the
 *  assistant writes a runnable, one-click setup script tailored to the user's
 *  own computer (delivered as a downloadable file from the run panel). */
function AiScriptCallout({ prompt }: { prompt: string }) {
  const { t } = useTranslation()
  const { copyToClipboard } = useCopyToClipboard()
  const [copied, setCopied] = useState(false)
  return (
    <div className='rounded-xl border border-violet-500/30 bg-violet-500/[0.05] p-4'>
      <div className='flex items-center gap-2'>
        <Sparkles className='size-4 text-violet-500' />
        <h3 className='text-sm font-semibold tracking-tight'>
          {t('Easiest: let AI set it up for you (no commands to type)')}
        </h3>
      </div>
      <Note>
        {t(
          'New to this? Open the chat, switch the model to the most capable one — Claude Opus 4.8 — then paste the prompt below. It asks a couple of simple questions and walks you through the whole setup for your exact computer. It uses your own balance. (Keep your real key out of the chat — paste it into the copy-paste block afterwards, or just use the one-click download below.)'
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
              'Use Claude Code or Codex. Pick your tool on the left — each guide has a one-click AI setup.'
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
          'Help me connect Claude Code to AnyRouters on my own computer, step by step. First ask me two things and wait for my answers: (1) my operating system — macOS, Windows, or Linux; and (2) whether I have already created an AnyRouters API key — if not, tell me to create one on the Create API Keys page first. Then give me ONE copy-paste block for my OS that: checks whether Node.js is already installed and installs it only if missing; runs npm install -g @anthropic-ai/claude-code; and persistently sets these environment variables in my shell profile — ANTHROPIC_BASE_URL set to https://api.anyrouters.com (important: end at the domain, do NOT append a version suffix like slash v1), ANTHROPIC_AUTH_TOKEN set to my key, and ANTHROPIC_MODEL set to claude-sonnet-4-6. Make the script safe to run more than once (idempotent): back up my shell profile before editing it, and do not create duplicate lines if the variables are already set. Use an obvious placeholder for the key (do NOT ask me to paste my real key into this chat) and remind me to replace it in the block with my own before running. At the end, tell me how to check it worked, and if anything fails list the two or three most common causes and fixes. Keep explanations short and beginner-friendly.'
        )}
      />

      <div className='mt-3'>
        <ScriptDownloader tool='claude' />
      </div>

      <ManualSection>
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
        <Note>
          {t('Set these environment variables (replace the key in red):')}
        </Note>
        <CodeBlock
          code={`export ANTHROPIC_BASE_URL=${ANTHROPIC_BASE}
export ANTHROPIC_AUTH_TOKEN=${KEY}
export ANTHROPIC_MODEL=claude-sonnet-4-6`}
        />
        <Plain>
          {t(
            'This tells Claude Code to send its requests to AnyRouters (using your key) instead of the default service.'
          )}
        </Plain>
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
      </ManualSection>

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
              'The model name is wrong. Use an exact id such as claude-sonnet-4-6 or claude-opus-4-8 (a bare "claude-sonnet-4-5" or a dated name will not work).'
            ),
          },
          {
            symptom: t('The claude command is not found after installing.'),
            fix: t(
              'Node.js is missing or the terminal was not restarted. Install Node.js from nodejs.org, close and reopen the terminal, then try again.'
            ),
          },
        ]}
      />
    </div>
  )
}

function CodexGuide() {
  const { t } = useTranslation()
  const configToml = `model = "claude-sonnet-4-6"
model_provider = "anyrouters"

[model_providers.anyrouters]
name = "AnyRouters"
base_url = "${OPENAI_BASE}"
env_key = "OPENAI_API_KEY"
wire_api = "responses"`
  return (
    <div>
      <h1 className='text-2xl font-semibold tracking-tight'>Codex</h1>
      <p className='text-muted-foreground mt-2 mb-5 text-sm'>
        {t("OpenAI's coding CLI. On AnyRouters it drives Claude and Gemini too.")}
      </p>

      <AiScriptCallout
        prompt={t(
          'Help me connect the Codex CLI to AnyRouters on my own computer, step by step. First ask me two things and wait for my answers: (1) my operating system — macOS, Windows, or Linux; and (2) whether I have already created an AnyRouters API key — if not, tell me to create one on the Create API Keys page first. Then give me ONE copy-paste block for my OS that: checks whether Node.js is already installed and installs it only if missing; runs npm install -g @openai/codex; creates ~/.codex/config.toml with model = "claude-sonnet-4-6", model_provider = "anyrouters", and a [model_providers.anyrouters] section containing name = "AnyRouters", base_url set to https://api.anyrouters.com then slash v1, env_key = "OPENAI_API_KEY" and wire_api = "responses" (this exact wire_api line is required — Codex 0.142+ removed the old "chat" mode); and persistently exports OPENAI_API_KEY in my shell profile. Make the script safe to run more than once (idempotent): if ~/.codex/config.toml already exists, back it up before overwriting, and do not add duplicate export lines. Use an obvious placeholder for the key (do NOT ask me to paste my real key into this chat) and remind me to replace it before running. At the end, tell me how to verify by running codex, and if anything fails list the two or three most common causes and fixes. Keep explanations short and beginner-friendly.'
        )}
      />

      <div className='mt-3'>
        <ScriptDownloader tool='codex' />
      </div>

      <ManualSection>
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
        <CodeBlock code={configToml} />
        <Plain>
          {t(
            'This file tells Codex to use AnyRouters. Download it with your key already filled in, then move it into the .codex folder in your home directory.'
          )}
        </Plain>
        <DownloadFileButton
          content={configToml}
          filename='config.toml'
          label={t('Download config.toml (key filled in)')}
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
      </ManualSection>

      <Troubleshooting
        items={[
          {
            symptom: t('Codex says «wire_api chat is no longer supported».'),
            fix: t(
              'Add the line wire_api = "responses" to the [model_providers.anyrouters] section of ~/.codex/config.toml.'
            ),
          },
          {
            symptom: t('Requests fail with an authentication error.'),
            fix: t(
              'OPENAI_API_KEY is not set in the terminal you are using. Set it (see step 4) and restart the terminal.'
            ),
          },
          {
            symptom: t('The desktop app or IDE plugin cannot connect.'),
            fix: t('Use the terminal CLI instead — custom endpoints only work reliably there.'),
          },
        ]}
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

      <AiScriptCallout
        prompt={t(
          'I want to add AnyRouters to cc-switch. Ask me which operating system I use and whether I have already created an AnyRouters API key (if not, tell me to create one first). Then walk me through adding AnyRouters as a provider with base URL set to https://api.anyrouters.com (end at the domain, do NOT append a version suffix like slash v1) and model claude-sonnet-4-6, and give me a config snippet I can paste. Use an obvious placeholder for the key (do NOT ask me to paste my real key into this chat) and remind me to replace it. Then tell me how to confirm the switch worked, and if it does not, list the most common causes and fixes. Keep it short and beginner-friendly.'
        )}
      />

      <ManualSection>
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
      </ManualSection>
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
  const [apiKey, setApiKey] = useState('')
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
          {/* Paste-key-once bar: shown on every guide (including Overview, whose
              curl/Python samples also carry the key placeholder). */}
          <KeyContext.Provider value={apiKey}>
            <KeyBar apiKey={apiKey} onChange={setApiKey} />
            <ActiveGuide />
          </KeyContext.Provider>
        </main>
      </div>
    </div>
  )
}
