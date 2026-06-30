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
import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  searchWeb,
  sendChatCompletion,
  generateImage,
  submitVideoTask,
  fetchVideoTask,
  videoContentUrl,
} from '../api'
import { putVideoFromUrl } from '../lib/video-store'
import { MESSAGE_STATUS, ERROR_MESSAGES } from '../constants'
import {
  buildChatCompletionPayload,
  updateAssistantMessageWithError,
  updateLastAssistantMessage,
  updateCurrentVersionContent,
  getTextContent,
  getCurrentVersion,
  processStreamingContent,
  finalizeMessage,
  imageModelKind,
  aspectRatioToOpenAISize,
  aspectRatioToGemini,
  qualityToOpenAIQuality,
  videoAspectToSize,
  DEFAULT_IMAGE_OPTIONS,
  DEFAULT_VIDEO_OPTIONS,
  type ImageGenOptions,
  type VideoGenOptions,
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
  // In-chat image-generation options (aspect ratio / quality). Used when the
  // selected model is an image model.
  imageOptions?: ImageGenOptions
  // Video-generation options (duration / resolution / aspect ratio / audio).
  // Used when the selected model is a video model (Veo).
  videoOptions?: VideoGenOptions
}

/**
 * Hook for handling chat message sending and receiving
 */
export function useChatHandler({
  config,
  parameterEnabled,
  onMessageUpdate,
  imageOptions,
  videoOptions,
}: UseChatHandlerOptions) {
  const { sendStreamRequest, stopStream, isStreaming } = useStreamRequest()
  // gpt-image-2 generation doesn't go through SSE, so track its in-flight state
  // separately to keep the composer's "generating" UI (disabled input) honest.
  const [isImageGenerating, setIsImageGenerating] = useState(false)
  // Veo polling runs outside SSE, so Stop can't go through stopStream(). This
  // ref is tripped by stopGeneration() to abort the in-flight poll loop, and
  // also pins the result to the bubble that was generating (so a video that
  // lands minutes later can't clobber a newer message the user sent meanwhile).
  const videoPollRef = useRef<{ aborted: boolean } | null>(null)

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
        parameterEnabled,
        imageOptions
          ? (aspectRatioToGemini(imageOptions.aspectRatio) ?? undefined)
          : undefined,
        imageOptions?.resolution
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
      imageOptions?.aspectRatio,
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
        parameterEnabled,
        imageOptions
          ? (aspectRatioToGemini(imageOptions.aspectRatio) ?? undefined)
          : undefined,
        imageOptions?.resolution
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
      imageOptions?.aspectRatio,
      onMessageUpdate,
      setSearching,
      runToolCalls,
      handleStreamError,
    ]
  )

  // Send a one-shot image generation for OpenAI-family image models (gpt-image-2,
  // dall-e-*), which only work on the dedicated images endpoint and reject
  // chat/completions. The latest user message's text is the prompt; aspect ratio
  // and quality map to the endpoint's discrete size + quality. The returned image
  // is rendered into the assistant bubble as a markdown data-image, identical to
  // how Gemini's in-chat images render (response.tsx).
  const sendImageGeneration = useCallback(
    async (messages: Message[]) => {
      const opts = imageOptions ?? DEFAULT_IMAGE_OPTIONS
      // The prompt is the last user message's text.
      const lastUser = [...messages].reverse().find((m) => m.from === 'user')
      const prompt = lastUser
        ? getTextContent(getCurrentVersion(lastUser).content)
        : ''
      if (!prompt.trim()) {
        handleStreamError(ERROR_MESSAGES.API_REQUEST_ERROR)
        return
      }

      setIsImageGenerating(true)
      try {
        const urls = await generateImage({
          model: config.model,
          group: config.group,
          prompt,
          size: aspectRatioToOpenAISize(opts.aspectRatio),
          quality: qualityToOpenAIQuality(opts.quality),
          n: 1,
        })
        if (!urls.length) {
          handleStreamError(ERROR_MESSAGES.API_REQUEST_ERROR)
          return
        }
        // Sanitize the alt text: strip chars that would break ![alt](url)
        // parsing in response.tsx (brackets/parens/newlines), since the prompt
        // is arbitrary user input.
        const alt = prompt
          .slice(0, 40)
          .replace(/[[\]()\n\r]/g, ' ')
          .trim()
        const markdown = urls.map((u) => `![${alt}](${u})`).join('\n\n')
        onMessageUpdate((prev) =>
          updateLastAssistantMessage(prev, (message) => ({
            ...updateCurrentVersionContent(message, markdown),
            isSearching: false,
            status: MESSAGE_STATUS.COMPLETE,
          }))
        )
      } catch (error: unknown) {
        const err = error as {
          response?: { data?: { error?: { message?: string; code?: string } } }
          message?: string
        }
        handleStreamError(
          err?.response?.data?.error?.message ||
            err?.message ||
            ERROR_MESSAGES.API_REQUEST_ERROR,
          err?.response?.data?.error?.code || undefined
        )
      } finally {
        setIsImageGenerating(false)
      }
    },
    [config.model, config.group, imageOptions, onMessageUpdate, handleStreamError]
  )

  // Generate a video (Veo) via the async task pipeline: submit → poll until the
  // task completes → render the result as a <video> in the assistant bubble.
  // Veo params (duration / resolution / aspect / audio) ride in `metadata`. An
  // attached image on the latest user message enables image-to-video.
  const sendVideoGeneration = useCallback(
    async (messages: Message[]) => {
      const opts = videoOptions ?? DEFAULT_VIDEO_OPTIONS
      const lastUser = [...messages].reverse().find((m) => m.from === 'user')
      const prompt = lastUser
        ? getTextContent(getCurrentVersion(lastUser).content)
        : ''
      if (!prompt.trim()) {
        handleStreamError(ERROR_MESSAGES.API_REQUEST_ERROR)
        return
      }
      // Optional first frame for image-to-video (a data URL the user attached).
      const firstImage = lastUser?.attachedImages?.[0]

      // Fresh abort token for this run. Stop or a subsequent send trips it, so a
      // late-landing result is dropped instead of overwriting a newer bubble.
      const token = { aborted: false }
      videoPollRef.current = token

      setIsImageGenerating(true)
      // Show an interim "generating video…" note in the assistant bubble.
      onMessageUpdate((prev) =>
        updateLastAssistantMessage(prev, (message) => ({
          ...message,
          isSearching: false,
          status: MESSAGE_STATUS.STREAMING,
        }))
      )
      // Veo constraint (Google): 1080p only supports 8-second clips; a 4s/6s
      // request at 1080p is rejected upstream. Force 8s when 1080p is chosen so
      // the user never hits that error.
      const duration =
        opts.resolution === '1080p' ? 8 : opts.duration
      try {
        const { id } = await submitVideoTask({
          model: config.model,
          prompt,
          images: firstImage ? [firstImage] : undefined,
          metadata: {
            durationSeconds: duration,
            aspectRatio: opts.aspectRatio,
            resolution: opts.resolution,
            generateAudio: opts.audio,
            // Explicit size fallback (backend prefers the fields above).
            size: videoAspectToSize(opts.aspectRatio, opts.resolution),
          },
        })
        if (!id) {
          handleStreamError(ERROR_MESSAGES.API_REQUEST_ERROR)
          return
        }

        // Poll until terminal. Veo clips take ~30s–3min; cap at ~5min.
        const deadline = Date.now() + 5 * 60 * 1000
        const intervalMs = 4000
        // eslint-disable-next-line no-constant-condition
        while (true) {
          await new Promise((r) => setTimeout(r, intervalMs))
          // Stopped, or superseded by a newer send → drop this run silently
          // (don't touch the bubble; it may now belong to a different message).
          if (token.aborted) return
          const { status, failReason } = await fetchVideoTask(id)
          if (token.aborted) return
          if (status === 'succeeded') {
            const alt = prompt
              .slice(0, 40)
              .replace(/[[\]()\n\r]/g, ' ')
              .trim()
            // Persist the mp4 bytes locally (LRU 20) so the clip survives a
            // refresh after the upstream task proxy expires. Falls back to the
            // live proxy URL if the download/IndexedDB write fails.
            const ref = await putVideoFromUrl(videoContentUrl(id))
            if (token.aborted) return
            const markdown = `!video[${alt}](${ref})`
            onMessageUpdate((prev) =>
              updateLastAssistantMessage(prev, (message) => ({
                ...updateCurrentVersionContent(message, markdown),
                isSearching: false,
                status: MESSAGE_STATUS.COMPLETE,
              }))
            )
            return
          }
          if (status === 'failed') {
            handleStreamError(failReason || ERROR_MESSAGES.API_REQUEST_ERROR)
            return
          }
          if (Date.now() > deadline) {
            handleStreamError(ERROR_MESSAGES.API_REQUEST_ERROR)
            return
          }
        }
      } catch (error: unknown) {
        const err = error as {
          response?: { data?: { error?: { message?: string; code?: string } } }
          message?: string
        }
        handleStreamError(
          err?.response?.data?.error?.message ||
            err?.message ||
            ERROR_MESSAGES.API_REQUEST_ERROR,
          err?.response?.data?.error?.code || undefined
        )
      } finally {
        // Only clear the in-flight UI state if this run is still the current
        // one (a newer run may have replaced the ref).
        if (videoPollRef.current === token) {
          videoPollRef.current = null
          setIsImageGenerating(false)
        }
      }
    },
    [config.model, videoOptions, onMessageUpdate, handleStreamError]
  )

  // Send chat request. OpenAI-family image models (gpt-image-2) go through the
  // dedicated images endpoint; video models (Veo) use the async video task
  // pipeline; everything else (text models + Gemini in-chat image models)
  // streams or non-streams through chat/completions.
  const sendChat = useCallback(
    (messages: Message[]) => {
      // Any new send supersedes an in-flight video poll (its result must not
      // land on this newer turn's bubble).
      if (videoPollRef.current) videoPollRef.current.aborted = true
      const kind = imageModelKind(config.model)
      if (kind === 'video') {
        void sendVideoGeneration(messages)
        return
      }
      if (kind === 'openai') {
        void sendImageGeneration(messages)
        return
      }
      if (config.stream) {
        sendStreamingChat(messages)
      } else {
        sendNonStreamingChat(messages)
      }
    },
    [
      config.model,
      config.stream,
      sendImageGeneration,
      sendVideoGeneration,
      sendStreamingChat,
      sendNonStreamingChat,
    ]
  )

  // Stop generation
  const stopGeneration = useCallback(() => {
    stopStream()
    // Abort an in-flight Veo poll loop (it runs outside SSE) and clear its UI
    // state so the composer re-enables.
    if (videoPollRef.current) {
      videoPollRef.current.aborted = true
      videoPollRef.current = null
      setIsImageGenerating(false)
    }
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
    // Either a streaming chat turn or a (non-streamed) image generation is
    // in-flight — both should drive the composer's "generating" UI.
    isGenerating: isStreaming || isImageGenerating,
  }
}
