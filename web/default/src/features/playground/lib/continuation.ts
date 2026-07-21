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

  const semanticText = text.replace(/[。.!！?？…\s]+$/g, '')
  const trimProgressText = (candidate: string) =>
    candidate.trim().replace(/[。.!！?？…\s]+$/g, '')

  const chineseProgressLead =
    /^(?:接下来[，,]?\s*)?我(?:(?:先|继续|正在|还(?:需要|要|需)|需要|仍(?:需要|要|需|会)|将|会)(?:继续|再)?|再)\s*(?:核对|核验|搜索|查找|查证|检索|确认|检查|验证|补充|整理|对比|分析)\s*(.+)$/
  const chineseTargetEnding =
    /(?:数据|行情|时点|点位|涨跌幅|成交额|涨跌家数|板块|方向|代表股|表现|来源|公告|官网|口径|差异|结果|情况|信息|内容)$/
  const chineseQuestionTarget =
    /(?:是否|是不是|能否)[^，,；;。.!！?？\n]{0,80}(?:领涨|领跌|上涨|下跌|走强|走弱|占优|强于|弱于|分化|领先)$/
  const chineseTargetVocabulary =
    /^(?:最新|当前|今日|今天|收盘|盘中|午盘|午间|实时|可信|有效|指数|沪指|上证指数|深成指|创业板指|科创50|A股|人工智能|AI|CPO|GPU|CPU|光模块|半导体|算力|机器人|硬件端?|硬件|应用端?|应用|不同平台|各平台|平台|不同|细分|代表|市场|板块|概念|广度|行情|数据|时点|点位|涨跌幅|成交额|涨跌家数|方向|代表股|表现|来源|公告|官网|口径|差异|结果|情况|信息|内容|是否|是不是|能否|属于|上涨|下跌|领涨|领跌|走强|走弱|占优|强于|弱于|分化|领先|的|为|其|三个|多家|各家|和|及|以及|与|或|[一二三四五六七八九十百千万两多各]+|[0-9+.%（）()“”"'/\-\s、])+$/
  const chineseTargetNoun =
    /(?:数据|行情|时点|点位|涨跌幅|成交额|涨跌家数|板块|概念|广度|方向|代表股|表现|来源|公告|官网|口径|差异|结果|情况|信息|内容)/
  const chineseSafeguardVocabulary =
    /^(?:避免|防止|以免|把|搜索摘要|搜索|摘要|中的|中|旧|午盘|盘中|收盘|行情|数据|不同平台|各平台|平台|板块|口径|或|和|及|以及|与|误用|错用|混淆|混入|误当成|当成|混在一起|的|\s)+$/
  const chineseRiskSafeguard =
    /^(?:(?:避免|防止|以免)(?:误用|错用|混淆)|(?:避免|防止|以免)(?:把)?(?=[^，,；;。.!！?？\n]{1,140}(?:数据|行情|口径))(?:(?:[^，,；;。.!！?？\n]{0,100}(?:误用|错用|混淆|混入|误当成|当成)[^，,；;。.!！?？\n]{0,50}(?:数据|行情|口径))|(?:[^，,；;。.!！?？\n]{0,120}(?:数据|行情|口径)[^，,；;。.!！?？\n]{0,30}混在一起)))$/
  const chinesePromiseBody =
    /^([^，,；;。.!！?？\n]{0,180}?)(?:完成后|后)[，,]?\s*(?:马上|随后|然后|再)?\s*(?:给出|给|提供|输出|整理|汇总)(?:给)?(?:你|用户)?\s*(?:(?:完整|最终|详细|明确|当前|可验证|可信)的?){0,2}(?:结论|回答|分析|结果)$/

  const isChineseTarget = (candidate: string) =>
    candidate.length > 0 &&
    candidate.length <= 220 &&
    !/[，,；;。!！?？\n]/.test(candidate) &&
    chineseTargetVocabulary.test(candidate) &&
    (chineseTargetEnding.test(candidate) ||
      chineseQuestionTarget.test(candidate))

  const isChineseTargetPhrase = (candidate: string) =>
    candidate.length > 0 &&
    candidate.length <= 220 &&
    !/[，,；;。!！?？\n]/.test(candidate) &&
    chineseTargetVocabulary.test(candidate) &&
    chineseTargetNoun.test(candidate)

  const isChineseRiskSafeguard = (candidate: string) =>
    chineseSafeguardVocabulary.test(candidate) &&
    chineseRiskSafeguard.test(candidate)

  const getChineseProgressBody = (candidate: string) =>
    trimProgressText(candidate).match(chineseProgressLead)?.[1]?.trim() ?? ''

  const isChineseDeferredPromise = (candidate: string) => {
    const body = getChineseProgressBody(candidate)
    const promise = body.match(chinesePromiseBody)
    return (
      !!promise && (!promise[1].trim() || isChineseTarget(promise[1].trim()))
    )
  }

  const isChineseDeferred = (candidate: string) => {
    const body = getChineseProgressBody(candidate)
    if (!body) return false
    if (isChineseDeferredPromise(candidate)) return true

    const clauses = body.split(/[，,]/).map((clause) => clause.trim())
    return (
      clauses.length <= 2 &&
      isChineseTarget(clauses[0]) &&
      (clauses.length === 1 || isChineseRiskSafeguard(clauses[1]))
    )
  }

  const englishProgressLead =
    /^I(?:['’]ll|\s+will|\s+need\s+to|\s+am\s+going\s+to|\s+am\s+still)\s+(?:continue\s+to\s+|first\s+|still\s+)?(?:verify|check|search|research|cross-check|confirm|validate|compare)\s+(.+)$/i
  const englishTargetEnding =
    /(?:data|figures?|timing|time|turnover|volume|breadth|market|sector|stocks?|sources?|results?|details?|information)$/i
  const englishQuestionTarget =
    /\b(?:whether|if)\b[^,;.!?]{0,100}\b(?:leads?|rose|fell|is\s+stronger|is\s+weaker|diverge[sd]?)$/i
  const englishTargetVocabulary =
    /^(?:(?:the|latest|current|today'?s|real-time|closing|close|intraday|remaining|turnover|volume|breadth|market|sector|stocks?|sources?|data|figures?|timing|time|results?|details?|information|AI|artificial|intelligence|hardware|applications?|different|platforms?|three|multiple|each|all|whether|if|leads?|rose|fell|is|stronger|weaker|diverge[sd]?|and|or|of|from|across|between|for|to|[0-9]+(?:\.[0-9]+)?%?)\s*)+$/i
  const englishPromiseBody =
    /^([^,;.!?]{1,180}?)(?:,\s*(?:(?:then|afterwards)\s+)?|\s+and\s+(?:then\s+)?|\s+then\s+|\s+afterwards\s+)(?:provide|give|present|deliver|share|return|produce|write)(?:\s+you)?\s+(?:the\s+|a\s+)?(?:final\s+)?(?:answer|conclusion|analysis|result)$/i

  const isEnglishTarget = (candidate: string) =>
    candidate.length > 0 &&
    candidate.length <= 220 &&
    !/[,;.!?\n]/.test(candidate) &&
    englishTargetVocabulary.test(candidate) &&
    (englishQuestionTarget.test(candidate) ||
      (!/\b(?:if|when|should|want|request|provide|give|present|deliver|share|return|produce|write|answer|conclusion|analysis)\b/i.test(
        candidate
      ) &&
        englishTargetEnding.test(candidate)))

  const getEnglishProgressBody = (candidate: string) =>
    trimProgressText(candidate).match(englishProgressLead)?.[1]?.trim() ?? ''

  const isEnglishDeferredPromise = (candidate: string) => {
    const body = getEnglishProgressBody(candidate)
    const promise = body.match(englishPromiseBody)
    return !!promise && isEnglishTarget(promise[1].trim())
  }

  const isEnglishDeferred = (candidate: string) => {
    const body = getEnglishProgressBody(candidate)
    return (
      !!body && (isEnglishTarget(body) || isEnglishDeferredPromise(candidate))
    )
  }

  // Only a complete, approved preliminary-status prefix may introduce a
  // promise tail. These parsers use closed vocabularies all the way through:
  // no arbitrary prose can be inserted before the deferred promise.
  const chineseCompletedStatus =
    /^(?:(?:初步)?(?:搜索|核对|核验|查找|查证)(?:已经|已)?(?:完成|确认)|(?:(?:目前|当前)(?:可信|有效|可用)?的?)?(?:盘中|收盘|午间)?(?:行情数据|数据|行情|结果)(?:(?:已经|已)?确认(?:有效|可信|可用)?|(?:有效|可信|可用)))$/
  const chineseFoundStatus =
    /^(?:已经|已)(?:找到|获得)(?:今天|今日)(?:（\d{4}年(?:1[0-2]|[1-9])月(?:3[01]|[12]\d|[1-9])日）)?的?(?:有效|可信|可用)(?:盘中|收盘|午间)(?:数据|行情|结果)$/
  const chineseMarketFact =
    /^(?:(?:沪指|上证指数|深成指|创业板指|科创50)(?:(?:(?:上涨|下跌|涨|跌|为|报)?[+＋\-－]?\d+(?:\.\d+)?%)|(?:(?:为|报)?\d+(?:\.\d+)?(?:点)?[（(][+＋\-－]?\d+(?:\.\d+)?%[）)])|(?:(?:为|报)\d+(?:\.\d+)?点))|两市(?:半日)?成交额(?:约|为|达)?\d+(?:\.\d+)?(?:亿元|万亿元))$/
  const chineseCalendarDate =
    /^(?:\d{4}年)?(?:1[0-2]|[1-9])月(?:3[01]|[12]\d|[1-9])日$/

  const isChineseMarketSnapshot = (candidate: string) => {
    const snapshot = candidate.match(
      /^(?:目前|当前)(?:可信|有效|可用)?的?(?:午间|盘中|收盘)?(?:数据|行情)(?:是|为)[：:]?(.+)$/
    )
    if (!snapshot) return false

    const facts = snapshot[1].split('、').map((fact) => fact.trim())
    return (
      facts.length >= 2 && facts.every((fact) => chineseMarketFact.test(fact))
    )
  }

  const isChineseApprovedPrefix = (candidate: string) => {
    if (
      chineseCompletedStatus.test(candidate) ||
      chineseFoundStatus.test(candidate) ||
      chineseMarketFact.test(candidate)
    ) {
      return true
    }

    const compound = candidate.match(/^([^，,]+)[，,](.+)$/)
    if (
      compound &&
      chineseFoundStatus.test(compound[1]) &&
      isChineseMarketSnapshot(compound[2])
    ) {
      return true
    }

    const corrected = candidate.match(
      /^([^。.!！?？\n]+)[。.]刚才搜索结果混入了([^，,；;。.!！?？\n]+)的数据[，,]我正在剔除错配[；;](.+)$/
    )
    if (!corrected || !chineseFoundStatus.test(corrected[1])) return false

    const staleDates = corrected[2].split(/和|及|、/).map((date) => date.trim())
    return (
      staleDates.length >= 1 &&
      staleDates.every((date) => chineseCalendarDate.test(date)) &&
      isChineseMarketSnapshot(corrected[3])
    )
  }
  const englishApprovedPrefix = [
    /^(?:(?:preliminary|initial)\s+)?(?:the\s+)?(?:search|check|verification|research|data|results?|market)(?:\s+(?:is|are|has|have)(?:\s+been)?)?\s+(?:complete|completed|done|confirmed|available|reliable)$/i,
  ]

  const trailingSegments: Array<{ prefix: string; candidate: string }> = []
  for (const separator of semanticText.matchAll(
    /[。!！?？…；;,，]|\.(?=\s+|$)/g
  )) {
    const prefix = semanticText.slice(0, separator.index ?? 0).trim()
    const candidate = semanticText
      .slice((separator.index ?? 0) + separator[0].length)
      .trim()
    if (candidate) {
      trailingSegments.push({ prefix, candidate })
    }
  }
  const semicolonClauses = semanticText
    .split(/[；;]/)
    .map((clause) => clause.trim())
  const chineseTimeContext =
    /^我已确认当前为(?:今天|今日|(?:\d{4}年)?(?:1[0-2]|[1-9])月(?:3[01]|[12]\d|[1-9])日)(?:开盘前|盘中|午间|收盘后)[ \t]*[，,][ \t]*(?:因此|所以)以下按(?:“(?:今日|今天|当日)(?:开盘前|盘中|午间|收盘)(?:行情|数据|口径)”|"(?:今日|今天|当日)(?:开盘前|盘中|午间|收盘)(?:行情|数据|口径)"|'(?:今日|今天|当日)(?:开盘前|盘中|午间|收盘)(?:行情|数据|口径)'|(?:今日|今天|当日)(?:开盘前|盘中|午间|收盘)(?:行情|数据|口径))(?:分析|口径)$/

  const hasExplicitChineseDeferredTail = trailingSegments.some(
    ({ prefix, candidate }) =>
      isChineseApprovedPrefix(prefix) && isChineseDeferredPromise(candidate)
  )
  const hasExplicitEnglishDeferredTail = trailingSegments.some(
    ({ prefix, candidate }) =>
      englishApprovedPrefix.some((pattern) => pattern.test(prefix)) &&
      isEnglishDeferredPromise(candidate)
  )

  const isContextualChineseDeferred =
    semicolonClauses.length === 2 &&
    chineseTimeContext.test(semicolonClauses[0]) &&
    isChineseDeferred(semicolonClauses[1])

  const pairedChineseProgress = semanticText.match(
    /^我(?:会|将)(?:先)?把([^。.!！?？\n]{1,180}?)(?:分开|分别|逐项)(?:核对|核验|验证|检查)[，,]\s*([^。.!！?？\n]{1,160})[。.!！?？]\s*((?:继续|再)\s*(?:查找|查证|搜索|检索|核对|核验|验证|查)\s*(?:交易所(?:官网|公告)?|行情平台|财经(?:快讯|媒体)|公告|官网|权威来源|来源)(?:\s*(?:[、，,]|和|及|以及|与)\s*(?:交易所(?:官网|公告)?|行情平台|财经(?:快讯|媒体)|公告|官网|权威来源|来源))*$)/
  )
  const isPairedChineseDeferred =
    !!pairedChineseProgress &&
    isChineseTargetPhrase(pairedChineseProgress[1].trim()) &&
    isChineseRiskSafeguard(pairedChineseProgress[2].trim())

  return (
    isChineseDeferred(text) ||
    isEnglishDeferred(text) ||
    hasExplicitChineseDeferredTail ||
    hasExplicitEnglishDeferredTail ||
    isContextualChineseDeferred ||
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
