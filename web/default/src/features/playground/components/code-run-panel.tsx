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
import { AlertCircle, Download, FileText, Loader2, Play } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { executeCode } from '../api'
import type { ExecuteResponse, ExecutionFile } from '../types'

type RunStatus = 'idle' | 'running' | 'done' | 'error'

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

export function CodeRunPanel({ code }: { code: string }) {
  const { t } = useTranslation()
  const [status, setStatus] = useState<RunStatus>('idle')
  const [result, setResult] = useState<ExecuteResponse | null>(null)
  const [errMsg, setErrMsg] = useState('')
  const [showCode, setShowCode] = useState(false)

  const run = async () => {
    setStatus('running')
    setErrMsg('')
    try {
      const res = await executeCode(code, 'python')
      setResult(res)
      setStatus(res.ok && !res.error ? 'done' : 'error')
      if (res.error) setErrMsg(errorText(res.error))
      else if (!res.ok) setErrMsg(t('Execution failed'))
    } catch (e) {
      const err = e as { response?: { data?: { error?: string } }; message?: string }
      setStatus('error')
      setErrMsg(err?.response?.data?.error || err?.message || t('Execution failed'))
    }
  }

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

  return (
    <div className='mt-2 space-y-3 rounded-xl border p-3'>
      <div className='flex items-center justify-between'>
        <span className='text-muted-foreground text-xs font-medium'>
          {t('Sandbox output')}
        </span>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          onClick={run}
          className='h-7 gap-1.5 text-xs'
        >
          <Play className='size-3' />
          {t('Re-run')}
        </Button>
      </div>

      {result?.files?.length ? (
        <div className='grid items-start gap-2 sm:grid-cols-2'>
          {result.files.map((file, i) => (
            <FileCard key={`${file.name}-${i}`} file={file} />
          ))}
        </div>
      ) : null}

      {result?.stdout ? (
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
