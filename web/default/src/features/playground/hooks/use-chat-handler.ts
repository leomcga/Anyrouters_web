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
import { useCallback } from 'react'
import { toast } from 'sonner'
import { searchWeb, sendChatCompletion } from '../api'
import { MESSAGE_STATUS, ERROR_MESSAGES } from '../constants'
import {
  buildChatCompletionPayload,
  updateAssistantMessageWithError,
  updateLastAssistantMessage,
  processStreamingContent,
  finalizeMessage,
} from '../lib'
import type {
  Message,
  PlaygroundConfig,
  ParameterEnabled,
  ChatCompletionRequest,
  ToolCall,
} from '../types'
import { useStreamRequest, type StreamResult } from './use-stream-request'

// Hard cap on web-search rounds per turn, so a model that keeps calling the
// tool can never loop forever. On the final round we drop the tool so the model
// must answer in text.
const MAX_SEARCH_ROUNDS = 4

interface UseChatHandlerOptions {
  config: PlaygroundConfig
  parameterEnabled: ParameterEnabled
  onMessageUpdate: (updater: (prev: Message[]) => Message[]) => void
}

/**
 * Hook for handling chat message sending and receiving
 */
export function useChatHandler({
  config,
  parameterEnabled,
  onMessageUpdate,
}: UseChatHandlerOptions) {
  const { sendStreamRequest, stopStream, isStreaming } = useStreamRequest()

  // Handle stream update
  const handleStreamUpdate = useCallback(
    (type: 'reasoning' | 'content', chunk: string) => {
      onMessageUpdate((prev) =>
        updateLastAssistantMessage(prev, (message) => {
          if (message.status === MESSAGE_STATUS.ERROR) return message

          // Any streamed token means the model is now answering: clear the
          // transient "searching the web" indicator from the prior round.
          const base = message.isSearching
            ? { ...message, isSearching: false }
            : message

          if (type === 'reasoning') {
            // Direct API reasoning_content
            return {
              ...base,
              reasoning: {
                content: (base.reasoning?.content || '') + chunk,
                duration: 0,
              },
              isReasoningStreaming: true,
              status: MESSAGE_STATUS.STREAMING,
            }
          }

          // Content streaming: handle <think> tags
          return {
            ...processStreamingContent(base, chunk),
            status: MESSAGE_STATUS.STREAMING,
          }
        })
      )
    },
    [onMessageUpdate]
  )

  // Finalize the assistant message (terminal state)
  const finalizeAssistant = useCallback(() => {
    onMessageUpdate((prev) =>
      updateLastAssistantMessage(prev, (message) =>
        message.status === MESSAGE_STATUS.COMPLETE ||
        message.status === MESSAGE_STATUS.ERROR
          ? message
          : {
              ...finalizeMessage(message),
              isSearching: false,
              status: MESSAGE_STATUS.COMPLETE,
            }
      )
    )
  }, [onMessageUpdate])

  // Handle stream error
  const handleStreamError = useCallback(
    (error: string, errorCode?: string) => {
      toast.error(error)
      onMessageUpdate((prev) =>
        updateAssistantMessageWithError(prev, error, errorCode)
      )
    },
    [onMessageUpdate]
  )

  // Toggle the "searching the web" indicator on the live assistant message.
  const setSearching = useCallback(
    (on: boolean) => {
      onMessageUpdate((prev) =>
        updateLastAssistantMessage(prev, (message) =>
          message.status === MESSAGE_STATUS.ERROR
            ? message
            : { ...message, isSearching: on, status: MESSAGE_STATUS.STREAMING }
        )
      )
    },
    [onMessageUpdate]
  )

  // Append the assistant's tool-call turn plus the result of each web_search to
  // the payload, so the next model turn can ground its answer in them. Runs the
  // searches in parallel. Mutates payload.messages in place.
  const runToolCalls = useCallback(
    async (
      payload: ChatCompletionRequest,
      content: string,
      toolCalls: ToolCall[]
    ) => {
      payload.messages.push({
        role: 'assistant',
        content: content ? content : null,
        tool_calls: toolCalls,
      })

      await Promise.all(
        toolCalls.map(async (tc) => {
          let toolContent = 'No result.'
          if (tc.function.name === 'web_search') {
            let query = ''
            try {
              query =
                (JSON.parse(tc.function.arguments || '{}') as { query?: string })
                  .query || ''
            } catch {
              query = tc.function.arguments || ''
            }
            try {
              const r = await searchWeb(String(query))
              toolContent =
                r.ok && r.context
                  ? r.context
                  : `Search failed: ${r.error || 'no results found'}`
            } catch {
              toolContent = 'Search failed: the search service is unavailable.'
            }
          } else {
            toolContent = `Tool "${tc.function.name}" is not available.`
          }
          payload.messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: toolContent,
          })
        })
      )
    },
    []
  )

  // Send streaming chat request, looping through any web_search tool calls.
  const sendStreamingChat = useCallback(
    (messages: Message[]) => {
      const payload = buildChatCompletionPayload(
        messages,
        config,
        parameterEnabled
      )

      // One streaming turn; recurses while the model keeps calling web_search.
      const runTurn = (req: ChatCompletionRequest, depth: number) => {
        sendStreamRequest(
          req,
          handleStreamUpdate,
          (result: StreamResult) => {
            if (result.toolCalls.length === 0 || depth >= MAX_SEARCH_ROUNDS) {
              finalizeAssistant()
              return
            }
            // The model asked to search — run it, then continue the turn.
            setSearching(true)
            runToolCalls(req, result.content, result.toolCalls)
              .then(() => {
                const nextDepth = depth + 1
                // Last allowed round: drop the tool so the model must answer.
                if (nextDepth >= MAX_SEARCH_ROUNDS) {
                  delete req.tools
                }
                runTurn(req, nextDepth)
              })
              .catch(() => handleStreamError(ERROR_MESSAGES.API_REQUEST_ERROR))
          },
          handleStreamError
        )
      }

      runTurn(payload, 0)
    },
    [
      config,
      parameterEnabled,
      sendStreamRequest,
      handleStreamUpdate,
      finalizeAssistant,
      setSearching,
      runToolCalls,
      handleStreamError,
    ]
  )

  // Send non-streaming chat request, looping through any web_search tool calls.
  const sendNonStreamingChat = useCallback(
    async (messages: Message[]) => {
      const payload = buildChatCompletionPayload(
        messages,
        config,
        parameterEnabled
      )

      try {
        for (let depth = 0; ; depth++) {
          const response = await sendChatCompletion(payload)
          const choice = response.choices?.[0]
          if (!choice) return
          const msg = choice.message
          const toolCalls = msg.tool_calls || []

          if (toolCalls.length === 0 || depth >= MAX_SEARCH_ROUNDS) {
            onMessageUpdate((prev) =>
              updateLastAssistantMessage(prev, (message) => ({
                ...finalizeMessage(
                  {
                    ...message,
                    isSearching: false,
                    versions: [
                      { ...message.versions[0], content: msg.content || '' },
                    ],
                  },
                  msg.reasoning_content
                ),
                status: MESSAGE_STATUS.COMPLETE,
              }))
            )
            return
          }

          setSearching(true)
          await runToolCalls(payload, msg.content || '', toolCalls)
          if (depth + 1 >= MAX_SEARCH_ROUNDS) {
            delete payload.tools
          }
        }
      } catch (error: unknown) {
        const err = error as {
          response?: {
            data?: { message?: string; error?: { code?: string } }
          }
          message?: string
        }
        handleStreamError(
          err?.response?.data?.message ||
            err?.message ||
            ERROR_MESSAGES.API_REQUEST_ERROR,
          err?.response?.data?.error?.code || undefined
        )
      }
    },
    [
      config,
      parameterEnabled,
      onMessageUpdate,
      setSearching,
      runToolCalls,
      handleStreamError,
    ]
  )

  // Send chat request (stream or non-stream based on config)
  const sendChat = useCallback(
    (messages: Message[]) => {
      if (config.stream) {
        sendStreamingChat(messages)
      } else {
        sendNonStreamingChat(messages)
      }
    },
    [config.stream, sendStreamingChat, sendNonStreamingChat]
  )

  // Stop generation
  const stopGeneration = useCallback(() => {
    stopStream()
    onMessageUpdate((prev) =>
      updateLastAssistantMessage(prev, (message) =>
        message.status === MESSAGE_STATUS.LOADING ||
        message.status === MESSAGE_STATUS.STREAMING
          ? {
              ...finalizeMessage(message),
              isSearching: false,
              status: MESSAGE_STATUS.COMPLETE,
            }
          : message
      )
    )
  }, [stopStream, onMessageUpdate])

  return {
    sendChat,
    stopGeneration,
    isGenerating: isStreaming,
  }
}
