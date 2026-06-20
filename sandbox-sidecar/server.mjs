// AnyRouters sandbox sidecar.
//
// A tiny HTTP service that runs model-generated code in an E2B sandbox and
// returns stdout/stderr plus any files the code produced. The new-api Go
// backend calls POST /execute behind an internal shared secret; it is never
// exposed to end users directly.
//
// Env:
//   E2B_API_KEY        - E2B api key (required)
//   INTERNAL_SECRET    - shared secret the Go backend must present (required)
//   PORT               - listen port (Cloud Run sets this; default 8080)
//   MAX_FILE_BYTES     - per-file cap for harvested outputs (default 10 MiB)
//   MAX_FILES          - max number of files returned (default 8)
//   EXEC_TIMEOUT_MS    - hard cap on a single code run (default 120000)

import express from 'express'
import { Sandbox } from '@e2b/code-interpreter'

const E2B_API_KEY = process.env.E2B_API_KEY
const INTERNAL_SECRET = process.env.INTERNAL_SECRET
const PORT = parseInt(process.env.PORT || '8080', 10)
const MAX_FILE_BYTES = parseInt(process.env.MAX_FILE_BYTES || String(10 * 1024 * 1024), 10)
const MAX_FILES = parseInt(process.env.MAX_FILES || '8', 10)
const EXEC_TIMEOUT_MS = parseInt(process.env.EXEC_TIMEOUT_MS || '120000', 10)

const WORK_DIR = '/home/user'

if (!E2B_API_KEY) throw new Error('E2B_API_KEY is required')
if (!INTERNAL_SECRET) throw new Error('INTERNAL_SECRET is required')

const EXT_MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp',
  pdf: 'application/pdf', csv: 'text/csv', txt: 'text/plain',
  json: 'application/json', md: 'text/markdown', html: 'text/html',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip', parquet: 'application/octet-stream',
}

function mimeFor(name) {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  return EXT_MIME[ext] || 'application/octet-stream'
}

// Python that emits a JSON manifest of every file under WORK_DIR with mtime+size.
// Used to diff the filesystem before/after the user's code runs so we only
// return files the run actually created or modified.
const MANIFEST_CODE = `
import os, json
root = ${JSON.stringify(WORK_DIR)}
out = []
for dp, dn, fn in os.walk(root):
    # skip hidden/system dirs (.cache, .config, .ipython, ...)
    dn[:] = [d for d in dn if not d.startswith('.')]
    for f in fn:
        if f.startswith('.'):
            continue
        p = os.path.join(dp, f)
        try:
            st = os.stat(p)
            out.append([p, st.st_mtime, st.st_size])
        except OSError:
            pass
print(json.dumps(out))
`

function parseManifest(stdout) {
  const map = new Map()
  if (!stdout) return map
  const line = stdout.trim().split('\n').filter(Boolean).pop()
  try {
    for (const [p, mtime, size] of JSON.parse(line)) map.set(p, { mtime, size })
  } catch {
    // ignore malformed manifest; treated as empty baseline
  }
  return map
}

const app = express()
app.use(express.json({ limit: '2mb' }))

app.get('/health', (_req, res) => res.json({ ok: true }))

app.post('/execute', async (req, res) => {
  if (req.get('x-internal-secret') !== INTERNAL_SECRET) {
    return res.status(401).json({ ok: false, error: 'unauthorized' })
  }

  const { code, language = 'python' } = req.body || {}
  if (typeof code !== 'string' || !code.trim()) {
    return res.status(400).json({ ok: false, error: 'code is required' })
  }

  let sbx
  const started = Date.now()
  const lap = (m) => console.log(`[${Date.now() - started}ms] ${m}`)
  try {
    sbx = await Sandbox.create({ apiKey: E2B_API_KEY })
    lap('sandbox created ' + sbx.sandboxId)

    // Run the user's code. A fresh sandbox's /home/user is empty, so every
    // non-hidden file present afterwards was produced by this run — no need
    // for a before/after diff. requestTimeoutMs is generous because the first
    // import of heavy libs (matplotlib/pandas) in a cold sandbox is slow.
    const exec = await sbx.runCode(code, {
      language,
      timeoutMs: EXEC_TIMEOUT_MS,
      requestTimeoutMs: EXEC_TIMEOUT_MS,
    })
    lap('user code done')

    const stdout = exec.logs.stdout.join('')
    const stderr = exec.logs.stderr.join('')
    const runError = exec.error
      ? { name: exec.error.name, value: exec.error.value, traceback: exec.error.traceback }
      : null

    // Collect files: (1) everything under /home/user, (2) rich results (charts).
    const files = []

    if (language === 'python') {
      const after = await sbx.runCode(MANIFEST_CODE, { language: 'python', requestTimeoutMs: 30000 })
      const current = parseManifest(after.logs.stdout.join(''))
      lap('manifest done, ' + current.size + ' files')
      const found = [...current.entries()].map(([p, meta]) => ({ p, size: meta.size }))
      found.sort((a, b) => a.size - b.size) // prefer returning the smaller files first
      for (const { p, size } of found) {
        if (files.length >= MAX_FILES) break
        if (size > MAX_FILE_BYTES) {
          files.push({ name: p.split('/').pop(), path: p, mime: mimeFor(p), size, truncated: true })
          continue
        }
        try {
          const bytes = await sbx.files.read(p, { format: 'bytes', requestTimeoutMs: 30000 })
          const buf = Buffer.from(bytes)
          files.push({ name: p.split('/').pop(), path: p, mime: mimeFor(p), size: buf.length, b64: buf.toString('base64') })
        } catch {
          // file vanished or unreadable; skip
        }
      }
      lap('files harvested: ' + files.length)
    }

    // Rich results: inline images (e.g. matplotlib plt.show()) the kernel
    // captured. Only include these when the run did not already write image
    // files to disk, to avoid showing the same chart two or three times.
    const hasImageFile = files.some((f) => f.mime.startsWith('image/'))
    let chartIdx = 0
    if (!hasImageFile) {
      for (const r of exec.results || []) {
        if (files.length >= MAX_FILES) break
        if (r.png) {
          const buf = Buffer.from(r.png, 'base64')
          if (buf.length <= MAX_FILE_BYTES) {
            files.push({ name: `chart-${++chartIdx}.png`, mime: 'image/png', size: buf.length, b64: r.png, rich: true })
          }
        }
      }
    }

    res.json({ ok: true, stdout, stderr, error: runError, files, elapsed_ms: Date.now() - started })
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err?.message || err), elapsed_ms: Date.now() - started })
  } finally {
    if (sbx) { try { await sbx.kill() } catch { /* best effort */ } }
  }
})

app.listen(PORT, () => console.log(`sandbox-sidecar listening on :${PORT}`))
