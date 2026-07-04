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
import type { TicketStatus } from './types'

/** Status → label i18n key + badge tone. Labels differ by audience: a "replied"
 *  ticket is "客服已回复" to the user but "已回复" to staff. */
export function statusMeta(status: TicketStatus): {
  key: string
  tone: 'open' | 'replied' | 'closed'
} {
  switch (status) {
    case 'open':
      return { key: 'Awaiting reply', tone: 'open' }
    case 'replied':
      return { key: 'Replied', tone: 'replied' }
    case 'closed':
      return { key: 'Closed', tone: 'closed' }
  }
}

export function statusBadgeClass(tone: 'open' | 'replied' | 'closed'): string {
  switch (tone) {
    case 'open':
      return 'bg-amber-500/12 text-amber-600 dark:text-amber-400'
    case 'replied':
      return 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400'
    case 'closed':
      return 'bg-muted text-muted-foreground'
  }
}

/** Split a ticket message into plain-text runs and inline base64 images, so we
 *  can render screenshots the user pasted without a full markdown engine. */
export function parseTicketContent(
  content: string
): Array<{ type: 'text' | 'image'; value: string }> {
  const parts: Array<{ type: 'text' | 'image'; value: string }> = []
  const re = /!\[[^\]]*\]\((data:image\/[a-zA-Z0-9.+-]+;base64,[^)]+)\)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    if (m.index > last)
      parts.push({ type: 'text', value: content.slice(last, m.index) })
    parts.push({ type: 'image', value: m[1] })
    last = m.index + m[0].length
  }
  if (last < content.length)
    parts.push({ type: 'text', value: content.slice(last) })
  return parts
}
