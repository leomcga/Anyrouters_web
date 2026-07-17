import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const i18nSource = readFileSync(
  new URL('../src/i18n/config.ts', import.meta.url),
  'utf8'
)
const mainSource = readFileSync(
  new URL('../src/main.tsx', import.meta.url),
  'utf8'
)
const landingSource = readFileSync(
  new URL('../src/features/landing/index.tsx', import.meta.url),
  'utf8'
)
const systemConfigSource = readFileSync(
  new URL('../src/hooks/use-system-config.ts', import.meta.url),
  'utf8'
)
const chatHistorySource = readFileSync(
  new URL(
    '../src/features/playground/components/chat-history.tsx',
    import.meta.url
  ),
  'utf8'
)
const lobeIconSource = readFileSync(
  new URL('../src/lib/lobe-icon.tsx', import.meta.url),
  'utf8'
)

test('initial render loads only the active locale instead of all six locales', () => {
  expect(i18nSource).toContain('export async function initializeI18n')
  expect(i18nSource).toContain('import(`./locales/${language}.json`)')
  expect(i18nSource).not.toMatch(/import\s+\w+\s+from\s+'\.\/locales\//)
  expect(mainSource).toContain('await initializeI18n()')
})

test('landing imports only the provider icons it renders', () => {
  expect(landingSource).not.toContain("from '@/lib/lobe-icon'")
  expect(landingSource).not.toContain("from '@lobehub/icons'")
  expect(landingSource).toContain("from '@lobehub/icons/es/OpenAI'")
})

test('startup status consumers share the cached status request', () => {
  expect(systemConfigSource).toContain("import { getStatus } from '@/lib/api'")
  expect(systemConfigSource).not.toContain("fetch('/api/status')")
})

test('playground history is allowed to shrink inside its flex column', () => {
  expect(chatHistorySource).toContain(
    "<ScrollArea className='min-h-0 flex-1'>"
  )
})

test('shared icon helper loads only the requested Lobe icon module', () => {
  expect(lobeIconSource).not.toContain(
    "import * as LobeIcons from '@lobehub/icons'"
  )
  expect(lobeIconSource).toContain("require.context(")
  expect(lobeIconSource).toContain("'@lobehub/icons/es'")
  expect(lobeIconSource).toContain("'lazy'")
})
