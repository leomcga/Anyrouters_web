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
// Tells the model it can produce real files via the workspace's Python
// execution sandbox, so file/analysis requests yield runnable code (which
// surfaces the "Run code" panel) instead of an "I can't create files" refusal.
const CODE_CAPABILITY =
  ' You have a Python code execution sandbox available in this workspace. ' +
  'When the user wants a file (Excel/CSV/chart/image/PDF/document/script), ' +
  'data analysis, or a visualization, write ONE complete, self-contained ' +
  'Python code block that produces the file(s), saving outputs to the current ' +
  "directory (e.g. df.to_excel('report.xlsx'), plt.savefig('chart.png')). The " +
  'user runs it with one click and downloads the results. Use pandas, ' +
  'matplotlib, openpyxl, reportlab, etc. Never claim you cannot create or ' +
  'return files — write the Python that creates them.'

// Gemini text models are given a googleSearch tool (see buildChatCompletionPayload),
// so tell them to actually use it for fresh facts instead of disclaiming internet
// access — Gemini grounds natively via Vertex.
const WEB_SEARCH_CAPABILITY =
  ' You also have Google Search — use it for anything about current events, ' +
  'recent releases, prices, news or other time-sensitive facts, and cite what ' +
  'you find. Never claim you lack internet access. (Real-time clock/exact ' +
  'current time is not searchable; just say so.)'

// Every other text model (Claude on Bedrock, GPT on Azure, …) gets a universal
// `web_search` function tool instead: when the model calls it, the playground
// runs the search server-side (/pg/search -> Tavily) and feeds the results back,
// so ANY model can ground answers in fresh information.
const WEB_SEARCH_TOOL_CAPABILITY =
  ' You have a web_search tool. Call it whenever the user asks about current ' +
  'events, recent releases, prices, news, or any fact that may have changed ' +
  'after your training cutoff, then answer from the results and cite sources. ' +
  'Never claim you lack internet access — you can search. (You cannot read the ' +
  'real-time clock; for the exact current time, just say so.)'

// The universal web_search function definition handed to non-Gemini text models.
export const WEB_SEARCH_TOOL: Record<string, unknown> = {
  type: 'function',
  function: {
    name: 'web_search',
    description:
      'Search the web for current, real-time or recent information (news, ' +
      'events, prices, releases, or any fact that may post-date your training). ' +
      'Returns relevant results to ground your answer.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query, phrased for a search engine.',
        },
      },
      required: ['query'],
    },
  },
}

// Image / video generation models take no chat tools.
function isTextModel(m: string): boolean {
  return !/image|imagen|veo|sora|dall|flux|midjourney|stable-?diffusion/.test(m)
}

function systemPromptForModel(model: string): string {
  const m = model.toLowerCase()
  let identity = 'You are a helpful AI assistant.'
  if (m.includes('claude')) {
    identity = 'You are Claude, a helpful AI assistant made by Anthropic.'
  } else if (m.includes('gemini')) {
    identity = 'You are Gemini, a helpful AI assistant made by Google.'
  } else if (/\b(gpt|chatgpt|o\d)\b/.test(m)) {
    identity = 'You are ChatGPT, a helpful AI assistant made by OpenAI.'
  }
  let caps = CODE_CAPABILITY
  if (isTextModel(m)) {
    caps += m.includes('gemini')
      ? WEB_SEARCH_CAPABILITY
      : WEB_SEARCH_TOOL_CAPABILITY
  }
  return identity + caps
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

  // Web search is on by default for every text model. Gemini (Vertex) grounds
  // natively via a "googleSearch" tool. Every other text model (Claude on
  // Bedrock, GPT on Azure, …) gets a universal `web_search` function tool whose
  // calls the playground executes server-side (/pg/search -> Tavily), feeding
  // results back — so ALL models can search, not just Gemini.
  const m = config.model.toLowerCase()
  if (isTextModel(m)) {
    record.tools = m.includes('gemini')
      ? [{ type: 'function', function: { name: 'googleSearch' } }]
      : [WEB_SEARCH_TOOL]
  }

  return payload
}
