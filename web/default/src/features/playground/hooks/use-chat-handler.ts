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
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  searchWeb,
  sendChatCompletion,
  submitVideoTask,
  fetchVideoTask,
  videoContentUrl,
} from '../api'
import { putVideoFromUrl } from '../lib/video-store'
import { getImage } from '../lib/image-store'
import { MESSAGE_STATUS, ERROR_MESSAGES } from '../constants'
import { friendlyErrorMessage } from '../lib/friendly-error'
import {
  startImageGeneration,
  subscribeImageGeneration,
  activeGenerationsFor,
  cancelImageGeneration,
  type GenUpdate,
} from '../lib/image-gen-manager'
import {
  buildChatCompletionPayload,
  updateAssistantMessageWithError,
  updateLastAssistantMessage,
  updateMessageByKey,
  updateCurrentVersionContent,
  getTextContent,
  getCurrentVersion,
  findLatestGeneratedImage,
  processStreamingContent,
  finalizeMessage,
  imageModelKind,
  aspectRatioToOpenAISize,
  aspectRatioToGemini,
  qualityToOpenAIQuality,
  videoAspectToSize,
  videoResolutionsForModel,
  videoDurationsForResolution,
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
  // The active conversation id — image generation is keyed by (session,
  // message) so a detached generation persists to the right conversation and a
  // remounted playground can reconnect to it.
  sessionId?: string
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
  sessionId,
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
  // Live subscriptions to detached image generations (keyed by message). We
  // detach (not cancel) on unmount so the SSE keeps running in the manager.
  const imageGenUnsubsRef = useRef<Map<string, () => void>>(new Map())

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
      // Humanize raw upstream errors (Azure safety-system dumps, rate limits,
      // auth) before they ever reach the user — otherwise the bubble shows scary
      // internal boilerplate naming Azure + an internal request id.
      const friendly = friendlyErrorMessage(error)
      toast.error(friendly)
      onMessageUpdate((prev) =>
        updateAssistantMessageWithError(prev, friendly, errorCode)
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
    (messages: Message[], referenceImages?: string[]) => {
      const payload = buildChatCompletionPayload(
        messages,
        config,
        parameterEnabled,
        imageOptions
          ? (aspectRatioToGemini(imageOptions.aspectRatio) ?? undefined)
          : undefined,
        imageOptions?.resolution,
        referenceImages
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
    async (messages: Message[], referenceImages?: string[]) => {
      const payload = buildChatCompletionPayload(
        messages,
        config,
        parameterEnabled,
        imageOptions
          ? (aspectRatioToGemini(imageOptions.aspectRatio) ?? undefined)
          : undefined,
        imageOptions?.resolution,
        referenceImages
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

  // Shared reference-image rule for ALL image models (gpt-image-2 AND
  // Gemini/Nano — deliberately identical behavior): ① the user's attached
  // images (idbimg:// refs from a restored session resolve to data URLs; the
  // old per-path logic silently dropped them) ② otherwise the newest generated
  // image in this conversation — chat-native multi-turn editing, so "把猫猫改成
  // 暹罗猫" edits the picture above instead of drawing a fresh unrelated one.
  const resolveReferenceImages = useCallback(
    async (messages: Message[]): Promise<string[]> => {
      const lastUser = [...messages].reverse().find((m) => m.from === 'user')
      const attachedRefs = lastUser?.attachedImages ?? []
      const resolved = (
        await Promise.all(attachedRefs.map((s) => getImage(s)))
      ).filter(Boolean) as string[]
      if (resolved.length > 0) return resolved
      const lastGenerated = findLatestGeneratedImage(messages)
      if (lastGenerated) {
        const url = await getImage(lastGenerated)
        if (url) return [url]
      }
      return []
    },
    []
  )

  // Bind a detached generation's updates onto the right message (by key) in
  // React state, and settle the composer's "generating" flag on completion.
  // Returned unsubscribe only detaches — it never stops the generation.
  const subscribeAndBind = useCallback(
    (messageKey: string): (() => void) => {
      if (!sessionId) return () => {}
      const apply = (u: GenUpdate) => {
        onMessageUpdate((prev) =>
          updateMessageByKey(prev, messageKey, (message) => ({
            ...updateCurrentVersionContent(message, u.content),
            isSearching: false,
            imageDegraded: u.imageDegraded ?? false,
            status: u.status,
          }))
        )
        if (u.status === MESSAGE_STATUS.COMPLETE || u.status === MESSAGE_STATUS.ERROR) {
          imageGenUnsubsRef.current.delete(messageKey)
          if (activeGenerationsFor(sessionId).length === 0) {
            setIsImageGenerating(false)
          }
        }
      }
      setIsImageGenerating(true)
      return subscribeImageGeneration(sessionId, messageKey, apply)
    },
    [sessionId, onMessageUpdate]
  )

  // Reconnect on mount / session switch: re-subscribe to any generation still
  // running for the active conversation (the user navigated away and back), so
  // its progress renders live and its final image lands — instead of a stuck
  // "Generation was interrupted".
  useEffect(() => {
    if (!sessionId) return
    const running = activeGenerationsFor(sessionId)
    running.forEach((messageKey) => {
      if (imageGenUnsubsRef.current.has(messageKey)) return
      imageGenUnsubsRef.current.set(messageKey, subscribeAndBind(messageKey))
    })
  }, [sessionId, subscribeAndBind])

  // Detach all live subscriptions on unmount (generations keep running in the
  // manager and persist their results straight to storage).
  useEffect(() => {
    const unsubs = imageGenUnsubsRef.current
    return () => {
      unsubs.forEach((fn) => fn())
      unsubs.clear()
    }
  }, [])

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

      const refImages = await resolveReferenceImages(messages)
      // The assistant bubble this generation fills. Keyed so a detached
      // generation (playground unmounted mid-flight) lands on the right message.
      const target = [...messages]
        .reverse()
        .find((m) => m.from === 'assistant')
      const messageKey = target?.key
      if (!messageKey || !sessionId) {
        handleStreamError(ERROR_MESSAGES.API_REQUEST_ERROR)
        return
      }

      setIsImageGenerating(true)
      // Sanitize the alt text: strip chars that would break ![alt](url)
      // parsing in response.tsx (brackets/parens/newlines), since the prompt
      // is arbitrary user input.
      const alt = prompt
        .slice(0, 40)
        .replace(/[[\]()\n\r]/g, ' ')
        .trim()

      // Run the generation in the module-level manager so it survives navigation
      // away from /playground: the SSE lives outside this component, results
      // persist straight to storage, and a remount reconnects (see the effect
      // below). We subscribe here to drive live React state (blur / pill).
      const unsubscribe = subscribeAndBind(messageKey)
      imageGenUnsubsRef.current.set(messageKey, unsubscribe)
      startImageGeneration({
        sessionId,
        messageKey,
        alt,
        payload: {
          model: config.model,
          group: config.group,
          prompt,
          size: aspectRatioToOpenAISize(opts.aspectRatio),
          quality: qualityToOpenAIQuality(opts.quality),
          n: 1,
          images: refImages,
        },
      })
    },
    [
      config.model,
      config.group,
      imageOptions,
      sessionId,
      subscribeAndBind,
      handleStreamError,
    ]
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
      // Safety net for Veo's per-model constraints (the composer already steers
      // these, but the selection can go stale across a model switch):
      //   - resolution must be one the model supports (4K is Fast-only);
      //   - 1080p / 4K only support an 8-second clip (720p allows 4/6/8).
      const allowedRes = videoResolutionsForModel(config.model)
      const resolution = allowedRes.includes(opts.resolution)
        ? opts.resolution
        : '720p'
      const allowedDur = videoDurationsForResolution(resolution)
      const duration = allowedDur.includes(opts.duration)
        ? opts.duration
        : allowedDur[allowedDur.length - 1]
      try {
        const { id } = await submitVideoTask({
          model: config.model,
          prompt,
          images: firstImage ? [firstImage] : undefined,
          metadata: {
            durationSeconds: duration,
            aspectRatio: opts.aspectRatio,
            resolution,
            generateAudio: opts.audio,
            // Explicit size fallback (backend prefers the fields above).
            size: videoAspectToSize(opts.aspectRatio, resolution),
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
      if (kind === 'gemini') {
        // Nano Banana rides the chat endpoint, but reference images follow the
        // SAME rule as gpt-image-2 (resolveReferenceImages): history images
        // are stripped to placeholders before sending, so without explicit
        // injection the model never actually sees the picture being edited —
        // it just redraws from the previous prompt text and details drift.
        void (async () => {
          const refs = await resolveReferenceImages(messages)
          if (config.stream) {
            sendStreamingChat(messages, refs)
          } else {
            void sendNonStreamingChat(messages, refs)
          }
        })()
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
      resolveReferenceImages,
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
    // Settle any in-flight image generations for this session: cancel each in
    // the manager (keeps a partial, flagged degraded, or aborts cleanly) so the
    // composer re-enables. The manager's terminal update flips isImageGenerating.
    if (sessionId) {
      activeGenerationsFor(sessionId).forEach((messageKey) =>
        cancelImageGeneration(sessionId, messageKey)
      )
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
  }, [stopStream, onMessageUpdate, sessionId])

  return {
    sendChat,
    stopGeneration,
    // Either a streaming chat turn or a (non-streamed) image generation is
    // in-flight — both should drive the composer's "generating" UI.
    isGenerating: isStreaming || isImageGenerating,
  }
}
