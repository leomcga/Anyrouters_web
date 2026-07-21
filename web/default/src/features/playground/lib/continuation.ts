import type { Message } from '../types'
import {
  createLoadingAssistantMessage,
  createUserMessage,
} from './message-utils'

export const CONTINUATION_PROMPT =
  '请从上一条回答中断处直接继续，不要重复已经生成的内容。'

export const AUTO_CONTINUATION_PROMPT =
  '上一段响应被接口提前终止在句中。请从最后一个不完整句子的断点直接继续，不要重复已经生成的内容，完成剩余内容；结束前确保最后一句完整。'

export const AUTO_TOOL_CONTINUATION_PROMPT =
  '请继续执行必要的联网搜索，并在本轮直接给出最终回答。不要只描述接下来要做什么，不要说稍后提供，也不要要求用户再发消息；若数据仍无法核实，请明确说明无法核实的部分后给出当前可验证结论。'

const AUTO_CONTINUATION_MIN_CHARS = 1200

interface SuspiciousStopInput {
  model: string
  content: string
  finishReason?: string
}

interface DeferredToolAnswerInput extends SuspiciousStopInput {
  searchRounds: number
}

export type AutoContinuationReason = 'truncated' | 'deferred'

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

// GPT-5.6 can finish a web-search turn with an ordinary `stop` after emitting
// only a status update ("我再核对……马上给你结论"). The gateway has no pending
// tool call at that point, so without a bounded hidden turn the composer
// unlocks and the user has to type "好了吗". Keep this deliberately narrow:
// only GPT-5.6, only after at least one actual search round, and only a short
// progress-only message. A real conclusion or structured answer must never be
// classified as deferred.
export function shouldAutoContinueToolAnswer({
  model,
  content,
  finishReason,
  searchRounds,
}: DeferredToolAnswerInput): boolean {
  if (!/^gpt-5\.6(?:$|-)/i.test(model.trim())) return false
  if (finishReason !== 'stop' || searchRounds < 1) return false

  const text = content.trim()
  if (!text || text.length > 320) return false

  // Final-answer markers and multi-section/list output are strong evidence
  // that this is an intentionally concise answer rather than a progress note.
  if (
    /(?:^|\n)\s*(?:结论|总结|答案|分析结果|操作建议|综上|final\s+(?:answer|conclusion)|conclusion)\s*[：:]/im.test(
      text
    ) ||
    /(?:^|\n)\s*(?:[-*+]\s+|\d+[.)、]\s+)/m.test(text) ||
    /```|\|\s*[-:]+\s*\|/.test(text)
  ) {
    return false
  }

  const chineseFutureProgress =
    /^我(?:先|继续|正在|还(?:要|需)|需要|将|会)(?:继续|再)?\s*(?:核对|核验|搜索|查找|查证|检索|确认|检查|验证|补充|整理|对比)/
  const chineseRepeatProgress =
    /^我再\s*(?:核对|核验|搜索|查找|查证|检索|确认|检查|验证|补充|整理|对比|分析)/
  const chineseDeferredPromise =
    /(?:后|完成后|，|,)\s*(?:马上|随后|然后|再)?\s*(?:给|提供|输出|整理|汇总).{0,24}(?:结论|回答|分析|结果)/
  const chineseCompletedResult =
    /(?:核对|核验|搜索|查找|查证|检索|确认|检查|验证)(?:了|过|完)|(?:数据|结果|核对结果).{0,8}(?:一致|显示|表明|为|是)/
  const chineseTerminalResult =
    /(?:结论|总结|答案|分析结果|核验结果|核对结果)\s*(?:是|为|[：:])/
  const chinesePairedProgress =
    /^我(?:会|将)(?:先)?把[^。.!！?？\n]{1,220}?(?:分开|分别|逐项)(?:核对|核验|验证|检查)\s*[,，]\s*(?:避免|防止|以免)(?=[^，,；;。.!！?？\n]{0,140}(?:误|错|混淆|混入|当成))[^，,；;。.!！?？\n]{1,140}[。.!！?？]\s*(?:继续|再)\s*(?:查找|查证|搜索|检索|核对|核验|验证|查)\s*(?:交易所(?:官网|公告)?|行情平台|财经(?:快讯|媒体)|公告|官网|权威来源|来源)(?:\s*(?:[、，,]|和|及|以及|与)\s*(?:交易所(?:官网|公告)?|行情平台|财经(?:快讯|媒体)|公告|官网|权威来源|来源))*$/
  const chinesePairedTerminalEvidence =
    /(?:结论|总结|答案|结果)\s*(?:是|为|[：:])|(?:数据|来源).{0,12}(?:一致|显示|表明)|(?:无需|不必|没有必要).{0,12}(?:继续|再)|(?:建议|应该|可以).{0,12}(?:继续|再)\s*(?:查|核对|核验|搜索|检索)|(?:上涨|下跌|领涨|领跌|收涨|收跌).{0,12}\d|\d+(?:\.\d+)?\s*%/
  const englishProgress =
    /^I(?:'ll|\s+will|\s+need\s+to|\s+am\s+going\s+to|\s+am\s+still)\s+(?:continue\s+to\s+|first\s+|still\s+)?(?:verify|check|search|research|cross-check|confirm|validate|compare)/i
  const englishCompletedResult =
    /:\s*\S|(?:sources?|data|results?).{0,24}(?:agree|consistent|show|indicate)|(?:index|market).{0,16}\b(?:is|was|rose|fell|up|down)\b/i

  // Providers sometimes prepend one paragraph of preliminary figures, then
  // end with the same progress-only promise. Classify by that final sentence
  // too; a real answer ending in an actual conclusion still fails this narrow
  // first-person future-action pattern.
  const semanticText = text.replace(/[。.!！?？…\s]+$/g, '')
  const lastSentence =
    semanticText
      .split(/[。！?？…]|\.(?:\s+|$)/)
      .at(-1)
      ?.trim() ?? ''

  const isChineseDeferred = (candidate: string) => {
    if (
      !candidate ||
      chineseCompletedResult.test(candidate) ||
      chineseTerminalResult.test(candidate)
    ) {
      return false
    }
    return (
      chineseFutureProgress.test(candidate) ||
      (chineseRepeatProgress.test(candidate) &&
        chineseDeferredPromise.test(candidate))
    )
  }
  const isEnglishDeferred = (candidate: string) =>
    !!candidate &&
    englishProgress.test(candidate) &&
    !englishCompletedResult.test(candidate)

  const isPairedChineseDeferred =
    chinesePairedProgress.test(semanticText) &&
    !chinesePairedTerminalEvidence.test(text)

  return (
    isChineseDeferred(text) ||
    isEnglishDeferred(text) ||
    isChineseDeferred(lastSentence) ||
    isEnglishDeferred(lastSentence) ||
    isPairedChineseDeferred
  )
}

export function classifyAutoContinuation(
  input: DeferredToolAnswerInput
): AutoContinuationReason | null {
  if (shouldAutoContinueSuspiciousStop(input)) return 'truncated'
  if (shouldAutoContinueToolAnswer(input)) return 'deferred'
  return null
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
