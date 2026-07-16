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
import i18n from '@/i18n/config'

/**
 * Turn a raw upstream/gateway error string into something a normal user can
 * read. Providers leak scary internal boilerplate — Azure content moderation
 * dumps "Your request was rejected by the safety system ... contact us at Azure
 * support ticket and include the request ID ... safety_violations=[sexual]",
 * which names Azure (an upstream we hide), a support channel that isn't ours,
 * and an internal id — none of which the user should see. We map the known
 * patterns to short, localized messages and leave anything unrecognized as-is.
 */
export function friendlyErrorMessage(raw: string | undefined | null): string {
  const t = (k: string) => i18n.t(k)
  const msg = (raw ?? '').trim()
  if (!msg) return t('The request failed. Please try again.')

  const lower = msg.toLowerCase()

  // Content moderation / safety rejection (Azure "safety system", OpenAI
  // "content policy", Gemini "blocked", generic "safety"/"moderation").
  if (
    lower.includes('safety_violations') ||
    lower.includes('safety system') ||
    lower.includes('content management policy') ||
    lower.includes('content_policy') ||
    lower.includes('content policy') ||
    (lower.includes('responsibleai') && lower.includes('block')) ||
    lower.includes('jailbreak')
  ) {
    return t(
      'Content moderation blocked this request. Please adjust your wording and try again.'
    )
  }

  // Rate limiting.
  if (
    lower.includes('rate limit') ||
    lower.includes('too many requests') ||
    lower.includes('429')
  ) {
    return t('Too many requests right now. Please wait a moment and retry.')
  }

  // Auth / key problems.
  if (
    lower.includes('invalid api key') ||
    lower.includes('unauthorized') ||
    lower.includes('authentication') ||
    lower.includes('401') ||
    lower.includes('403')
  ) {
    return t('Your API key is invalid or lacks access. Please check it.')
  }

  // Balance / quota exhausted.
  if (
    lower.includes('insufficient') ||
    lower.includes('quota') ||
    lower.includes('余额')
  ) {
    return t('Your balance is insufficient. Please top up and try again.')
  }

  if (lower.includes('reference image compression failed')) {
    return t(
      'The reference image is too large to process. Please upload it again and retry.'
    )
  }

  return msg
}
