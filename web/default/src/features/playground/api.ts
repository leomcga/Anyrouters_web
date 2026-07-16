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
import { SSE } from 'sse.js'
import { api, getCommonHeaders } from '@/lib/api'
import { API_ENDPOINTS } from './constants'
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ExecuteResponse,
  ModelOption,
  GroupOption,
} from './types'

/**
 * Send chat completion request (non-streaming)
 */
export async function sendChatCompletion(
  payload: ChatCompletionRequest
): Promise<ChatCompletionResponse> {
  const res = await api.post(API_ENDPOINTS.CHAT_COMPLETIONS, payload, {
    skipErrorHandler: true,
  } as Record<string, unknown>)
  return res.data
}

/**
 * Generate an image via the playground image relay (/pg/images/generations).
 * Used for OpenAI-family image models (gpt-image-2, dall-e-*) which only work on
 * the dedicated images endpoint and reject chat/completions.
 *
 * Streams via `stream: true` + `partial_images`. Streaming is what keeps the
 * connection from sitting idle for the 100+ seconds a large generation can take:
 * the gateway's SSE path (OpenaiImageStreamHandler) attaches the ping keepalive
 * so the long request is never severed by a client/proxy idle timeout. The
 * gateway also transparently wraps a non-streaming upstream JSON response into
 * the same SSE `image_generation.completed` event (OpenaiImageJSONAsStreamHandler),
 * so this reader works whether or not the upstream honors `stream`.
 *
 * `onPartial` (optional) fires with a data URL for each `partial_image` event so
 * the caller can render progressive previews. The promise resolves with the
 * final list of data URLs (from `completed` events) and `degraded: false`; if
 * the stream ended before any `completed` frame arrived it falls back to the
 * last partials with `degraded: true` — partials are visibly low-fidelity
 * (mangled text/faces), so callers must tell the user rather than present one
 * as the finished image.
 */
export interface GeneratedImages {
  urls: string[]
  degraded: boolean
}

/** data:<mime>;base64,<b64> → Blob, for multipart reference-image uploads. */
function dataUrlToBlob(dataUrl: string): Blob | null {
  const m = dataUrl.match(/^data:([^;,]+);base64,(.+)$/)
  if (!m) return null
  try {
    const bin = atob(m[2])
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new Blob([bytes], { type: m[1] })
  } catch {
    return null
  }
}

export async function generateImage(
  payload: {
    model: string
    group?: string
    prompt: string
    size?: string
    quality?: string
    n?: number
    // Reference images (data URLs). When present the request goes to the
    // images/EDITS endpoint (image-to-image) instead of generations — the
    // generations endpoint has no image field, which is why attachments used
    // to be silently ignored (real complaint, 2026-07-03: attached a corset
    // photo, got an unrelated Amazon banner).
    images?: string[]
  },
  onPartial?: (dataUrl: string, index: number) => void,
  // Hands the caller a cancel function so a Stop button can actually end this
  // stream: without it the SSE keeps running and whatever "generating" UI state
  // the caller holds stays stuck until the full generation finishes.
  registerCancel?: (cancel: () => void) => void
): Promise<GeneratedImages> {
  const b64ToDataUrl = (b64: string) => `data:image/png;base64,${b64}`

  const refBlobs = (payload.images ?? [])
    .map(dataUrlToBlob)
    .filter(Boolean) as Blob[]
  const isEdit = refBlobs.length > 0

  // Multiple images: gpt-image-2 REJECTS streaming with n>1 ("Streaming is only
  // supported with n=1"), so go NON-streaming and return all N at once (verified
  // n=2 returns 2). No progressive preview for multi — the picture just appears
  // when ready.
  if ((payload.n ?? 1) > 1) {
    const controller = new AbortController()
    registerCancel?.(() => controller.abort())
    try {
      let res
      if (isEdit) {
        const form = new FormData()
        form.append('model', payload.model)
        form.append('prompt', payload.prompt)
        if (payload.size) form.append('size', payload.size)
        if (payload.quality) form.append('quality', payload.quality)
        form.append('n', String(payload.n))
        refBlobs.forEach((blob, i) =>
          form.append('image[]', blob, `reference-${i}.png`)
        )
        res = await api.post(API_ENDPOINTS.IMAGE_EDITS, form, {
          signal: controller.signal,
          skipErrorHandler: true,
        } as Record<string, unknown>)
      } else {
        res = await api.post(
          API_ENDPOINTS.IMAGE_GENERATIONS,
          {
            model: payload.model,
            group: payload.group,
            prompt: payload.prompt,
            size: payload.size,
            quality: payload.quality,
            n: payload.n,
          },
          { skipErrorHandler: true, signal: controller.signal } as Record<
            string,
            unknown
          >
        )
      }
      const data = (res.data?.data ?? []) as Array<{
        b64_json?: string
        url?: string
      }>
      const urls = data
        .map((d) => (d.b64_json ? b64ToDataUrl(d.b64_json) : d.url || ''))
        .filter(Boolean)
      if (!urls.length) throw new Error('image generation failed')
      return { urls, degraded: false }
    } catch (e) {
      const err = e as {
        code?: string
        name?: string
        response?: { data?: { error?: { message?: string } } }
      }
      if (err.name === 'CanceledError' || err.code === 'ERR_CANCELED') {
        const ab = new Error('image generation stopped') as Error & {
          code?: string
        }
        ab.code = 'aborted'
        throw ab
      }
      throw new Error(
        err.response?.data?.error?.message || 'image generation failed'
      )
    }
  }

  let ssePayload: string | FormData
  const headers = getCommonHeaders()
  if (isEdit) {
    // images/edits is multipart. The gateway parses prompt/model/size/quality/
    // stream from the form fields and replays the whole form (files included)
    // to the upstream BYTE-FOR-BYTE — so no gateway-only fields here: a stray
    // `group` field reaches Azure verbatim and 400s with "Unknown parameter"
    // (billing group comes from the session user server-side anyway).
    const form = new FormData()
    form.append('model', payload.model)
    form.append('prompt', payload.prompt)
    if (payload.size) form.append('size', payload.size)
    if (payload.quality) form.append('quality', payload.quality)
    form.append('n', String(payload.n ?? 1))
    form.append('stream', 'true')
    form.append('partial_images', '2')
    refBlobs.forEach((blob, i) =>
      form.append('image[]', blob, `reference-${i}.png`)
    )
    ssePayload = form
    // The browser must set Content-Type itself (multipart boundary).
    delete headers['Content-Type']
  } else {
    ssePayload = JSON.stringify({
      model: payload.model,
      group: payload.group,
      prompt: payload.prompt,
      size: payload.size,
      quality: payload.quality,
      n: payload.n,
      stream: true,
      partial_images: 2,
    })
  }

  return new Promise<GeneratedImages>((resolve, reject) => {
    const source = new SSE(
      isEdit ? API_ENDPOINTS.IMAGE_EDITS : API_ENDPOINTS.IMAGE_GENERATIONS,
      {
        headers,
        method: 'POST',
        payload: ssePayload as string,
        // Disable sse.js autostart: it would call stream() synchronously in the
        // constructor, before we attach listeners below, so we start it manually
        // at the end (and avoid a duplicate request).
        start: false,
      }
    )

    // Final images (from completed events) and the most recent partial per
    // index, so a stream that ends without a completed event still yields a
    // usable picture. expectedImages lets an n>1 request wait for all N.
    const expectedImages = payload.n && payload.n > 1 ? payload.n : 1
    const completed: string[] = []
    const partials: string[] = []
    let settled = false

    const done = () => {
      if (settled) return
      settled = true
      source.close()
      resolve(
        completed.length
          ? { urls: completed, degraded: false }
          : { urls: partials.filter(Boolean), degraded: true }
      )
    }

    const fail = (msg: string, code?: string) => {
      if (settled) return
      settled = true
      source.close()
      const err = new Error(msg) as Error & { code?: string }
      if (code) err.code = code
      reject(err)
    }

    // User-initiated stop: settle immediately so the caller's finally/catch
    // runs and the composer re-enables. With a partial already in hand, resolve
    // (degraded) so the preview stays visible; otherwise reject with code
    // 'aborted', which callers treat as a quiet stop rather than an error.
    registerCancel?.(() => {
      if (completed.length || partials.some(Boolean)) {
        done()
      } else {
        fail('image generation stopped', 'aborted')
      }
    })

    const handleImagePayload = (data: string, isPartial: boolean) => {
      if (data === '[DONE]') {
        done()
        return
      }
      let obj: {
        type?: string
        b64_json?: string
        url?: string
        partial_image_index?: number
        error?: { message?: string; code?: string }
      }
      try {
        obj = JSON.parse(data)
      } catch {
        return
      }
      if (obj.error) {
        fail(obj.error.message || 'image generation failed', obj.error.code)
        return
      }
      const dataUrl = obj.b64_json
        ? b64ToDataUrl(obj.b64_json)
        : obj.url || ''
      const type = obj.type || ''
      const isCompleted =
        type.endsWith('completed') || (!type && !isPartial)
      if (type.endsWith('partial_image') || (isPartial && !type)) {
        if (dataUrl) {
          const idx = obj.partial_image_index ?? partials.length
          partials[idx] = dataUrl
          onPartial?.(dataUrl, idx)
        }
        return
      }
      // completed / final image. The gateway's JSON-as-stream path emits a
      // `completed` event but not always a trailing [DONE], so resolving here
      // (rather than waiting for [DONE]) is what prevents the caller from
      // hanging forever — which would freeze the composer and drop the image.
      // With n>1 we must keep the stream open until ALL N images have arrived,
      // otherwise the first `completed` would settle and drop images 2..N.
      if (dataUrl) completed.push(dataUrl)
      if (isCompleted && completed.length >= expectedImages) done()
    }

    // Named SSE events (event: image_generation.partial_image / .completed) plus
    // the default unnamed "message" event as a fallback for the JSON-as-stream
    // path and any provider that omits the event: line.
    source.addEventListener('image_generation.partial_image', (e: Event) =>
      handleImagePayload((e as MessageEvent).data, true)
    )
    source.addEventListener('image_generation.completed', (e: Event) =>
      handleImagePayload((e as MessageEvent).data, false)
    )
    // The edits endpoint names its events image_edit.* (generations uses
    // image_generation.*). Named SSE frames do NOT fall through to the
    // 'message' listener, so without these the final image would be dropped.
    source.addEventListener('image_edit.partial_image', (e: Event) =>
      handleImagePayload((e as MessageEvent).data, true)
    )
    source.addEventListener('image_edit.completed', (e: Event) =>
      handleImagePayload((e as MessageEvent).data, false)
    )
    source.addEventListener('message', (e: Event) =>
      handleImagePayload((e as MessageEvent).data, false)
    )
    source.addEventListener('error', (e: Event) => {
      // readyState 2 = CLOSED: the stream ended normally (we already saw
      // [DONE]), so a trailing "error" event here is not a real failure.
      if ((source as unknown as { readyState?: number }).readyState === 2) {
        done()
        return
      }
      const ev = e as MessageEvent & { data?: string }
      // If some images already arrived, treat a trailing error as end-of-stream.
      if (completed.length || partials.some(Boolean)) {
        done()
        return
      }
      let msg = 'image generation failed'
      let code: string | undefined
      if (ev?.data) {
        try {
          const parsed = JSON.parse(ev.data)
          msg = parsed?.error?.message || parsed?.message || msg
          code = parsed?.error?.code
        } catch {
          msg = ev.data
        }
      }
      fail(msg, code)
    })

    // Safety net: if the connection closes (readyState 2) without a [DONE] or
    // completed event ever settling the promise, resolve with whatever we got
    // (or fail) so the caller never hangs — a hung promise freezes the composer.
    source.addEventListener('readystatechange', () => {
      if (settled) return
      if ((source as unknown as { readyState?: number }).readyState === 2) {
        if (completed.length || partials.some(Boolean)) {
          done()
        } else {
          fail('image stream closed before any image arrived')
        }
      }
    })

    // sse.js requires an explicit start; without this the request is never sent.
    try {
      source.stream()
    } catch (err) {
      fail((err as Error)?.message || 'failed to start image stream')
    }
  })
}

/**
 * Submit a Veo video-generation task via the playground relay
 * (/pg/video/generations). Async: returns a task id to poll. Veo-specific
 * parameters (duration / aspectRatio / resolution / audio) go in `metadata`,
 * which the backend's BuildRequestBody reads with priority over top-level
 * fields. `images[0]` (a data URL) enables image-to-video.
 */
export async function submitVideoTask(payload: {
  model: string
  prompt: string
  images?: string[]
  metadata?: Record<string, unknown>
}): Promise<{ id: string }> {
  const res = await api.post(API_ENDPOINTS.VIDEO_GENERATIONS, payload, {
    skipErrorHandler: true,
  } as Record<string, unknown>)
  // Submit returns OpenAIVideo-shaped { id, task_id, status, ... }; either id
  // field works for polling.
  const id = res.data?.id || res.data?.task_id || ''
  return { id }
}

export type VideoTaskStatus =
  | 'queued'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'unknown'

/**
 * Poll a submitted Veo task by id. Normalizes the two status vocabularies the
 * backend can return (completed/in_progress vs succeeded/processing) into one.
 */
export async function fetchVideoTask(taskId: string): Promise<{
  status: VideoTaskStatus
  failReason?: string
}> {
  const res = await api.get(`${API_ENDPOINTS.VIDEO_GENERATIONS}/${taskId}`, {
    skipErrorHandler: true,
  } as Record<string, unknown>)
  // Generic TaskDto path returns { code, data: { status, fail_reason } }; the
  // OpenAI-video path returns { status } at top level. Cover both.
  const body = res.data?.data ?? res.data ?? {}
  const raw = String(body.status || '').toLowerCase()
  const status: VideoTaskStatus =
    raw === 'completed' || raw === 'succeeded' || raw === 'success'
      ? 'succeeded'
      : raw === 'failed' || raw === 'failure'
        ? 'failed'
        : raw === 'in_progress' || raw === 'processing' || raw === 'running'
          ? 'processing'
          : raw === 'queued' || raw === 'submitted' || raw === 'not_start'
            ? 'queued'
            : 'unknown'
  return { status, failReason: body.fail_reason || body.error }
}

/**
 * Build the playable video URL for a completed task. The content proxy
 * (/v1/videos/:task_id/content) accepts the console session cookie
 * (TokenOrUserAuth), so it can be used directly as a <video> src.
 */
export function videoContentUrl(taskId: string): string {
  return `/v1/videos/${taskId}/content`
}

/**
 * Run code in the sandbox sidecar (E2B). Returns stdout/stderr plus any files
 * the code produced (base64-encoded).
 */
export async function executeCode(
  code: string,
  language = 'python'
): Promise<ExecuteResponse> {
  const res = await api.post(
    API_ENDPOINTS.EXECUTE,
    { code, language },
    { skipErrorHandler: true } as Record<string, unknown>
  )
  return res.data
}

/**
 * Run a web search via the gateway (server-side Tavily). Used by the chat
 * tool-use loop to ground any model's answer: the model calls `web_search`,
 * we run it here, and feed `context` back as the tool result.
 */
export async function searchWeb(query: string): Promise<{
  ok: boolean
  context?: string
  results?: { title: string; url: string; content: string }[]
  error?: string
}> {
  const res = await api.post(
    API_ENDPOINTS.SEARCH,
    { query },
    { skipErrorHandler: true } as Record<string, unknown>
  )
  return res.data
}

/**
 * Get user available models
 */
export async function getUserModels(): Promise<ModelOption[]> {
  const res = await api.get(API_ENDPOINTS.USER_MODELS)
  const { data } = res

  if (!data.success || !Array.isArray(data.data)) {
    return []
  }

  const unavailableModels = new Set<string>(
    Array.isArray(data.unavailable_models) ? data.unavailable_models : []
  )

  return data.data
    .filter(
      (model: string) =>
        // Imagen runs only on the dedicated /v1/images/generations endpoint and
        // has no in-chat path, so it stays hidden in the playground. Veo (video)
        // IS supported now via the async /pg/video/generations submit+poll flow.
        !/^imagen-/i.test(model)
    )
    .map((model: string) => ({
      label: model,
      value: model,
      unavailable: unavailableModels.has(model),
    }))
}

/**
 * Get user groups
 */
export async function getUserGroups(): Promise<GroupOption[]> {
  const res = await api.get(API_ENDPOINTS.USER_GROUPS)
  const { data } = res

  if (!data.success || !data.data) {
    return []
  }

  const groupData = data.data as Record<string, { desc: string; ratio: number }>

  // label is for button display (name only); desc is for dropdown content
  return Object.entries(groupData).map(([group, info]) => ({
    label: group,
    value: group,
    ratio: info.ratio,
    desc: info.desc,
  }))
}
