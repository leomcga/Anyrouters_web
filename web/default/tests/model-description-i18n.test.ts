import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import i18next from 'i18next'
import { localeBackend } from '../src/i18n/config'
import en from '../src/i18n/locales/en.json'
import fr from '../src/i18n/locales/fr.json'
import ja from '../src/i18n/locales/ja.json'
import ru from '../src/i18n/locales/ru.json'
import vi from '../src/i18n/locales/vi.json'
import { localizeModelDescription } from '../src/features/pricing/lib/model-description'

const modelCardSource = readFileSync(
  new URL('../src/features/pricing/components/model-card.tsx', import.meta.url),
  'utf8'
)
const modelDetailsSource = readFileSync(
  new URL('../src/features/pricing/components/model-details.tsx', import.meta.url),
  'utf8'
)

test('French marketplace translates model descriptions instead of keeping Chinese', async () => {
  const instance = i18next.createInstance()
  const source =
    'Claude Haiku 4.5 · 轻量极速版，低延迟高性价比，适合高频与简单任务'

  await instance.use(localeBackend).init({
    lng: 'fr',
    fallbackLng: false,
    supportedLngs: ['fr'],
    ns: ['translation'],
    defaultNS: 'translation',
  })

  expect(instance.t(source)).toBe(
    'Claude Haiku 4.5 · Modèle léger et ultra-rapide, à faible latence et excellent rapport qualité-prix, idéal pour les tâches fréquentes et simples'
  )
})

test('Chinese marketplace keeps the Chinese source description instead of falling back to English', async () => {
  const instance = i18next.createInstance()
  const source =
    'Claude Haiku 4.5 · 轻量极速版，低延迟高性价比，适合高频与简单任务'

  await instance.init({
    lng: 'zh',
    fallbackLng: 'en',
    resources: { en },
  })

  expect(instance.t(source)).toBe(
    'Claude Haiku 4.5 · Lightweight and ultra-fast, with low latency and excellent value for frequent and simple tasks'
  )
  expect(
    localizeModelDescription(source, instance.language, instance.t.bind(instance))
  ).toBe(source)
})

test('model cards and details render descriptions through i18n', () => {
  expect(modelCardSource).toContain('localizeModelDescription(')
  expect(modelDetailsSource).toContain('localizeModelDescription(')
})

test('every curated model description has all non-Chinese translations', () => {
  const sourceDescriptions = Object.keys(en.translation).filter(
    (key) => key.includes(' · ') && /[\u4e00-\u9fff]/.test(key)
  )
  const locales = [en.translation, fr.translation, ru.translation, ja.translation, vi.translation]

  expect(sourceDescriptions).toHaveLength(26)
  for (const source of sourceDescriptions) {
    for (const locale of locales) {
      expect(locale[source as keyof typeof locale]).toBeTruthy()
      expect(locale[source as keyof typeof locale]).not.toBe(source)
    }
  }
})
