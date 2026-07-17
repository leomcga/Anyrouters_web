import { expect, test } from 'bun:test'
import i18next from 'i18next'
import { localeBackend } from '../src/i18n/config'

test('lazy backend renders Simplified Chinese instead of English keys', async () => {
  const instance = i18next.createInstance()

  await instance.use(localeBackend).init({
    lng: 'zh',
    fallbackLng: false,
    supportedLngs: ['zh'],
    ns: ['translation'],
    defaultNS: 'translation',
    interpolation: { escapeValue: false },
  })

  expect(instance.resolvedLanguage).toBe('zh')
  expect(instance.t('Wallet')).toBe('钱包')
  expect(instance.t('Channels')).toBe('渠道')
})
