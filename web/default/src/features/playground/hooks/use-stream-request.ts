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
import {
  canCompleteClosedStream,
  consumeStreamChunk,
  createStreamTerminalState,
} from '../lib/stream-terminal'
import type {
  ChatCompletionUsage,
  ChatCompletionRequest,
  ChatCompletionChunk,
  StreamFinishReason,
  StreamTerminationReason,
  ToolCall,
} from '../types'

// What a single streamed turn produced: the text shown to the user plus any
// tool calls the model emitted (used by the chat handler's web-search loop).
export interface StreamResult {
  content: string
  toolCalls: ToolCall[]
  finishReason?: StreamFinishReason
  terminationReason: StreamTerminationReason
  requestId?: string
  usage?: ChatCompletionUsage
}

interface ActiveStream {
  source: SSE
  stop: () => void
}

/**
 * Hook for handling streaming chat completion requests
 */
export function useStreamRequest() {
  const activeStreamRef = useRef<ActiveStream | null>(null)

  const sendStreamRequest = useCallback(
    (
      payload: ChatCompletionRequest,
      onUpdate: (type: 'reasoning' | 'content', chunk: string) => void,
      onComplete: (result: StreamResult) => void,
      onError: (
        error: string,
        errorCode?: string,
        partialResult?: StreamResult
      ) => void
    ) => {
      const source = new SSE(API_ENDPOINTS.CHAT_COMPLETIONS, {
        headers: getCommonHeaders(),
        method: 'POST',
        payload: JSON.stringify(payload),
      })

      // Accumulate this turn's text and any streamed tool calls. Tool-call
      // deltas arrive in fragments: the first carries id+name, the rest append
      // to `arguments` (see the OpenAI streaming format).
      let contentBuf = ''
      let sawDone = false
      let settled = false
      let terminalState = createStreamTerminalState()
      const toolAcc: Array<{ id: string; name: string; args: string }> = []

      const closeSource = () => {
        source.close()
        if (activeStreamRef.current?.source === source) {
          activeStreamRef.current = null
        }
      }

      const settleSource = () => {
        if (settled) return false
        settled = true
        closeSource()
        return true
      }

      activeStreamRef.current = {
        source,
        stop: () => {
          settleSource()
        },
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
        finishReason: terminalState.finishReason,
        terminationReason:
          (terminalState.finishReason as StreamTerminationReason | undefined) ??
          'stop',
        requestId: terminalState.requestId,
        usage: terminalState.usage,
      })

      const completeStream = () => {
        if (!settleSource()) return
        onComplete(buildResult())
      }

      const handleError = (errorMessage: string, errorCode?: string) => {
        if (!settleSource()) return
        onError(errorMessage, errorCode, {
          ...buildResult(),
          terminationReason:
            errorCode === 'upstream_timeout'
              ? 'upstream_timeout'
              : 'network_error',
        })
      }

      source.addEventListener('message', (e: MessageEvent) => {
        if (settled) return

        if (e.data === '[DONE]') {
          sawDone = true
          completeStream()
          return
        }

        try {
          const chunk: ChatCompletionChunk = JSON.parse(e.data)
          terminalState = consumeStreamChunk(terminalState, chunk)
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
        if (settled) return

        // A failed SSE is often already CLOSED by the time the error event is
        // delivered. `settled` distinguishes that failure from our own normal
        // close, so do not ignore readyState === CLOSED or the run can remain
        // generating forever when no later readystatechange event follows.
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
      })

      source.addEventListener(
        'readystatechange',
        (e: Event & { readyState?: number }) => {
          if (settled) return

          const status = (source as unknown as { status?: number }).status
          if (e.readyState === undefined || e.readyState < 2) return

          if (status !== undefined && status !== 200) {
            handleError(`HTTP ${status}: ${ERROR_MESSAGES.CONNECTION_CLOSED}`)
            return
          }

          if (canCompleteClosedStream(terminalState, sawDone)) {
            completeStream()
          } else {
            handleError(ERROR_MESSAGES.CONNECTION_CLOSED, 'network_error')
          }
        }
      )

      try {
        source.stream()
      } catch (error: unknown) {
        // eslint-disable-next-line no-console
        console.error('Failed to start SSE stream:', error)
        handleError(ERROR_MESSAGES.STREAM_START_ERROR, 'network_error')
      }
    },
    []
  )

  const stopStream = useCallback(() => {
    activeStreamRef.current?.stop()
  }, [])

  return {
    sendStreamRequest,
    stopStream,
  }
}
