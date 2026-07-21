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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import i18n from '@/i18n/config'
import { toast } from 'sonner'
import {
  type ChatSession,
  createSession,
  deriveTitle,
  isEmptySession,
  loadActiveSessionId,
  loadMessages,
  loadSessions,
  MAX_SESSIONS,
  saveActiveSessionId,
  saveSessions,
} from '../lib'
import {
  deleteCloudSession,
  fetchCloudSessions,
  flushCloudUpserts,
  mergeSessions,
  scheduleCloudUpsert,
  upsertCloudSession,
} from '../lib/sessions-cloud'
import type { Message } from '../types'

type MessagesUpdater = Message[] | ((prev: Message[]) => Message[])

type SessionsState = {
  sessions: ChatSession[]
  activeId: string
}

/**
 * Build the initial state. Existing multi-session data wins; otherwise we
 * migrate a legacy single conversation (the old `playground_messages` key)
 * into the first session so nobody loses their history on upgrade.
 */
function initState(): SessionsState {
  const existing = loadSessions()
  const sessions =
    existing.length > 0
      ? existing
      : (() => {
          const legacy = loadMessages()
          return legacy && legacy.length > 0
            ? [createSession(legacy)]
            : [createSession([])]
        })()

  const stored = loadActiveSessionId()
  const activeId = sessions.some((s) => s.id === stored)
    ? (stored as string)
    : sessions[0].id

  return { sessions, activeId }
}

/**
 * Owns the playground's conversation list (ChatGPT-style history) and which
 * one is open. Exposes `messages` / `updateMessages` with the exact same shape
 * the playground already used, so streaming and editing keep working — they
 * simply read/write the active session now.
 */
export function useChatSessions() {
  const [state, setState] = useState<SessionsState>(initState)
  const { sessions, activeId } = state

  // Persisting to localStorage means serializing the WHOLE conversation
  // (long markdown + tables + file/image refs) to a string. Doing that on every
  // streamed token is O(n²) over the message length and, on a big conversation,
  // spikes CPU/memory hard enough to crash the tab ("此页存在问题 / 错误代码: 5")
  // while a reply is streaming in. So we keep React state updating live (smooth
  // streaming) but DEBOUNCE the localStorage write: coalesce to at most once per
  // PERSIST_DEBOUNCE_MS, with a guaranteed final flush (stream end / unmount).
  const PERSIST_DEBOUNCE_MS = 600
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingSessionsRef = useRef<ChatSession[] | null>(null)

  const flushPersist = useCallback(() => {
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current)
      persistTimerRef.current = null
    }
    if (pendingSessionsRef.current) {
      saveSessions(pendingSessionsRef.current)
      pendingSessionsRef.current = null
    }
    // Push any debounced cloud writes too (stream end / unmount) so the last
    // tokens of a reply are never cloud-lost on an immediate refresh.
    flushCloudUpserts()
  }, [])

  // Pull the cloud copy once on mount and merge it in (union by id, newer
  // updatedAt wins), so history follows the account across devices and
  // survives cleared localStorage. Failures keep local-only behavior.
  useEffect(() => {
    let cancelled = false
    void fetchCloudSessions()
      .then((cloud) => {
        if (cancelled || cloud.length === 0) return
        setState((prev) => {
          const merged = mergeSessions(prev.sessions, cloud).slice(
            0,
            MAX_SESSIONS
          )
          const activeId = merged.some((s) => s.id === prev.activeId)
            ? prev.activeId
            : merged[0].id
          saveSessions(merged)
          saveActiveSessionId(activeId)
          return { sessions: merged, activeId }
        })
      })
      .catch((error) => {
        // eslint-disable-next-line no-console
        console.warn('Cloud session fetch failed (using local history):', error)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const schedulePersist = useCallback((sessions: ChatSession[]) => {
    pendingSessionsRef.current = sessions
    if (persistTimerRef.current) return // a flush is already queued
    persistTimerRef.current = setTimeout(() => {
      persistTimerRef.current = null
      if (pendingSessionsRef.current) {
        saveSessions(pendingSessionsRef.current)
        pendingSessionsRef.current = null
      }
    }, PERSIST_DEBOUNCE_MS)
  }, [])

  // Flush any pending write when the component unmounts (e.g. navigating away
  // mid-stream) so the latest content isn't lost.
  useEffect(() => {
    return () => flushPersist()
  }, [flushPersist])

  const updateSessionMessages = useCallback(
    (sessionId: string, updater: MessagesUpdater) => {
      setState((prev) => {
        let changed = false
        const sessions = prev.sessions.map((s) => {
          if (s.id !== sessionId) return s
          changed = true
          const messages =
            typeof updater === 'function' ? updater(s.messages) : updater
          const next = {
            ...s,
            messages,
            title: s.title || deriveTitle(messages),
            updatedAt: Date.now(),
          }
          // Mirror to the cloud (debounced per session; empties are noise).
          if (!isEmptySession(next)) scheduleCloudUpsert(next)
          return next
        })
        if (!changed) return prev
        schedulePersist(sessions)
        return { ...prev, sessions }
      })
    },
    [schedulePersist]
  )

  const updateMessages = useCallback(
    (updater: MessagesUpdater) => {
      updateSessionMessages(activeId, updater)
    },
    [activeId, updateSessionMessages]
  )

  const newChat = useCallback(() => {
    // Persist any debounced streaming write first, so its content isn't lost
    // when this structural change re-saves the list.
    flushPersist()
    setState((prev) => {
      // Reuse an existing blank conversation instead of piling up empties.
      const existingEmpty = prev.sessions.find(isEmptySession)
      if (existingEmpty) {
        saveActiveSessionId(existingEmpty.id)
        return { ...prev, activeId: existingEmpty.id }
      }
      const session = createSession([])
      const merged = [session, ...prev.sessions]
      const sessions = merged.slice(0, MAX_SESSIONS)
      // We keep only the most recent MAX_SESSIONS conversations. If this new
      // chat pushed the list over the cap, the oldest ones just got dropped —
      // tell the user so a silently-deleted history isn't a mystery.
      const droppedNonEmpty = merged
        .slice(MAX_SESSIONS)
        .filter((s) => !isEmptySession(s)).length
      if (droppedNonEmpty > 0) {
        toast.info(
          i18n.t(
            'Chat history is capped at {{max}} conversations; {{n}} older one(s) were removed. Export anything you want to keep.',
            { max: MAX_SESSIONS, n: droppedNonEmpty }
          )
        )
      }
      saveSessions(sessions)
      saveActiveSessionId(session.id)
      return { sessions, activeId: session.id }
    })
  }, [flushPersist])

  const selectChat = useCallback(
    (id: string) => {
      // Persist any pending streamed content before leaving the current chat.
      flushPersist()
      setState((prev) => {
        if (id === prev.activeId || !prev.sessions.some((s) => s.id === id)) {
          return prev
        }
        saveActiveSessionId(id)
        return { ...prev, activeId: id }
      })
    },
    [flushPersist]
  )

  const renameChat = useCallback(
    (id: string, title: string) => {
      const next = title.trim()
      if (!next) return
      flushPersist()
      setState((prev) => {
        const sessions = prev.sessions.map((s) =>
          s.id === id ? { ...s, title: next } : s
        )
        const renamed = sessions.find((s) => s.id === id)
        if (renamed && !isEmptySession(renamed))
          void upsertCloudSession(renamed)
        saveSessions(sessions)
        return { ...prev, sessions }
      })
    },
    [flushPersist]
  )

  const deleteChat = useCallback(
    (id: string) => {
      flushPersist()
      void deleteCloudSession(id)
      setState((prev) => {
        const remaining = prev.sessions.filter((s) => s.id !== id)
        if (remaining.length === 0) {
          const fresh = createSession([])
          saveSessions([fresh])
          saveActiveSessionId(fresh.id)
          return { sessions: [fresh], activeId: fresh.id }
        }
        let activeId = prev.activeId
        if (activeId === id) {
          activeId = [...remaining].sort((a, b) => b.updatedAt - a.updatedAt)[0]
            .id
          saveActiveSessionId(activeId)
        }
        saveSessions(remaining)
        return { sessions: remaining, activeId }
      })
    },
    [flushPersist]
  )

  const orderedSessions = useMemo(
    () => [...sessions].sort((a, b) => b.updatedAt - a.updatedAt),
    [sessions]
  )

  const messages = useMemo(
    () => sessions.find((s) => s.id === activeId)?.messages ?? [],
    [sessions, activeId]
  )

  return {
    sessions: orderedSessions,
    activeId,
    messages,
    updateMessages,
    updateSessionMessages,
    // Force-write any debounced session state now (e.g. the moment a stream
    // finishes) so a crash/refresh right after can't lose the final tokens.
    flushPersist,
    newChat,
    selectChat,
    renameChat,
    deleteChat,
  }
}
