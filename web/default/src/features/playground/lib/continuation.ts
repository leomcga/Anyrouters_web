import type { Message } from '../types'
import {
  createLoadingAssistantMessage,
  createUserMessage,
} from './message-utils'

export const CONTINUATION_PROMPT =
  '请从上一条回答中断处直接继续，不要重复已经生成的内容。'

export const AUTO_CONTINUATION_PROMPT =
  '上一段响应被接口提前终止在句中。请从最后一个不完整句子的断点直接继续，不要重复已经生成的内容，完成剩余内容；结束前确保最后一句完整。'

const AUTO_CONTINUATION_MIN_CHARS = 1200

interface SuspiciousStopInput {
  model: string
  content: string
  finishReason?: string
}

// Azure occasionally emits a normal `stop` for a long GPT-5.5 response whose
// visible text plainly ends mid-sentence. Keep this deliberately narrow: only
// GPT-5.5, only long text, and never an explicit length/error terminal. The
// caller caps retries, so a prose heuristic can never create an unbounded loop.
export function shouldAutoContinueSuspiciousStop({
  model,
  content,
  finishReason,
}: SuspiciousStopInput): boolean {
  if (!/^gpt-5\.5(?:$|-)/i.test(model.trim())) return false
  if (finishReason !== 'stop') return false

  const text = content.trim()
  if (text.length < AUTO_CONTINUATION_MIN_CHARS) return false

  // Closed structured outputs are valid without sentence punctuation.
  if (/```\s*$/.test(text) || /<\/[a-z][^>]*>\s*$/i.test(text)) return false
  if (/[}\]]\s*$/.test(text)) return false

  const lastLine = text.split(/\r?\n/).at(-1)?.trim() ?? ''
  if (/^\|.*\|$/.test(lastLine) || /^https?:\/\/\S+$/.test(lastLine)) {
    return false
  }

  // Ignore Markdown emphasis and closing quotes/brackets, then require real
  // sentence-ending punctuation. The observed failures ended on ordinary Han
  // characters ("使用", "仿冒") even though Azure reported `stop`.
  const semanticTail = text.replace(/[\s*_~'"”’）)\]】》」』]+$/g, '')
  return !/[。.!！?？…]$/.test(semanticTail)
}

export function buildContinuationMessages(
  messages: Message[],
  truncatedMessageKey: string,
  prompt = CONTINUATION_PROMPT
): Message[] | null {
  const messageIndex = messages.findIndex(
    (message) => message.key === truncatedMessageKey
  )
  if (
    messageIndex === -1 ||
    messages[messageIndex].from !== 'assistant' ||
    messages[messageIndex].finishReason !== 'length'
  ) {
    return null
  }
  return [
    ...messages.slice(0, messageIndex + 1),
    createUserMessage(prompt),
    createLoadingAssistantMessage(),
  ]
}
