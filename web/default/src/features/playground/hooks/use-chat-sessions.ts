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

  // Streaming callbacks captured by the chat handler must keep writing to the
  // session that was active when they ran, so target it through a ref instead
  // of recreating `updateMessages` whenever the active id changes.
  const activeIdRef = useRef(activeId)
  useEffect(() => {
    activeIdRef.current = activeId
  }, [activeId])

  const updateMessages = useCallback((updater: MessagesUpdater) => {
    setState((prev) => {
      const id = activeIdRef.current
      const sessions = prev.sessions.map((s) => {
        if (s.id !== id) return s
        const messages =
          typeof updater === 'function' ? updater(s.messages) : updater
        return {
          ...s,
          messages,
          title: s.title || deriveTitle(messages),
          updatedAt: Date.now(),
        }
      })
      saveSessions(sessions)
      return { ...prev, sessions }
    })
  }, [])

  const newChat = useCallback(() => {
    setState((prev) => {
      // Reuse an existing blank conversation instead of piling up empties.
      const existingEmpty = prev.sessions.find(isEmptySession)
      if (existingEmpty) {
        saveActiveSessionId(existingEmpty.id)
        return { ...prev, activeId: existingEmpty.id }
      }
      const session = createSession([])
      const sessions = [session, ...prev.sessions].slice(0, MAX_SESSIONS)
      saveSessions(sessions)
      saveActiveSessionId(session.id)
      return { sessions, activeId: session.id }
    })
  }, [])

  const selectChat = useCallback((id: string) => {
    setState((prev) => {
      if (id === prev.activeId || !prev.sessions.some((s) => s.id === id)) {
        return prev
      }
      saveActiveSessionId(id)
      return { ...prev, activeId: id }
    })
  }, [])

  const renameChat = useCallback((id: string, title: string) => {
    const next = title.trim()
    if (!next) return
    setState((prev) => {
      const sessions = prev.sessions.map((s) =>
        s.id === id ? { ...s, title: next } : s
      )
      saveSessions(sessions)
      return { ...prev, sessions }
    })
  }, [])

  const deleteChat = useCallback((id: string) => {
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
        activeId = [...remaining].sort((a, b) => b.updatedAt - a.updatedAt)[0].id
        saveActiveSessionId(activeId)
      }
      saveSessions(remaining)
      return { sessions: remaining, activeId }
    })
  }, [])

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
    newChat,
    selectChat,
    renameChat,
    deleteChat,
  }
}
