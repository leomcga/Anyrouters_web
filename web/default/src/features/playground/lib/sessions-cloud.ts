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
import { api } from '@/lib/api'
import { API_ENDPOINTS } from '../constants'
import type { Message } from '../types'
import {
  sanitizeMessagesOnLoad,
  stripDataImagesFromMessages,
} from './message-utils'
import type { ChatSession } from './sessions'

/**
 * Cloud mirror for playground conversations (/pg/sessions). localStorage stays
 * the fast local cache; every change is also pushed here so history survives
 * refreshes, crashes and device switches (a lost unsaved conversation was a
 * real user complaint, 2026-07-03).
 *
 * Sync model: last-write-wins by `updatedAt`, one row per session id. Uploads
 * strip inline base64 images (idbimg:// refs pass through untouched), matching
 * the localStorage guard — the "images stay on this device" contract is
 * unchanged.
 *
 * All failures degrade silently to local-only behavior: sync must never break
 * the chat.
 */

interface CloudSessionRow {
  id: string
  title: string
  messages: string
  created_at: number
  updated_at: number
}

/** Fetch all cloud conversations, mapped back to ChatSession shape. */
export async function fetchCloudSessions(): Promise<ChatSession[]> {
  const res = await api.get(API_ENDPOINTS.SESSIONS, {
    skipErrorHandler: true,
  } as Record<string, unknown>)
  const rows: CloudSessionRow[] = res.data?.data ?? []
  const sessions: ChatSession[] = []
  for (const row of rows) {
    if (!row || typeof row.id !== 'string') continue
    let messages: Message[] = []
    try {
      const parsed: unknown = JSON.parse(row.messages || '[]')
      if (Array.isArray(parsed)) {
        messages = sanitizeMessagesOnLoad(parsed as Message[])
      }
    } catch {
      continue // a corrupt row must not take the whole history down
    }
    sessions.push({
      id: row.id,
      title: typeof row.title === 'string' ? row.title : '',
      messages,
      createdAt: row.created_at || Date.now(),
      updatedAt: row.updated_at || Date.now(),
    })
  }
  return sessions
}

function toRow(session: ChatSession): CloudSessionRow {
  return {
    id: session.id,
    title: session.title,
    messages: JSON.stringify(stripDataImagesFromMessages(session.messages)),
    created_at: session.createdAt,
    updated_at: session.updatedAt,
  }
}

export async function upsertCloudSession(session: ChatSession): Promise<void> {
  try {
    await api.put(
      `${API_ENDPOINTS.SESSIONS}/${encodeURIComponent(session.id)}`,
      toRow(session),
      { skipErrorHandler: true } as Record<string, unknown>
    )
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('Cloud session sync failed (kept locally):', error)
  }
}

export async function deleteCloudSession(id: string): Promise<void> {
  try {
    await api.delete(`${API_ENDPOINTS.SESSIONS}/${encodeURIComponent(id)}`, {
      skipErrorHandler: true,
    } as Record<string, unknown>)
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('Cloud session delete failed:', error)
  }
}

// Per-session debounced upsert: streaming updates a conversation many times a
// second; coalesce to at most one PUT per session per window, with a flush hook
// for stream-end/unmount (mirrors the localStorage debounce in the hook).
const UPSERT_DEBOUNCE_MS = 1500
const pendingUpserts = new Map<string, ChatSession>()
let upsertTimer: ReturnType<typeof setTimeout> | null = null

function drainPendingUpserts(): void {
  const batch = [...pendingUpserts.values()]
  pendingUpserts.clear()
  for (const session of batch) {
    void upsertCloudSession(session)
  }
}

export function scheduleCloudUpsert(session: ChatSession): void {
  pendingUpserts.set(session.id, session)
  if (upsertTimer) return
  upsertTimer = setTimeout(() => {
    upsertTimer = null
    drainPendingUpserts()
  }, UPSERT_DEBOUNCE_MS)
}

export function flushCloudUpserts(): void {
  if (upsertTimer) {
    clearTimeout(upsertTimer)
    upsertTimer = null
  }
  drainPendingUpserts()
}

/**
 * Merge cloud and local session lists: union by id, newer `updatedAt` wins,
 * newest first. The caller re-caps the list length.
 */
export function mergeSessions(
  local: ChatSession[],
  cloud: ChatSession[]
): ChatSession[] {
  const byId = new Map<string, ChatSession>()
  for (const s of local) byId.set(s.id, s)
  for (const s of cloud) {
    const existing = byId.get(s.id)
    if (!existing || s.updatedAt > existing.updatedAt) {
      byId.set(s.id, s)
    }
  }
  return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt)
}
