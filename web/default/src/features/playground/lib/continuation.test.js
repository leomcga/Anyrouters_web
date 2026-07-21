import { describe, expect, test } from 'bun:test'
import {
  AUTO_CONTINUATION_PROMPT,
  AUTO_TOOL_CONTINUATION_PROMPT,
  buildContinuationMessages,
  CONTINUATION_PROMPT,
  shouldAutoContinueSuspiciousStop,
  shouldAutoContinueToolAnswer,
} from './continuation'

describe('continue generation payload', () => {
  test('keeps full context and adds one non-repeating continuation turn', () => {
    const messages = [
      {
        key: 'u1',
        from: 'user',
        versions: [{ id: 'v1', content: '请详细分析三个产品' }],
      },
      {
        key: 'a1',
        from: 'assistant',
        versions: [{ id: 'v2', content: '这三个产品如果要卖得好，一定要' }],
        status: 'complete',
        finishReason: 'length',
      },
    ]

    const next = buildContinuationMessages(messages, 'a1')

    expect(next).not.toBeNull()
    expect(next).toHaveLength(4)
    expect(next[1].versions[0].content).toBe('这三个产品如果要卖得好，一定要')
    expect(next[2].versions[0].content).toBe(CONTINUATION_PROMPT)
    expect(next[3].from).toBe('assistant')
    expect(next[3].status).toBe('loading')
  })

  test('auto-continues a long GPT-5.5 reply falsely stopped mid-sentence', () => {
    expect(
      shouldAutoContinueSuspiciousStop({
        model: 'gpt-5.5',
        content: `${'完整段落。'.repeat(400)}如果其应用涉及垃圾营销、仿冒`,
        finishReason: 'stop',
      })
    ).toBe(true)
    expect(AUTO_CONTINUATION_PROMPT).toContain('不要重复')
  })

  test('does not auto-continue genuine terminal states or complete endings', () => {
    const complete = `${'完整段落。'.repeat(400)}最后，以上方案可以分阶段落地。`

    expect(
      shouldAutoContinueSuspiciousStop({
        model: 'gpt-5.5',
        content: complete,
        finishReason: 'stop',
      })
    ).toBe(false)
    expect(
      shouldAutoContinueSuspiciousStop({
        model: 'gpt-5.5',
        content: `${complete.slice(0, -1)}仍未结束`,
        finishReason: 'length',
      })
    ).toBe(false)
    expect(
      shouldAutoContinueSuspiciousStop({
        model: 'claude-opus-4-8',
        content: `${complete.slice(0, -1)}仍未结束`,
        finishReason: 'stop',
      })
    ).toBe(false)
  })

  test('does not continue short chat or closed structured output', () => {
    expect(
      shouldAutoContinueSuspiciousStop({
        model: 'gpt-5.5',
        content: '可以',
        finishReason: 'stop',
      })
    ).toBe(false)
    expect(
      shouldAutoContinueSuspiciousStop({
        model: 'gpt-5.5',
        content: `${'说明。'.repeat(700)}\n\n\`\`\`json\n{"ok": true}\n\`\`\``,
        finishReason: 'stop',
      })
    ).toBe(false)
  })

  test('auto-continues a deferred GPT-5.6 answer after web search', () => {
    expect(
      shouldAutoContinueToolAnswer({
        model: 'gpt-5.6-sol',
        content: '我再核对最新收盘/盘中时点和AI细分板块后马上给你完整结论。',
        finishReason: 'stop',
        searchRounds: 2,
      })
    ).toBe(true)
    expect(
      shouldAutoContinueToolAnswer({
        model: 'gpt-5.6-sol',
        content:
          '我先继续核对指数点位、成交额、涨跌家数以及人工智能不同口径的表现。',
        finishReason: 'stop',
        searchRounds: 1,
      })
    ).toBe(true)
    expect(
      shouldAutoContinueToolAnswer({
        model: 'gpt-5.6-sol',
        content:
          '已找到今天（2026年7月21日）的有效盘中数据。刚才搜索结果混入了7月8日和2025年7月21日的数据，我正在剔除错配；目前可信的午间行情是：沪指3819.66（+0.62%）、深成指14074.22（+3.41%）、创业板指3622.27（+5.20%）、科创50为1837.94（+6.94%）。我再核对最新收盘/盘中时点和AI细分板块后马上给你完整结论。',
        finishReason: 'stop',
        searchRounds: 2,
      })
    ).toBe(true)
    expect(AUTO_TOOL_CONTINUATION_PROMPT).toContain('本轮直接给出最终回答')
  })

  test('does not auto-continue without a prior search or after a final answer', () => {
    expect(
      shouldAutoContinueToolAnswer({
        model: 'gpt-5.6-sol',
        content: '我再核对后给你完整结论。',
        finishReason: 'stop',
        searchRounds: 0,
      })
    ).toBe(false)
    expect(
      shouldAutoContinueToolAnswer({
        model: 'gpt-5.6-sol',
        content: '结论：今天人工智能硬件方向领涨，应用端分化。',
        finishReason: 'stop',
        searchRounds: 2,
      })
    ).toBe(false)
    expect(
      shouldAutoContinueToolAnswer({
        model: 'gpt-5.6-sol',
        content: '我再核对了三家来源，数据一致：沪指上涨。',
        finishReason: 'stop',
        searchRounds: 2,
      })
    ).toBe(false)
    expect(
      shouldAutoContinueToolAnswer({
        model: 'gpt-5.6-sol',
        content: "I'll verify: all three sources agree; the index is up 0.62%.",
        finishReason: 'stop',
        searchRounds: 2,
      })
    ).toBe(false)
  })
})
