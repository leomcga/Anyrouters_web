import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(
  new URL(
    '../src/features/auth/sign-in/components/user-auth-form.tsx',
    import.meta.url
  ),
  'utf8'
)

test('sign-in keeps legal consent visible and guards login attempts', () => {
  expect(source).toContain('<LegalConsent')
  expect(source).toContain('const ensureLegalConsent')
  expect(source).toContain('beforeLogin={ensureLegalConsent}')
  expect(source).toContain('showError={showLegalConsentError}')
  expect(source).not.toContain(
    'disabled={isLoading || (requiresLegalConsent && !agreedToLegal)}'
  )
})

test('oauth buttons run the legal consent guard before starting login', () => {
  const oauthProvidersSource = readFileSync(
    new URL(
      '../src/features/auth/components/oauth-providers.tsx',
      import.meta.url
    ),
    'utf8'
  )

  expect(oauthProvidersSource).toContain('beforeLogin?: () => boolean')
  expect(oauthProvidersSource).toContain('if (beforeLogin && !beforeLogin())')
})

test('sign-up still requires explicit legal consent', () => {
  const signUpSource = readFileSync(
    new URL(
      '../src/features/auth/sign-up/components/sign-up-form.tsx',
      import.meta.url
    ),
    'utf8'
  )

  expect(signUpSource).toContain('<LegalConsent')
  expect(signUpSource).toContain('const ensureLegalConsent')
  expect(signUpSource).toContain('beforeLogin={ensureLegalConsent}')
  expect(signUpSource).toContain('showError={showLegalConsentError}')
  expect(signUpSource).not.toContain(
    'disabled={isLoading || (requiresLegalConsent && !agreedToLegal)}'
  )
})
