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
import { generateImage } from '../api'
import { MESSAGE_STATUS, ERROR_MESSAGES } from '../constants'
import type { MessageStatus } from '../types'
import {
  isGenerationActive,
  markGenerationActive,
  markGenerationDone,
} from './active-generations'
import { friendlyErrorMessage } from './friendly-error'
import { offloadDataImagesToIdb } from './message-utils'
import { patchSessionMessage } from './sessions'

/**
 * Runs image generations DETACHED from the React tree, keyed by the assistant
 * message they fill. gpt-image-2 takes 100+ seconds; if the user navigates to
 * /wallet mid-generation the playground unmounts, and the old code lost the
 * result (the SSE kept running but wrote to a dead component) and then flagged
 * the stuck message "Generation was interrupted" on return.
 *
 * This manager fixes that: the SSE lives here, results persist straight to
 * localStorage via patchSessionMessage even with nothing mounted, and a
 * remounted playground re-subscribes to render live progress (blur / pill) and
 * receive the final image.
 */

export interface GenUpdate {
  content: string
  status: MessageStatus
  imageDegraded?: boolean
}

type Subscriber = (update: GenUpdate) => void

interface GenEntry {
  sessionId: string
  messageKey: string
  alt: string
  latest: GenUpdate
  sub: Subscriber | null
  cancel?: () => void
}

const entries = new Map<string, GenEntry>()

const keyOf = (sessionId: string, messageKey: string) =>
  `${sessionId}::${messageKey}`

function toMarkdown(alt: string, urls: string[]): string {
  return urls.map((u) => `![${alt}](${u})`).join('\n\n')
}

// Push an update to the live subscriber if mounted; ALWAYS persist to storage
// so the result survives an unmounted playground. When a subscriber is present
// it also drives React state (which persists via its own debounce) — the extra
// direct write is the same content, so the two stay consistent.
function emit(entry: GenEntry, update: GenUpdate) {
  entry.latest = update
  if (entry.sub) entry.sub(update)
  patchSessionMessage(entry.sessionId, entry.messageKey, {
    content: update.content,
    status: update.status,
    imageDegraded: update.imageDegraded ?? false,
  })
}

export interface StartImageGenerationArgs {
  sessionId: string
  messageKey: string
  alt: string
  payload: Parameters<typeof generateImage>[0]
}

/**
 * Kick off a detached image generation. Returns immediately; progress and the
 * final result flow to any subscriber and to localStorage. If a generation for
 * this (session, message) is already running, it is left alone.
 */
export function startImageGeneration(args: StartImageGenerationArgs): void {
  const k = keyOf(args.sessionId, args.messageKey)
  if (entries.has(k)) return
  const entry: GenEntry = {
    sessionId: args.sessionId,
    messageKey: args.messageKey,
    alt: args.alt,
    latest: { content: '', status: MESSAGE_STATUS.LOADING },
    sub: null,
  }
  entries.set(k, entry)
  markGenerationActive(args.messageKey)

  generateImage(
    args.payload,
    (partialUrl) => {
      emit(entry, {
        content: toMarkdown(entry.alt, [partialUrl]),
        status: MESSAGE_STATUS.STREAMING,
      })
    },
    (cancel) => {
      entry.cancel = cancel
    }
  )
    .then(async ({ urls, degraded }) => {
      if (!urls.length) {
        emit(entry, {
          content: friendlyErrorMessage(ERROR_MESSAGES.API_REQUEST_ERROR),
          status: MESSAGE_STATUS.ERROR,
        })
        return
      }
      const content = await offloadDataImagesToIdb(toMarkdown(entry.alt, urls))
      emit(entry, {
        content,
        status: MESSAGE_STATUS.COMPLETE,
        imageDegraded: degraded,
      })
    })
    .catch((error: unknown) => {
      const err = error as { message?: string; code?: string }
      // User-initiated stop: the composer was already re-enabled by the caller;
      // nothing more to persist beyond whatever partial is already there.
      if (err?.code === 'aborted') return
      emit(entry, {
        content: friendlyErrorMessage(err?.message),
        status: MESSAGE_STATUS.ERROR,
      })
    })
    .finally(() => {
      markGenerationDone(entry.messageKey)
      entries.delete(k)
    })
}

/**
 * Subscribe a mounted playground to a running generation for this message.
 * Immediately replays the latest state (so the bubble re-renders progress on
 * remount). Returns an unsubscribe that detaches WITHOUT stopping generation.
 */
export function subscribeImageGeneration(
  sessionId: string,
  messageKey: string,
  sub: Subscriber
): () => void {
  const entry = entries.get(keyOf(sessionId, messageKey))
  if (!entry) return () => {}
  entry.sub = sub
  sub(entry.latest)
  return () => {
    if (entry.sub === sub) entry.sub = null
  }
}

/** The message keys of generations still running for this session (remount). */
export function activeGenerationsFor(sessionId: string): string[] {
  const out: string[] = []
  entries.forEach((e) => {
    if (e.sessionId === sessionId) out.push(e.messageKey)
  })
  return out
}

/** Stop a running generation (Stop button). */
export function cancelImageGeneration(
  sessionId: string,
  messageKey: string
): void {
  entries.get(keyOf(sessionId, messageKey))?.cancel?.()
}

export { isGenerationActive }
