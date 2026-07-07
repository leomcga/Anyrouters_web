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
import { searchWeb, sendChatCompletion } from '../api'
import { MESSAGE_STATUS, ERROR_MESSAGES } from '../constants'
import {
  buildChatCompletionPayload,
  updateAssistantMessageWithError,
  updateLastAssistantMessage,
  updateMessageByKey,
  updateCurrentVersionContent,
  getTextContent,
  getCurrentVersion,
  findLatestGeneratedImage,
  offloadDataImagesToIdb,
  processStreamingContent,
  finalizeMessage,
  imageModelKind,
  aspectRatioToOpenAISize,
  aspectRatioToGemini,
  qualityToOpenAIQuality,
  videoAspectToSize,
  videoResolutionsForModel,
  videoDurationsForResolution,
  isOmniVideoModel,
  inferOmniVideoTask,
  DEFAULT_IMAGE_OPTIONS,
  DEFAULT_VIDEO_OPTIONS,
  type ImageGenOptions,
  type VideoGenOptions,
} from '../lib'
import {
  markGenerationActive,
  markGenerationDone,
} from '../lib/active-generations'
import { friendlyErrorMessage } from '../lib/friendly-error'
import {
  startGeminiImageGeneration,
  subscribeGeminiImageGeneration,
  activeGeminiImageGenerationsFor,
  cancelGeminiImageGeneration,
} from '../lib/gemini-image-gen-manager'
import {
  startImageGeneration,
  subscribeImageGeneration,
  activeGenerationsFor,
  cancelImageGeneration,
  type GenUpdate,
} from '../lib/image-gen-manager'
import { getImage } from '../lib/image-store'
import { patchSessionMessage } from '../lib/sessions'
import {
  startVideoGeneration,
  subscribeVideoGeneration,
  activeVideoGenerationsFor,
  cancelVideoGeneration,
} from '../lib/video-gen-manager'
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
  // Media generation is detached and should not lock the composer/workspace.
  // The state is still useful for rerendering when active media finishes.
  const [, setIsImageGenerating] = useState(false)
  // Live subscriptions to detached image/video generations (keyed by message).
  // We detach (not cancel) on unmount so generation keeps running in the manager.
  const imageGenUnsubsRef = useRef<Map<string, () => void>>(new Map())
  // Text streaming survives navigation too, but its SSE + tool loop are too
  // entangled to move into a manager without risking the core chat path. So we
  // take the light path: the SSE keeps running after unmount (same as images),
  // we register the message in active-generations so a remount doesn't flag it
  // "interrupted", accumulate the reply here, and write the final content
  // straight to localStorage on terminal — so the answer survives even though
  // the React callbacks are dead. Text is seconds-fast, so no live reconnect.
  const textGenKeyRef = useRef<string | null>(null)
  const textContentBufRef = useRef('')

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

          // Accumulate the visible reply so it can be written straight to
          // localStorage on terminal — the answer then survives navigating
          // away mid-stream (the React state this returns to may be dead).
          textContentBufRef.current += chunk

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

  // Begin tracking a text generation so it survives navigation: register its
  // message in active-generations (sanitize won't flag it "interrupted") and
  // reset the reply buffer.
  const beginTextGen = useCallback(
    (messages: Message[]) => {
      const key = [...messages]
        .reverse()
        .find((m) => m.from === 'assistant')?.key
      textContentBufRef.current = ''
      if (key && sessionId) {
        textGenKeyRef.current = key
        markGenerationActive(key)
      } else {
        textGenKeyRef.current = null
      }
    },
    [sessionId]
  )

  // Terminal write-through: persist the final text + status straight to
  // localStorage (survives an unmounted playground) and clear the active mark.
  const finalizeTextGen = useCallback(
    (status: 'complete' | 'error', content: string) => {
      const key = textGenKeyRef.current
      if (key && sessionId) {
        patchSessionMessage(sessionId, key, { content, status })
        markGenerationDone(key)
      }
      textGenKeyRef.current = null
    },
    [sessionId]
  )

  // Finalize the assistant message (terminal state). If the reply contains
  // generated images, store the bytes first and render lightweight idb refs.
  const finalizeAssistant = useCallback(async () => {
    const content = await offloadDataImagesToIdb(textContentBufRef.current)
    onMessageUpdate((prev) =>
      updateLastAssistantMessage(prev, (message) =>
        message.status === MESSAGE_STATUS.COMPLETE ||
        message.status === MESSAGE_STATUS.ERROR
          ? message
          : {
              ...finalizeMessage(updateCurrentVersionContent(message, content)),
              isSearching: false,
              status: MESSAGE_STATUS.COMPLETE,
            }
      )
    )
    finalizeTextGen('complete', content)
  }, [onMessageUpdate, finalizeTextGen])

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
      finalizeTextGen('error', friendly)
    },
    [onMessageUpdate, finalizeTextGen]
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
          const toolContent = await (async () => {
            if (tc.function.name !== 'web_search') {
              return `Tool "${tc.function.name}" is not available.`
            }
            const query = (() => {
              try {
                return (
                  (
                    JSON.parse(tc.function.arguments || '{}') as {
                      query?: string
                    }
                  ).query || ''
                )
              } catch {
                return tc.function.arguments || ''
              }
            })()
            try {
              const result = await searchWeb(String(query))
              return result.ok && result.context
                ? result.context
                : `Search failed: ${result.error || 'no results found'}`
            } catch {
              return 'Search failed: the search service is unavailable.'
            }
          })()
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
      beginTextGen(messages)
      const payload = buildChatCompletionPayload(
        messages,
        config,
        parameterEnabled,
        imageOptions
          ? (aspectRatioToGemini(imageOptions.aspectRatio) ?? undefined)
          : undefined,
        imageOptions?.resolution,
        referenceImages,
        imageOptions?.count
      )

      // One streaming turn; recurses while the model keeps calling web_search.
      const runTurn = (req: ChatCompletionRequest, depth: number) => {
        sendStreamRequest(
          req,
          handleStreamUpdate,
          (result: StreamResult) => {
            if (result.toolCalls.length === 0 || depth >= MAX_SEARCH_ROUNDS) {
              void finalizeAssistant()
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
      imageOptions,
      sendStreamRequest,
      handleStreamUpdate,
      finalizeAssistant,
      setSearching,
      runToolCalls,
      handleStreamError,
      beginTextGen,
    ]
  )

  // Send non-streaming chat request, looping through any web_search tool calls.
  const sendNonStreamingChat = useCallback(
    async (messages: Message[], referenceImages?: string[]) => {
      beginTextGen(messages)
      const payload = buildChatCompletionPayload(
        messages,
        config,
        parameterEnabled,
        imageOptions
          ? (aspectRatioToGemini(imageOptions.aspectRatio) ?? undefined)
          : undefined,
        imageOptions?.resolution,
        referenceImages,
        imageOptions?.count
      )
      // This is the NON-streaming sender: the payload MUST say stream:false.
      // buildChatCompletionPayload copies config.stream, so when we force
      // non-streaming for multi-image (config.stream is true) the request would
      // otherwise ask the gateway to STREAM — then this JSON reader sees an SSE
      // body, finds no `choices`, and the bubble hangs on "Responding…" forever.
      payload.stream = false

      try {
        for (let depth = 0; ; depth++) {
          const response = await sendChatCompletion(payload)
          const choice = response.choices?.[0]
          if (!choice) return
          const msg = choice.message
          const toolCalls = msg.tool_calls || []

          if (toolCalls.length === 0 || depth >= MAX_SEARCH_ROUNDS) {
            const content = await offloadDataImagesToIdb(msg.content || '')
            onMessageUpdate((prev) =>
              updateLastAssistantMessage(prev, (message) => ({
                ...finalizeMessage(
                  {
                    ...message,
                    isSearching: false,
                    versions: [{ ...message.versions[0], content }],
                  },
                  msg.reasoning_content
                ),
                status: MESSAGE_STATUS.COMPLETE,
              }))
            )
            finalizeTextGen('complete', content)
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
      imageOptions,
      onMessageUpdate,
      setSearching,
      runToolCalls,
      handleStreamError,
      beginTextGen,
      finalizeTextGen,
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

  // No image OR video generation still running detached for this session — i.e.
  // safe to re-enable the composer.
  const noMediaGenActive = useCallback(
    (sid: string) =>
      activeGenerationsFor(sid).length === 0 &&
      activeVideoGenerationsFor(sid).length === 0 &&
      activeGeminiImageGenerationsFor(sid).length === 0,
    []
  )

  // Bind a detached generation (image OR video) onto the right message (by key)
  // in React state, and settle the composer's "generating" flag on completion.
  // `subscribe` is the manager-specific subscribe fn; the returned unsubscribe
  // only detaches — it never stops the generation.
  const subscribeAndBind = useCallback(
    (
      messageKey: string,
      subscribe: (
        sid: string,
        key: string,
        cb: (u: GenUpdate) => void
      ) => () => void
    ): (() => void) => {
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
        if (
          u.status === MESSAGE_STATUS.COMPLETE ||
          u.status === MESSAGE_STATUS.ERROR
        ) {
          imageGenUnsubsRef.current.delete(messageKey)
          if (noMediaGenActive(sessionId)) setIsImageGenerating(false)
        }
      }
      setIsImageGenerating(true)
      return subscribe(sessionId, messageKey, apply)
    },
    [sessionId, onMessageUpdate, noMediaGenActive]
  )

  // Reconnect on mount / session switch: re-subscribe to any image OR video
  // generation still running for the active conversation (the user navigated
  // away and back), so its progress renders live and its final result lands —
  // instead of a stuck "Generation was interrupted".
  useEffect(() => {
    if (!sessionId) return
    activeGenerationsFor(sessionId).forEach((messageKey) => {
      if (imageGenUnsubsRef.current.has(messageKey)) return
      imageGenUnsubsRef.current.set(
        messageKey,
        subscribeAndBind(messageKey, subscribeImageGeneration)
      )
    })
    activeVideoGenerationsFor(sessionId).forEach((messageKey) => {
      if (imageGenUnsubsRef.current.has(messageKey)) return
      imageGenUnsubsRef.current.set(
        messageKey,
        subscribeAndBind(messageKey, subscribeVideoGeneration)
      )
    })
    activeGeminiImageGenerationsFor(sessionId).forEach((messageKey) => {
      if (imageGenUnsubsRef.current.has(messageKey)) return
      imageGenUnsubsRef.current.set(
        messageKey,
        subscribeAndBind(messageKey, subscribeGeminiImageGeneration)
      )
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
      const target = [...messages].reverse().find((m) => m.from === 'assistant')
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
          n: opts.count,
          images: refImages,
        },
      })
      // Run in the manager first, then subscribe. subscribeImageGeneration only
      // binds to an existing entry; subscribing before start would no-op and the
      // live bubble would stay "Responding..." until a refresh loaded storage.
      const unsubscribe = subscribeAndBind(messageKey, subscribeImageGeneration)
      imageGenUnsubsRef.current.set(messageKey, unsubscribe)
    },
    [
      config.model,
      config.group,
      imageOptions,
      sessionId,
      subscribeAndBind,
      handleStreamError,
      resolveReferenceImages,
    ]
  )

  // Gemini/Nano Banana generates images through chat/completions, but we still
  // run it detached like the dedicated image/video managers. That keeps the
  // result bound to the original assistant bubble even if the user switches
  // conversations or starts another generation.
  const sendGeminiImageGeneration = useCallback(
    async (messages: Message[]) => {
      const opts = imageOptions ?? DEFAULT_IMAGE_OPTIONS
      const lastUser = [...messages].reverse().find((m) => m.from === 'user')
      const prompt = lastUser
        ? getTextContent(getCurrentVersion(lastUser).content)
        : ''
      const target = [...messages].reverse().find((m) => m.from === 'assistant')
      const messageKey = target?.key
      if (!prompt.trim() || !messageKey || !sessionId) {
        handleStreamError(ERROR_MESSAGES.API_REQUEST_ERROR)
        return
      }

      const referenceImages = await resolveReferenceImages(messages)
      const count = Math.max(1, opts.count ?? 1)
      const makePayload = () => {
        const payload = buildChatCompletionPayload(
          messages,
          config,
          parameterEnabled,
          aspectRatioToGemini(opts.aspectRatio) ?? undefined,
          opts.resolution,
          referenceImages,
          1
        )
        payload.stream = false
        return payload
      }

      startGeminiImageGeneration({
        sessionId,
        messageKey,
        payloads: Array.from({ length: count }, makePayload),
        targetCount: count,
      })
      const unsubscribe = subscribeAndBind(
        messageKey,
        subscribeGeminiImageGeneration
      )
      imageGenUnsubsRef.current.set(messageKey, unsubscribe)
    },
    [
      config,
      parameterEnabled,
      imageOptions,
      sessionId,
      subscribeAndBind,
      handleStreamError,
      resolveReferenceImages,
    ]
  )

  // Generate a video via the async task pipeline: submit → poll until the task
  // completes → render the result as a <video> in the assistant bubble. Veo
  // carries duration/resolution/audio in metadata. Omni uses the Interactions
  // API shape: aspect ratio plus multimodal input and an inferred video task.
  const sendVideoGeneration = useCallback(
    async (messages: Message[]) => {
      const opts = videoOptions ?? DEFAULT_VIDEO_OPTIONS
      const omni = isOmniVideoModel(config.model)
      const lastUser = [...messages].reverse().find((m) => m.from === 'user')
      const prompt = lastUser
        ? getTextContent(getCurrentVersion(lastUser).content)
        : ''
      const target = [...messages].reverse().find((m) => m.from === 'assistant')
      const messageKey = target?.key
      if (!prompt.trim() || !messageKey || !sessionId) {
        handleStreamError(ERROR_MESSAGES.API_REQUEST_ERROR)
        return
      }
      const attachedImages = lastUser?.attachedImages ?? []

      // Safety net for Veo's per-model constraints (the composer already steers
      // these, but the selection can go stale across a model switch):
      //   - resolution must be one the model supports (4K is Fast-only);
      //   - 1080p / 4K only support an 8-second clip (720p allows 4/6/8).
      const allowedRes = videoResolutionsForModel(config.model)
      const resolution = allowedRes.includes(opts.resolution)
        ? opts.resolution
        : '720p'
      const allowedDur = videoDurationsForResolution(resolution, config.model)
      const duration = allowedDur.includes(opts.duration)
        ? opts.duration
        : allowedDur[allowedDur.length - 1]
      const alt = prompt
        .slice(0, 40)
        .replace(/[[\]()\n\r]/g, ' ')
        .trim()

      startVideoGeneration({
        sessionId,
        messageKey,
        alt,
        submitPayload: {
          model: config.model,
          prompt,
          images: omni
            ? attachedImages
            : attachedImages[0]
              ? [attachedImages[0]]
              : undefined,
          metadata: omni
            ? {
                aspectRatio: opts.aspectRatio,
                task: inferOmniVideoTask(attachedImages.length),
              }
            : {
                durationSeconds: duration,
                aspectRatio: opts.aspectRatio,
                resolution,
                generateAudio: opts.audio,
                // Explicit size fallback (backend prefers the fields above).
                size: videoAspectToSize(opts.aspectRatio, resolution),
              },
        },
      })
      // Same ordering as image generation: create the manager entry first, then
      // bind the mounted chat to it so terminal updates reach React state.
      const unsubscribe = subscribeAndBind(messageKey, subscribeVideoGeneration)
      imageGenUnsubsRef.current.set(messageKey, unsubscribe)
    },
    [config.model, videoOptions, sessionId, subscribeAndBind, handleStreamError]
  )

  // Send chat request. OpenAI-family image models (gpt-image-2) go through the
  // dedicated images endpoint; video models (Veo) use the async video task
  // pipeline; everything else (text models + Gemini in-chat image models)
  // streams or non-streams through chat/completions.
  const sendChat = useCallback(
    (messages: Message[]) => {
      // A new send is its own new message; any in-flight image/video generation
      // keeps running in its manager and lands on ITS OWN bubble (keyed by
      // message), so it can't clobber this turn — no supersede needed.
      // Clear any stale text-gen key so an image/video pre-flight error can't
      // write-through to a previous text turn's message.
      textGenKeyRef.current = null
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
        void sendGeminiImageGeneration(messages)
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
      sendGeminiImageGeneration,
      sendVideoGeneration,
      sendStreamingChat,
      sendNonStreamingChat,
    ]
  )

  // Stop generation
  const stopGeneration = useCallback(() => {
    stopStream()
    // Settle an in-flight text stream: persist whatever streamed so far and
    // clear its active mark so a remount doesn't see it as still-running.
    finalizeTextGen('complete', textContentBufRef.current)
    // Cancel any in-flight image/video generations for this session in their
    // managers (image keeps a partial or aborts cleanly; video stops polling)
    // so the composer re-enables via the manager's terminal update.
    if (sessionId) {
      activeGenerationsFor(sessionId).forEach((messageKey) =>
        cancelImageGeneration(sessionId, messageKey)
      )
      activeVideoGenerationsFor(sessionId).forEach((messageKey) =>
        cancelVideoGeneration(sessionId, messageKey)
      )
      activeGeminiImageGenerationsFor(sessionId).forEach((messageKey) =>
        cancelGeminiImageGeneration(sessionId, messageKey)
      )
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
  }, [stopStream, onMessageUpdate, sessionId, finalizeTextGen])

  return {
    sendChat,
    stopGeneration,
    // Detached media generations should not lock the workspace or composer.
    // Only text streaming keeps the stop/disabled state.
    isGenerating: isStreaming,
  }
}
