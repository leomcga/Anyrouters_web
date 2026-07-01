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

import { useRef, useState, type ReactNode } from 'react'
import { Copy, Check, FileSpreadsheet, FileText } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  exportTableCsv,
  exportTableXlsx,
  tableToCsv,
  type TableData,
} from '../lib/file-export'

// Replaces Streamdown's default <table> renderer: renders the same table but
// adds a small export bar (copy TSV, download CSV, download XLSX) — like the
// table controls in ChatGPT/Claude. Table data is read from the rendered DOM
// on demand (robust against arbitrary inline markdown inside cells).

function readTableFromDom(el: HTMLTableElement | null): TableData {
  if (!el) return { headers: [], rows: [] }
  const headers: string[] = []
  const rows: string[][] = []
  const headEl = el.querySelector('thead')
  if (headEl) {
    headEl.querySelectorAll('th,td').forEach((c) =>
      headers.push((c.textContent ?? '').trim())
    )
  }
  const bodyRows = el.querySelectorAll('tbody tr')
  bodyRows.forEach((tr) => {
    const row: string[] = []
    tr.querySelectorAll('th,td').forEach((c) =>
      row.push((c.textContent ?? '').trim())
    )
    rows.push(row)
  })
  // Fallback: no thead/tbody split — treat first row as header.
  if (!headers.length && !rows.length) {
    const allRows = Array.from(el.querySelectorAll('tr'))
    allRows.forEach((tr, i) => {
      const cells = Array.from(tr.querySelectorAll('th,td')).map((c) =>
        (c.textContent ?? '').trim()
      )
      if (i === 0) headers.push(...cells)
      else rows.push(cells)
    })
  }
  return { headers, rows }
}

export function MarkdownTable({
  children,
  className,
}: {
  children?: ReactNode
  className?: string
}) {
  const { t } = useTranslation()
  const ref = useRef<HTMLTableElement>(null)
  const [copied, setCopied] = useState(false)

  const stem = 'table'

  const copyTsv = async () => {
    const data = readTableFromDom(ref.current)
    // TSV pastes cleanly into Excel/Sheets/WeChat.
    const tsv = [data.headers, ...data.rows]
      .map((r) => r.join('\t'))
      .join('\n')
    try {
      await navigator.clipboard.writeText(tsv)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fall back to CSV text if clipboard rejects
      await navigator.clipboard.writeText(tableToCsv(data)).catch(() => {})
    }
  }

  const downloadCsv = () => exportTableCsv(readTableFromDom(ref.current), stem)

  const downloadXlsx = async () => {
    try {
      await exportTableXlsx(readTableFromDom(ref.current), stem)
    } catch {
      toast.error(t('Export failed'))
    }
  }

  return (
    <div className='group/table my-4'>
      <div className='mb-1 flex items-center justify-end gap-1'>
        <button
          type='button'
          onClick={copyTsv}
          className='text-muted-foreground hover:text-foreground hover:bg-muted flex items-center gap-1 rounded px-1.5 py-0.5 text-xs'
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
          onClick={downloadCsv}
          className='text-muted-foreground hover:text-foreground hover:bg-muted flex items-center gap-1 rounded px-1.5 py-0.5 text-xs'
          title={t('Export to CSV')}
        >
          <FileText className='size-3.5' />
          <span>CSV</span>
        </button>
        <button
          type='button'
          onClick={downloadXlsx}
          className='text-muted-foreground hover:text-foreground hover:bg-muted flex items-center gap-1 rounded px-1.5 py-0.5 text-xs'
          title={t('Export to Excel')}
        >
          <FileSpreadsheet className='size-3.5' />
          <span>Excel</span>
        </button>
      </div>
      <div className='overflow-x-auto'>
        <table ref={ref} className={className}>
          {children}
        </table>
      </div>
    </div>
  )
}
