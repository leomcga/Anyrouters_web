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
// managedVars = the env var names this script owns (e.g. ANTHROPIC_* for Claude
// Code, OPENAI_API_KEY for Codex). The setup is REPAIR-oriented and idempotent:
// on every run it deletes our previous managed block, comments out any stray
// copies of those vars the user set elsewhere (so a stale key/URL can't win),
// then writes one clean block. Re-running fixes a messed-up profile instead of
// piling duplicates on top.
function shProfileAndNode(
  os: OS,
  verifyCmd: string,
  managedVars: string[]
): { head: string; tail: string } {
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
  const varsList = managedVars.join(' ')
  const head = `#!/bin/bash
# AnyRouters setup — safe to run more than once; repairs a messed-up profile.
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

# 3) Clean up first (idempotent + repair): drop our previous block, and
#    comment out any stray copies of the vars we manage so an old/wrong value
#    can't override ours. sed -i.tmp works on both macOS (BSD) and Linux (GNU).
BEGIN_MARK="# anyrouters-managed-begin"
END_MARK="# anyrouters-managed-end"
if grep -qF "$BEGIN_MARK" "$PROFILE"; then
  sed -i.anyrtmp "/$BEGIN_MARK/,/$END_MARK/d" "$PROFILE"; rm -f "$PROFILE.anyrtmp"
fi
for v in ${varsList}; do
  sed -i.anyrtmp "s|^\\([[:space:]]*export \${v}=\\)|# disabled-by-anyrouters \\1|" "$PROFILE"; rm -f "$PROFILE.anyrtmp"
done

# 4) Open a fresh managed block; add_line appends into it.
printf '\\n%s\\n' "$BEGIN_MARK" >> "$PROFILE"
add_line() { echo "$1" >> "$PROFILE"; }
`
  const tail = `
# 5) Close the managed block and verify.
echo "$END_MARK" >> "$PROFILE"
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
  const { head, tail } = shProfileAndNode(os, 'claude', Object.keys(env))
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
  // codex: install + write ~/.codex/config.toml + ~/.codex/auth.json. The key
  // goes in auth.json (a file Codex reads directly), NOT a shell env var — so
  // the script never edits the shell profile and there is nothing to conflict
  // with or repair. Both files are backed up before overwrite.
  const toml = `model = "gpt-5.5"
model_provider = "anyrouters"
model_reasoning_effort = "medium"
disable_response_storage = true

[model_providers.anyrouters]
name = "AnyRouters"
base_url = "${OPENAI_BASE}"
wire_api = "responses"`
  const authJson = `{
  "OPENAI_API_KEY": "${key}"
}`
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
if (Test-Path "$dir\\auth.json") { Copy-Item "$dir\\auth.json" "$dir\\auth.json.anyrouters.bak" -Force }
@'
${authJson}
'@ | Set-Content -Encoding UTF8 "$dir\\auth.json"
Write-Host "Done. Close this window and open a NEW terminal, then run: codex"
`,
      filename: 'setup-codex.ps1',
    }
  }
  const nodeCheck =
    os === 'mac'
      ? `  if command -v brew >/dev/null 2>&1; then echo "Installing Node.js via Homebrew ..."; brew install node; else echo "Node.js is missing. Install it from https://nodejs.org, then re-run."; exit 1; fi`
      : `  echo "Node.js is missing. Install it from https://nodejs.org, then re-run."; exit 1`
  return {
    content: `#!/bin/bash
# AnyRouters Codex setup — safe to run more than once. Writes two files under
# ~/.codex; does NOT touch your shell profile.
set -e
if ! command -v node >/dev/null 2>&1; then
${nodeCheck}
fi
echo "Installing @openai/codex ..."
npm install -g @openai/codex
mkdir -p "$HOME/.codex"
[ -f "$HOME/.codex/config.toml" ] && cp "$HOME/.codex/config.toml" "$HOME/.codex/config.toml.anyrouters.bak"
cat > "$HOME/.codex/config.toml" <<'TOML'
${toml}
TOML
[ -f "$HOME/.codex/auth.json" ] && cp "$HOME/.codex/auth.json" "$HOME/.codex/auth.json.anyrouters.bak"
cat > "$HOME/.codex/auth.json" <<'JSON'
${authJson}
JSON
echo ""
echo "✅ Setup complete. Open a NEW terminal window, then run: codex"
`,
    filename: os === 'mac' ? 'setup-codex.command' : 'setup-codex.sh',
  }
}

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
  const [os, setOs] = useState<OS>('mac')
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

/** One-click, local script generator: user picks their OS and downloads a
 *  ready-to-run installer with their key already filled in (all in the browser,
 *  nothing sent to the chat). Also tells them how to get past the OS security
 *  prompt, which is the step beginners trip on. */
function ScriptDownloader({ tool }: { tool: 'claude' | 'codex' }) {
  const { t } = useTranslation()
  const apiKey = useApiKey()
  // Driven by the guide's single OS toggle, so picking a system up top also
  // picks the right installer here — one choice for the whole page.
  const { os } = useOsChoice()
  const hasKey = !!apiKey.trim()

  // The exact filename this OS downloads (key-independent), so the run command
  // below names the real file.
  const filename = buildInstallScript(os, tool, '').filename

  // Downloaded scripts are NOT marked executable (browsers save them 0644) and
  // carry a Gatekeeper quarantine flag, so double-clicking a .command fails with
  // «you do not have permission to execute» — exactly the error users hit. The
  // reliable path is to RUN it through the interpreter, which needs neither the
  // execute bit nor a Gatekeeper approval. We show that command, copyable.
  const runCommand: Record<OS, string> = {
    mac: `bash ~/Downloads/${filename}`,
    linux: `bash ~/Downloads/${filename}`,
    windows: `powershell -ExecutionPolicy Bypass -File "$HOME\\Downloads\\${filename}"`,
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
      <RunAfterDownload os={os} command={runCommand[os]} />
    </div>
  )
}

/** Hand-holding "now run it" guide for a downloaded install script, written for
 *  a complete beginner: exactly how to open the terminal, where to paste, what
 *  Enter does, what the security prompt looks like, and how to tell it worked.
 *  A downloaded script isn't executable and is Gatekeeper-quarantined, so we
 *  never tell people to double-click — running it through bash/PowerShell needs
 *  no permissions and skips the quarantine block. */
function RunAfterDownload({ os, command }: { os: OS; command: string }) {
  const { t } = useTranslation()
  const openStep =
    os === 'mac'
      ? t(
          'Open the Terminal app. Press ⌘ (Command) + Space to open Spotlight, type “Terminal”, and press Enter. A window with a blinking cursor appears — this is where you type commands.'
        )
      : os === 'linux'
        ? t(
            'Open your terminal app (often Ctrl+Alt+T, or search “Terminal” in your apps). A window with a blinking cursor appears.'
          )
        : t(
            'Open PowerShell. Click the Start menu, type “PowerShell”, and click “Windows PowerShell”. A blue window appears.'
          )

  return (
    <div className='mt-4 rounded-lg border bg-background/60 p-3'>
      <p className='text-[13px] font-medium'>
        {t('After it downloads, do this:')}
      </p>

      <Callout>
        {os === 'windows'
          ? t(
              'Do NOT double-click the file. Windows would just open it in Notepad instead of running it. Follow the steps below.'
            )
          : t(
              'Do NOT double-click the file. A downloaded script has no “run” permission, so double-clicking only shows a permission error. The steps below run it safely — no permission changes needed.'
            )}
      </Callout>

      <ol className='mt-3 space-y-3'>
        <li className='flex gap-2'>
          <span className='bg-foreground text-background flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold'>
            1
          </span>
          <p className='text-muted-foreground text-[13px] leading-relaxed'>
            {openStep}
          </p>
        </li>
        <li className='flex gap-2'>
          <span className='bg-foreground text-background flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold'>
            2
          </span>
          <div className='min-w-0 flex-1'>
            <p className='text-muted-foreground text-[13px] leading-relaxed'>
              {os === 'windows'
                ? t(
                    'Type “powershell -ExecutionPolicy Bypass -File ” (with a trailing space), then DRAG the downloaded file from its folder into the window — this fills in its real path no matter where it downloaded — and press Enter.'
                  )
                : t(
                    'Type “bash ” (the word bash and a space), then DRAG the downloaded file from Finder/your file manager into the terminal window — this fills in its real path no matter which folder it downloaded to — and press Enter.'
                  )}
            </p>
            <p className='text-muted-foreground/80 mt-1.5 text-[12px] italic leading-relaxed'>
              {t(
                'Dragging the file in is the reliable way — it always uses the correct path. If you know it went to your Downloads folder, you can instead paste this and press Enter:'
              )}
            </p>
            <div className='mt-2'>
              <CodeBlock code={command} />
            </div>
            {os === 'windows' && (
              <p className='text-muted-foreground/80 mt-1.5 text-[12px] leading-relaxed'>
                {t(
                  'If Windows still says the script is blocked or “running scripts is disabled on this system”, your PC has a stricter policy. Don’t fight it — scroll down to “Or set it up manually” instead: you just save a couple of small text files, no script to run.'
                )}
              </p>
            )}
          </div>
        </li>
        {os === 'mac' && (
          <li className='flex gap-2'>
            <span className='bg-foreground text-background flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold'>
              3
            </span>
            <p className='text-muted-foreground text-[13px] leading-relaxed'>
              {t(
                'If macOS pops up “cannot verify the developer” or asks about an unidentified developer, click Cancel, then open  → System Settings → Privacy & Security, scroll down and click “Open Anyway”, and run the command again. (This is macOS being cautious about downloaded files; the script is the one you just got from this page.)'
              )}
            </p>
          </li>
        )}
        <li className='flex gap-2'>
          <span className='bg-emerald-500 text-white flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold'>
            ✓
          </span>
          <p className='text-muted-foreground text-[13px] leading-relaxed'>
            {t(
              'Wait for it to finish (it may install a few things). When you see “✅ Setup complete”, it worked. Close the window, open a brand-new one, and you are ready to go.'
            )}
          </p>
        </li>
      </ol>
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

// The env-var step for Claude Code, showing only the selected OS's commands
// (macOS/Linux use export in ~/.zshrc; Windows uses setx in PowerShell).
function ClaudeEnvStep() {
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
setx ANTHROPIC_MODEL claude-sonnet-4-6`}
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
export ANTHROPIC_MODEL=claude-sonnet-4-6`}
      />
    </>
  )
}

function ClaudeCodeGuide() {
  const { t } = useTranslation()
  return (
    <OsProvider withLinux>
    <div>
      <h1 className='text-2xl font-semibold tracking-tight'>Claude Code</h1>
      <p className='text-muted-foreground mt-2 mb-5 text-sm'>
        {t("Anthropic's official terminal coding agent, on AnyRouters.")}
      </p>

      <OsToggle />

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
        <Plain>
          {t(
            'This tells Claude Code to send its requests to AnyRouters (using your key) instead of the default service.'
          )}
        </Plain>
        <ClaudeEnvStep />
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
              'The model name is wrong. Use an exact id from the Model Marketplace such as claude-sonnet-4-6 or claude-opus-4-8 (a truncated name like "claude-sonnet" or an upstream dated id will not work).'
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
    </OsProvider>
  )
}

// The image-generation helper Codex runs to draw pictures. Codex itself can't
// generate images; this tiny script calls AnyRouters' gpt-image-2 (OpenAI-
// compatible /v1/images) using the SAME key Codex uses — read from
// ~/.codex/auth.json (or an env var if set). Downloaded verbatim from the Codex
// guide (no key baked into the file).
const GEN_IMAGE_PY = `#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen_image.py —— gpt-image-2 完整画图工具（给 Codex 调用），走 anyrouters 中转

最正规方案：用 OpenAI 官方 SDK（base_url 指向 anyrouters），完整运用 gpt-image-2 的能力：
  1) 文生图        images.generations —— 全参数（尺寸/质量/透明背景/格式/审核/张数）
  2) 图生图/参考图  images.edits       —— 一张或多张参考图，做风格迁移/合成
  3) 局部重绘(inpaint) images.edits + mask —— 只改 mask 透明区域，其余像素不动

用你 Codex 已有的同一个 anyrouters key（自动从 ~/.codex/auth.json 读取），
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
# ~/.codex/auth.json（Codex 现在把 key 存这里，无需再设环境变量）。
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
        print("  已配好 Codex 的话，key 会自动从 ~/.codex/auth.json 读取。", file=sys.stderr)
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
            print("  → anyrouters key 无效/无权限，检查 ~/.codex/auth.json 里的 key。", file=sys.stderr)
        elif "404" in msg:
            print("  → 模型 " + args.model + " 在中转站不存在，换 --model。", file=sys.stderr)
        elif "429" in msg:
            print("  → 触发限速，等一会再试。", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
`

const CODEX_CONFIG_TOML = `model = "gpt-5.5"
model_provider = "anyrouters"
model_reasoning_effort = "medium"
disable_response_storage = true

[model_providers.anyrouters]
name = "AnyRouters"
base_url = "${OPENAI_BASE}"
wire_api = "responses"`

// The key lives in ~/.codex/auth.json (a plain file Codex reads directly), NOT
// in a shell environment variable. This is the reliable path for non-coders:
// nothing to add to .zshrc / PowerShell, and on Windows there is no script to
// be blocked by the execution policy — you just save two small text files.
const CODEX_AUTH_JSON = `{
  "OPENAI_API_KEY": "${KEY}"
}`

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
          "Codex writes and runs code, but it can't draw pictures on its own. Give it this tiny script and it will call AnyRouters' gpt-image-2 to produce real image assets — using the very same key you set above (it reads it from ~/.codex/auth.json). Chat and images bill to one AnyRouters key."
        )}
      </Note>

      <Step n={1} title={t('Download the image script')} />
      <Note>
        {t(
          'Save gen_image.py into your project (or any folder). No key is written into the file — it reads your key from ~/.codex/auth.json at runtime.'
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

function CodexDesktopGuide() {
  const { t } = useTranslation()
  return (
    <OsProvider>
    <div>
      <h1 className='text-2xl font-semibold tracking-tight'>
        {t('Codex — Desktop app')}
      </h1>
      <p className='text-muted-foreground mt-2 mb-5 text-sm'>
        {t(
          "OpenAI's Codex as a desktop chat window — the easiest way to use it if you don't live in the terminal. Configured once, it drives Claude and Gemini through AnyRouters."
        )}
      </p>

      <OsToggle />

      <AiScriptCallout
        prompt={t(
          'Help me connect the Codex DESKTOP app to AnyRouters on my own computer, step by step. First ask me two things and wait for my answers: (1) my operating system — macOS or Windows; and (2) whether I have already created an AnyRouters API key — if not, tell me to create one on the Create API Keys page first. Then guide me to: install the Codex desktop app from OpenAI\'s official page and fully quit it; create the file ~/.codex/config.toml with model = "gpt-5.5", model_provider = "anyrouters", model_reasoning_effort = "medium", disable_response_storage = true, and a [model_providers.anyrouters] section containing name = "AnyRouters", base_url set to https://api.anyrouters.com then slash v1, and wire_api = "responses" (this exact wire_api line is required — Codex 0.142+ removed the old "chat" mode; do NOT add an env_key line); and create a SECOND file ~/.codex/auth.json containing {"OPENAI_API_KEY": "my key"} — the key goes in this file, NOT in an environment variable, so there is nothing to add to my shell profile or PowerShell. Tell me per-OS how to open the .codex folder (Windows: Win+R then %USERPROFILE%\\.codex; macOS: Finder, Cmd+Shift+G, then ~/.codex). Use an obvious placeholder for the key (do NOT ask me to paste my real key into this chat) and remind me to replace it. Stress that the files only take effect the NEXT time the app launches, so I must fully quit and reopen the desktop app. At the end tell me how to verify (open the app and send a message), and if it still asks me to sign in or ignores the config, list the two or three most common causes and fixes. Keep it short and beginner-friendly.'
        )}
      />

      <ManualSection>
        <Callout tone='tip'>
          {t(
            'The desktop app and the terminal CLI share the SAME two files in ~/.codex (config.toml and auth.json). If you already set up the terminal version, the desktop app just works after a full restart — skip to the launch step.'
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

        <Step n={3} title={t('Create config.toml in your .codex folder')} />
        <CodexOpenFolder />
        <CodeBlock code={CODEX_CONFIG_TOML} />
        <Plain>
          {t(
            'Create a file named config.toml inside that .codex folder and paste this in — or just download it (your key is already in the auth.json below, not here) and move it into the folder.'
          )}
        </Plain>
        <DownloadFileButton
          content={CODEX_CONFIG_TOML}
          filename='config.toml'
          label={t('Download config.toml')}
        />
        <Callout>
          {t(
            'Keep the last line wire_api = "responses". Codex 0.142+ dropped the old "chat" mode, so without it Codex fails with «wire_api chat is no longer supported».'
          )}
        </Callout>

        <Step n={4} title={t('Put your key in auth.json (same folder)')} />
        <Note>
          {t(
            'In the SAME .codex folder, create a second file named auth.json with your key inside. No environment variable, no editing system settings — Codex reads the key straight from this file.'
          )}
        </Note>
        <CodeBlock code={CODEX_AUTH_JSON} />
        <DownloadFileButton
          content={CODEX_AUTH_JSON}
          filename='auth.json'
          label={t('Download auth.json (key filled in)')}
        />

        <Step n={5} title={t('Launch and chat')} />
        <Note>
          {t(
            'Start (or fully restart) the Codex desktop app and just chat — no terminal needed. The key and config only apply to apps launched AFTER they were set, so if it was open during setup, quit and reopen it.'
          )}
        </Note>
        <Callout tone='tip'>
          {t(
            'Works with any model AnyRouters serves — Claude and Gemini included — because the Responses API is bridged to each upstream.'
          )}
        </Callout>
      </ManualSection>

      <CodexImageSection />

      <Troubleshooting
        items={[
          {
            symptom: t('The desktop app ignores the config / still asks to sign in.'),
            fix: t(
              'Quit the app COMPLETELY and reopen it — the files are only read at launch. Make sure BOTH ~/.codex/config.toml and ~/.codex/auth.json exist, are spelled exactly like that, and that auth.json contains your real key.'
            ),
          },
          {
            symptom: t('Codex says «wire_api chat is no longer supported».'),
            fix: t(
              'Add the line wire_api = "responses" to the [model_providers.anyrouters] section of ~/.codex/config.toml, then restart the app.'
            ),
          },
          {
            symptom: t('A red «codex_apps … chatgpt.com» connection error appears.'),
            fix: t(
              "That is Codex's built-in ChatGPT connector failing (it does not go through AnyRouters and is unreachable in some regions). It is harmless noise — your chats and images still work; you can ignore it."
            ),
          },
        ]}
      />
    </div>
    </OsProvider>
  )
}

function CodexTerminalGuide() {
  const { t } = useTranslation()
  return (
    <OsProvider withLinux>
    <div>
      <h1 className='text-2xl font-semibold tracking-tight'>
        {t('Codex — Terminal CLI')}
      </h1>
      <p className='text-muted-foreground mt-2 mb-5 text-sm'>
        {t(
          "OpenAI's Codex as a terminal coding agent — best if you work in the shell. On AnyRouters it drives Claude and Gemini too."
        )}
      </p>

      <OsToggle />

      <AiScriptCallout
        prompt={t(
          'Help me connect the Codex CLI to AnyRouters on my own computer, step by step. First ask me two things and wait for my answers: (1) my operating system — macOS, Windows, or Linux; and (2) whether I have already created an AnyRouters API key — if not, tell me to create one on the Create API Keys page first. Then give me ONE copy-paste block for my OS that: checks whether Node.js is already installed and installs it only if missing; runs npm install -g @openai/codex; creates ~/.codex/config.toml with model = "gpt-5.5", model_provider = "anyrouters", model_reasoning_effort = "medium", disable_response_storage = true, and a [model_providers.anyrouters] section containing name = "AnyRouters", base_url set to https://api.anyrouters.com then slash v1, and wire_api = "responses" (this exact wire_api line is required — Codex 0.142+ removed the old "chat" mode; do NOT add an env_key line); and creates ~/.codex/auth.json containing {"OPENAI_API_KEY": "my key"} — the key goes in this file, NOT in a shell environment variable, so the script does not touch my shell profile at all. Make the script safe to run more than once (idempotent): if either file already exists, back it up before overwriting. Use an obvious placeholder for the key (do NOT ask me to paste my real key into this chat) and remind me to replace it before running. At the end, tell me how to verify by running codex, and if anything fails list the two or three most common causes and fixes. Keep explanations short and beginner-friendly.'
        )}
      />

      <div className='mt-3'>
        <ScriptDownloader tool='codex' />
      </div>

      <ManualSection>
        <Callout tone='tip'>
          {t(
            'The terminal CLI and the desktop app share the SAME two files in ~/.codex (config.toml and auth.json) — set them up here and the desktop app works too.'
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

        <Step n={3} title={t('Create config.toml in your .codex folder')} />
        <CodexOpenFolder />
        <CodeBlock code={CODEX_CONFIG_TOML} />
        <Plain>
          {t(
            'Create a file named config.toml inside that .codex folder and paste this in — or just download it and move it into the folder.'
          )}
        </Plain>
        <DownloadFileButton
          content={CODEX_CONFIG_TOML}
          filename='config.toml'
          label={t('Download config.toml')}
        />
        <Callout>
          {t(
            'Keep the last line wire_api = "responses". Codex 0.142+ dropped the old "chat" mode, so without it Codex fails with «wire_api chat is no longer supported».'
          )}
        </Callout>

        <Step n={4} title={t('Put your key in auth.json (same folder)')} />
        <Note>
          {t(
            'In the SAME .codex folder, create a second file named auth.json with your key inside. No environment variable, no editing your shell profile — Codex reads the key straight from this file.'
          )}
        </Note>
        <CodeBlock code={CODEX_AUTH_JSON} />
        <DownloadFileButton
          content={CODEX_AUTH_JSON}
          filename='auth.json'
          label={t('Download auth.json (key filled in)')}
        />

        <Step n={5} title={t('Run')} />
        <Note>{t('Open a NEW terminal window and run:')}</Note>
        <CodeBlock code={`codex`} />
        <Callout tone='tip'>
          {t(
            'Works with any model AnyRouters serves — Claude and Gemini included — because the Responses API is bridged to each upstream.'
          )}
        </Callout>
      </ManualSection>

      <CodexImageSection />

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
              'Your key is missing or wrong in ~/.codex/auth.json. Open that file and make sure it reads {"OPENAI_API_KEY": "your real key"} with your actual AnyRouters key (see step 4).'
            ),
          },
          {
            symptom: t('The codex command is not found after installing.'),
            fix: t(
              'Node.js is missing or the terminal was not restarted. Install Node.js from nodejs.org, close and reopen the terminal, then try again.'
            ),
          },
        ]}
      />
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
          'Turn the provider on, add models like claude-sonnet-4-6 or gemini-3.5-flash, and start chatting.'
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
  {
    id: 'codex-desktop',
    label: 'Codex Desktop',
    icon: AppWindow,
    render: CodexDesktopGuide,
  },
  {
    id: 'codex-cli',
    label: 'Codex CLI',
    icon: MessageSquareCode,
    render: CodexTerminalGuide,
  },
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
