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
import i18n, { type BackendModule, type ResourceKey } from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'

const SUPPORTED_LANGUAGES = ['en', 'zh', 'fr', 'ru', 'ja', 'vi'] as const
type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

function normalizeLanguage(language: string): SupportedLanguage | null {
  const normalized = language.toLowerCase().split('-')[0]
  return SUPPORTED_LANGUAGES.includes(normalized as SupportedLanguage)
    ? (normalized as SupportedLanguage)
    : null
}

async function loadLocale(language: SupportedLanguage): Promise<ResourceKey> {
  const locale = await import(`./locales/${language}.json`)
  return locale.default as ResourceKey
}

const localeBackend: BackendModule = {
  type: 'backend',
  init: () => undefined,
  read: (language, _namespace, callback) => {
    const supportedLanguage = normalizeLanguage(language)
    if (!supportedLanguage) {
      callback(null, {})
      return
    }

    void loadLocale(supportedLanguage)
      .then((resource) => callback(null, resource))
      // A missing translation chunk must not leave the whole app blank. The
      // UI can still render its English source keys and retry after refresh.
      .catch(() => callback(null, {}))
  },
}

let initialization: Promise<void> | null = null

export async function initializeI18n(): Promise<void> {
  if (i18n.isInitialized) return
  if (!initialization) {
    initialization = i18n
      .use(localeBackend)
      .use(LanguageDetector)
      .use(initReactI18next)
      .init({
        fallbackLng: 'en',
        supportedLngs: SUPPORTED_LANGUAGES,
        load: 'languageOnly', // Convert zh-CN -> zh
        nsSeparator: false, // Allow literal colons in keys (e.g., URLs, labels)
        debug: import.meta.env.DEV,
        interpolation: {
          escapeValue: false, // not needed for react as it escapes by default
        },
        detection: {
          order: ['localStorage', 'navigator'],
          caches: ['localStorage'],
        },
      })
      .then(() => undefined)
  }
  await initialization
}

export default i18n
