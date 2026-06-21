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
import type {
  ChatCompletionRequest,
  Message,
  PlaygroundConfig,
  ParameterEnabled,
} from '../types'
import { formatMessageForAPI, isValidMessage } from './message-utils'

/**
 * A light identity system prompt keyed to the model vendor. Without one, models
 * frequently misidentify themselves (e.g. Claude claiming to be Qwen). This
 * keeps self-introductions accurate without otherwise constraining behaviour.
 */
function systemPromptForModel(model: string): string {
  const m = model.toLowerCase()
  if (m.includes('claude')) {
    return 'You are Claude, a helpful AI assistant made by Anthropic.'
  }
  if (m.includes('gemini')) {
    return 'You are Gemini, a helpful AI assistant made by Google.'
  }
  if (/\b(gpt|chatgpt|o\d)\b/.test(m)) {
    return 'You are ChatGPT, a helpful AI assistant made by OpenAI.'
  }
  return 'You are a helpful AI assistant.'
}

/**
 * Build API request payload from messages and config
 */
export function buildChatCompletionPayload(
  messages: Message[],
  config: PlaygroundConfig,
  parameterEnabled: ParameterEnabled
): ChatCompletionRequest {
  // Filter and format valid messages
  const processedMessages = messages
    .filter(isValidMessage)
    .map(formatMessageForAPI)

  // Prepend an identity system prompt unless the conversation already starts
  // with one, so the model introduces itself correctly.
  if (processedMessages[0]?.role !== 'system') {
    processedMessages.unshift({
      role: 'system' as const,
      content: systemPromptForModel(config.model),
    })
  }

  const payload: ChatCompletionRequest = {
    model: config.model,
    group: config.group,
    messages: processedMessages,
    stream: config.stream,
  }

  // Add enabled parameters
  const parameterKeys: Array<keyof ParameterEnabled> = [
    'temperature',
    'top_p',
    'max_tokens',
    'frequency_penalty',
    'presence_penalty',
    'seed',
  ]

  parameterKeys.forEach((key) => {
    if (parameterEnabled[key]) {
      const value = config[key as keyof PlaygroundConfig]
      if (value !== undefined && value !== null) {
        ;(payload as unknown as Record<string, unknown>)[key] = value
      }
    }
  })

  // Anthropic Claude on Bedrock rejects these sampling params: newer models
  // (e.g. Opus 4.8) deprecate `temperature` outright, and others reject
  // `temperature` and `top_p` together. Drop both for Claude and let the model
  // use its own defaults so the chat doesn't error out.
  const record = payload as unknown as Record<string, unknown>
  if (/claude/i.test(config.model)) {
    delete record.temperature
    delete record.top_p
  }

  return payload
}
