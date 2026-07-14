import { describe, expect, test } from 'bun:test'
import { safeInternalRedirect } from '../src/lib/web-security'

const origin = 'https://app.example.com'

describe('safeInternalRedirect', () => {
  test('accepts same-origin paths and absolute URLs', () => {
    expect(safeInternalRedirect('/wallet?tab=history', '/dashboard', origin)).toBe(
      '/wallet?tab=history'
    )
    expect(
      safeInternalRedirect(
        'https://app.example.com/profile#keys',
        '/dashboard',
        origin
      )
    ).toBe('/profile#keys')
  })

  test('rejects external, protocol-relative, backslash, and control URLs', () => {
    expect(
      safeInternalRedirect('https://evil.example/path', '/dashboard', origin)
    ).toBe('/dashboard')
    expect(safeInternalRedirect('//evil.example', '/dashboard', origin)).toBe(
      '/dashboard'
    )
    expect(safeInternalRedirect('/\\evil.example', '/dashboard', origin)).toBe(
      '/dashboard'
    )
    expect(safeInternalRedirect('/path\nnext', '/dashboard', origin)).toBe(
      '/dashboard'
    )
  })
})
