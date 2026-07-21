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

const UPSERT_DEBOUNCE_MS = 1500

type CloudSessionApi = Pick<typeof api, 'delete' | 'put'>

interface PendingUpsert {
  row: CloudSessionRow
  completions: Array<() => void>
}

interface SessionWriteLane {
  inFlight: boolean
  pendingUpsert: PendingUpsert | null
  deletePending: boolean
  deleteInFlight: boolean
  deleteCompletions: Array<() => void>
  idleWaiters: Array<() => void>
}

interface CloudSessionSyncOptions {
  debounceMs?: number
}

/**
 * Coordinates the cloud mirror's writes.
 *
 * A conversation can emit hundreds of snapshots while streaming. Each session
 * therefore gets its own serial lane: the active request is allowed to finish,
 * all queued snapshots collapse to the newest one, and only then is another
 * PUT started. Different sessions keep independent lanes and may upload in
 * parallel. DELETE is a terminal barrier for its lane so a late streaming
 * snapshot cannot recreate a conversation the user removed.
 */
export function createCloudSessionSync(
  client: CloudSessionApi,
  options: CloudSessionSyncOptions = {}
) {
  const debounceMs = options.debounceMs ?? UPSERT_DEBOUNCE_MS
  const lanes = new Map<string, SessionWriteLane>()
  const scheduledUpserts = new Map<string, ChatSession>()
  const deletedSessionIds = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | null = null

  function getLane(id: string): SessionWriteLane {
    const existing = lanes.get(id)
    if (existing) return existing
    const lane: SessionWriteLane = {
      inFlight: false,
      pendingUpsert: null,
      deletePending: false,
      deleteInFlight: false,
      deleteCompletions: [],
      idleWaiters: [],
    }
    lanes.set(id, lane)
    return lane
  }

  function settleIdleLane(id: string, lane: SessionWriteLane): void {
    if (
      lane.inFlight ||
      lane.pendingUpsert ||
      lane.deletePending ||
      lane.deleteInFlight
    ) {
      return
    }
    if (lanes.get(id) === lane) lanes.delete(id)
    const waiters = lane.idleWaiters.splice(0)
    for (const resolve of waiters) resolve()
  }

  function runNext(id: string, lane: SessionWriteLane): void {
    if (lane.inFlight) return

    if (lane.deletePending) {
      lane.deletePending = false
      lane.deleteInFlight = true
      lane.inFlight = true
      void client
        .delete(`${API_ENDPOINTS.SESSIONS}/${encodeURIComponent(id)}`, {
          skipErrorHandler: true,
        } as Record<string, unknown>)
        .catch((error: unknown) => {
          // eslint-disable-next-line no-console
          console.warn('Cloud session delete failed:', error)
        })
        .finally(() => {
          lane.inFlight = false
          lane.deleteInFlight = false
          const completions = lane.deleteCompletions.splice(0)
          for (const resolve of completions) resolve()
          settleIdleLane(id, lane)
        })
      return
    }

    const pending = lane.pendingUpsert
    if (!pending) {
      settleIdleLane(id, lane)
      return
    }
    lane.pendingUpsert = null
    lane.inFlight = true
    void client
      .put(`${API_ENDPOINTS.SESSIONS}/${encodeURIComponent(id)}`, pending.row, {
        skipErrorHandler: true,
      } as Record<string, unknown>)
      .catch((error: unknown) => {
        // eslint-disable-next-line no-console
        console.warn('Cloud session sync failed (kept locally):', error)
      })
      .finally(() => {
        lane.inFlight = false
        for (const resolve of pending.completions) resolve()
        runNext(id, lane)
      })
  }

  function enqueueUpsert(session: ChatSession, completion?: () => void): void {
    if (deletedSessionIds.has(session.id)) {
      completion?.()
      return
    }
    const lane = getLane(session.id)
    const completions = lane.pendingUpsert?.completions ?? []
    if (completion) completions.push(completion)
    lane.pendingUpsert = { row: toRow(session), completions }
    runNext(session.id, lane)
  }

  function drainScheduledUpserts(): string[] {
    const sessions = [...scheduledUpserts.values()]
    scheduledUpserts.clear()
    for (const session of sessions) enqueueUpsert(session)
    return sessions.map((session) => session.id)
  }

  function waitForIdle(id: string): Promise<void> {
    const lane = lanes.get(id)
    if (!lane) return Promise.resolve()
    return new Promise((resolve) => {
      lane.idleWaiters.push(resolve)
      settleIdleLane(id, lane)
    })
  }

  function upsert(session: ChatSession): Promise<void> {
    // A direct write is newer than an older debounced snapshot for this id.
    scheduledUpserts.delete(session.id)
    return new Promise((resolve) => enqueueUpsert(session, resolve))
  }

  function scheduleUpsert(session: ChatSession): void {
    if (deletedSessionIds.has(session.id)) return
    scheduledUpserts.set(session.id, session)
    if (timer) return
    timer = setTimeout(() => {
      timer = null
      drainScheduledUpserts()
    }, debounceMs)
  }

  async function flush(): Promise<void> {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    const drainedIds = drainScheduledUpserts()
    const ids = new Set([...lanes.keys(), ...drainedIds])
    await Promise.all([...ids].map(waitForIdle))
  }

  function deleteSession(id: string): Promise<void> {
    deletedSessionIds.add(id)
    scheduledUpserts.delete(id)
    if (scheduledUpserts.size === 0 && timer) {
      clearTimeout(timer)
      timer = null
    }

    const lane = getLane(id)
    if (lane.pendingUpsert) {
      lane.deleteCompletions.push(...lane.pendingUpsert.completions)
      lane.pendingUpsert = null
    }
    return new Promise((resolve) => {
      lane.deleteCompletions.push(resolve)
      if (!lane.deletePending && !lane.deleteInFlight) {
        lane.deletePending = true
      }
      runNext(id, lane)
    })
  }

  return { delete: deleteSession, flush, scheduleUpsert, upsert }
}

// Per-session debounced upsert: streaming updates a conversation many times a
// second; coalesce to at most one PUT per session per window, with a flush hook
// for stream-end/unmount (mirrors the localStorage debounce in the hook).
const cloudSessionSync = createCloudSessionSync(api)

export function upsertCloudSession(session: ChatSession): Promise<void> {
  return cloudSessionSync.upsert(session)
}

export function deleteCloudSession(id: string): Promise<void> {
  return cloudSessionSync.delete(id)
}

export function scheduleCloudUpsert(session: ChatSession): void {
  cloudSessionSync.scheduleUpsert(session)
}

export function flushCloudUpserts(): Promise<void> {
  return cloudSessionSync.flush()
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
