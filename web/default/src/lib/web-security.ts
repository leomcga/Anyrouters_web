import DOMPurify from 'dompurify'

const SAFE_URI = /^(?:(?:https?|mailto):|\/(?!\/)|#)/i

export function sanitizeRichHtml(value: string): string {
  return DOMPurify.sanitize(value, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: [
      'script',
      'iframe',
      'object',
      'embed',
      'svg',
      'math',
      'style',
      'form',
      'input',
      'button',
    ],
    FORBID_ATTR: ['style', 'srcdoc'],
    ALLOWED_URI_REGEXP: SAFE_URI,
  })
}

export function safeInternalRedirect(
  value: string | undefined,
  fallback = '/dashboard',
  origin = window.location.origin
): string {
  if (!value) {
    return fallback
  }
  if (
    value.includes('\\') ||
    Array.from(value).some((character) => {
      const code = character.charCodeAt(0)
      return code < 32 || code === 127
    })
  ) {
    return fallback
  }
  try {
    const resolved = new URL(value, origin)
    if (resolved.origin !== origin) {
      return fallback
    }
    return `${resolved.pathname}${resolved.search}${resolved.hash}`
  } catch {
    return fallback
  }
}

export function isSafeExternalUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password
  } catch {
    return false
  }
}
