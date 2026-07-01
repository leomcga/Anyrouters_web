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
import { useEffect, useState } from 'react'
import { AlertCircle, Download, FileText, Loader2, Play } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { executeCode } from '../api'
import type { ExecuteResponse, ExecutionFile } from '../types'

type RunStatus = 'idle' | 'running' | 'done' | 'error'

// Module-level cache of completed runs, keyed by the exact code string. The run
// panel's result otherwise lives only in component state, so switching chats
// (which unmounts the panel) loses it — and on remount autoRun would execute
// the same file-producing code AGAIN (wasted sandbox time + double billing).
// Caching by code means a remount restores the previous result and skips the
// re-run; identical code across messages deterministically shares one result.
type CachedRun = { result: ExecuteResponse; status: RunStatus; errMsg: string }
const runCache = new Map<string, CachedRun>()
// A run in flight, so a remount mid-execution attaches to it instead of
// launching a second sandbox for the same code.
const inFlight = new Map<string, Promise<ExecuteResponse>>()

function humanSize(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${units[i]}`
}

function dataUrl(file: ExecutionFile): string {
  return `data:${file.mime};base64,${file.b64}`
}

function isImage(file: ExecutionFile): boolean {
  return file.mime.startsWith('image/') && !!file.b64
}

function errorText(error: unknown): string {
  if (!error) return ''
  if (typeof error === 'string') return error
  const e = error as { value?: string; name?: string; traceback?: string }
  return e.traceback || e.value || e.name || 'execution failed'
}

function FileCard({ file }: { file: ExecutionFile }) {
  const { t } = useTranslation()

  if (isImage(file)) {
    return (
      <div className='overflow-hidden rounded-lg border'>
        <img
          src={dataUrl(file)}
          alt={file.name}
          className='bg-muted/30 max-h-72 w-full object-contain'
        />
        <div className='flex items-center justify-between gap-2 p-2'>
          <span className='text-muted-foreground truncate text-xs'>
            {file.name}
          </span>
          <a
            href={dataUrl(file)}
            download={file.name}
            className='text-muted-foreground hover:text-foreground hover:bg-muted shrink-0 rounded-md p-1 transition-colors'
            title={t('Download')}
          >
            <Download className='size-3.5' />
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className='flex items-center gap-2.5 rounded-lg border p-2.5'>
      <div className='bg-muted/50 flex size-8 shrink-0 items-center justify-center rounded-md'>
        <FileText className='text-muted-foreground size-4' />
      </div>
      <div className='min-w-0 flex-1'>
        <div className='truncate text-xs font-medium'>{file.name}</div>
        <div className='text-muted-foreground text-[11px]'>
          {humanSize(file.size)}
          {file.truncated ? ` · ${t('too large to preview')}` : ''}
        </div>
      </div>
      {file.b64 ? (
        <a
          href={dataUrl(file)}
          download={file.name}
          className='text-muted-foreground hover:text-foreground hover:bg-muted shrink-0 rounded-md border p-1.5 transition-colors'
          title={t('Download')}
        >
          <Download className='size-3.5' />
        </a>
      ) : null}
    </div>
  )
}

export function CodeRunPanel({
  code,
  autoRun = false,
}: {
  code: string
  // When true (file-producing code), run once automatically — like ChatGPT's
  // code interpreter: the user asked for a file, so they shouldn't have to
  // click Run. Plain scripts stay manual.
  autoRun?: boolean
}) {
  const { t } = useTranslation()
  // Seed from the module cache so a remount (e.g. after switching chats) shows
  // the previous result instead of re-running.
  const cached = runCache.get(code)
  const [status, setStatus] = useState<RunStatus>(cached?.status ?? 'idle')
  const [result, setResult] = useState<ExecuteResponse | null>(
    cached?.result ?? null
  )
  const [errMsg, setErrMsg] = useState(cached?.errMsg ?? '')
  const [showCode, setShowCode] = useState(false)
  // null = follow the smart default (collapsed when files were produced); once
  // the user toggles, honor their explicit choice.
  const [showLogState, setShowLogState] = useState<boolean | null>(null)

  const run = async () => {
    setStatus('running')
    setErrMsg('')
    try {
      // Reuse an in-flight run for the same code (e.g. a remount landing mid
      // execution) so we never launch two sandboxes for one block.
      let p = inFlight.get(code)
      if (!p) {
        p = executeCode(code, 'python')
        inFlight.set(code, p)
        p.finally(() => inFlight.delete(code))
      }
      const res = await p
      const nextStatus: RunStatus = res.ok && !res.error ? 'done' : 'error'
      const nextErr = res.error
        ? errorText(res.error)
        : !res.ok
          ? t('Execution failed')
          : ''
      setResult(res)
      setStatus(nextStatus)
      setErrMsg(nextErr)
      runCache.set(code, { result: res, status: nextStatus, errMsg: nextErr })
    } catch (e) {
      const err = e as { response?: { data?: { error?: string } }; message?: string }
      setStatus('error')
      setErrMsg(err?.response?.data?.error || err?.message || t('Execution failed'))
      // A thrown error (network etc.) is transient — don't cache it, so the
      // user can retry and a remount can still auto-run.
    }
  }

  // Sync UI state to the current code block, restoring any cached result. Reset
  // the disclosure toggles for a fresh block.
  useEffect(() => {
    const c = runCache.get(code)
    setStatus(c?.status ?? 'idle')
    setResult(c?.result ?? null)
    setErrMsg(c?.errMsg ?? '')
    setShowLogState(null)
    setShowCode(false)
  }, [code])

  // Auto-run file-producing code once — but only if it hasn't already run
  // (cache miss). A cached result means we've run this exact code before, so
  // switching chats and back must NOT trigger another sandbox execution.
  useEffect(() => {
    if (autoRun && status === 'idle' && !runCache.has(code)) {
      run()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRun, code, status])

  if (status === 'idle') {
    return (
      <div className='mt-2 space-y-2'>
        <div className='flex items-center gap-2'>
          <Button
            type='button'
            variant='outline'
            size='sm'
            onClick={run}
            className='gap-1.5'
          >
            <Play className='size-3.5' />
            {t('Run code')}
          </Button>
          <button
            type='button'
            onClick={() => setShowCode((s) => !s)}
            className='text-muted-foreground hover:text-foreground text-xs'
          >
            {showCode ? t('Hide code') : t('Show code')}
          </button>
        </div>
        {showCode && (
          <pre className='bg-muted/40 max-h-60 overflow-auto rounded-lg border p-2.5 text-xs'>
            <code className='font-mono'>{code}</code>
          </pre>
        )}
      </div>
    )
  }

  if (status === 'running') {
    return (
      <div className='text-muted-foreground mt-2 flex items-center gap-2 text-sm'>
        <Loader2 className='size-4 animate-spin' />
        {t('Running in sandbox...')}
      </div>
    )
  }

  const hasFiles = !!result?.files?.length
  // When files were produced the run succeeded and the download cards are the
  // point — keep the raw stdout log collapsed so "give me a Word file" isn't
  // buried under program output. Errors, or runs with no file, show the log
  // up front because that's what the user needs to see.
  const showLog = showLogState ?? (!hasFiles || status === 'error')

  return (
    <div className='mt-2 space-y-3 rounded-xl border p-3'>
      <div className='flex items-center justify-between gap-2'>
        <span className='text-muted-foreground text-xs font-medium'>
          {hasFiles ? t('Files ready') : t('Sandbox output')}
        </span>
        <div className='flex items-center gap-1'>
          <button
            type='button'
            onClick={() => setShowCode((s) => !s)}
            className='text-muted-foreground hover:text-foreground rounded-md px-1.5 py-1 text-xs'
          >
            {showCode ? t('Hide code') : t('Show code')}
          </button>
          {result?.stdout ? (
            <button
              type='button'
              onClick={() => setShowLogState(!showLog)}
              className='text-muted-foreground hover:text-foreground rounded-md px-1.5 py-1 text-xs'
            >
              {showLog ? t('Hide log') : t('Show log')}
            </button>
          ) : null}
          <button
            type='button'
            onClick={run}
            title={t('Re-run')}
            className='text-muted-foreground hover:text-foreground hover:bg-muted rounded-md p-1 transition-colors'
          >
            <Play className='size-3.5' />
          </button>
        </div>
      </div>

      {hasFiles ? (
        <div className='grid items-start gap-2 sm:grid-cols-2'>
          {result!.files!.map((file, i) => (
            <FileCard key={`${file.name}-${i}`} file={file} />
          ))}
        </div>
      ) : null}

      {showCode && (
        <pre className='bg-muted/40 max-h-60 overflow-auto rounded-lg border p-2.5 text-xs'>
          <code className='font-mono'>{code}</code>
        </pre>
      )}

      {result?.stdout && showLog ? (
        <pre className='bg-muted/50 max-h-48 overflow-auto rounded-lg p-2 text-xs whitespace-pre-wrap'>
          {result.stdout}
        </pre>
      ) : null}

      {status === 'error' && (
        <div className='text-destructive flex items-start gap-1.5 text-xs'>
          <AlertCircle className='mt-0.5 size-3.5 shrink-0' />
          <span className='whitespace-pre-wrap'>{errMsg}</span>
        </div>
      )}
    </div>
  )
}
