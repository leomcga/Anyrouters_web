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
'use client'

import {
  Children,
  isValidElement,
  useState,
  type ReactNode,
} from 'react'
import { ChevronRight, Copy, Check, Download } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { BundledLanguage } from 'shiki/bundle/web'
import { cn } from '@/lib/utils'
import { CodeBlock } from '@/components/ai-elements/code-block'
import { exportCode } from '../lib/file-export'

// A collapsed-by-default wrapper for fenced code blocks inside chat answers.
//
// It replaces Streamdown's default <pre> renderer. From the <code> child we
// extract the raw source + language, then render our own header (language,
// line count, copy, download, expand/collapse). When expanded we re-highlight
// the source with the project's own shiki-based <CodeBlock> — so highlighting
// is fully under our control and doesn't depend on Streamdown internals. Models
// can emit many/long code blocks without flooding the chat: everything starts
// collapsed and the user opens only what they want.

// A conservative allow-list of languages shiki's web bundle can highlight; we
// fall back to plaintext for anything unknown so codeToHtml never throws.
const KNOWN_LANGS = new Set([
  'javascript', 'js', 'jsx', 'typescript', 'ts', 'tsx', 'python', 'py',
  'ruby', 'go', 'rust', 'java', 'kotlin', 'swift', 'c', 'cpp', 'c++',
  'csharp', 'cs', 'php', 'bash', 'sh', 'shell', 'zsh', 'powershell', 'sql',
  'html', 'xml', 'css', 'scss', 'json', 'yaml', 'yml', 'toml', 'markdown',
  'md', 'dockerfile', 'lua', 'dart', 'scala', 'perl', 'r', 'diff', 'ini',
  'graphql', 'vue', 'svelte', 'astro', 'text', 'plaintext',
])

function normalizeLang(lang: string): BundledLanguage {
  const l = lang.toLowerCase()
  if (l === 'c++') return 'cpp' as BundledLanguage
  if (KNOWN_LANGS.has(l)) return l as BundledLanguage
  return 'text' as BundledLanguage
}

// Pull the raw source + language out of the <code> child element.
function readCode(children: ReactNode): { code: string; language: string } {
  let code = ''
  let language = ''

  const walk = (node: ReactNode) => {
    Children.forEach(node, (child) => {
      if (typeof child === 'string') {
        code += child
        return
      }
      if (typeof child === 'number') {
        code += String(child)
        return
      }
      if (!isValidElement(child)) return
      const props = child.props as { className?: string; children?: ReactNode }
      if (!language && typeof props.className === 'string') {
        const m = props.className.match(/language-([^\s]+)/)
        if (m) language = m[1]
      }
      walk(props.children)
    })
  }
  walk(children)
  return { code: code.replace(/\n$/, ''), language }
}

export function CollapsibleCode({ children }: { children?: ReactNode }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const { code, language } = readCode(children)
  const lineCount = code ? code.split('\n').length : 0
  const label = language || t('code')

  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard unavailable — ignore */
    }
  }

  const download = (e: React.MouseEvent) => {
    e.stopPropagation()
    exportCode(code, language, 'snippet')
  }

  return (
    <div className='my-3 overflow-hidden rounded-lg border'>
      {/* Header: click to expand/collapse; language + line count + actions. */}
      <div
        className='bg-muted/50 hover:bg-muted flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs transition-colors select-none'
        onClick={() => setOpen((o) => !o)}
      >
        <ChevronRight
          className={cn(
            'size-3.5 shrink-0 transition-transform',
            open && 'rotate-90'
          )}
        />
        <span className='font-mono font-medium'>{label}</span>
        {lineCount > 0 && (
          <span className='text-muted-foreground'>
            · {t('{{count}} lines', { count: lineCount })}
          </span>
        )}
        <span className='flex-1' />
        <button
          type='button'
          onClick={copy}
          className='text-muted-foreground hover:text-foreground flex items-center rounded px-1.5 py-0.5'
          title={t('Copy')}
        >
          {copied ? (
            <Check className='size-3.5 text-green-600' />
          ) : (
            <Copy className='size-3.5' />
          )}
        </button>
        <button
          type='button'
          onClick={download}
          className='text-muted-foreground hover:text-foreground flex items-center rounded px-1.5 py-0.5'
          title={t('Download code')}
        >
          <Download className='size-3.5' />
        </button>
        {!open && (
          <span className='text-muted-foreground ml-1'>{t('Expand')}</span>
        )}
      </div>

      {/* Body: re-highlighted source via the project's own shiki CodeBlock. */}
      {open && (
        <div className='max-h-[32rem] overflow-auto'>
          <CodeBlock
            code={code}
            language={normalizeLang(language)}
            className='rounded-none border-0'
          />
        </div>
      )}
    </div>
  )
}
