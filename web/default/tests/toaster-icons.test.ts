import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const toasterSource = readFileSync(
  new URL('../src/components/ui/sonner.tsx', import.meta.url),
  'utf8'
)
const rootSource = readFileSync(
  new URL('../src/routes/__root.tsx', import.meta.url),
  'utf8'
)

test('error toasts distinguish the status icon from the close action', () => {
  expect(toasterSource).toContain('AlertCircleIcon')
  expect(toasterSource).not.toContain('MultiplicationSignCircleIcon')
  expect(rootSource).toContain('<Toaster closeButton')
})
