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
import { submitVideoTask, fetchVideoTask, videoContentUrl } from '../api'
import { MESSAGE_STATUS, ERROR_MESSAGES } from '../constants'
import type { MessageStatus } from '../types'
import {
  markGenerationActive,
  markGenerationDone,
} from './active-generations'
import { friendlyErrorMessage } from './friendly-error'
import type { GenUpdate } from './image-gen-manager'
import { patchSessionMessage } from './sessions'
import { putVideoFromUrl } from './video-store'

/**
 * Runs Veo video generations DETACHED from the React tree, keyed by the
 * assistant message they fill — the video counterpart of image-gen-manager.
 * Veo clips take 1–5 minutes (submit → poll), so leaving /playground mid-render
 * used to lose the result and flag the message "Generation was interrupted" on
 * return. Here the submit+poll loop lives outside the component, results persist
 * straight to localStorage via patchSessionMessage, and a remounted playground
 * re-subscribes to keep the "generating video…" state and receive the clip.
 */

type Subscriber = (update: GenUpdate) => void

interface VideoEntry {
  sessionId: string
  messageKey: string
  latest: GenUpdate
  sub: Subscriber | null
  cancelled: boolean
}

const entries = new Map<string, VideoEntry>()

const keyOf = (sessionId: string, messageKey: string) =>
  `${sessionId}::${messageKey}`

function emit(entry: VideoEntry, update: GenUpdate) {
  entry.latest = update
  if (entry.sub) entry.sub(update)
  patchSessionMessage(entry.sessionId, entry.messageKey, {
    content: update.content,
    status: update.status,
  })
}

export interface StartVideoGenerationArgs {
  sessionId: string
  messageKey: string
  alt: string
  submitPayload: Parameters<typeof submitVideoTask>[0]
}

export function startVideoGeneration(args: StartVideoGenerationArgs): void {
  const k = keyOf(args.sessionId, args.messageKey)
  if (entries.has(k)) return
  const entry: VideoEntry = {
    sessionId: args.sessionId,
    messageKey: args.messageKey,
    // Empty content + STREAMING makes the bubble show the "generating video…"
    // indicator until the clip lands.
    latest: { content: '', status: MESSAGE_STATUS.STREAMING as MessageStatus },
    sub: null,
    cancelled: false,
  }
  entries.set(k, entry)
  markGenerationActive(args.messageKey)
  emit(entry, entry.latest)

  const fail = (msg?: string) =>
    emit(entry, {
      content: friendlyErrorMessage(msg),
      status: MESSAGE_STATUS.ERROR,
    })

  void (async () => {
    try {
      const { id } = await submitVideoTask(args.submitPayload)
      if (entry.cancelled) return
      if (!id) {
        fail(ERROR_MESSAGES.API_REQUEST_ERROR)
        return
      }
      // Poll until terminal. Veo clips take ~30s–3min; cap at ~5min.
      const deadline = Date.now() + 5 * 60 * 1000
      const intervalMs = 4000
      for (;;) {
        await new Promise((r) => setTimeout(r, intervalMs))
        if (entry.cancelled) return
        const { status, failReason } = await fetchVideoTask(id)
        if (entry.cancelled) return
        if (status === 'succeeded') {
          // Persist the mp4 locally (LRU 20) so the clip survives a refresh
          // after the upstream proxy expires; fall back to the live proxy URL.
          const ref = await putVideoFromUrl(videoContentUrl(id))
          if (entry.cancelled) return
          emit(entry, {
            content: `!video[${args.alt}](${ref})`,
            status: MESSAGE_STATUS.COMPLETE,
          })
          return
        }
        if (status === 'failed') {
          fail(failReason || ERROR_MESSAGES.API_REQUEST_ERROR)
          return
        }
        if (Date.now() > deadline) {
          fail(ERROR_MESSAGES.API_REQUEST_ERROR)
          return
        }
      }
    } catch (error: unknown) {
      if (entry.cancelled) return
      const err = error as {
        response?: { data?: { error?: { message?: string } } }
        message?: string
      }
      fail(err?.response?.data?.error?.message || err?.message)
    } finally {
      markGenerationDone(entry.messageKey)
      entries.delete(k)
    }
  })()
}

export function subscribeVideoGeneration(
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

export function activeVideoGenerationsFor(sessionId: string): string[] {
  const out: string[] = []
  entries.forEach((e) => {
    if (e.sessionId === sessionId) out.push(e.messageKey)
  })
  return out
}

export function cancelVideoGeneration(
  sessionId: string,
  messageKey: string
): void {
  const entry = entries.get(keyOf(sessionId, messageKey))
  if (entry) entry.cancelled = true
}
