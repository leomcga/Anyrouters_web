import DOMPurify from 'dompurify';

const SAFE_URI = /^(?:(?:https?|mailto):|\/(?!\/)|#)/i;

export function sanitizeRichHtml(value) {
  return DOMPurify.sanitize(String(value || ''), {
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
  });
}

export function isSafeExternalUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

export function safeInternalRedirect(value, fallback = '/console') {
  if (!value) {
    return fallback;
  }
  if (
    value.includes('\\') ||
    Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  ) {
    return fallback;
  }
  try {
    const parsed = new URL(value, window.location.origin);
    if (parsed.origin !== window.location.origin) {
      return fallback;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
