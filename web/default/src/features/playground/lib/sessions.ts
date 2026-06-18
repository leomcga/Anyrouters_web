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
import { STORAGE_KEYS } from '../constants'
import type { Message } from '../types'
import { sanitizeMessagesOnLoad } from './message-utils'

/**
 * A single saved conversation. Persisted as a list under
 * STORAGE_KEYS.SESSIONS so the playground can offer ChatGPT-style history.
 */
export interface ChatSession {
  id: string
  title: string
  messages: Message[]
  createdAt: number
  updatedAt: number
}

/** Cap how many conversations we keep so localStorage cannot grow unbounded. */
export const MAX_SESSIONS = 50

const TITLE_MAX_LENGTH = 40

function generateId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    // fall through to the manual id below
  }
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/** Derive a short title from the first user message; '' when there is none. */
export function deriveTitle(messages: Message[]): string {
  const firstUser = messages.find((m) => m.from === 'user')
  const raw = firstUser?.versions?.[0]?.content?.trim() ?? ''
  if (!raw) return ''
  const oneLine = raw.replace(/\s+/g, ' ')
  return oneLine.length > TITLE_MAX_LENGTH
    ? `${oneLine.slice(0, TITLE_MAX_LENGTH)}…`
    : oneLine
}

/** A session is "empty" until it holds at least one non-blank user message. */
export function isEmptySession(session: ChatSession): boolean {
  return !session.messages.some(
    (m) => m.from === 'user' && (m.versions?.[0]?.content?.trim() ?? '') !== ''
  )
}

/** Build a fresh session, optionally seeded with existing messages. */
export function createSession(messages: Message[] = []): ChatSession {
  const now = Date.now()
  return {
    id: generateId(),
    title: deriveTitle(messages),
    messages,
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Load all sessions from localStorage, sanitizing each conversation's
 * messages (mirrors the single-conversation loader).
 */
export function loadSessions(): ChatSession[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.SESSIONS)
    if (saved) {
      const parsed: unknown = JSON.parse(saved)
      if (Array.isArray(parsed)) {
        return (parsed as ChatSession[])
          .filter(
            (s) =>
              s &&
              typeof s.id === 'string' &&
              Array.isArray(s.messages)
          )
          .map((s) => ({
            ...s,
            title: typeof s.title === 'string' ? s.title : '',
            createdAt: typeof s.createdAt === 'number' ? s.createdAt : Date.now(),
            updatedAt: typeof s.updatedAt === 'number' ? s.updatedAt : Date.now(),
            messages: sanitizeMessagesOnLoad(s.messages),
          }))
      }
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to load chat sessions:', error)
  }
  return []
}

/** Persist sessions, newest first and capped to MAX_SESSIONS. */
export function saveSessions(sessions: ChatSession[]): void {
  try {
    const trimmed = [...sessions]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_SESSIONS)
    localStorage.setItem(STORAGE_KEYS.SESSIONS, JSON.stringify(trimmed))
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to save chat sessions:', error)
  }
}

export function loadActiveSessionId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEYS.ACTIVE_SESSION)
  } catch {
    return null
  }
}

export function saveActiveSessionId(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEYS.ACTIVE_SESSION, id)
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to save active session id:', error)
  }
}
