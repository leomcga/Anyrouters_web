import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(
  new URL('../src/features/landing/index.tsx', import.meta.url),
  'utf8'
)

test('landing header exposes the expected signed-out actions', () => {
  expect(source).toContain("to='/sign-in'")
  expect(source).toContain("to='/sign-up'")
  expect(source).toContain('<LanguageSwitcher />')
})

test('landing header exposes the expected signed-in actions', () => {
  expect(source).toContain("to='/dashboard'")
  expect(source).toContain('<ProfileDropdown />')
  expect(source).toContain('{isAuthenticated ? (')
})

test('landing keeps AnyRouters branding and production API domain', () => {
  expect(source).toContain("document.title = 'AnyRouters'")
  expect(source).toContain('https://api.anyrouters.com')
  expect(source).not.toContain('AllRouters')
  expect(source).not.toContain('api.allrouters.com')
})

test('landing preserves the protected New API attribution', () => {
  expect(source).toContain('https://github.com/QuantumNous/new-api')
  expect(source).toContain('New API')
  expect(source).toContain('<LandingFooter c={c} />')
})
