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
// Client-side file export engine for the playground.
//
// Design: everything runs in the browser (Blob + <a download>), no backend.
// The heavy generators (docx / xlsx / pdf) and their libraries are loaded
// lazily via dynamic import() so they never enter the main bundle — a user
// only pays the download cost when they actually export to that format.
// Plain-text formats (md/txt/csv/json/html) are zero-dependency and always
// available.

/** File formats we can generate entirely in the browser. */
export type ExportFormat =
  | 'txt'
  | 'md'
  | 'csv'
  | 'json'
  | 'html'
  | 'docx'
  | 'xlsx'
  | 'pdf'

const MIME: Record<ExportFormat, string> = {
  txt: 'text/plain;charset=utf-8',
  md: 'text/markdown;charset=utf-8',
  csv: 'text/csv;charset=utf-8',
  json: 'application/json;charset=utf-8',
  html: 'text/html;charset=utf-8',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
}

/** Trigger a browser download for a Blob / string with the given filename. */
export function downloadBlob(data: BlobPart, filename: string, mime: string) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Reclaim the object URL on the next tick (after the click is processed).
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Turn an arbitrary title into a safe, short filename stem (keeps CJK). */
export function safeFileStem(title: string, fallback = 'export'): string {
  const cleaned = (title || '')
    .replace(/[\\/:*?"<>|\n\r\t]+/g, ' ') // strip path/OS-illegal chars
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40)
  return cleaned || fallback
}

// ---------------------------------------------------------------------------
// Zero-dependency text formats
// ---------------------------------------------------------------------------

/** Download plain text content as .txt/.md/.json/.html/.csv. */
export function exportText(
  content: string,
  filename: string,
  format: Extract<ExportFormat, 'txt' | 'md' | 'csv' | 'json' | 'html'>
) {
  downloadBlob(content, filename, MIME[format])
}

/** Map a code-fence language id to a sensible file extension. */
export function extensionForLanguage(lang: string | undefined): string {
  const l = (lang || '').toLowerCase().trim()
  const map: Record<string, string> = {
    javascript: 'js',
    js: 'js',
    jsx: 'jsx',
    typescript: 'ts',
    ts: 'ts',
    tsx: 'tsx',
    python: 'py',
    py: 'py',
    ruby: 'rb',
    rb: 'rb',
    golang: 'go',
    go: 'go',
    rust: 'rs',
    rs: 'rs',
    java: 'java',
    kotlin: 'kt',
    swift: 'swift',
    'c++': 'cpp',
    cpp: 'cpp',
    cxx: 'cpp',
    c: 'c',
    'c#': 'cs',
    csharp: 'cs',
    cs: 'cs',
    php: 'php',
    shell: 'sh',
    bash: 'sh',
    sh: 'sh',
    zsh: 'sh',
    powershell: 'ps1',
    ps1: 'ps1',
    sql: 'sql',
    html: 'html',
    xml: 'xml',
    css: 'css',
    scss: 'scss',
    json: 'json',
    yaml: 'yaml',
    yml: 'yml',
    toml: 'toml',
    markdown: 'md',
    md: 'md',
    dockerfile: 'Dockerfile',
    makefile: 'Makefile',
    r: 'r',
    lua: 'lua',
    dart: 'dart',
    scala: 'scala',
    perl: 'pl',
    text: 'txt',
    plaintext: 'txt',
  }
  return map[l] || 'txt'
}

/** Download a single code block with the extension matching its language. */
export function exportCode(
  code: string,
  language: string | undefined,
  stem = 'snippet'
) {
  const ext = extensionForLanguage(language)
  // Dockerfile/Makefile are conventionally extension-less filenames.
  const name = ext === 'Dockerfile' || ext === 'Makefile' ? ext : `${stem}.${ext}`
  downloadBlob(code, name, 'text/plain;charset=utf-8')
}

// ---------------------------------------------------------------------------
// Tabular export (CSV / XLSX) — from a parsed { headers, rows } table
// ---------------------------------------------------------------------------

export interface TableData {
  headers: string[]
  rows: string[][]
}

function csvCell(v: string): string {
  const s = v ?? ''
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Serialize a table to CSV text (RFC-4180-ish). Prepends UTF-8 BOM so Excel
 *  opens CJK correctly. */
export function tableToCsv(data: TableData): string {
  const lines = [data.headers, ...data.rows].map((row) =>
    row.map(csvCell).join(',')
  )
  return '﻿' + lines.join('\r\n')
}

export function exportTableCsv(data: TableData, stem = 'table') {
  downloadBlob(tableToCsv(data), `${stem}.csv`, MIME.csv)
}

/** Export a table to a real .xlsx workbook (lazy-loads exceljs). */
export async function exportTableXlsx(data: TableData, stem = 'table') {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Sheet1')
  ws.addRow(data.headers)
  data.rows.forEach((r) => ws.addRow(r))
  // Bold header row.
  ws.getRow(1).font = { bold: true }
  // Auto-ish column widths from content length (capped).
  ws.columns.forEach((col, i) => {
    const cells = [data.headers[i], ...data.rows.map((r) => r[i] ?? '')]
    const max = Math.max(...cells.map((c) => String(c ?? '').length), 8)
    col.width = Math.min(max + 2, 60)
  })
  const buf = await wb.xlsx.writeBuffer()
  downloadBlob(new Blob([buf], { type: MIME.xlsx }), `${stem}.xlsx`, MIME.xlsx)
}

// ---------------------------------------------------------------------------
// Markdown → document (DOCX / PDF)
// ---------------------------------------------------------------------------

// We tokenize markdown with `marked` (lazy) into a flat block list, then map
// blocks onto docx / pdf primitives. This is intentionally a pragmatic subset
// (headings, paragraphs w/ inline emphasis+code+links, lists, blockquotes,
// code blocks, tables, hr) — enough for chat answers, not a full typesetter.

type InlineRun = { text: string; bold?: boolean; italic?: boolean; code?: boolean }

type DocBlock =
  | { type: 'heading'; level: number; runs: InlineRun[] }
  | { type: 'paragraph'; runs: InlineRun[] }
  | { type: 'list'; ordered: boolean; items: InlineRun[][] }
  | { type: 'code'; text: string; lang?: string }
  | { type: 'quote'; runs: InlineRun[] }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'hr' }

// Flatten marked's inline tokens into styled runs.
function inlineRuns(tokens: any[] | undefined, inherited: Partial<InlineRun> = {}): InlineRun[] {
  if (!tokens) return []
  const runs: InlineRun[] = []
  for (const tok of tokens) {
    switch (tok.type) {
      case 'text':
        // `text` tokens may themselves carry nested inline tokens (e.g. inside
        // list items); recurse when present.
        if (tok.tokens?.length) runs.push(...inlineRuns(tok.tokens, inherited))
        else runs.push({ text: tok.text ?? '', ...inherited })
        break
      case 'strong':
        runs.push(...inlineRuns(tok.tokens, { ...inherited, bold: true }))
        break
      case 'em':
        runs.push(...inlineRuns(tok.tokens, { ...inherited, italic: true }))
        break
      case 'codespan':
        runs.push({ text: tok.text ?? '', ...inherited, code: true })
        break
      case 'link':
        // Render link text; append URL in parens so it survives in print.
        runs.push(...inlineRuns(tok.tokens, inherited))
        if (tok.href) runs.push({ text: ` (${tok.href})`, ...inherited })
        break
      case 'br':
        runs.push({ text: '\n', ...inherited })
        break
      case 'del':
        runs.push(...inlineRuns(tok.tokens, inherited))
        break
      case 'image':
        // Images can't be inlined from markdown text here; note the alt.
        if (tok.text) runs.push({ text: `[${tok.text}]`, ...inherited })
        break
      default:
        if (tok.tokens?.length) runs.push(...inlineRuns(tok.tokens, inherited))
        else if (typeof tok.text === 'string') runs.push({ text: tok.text, ...inherited })
    }
  }
  return runs
}

function cellText(tokens: any): string {
  return inlineRuns(tokens).map((r) => r.text).join('')
}

async function markdownToBlocks(md: string): Promise<DocBlock[]> {
  const { marked } = await import('marked')
  const tokens = marked.lexer(md || '')
  const blocks: DocBlock[] = []
  for (const tok of tokens as any[]) {
    switch (tok.type) {
      case 'heading':
        blocks.push({ type: 'heading', level: tok.depth, runs: inlineRuns(tok.tokens) })
        break
      case 'paragraph':
        blocks.push({ type: 'paragraph', runs: inlineRuns(tok.tokens) })
        break
      case 'text':
        blocks.push({ type: 'paragraph', runs: inlineRuns(tok.tokens ?? [{ type: 'text', text: tok.text }]) })
        break
      case 'code':
        blocks.push({ type: 'code', text: tok.text ?? '', lang: tok.lang })
        break
      case 'blockquote':
        blocks.push({ type: 'quote', runs: inlineRuns(tok.tokens?.flatMap((t: any) => t.tokens ?? []) ) })
        break
      case 'list':
        blocks.push({
          type: 'list',
          ordered: !!tok.ordered,
          items: (tok.items ?? []).map((it: any) => inlineRuns(it.tokens?.flatMap((t: any) => t.tokens ?? t) ?? [])),
        })
        break
      case 'table':
        blocks.push({
          type: 'table',
          headers: (tok.header ?? []).map((h: any) => cellText(h.tokens)),
          rows: (tok.rows ?? []).map((row: any[]) => row.map((c) => cellText(c.tokens))),
        })
        break
      case 'hr':
        blocks.push({ type: 'hr' })
        break
      case 'space':
        break
      default:
        if (typeof tok.raw === 'string' && tok.raw.trim())
          blocks.push({ type: 'paragraph', runs: [{ text: tok.raw.trim() }] })
    }
  }
  return blocks
}

/** Export markdown as a .docx (lazy-loads the `docx` library). */
export async function exportMarkdownDocx(md: string, stem = 'document') {
  const blocks = await markdownToBlocks(md)
  const docx = await import('docx')
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
    Table,
    TableRow,
    TableCell,
    WidthType,
    BorderStyle,
  } = docx

  const headingLevels = [
    HeadingLevel.HEADING_1,
    HeadingLevel.HEADING_2,
    HeadingLevel.HEADING_3,
    HeadingLevel.HEADING_4,
    HeadingLevel.HEADING_5,
    HeadingLevel.HEADING_6,
  ]

  const toRuns = (runs: InlineRun[]) =>
    runs.flatMap((r) =>
      r.text.split('\n').flatMap((line, i) => {
        const parts: any[] = []
        if (i > 0) parts.push(new TextRun({ break: 1 }))
        parts.push(
          new TextRun({
            text: line,
            bold: r.bold,
            italics: r.italic,
            font: r.code ? 'Consolas' : undefined,
          })
        )
        return parts
      })
    )

  const children: any[] = []
  for (const b of blocks) {
    switch (b.type) {
      case 'heading':
        children.push(
          new Paragraph({
            heading: headingLevels[Math.min(b.level, 6) - 1],
            children: toRuns(b.runs),
          })
        )
        break
      case 'paragraph':
        children.push(new Paragraph({ children: toRuns(b.runs) }))
        break
      case 'quote':
        children.push(
          new Paragraph({ style: 'IntenseQuote', children: toRuns(b.runs) })
        )
        break
      case 'list':
        b.items.forEach((item, idx) =>
          children.push(
            new Paragraph({
              children: b.ordered
                ? [new TextRun(`${idx + 1}. `), ...toRuns(item)]
                : toRuns(item),
              bullet: b.ordered ? undefined : { level: 0 },
              indent: b.ordered ? { left: 360 } : undefined,
            })
          )
        )
        break
      case 'code':
        // One paragraph per line, monospace, so long code doesn't overflow.
        b.text.split('\n').forEach((line) =>
          children.push(
            new Paragraph({
              children: [new TextRun({ text: line || ' ', font: 'Consolas', size: 18 })],
              shading: { fill: 'F5F5F5' },
            })
          )
        )
        break
      case 'table': {
        const border = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' }
        const borders = { top: border, bottom: border, left: border, right: border }
        const mkRow = (cells: string[], bold: boolean) =>
          new TableRow({
            children: cells.map(
              (c) =>
                new TableCell({
                  borders,
                  children: [
                    new Paragraph({ children: [new TextRun({ text: c, bold })] }),
                  ],
                })
            ),
          })
        children.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [mkRow(b.headers, true), ...b.rows.map((r) => mkRow(r, false))],
          })
        )
        break
      }
      case 'hr':
        children.push(new Paragraph({ text: '', border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC' } } }))
        break
    }
  }

  const doc = new Document({ sections: [{ children }] })
  const blob = await Packer.toBlob(doc)
  downloadBlob(blob, `${stem}.docx`, MIME.docx)
}

// --- PDF ---------------------------------------------------------------------

// pdf-lib's built-in fonts are Latin-only (WinAnsi) and would render CJK as
// blanks/garbage. We embed Noto Sans SC, which also carries Latin glyphs so one
// family covers 中英混排.
//
// IMPORTANT font strategy (learned the hard way): pdf-lib's fontkit *subsetter*
// mangles/drops glyphs on large CJK fonts (verified: subset:true renders tofu
// or missing chars). So instead we:
//   1. ship the FULL static font (~10MB) at /fonts, fetched once and cached;
//   2. at export time, subset it with HarfBuzz (font-subset.ts) down to only
//      the characters this document uses — correct even for rare hanzi;
//   3. embed that tiny subset with pdf-lib `subset:false` (no further, buggy
//      subsetting), which renders 100% correctly.
// Net: full character coverage AND a tiny PDF (a few KB of font per document).
let fontCache: { regular: ArrayBuffer; bold: ArrayBuffer } | null = null

// The full fonts are stored gzip-compressed (~6MB each vs ~10MB) to keep the
// repo/image lean. Whether the bytes arrive still-compressed depends on the
// server: some (dev server, nginx gzip_static) transparently decompress `.gz`
// and set Content-Encoding, others serve the raw gzip. So we don't assume —
// we sniff the gzip magic (1f 8b) and only decompress when needed. Fetched
// once and cached.
async function loadPdfFonts(): Promise<{ regular: ArrayBuffer; bold: ArrayBuffer }> {
  if (fontCache) return fontCache
  const base = `${import.meta.env.BASE_URL || '/'}fonts`.replace(/\/+/g, '/')
  const grab = async (name: string) => {
    const r = await fetch(`${base}/${name}`)
    if (!r.ok) throw new Error(`font load failed: ${name}`)
    const raw = await r.arrayBuffer()
    const head = new Uint8Array(raw, 0, 2)
    // Already decompressed by the server (sfnt/ttf), use as-is.
    if (!(head[0] === 0x1f && head[1] === 0x8b)) return raw
    // Raw gzip — decompress with the browser-native DecompressionStream.
    const stream = new Response(raw).body!.pipeThrough(
      new DecompressionStream('gzip')
    )
    return new Response(stream).arrayBuffer()
  }
  const [regular, bold] = await Promise.all([
    grab('NotoSansSC-Regular.ttf.gz'),
    grab('NotoSansSC-Bold.ttf.gz'),
  ])
  fontCache = { regular, bold }
  return fontCache
}

// Collect every character that will be drawn, so HarfBuzz can subset the font
// to exactly this set. We over-collect (all runs + punctuation) — cheap and
// guarantees nothing is missing.
function collectChars(blocks: DocBlock[]): string {
  let s = ''
  for (const b of blocks) {
    switch (b.type) {
      case 'heading':
      case 'paragraph':
      case 'quote':
        s += b.runs.map((r) => r.text).join('')
        break
      case 'list':
        s += b.items.map((it) => it.map((r) => r.text).join('')).join('')
        s += '•0123456789. '
        break
      case 'code':
        s += b.text
        break
      case 'table':
        s += b.headers.join('') + b.rows.map((r) => r.join('')).join('')
        s += ' | '
        break
    }
  }
  return s
}

/** Export markdown as a .pdf (lazy-loads pdf-lib + fontkit + HarfBuzz + fonts). */
export async function exportMarkdownPdf(md: string, stem = 'document') {
  const blocks = await markdownToBlocks(md)
  const { PDFDocument, rgb } = await import('pdf-lib')
  const fontkit = (await import('@pdf-lib/fontkit')).default
  const { subsetFontForText } = await import('./font-subset')
  const fonts = await loadPdfFonts()

  // Subset the full fonts to exactly the characters this document uses, then
  // embed with subset:false (pdf-lib's own subsetter is buggy on CJK). This is
  // what keeps the PDF tiny while covering any character, including rare hanzi.
  const used = collectChars(blocks)
  const [regularSub, boldSub] = await Promise.all([
    subsetFontForText(fonts.regular, used),
    subsetFontForText(fonts.bold, used),
  ])

  const pdf = await PDFDocument.create()
  pdf.registerFontkit(fontkit)
  const font = await pdf.embedFont(regularSub, { subset: false })
  const fontBold = await pdf.embedFont(boldSub, { subset: false })

  const MARGIN = 56
  const PAGE_W = 595.28 // A4 portrait
  const PAGE_H = 841.89
  const MAX_W = PAGE_W - MARGIN * 2
  let page = pdf.addPage([PAGE_W, PAGE_H])
  let y = PAGE_H - MARGIN

  const newPage = () => {
    page = pdf.addPage([PAGE_W, PAGE_H])
    y = PAGE_H - MARGIN
  }
  const ensure = (h: number) => {
    if (y - h < MARGIN) newPage()
  }

  // Word-wrap a string to MAX_W at the given size (CJK wraps per-char since it
  // has no spaces; Latin wraps per-word).
  const wrap = (text: string, size: number, f: typeof font, width = MAX_W): string[] => {
    const lines: string[] = []
    for (const rawLine of text.split('\n')) {
      const tokens = rawLine.match(/[　-鿿＀-￯]|[^\s　-鿿＀-￯]+|\s+/g) || ['']
      let cur = ''
      const push = () => { lines.push(cur); cur = '' }
      for (const tk of tokens) {
        const trial = cur + tk
        if (f.widthOfTextAtSize(trial, size) > width && cur) {
          push()
          cur = tk.trimStart()
        } else {
          cur = trial
        }
      }
      push()
    }
    return lines
  }

  const drawText = (
    text: string,
    { size = 11, bold = false, indent = 0, color = rgb(0, 0, 0), gap = 4, mono = false } = {}
  ) => {
    const f = bold ? fontBold : font
    const lineH = size * 1.5
    for (const line of wrap(text, size, f, MAX_W - indent)) {
      ensure(lineH)
      page.drawText(line, {
        x: MARGIN + indent,
        y: y - size,
        size,
        font: f,
        color,
        // mono blocks get a subtle background box drawn first
      })
      if (mono) {
        // no-op background here; keep simple + reliable
      }
      y -= lineH
    }
    y -= gap
  }

  const runsToText = (runs: InlineRun[]) => runs.map((r) => r.text).join('')

  for (const b of blocks) {
    switch (b.type) {
      case 'heading': {
        const size = [20, 17, 15, 13, 12, 11][Math.min(b.level, 6) - 1]
        y -= 4
        drawText(runsToText(b.runs), { size, bold: true, gap: 6 })
        break
      }
      case 'paragraph':
        drawText(runsToText(b.runs), { size: 11, gap: 6 })
        break
      case 'quote':
        drawText(runsToText(b.runs), { size: 11, indent: 16, color: rgb(0.35, 0.35, 0.35), gap: 6 })
        break
      case 'list':
        b.items.forEach((item, idx) => {
          const prefix = b.ordered ? `${idx + 1}. ` : '• '
          drawText(prefix + runsToText(item), { size: 11, indent: 14, gap: 2 })
        })
        y -= 4
        break
      case 'code':
        drawText(b.text, { size: 9.5, indent: 8, color: rgb(0.15, 0.15, 0.15), gap: 6, mono: true })
        break
      case 'table': {
        // Render each row as a tab-ish joined line (simple, dependency-free).
        drawText(b.headers.join('   |   '), { size: 10.5, bold: true, gap: 2 })
        b.rows.forEach((r) => drawText(r.join('   |   '), { size: 10.5, gap: 2 }))
        y -= 4
        break
      }
      case 'hr':
        ensure(12)
        page.drawLine({
          start: { x: MARGIN, y: y - 4 },
          end: { x: PAGE_W - MARGIN, y: y - 4 },
          thickness: 0.5,
          color: rgb(0.8, 0.8, 0.8),
        })
        y -= 12
        break
    }
  }

  const bytes = await pdf.save()
  downloadBlob(new Blob([bytes], { type: MIME.pdf }), `${stem}.pdf`, MIME.pdf)
}

/** High-level: export a whole message's markdown to the chosen document format. */
export async function exportMessage(
  markdown: string,
  format: Extract<ExportFormat, 'md' | 'docx' | 'pdf' | 'txt' | 'html'>,
  stem = 'message'
) {
  switch (format) {
    case 'md':
      return exportText(markdown, `${stem}.md`, 'md')
    case 'txt':
      return exportText(markdown, `${stem}.txt`, 'txt')
    case 'html':
      return exportText(markdown, `${stem}.html`, 'html')
    case 'docx':
      return exportMarkdownDocx(markdown, stem)
    case 'pdf':
      return exportMarkdownPdf(markdown, stem)
  }
}
