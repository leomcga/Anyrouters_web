import type { Message } from '../types'
import {
  createLoadingAssistantMessage,
  createUserMessage,
} from './message-utils'

export const CONTINUATION_PROMPT =
  '请从上一条回答中断处直接继续，不要重复已经生成的内容。'

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
