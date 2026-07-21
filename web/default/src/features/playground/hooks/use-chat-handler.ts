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
  appendTerminalError,
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
import {
  isToolLoopCancelledError,
  runChatToolLoop,
  type ToolLoopPhase,
  type ToolLoopTurnResult,
} from '../lib/chat-tool-loop'
import { friendlyErrorMessage } from '../lib/friendly-error'
import {
  startGeminiImageGeneration,
  subscribeGeminiImageGeneration,
  activeGeminiImageGenerationsFor,
  cancelGeminiImageGeneration,
} from '../lib/gemini-image-gen-manager'
import { prepareGeminiReferenceImages } from '../lib/gemini-reference-images'
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
  StreamTerminationReason,
} from '../types'
import { useStreamRequest, type StreamResult } from './use-stream-request'

// Hard cap on web-search rounds per turn, so a model that keeps calling the
// tool can never loop forever. On the final round we drop the tool so the model
// must answer in text.
const MAX_SEARCH_ROUNDS = 4
// A provider falsely reporting `stop` must not cause an unbounded billed loop.
// Two hidden resumptions cover the observed GPT-5.5 failure; if both also end
// mid-sentence, the final message is marked `length` and exposes the existing
// user-controlled "continue generation" action.
const MAX_AUTO_CONTINUATIONS = 2

interface UseChatHandlerOptions {
  config: PlaygroundConfig
  parameterEnabled: ParameterEnabled
  onMessageUpdate: (updater: (prev: Message[]) => Message[]) => void
  onSessionMessageUpdate: (
    sessionId: string,
    updater: (prev: Message[]) => Message[]
  ) => void
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

interface ActiveTextRun {
  id: number
  sessionId: string
  messageKey: string
  controller: AbortController
  contentBuf: string
  reasoningBuf: string
  pendingContentSeparator: string
  terminalStarted: boolean
}

class TextTurnRequestError extends Error {
  code?: string
  partialResult?: StreamResult

  constructor(message: string, code?: string, partialResult?: StreamResult) {
    super(message)
    this.name = 'TextTurnRequestError'
    this.code = code
    this.partialResult = partialResult
  }
}

function abortError(): Error {
  try {
    return new DOMException('The request was aborted.', 'AbortError')
  } catch {
    const error = new Error('The request was aborted.')
    error.name = 'AbortError'
    return error
  }
}

/**
 * Hook for handling chat message sending and receiving
 */
export function useChatHandler({
  config,
  parameterEnabled,
  onMessageUpdate,
  onSessionMessageUpdate,
  imageOptions,
  videoOptions,
  sessionId,
}: UseChatHandlerOptions) {
  const { sendStreamRequest, stopStream } = useStreamRequest()
  // Media generation is detached and should not lock the composer/workspace.
  // The state is still useful for rerendering when active media finishes.
  const [, setIsImageGenerating] = useState(false)
  // Live subscriptions to detached image/video generations (keyed by message).
  // We detach (not cancel) on unmount so generation keeps running in the manager.
  const imageGenUnsubsRef = useRef<Map<string, () => void>>(new Map())
  // A text run owns the complete request → search → continuation chain. The
  // composer stays locked until that run reaches one terminal path, and every
  // callback targets its original session/message key rather than whichever
  // conversation happens to be open when an async callback arrives.
  const [isTextGenerating, setIsTextGenerating] = useState(false)
  const textRunSeqRef = useRef(0)
  const activeTextRunRef = useRef<ActiveTextRun | null>(null)

  const isLiveTextRun = useCallback(
    (run: ActiveTextRun) =>
      activeTextRunRef.current?.id === run.id && !run.terminalStarted,
    []
  )

  const updateTextRunMessage = useCallback(
    (run: ActiveTextRun, updater: (message: Message) => Message) => {
      if (!isLiveTextRun(run)) return
      onSessionMessageUpdate(run.sessionId, (prev) =>
        updateMessageByKey(prev, run.messageKey, updater)
      )
    },
    [isLiveTextRun, onSessionMessageUpdate]
  )

  const beginTextRun = useCallback(
    (messages: Message[]): ActiveTextRun | null => {
      // A synchronous ref guard closes the double-click window before React
      // has had a chance to render the disabled composer state.
      if (activeTextRunRef.current) return null
      const messageKey = [...messages]
        .reverse()
        .find((message) => message.from === 'assistant')?.key
      if (!messageKey || !sessionId) return null

      const run: ActiveTextRun = {
        id: ++textRunSeqRef.current,
        sessionId,
        messageKey,
        controller: new AbortController(),
        contentBuf: '',
        reasoningBuf: '',
        pendingContentSeparator: '',
        terminalStarted: false,
      }
      activeTextRunRef.current = run
      markGenerationActive(messageKey)
      setIsTextGenerating(true)
      return run
    },
    [sessionId]
  )

  const handleTextChunk = useCallback(
    (run: ActiveTextRun, type: 'reasoning' | 'content', chunk: string) => {
      if (!chunk || !isLiveTextRun(run)) return
      let displayChunk = chunk
      if (type === 'reasoning') {
        run.reasoningBuf += chunk
      } else {
        if (run.pendingContentSeparator) {
          displayChunk = `${run.pendingContentSeparator}${chunk}`
          run.pendingContentSeparator = ''
        }
        run.contentBuf += displayChunk
      }

      updateTextRunMessage(run, (message) => {
        if (
          message.status === MESSAGE_STATUS.COMPLETE ||
          message.status === MESSAGE_STATUS.ERROR
        ) {
          return message
        }
        const base = message.isSearching
          ? { ...message, isSearching: false }
          : message
        if (type === 'reasoning') {
          return {
            ...base,
            reasoning: { content: run.reasoningBuf, duration: 0 },
            isReasoningStreaming: true,
            isReasoningComplete: false,
            status: MESSAGE_STATUS.STREAMING,
          }
        }
        return {
          ...processStreamingContent(base, displayChunk),
          isContentComplete: false,
          status: MESSAGE_STATUS.STREAMING,
        }
      })
    },
    [isLiveTextRun, updateTextRunMessage]
  )

  const setTextRunPhase = useCallback(
    (run: ActiveTextRun, phase: ToolLoopPhase) => {
      if (phase === 'searching' && run.contentBuf) {
        run.pendingContentSeparator = '\n\n'
      }
      updateTextRunMessage(run, (message) => ({
        ...message,
        isSearching: phase === 'searching',
        isReasoningStreaming:
          phase === 'searching' ? false : message.isReasoningStreaming,
        status: MESSAGE_STATUS.STREAMING,
      }))
    },
    [updateTextRunMessage]
  )

  const settleTextRun = useCallback(
    async (
      run: ActiveTextRun,
      status: 'complete' | 'error',
      result?: Partial<ToolLoopTurnResult>,
      errorCode?: string,
      errorMessage?: string
    ) => {
      if (!isLiveTextRun(run)) return
      // Claim terminal ownership before awaiting image offload. A stop/error or
      // late SSE callback that races this path can no longer settle twice.
      run.terminalStarted = true

      let storedContent =
        status === 'error' && errorMessage
          ? appendTerminalError(run.contentBuf, errorMessage)
          : run.contentBuf
      try {
        storedContent = await offloadDataImagesToIdb(storedContent)
      } catch {
        // Text still must reach a terminal state if IndexedDB is unavailable.
      }

      const snapshot = finalizeMessage(
        {
          key: run.messageKey,
          from: 'assistant',
          versions: [{ id: 'terminal', content: storedContent }],
          reasoning: run.reasoningBuf
            ? { content: run.reasoningBuf, duration: 0 }
            : undefined,
        },
        run.reasoningBuf || undefined
      )
      const content = snapshot.versions[0]?.content ?? storedContent
      const terminationReason =
        result?.terminationReason ??
        (status === 'complete' ? 'stop' : 'network_error')
      const terminalPatch = {
        content,
        status,
        reasoning: snapshot.reasoning,
        isReasoningStreaming: false,
        isReasoningComplete: true,
        isContentComplete: true,
        isSearching: false,
        errorCode: status === 'error' ? errorCode || null : null,
        finishReason: result?.finishReason,
        terminationReason,
        requestId: result?.requestId,
        usage: result?.usage,
      } as const

      onSessionMessageUpdate(run.sessionId, (prev) =>
        updateMessageByKey(prev, run.messageKey, (message) => ({
          ...finalizeMessage(
            updateCurrentVersionContent(message, content),
            run.reasoningBuf || undefined
          ),
          ...terminalPatch,
        }))
      )
      patchSessionMessage(run.sessionId, run.messageKey, terminalPatch)
      markGenerationDone(run.messageKey)
      if (activeTextRunRef.current?.id === run.id) {
        activeTextRunRef.current = null
        setIsTextGenerating(false)
      }
    },
    [isLiveTextRun, onSessionMessageUpdate]
  )

  const requestStreamingTurn = useCallback(
    (
      run: ActiveTextRun,
      payload: ChatCompletionRequest,
      signal: AbortSignal
    ): Promise<StreamResult> =>
      new Promise((resolve, reject) => {
        if (signal.aborted || !isLiveTextRun(run)) {
          reject(abortError())
          return
        }
        let settled = false
        const finish = (callback: () => void) => {
          if (settled) return
          settled = true
          signal.removeEventListener('abort', onAbort)
          callback()
        }
        const onAbort = () => {
          stopStream()
          finish(() => reject(abortError()))
        }
        signal.addEventListener('abort', onAbort, { once: true })
        sendStreamRequest(
          payload,
          (type, chunk) => handleTextChunk(run, type, chunk),
          (result) => finish(() => resolve(result)),
          (message, code, partialResult) =>
            finish(() =>
              reject(new TextTurnRequestError(message, code, partialResult))
            )
        )
      }),
    [handleTextChunk, isLiveTextRun, sendStreamRequest, stopStream]
  )

  const requestNonStreamingTurn = useCallback(
    async (
      run: ActiveTextRun,
      payload: ChatCompletionRequest,
      signal: AbortSignal
    ): Promise<ToolLoopTurnResult> => {
      const response = await sendChatCompletion(
        { ...payload, stream: false },
        signal
      )
      if (signal.aborted || !isLiveTextRun(run)) throw abortError()
      const choice = response.choices?.[0]
      if (!choice)
        throw new TextTurnRequestError(ERROR_MESSAGES.API_REQUEST_ERROR)
      const message = choice.message
      if (message.reasoning_content) {
        handleTextChunk(run, 'reasoning', message.reasoning_content)
      }
      if (message.content) handleTextChunk(run, 'content', message.content)
      const finishReason = choice.finish_reason || 'stop'
      return {
        content: message.content || '',
        toolCalls: message.tool_calls || [],
        finishReason,
        terminationReason: finishReason as StreamTerminationReason,
        requestId: response.id,
        usage: response.usage,
      }
    },
    [handleTextChunk, isLiveTextRun]
  )

  const executeTextChat = useCallback(
    async (
      run: ActiveTextRun,
      messages: Message[],
      referenceImages?: string[]
    ) => {
      try {
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
        const result = await runChatToolLoop({
          payload,
          signal: run.controller.signal,
          searchWeb,
          maxSearchRounds: MAX_SEARCH_ROUNDS,
          maxAutoContinuations: MAX_AUTO_CONTINUATIONS,
          requestTurn: (request, context) =>
            config.stream
              ? requestStreamingTurn(run, request, context.signal)
              : requestNonStreamingTurn(run, request, context.signal),
          onPhase: ({ phase }) => setTextRunPhase(run, phase),
          onContinuation: ({ separator }) => {
            if (separator) handleTextChunk(run, 'content', separator)
          },
        })
        await settleTextRun(run, 'complete', result)
      } catch (error: unknown) {
        if (run.controller.signal.aborted || isToolLoopCancelledError(error)) {
          await settleTextRun(
            run,
            'error',
            { terminationReason: 'client_abort' },
            'client_abort',
            friendlyErrorMessage(ERROR_MESSAGES.INTERRUPTED)
          )
          return
        }

        const requestError = error as TextTurnRequestError
        const axiosError = error as {
          response?: {
            data?: {
              message?: string
              error?: { message?: string; code?: string }
            }
          }
          message?: string
        }
        const rawMessage =
          requestError instanceof TextTurnRequestError
            ? requestError.message
            : axiosError.response?.data?.error?.message ||
              axiosError.response?.data?.message ||
              axiosError.message ||
              ERROR_MESSAGES.API_REQUEST_ERROR
        const code =
          requestError instanceof TextTurnRequestError
            ? requestError.code
            : axiosError.response?.data?.error?.code
        const friendlyMessage = friendlyErrorMessage(rawMessage)
        toast.error(friendlyMessage)
        await settleTextRun(
          run,
          'error',
          requestError instanceof TextTurnRequestError
            ? requestError.partialResult
            : { terminationReason: 'network_error' },
          code,
          friendlyMessage
        )
      }
    },
    [
      config,
      parameterEnabled,
      imageOptions,
      requestStreamingTurn,
      requestNonStreamingTurn,
      setTextRunPhase,
      handleTextChunk,
      settleTextRun,
    ]
  )

  // Media generation has its own detached managers. Pre-flight failures still
  // target the active media placeholder, but never borrow a text run's buffers.
  const handleMediaError = useCallback(
    (
      targetSessionId: string | undefined,
      messageKey: string | undefined,
      error: string,
      errorCode?: string
    ) => {
      const friendlyMessage = friendlyErrorMessage(error)
      toast.error(friendlyMessage)
      if (!targetSessionId || !messageKey) return

      onSessionMessageUpdate(targetSessionId, (prev) =>
        updateMessageByKey(prev, messageKey, (message) => {
          const content = appendTerminalError(
            getCurrentVersion(message).content,
            friendlyMessage
          )
          return {
            ...finalizeMessage(updateCurrentVersionContent(message, content)),
            status: MESSAGE_STATUS.ERROR,
            errorCode: errorCode || null,
            terminationReason: 'network_error',
          }
        })
      )
      patchSessionMessage(targetSessionId, messageKey, {
        content: friendlyMessage,
        status: MESSAGE_STATUS.ERROR,
        isReasoningStreaming: false,
        isReasoningComplete: true,
        isContentComplete: true,
        isSearching: false,
        errorCode: errorCode || null,
        terminationReason: 'network_error',
      })
    },
    [onSessionMessageUpdate]
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
      const target = [...messages].reverse().find((m) => m.from === 'assistant')
      const messageKey = target?.key
      if (!prompt.trim()) {
        handleMediaError(
          sessionId,
          messageKey,
          ERROR_MESSAGES.API_REQUEST_ERROR
        )
        return
      }

      const refImages = await resolveReferenceImages(messages)
      // The assistant bubble this generation fills. Keyed so a detached
      // generation (playground unmounted mid-flight) lands on the right message.
      if (!messageKey || !sessionId) {
        handleMediaError(
          sessionId,
          messageKey,
          ERROR_MESSAGES.API_REQUEST_ERROR
        )
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
      handleMediaError,
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
        handleMediaError(
          sessionId,
          messageKey,
          ERROR_MESSAGES.API_REQUEST_ERROR
        )
        return
      }

      let referenceImages = await resolveReferenceImages(messages)
      try {
        // A 4K history/reference image can become a 30–90 MB JSON body after
        // base64 encoding. Normalize it once, then reuse the safe result across
        // all parallel outputs. This does not change opts.resolution or count.
        referenceImages = await prepareGeminiReferenceImages(referenceImages)
      } catch {
        handleMediaError(
          sessionId,
          messageKey,
          'Reference image compression failed'
        )
        return
      }
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
      handleMediaError,
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
        handleMediaError(
          sessionId,
          messageKey,
          ERROR_MESSAGES.API_REQUEST_ERROR
        )
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
    [config.model, videoOptions, sessionId, subscribeAndBind, handleMediaError]
  )

  // Send chat request. OpenAI-family image models (gpt-image-2) go through the
  // dedicated images endpoint; video models (Veo) use the async video task
  // pipeline; everything else (text models + Gemini in-chat image models)
  // streams or non-streams through chat/completions.
  const sendChat = useCallback(
    (messages: Message[], onAccepted: () => void): boolean => {
      const kind = imageModelKind(config.model)
      if (kind === 'video') {
        onAccepted()
        void sendVideoGeneration(messages)
        return true
      }
      if (kind === 'openai') {
        onAccepted()
        void sendImageGeneration(messages)
        return true
      }
      if (kind === 'gemini') {
        // Nano Banana rides the chat endpoint, but reference images follow the
        // SAME rule as gpt-image-2 (resolveReferenceImages): history images
        // are stripped to placeholders before sending, so without explicit
        // injection the model never actually sees the picture being edited —
        // it just redraws from the previous prompt text and details drift.
        onAccepted()
        void sendGeminiImageGeneration(messages)
        return true
      }

      // Reserve the run before the caller installs its placeholder. This makes
      // acceptance + target ownership atomic: a same-tick double submit cannot
      // replace the first placeholder with a second one that no run owns.
      const run = beginTextRun(messages)
      if (!run) return false
      onAccepted()
      void executeTextChat(run, messages)
      return true
    },
    [
      config.model,
      beginTextRun,
      sendImageGeneration,
      sendGeminiImageGeneration,
      sendVideoGeneration,
      executeTextChat,
    ]
  )

  // Stop generation
  const stopGeneration = useCallback(() => {
    const run = activeTextRunRef.current
    if (run && !run.terminalStarted) {
      run.controller.abort()
      stopStream()
      void settleTextRun(
        run,
        'error',
        { terminationReason: 'client_abort' },
        'client_abort',
        friendlyErrorMessage(ERROR_MESSAGES.INTERRUPTED)
      )
    }
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
  }, [stopStream, sessionId, settleTextRun])

  return {
    sendChat,
    stopGeneration,
    // Detached media generations should not lock the workspace or composer.
    // Only text streaming keeps the stop/disabled state.
    isGenerating: isTextGenerating,
  }
}
