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
import { sendChatCompletion } from '../api'
import { MESSAGE_STATUS, ERROR_MESSAGES } from '../constants'
import type { ChatCompletionRequest } from '../types'
import { markGenerationActive, markGenerationDone } from './active-generations'
import { friendlyErrorMessage } from './friendly-error'
import type { GenUpdate } from './image-gen-manager'
import { offloadDataImagesToIdb } from './message-utils'
import { patchSessionMessage } from './sessions'

type Subscriber = (update: GenUpdate) => void

interface GeminiImageEntry {
  sessionId: string
  messageKey: string
  latest: GenUpdate
  sub: Subscriber | null
  cancelled: boolean
}

const entries = new Map<string, GeminiImageEntry>()

const keyOf = (sessionId: string, messageKey: string) =>
  `${sessionId}::${messageKey}`

const IMAGE_MARKDOWN =
  /!\[[^\]]*\]\((?:data:image\/[^)]+|idbimg:\/\/[^)]+)\)/g

function firstImage(content: string): string | null {
  IMAGE_MARKDOWN.lastIndex = 0
  const match = IMAGE_MARKDOWN.exec(content)
  return match ? match[0] : null
}

function selectGeneratedParts(
  rawParts: string[],
  targetCount: number
): string[] {
  const images = rawParts
    .map((part) => firstImage(part))
    .filter((part): part is string => Boolean(part))
    .slice(0, targetCount)

  if (images.length > 0) return images
  return rawParts.slice(0, targetCount)
}

function emit(entry: GeminiImageEntry, update: GenUpdate) {
  entry.latest = update
  if (entry.sub) entry.sub(update)
  patchSessionMessage(entry.sessionId, entry.messageKey, {
    content: update.content,
    status: update.status,
  })
}

function finish(entry: GeminiImageEntry, key: string, update: GenUpdate) {
  markGenerationDone(entry.messageKey)
  entries.delete(key)
  emit(entry, update)
}

function extractErrorMessage(error: unknown): string {
  const err = error as {
    response?: {
      data?: { message?: string; error?: { message?: string; code?: string } }
    }
    message?: string
  }
  return (
    err?.response?.data?.error?.message ||
    err?.response?.data?.message ||
    err?.message ||
    ERROR_MESSAGES.API_REQUEST_ERROR
  )
}

export interface StartGeminiImageGenerationArgs {
  sessionId: string
  messageKey: string
  payloads: ChatCompletionRequest[]
  targetCount: number
}

export function startGeminiImageGeneration(
  args: StartGeminiImageGenerationArgs
): void {
  const k = keyOf(args.sessionId, args.messageKey)
  if (entries.has(k)) return
  const entry: GeminiImageEntry = {
    sessionId: args.sessionId,
    messageKey: args.messageKey,
    latest: { content: '', status: MESSAGE_STATUS.STREAMING },
    sub: null,
    cancelled: false,
  }
  entries.set(k, entry)
  markGenerationActive(args.messageKey)
  emit(entry, entry.latest)

  void (async () => {
    try {
      const settled = await Promise.allSettled(
        args.payloads.map((payload) =>
          sendChatCompletion({ ...payload, stream: false })
        )
      )
      if (entry.cancelled) return

      const fulfilled = settled.filter(
        (
          result
        ): result is PromiseFulfilledResult<
          Awaited<ReturnType<typeof sendChatCompletion>>
        > => result.status === 'fulfilled'
      )
      const failed = settled.find((result) => result.status === 'rejected')

      if (fulfilled.length === 0) {
        finish(entry, k, {
          content: friendlyErrorMessage(
            failed?.status === 'rejected'
              ? extractErrorMessage(failed.reason)
              : ERROR_MESSAGES.API_REQUEST_ERROR
          ),
          status: MESSAGE_STATUS.ERROR,
        })
        return
      }

      const rawParts = fulfilled
        .map((result) => result.value?.choices?.[0]?.message?.content || '')
        .filter(Boolean)
      const parts = selectGeneratedParts(
        rawParts,
        Math.max(1, args.targetCount)
      )
      const content = await offloadDataImagesToIdb(parts.join('\n\n'))

      if (!content.trim()) {
        finish(entry, k, {
          content: friendlyErrorMessage(ERROR_MESSAGES.API_REQUEST_ERROR),
          status: MESSAGE_STATUS.ERROR,
        })
        return
      }

      finish(entry, k, {
        content,
        status: MESSAGE_STATUS.COMPLETE,
      })
    } catch (error: unknown) {
      if (entry.cancelled) return
      finish(entry, k, {
        content: friendlyErrorMessage(extractErrorMessage(error)),
        status: MESSAGE_STATUS.ERROR,
      })
    } finally {
      markGenerationDone(entry.messageKey)
      entries.delete(k)
    }
  })()
}

export function subscribeGeminiImageGeneration(
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

export function activeGeminiImageGenerationsFor(sessionId: string): string[] {
  const out: string[] = []
  entries.forEach((entry) => {
    if (entry.sessionId === sessionId) out.push(entry.messageKey)
  })
  return out
}

export function cancelGeminiImageGeneration(
  sessionId: string,
  messageKey: string
): void {
  const entry = entries.get(keyOf(sessionId, messageKey))
  if (!entry) return
  entry.cancelled = true
  finish(entry, keyOf(sessionId, messageKey), {
    content:
      entry.latest.content || friendlyErrorMessage('image generation stopped'),
    status: entry.latest.content
      ? MESSAGE_STATUS.COMPLETE
      : MESSAGE_STATUS.ERROR,
  })
}
