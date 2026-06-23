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
        // Video (Veo) and pure image-generation (Imagen) models are async /
        // API-only and can't run in the realtime chat playground.
        !/^veo-/i.test(model) && !/^imagen-/i.test(model)
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
