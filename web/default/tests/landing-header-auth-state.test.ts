import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(
  new URL('../src/features/landing/index.tsx', import.meta.url),
  'utf8'
)
const contentSource = readFileSync(
  new URL('../src/features/landing/content.ts', import.meta.url),
  'utf8'
)
const brandSource = readFileSync(
  new URL(
    '../src/features/landing/components/brand-logo.tsx',
    import.meta.url
  ),
  'utf8'
)
const htmlSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const rsbuildSource = readFileSync(
  new URL('../rsbuild.config.ts', import.meta.url),
  'utf8'
)
const styleSource = readFileSync(
  new URL('../src/styles/landing-classic-sync.css', import.meta.url),
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

test('landing keeps one hero action and the shared brand assets', () => {
  expect(source).toContain('{c.hero.primaryCta}')
  expect(source).not.toContain('{c.hero.secondaryCta}')
  expect(contentSource).not.toContain('secondaryCta')
  expect(brandSource).toContain("src='/anyrouters-mark-transparent.png'")
  expect(rsbuildSource).toContain(
    "favicon: './public/anyrouters-tab-icon-v1.png'"
  )
  expect(rsbuildSource).not.toContain("favicon: './public/favicon.ico'")
  expect(htmlSource).not.toContain('rel="icon"')
  expect(htmlSource).toContain('/apple-touch-icon.png?v=4')
  expect(htmlSource).not.toContain('data:image/svg+xml')
})

test('landing switches the full console preview to tablet layout by 1024px', () => {
  expect(styleSource.match(/@media \(max-width: 1024px\)/g)?.length).toBe(2)
  expect(styleSource).not.toContain('@media (max-width: 860px)')
})
