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
 * System-prompt design (fixes the "dumbed-down / robotic AI tone" complaint):
 * by default we send only ONE short, language-neutral identity line — enough to
 * stop the model misidentifying itself on Bedrock/Vertex (Claude would
 * occasionally claim to be Qwen) without a long block of imperative English
 * directives that pushes the model into a stiff, translated-sounding register.
 *
 * Language: the identity is written in English (the register models handle most
 * reliably) but explicitly tells the model to REPLY IN THE USER'S OWN LANGUAGE,
 * so a Chinese user gets natural Chinese, an English user natural English, etc.
 * Capability hints (code sandbox) are injected ONLY when the user's latest
 * message actually looks like a file/data/chart request; web search is driven
 * by the web_search tool's own description rather than a system directive.
 */

// Appended ONLY when the user's message looks like they want a file / data
// analysis / visualization: tells the model it can emit one-click-runnable
// Python instead of refusing. Plain declarative tone, no must/never commands.
const CODE_CAPABILITY =
  ' This workspace has a Python code execution sandbox: when the user wants a ' +
  'file (Excel/CSV/chart/image/PDF/document/script), data analysis, or a ' +
  'visualization, you can write one complete, self-contained Python block that ' +
  'produces the file(s), saving outputs to the current directory (e.g. ' +
  "df.to_excel('report.xlsx'), plt.savefig('chart.png')); the user runs it with " +
  'one click and downloads the result. Libraries like pandas, matplotlib, ' +
  'openpyxl, reportlab are available.'

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

// Minimal, language-neutral identity: one line, only to stop the model
// misnaming its vendor. It does NOT constrain the conversation style, and it
// tells the model to mirror the user's language so non-Chinese users stay
// natural too.
const REPLY_IN_USER_LANGUAGE = ' Always reply in the same language the user writes in.'

function identityForModel(model: string): string {
  const m = model.toLowerCase()
  let who = 'You are a helpful AI assistant.'
  if (m.includes('claude')) {
    who = 'You are Claude, an AI assistant made by Anthropic.'
  } else if (m.includes('gemini')) {
    who = 'You are Gemini, an AI assistant made by Google.'
  } else if (/\b(gpt|chatgpt|o\d)\b/.test(m)) {
    who = 'You are ChatGPT, an AI assistant made by OpenAI.'
  }
  return who + REPLY_IN_USER_LANGUAGE
}

// Heuristic: does the user's latest message look like a file / data-analysis /
// visualization request? Covers both English and Chinese phrasings so the code
// hint is injected when relevant regardless of the user's language. Only on a
// hit do we append CODE_CAPABILITY, so ordinary chat isn't weighed down.
function wantsFileOutput(text: string): boolean {
  return /excel|csv|xlsx|图表|表格|chart|plot|可视化|visuali|pdf|文档|报告|report|脚本|script|画(个|一个|张)?图|generate.*file|生成.*文件|导出|export|下载|download|数据分析|data analysis|柱状图|折线图|饼图|bar chart|line chart|pie chart|matplotlib|pandas/i.test(
    text
  )
}

// Assemble this turn's system prompt: just the one-line identity by default;
// append the code-capability hint only when the user's message looks like a
// file request. Search capability is no longer in the system prompt — it's
// driven by the web_search tool's own description.
function systemPromptForModel(model: string, lastUserText: string): string {
  let prompt = identityForModel(model)
  if (isTextModel(model.toLowerCase()) && wantsFileOutput(lastUserText)) {
    prompt += CODE_CAPABILITY
  }
  return prompt
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
  // with one, so the model introduces itself correctly. Pass the latest user
  // message so the code-capability hint is only injected for file requests.
  if (processedMessages[0]?.role !== 'system') {
    const lastUser = [...processedMessages]
      .reverse()
      .find((m) => m.role === 'user')
    const lastUserText =
      typeof lastUser?.content === 'string'
        ? lastUser.content
        : Array.isArray(lastUser?.content)
          ? lastUser.content
              .map((p) =>
                typeof p === 'string'
                  ? p
                  : ((p as { text?: string }).text ?? '')
              )
              .join(' ')
          : ''
    processedMessages.unshift({
      role: 'system' as const,
      content: systemPromptForModel(config.model, lastUserText),
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
