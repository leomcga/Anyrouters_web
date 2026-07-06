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
import { useCallback, useRef } from 'react'
import { SSE } from 'sse.js'
import { getCommonHeaders } from '@/lib/api'
import { API_ENDPOINTS, ERROR_MESSAGES } from '../constants'
import type {
  ChatCompletionRequest,
  ChatCompletionChunk,
  ToolCall,
} from '../types'

// What a single streamed turn produced: the text shown to the user plus any
// tool calls the model emitted (used by the chat handler's web-search loop).
export interface StreamResult {
  content: string
  toolCalls: ToolCall[]
}

/**
 * Hook for handling streaming chat completion requests
 */
export function useStreamRequest() {
  const sseSourceRef = useRef<SSE | null>(null)
  const isStreamCompleteRef = useRef(false)

  const sendStreamRequest = useCallback(
    (
      payload: ChatCompletionRequest,
      onUpdate: (type: 'reasoning' | 'content', chunk: string) => void,
      onComplete: (result: StreamResult) => void,
      onError: (error: string, errorCode?: string) => void
    ) => {
      const source = new SSE(API_ENDPOINTS.CHAT_COMPLETIONS, {
        headers: getCommonHeaders(),
        method: 'POST',
        payload: JSON.stringify(payload),
      })

      sseSourceRef.current = source
      isStreamCompleteRef.current = false

      // Accumulate this turn's text and any streamed tool calls. Tool-call
      // deltas arrive in fragments: the first carries id+name, the rest append
      // to `arguments` (see the OpenAI streaming format).
      let contentBuf = ''
      const toolAcc: Array<{ id: string; name: string; args: string }> = []

      const closeSource = () => {
        source.close()
        sseSourceRef.current = null
      }

      const buildResult = (): StreamResult => ({
        content: contentBuf,
        toolCalls: toolAcc
          .filter((t) => t && t.name)
          .map((t) => ({
            id: t.id,
            type: 'function' as const,
            function: { name: t.name, arguments: t.args },
          })),
      })

      const completeStream = () => {
        if (isStreamCompleteRef.current) return
        isStreamCompleteRef.current = true
        closeSource()
        onComplete(buildResult())
      }

      const handleError = (errorMessage: string, errorCode?: string) => {
        if (!isStreamCompleteRef.current) {
          isStreamCompleteRef.current = true
          onError(errorMessage, errorCode)
          closeSource()
        }
      }

      source.addEventListener('message', (e: MessageEvent) => {
        if (e.data === '[DONE]') {
          completeStream()
          return
        }

        try {
          const chunk: ChatCompletionChunk = JSON.parse(e.data)
          const delta = chunk.choices?.[0]?.delta

          if (delta) {
            if (delta.reasoning_content) {
              onUpdate('reasoning', delta.reasoning_content)
            }
            if (delta.content) {
              contentBuf += delta.content
              onUpdate('content', delta.content)
            }
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0
                if (!toolAcc[idx]) toolAcc[idx] = { id: '', name: '', args: '' }
                if (tc.id) toolAcc[idx].id = tc.id
                if (tc.function?.name) toolAcc[idx].name = tc.function.name
                if (tc.function?.arguments)
                  toolAcc[idx].args += tc.function.arguments
              }
            }
          }
        } catch (error) {
          // eslint-disable-next-line no-console
          console.error('Failed to parse SSE message:', error)
          handleError(ERROR_MESSAGES.PARSE_ERROR)
        }
      })

      source.addEventListener('error', (e: Event & { data?: string }) => {
        // Only handle errors if stream didn't complete normally
        if (source.readyState !== 2) {
          // eslint-disable-next-line no-console
          console.error('SSE Error:', e)
          let errorMessage = e.data || ERROR_MESSAGES.API_REQUEST_ERROR
          let errorCode: string | undefined
          if (e.data) {
            try {
              const parsed = JSON.parse(e.data) as {
                error?: { message?: string; code?: string }
              }
              if (parsed?.error) {
                errorMessage = parsed.error.message || errorMessage
                errorCode = parsed.error.code || undefined
              }
            } catch {
              // not JSON, use raw string
            }
          }
          handleError(errorMessage, errorCode)
        }
      })

      source.addEventListener(
        'readystatechange',
        (e: Event & { readyState?: number }) => {
          const status = (source as unknown as { status?: number }).status
          if (e.readyState === undefined || e.readyState < 2) return

          if (status !== undefined && status !== 200) {
            handleError(`HTTP ${status}: ${ERROR_MESSAGES.CONNECTION_CLOSED}`)
            return
          }

          // Some upstream image streams close the SSE connection normally after
          // sending the final content but without a trailing [DONE]. Finalize on
          // normal close too, otherwise the image is persisted and appears after
          // refresh while the live bubble stays stuck on "responding".
          completeStream()
        }
      )

      try {
        source.stream()
      } catch (error: unknown) {
        // eslint-disable-next-line no-console
        console.error('Failed to start SSE stream:', error)
        onError(ERROR_MESSAGES.STREAM_START_ERROR)
        sseSourceRef.current = null
      }
    },
    []
  )

  const stopStream = useCallback(() => {
    if (sseSourceRef.current) {
      isStreamCompleteRef.current = true
      sseSourceRef.current.close()
      sseSourceRef.current = null
    }
  }, [])

  // eslint-disable-next-line react-hooks/refs
  const isStreaming = sseSourceRef.current !== null

  return {
    sendStreamRequest,
    stopStream,
    // eslint-disable-next-line react-hooks/refs
    isStreaming,
  }
}
