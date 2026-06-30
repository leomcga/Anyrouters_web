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
import { api } from '@/lib/api'
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
 * the dedicated images endpoint and reject chat/completions. Returns a list of
 * data URLs built from the response's b64_json (or url) entries.
 */
export async function generateImage(payload: {
  model: string
  group?: string
  prompt: string
  size?: string
  quality?: string
  n?: number
}): Promise<string[]> {
  const res = await api.post(API_ENDPOINTS.IMAGE_GENERATIONS, payload, {
    skipErrorHandler: true,
  } as Record<string, unknown>)
  const data = res.data?.data
  if (!Array.isArray(data)) return []
  return data
    .map((item: { b64_json?: string; url?: string }) => {
      if (item.b64_json) return `data:image/png;base64,${item.b64_json}`
      if (item.url) return item.url
      return ''
    })
    .filter(Boolean)
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
